/*
 * Generates vectors/cose-x509-messages.json, so that it can be regenerated and
 * diffed rather than believed:
 *
 *     npm --prefix tools/X509Cases ci
 *     node tools/X509Cases/generate.mjs
 *
 * Why a generator at all, when the x509 suite builds its own messages through
 * the implementations under test: because these messages cannot be built that
 * way. A certificate thumbprint must name a hash algorithm — COSE.TS refuses
 * anything else in `CoseCertificateHash` (aec9823), Styx in
 * `COSECertificateHash.IsHashAlgorithm` — and a rule both sides enforce on the
 * way out is a rule neither side can be asked to violate on the way in. The
 * generative form of vectors/cose-x509.json therefore cannot reach it, and the
 * rule had no row anywhere: each implementation checked it against itself, in
 * its own unit tests, and nothing compared the two.
 *
 * So the message is assembled here, by hand, from the noble primitives and
 * nothing above them: the CBOR, the COSE_Sign1 structure, the Sig_structure
 * and the x5t header are written out below, and the signature is brainpool
 * ECDSA over the bytes this file builds. Neither implementation contributes
 * anything.
 *
 * It writes four messages that differ in one CBOR integer:
 *
 *   - three whose x5t names an algorithm that is not a hash — a signature one,
 *     a MAC one and a key-derivation one. Each carries the *correct*
 *     SHA-256 digest of the end-entity certificate, which is what makes the
 *     refusal measurable: an implementation that reads the digest and computes
 *     SHA-256 regardless of the label finds a match and verifies the message.
 *     ES256, HMAC 256/256 and ECDH-ES + HKDF-256 all name SHA-256 for their
 *     own purposes, so the three also separate an implementation that asks
 *     "does this algorithm have a digest" from one that asks "is this
 *     algorithm a hash" — the first accepts all three.
 *   - one whose x5t names SHA-256, which must verify. Without it the three
 *     refusals would prove nothing: a message that verifies for nobody is
 *     refused by everybody, whatever they check. This one is not merely a
 *     control the generator vouches for — its bytes are the bytes both
 *     implementations already produce and agree on for
 *     `cose-x509:thumbprint-names-the-certificate`, and this generator stops
 *     unless it reproduces them exactly. The three refusals are therefore
 *     anchored in two independent implementations and not in this file.
 *
 * The certificates and the signing key are not written here: the chain, the
 * anchor and the end-entity key come from vectors/cose-x509-corpus.json, which
 * tools/CertificateCorpus owns, so that a certificate has one owner rather
 * than two that must remember to agree.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join }               from 'node:path';
import { fileURLToPath }               from 'node:url';

import { brainpoolP256r1 }             from '@noble/curves/misc.js';
import { sha256 }                      from '@noble/hashes/sha2.js';


const root      = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const corpus    = JSON.parse(readFileSync(join(root, 'vectors', 'cose-x509-corpus.json'), 'utf8'));

const hex       = h => Uint8Array.from(Buffer.from(h, 'hex'));
const upper     = b => Buffer.from(b).toString('hex').toUpperCase();
const concat    = (...parts) => Uint8Array.from(Buffer.concat(parts.map(Buffer.from)));


// ----------------------------------------------------------------- the CBOR --

/** A head of major type `mt` with argument `value`, in the shortest form. */
function head(mt, value) {
    const major = mt << 5;
    if (value < 24)          return Uint8Array.from([major | value]);
    if (value < 0x100)       return Uint8Array.from([major | 24, value]);
    if (value < 0x10000)     return Uint8Array.from([major | 25, value >> 8, value & 0xFF]);
    return Uint8Array.from([major | 26, (value >>> 24) & 0xFF, (value >>> 16) & 0xFF,
                                        (value >>>  8) & 0xFF,  value        & 0xFF]);
}

const int       = n     => n < 0 ? head(1, -1 - n) : head(0, n);
const bstr      = bytes => concat(head(2, bytes.length), bytes);
const tstr      = text  => { const b = Buffer.from(text, 'utf8'); return concat(head(3, b.length), b); };
const array     = items => concat(head(4, items.length), ...items);
const map       = pairs => concat(head(5, pairs.length), ...pairs.flat());


// ------------------------------------------------------- the COSE structures --

/** The algorithms the four messages label their thumbprint with. */
const LABELS = [
    {
        id:          'thumbprint-labelled-with-sha-256',
        algorithm:   -16,
        name:        'SHA-256',
        expected:    'accept',
        description: 'The control, and the one of these four messages that neither implementation ' +
                     'refuses: the x5t header names SHA-256, the hash algorithm the digest beside ' +
                     'it was computed with. Its bytes are not this generator\'s word for what a ' +
                     'sound message looks like — they are byte for byte the message both ' +
                     'implementations produce and agree on for ' +
                     '`cose-x509:thumbprint-names-the-certificate`, and the generator refuses to ' +
                     'write this file unless it reproduces them. Without this row the three ' +
                     'refusals beside it would prove nothing: a message that verifies for nobody ' +
                     'is refused by everybody, whatever they check.',
    },
    {
        id:          'thumbprint-labelled-with-a-signature-algorithm',
        algorithm:   -7,
        name:        'ES256',
        expected:    'reject',
        reason:      'x5t carries a hash, and ES256 is a signature algorithm, not a hash algorithm',
        description: 'The same message, with one CBOR integer changed: the x5t header labels the ' +
                     'thumbprint ES256. The digest beside it is still the correct SHA-256 of the ' +
                     'end-entity certificate, so an implementation that reads the digest and ' +
                     'computes SHA-256 without looking at the label finds a match and verifies ' +
                     'the message — which is what makes refusing it a measurable answer rather ' +
                     'than the only possible one. ES256 names SHA-256 for the signature it makes, ' +
                     'and RFC 9360 §2 gives x5t a hash; a thumbprint that named ES256 would claim ' +
                     'a computation nobody performed. No error text is judged: failing to read ' +
                     'the message counts as refusing it, and verifying it is the one wrong answer.',
    },
    {
        id:          'thumbprint-labelled-with-a-mac-algorithm',
        algorithm:   5,
        name:        'HMAC 256/256',
        expected:    'reject',
        reason:      'x5t carries a hash, and HMAC 256/256 is a MAC algorithm, not a hash algorithm',
        description: 'The same message again, labelling the thumbprint HMAC 256/256. It stands ' +
                     'beside the ES256 row rather than duplicating it: HMAC 256/256 also names ' +
                     'SHA-256, for the tag it computes, so an implementation that refuses only ' +
                     'signature algorithms passes the row before this one and fails here. The ' +
                     'digest is again the correct SHA-256 of the end-entity certificate.',
    },
    {
        id:          'thumbprint-labelled-with-a-key-derivation-algorithm',
        algorithm:   -25,
        name:        'ECDH-ES + HKDF-256',
        expected:    'reject',
        reason:      'x5t carries a hash, and ECDH-ES + HKDF-256 is a key agreement algorithm, ' +
                     'not a hash algorithm',
        description: 'The third of the same message, labelling the thumbprint ECDH-ES + HKDF-256. ' +
                     'It names SHA-256 for the key derivation it performs, so the three rows ' +
                     'together separate an implementation that asks whether an algorithm has a ' +
                     'digest — which all three do — from one that asks whether it is a hash ' +
                     'algorithm, which is what RFC 9054 registers and what both implementations ' +
                     'check. The first kind verifies all three messages.',
    },
];


/**
 * One COSE_Sign1 over the metrological value, carrying the chain and a
 * thumbprint labelled with `algorithm`.
 *
 * The protected bucket holds the algorithm, the chain and the thumbprint, in
 * that order, and the signature covers all of it — x5t sits where the x509
 * suite puts it, so these messages differ from the ones that suite builds in
 * the label alone.
 */
function sign1(algorithm, { payload, chain, signingKey, digest }) {

    const protectedBucket = bstr(map([
        [int(1),  int(ESB256)],
        [int(33), array(chain.map(bstr))],
        [int(34), array([int(algorithm), bstr(digest)])],
    ]));

    // Sig_structure [RFC 9052, Section 4.4]: the context string, the body's
    // protected bucket, the externally supplied data (none) and the payload.
    const toBeSigned = array([
        tstr('Signature1'),
        protectedBucket,
        bstr(new Uint8Array(0)),
        bstr(payload),
    ]);

    // ESB256 is ECDSA with brainpoolP256r1 over SHA-256, and the digest is
    // taken here rather than left to the library, so that `prehash: false`
    // says what is being signed. `lowS: false` is not a preference either:
    // RFC 9053 §2.1 carries r and s as they come out, and normalising s to the
    // lower half is a Bitcoin convention that would put a different signature
    // on the wire.
    const digestToSign = sha256(toBeSigned);
    const signature    = brainpoolP256r1.sign(digestToSign, signingKey,
                                              { prehash: false, lowS: false });

    if (!brainpoolP256r1.verify(signature, digestToSign,
                                brainpoolP256r1.getPublicKey(signingKey, false),
                                { prehash: false, lowS: false }))
        throw new Error('the signature this generator just made does not verify');

    // COSE_Sign1 is tag 18 around [protected, unprotected, payload, signature].
    return concat(Uint8Array.from([0xD2]),
                  array([protectedBucket, map([]), bstr(payload), bstr(signature)]));

}


// --------------------------------------------------------------- the writing --

/** ECDSA with brainpoolP256r1 and SHA-256, as the corpus names it. */
const ESB256 = -265;

/**
 * What the control has to come out as: the message both implementations
 * produce for `cose-x509:thumbprint-names-the-certificate`, 835 bytes long.
 * Recompute it with
 *
 *     node -e "const r=require('./results/csharp.json').results; \
 *              console.log(require('crypto').createHash('sha256') \
 *                  .update(Buffer.from(r['cose-x509:thumbprint-names-the-certificate'] \
 *                  .message.hex,'hex')).digest('hex').toUpperCase())"
 *
 * after a suite run. A pin, not a convenience: if either implementation ever
 * writes that message differently, this generator stops instead of quietly
 * anchoring four cases in bytes nobody else produces any more.
 */
const CONTROL = 'B32E1152680CCD4F6AA6EF9D974E785E3C35948BCDE59478148E6BABD7405158';

const source = {
    // The payload, chain and anchor of `cose-x509:thumbprint-names-the-certificate`,
    // so that the four messages differ from a case the suite already measures in
    // the thumbprint's label and in nothing else.
    payload:    hex('D9ACDC84C482221A0012D6870203A401C48220187B020203C48221185F0401'),
    chain:      [hex(corpus.certificates.meter), hex(corpus.certificates.manufacturerCA)],
    signingKey: hex(corpus.privateKeys.meter.keyD),
};

if (corpus.privateKeys.meter.algorithm !== 'ESB256')
    throw new Error(`the corpus signs with ${corpus.privateKeys.meter.algorithm}, not ESB256`);

const digest = sha256(source.chain[0]);

if (upper(digest) !== upper(sha256(hex(corpus.certificates.meter))))
    throw new Error('the digest is not the hash of the certificate in the corpus');

const cases = LABELS.map(entry => {

    const message = sign1(entry.algorithm, { ...source, digest });

    return {
        id:                   entry.id,
        class:                'normative',
        message:              upper(message),
        trustAnchors:         ['metrologyRoot'],
        expected:             entry.expected,
        ...(entry.reason ? { reason: entry.reason } : {}),
        thumbprintAlgorithm:  `${entry.algorithm} (${entry.name})`,
        computedBy:           'tools/X509Cases',
        description:          entry.description,
    };

});

const control = cases.find(c => c.expected === 'accept');

if (upper(sha256(hex(control.message))) !== CONTROL)
    throw new Error('the control message is not the one both implementations produce for ' +
                    'cose-x509:thumbprint-names-the-certificate — refusing to write');

/**
 * Read the thumbprint back out of a finished message.
 *
 * The digest has to be *in* the bytes, not merely in the variable the encoder
 * was handed: a thumbprint that did not match the certificate would be refused
 * for the wrong reason, and the row would still be green. x5t is header label
 * 34, `18 22`, followed by a two-element array.
 */
function thumbprintIn(message) {

    const at = Buffer.from(message).indexOf(Buffer.from([0x18, 0x22, 0x82]));

    if (at < 0)
        throw new Error('no x5t header in the message');

    let p         = at + 3;
    const major   = message[p] >> 5;
    const info    = message[p] & 31;
    const value   = info < 24 ? (p += 1, info) : (p += 2, message[p - 1]);
    const algorithm = major === 1 ? -1 - value : value;

    if (message[p] !== 0x58 || message[p + 1] !== 0x20)
        throw new Error('the thumbprint beside the label is not a 32-byte string');

    return { algorithm, digest: message.slice(p + 2, p + 34) };

}

// Every refusal has to be a refusal of something sound, and of one thing only.
// Each message is read back: the label has to be the one the case claims, and
// the digest beside it the true hash of the end-entity certificate — the
// property that makes a skipped check verify the message rather than stumble
// over a thumbprint that was wrong anyway.
for (const entry of cases) {

    const read = thumbprintIn(hex(entry.message));

    if (!entry.thumbprintAlgorithm.startsWith(`${read.algorithm} `))
        throw new Error(`${entry.id} carries the label ${read.algorithm}, not the one it claims`);

    if (upper(read.digest) !== upper(digest))
        throw new Error(`${entry.id} does not carry the hash of the end-entity certificate`);

}

writeFileSync(join(root, 'vectors', 'cose-x509-messages.json'),
              JSON.stringify({
                  suite:       'cose-x509-messages',
                  description: 'Signed messages that carry a header neither implementation will ' +
                               'construct: a certificate thumbprint labelled with an algorithm ' +
                               'that is not a hash algorithm. Generated by tools/X509Cases from ' +
                               'the noble primitives alone; the chain and the signing key come ' +
                               'from cose-x509-corpus.json.',
                  cases,
              }, null, 4) + '\n',
              'utf8');

console.log(`vectors/cose-x509-messages.json: ${cases.length} cases`);
for (const entry of cases)
    console.log(`  ${entry.expected === 'accept' ? 'verifies' : 'refused '}  ` +
                `x5t ${entry.thumbprintAlgorithm.padEnd(26)} ${hex(entry.message).length} bytes`);
console.log(`  the control reproduces the message both implementations produce (sha256 ${CONTROL.slice(0, 16)}…)`);
