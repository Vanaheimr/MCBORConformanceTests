/*
 * Generates vectors/cose-ecdh.json, so that it can be regenerated and diffed
 * rather than believed:
 *
 *     npm --prefix tools/EcdhCases ci
 *     node tools/EcdhCases/generate.mjs
 *
 * It depends on neither implementation under test. FINDINGS §12 is about
 * exactly that: COSE_KDF_Context is derived rather than transmitted, so a
 * mistake made identically on both sides opens perfectly — and a generator
 * sharing the code of either side would share its mistakes. What it uses is
 * the noble primitives (the curves, HKDF, AES-GCM, ChaCha20/Poly1305) and
 * nothing above them:
 * the CBOR, the KDF context, the COSE structures and the attack points are
 * written out here, by hand. Before it emits anything it rebuilds the COSE
 * working group's example p256-hkdf-256-01 through that same pipeline and
 * stops unless the bytes come out as published; ChaCha20/Poly1305, which no
 * published ECDH example uses, has to reproduce RFC 8439's AEAD example
 * first.
 *
 * The cases it writes come in five kinds:
 *
 *   - three anchored on the working group's published examples, with the
 *     secret, the context, the derived key and the whole message as they
 *     were published — values no agreement between two implementations can
 *     supply;
 *   - cases on what those examples do not cover (X448, brainpool, P-384,
 *     secp256k1, salt and party information, two recipients, a MAC, and a
 *     ChaCha20/Poly1305 key — the one of these whose expected values the
 *     generator computes itself, see below);
 *   - two key pairs whose shared x-coordinate begins with a zero byte, found
 *     by searching, on P-256 and on P-521 — the I2OSP padding trap;
 *   - three messages that must be refused, each built so that an
 *     implementation which skipped the check would open it;
 *   - a recipient named by its certificate (x5t, EVQI Transport §6.8), once
 *     to be opened and once to be passed over — the second again built so
 *     that it opens for an implementation that ignores the thumbprint.
 *
 * The key-agreement keys and certificates of the x5t cases are not written
 * here: tools/CertificateCorpus owns them, and this generator reads them from
 * vectors/cose-x509-corpus.json, so that the pairing of key and certificate
 * has one owner rather than two that must remember to agree.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join }               from 'node:path';
import { fileURLToPath }               from 'node:url';

import { p256, p384, p521 }  from '@noble/curves/nist.js';
import { secp256k1 }         from '@noble/curves/secp256k1.js';
import { brainpoolP256r1 }   from '@noble/curves/misc.js';
import { x25519 }            from '@noble/curves/ed25519.js';
import { x448 }              from '@noble/curves/ed448.js';
import { hkdf }              from '@noble/hashes/hkdf.js';
import { sha256, sha512 }    from '@noble/hashes/sha2.js';
import { gcm }               from '@noble/ciphers/aes.js';
import { chacha20poly1305 }  from '@noble/ciphers/chacha.js';


const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const hex     = bytes => Buffer.from(bytes).toString('hex').toUpperCase();
const unhex   = text  => Uint8Array.from(Buffer.from(text, 'hex'));
const utf8    = text  => Uint8Array.from(Buffer.from(text, 'utf8'));
const fill    = (n, b) => new Uint8Array(n).fill(b);
const concat  = (...parts) => Uint8Array.from(parts.flatMap(each => [...each]));


// ------------------------------------------------------------------- CBOR ---
// Exactly the subset the COSE structures here need, in the preferred
// serialization: definite lengths, shortest heads, entries in the order given.

function head(major, value) {
    const n = BigInt(value);
    if (n < 24n)          return Uint8Array.of(major << 5 | Number(n));
    if (n < 0x100n)       return Uint8Array.of(major << 5 | 24, Number(n));
    if (n < 0x10000n)     return Uint8Array.of(major << 5 | 25, Number(n >> 8n), Number(n & 0xFFn));
    if (n < 0x100000000n) return concat(Uint8Array.of(major << 5 | 26),
                                        [24n, 16n, 8n, 0n].map(s => Number((n >> s) & 0xFFn)));
    throw new Error('head too large');
}

const cbor = {
    int:   v => v >= 0 ? head(0, v) : head(1, -1 - v),
    bytes: b => concat(head(2, b.length), b),
    text:  s => { const b = utf8(s); return concat(head(3, b.length), b); },
    array: items => concat(head(4, items.length), ...items),
    map:   entries => concat(head(5, entries.length), ...entries.flat()),
    tag:   (t, v) => concat(head(6, t), v),
    nil:   Uint8Array.of(0xF6),
};


// -------------------------------------------------------- COSE_KDF_Context ---
// RFC 9053, Section 5.2. AlgorithmID is what the key is FOR, keyDataLength is
// in bits, absent party fields are nil (never omitted), and protected is the
// recipient's protected bucket as it travels.

const party = info => cbor.array([
    info?.identity !== undefined ? cbor.bytes(unhex(info.identity)) : cbor.nil,
    info?.nonce    !== undefined ? (typeof info.nonce === 'number' ? cbor.int(info.nonce) : cbor.bytes(unhex(info.nonce))) : cbor.nil,
    info?.other    !== undefined ? cbor.bytes(unhex(info.other))    : cbor.nil,
]);

const kdfContext = (algorithmId, keyLength, protectedBytes, partyU, partyV) => cbor.array([
    cbor.int(algorithmId),
    party(partyU),
    party(partyV),
    cbor.array([cbor.int(keyLength * 8), cbor.bytes(protectedBytes)]),
]);


// --------------------------------------------------------- COSE_Encrypt ---

const ALG  = { A128GCM: 1, A192GCM: 2, A256GCM: 3, 'ChaCha20/Poly1305': 24, 'ECDH-ES + HKDF-256': -25 };
const AEAD = { A128GCM: gcm, A192GCM: gcm, A256GCM: gcm, 'ChaCha20/Poly1305': chacha20poly1305 };

/**
 * A COSE_Encrypt message with one direct ECDH-ES recipient, built from a raw
 * secret: whatever an implementation computed as the secret, this is the
 * message that opens for it.
 */
function directMessage({ secret, ephemeralKey, kid, x5t, iv, payload, content = 'A128GCM', keyLength = 16 }) {

    const recipientProtected = cbor.map([[cbor.int(1), cbor.int(ALG['ECDH-ES + HKDF-256'])]]);
    const context            = kdfContext(ALG[content], keyLength, recipientProtected);
    const cek                = hkdf(sha256, secret, new Uint8Array(), context, keyLength);
    const bodyProtected      = cbor.map([[cbor.int(1), cbor.int(ALG[content])]]);
    const encStructure       = cbor.array([cbor.text('Encrypt'), cbor.bytes(bodyProtected), cbor.bytes(new Uint8Array())]);
    const ciphertext         = AEAD[content](cek, iv, encStructure).encrypt(payload);

    const unprotected = [[cbor.int(-1), ephemeralKey]];
    if (kid !== undefined) unprotected.push([cbor.int(4), cbor.bytes(kid)]);
    if (x5t !== undefined) unprotected.push([cbor.int(34), x5t]);

    const message = cbor.tag(96, cbor.array([
        cbor.bytes(bodyProtected),
        cbor.map([[cbor.int(5), cbor.bytes(iv)]]),
        cbor.bytes(ciphertext),
        cbor.array([cbor.array([cbor.bytes(recipientProtected), cbor.map(unprotected), cbor.bytes(new Uint8Array())])]),
    ]));

    return { message, context, cek };

}

const ec2Key = (curveId, x, y) => cbor.map([[cbor.int(1), cbor.int(2)], [cbor.int(-1), cbor.int(curveId)],
                                            [cbor.int(-2), cbor.bytes(x)], [cbor.int(-3), cbor.bytes(y)]]);
const okpKey = (curveId, x)    => cbor.map([[cbor.int(1), cbor.int(1)], [cbor.int(-1), cbor.int(curveId)],
                                            [cbor.int(-2), cbor.bytes(x)]]);


// --------------------------------------------------------------- self-check ---
// The working group's p256-hkdf-256-01, rebuilt through the pipeline above.
// Every field this generator writes into an attack message passes through it.

const published = JSON.parse(readFileSync(join(root, 'libs', 'COSE.TS', 'tests', 'ecdh-vectors.json'), 'utf8')).vectors;
const byName    = name => published.find(each => each.name === name) ?? (() => { throw new Error(`no published example ${name}`); })();

{
    const v         = byName('p256-hkdf-256-01');
    const ephemeral = p256.getPublicKey(unhex(v.ephemeral), false);
    const secret    = p256.getSharedSecret(unhex(v.ephemeral), p256.getPublicKey(unhex(v.d), false), true).slice(1);
    const rebuilt   = directMessage({ secret,
                                      ephemeralKey: ec2Key(1, ephemeral.slice(1, 33), ephemeral.slice(33)),
                                      kid: unhex(v.kid), iv: unhex(v.iv), payload: unhex(v.plaintext) });

    for (const [what, mine, theirs] of [['secret', hex(secret), v.secret],
                                        ['context', hex(rebuilt.context), v.context],
                                        ['content key', hex(rebuilt.cek), v.cek],
                                        ['message', hex(rebuilt.message), v.cbor]])
        if (mine !== theirs)
            throw new Error(`The generator does not reproduce p256-hkdf-256-01: its ${what} is ${mine}, the published one ${theirs}. Nothing was written.`);
}

// RFC 8439, Section 2.8.2: ChaCha20/Poly1305 is used below for a case no
// published example covers, so the primitive is held to its own RFC first.
{
    const sealed = hex(chacha20poly1305(unhex('808182838485868788898A8B8C8D8E8F909192939495969798999A9B9C9D9E9F'),
                                        unhex('070000004041424344454647'),
                                        unhex('50515253C0C1C2C3C4C5C6C7'))
                       .encrypt(utf8('Ladies and Gentlemen of the class of \'99: If I could offer you only one tip for the future, sunscreen would be it.')));
    const expected = 'D31A8D34648E60DB7B86AFBC53EF7EC2A4ADED51296E08FEA9E2B5A736EE62D63DBEA45E8CA9671282FAFB69DA92728B' +
                     '1A71DE0A9E060B2905D6A5B67ECD3B3692DDBD7F2D778B8C9803AEE328091B58FAB324E4FAD675945585808B4831D7BC' +
                     '3FF4DEF08E4B7A9DE576D26586CEC64B6116' +
                     '1AE10B594F09E26A7E902ECBD0600691';
    if (sealed !== expected)
        throw new Error(`The generator does not reproduce RFC 8439, Section 2.8.2: its ChaCha20/Poly1305 gives ${sealed}. Nothing was written.`);
}


// ------------------------------------------------------------------ cases ---

const payload  = utf8('This is the content.');
const iv       = unhex('02D1F7E6F26C43D4868D87CE');
const cek256   = '0F1E2D3C4B5A69788796A5B4C3D2E1F01F2E3D4C5B6A798897A6B5C4D3E2F100';

const RECIPIENT = { 'ECDH-ES': 'ECDH-ES + HKDF-256', 'ECDH-ES-512': 'ECDH-ES + HKDF-512',
                    'ECDH-ES-A128KW': 'ECDH-ES + A128KW', 'ECDH-ES-A192KW': 'ECDH-ES + A192KW',
                    'ECDH-ES-A256KW': 'ECDH-ES + A256KW' };
const CONTENT   = { A128GCM: 'A128GCM', A256GCM: 'A256GCM', HS512: 'HMAC 512/512' };

function anchored(id, name, description) {

    const v = byName(name);
    const testCase = {
        id, class: 'normative',
        shape:       v.message === 'COSE_Mac' ? 'mac' : 'encrypt',
        description,
        algorithm:   CONTENT[v.content],
    };

    if (v.kek !== null) testCase.key = v.cek;
    if (v.iv  !== null) testCase.iv  = v.iv;

    testCase.payload    = v.plaintext;
    testCase.recipients = [{ algorithm: RECIPIENT[v.recipient], curve: v.curve, key: v.d,
                             ephemeral: v.ephemeral, keyIdentifier: v.kid }];

    // What the working group published, which no agreement can supply.
    testCase.expectedSecret  = v.secret;
    testCase.expectedContext = v.context;
    if (v.kek === null) testCase.expectedKey = v.cek;
    testCase.expectedMessage = v.cbor;

    return testCase;

}

/** The first ephemeral scalar 1, 2, 3 … whose secret with the recipient begins with a zero byte. */
function zeroLeading(curve, recipient) {
    const theirs = curve.getPublicKey(recipient, false);
    const width  = recipient.length;
    for (let n = 1; ; n++) {
        const ephemeral = unhex(n.toString(16).padStart(width * 2, '0'));
        const secret    = curve.getSharedSecret(ephemeral, theirs, true).slice(1);
        if (secret[0] === 0)
            return { ephemeral, secret };
    }
}

const p256Zero = zeroLeading(p256, fill(32, 0x22));

/**
 * A station's key-agreement key in two generations, as tools/CertificateCorpus
 * minted them: keyUsage keyAgreement only, the renewed certificate overlapping
 * the old one. x5t is the COSE_CertHash of the DER — SHA-256, algorithm -16.
 */
const corpus       = JSON.parse(readFileSync(join(root, 'vectors', 'cose-x509-corpus.json'), 'utf8'));
const station      = name => {
    const d           = corpus.privateKeys[name].keyD;
    const certificate = corpus.certificates[name];
    if (corpus.privateKeys[name].curve !== 'P-256')
        throw new Error(`The corpus key ${name} is not on P-256.`);
    return { d, certificate, publicKey: p256.getPublicKey(unhex(d), false),
             x5t: cbor.array([cbor.int(-16), cbor.bytes(sha256(unhex(certificate)))]) };
};
const stationOld   = station('stationKeyAgreement');
const stationNew   = station('stationKeyAgreementRenewed');
const x5tEphemeral = fill(32, 0x11);
const x5tEphemeralPublic = p256.getPublicKey(x5tEphemeral, false);
const x5tEphemeralKey    = ec2Key(1, x5tEphemeralPublic.slice(1, 33), x5tEphemeralPublic.slice(33));
const agreeWith    = publicKey => p256.getSharedSecret(x5tEphemeral, publicKey, true).slice(1);

// Addressed to the renewed key, named by the renewed certificate.
const x5tSecret    = agreeWith(stationNew.publicKey);
const x5tMessage   = directMessage({ secret: x5tSecret, ephemeralKey: x5tEphemeralKey, x5t: stationNew.x5t, iv, payload });

// Encrypted for the OLD key, but naming the renewed certificate: nothing
// authenticates a recipient's unprotected bucket — the Enc_structure covers
// the body's protected bucket, COSE_KDF_Context the recipient's PROTECTED one
// — so this is a message anybody can write. It opens for whoever tries the
// old key regardless of the thumbprint, and for nobody who reads it.
const passedOver   = directMessage({ secret: agreeWith(stationOld.publicKey), ephemeralKey: x5tEphemeralKey,
                                     x5t: stationNew.x5t, iv, payload });

/**
 * ECDH-ES on X25519 delivering a ChaCha20/Poly1305 key: no published example
 * combines the two, so the generator supplies what it can supply on its own.
 */
const chachaSecret  = x25519.getSharedSecret(fill(32, 0x11), x25519.getPublicKey(fill(32, 0x22)));
const chachaMessage = directMessage({ secret: chachaSecret, ephemeralKey: okpKey(4, x25519.getPublicKey(fill(32, 0x11))),
                                      kid: utf8('end-to-end'), iv, payload,
                                      content: 'ChaCha20/Poly1305', keyLength: 32 });
const p521Zero = zeroLeading(p521, concat(Uint8Array.of(0x01), fill(65, 0x22)));

// The invalid-curve point: (x0, 0) lies on y² = x³ − 3x + b′ for
// b′ = −(x0³ − 3x0), a curve sharing P-256's a but not its b, where it has
// order two. An implementation that never consults b and never checks the
// point computes d·Q = Q for an odd d, so its secret is x0 — and the message
// below is encrypted under the key that secret derives.
const P256_P   = 0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFFn;
const P256_B   = 0x5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604Bn;
const x0       = 5n;
const mod      = n => ((n % P256_P) + P256_P) % P256_P;
if (mod(x0 ** 3n - 3n * x0 + P256_B) === 0n)
    throw new Error('x0 happens to lie on P-256 itself');
const x0Bytes  = unhex(x0.toString(16).padStart(64, '0'));
const oddKey   = '22'.repeat(31) + '23';
const invalid  = directMessage({ secret: x0Bytes, ephemeralKey: ec2Key(1, x0Bytes, fill(32, 0)),
                                 kid: utf8('invalid-curve'), iv, payload });

// Small-order X25519 points: u = 0 and u = 1 both send every product to the
// all-zero secret, which is what a ladder computes when nothing checks it.
// u = 0 is the obvious one; u = 1 is the one an input check for zero misses
// and RFC 7748 §6.1's check of the OUTPUT catches.
const smallOrder = u => directMessage({ secret: fill(32, 0),
                                        ephemeralKey: okpKey(4, unhex(u.toString(16).padStart(2, '0') + '00'.repeat(31))),
                                        kid: utf8(`small-order-${u}`), iv, payload });

const cases = [

    anchored('ecdh-direct-p256-cose-wg', 'p256-hkdf-256-01',
        'ECDH-ES + HKDF-256 on P-256, from the COSE working group\'s example p256-hkdf-256-01: the content key is agreed with the recipient\'s public key rather than shared beforehand, and IS the derived key, so the message may have only this one recipient. The published secret, COSE_KDF_Context, content key and message are all checked — values that no agreement between the two implementations can supply, which is the condition FINDINGS §12 set. Its context is the one RFC 9052 Appendix C.3.1 prints: AlgorithmID is the content algorithm (A128GCM), never the ECDH algorithm.'),

    anchored('ecdh-direct-x25519-cose-wg', 'x25519-hkdf-256-direct',
        'The same on X25519 [RFC 7748], from the working group\'s example x25519-hkdf-256-direct. An X25519 key is one u-coordinate of 32 bytes, as an Ed25519 key is 32 bytes, and reading one as the other is what this case catches first.'),

    anchored('ecdh-key-wrap-p521-mac-cose-wg', 'p521-wrap-256-03',
        'ECDH-ES + A256KW on P-521 delivering an HMAC 512/512 key to a COSE_Mac, from the working group\'s example p521-wrap-256-03: the agreed key wraps the content key rather than being it, so AlgorithmID is A256KW. Two details of that example are reproduced on purpose: its generator kept the low 521 bits of the 66 random bytes it drew for the ephemeral key, and it sends a key identifier other than the recipient key\'s own.'),

    {
        id: 'ecdh-direct-p256-zero-leading-secret', class: 'normative', shape: 'encrypt',
        description: 'A key pair found by searching: the shared x-coordinate on P-256 begins with a zero byte. The secret is that coordinate through I2OSP, left-padded to 32 bytes; an implementation taking it from a big-integer library that strips leading zeros derives a different key here and only here — about one message in 256 — which a set of fixed vectors would pass 255 times out of 256.',
        algorithm: 'A128GCM', iv: hex(iv), payload: hex(payload),
        recipients: [{ algorithm: 'ECDH-ES + HKDF-256', curve: 'P-256', key: hex(fill(32, 0x22)),
                       ephemeral: hex(p256Zero.ephemeral), keyIdentifier: hex(utf8('zero-leading')) }],
        secretLength: 32, secretLeadsWithZero: true,
    },

    {
        id: 'ecdh-key-wrap-p521-zero-leading-secret', class: 'normative', shape: 'encrypt',
        description: 'The same trap on P-521, where it is not rare at all: the top byte of the 66-byte coordinate carries a single bit, so roughly every second secret begins with a zero byte. An implementation that strips it fails half its P-521 messages, here through key wrap.',
        algorithm: 'A256GCM', key: cek256, iv: hex(iv), payload: hex(payload),
        recipients: [{ algorithm: 'ECDH-ES + A128KW', curve: 'P-521', key: hex(concat(Uint8Array.of(0x01), fill(65, 0x22))),
                       ephemeral: hex(p521Zero.ephemeral), keyIdentifier: hex(utf8('zero-leading-521')) }],
        secretLength: 66, secretLeadsWithZero: true,
    },

    {
        id: 'ecdh-direct-x448-hkdf512', class: 'normative', shape: 'encrypt',
        description: 'ECDH-ES + HKDF-512 on X448, which no published example covers: the 56-byte keys of RFC 7748, and HKDF over SHA-512 deriving a 192-bit content key.',
        algorithm: 'A192GCM', iv: hex(iv), payload: hex(payload),
        recipients: [{ algorithm: 'ECDH-ES + HKDF-512', curve: 'X448', key: hex(fill(56, 0x22)),
                       ephemeral: hex(fill(56, 0x11)), keyIdentifier: hex(utf8('x448-recipient')) }],
    },

    {
        id: 'ecdh-direct-x25519-chacha20poly1305', class: 'normative', shape: 'encrypt',
        description: 'ECDH-ES + HKDF-256 on X25519 delivering a 256-bit ChaCha20/Poly1305 key directly: two things EVQI Transport §7.2 names for encrypting end to end through a Local Controller — ECDH-ES + HKDF-256 to reach the one recipient, ChaCha20-Poly1305 as one of the two AEADs — here combined. COSE_KDF_Context names the content algorithm, 24, and asks for 256 bits — the place a mistake shared by both sides would hide, because a context built wrongly on both sides still opens. No published example combines ECDH-ES with ChaCha20/Poly1305, so the expected secret, context, key and message are the generator\'s own, computed from the noble primitives through the same hand-written CBOR that must reproduce p256-hkdf-256-01 before anything is written, with ChaCha20/Poly1305 held to RFC 8439 Section 2.8.2 first. That makes them independent of both implementations, not published by anyone.',
        algorithm: 'ChaCha20/Poly1305', iv: hex(iv), payload: hex(payload),
        recipients: [{ algorithm: 'ECDH-ES + HKDF-256', curve: 'X25519', key: hex(fill(32, 0x22)),
                       ephemeral: hex(fill(32, 0x11)), keyIdentifier: hex(utf8('end-to-end')) }],
        computedBy:      'tools/EcdhCases',
        expectedSecret:  hex(chachaSecret),
        expectedContext: hex(chachaMessage.context),
        expectedKey:     hex(chachaMessage.cek),
        expectedMessage: hex(chachaMessage.message),
    },

    {
        id: 'ecdh-direct-p256-x5t', class: 'normative', shape: 'encrypt',
        description: 'ECDH-ES + HKDF-256 on P-256 to a recipient named by its certificate: the recipient structure carries x5t (RFC 9360, header parameter 34) — the SHA-256 COSE_CertHash of the station\'s renewed key-agreement certificate from tools/CertificateCorpus — and no kid, which is how EVQI Transport §6.8 addresses a recipient that holds more than one key during a renewal. The thumbprint, secret, context, key and message are computed by this generator; each implementation must also confirm that the certificate certifies the receiving key, open the other\'s message given that certificate, and open it without one, since a caller who names no certificate must see no change. Note what x5t is: a selector, not a protected statement. It sits in the unprotected bucket, nothing authenticates it, and a matching thumbprint proves nothing — it only says which key to use. Read as evidence of anything, it is a vulnerability.',
        algorithm: 'A128GCM', iv: hex(iv), payload: hex(payload),
        recipients: [{ algorithm: 'ECDH-ES + HKDF-256', curve: 'P-256', key: stationNew.d,
                       ephemeral: hex(x5tEphemeral), certificate: stationNew.certificate }],
        computedBy:         'tools/EcdhCases',
        expectedSecret:     hex(x5tSecret),
        expectedContext:    hex(x5tMessage.context),
        expectedKey:        hex(x5tMessage.cek),
        expectedMessage:    hex(x5tMessage.message),
        expectedThumbprint: hex(stationNew.x5t),
    },

    {
        id: 'ecdh-key-wrap-brainpool', class: 'normative', shape: 'encrypt',
        description: 'ECDH-ES + A128KW on brainpoolP256r1, the curve of the meter certificates this project turns on, which no published example covers.',
        algorithm: 'A256GCM', key: cek256, iv: hex(iv), payload: hex(payload),
        recipients: [{ algorithm: 'ECDH-ES + A128KW', curve: 'brainpoolP256r1', key: hex(fill(32, 0x22)),
                       ephemeral: hex(fill(32, 0x11)), keyIdentifier: hex(utf8('meter-recipient')) }],
    },

    {
        id: 'ecdh-direct-salt-and-parties', class: 'normative', shape: 'encrypt',
        description: 'ECDH-ES + HKDF-256 on X25519 with an HKDF salt and both parties named: PartyU with an identity and an integer nonce, PartyV with an identity and other information. All of it travels in the recipient\'s headers (-20 to -26) and all of it enters COSE_KDF_Context, so a receiver that read one field differently derives another key and opens nothing. No published example carries any of it.',
        algorithm: 'A128GCM', iv: hex(iv), payload: hex(payload),
        recipients: [{ algorithm: 'ECDH-ES + HKDF-256', curve: 'X25519', key: hex(fill(32, 0x22)),
                       ephemeral: hex(fill(32, 0x11)), keyIdentifier: hex(utf8('salted')),
                       salt: hex(utf8('salt')),
                       partyU: { identity: hex(utf8('lighting-client')), nonce: 7 },
                       partyV: { identity: hex(utf8('lighting-server')), other: '0102' } }],
    },

    {
        id: 'ecdh-two-recipients', class: 'normative', shape: 'encrypt',
        description: 'Two ECDH-ES key-wrap recipients on different curves — A128KW on P-384 and A256KW on secp256k1 — each receiving the one content key through a key agreed with it alone. Only key wrap allows this; a directly agreed key belongs to one recipient. The message is opened with the first recipient\'s key.',
        algorithm: 'A256GCM', key: cek256, iv: hex(iv), payload: hex(payload),
        recipients: [
            { algorithm: 'ECDH-ES + A128KW', curve: 'P-384',     key: hex(fill(48, 0x22)), ephemeral: hex(fill(48, 0x11)), keyIdentifier: hex(utf8('first')) },
            { algorithm: 'ECDH-ES + A256KW', curve: 'secp256k1', key: hex(fill(32, 0x33)), ephemeral: hex(fill(32, 0x44)), keyIdentifier: hex(utf8('second')) },
        ],
    },

    {
        id: 'ecdh-mac-direct-p384', class: 'normative', shape: 'mac',
        description: 'ECDH-ES + HKDF-256 delivering an HMAC 384/384 key directly to a COSE_Mac on P-384. The derived key is as wide as the hash, 48 bytes — what the published examples derive for HMAC 512/512, and what RFC 9053 Section 3.1 asks an HMAC key to be.',
        algorithm: 'HMAC 384/384', payload: hex(payload),
        recipients: [{ algorithm: 'ECDH-ES + HKDF-256', curve: 'P-384', key: hex(fill(48, 0x22)),
                       ephemeral: hex(fill(48, 0x11)), keyIdentifier: hex(utf8('mac-recipient')) }],
    },

    {
        id: 'ecdh-refuses-invalid-curve-point', class: 'normative', shape: 'encrypt', expected: 'reject',
        reason: 'the ephemeral point does not lie on P-256',
        description: 'An invalid-curve attack on the static recipient key. The ephemeral point (5, 0) is not on P-256 but on a curve sharing its a and not its b, where it has order two; the recipient key is odd, so an implementation that neither checks the point nor consults b computes the point itself as the product and 5 as the secret — and this message is encrypted under the key that secret derives. It opens for exactly the implementation that skipped the check; repeated with points of other small orders, that oracle hands over the static private key. RFC 9053 §6.3.1.1 names a check without making it a MUST. Both implementations must refuse.',
        algorithm: 'A128GCM', payload: hex(payload), message: hex(invalid.message),
        recipients: [{ algorithm: 'ECDH-ES + HKDF-256', curve: 'P-256', key: oddKey, keyIdentifier: hex(utf8('invalid-curve')) }],
    },

    {
        id: 'ecdh-refuses-x25519-zero-point', class: 'normative', shape: 'encrypt', expected: 'reject',
        reason: 'the ephemeral X25519 key is the point u = 0, whose secret is all zeroes',
        description: 'An ephemeral X25519 key of u = 0. Every product with it is zero, so the secret is known to everybody — and the message is encrypted under the key that zero secret derives, so it opens for an implementation that does not check. OKP has no point validation in RFC 9053; RFC 7748 §6.1\'s check of the output for all zeroes is the substitute. Both implementations must refuse.',
        algorithm: 'A128GCM', payload: hex(payload), message: hex(smallOrder(0).message),
        recipients: [{ algorithm: 'ECDH-ES + HKDF-256', curve: 'X25519', key: hex(fill(32, 0x22)), keyIdentifier: hex(utf8('small-order-0')) }],
    },

    {
        id: 'ecdh-refuses-x25519-small-order-point', class: 'normative', shape: 'encrypt', expected: 'reject',
        reason: 'the ephemeral X25519 key is the point u = 1, of small order, whose secret is all zeroes',
        description: 'The same with u = 1, a point of small order that is not zero: an implementation that checks its INPUT for zero lets it through, one that checks the OUTPUT as RFC 7748 §6.1 says does not. The secret is again all zeroes and the message opens for whoever did not look. Both implementations must refuse.',
        algorithm: 'A128GCM', payload: hex(payload), message: hex(smallOrder(1).message),
        recipients: [{ algorithm: 'ECDH-ES + HKDF-256', curve: 'X25519', key: hex(fill(32, 0x22)), keyIdentifier: hex(utf8('small-order-1')) }],
    },

    {
        id: 'ecdh-refuses-recipient-naming-another-certificate', class: 'normative', shape: 'encrypt', expected: 'reject',
        reason: 'the recipient names a certificate by x5t that is not the one of the key in hand (EVQI Transport §6.8)',
        description: 'A station during a renewal: it holds its old key-agreement key with the old certificate, and this recipient names the RENEWED certificate by x5t. EVQI Transport §6.8: the recipient "refuses a thumbprint that matches none of its certificates instead of trying its keys in turn" — stated, not recommended, so this is normative. The message is encrypted for the OLD key all the same, which anybody can arrange, since nothing authenticates a recipient\'s unprotected bucket: an implementation that ignores the thumbprint tries the old key, derives the right content key and opens it. Opening is therefore the one wrong answer, and no error text is judged. The control beside it: the same message, opened with the same key and no certificate, must open — otherwise a refusal here would prove nothing. x5t is a selector, not a protected statement.',
        algorithm: 'A128GCM', payload: hex(payload), message: hex(passedOver.message),
        recipients: [{ algorithm: 'ECDH-ES + HKDF-256', curve: 'P-256', key: stationOld.d,
                       certificate: stationOld.certificate }],
    },

];

writeFileSync(join(root, 'vectors', 'cose-ecdh.json'), JSON.stringify({
    suite: 'cose-ecdh',
    description: 'ECDH-ES with HKDF [RFC 9053, Section 6.3]: a content key reaching a party whose public key is all the sender knows, either as the derived key itself (ECDH-ES + HKDF-256, -512) or wrapped by it (ECDH-ES + A128KW, A192KW, A256KW). These cases run through the cose-encrypt machinery — each produced by both implementations, compared, and handed to the other to open — and add what FINDINGS §12 asked of any ECDH-ES here: third-party values no agreement can supply — published by the COSE working group where an example exists, computed by the generator where none does, and labelled accordingly — a shared secret that begins with a zero byte on purpose, and points that must be refused rather than merely disagreed about. The ephemeral key is given rather than drawn, the second departure from default settings after deterministic signing and for the same reason: the bytes would otherwise be incomparable. Generated by tools/EcdhCases, which depends on neither implementation. Note what a passing case does NOT establish: an encrypted message says nothing about who sent it, and ECDH-ES in particular authenticates nobody — the static-static variants that would tell the recipient who sent it are implemented on neither side. Every key is printed in this file and secures nothing.',
    cases,
}, null, 4) + '\n');

console.log(`${cases.length} cases -> vectors/cose-ecdh.json`);
