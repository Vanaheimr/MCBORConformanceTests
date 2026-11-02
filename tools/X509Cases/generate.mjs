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
 * Three families. At the head of the first two is a control whose bytes are not
 * this generator's word for a sound message but byte for byte a message both
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
 *    from the start. These rows were `survey` while the two disagreed: both
 *    verdicts recorded side by side every run, nothing required of either side,
 *    because which of them was right was not this suite's to decide. They are
 *    `normative` since 2026-11-02. The disagreement is settled upstream, the
 *    third reader of §27 agrees with both, and a row that pins behaviour both
 *    sides already have declares no winner — while recording alone could not
 *    catch the one case that matters most, the two of them lenient at once.
 *    §25 of FINDINGS.md.
 *
 * 3. A certificate source neither implementation reads. RFC 9360 §2 registers
 *    four X.509 header parameters and both sides carry all four names — x5bag
 *    is label 32, x5chain 33, x5t 34, x5u 35 — while reading two of them.
 *    COSE.TS says why in src/x5chain.ts: "a bag is an unordered heap with no
 *    path to follow, and a URI is a fetch, which a signature library has no
 *    business performing". In Styx labels 32 and 35 are constants in
 *    COSEHeaderLabel that nothing else reads. A name without a reader can go
 *    wrong in three ways, each of them a verdict and not an error message: to
 *    take the bag for a chain and walk it, to let a header one does not read
 *    change the answer on a message whose chain is sound, or to ignore a
 *    `crit` that names that very label. Those three, once per label. Two rows
 *    are `normative` — an unread header beside a sound chain must not cost a
 *    verification, which is RFC 9052 §3 and holds whoever implements what —
 *    and four are `survey`, because a verifier that did read the label would
 *    be right to answer differently. §26 of FINDINGS.md.
 *
 *    This family needs no control of its own: its two accept rows are the
 *    second family's control with one header added, and the generator checks
 *    that the chain in them is still the one the corpus minted.
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
 * One COSE_Sign1 over the metrological value, carrying whichever headers a case
 * asks for, and the signature over all of them.
 *
 * The chain and the thumbprint are what the first two families vary; `bag`,
 * `uri` and `critical` are the third family's, and every one of them is
 * optional, down to the chain itself — two rows carry no x5chain at all. The
 * labels are written in ascending order, which is where x5chain and x5t sit in
 * the messages the x509 suite builds, so a case differs from one that suite
 * already measures in the header it is about and in nothing else.
 *
 * A `bag` of several certificates is written as an array and a single one as a
 * byte string, which is what RFC 9360 §2 gives COSE_X509 for either count.
 */
function sign1({ payload, chain, signingKey, thumbprint, bag, uri, critical }) {

    const protectedBucket = bstr(map([
        [int(1),  int(ESB256)],
        ...(critical
                ? [[int(2),  array(critical.map(int))]]
                : []),
        ...(bag
                ? [[int(32), Array.isArray(bag) ? array(bag.map(bstr)) : bstr(bag)]]
                : []),
        ...(chain
                ? [[int(33), array(chain.map(bstr))]]
                : []),
        ...(thumbprint
                ? [[int(34), array([int(thumbprint.algorithm), bstr(thumbprint.digest)])]]
                : []),
        ...(uri
                ? [[int(35), tstr(uri)]]
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


/**
 * The certificates of a COSE_X509 header — x5chain (label 33) or x5bag (32) —
 * as they lie in the message, or null when the message carries no such header.
 *
 * Both of RFC 9360 §2's forms are read, because both are written above: one
 * certificate as a byte string, several as an array of them.
 */
function certificatesIn(message, label) {

    const header = protectedHeaders(message).get(label);

    if (header === undefined)
        return null;

    const outer = readHead(header, 0);

    if (outer.major === 2)
        return [header.subarray(outer.next, outer.next + outer.value)];

    if (outer.major !== 4)
        throw new Error(`the header with label ${String(label)} is neither a byte string nor ` +
                        'an array of them');

    const certificates = [];
    let   at           = outer.next;

    for (let n = 0; n < outer.value; n++) {

        const entry = readHead(header, at);

        if (entry.major !== 2)
            throw new Error(`an entry of the header with label ${String(label)} is not a byte ` +
                            'string');

        certificates.push(header.subarray(entry.next, entry.next + entry.value));
        at = entry.next + entry.value;

    }

    return certificates;

}


/** The x5u header (label 35) as text, or null when the message carries none. */
function uriIn(message) {

    const header = protectedHeaders(message).get(35);

    if (header === undefined)
        return null;

    const text = readHead(header, 0);

    if (text.major !== 3)
        throw new Error('the x5u header is not a text string');

    return Buffer.from(header.subarray(text.next, text.next + text.value)).toString('utf8');

}


/** The labels of the crit header (label 2), or null when the message carries none. */
function criticalIn(message) {

    const header = protectedHeaders(message).get(2);

    if (header === undefined)
        return null;

    const outer = readHead(header, 0);

    if (outer.major !== 4)
        throw new Error('the crit header is not an array');

    const labels = [];
    let   at     = outer.next;

    for (let n = 0; n < outer.value; n++) {

        const entry = readHead(header, at);

        labels.push(entry.major === 1 ? -1 - entry.value : entry.value);
        at = entry.next;

    }

    return labels;

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

/**
 * A certificate that is not the signer's, for the third family's bag.
 *
 * `strangerMeter` and not a random byte string: it chains to the same trusted
 * root through the same authority and certifies a key that did not sign this
 * message — the certificate `cose-x509:chain-certifies-another-key` is built
 * from. So a verifier that takes it out of the bag has a valid path to a
 * trusted anchor in its hands and still must not verify.
 */
const stranger = hex(corpus.certificates.strangerMeter);

/**
 * Where the third family's x5u says a certificate may be found.
 *
 * `.invalid` is reserved and resolves for nobody [RFC 2606, Section 2], so no
 * run of this suite can reach anything, whatever a verifier decides to do with
 * the header.
 */
const URI = 'https://example.invalid/metrology/meter.der';


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


/**
 * The third family: a certificate source neither implementation reads.
 *
 * `label` is the header the row is about — 32 for x5bag, 35 for x5u. `chain`
 * says whether the sound x5chain is in the message beside it; where it is not,
 * the unread header is the message's only certificate source, and a verifier
 * that reads it verifies. `critical` adds `crit: [label]`, by which the sender
 * demands that the verifier understand the very header it does not read.
 *
 * `bag` names what a bag holds, and all three are COSE_X509 as RFC 9360 §2
 * writes it: 'the-chain' for the two certificates of the chain, in order,
 * which asks whether a heap is walked like a path; 'a-stranger-path' for a
 * complete and valid path that ends in a key which did not sign this message,
 * which asks what an unread header may cost a sound one; and 'a-stranger' for
 * a single certificate, written as a byte string rather than an array, which
 * is the one-certificate form of the same type.
 */
const SOURCES = [
    {
        id:          'a-bag-instead-of-a-chain',
        label:       32,
        bag:         'the-chain',
        chain:       false,
        critical:    false,
        expected:    'reject',
        class:       'survey',
        carries:     'x5bag with the chain in it, and no x5chain',
        reason:      'the certificates are in an x5bag (label 32), which is a heap and not a ' +
                     'path, and nothing in the message says which of them signed it',
        description: 'The end-entity certificate and the authority above it in an x5bag, and no ' +
                     'x5chain anywhere in the message. The bytes in the bag are the chain of the ' +
                     'control, in the same order, so an implementation that reads label 32 the ' +
                     'way it reads 33 walks them to the anchor and verifies this message — which ' +
                     'is what makes a refusal an answer rather than the only possibility. Both ' +
                     'refuse today, because neither reads the label. `survey` and not ' +
                     '`normative` for the reason §25 gives: RFC 9360 §2 describes building a ' +
                     'path from a bag rather than requiring it, gives no rule for which ' +
                     'certificate in a bag signed, and requires only that the end-entity ' +
                     'certificate be integrity protected — which the bag here is, by sitting in ' +
                     'the protected bucket. So an implementation that read label 32 would be ' +
                     'within the specification verifying this message, and whether an unordered ' +
                     'heap may serve as evidence is for the specification to settle rather than ' +
                     'for this suite. What the row records is how each side reads a label it has ' +
                     'a name for and no reader for.',
    },
    {
        id:          'a-bag-that-contradicts-the-chain',
        label:       32,
        bag:         'a-stranger-path',
        chain:       true,
        critical:    false,
        expected:    'accept',
        class:       'normative',
        carries:     'x5bag with a path to the anchor that is not the signer\'s, beside the chain',
        description: 'The sound chain in x5chain, and in an x5bag beside it a path that is not ' +
                     'the signer\'s: `strangerMeter` under the same authority, which leads to the ' +
                     'same trusted root and certifies a key that did not sign this message — the ' +
                     'certificate `cose-x509:chain-certifies-another-key` is built from. So the ' +
                     'bag is not nonsense a verifier can dismiss on sight. An implementation that ' +
                     'prefers it, or that merges it into the chain and starts at the first entry ' +
                     'it finds, validates a chain beautifully, reaches the anchor, and then holds ' +
                     'the wrong key: it refuses a message whose own chain is sound. RFC 9052 §3 ' +
                     'says a header parameter that is neither critical nor understood is ignored, ' +
                     'so this row is `normative` — and it stays right whoever implements what, ' +
                     'because a bag beside a chain is extra evidence and never a substitute for ' +
                     'it.',
    },
    {
        id:          'a-bag-the-sender-made-critical',
        label:       32,
        bag:         'a-stranger',
        chain:       true,
        critical:    true,
        expected:    'reject',
        class:       'normative',
        carries:     'x5bag with one certificate, beside the chain, with crit [32]',
        reason:      'crit names label 32 and neither implementation understands x5bag, and RFC ' +
                     '9052 §3.1 gives a verifier that cannot process a critical header nothing ' +
                     'to do but refuse',
        description: 'The sound chain, an x5bag holding the single stranger certificate — the ' +
                     'one-certificate form of COSE_X509, a byte string and not an array — and ' +
                     '`crit: [32]`, by which the sender says to refuse this message unless the ' +
                     'verifier understands x5bag. The same message without that one entry ' +
                     'verifies on both sides, measured rather than argued (§26), which is what ' +
                     'makes the refusal ' +
                     'measurable — a verifier that ignores crit, or that counts a label it can ' +
                     'name as a label it understands, verifies here. `cose-crit:crit-unknown-' +
                     'label` asks this with label 32767, which nobody can ever understand; this ' +
                     'asks it with a registered label both implementations have a name for, ' +
                     'which is the version a verifier gets wrong by accident. `normative` since ' +
                     '2026-11-02: the message meets every structural requirement RFC 9052 §3.1 ' +
                     'makes of a crit — the label and the crit itself are in the protected ' +
                     'bucket, the array holds a value — so what is left of §3.1 here is its ' +
                     'demand that a listed label be *processed*, and neither of these two ' +
                     'processes label 32. For a verifier that does not, refusing is what §3.1 ' +
                     'prescribes rather than what it prefers. One that grew a reader for x5bag ' +
                     'would understand the label and would be right to accept: this row is to be ' +
                     'read again on that day, and until then it fails the run for the accident ' +
                     'above rather than writing it down.',
    },
    {
        id:          'a-uri-instead-of-a-chain',
        label:       35,
        chain:       false,
        critical:    false,
        expected:    'reject',
        class:       'survey',
        carries:     'x5u with a URI that resolves for nobody, and no x5chain',
        reason:      'the only certificate source is an x5u (label 35), which is a reference and ' +
                     'not evidence: nothing in the message certifies the signing key',
        description: 'An x5u naming a URI, and no x5chain: the message says where its ' +
                     'certificate may be found instead of carrying it. The URI is under ' +
                     '`.invalid`, which resolves for nobody [RFC 2606 §2], so no run of this ' +
                     'suite reaches anything. Both refuse. This is the one row in the family ' +
                     'with no measured opening — a verifier that fetched would fail here too, so ' +
                     'the row cannot separate declining to fetch from trying and not arriving. ' +
                     'What it pins is the verdict, which is worth pinning: an implementation that ' +
                     'began verifying this message would show up here. The abstention itself is ' +
                     'argued from the code and not from this row: COSE.TS calls a URI "a fetch, ' +
                     'which a signature library has no business performing", and in Styx nothing ' +
                     'reads the label.',
    },
    {
        id:          'a-uri-beside-the-chain',
        label:       35,
        chain:       true,
        critical:    false,
        expected:    'accept',
        class:       'normative',
        carries:     'x5u beside the chain',
        description: 'The sound chain in x5chain and an x5u beside it, pointing at a URI that ' +
                     'resolves for nobody. Nothing here needs fetching: every certificate the ' +
                     'message is about is in it. An implementation that treats a header it does ' +
                     'not read as fatal refuses this message, and so does one that tries the URI ' +
                     'and takes the failure for an error — which makes this row the family\'s ' +
                     'fetch detector, as far as a suite with no network can have one. `normative` ' +
                     'on RFC 9052 §3, the same sentence as the bag row: what a verifier need not ' +
                     'understand it must ignore.',
    },
    {
        id:          'a-uri-the-sender-made-critical',
        label:       35,
        chain:       true,
        critical:    true,
        expected:    'reject',
        class:       'normative',
        carries:     'the same, with crit [35]',
        reason:      'crit names label 35 and neither implementation understands x5u, and RFC ' +
                     '9052 §3.1 gives a verifier that cannot process a critical header nothing ' +
                     'to do but refuse',
        description: 'The bag row\'s question for the other label: `crit: [35]` beside the x5u ' +
                     'and the sound chain. Both refuse, and the row above shows the same message ' +
                     'verifying without the crit. `normative` since 2026-11-02 on the same ' +
                     'sentence of RFC 9052 §3.1, and with the cleaner opening of the two: the ' +
                     'row above is this message minus the crit entry, header for header, and it ' +
                     'verifies, so what is refused here is the demand and nothing else. An ' +
                     'implementation that fetched certificates would understand label 35 and ' +
                     'would be right to accept, and would make this a row to read again.',
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
        certificates:         2,
        der:                  true,
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
            // `normative` since 2026-11-02, by the decision §25 records. While
            // the two disagreed about these encodings a normative row would have
            // declared one of them wrong, which was the maintainer's call; now
            // that Styx f1057ea8 refuses all four, COSE.TS always did and the
            // third reader of §27 agrees with both, it pins behaviour both sides
            // have. And it fails the run for the case recording could not catch:
            // both of them lenient at once, agreeing with each other.
            class:          'normative',
            message:        upper(sign1({ ...source, chain, thumbprint })),
            trustAnchors:   ['metrologyRoot'],
            expected:       entry.expected,
            ...(entry.reason ? { reason: entry.reason } : {}),
            certificates:   2,
            // What this family is about, stated so that a reader outside both
            // implementations can be held to it: tools/DerArbiter.
            der:            entry.tampering === undefined,
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

    ...SOURCES.map(entry => ({
        id:            entry.id,
        // Per row, and both classes appear: see SOURCES above for which is
        // which and why. The divergence pass finds a disagreement between the
        // two implementations whatever a row's class is.
        class:         entry.class,
        message:       upper(sign1({
                           ...source,
                           chain:    entry.chain ? source.chain : null,
                           bag:      entry.label !== 32  ? null
                                     : entry.bag === 'the-chain'       ? source.chain
                                     : entry.bag === 'a-stranger-path' ? [stranger, source.chain[1]]
                                     :                                   stranger,
                           uri:      entry.label === 35 ? URI : null,
                           critical: entry.critical ? [entry.label] : null,
                       })),
        trustAnchors:  ['metrologyRoot'],
        expected:      entry.expected,
        ...(entry.reason ? { reason: entry.reason } : {}),
        // Nothing is written down differently in this family, so every
        // certificate in it is DER, and two rows carry none at all.
        certificates:  (entry.chain ? 2 : 0) +
                       (entry.label !== 32          ? 0
                        : entry.bag === 'a-stranger' ? 1
                        :                              2),
        der:           true,
        headers:       entry.carries,
        computedBy:    'tools/X509Cases',
        description:   entry.description,
    })),

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
    const chain      = certificatesIn(message, 33);
    const thumbprint = thumbprintIn(message);

    // The third family comes first, because it is the one whose rows may carry
    // no x5chain at all: two of them put the message's only certificate source
    // in a header neither implementation reads.
    const unread = SOURCES.find(candidate => candidate.id === entry.id);

    if (unread !== undefined) {

        const bag      = certificatesIn(message, 32);
        const uri      = uriIn(message);
        const critical = criticalIn(message);

        if ((unread.label === 32) !== (bag !== null) ||
            (unread.label === 35) !== (uri !== null))
            throw new Error(`${entry.id} does not carry the header its case is about, or ` +
                            'carries the other one too');

        if (unread.chain !== (chain !== null))
            throw new Error(`${entry.id} carries an x5chain its case does not claim, or the ` +
                            'other way round');

        // Where the chain is there, it is the one the corpus minted, so the
        // only thing at issue in an accept row is the unread header beside it.
        if (chain !== null &&
            (chain.length !== 2 ||
             upper(chain[0]) !== upper(source.chain[0]) ||
             upper(chain[1]) !== upper(source.chain[1])))
            throw new Error(`${entry.id} does not carry the chain as it was minted`);

        if (bag !== null) {

            const expected = unread.bag === 'the-chain'       ? source.chain
                           : unread.bag === 'a-stranger-path' ? [stranger, source.chain[1]]
                           :                                    [stranger];

            if (bag.length !== expected.length ||
                bag.some((certificate, n) => upper(certificate) !== upper(expected[n])))
                throw new Error(`${entry.id} does not carry the certificates its case says are ` +
                                'in the bag');

            // And a stranger has to be a stranger, or the row would compare a
            // certificate with itself.
            if (unread.bag !== 'the-chain' && upper(stranger) === upper(source.chain[0]))
                throw new Error(`${entry.id} bags the signer's own certificate`);

        }

        if (uri !== null && uri !== URI)
            throw new Error(`${entry.id} does not carry the URI its case claims`);

        if ((critical !== null) !== unread.critical ||
            (critical !== null && (critical.length !== 1 || critical[0] !== unread.label)))
            throw new Error(`${entry.id} does not make its own header critical, or makes ` +
                            'something else critical');

        if (thumbprint !== null)
            throw new Error(`${entry.id} carries a thumbprint, which this family does not`);

        continue;

    }

    if (chain === null || chain.length !== 2)
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
                               'that is not a hash algorithm (§24, normative), a certificate ' +
                               'written down in an encoding that is not DER (§25, survey: ' +
                               'recorded, required of nobody), and a certificate source neither ' +
                               'implementation reads — x5bag and x5u (§26, normative where an ' +
                               'unread header must not cost a sound message its verification, ' +
                               'survey where a verifier that read the label would be right to ' +
                               'answer differently). Generated by tools/X509Cases from the noble ' +
                               'primitives alone; the chain and the signing key come from ' +
                               'cose-x509-corpus.json, and the first two families\' controls are ' +
                               'byte for byte messages both implementations produce. Each case ' +
                               'states how many certificates it carries and whether they are ' +
                               'DER; tools/DerArbiter answers both with a reader that is neither ' +
                               'implementation\'s, which is what §25\'s rows had no third ' +
                               'opinion about.',
                  cases,
              }, null, 4) + '\n',
              'utf8');

console.log(`vectors/cose-x509-messages.json: ${cases.length} cases`);

for (const entry of cases)
    console.log(`  ${entry.expected === 'accept' ? 'verifies' : 'refused '}  ` +
                `${String(hex(entry.message).length).padStart(4)} bytes  ` +
                `${entry.thumbprintAlgorithm !== undefined
                       ? `x5t ${entry.thumbprintAlgorithm}`
                       : entry.encoding ?? entry.headers}` +
                `${entry.thumbprintOver !== undefined
                       ? `, x5t over ${entry.thumbprintOver}`
                       : ''}`);

for (const [id, pinned] of Object.entries(CONTROLS))
    console.log(`  the control ${id} reproduces a message both implementations produce ` +
                `(sha256 ${pinned.slice(0, 16)}…)`);
