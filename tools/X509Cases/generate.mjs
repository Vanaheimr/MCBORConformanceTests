/*
 * Generates vectors/cose-x509-messages.json, so that it can be regenerated and
 * diffed rather than believed:
 *
 *     npm --prefix tools/X509Cases ci
 *     node tools/X509Cases/generate.mjs
 *
 * Why a generator at all, when the x509 suite builds its own messages through
 * the implementations under test: because these messages cannot be built that
 * way. Each family below turns on a rule an implementation enforces when it
 * writes a message, and a rule enforced on the way out is a rule that side
 * cannot be asked to violate on the way in. So the messages are assembled
 * here, by hand, from the noble primitives and nothing above them: the CBOR,
 * the COSE_Sign1 structure, the Sig_structure, the x5chain and x5t headers and
 * the certificates' DER are written out below, and the signature is brainpool
 * ECDSA over the bytes this file builds. Neither implementation contributes
 * anything.
 *
 * Two families, and a control at the head of each whose bytes are not this
 * generator's word for a sound message but byte for byte a message both
 * implementations already produce and agree on:
 *
 * 1. A certificate thumbprint labelled with an algorithm that is not a hash
 *    algorithm. COSE.TS refuses to construct one in `CoseCertificateHash`
 *    (aec9823), Styx in `COSECertificateHash.IsHashAlgorithm`, and the rule
 *    had no row anywhere: each side checked it against itself, in its own unit
 *    tests, and nothing compared the two. Three refusals rather than one,
 *    because ES256, HMAC 256/256 and ECDH-ES + HKDF-256 all name SHA-256 for
 *    their own purposes, so the three separate an implementation that asks
 *    "does this algorithm have a digest" from one that asks "is this a hash
 *    algorithm" — the first accepts all three. Each carries the *correct*
 *    SHA-256 digest of the end-entity certificate, which is what makes the
 *    refusal measurable: a skipped label check finds a match and verifies.
 *    §24 of FINDINGS.md.
 *
 * 2. A certificate that is not DER. RFC 5280 §4.1 requires DER and RFC 9360 §2
 *    takes x5t over that encoding, and an implementation sends what its own
 *    library encodes, so neither side can be asked to send anything else.
 *    Every tampering here stays *outside* the TBSCertificate, so the issuer's
 *    signature over those bytes still holds and a lenient parser accepts the
 *    certificate and walks the chain to the anchor exactly as if nothing had
 *    happened. §25 measured four such encodings as accepted by Styx and
 *    refused by COSE.TS, and the second order besides: which bytes x5t then
 *    covers. Styx f1057ea8 settles it by requiring Bouncy Castle's encoding of
 *    a certificate to be the bytes it arrived as, and COSE.TS refused all four
 *    from the start. These rows are `survey`: both verdicts recorded side by
 *    side every run, nothing required of either side, because what a reader
 *    must do with an encoding that is not DER is the specification's to say and
 *    not this suite's. §25 of FINDINGS.md.
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

/** ECDSA with brainpoolP256r1 and SHA-256, as the corpus names it. */
const ESB256 = -265;


/**
 * One COSE_Sign1 over the metrological value, carrying the chain and, when one
 * is given, a thumbprint.
 *
 * The protected bucket holds the algorithm, the chain and the thumbprint, in
 * that order, and the signature covers all of it — x5chain and x5t sit where
 * the x509 suite puts them, so these messages differ from the ones that suite
 * builds in a certificate's encoding or in the thumbprint's label, and in
 * nothing else.
 */
function sign1({ payload, chain, signingKey, thumbprint }) {

    const protectedBucket = bstr(map([
        [int(1),  int(ESB256)],
        [int(33), array(chain.map(bstr))],
        ...(thumbprint
                ? [[int(34), array([int(thumbprint.algorithm), bstr(thumbprint.digest)])]]
                : []),
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


// ------------------------------------------------- reading a message back in --

/**
 * One CBOR head, for the shapes this generator writes.
 *
 * Every message is read back below rather than trusted, because each refusal
 * has to be a refusal of one thing: a case whose header carried something
 * other than what it claims would be refused for the wrong reason, and its row
 * would be green all the same.
 */
function readHead(bytes, at) {

    const major = bytes[at] >> 5;
    const info  = bytes[at] & 31;

    if (info < 24)   return { major, value: info,         next: at + 1 };
    if (info === 24) return { major, value: bytes[at + 1], next: at + 2 };
    if (info === 25) return { major, value: (bytes[at + 1] << 8) | bytes[at + 2],
                              next: at + 3 };

    throw new Error(`a head with additional information ${String(info)} is not one this ` +
                    'generator writes');

}


/** Where the item at `at` ends. */
function skip(bytes, at) {

    const item = readHead(bytes, at);

    switch (item.major) {
        case 0: case 1: return item.next;
        case 2: case 3: return item.next + item.value;
        case 4: case 5: {
            let p = item.next;
            for (let n = 0; n < item.value * (item.major === 5 ? 2 : 1); n++)
                p = skip(bytes, p);
            return p;
        }
        default: throw new Error(`major type ${String(item.major)} is not one this generator writes`);
    }

}


/** The protected header map of a finished message, by label. */
function protectedHeaders(message) {

    if (message[0] !== 0xD2 || message[1] !== 0x84)
        throw new Error('not a tagged COSE_Sign1 of four elements');

    const bucket = readHead(message, 2);

    if (bucket.major !== 2)
        throw new Error('the protected bucket is not a byte string');

    const bytes = message.subarray(bucket.next, bucket.next + bucket.value);
    const asMap = readHead(bytes, 0);

    if (asMap.major !== 5)
        throw new Error('the protected bucket does not hold a map');

    const headers = new Map();
    let   at      = asMap.next;

    for (let entry = 0; entry < asMap.value; entry++) {

        const key   = readHead(bytes, at);
        const label = key.major === 1 ? -1 - key.value : key.value;
        const from  = key.next;

        at = skip(bytes, from);
        headers.set(label, bytes.subarray(from, at));

    }

    return headers;

}


/** The certificates of the x5chain header (label 33), as they lie in the message. */
function chainIn(message) {

    const header = protectedHeaders(message).get(33);

    if (header === undefined)
        throw new Error('no x5chain header in the message');

    const asArray = readHead(header, 0);

    if (asArray.major !== 4)
        throw new Error('the x5chain header is not an array');

    const certificates = [];
    let   at           = asArray.next;

    for (let n = 0; n < asArray.value; n++) {

        const entry = readHead(header, at);

        if (entry.major !== 2)
            throw new Error('an x5chain entry is not a byte string');

        certificates.push(header.subarray(entry.next, entry.next + entry.value));
        at = entry.next + entry.value;

    }

    return certificates;

}


/** The x5t header (label 34) of a message, or null when it carries none. */
function thumbprintIn(message) {

    const header = protectedHeaders(message).get(34);

    if (header === undefined)
        return null;

    const asArray = readHead(header, 0);

    if (asArray.major !== 4 || asArray.value !== 2)
        throw new Error('the x5t header is not a two-element array');

    const label  = readHead(header, asArray.next);
    const digest = readHead(header, label.next);

    if (digest.major !== 2)
        throw new Error('the thumbprint beside its label is not a byte string');

    return {
        algorithm: label.major === 1 ? -1 - label.value : label.value,
        digest:    header.subarray(digest.next, digest.next + digest.value),
    };

}


// ----------------------------------------------- the certificate's encoding --

/** One definite-length DER record: where its contents start and end. */
function record(bytes, at) {

    const first  = bytes[at + 1];
    const count  = first & 0x7F;
    const from   = at + 2 + ((first & 0x80) ? count : 0);
    const length = (first & 0x80)
                       ? Array.from(bytes.subarray(at + 2, at + 2 + count))
                              .reduce((n, octet) => n * 256 + octet, 0)
                       : first;

    return { tag: bytes[at], from, to: from + length };

}


/**
 * A certificate split where the tamperings below need it.
 *
 * A certificate is SEQUENCE { tbsCertificate, signatureAlgorithm,
 * signatureValue } [RFC 5280, Section 4.1]. Every tampering stays out of the
 * TBSCertificate, so the issuer's signature over those bytes still holds —
 * which is what makes these refusals measurable rather than inevitable: there
 * is nothing wrong with the certificate except how it is written down, and an
 * implementation that does not check the writing accepts it and walks the
 * chain to the anchor.
 */
function parts(certificate) {

    const outer = record(certificate, 0);

    if (certificate[0] !== 0x30 || outer.to !== certificate.length)
        throw new Error('a certificate is one SEQUENCE and nothing after it');

    const body = certificate.subarray(outer.from, outer.to);
    const tbs  = record(body, 0);

    if (body[0] !== 0x30)
        throw new Error('a certificate holds its TBSCertificate first');

    return { body, tbs: body.subarray(0, tbs.to), rest: body.subarray(tbs.to) };

}


/** A two-octet definite length, which is what every certificate here needs. */
const twoOctets = length => Uint8Array.from([0x82, (length >> 8) & 0xFF, length & 0xFF]);


/**
 * The four ways §25 wrote a certificate down that is not DER, keyed by what
 * each one does. All four were accepted by Bouncy Castle before Styx f1057ea8
 * and refused by COSE.TS's own reader (`src/asn1.ts`), which is the divergence
 * these rows now hold closed.
 */
const TAMPERINGS = {

    'a leading zero in its outer length': certificate => {
        const { body } = parts(certificate);
        return concat(Uint8Array.from([0x30, 0x83, 0x00, (body.length >> 8) & 0xFF,
                                       body.length & 0xFF]),
                      body);
    },

    'an indefinite outer length': certificate => {
        const { body } = parts(certificate);
        return concat(Uint8Array.from([0x30, 0x80]), body, Uint8Array.from([0x00, 0x00]));
    },

    'one byte appended after it': certificate =>
        concat(certificate, Uint8Array.from([0x00])),

    'a long-form length in its signatureAlgorithm': certificate => {

        const { tbs, rest } = parts(certificate);
        const algorithm     = record(rest, 0);

        if (rest[0] !== 0x30 || algorithm.from !== 2)
            throw new Error('the signatureAlgorithm is not a SEQUENCE with a short-form length');

        const widened = concat(Uint8Array.from([0x30, 0x81, algorithm.to - algorithm.from]),
                               rest.subarray(algorithm.from, algorithm.to));
        const body    = concat(tbs, widened, rest.subarray(algorithm.to));

        return concat(Uint8Array.from([0x30]), twoOctets(body.length), body);

    },

};


// ----------------------------------------------------------------- the cases --

const source = {
    // The payload, chain and anchor of `cose-x509:chain-to-trusted-root` and of
    // `cose-x509:thumbprint-names-the-certificate`, so that every message below
    // differs from a case the suite already measures in one thing only.
    payload:    hex('D9ACDC84C482221A0012D6870203A401C48220187B020203C48221185F0401'),
    chain:      [hex(corpus.certificates.meter), hex(corpus.certificates.manufacturerCA)],
    signingKey: hex(corpus.privateKeys.meter.keyD),
};

if (corpus.privateKeys.meter.algorithm !== 'ESB256')
    throw new Error(`the corpus signs with ${corpus.privateKeys.meter.algorithm}, not ESB256`);

const digest = sha256(source.chain[0]);

if (upper(digest) !== upper(sha256(hex(corpus.certificates.meter))))
    throw new Error('the digest is not the hash of the certificate in the corpus');


/** The algorithms the first family labels its thumbprint with. */
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
 * The second family: the certificate's own encoding.
 *
 * `at` is the position in the chain that is written down differently — 0 is
 * the end-entity certificate, 1 the certification authority above it. Both
 * appear, because a check that runs only on the certificate a message is about
 * leaves the rest of the chain unread, and the row at position 1 is the one
 * that separates the two.
 *
 * `thumbprint` says what x5t covers, for the two rows that ask the second
 * question: absent for no x5t at all, 'travelled' for the hash of the bytes in
 * the message, 'canonical' for the hash of the certificate as it was minted.
 */
const ENCODINGS = [
    {
        id:          'the-certificate-as-it-was-minted',
        expected:    'accept',
        encoding:    'both certificates as tools/CertificateCorpus minted them',
        description: 'The control of this family, on the same argument as the thumbprint control ' +
                     'above: its bytes are byte for byte the message both implementations ' +
                     'produce and agree on for `cose-x509:chain-to-trusted-root`, and the ' +
                     'generator refuses to write this file unless it reproduces them. So the ' +
                     'refusals below are refusals of a sound message with one certificate written ' +
                     'down differently, and of nothing else — not of a construction this ' +
                     'generator got wrong.',
    },
    {
        id:          'a-leading-zero-in-the-outer-length',
        at:          0,
        tampering:   'a leading zero in its outer length',
        expected:    'reject',
        reason:      'the certificate\'s outer length is `83 00 01 4E`, three octets where two ' +
                     'suffice, and DER writes a length in the fewest octets that hold it',
        description: 'The end-entity certificate, written down with a length that is not DER. ' +
                     'The tampering is outside the TBSCertificate, so the issuer\'s signature ' +
                     'over it still holds and the chain still reaches the anchor: an ' +
                     'implementation that does not check the encoding verifies this message. ' +
                     'Bouncy Castle read it before Styx f1057ea8; COSE.TS refuses it at the ' +
                     'length octets.',
    },
    {
        id:          'an-indefinite-outer-length',
        at:          0,
        tampering:   'an indefinite outer length',
        expected:    'reject',
        reason:      'the certificate is wrapped in `30 80` … `00 00`, which is BER and not DER, ' +
                     'and RFC 5280 §4.1 requires DER',
        description: 'The same certificate with an indefinite length, which is the one tampering ' +
                     'here that a reader cannot start accepting by leaving a check out — it has ' +
                     'to implement BER to get through it at all. That this row opens is therefore ' +
                     'not argued from a mutilated reader but measured on a shipped one: Bouncy ' +
                     'Castle read this certificate, and Styx verified this message, before ' +
                     'f1057ea8.',
    },
    {
        id:          'one-byte-after-the-certificate',
        at:          0,
        tampering:   'one byte appended after it',
        expected:    'reject',
        reason:      'one octet follows the certificate inside the x5chain byte string, and an ' +
                     'x5chain entry carries one certificate and nothing else',
        description: 'The certificate followed by a byte that is not part of it. A parser that ' +
                     'reads the first certificate and stops — which is what ' +
                     '`X509CertificateParser.ReadCertificate` does — never sees that byte, so ' +
                     'this is the row that asks whether what arrived was read to its end. ' +
                     'COSE.TS insists on it in `DerReader.expectEnd`.',
    },
    {
        id:          'a-long-form-length-inside-the-certificate',
        at:          0,
        tampering:   'a long-form length in its signatureAlgorithm',
        expected:    'reject',
        reason:      'the signatureAlgorithm\'s length is `81 0A` where `0A` suffices, so a ' +
                     'length inside the certificate is not DER although the outer one is',
        description: 'The length that is not DER sits inside the certificate rather than in its ' +
                     'outer header, which separates a reader that validates the record it was ' +
                     'handed from one that validates every record in it: the first passes the ' +
                     'leading-zero row above and fails this one. The outer length is recomputed, ' +
                     'so the certificate is well formed apart from that single field.',
    },
    {
        id:          'one-byte-after-the-second-certificate',
        at:          1,
        tampering:   'one byte appended after it',
        expected:    'reject',
        reason:      'one octet follows the certification authority\'s certificate, at position 1 ' +
                     'of the chain, and every entry of an x5chain carries one certificate',
        description: 'The same appended byte, one position further up the chain. An ' +
                     'implementation that checks the encoding of the certificate a message is ' +
                     'about and then parses the rest of the chain however it can passes every ' +
                     'row above and verifies this one. Styx f1057ea8 names the position in its ' +
                     'refusal for that reason.',
    },
    {
        id:          'not-der-with-a-thumbprint-over-what-travelled',
        at:          0,
        tampering:   'a leading zero in its outer length',
        thumbprint:  'travelled',
        expected:    'reject',
        reason:      'the certificate is not DER, which is reason enough before any thumbprint is ' +
                     'compared — and this thumbprint is the honest hash of the bytes that travelled',
        description: 'The second question §25 asked. x5t is the hash of a certificate\'s DER ' +
                     'encoding [RFC 9360, Section 2], so when a parser accepts an encoding that ' +
                     'is not DER, which bytes does it hash? Here the thumbprint is the hash of ' +
                     'exactly what is in the message, so an implementation that reads the ' +
                     'certificate leniently and hashes what it was given finds a match and ' +
                     'verifies — COSE.TS hashes the record as it appeared, and would. The ' +
                     'tampering is the leading zero rather than the indefinite length precisely ' +
                     'so that this row has a demonstrated opening and not an argued one.',
    },
    {
        id:          'not-der-with-a-thumbprint-over-the-re-encoding',
        at:          0,
        tampering:   'a leading zero in its outer length',
        thumbprint:  'canonical',
        expected:    'reject',
        reason:      'the certificate is not DER, and the thumbprint names its canonical ' +
                     'encoding, which is not what travelled',
        description: 'The same certificate, with x5t over the canonical DER of it — a byte string ' +
                     'that is not in this message and that the sender never sent. An ' +
                     'implementation that reads the certificate leniently and hashes its own ' +
                     're-encoding finds a match here and verifies: that is Styx before f1057ea8, ' +
                     'where `GetEncoded()` returned Bouncy Castle\'s encoding rather than the ' +
                     'bytes read. Together with the row before it, this pins the refusal to the ' +
                     'certificate: a lenient reader hashes either what it got or what it ' +
                     're-encoded, and each of those two verifies one of these two rows, so both ' +
                     'green means the certificate itself was refused.',
    },
];


const cases = [

    ...LABELS.map(entry => ({
        id:                   entry.id,
        class:                'normative',
        message:              upper(sign1({ ...source,
                                            thumbprint: { algorithm: entry.algorithm, digest } })),
        trustAnchors:         ['metrologyRoot'],
        expected:             entry.expected,
        ...(entry.reason ? { reason: entry.reason } : {}),
        thumbprintAlgorithm:  `${entry.algorithm} (${entry.name})`,
        computedBy:           'tools/X509Cases',
        description:          entry.description,
    })),

    ...ENCODINGS.map(entry => {

        const chain = source.chain.map((certificate, position) =>
            position === entry.at ? TAMPERINGS[entry.tampering](certificate) : certificate);

        const thumbprint = entry.thumbprint
                               ? { algorithm: -16,
                                   digest:    sha256(entry.thumbprint === 'travelled'
                                                         ? chain[0]
                                                         : source.chain[0]) }
                               : undefined;

        return {
            id:             entry.id,
            // `survey`, not `normative`: recorded every run, failing nothing.
            // §25 says what that catches - a disagreement between the two, which
            // the divergence pass finds whatever a row's class is - and what it
            // does not: both sides lenient together passes.
            class:          'survey',
            message:        upper(sign1({ ...source, chain, thumbprint })),
            trustAnchors:   ['metrologyRoot'],
            expected:       entry.expected,
            ...(entry.reason ? { reason: entry.reason } : {}),
            encoding:       entry.encoding ??
                                `the certificate at position ${String(entry.at)} of the chain, ` +
                                `with ${entry.tampering}`,
            ...(entry.thumbprint
                    ? { thumbprintOver: entry.thumbprint === 'travelled'
                                            ? 'the bytes in the message'
                                            : 'the canonical DER, which is not in the message' }
                    : {}),
            computedBy:     'tools/X509Cases',
            description:    entry.description,
        };

    }),

];


// ---------------------------------------------------------------- the checks --

/**
 * What the two controls have to come out as.
 *
 * Neither is this file's word for a sound message: each is byte for byte a
 * message both implementations produce and agree on, so the tampered rows
 * beside them are anchored in two independent implementations rather than in
 * this generator. Recompute either with
 *
 *     node -e "const r=require('./results/csharp.json').results; \
 *              console.log(require('crypto').createHash('sha256') \
 *                  .update(Buffer.from(r['cose-x509:chain-to-trusted-root'] \
 *                  .message.hex,'hex')).digest('hex').toUpperCase())"
 *
 * after a suite run. Pins, not conveniences: if either implementation ever
 * writes those messages differently, this generator stops instead of quietly
 * anchoring the rows beside them in bytes nobody else produces any more.
 */
const CONTROLS = {
    // cose-x509:thumbprint-names-the-certificate, 835 bytes
    'thumbprint-labelled-with-sha-256':
        'B32E1152680CCD4F6AA6EF9D974E785E3C35948BCDE59478148E6BABD7405158',
    // cose-x509:chain-to-trusted-root, 797 bytes
    'the-certificate-as-it-was-minted':
        '28E3F46A0723EC9B1808F221B947202702100D8E046D31AF8F2DE1D64026CEA5',
};

for (const [id, pinned] of Object.entries(CONTROLS)) {

    const control = cases.find(entry => entry.id === id);

    if (control === undefined || control.expected !== 'accept')
        throw new Error(`${id} is not a control of this file`);

    if (upper(sha256(hex(control.message))) !== pinned)
        throw new Error(`the control ${id} is not the message both implementations produce ` +
                        '— refusing to write');

}

// Every message is read back out of its own bytes. A header that carried
// something other than what its case claims would be refused for the wrong
// reason and the row would be green all the same, so each claim is checked
// against the message rather than against the variable it was built from.
for (const entry of cases) {

    const message    = hex(entry.message);
    const chain      = chainIn(message);
    const thumbprint = thumbprintIn(message);

    if (chain.length !== 2)
        throw new Error(`${entry.id} does not carry a chain of two certificates`);

    if (entry.thumbprintAlgorithm !== undefined) {

        // The first family: the label is the one the case claims, the digest
        // beside it is the true hash of the end-entity certificate — the
        // property that makes a skipped check verify the message rather than
        // stumble over a thumbprint that was wrong anyway — and the chain is
        // the one the corpus minted, so the label is the only thing at issue.
        if (thumbprint === null ||
            !entry.thumbprintAlgorithm.startsWith(`${String(thumbprint.algorithm)} `))
            throw new Error(`${entry.id} does not carry the label it claims`);

        if (upper(thumbprint.digest) !== upper(digest))
            throw new Error(`${entry.id} does not carry the hash of the end-entity certificate`);

        if (upper(chain[0]) !== upper(source.chain[0]) ||
            upper(chain[1]) !== upper(source.chain[1]))
            throw new Error(`${entry.id} does not carry the chain as it was minted`);

        continue;

    }

    // The second family: the certificate in the message is the tampered one,
    // the other is untouched, and a thumbprint, where there is one, hashes
    // what the case says it hashes.
    const encoding = ENCODINGS.find(candidate => candidate.id === entry.id);

    for (const position of [0, 1]) {

        const expected = position === encoding.at && encoding.tampering !== undefined
                             ? TAMPERINGS[encoding.tampering](source.chain[position])
                             : source.chain[position];

        if (upper(chain[position]) !== upper(expected))
            throw new Error(`${entry.id} does not carry the certificate it claims at position ` +
                            String(position));

    }

    if ((thumbprint === null) !== (encoding.thumbprint === undefined))
        throw new Error(`${entry.id} carries a thumbprint its case does not claim, or the other ` +
                        'way round');

    if (thumbprint !== null) {

        const over = encoding.thumbprint === 'travelled' ? chain[0] : source.chain[0];

        if (upper(thumbprint.digest) !== upper(sha256(over)))
            throw new Error(`${entry.id} does not hash the certificate its case says it hashes`);

        // And the two have to be different hashes, or the pair of rows would
        // ask one question twice.
        if (upper(sha256(chain[0])) === upper(sha256(source.chain[0])))
            throw new Error(`${entry.id} travels the certificate whose canonical encoding it ` +
                            'already is');

    }

}


// --------------------------------------------------------------- the writing --

writeFileSync(join(root, 'vectors', 'cose-x509-messages.json'),
              JSON.stringify({
                  suite:       'cose-x509-messages',
                  description: 'Signed messages that carry what neither implementation will ' +
                               'construct: a certificate thumbprint labelled with an algorithm ' +
                               'that is not a hash algorithm (§24, normative), and a ' +
                               'certificate written down in an encoding that is not DER (§25, ' +
                               'survey: recorded, required of nobody). Generated by ' +
                               'tools/X509Cases from the noble primitives alone; the chain and ' +
                               'the signing key come from cose-x509-corpus.json, and each ' +
                               'family\'s control is byte for byte a message both ' +
                               'implementations produce.',
                  cases,
              }, null, 4) + '\n',
              'utf8');

console.log(`vectors/cose-x509-messages.json: ${cases.length} cases`);

for (const entry of cases)
    console.log(`  ${entry.expected === 'accept' ? 'verifies' : 'refused '}  ` +
                `${String(hex(entry.message).length).padStart(4)} bytes  ` +
                `${entry.thumbprintAlgorithm !== undefined
                       ? `x5t ${entry.thumbprintAlgorithm}`
                       : entry.encoding}` +
                `${entry.thumbprintOver !== undefined
                       ? `, x5t over ${entry.thumbprintOver}`
                       : ''}`);

for (const [id, pinned] of Object.entries(CONTROLS))
    console.log(`  the control ${id} reproduces a message both implementations produce ` +
                `(sha256 ${pinned.slice(0, 16)}…)`);
