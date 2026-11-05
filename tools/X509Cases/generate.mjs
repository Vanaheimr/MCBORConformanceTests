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
 * Six families. At the head of three of them is a control whose bytes are not
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
 * 4. A certificate whose signature algorithm carries a parameter RFC 4055 does
 *    not allow — and carries it *consistently*, in both of the copies a
 *    certificate holds. This is the one family that cannot be done by writing
 *    bytes over a minted certificate, which is why §28 recorded it as not
 *    measured rather than measuring it: the body a certificate signs holds one
 *    of those two copies, so changing that copy breaks the signature over it,
 *    and changing only the other leaves the two contradicting each other —
 *    which Bouncy Castle refuses as "signature algorithm in TBS cert not same
 *    as outer cert" and COSE.TS refuses as well. A certificate consistent in
 *    its own oddity has to be *minted*, by something that signs. So this
 *    family signs: RSA is written out below, PKCS #1 v1.5 over SHA-256, from
 *    the modular exponentiation up, and the issuer's key comes from the corpus
 *    like everything else. §28 of FINDINGS.md.
 *
 * 5. A certificate whose *key* says what it is for. `rsaEncryption` is two
 *    integers and no opinion — the same key serves RSASSA-PSS and PKCS #1
 *    v1.5 — while `id-RSASSA-PSS` in the subject public key info is written
 *    there "when the RSA private key owner wishes to limit the use of the
 *    public key exclusively to RSASSA-PSS" [RFC 4055, Section 3.1], and its
 *    parameters, which may be absent here and nowhere else in a certificate,
 *    name the hash. Bouncy Castle will not write one: the subject public key
 *    info comes from the key, and a key does not know what it is to be
 *    restricted to. So this family mints its certificates too, and signs its
 *    messages with RSASSA-PSS as well as with PKCS #1 v1.5, which is the
 *    second RSA padding written out below. The five rows are the scenarios of
 *    that section's own Section 3.3. §28 of FINDINGS.md.
 *
 * 6. Countersignatures neither implementation reads. RFC 9338 registers
 *    `Countersignature0 version 2` at label 12: a bare signature, made over
 *    the body's signature, whose algorithm and key "are provided by the same
 *    context" rather than by the message. RFC 8152 had `counter signature` at
 *    label 7: a COSE_Signature over the payload but not over the signature it
 *    countersigns, which RFC 9338 replaced and RFC 9052 §3.1 still says "must
 *    be understood by new implementations". Both sides carry both names and
 *    read neither. One row per label, each beside the sound chain, and each
 *    countersignature in them a real one: made with the key of the corpus's
 *    `strangerMeter`, a second party certified by the same authority, and
 *    verified here before anything is written. So a reader that did process
 *    the label would verify as well. §28 of FINDINGS.md.
 *
 * The certificates and the signing key are not written here: the chain, the
 * anchor and the end-entity key come from vectors/cose-x509-corpus.json, which
 * tools/CertificateCorpus owns, so that a certificate has one owner rather
 * than two that must remember to agree.
 *
 * The fourth family bends that, and the bend is checked rather than asserted.
 * Its certificate is not a new one: it is the corpus's `rsaMeter`, with one
 * field written differently and the issuer's signature recomputed over the
 * body — so the generator mints it a third time with the field as the corpus
 * has it, and refuses to write this file unless that comes out as the corpus
 * certificate byte for byte. The corpus is still the owner; this file derives
 * from it and proves the derivation.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join }               from 'node:path';
import { fileURLToPath }               from 'node:url';

import { brainpoolP256r1 }             from '@noble/curves/misc.js';
import { sha256, sha384 }              from '@noble/hashes/sha2.js';
// For the one row whose thumbprint has to be a correct SHA-1: a hash neither
// implementation computes, which is why a third encoder has to.
import { sha1 }                        from '@noble/hashes/legacy.js';


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


// ------------------------------------------------------------- RSA, by hand --

// There is no RSA in the noble packages, and the fourth family needs two
// signatures made with it: one over a certificate's body, so that the minted
// certificate is sound apart from the field it is about, and one over the
// message that certificate travels in. So the primitive is written out here,
// as the CBOR and the DER above are, and it is arithmetic rather than a curve.

/** `base ** exponent mod modulus`, square and multiply. */
function modPow(base, exponent, modulus) {

    let result = 1n;
    let b      = base % modulus;
    let e      = exponent;

    while (e > 0n) {
        if (e & 1n) result = (result * b) % modulus;
        b = (b * b) % modulus;
        e >>= 1n;
    }

    return result;

}


const number = bytes => BigInt(`0x${upper(bytes)}`);


/** A number as exactly `octets` octets, which is what a signature is carried as. */
function fixedWidth(value, octets) {

    const digits = value.toString(16);

    if (digits.length > octets * 2)
        throw new Error('a value wider than the modulus it was reduced by');

    return hex(digits.padStart(octets * 2, '0'));

}


/**
 * MGF1 with SHA-256 [RFC 8017, Appendix B.2.1]: the hash of the seed and a
 * four-octet counter, concatenated until `length` octets are there.
 */
/**
 * The two hashes the RSA here signs with: SHA-256 for everything the corpus
 * holds, and SHA-384 for the one certificate of the seventh family that has to
 * be signed with a hash its authority's key does not name.
 */
const HASHES = {
    'SHA-256': { digest: sha256, length: 32, digestInfo: hex('3031300D060960864801650304020105000420') },
    'SHA-384': { digest: sha384, length: 48, digestInfo: hex('3041300D060960864801650304020205000430') },
};


function mgf1(seed, length, hash = HASHES['SHA-256']) {

    const blocks = [];

    for (let counter = 0; counter * hash.length < length; counter++)
        blocks.push(hash.digest(concat(seed,
                                  Uint8Array.from([(counter >>> 24) & 0xFF, (counter >>> 16) & 0xFF,
                                                   (counter >>>  8) & 0xFF,  counter        & 0xFF]))));

    return concat(...blocks).subarray(0, length);

}


/**
 * The salt of every RSASSA-PSS signature below.
 *
 * Fixed, and the reason it can be is that nothing about a salt has to be
 * secret or even unpredictable for a *verifier*: PSS verification recovers the
 * salt from the signature and recomputes the hash over it, so any 32 octets
 * verify. What a random salt buys is a security property of the signer, and
 * these messages secure nothing — while a random one would make this file
 * different on every run, which is the one thing it must not be.
 */
const PSS_SALT = sha256(Buffer.from('tools/X509Cases, one fixed PSS salt', 'utf8'));


/**
 * One RSASSA-PSS signature over `message` with SHA-256, MGF1 over SHA-256 and
 * a 32-octet salt, which is what the COSE PS256 is [RFC 8230, Section 2]:
 * EMSA-PSS-ENCODE of RFC 8017 Section 9.1.1, then the private key operation.
 *
 * Checked against OpenSSL once, through Node's crypto, in a probe rather than
 * here: this file owes its output to nobody, and what it keeps is the check
 * that costs it nothing — `s ** e mod n` has to come back as the encoded
 * message that went in.
 */
function pssSign(message, key, hash = HASHES['SHA-256']) {

    const n      = number(hex(key.n));
    const octets = hex(key.n).length;

    // emBits is one less than the modulus, so for a 2048-bit key the encoded
    // message is 256 octets with its leading bit cleared.
    const emBits = n.toString(2).length - 1;
    const emLen  = Math.ceil(emBits / 8);
    const hLen   = hash.length;

    // A salt as long as the hash, as every COSE PS* has [RFC 8230, Section 2].
    // For SHA-256 it is PSS_SALT itself, so nothing minted before moves.
    const salt   = hash.digest(Buffer.from('tools/X509Cases, one fixed PSS salt', 'utf8'));

    const mHash  = hash.digest(message);
    const H      = hash.digest(concat(new Uint8Array(8), mHash, salt));

    const db     = concat(new Uint8Array(emLen - hLen - hLen - 2),
                          Uint8Array.from([0x01]),
                          salt);
    const mask   = mgf1(H, emLen - hLen - 1, hash);
    const masked = db.map((octet, at) => octet ^ mask[at]);

    masked[0] &= 0xFF >> (8 * emLen - emBits);

    const encoded   = concat(masked, H, Uint8Array.from([0xBC]));
    const signature = modPow(number(encoded), number(hex(key.d)), n);

    if (modPow(signature, number(hex(key.e)), n) !== number(encoded))
        throw new Error('the RSASSA-PSS signature this generator just made does not verify');

    return fixedWidth(signature, octets);

}


/**
 * The DigestInfo prefix of EMSA-PKCS1-v1_5 with SHA-256 [RFC 8017, Appendix
 * B.1]: SEQUENCE { SEQUENCE { id-sha256, NULL }, OCTET STRING (32) }, written
 * out so that the 32 octets of the digest follow it.
 *
 * The NULL in it is the same question this family is about, one layer down —
 * and there RFC 8017 is explicit that it is what implementations write, which
 * is why it is a constant here and not a case.
 */
const SHA256_DIGESTINFO = hex('3031300D060960864801650304020105000420');


/**
 * One RSASSA-PKCS1-v1_5 signature over `message` with SHA-256 [RFC 8017,
 * Section 8.2.1], as the fewest-octets parameters of a corpus key give it.
 *
 * The signature is verified here with the public exponent before it is
 * returned, which is the whole of the check: `s ** e mod n` has to come back
 * as the encoded message that went in.
 */
function pkcs1Sign(message, key, hash = HASHES['SHA-256']) {

    const n       = number(hex(key.n));
    const e       = number(hex(key.e));
    const d       = number(hex(key.d));
    const octets  = hex(key.n).length;

    const digestInfo = concat(hash.digestInfo, hash.digest(message));

    // EM = 0x00 || 0x01 || PS || 0x00 || T, with PS as many 0xFF as it takes.
    const encoded = concat(Uint8Array.from([0x00, 0x01]),
                           new Uint8Array(octets - digestInfo.length - 3).fill(0xFF),
                           Uint8Array.from([0x00]),
                           digestInfo);

    const signature = modPow(number(encoded), d, n);

    if (modPow(signature, e, n) !== number(encoded))
        throw new Error('the RSA signature this generator just made does not verify');

    return fixedWidth(signature, octets);

}


// ------------------------------------------------------- the COSE structures --

/** ECDSA with brainpoolP256r1 and SHA-256, as the corpus names it. */
const ESB256 = -265;

/** RSASSA-PKCS1-v1_5 with SHA-256, which the fourth family's chain certifies. */
const RS256  = -257;

/** RSASSA-PSS with SHA-256, which the fifth family's keys are restricted to. */
const PS256  = -37;


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
 *
 * `algorithm` is ESB256 for the first three families, whose chain certifies a
 * brainpoolP256r1 key, and RS256 or PS256 for the two RSA families. It is not
 * a free choice: the key the signature is made with is the key the end-entity
 * certificate certifies, or the chain would not bind the message, and
 * `signingKey` is whatever that key is written as — a scalar for the curve,
 * the eight parameters of RFC 8230 §4 for RSA. Which of the two RSA
 * algorithms is a free choice, and the fifth family is about what the
 * certificate has to say about it.
 */
function sign1({ payload, chain, signingKey, algorithm = ESB256,
                 thumbprint, bag, uri, critical, countersigner, countersigner8152 }) {

    const protectedBucket = bstr(map([
        [int(1),  int(algorithm)],
        ...(critical
                ? [[int(2),  array(critical.map(int))]]
                : []),
        ...(bag
                ? [[int(32), Array.isArray(bag) ? array(bag.map(bstr)) : bstr(bag)]]
                : []),
        ...(chain
                ? [[int(33), chain.length === 1 ? bstr(chain[0]) : array(chain.map(bstr))]]
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
    // on the wire. The two RSA branches verify themselves.
    const rsa       = algorithm === RS256 || algorithm === PS256;
    const signature = algorithm === RS256 ? pkcs1Sign(toBeSigned, signingKey)
                    : algorithm === PS256 ? pssSign(toBeSigned, signingKey)
                    : brainpoolP256r1.sign(sha256(toBeSigned), signingKey,
                                           { prehash: false, lowS: false });

    if (!rsa &&
        !brainpoolP256r1.verify(signature, sha256(toBeSigned),
                                brainpoolP256r1.getPublicKey(signingKey, false),
                                { prehash: false, lowS: false }))
        throw new Error('the signature this generator just made does not verify');

    // An abbreviated countersignature [RFC 9338, Section 3.3], when one is
    // asked for: ESB256 over the Countersign_structure, which for
    // Countersignature0 version 2 omits sign_protected and carries the body's
    // signature as the one element of other_fields. It is "encoded as an
    // unprotected header parameter", label 12 [RFC 9338, Section 3.2].
    //
    // Or the countersignature of RFC 8152 at label 7: a COSE_Signature of its
    // own, over the Sig_structure with the context "CounterSignature" - the
    // body's protected bucket, its own, no external data and the payload, and
    // not the body's signature [RFC 8152, Section 4.4].
    const unprotectedBucket =
        countersigner     ? map([[int(12), bstr(countersign0({ protectedBucket, payload, signature,
                                                                key: countersigner }))]])
      : countersigner8152 ? map([[int(7),  countersign8152({ protectedBucket, payload,
                                                              key: countersigner8152 })]])
      :                     map([]);

    // COSE_Sign1 is tag 18 around [protected, unprotected, payload, signature].
    return concat(Uint8Array.from([0xD2]),
                  array([protectedBucket, unprotectedBucket, bstr(payload), bstr(signature)]));

}


/**
 * The Countersign_structure of a Countersignature0 version 2 on a COSE_Sign1
 * [RFC 9338, Section 3.3]: the context string, the body's protected bucket,
 * the externally supplied data (none), the payload, and the body's signature
 * as the one element of other_fields. sign_protected "is omitted for the
 * Countersignature0V2 attribute".
 */
const countersignStructure = ({ protectedBucket, payload, signature }) => array([
    tstr('CounterSignature0V2'),
    protectedBucket,
    bstr(new Uint8Array(0)),
    bstr(payload),
    array([bstr(signature)]),
]);

/** ESB256 over that structure, verified before it is returned. */
function countersign0({ protectedBucket, payload, signature, key }) {

    const toBeSigned = countersignStructure({ protectedBucket, payload, signature });
    const made       = brainpoolP256r1.sign(sha256(toBeSigned), key, { prehash: false, lowS: false });

    if (!brainpoolP256r1.verify(made, sha256(toBeSigned), brainpoolP256r1.getPublicKey(key, false),
                                { prehash: false, lowS: false }))
        throw new Error('the countersignature this generator just made does not verify');

    return made;

}

/**
 * The Sig_structure of an RFC 8152 countersignature [RFC 8152, Section 4.4]:
 * "CounterSignature", the body's protected bucket, the countersignature's own
 * protected bucket, the externally supplied data (none) and the payload.
 */
const counterSignatureStructure = ({ protectedBucket, signProtected, payload }) => array([
    tstr('CounterSignature'),
    protectedBucket,
    signProtected,
    bstr(new Uint8Array(0)),
    bstr(payload),
]);

/**
 * A COSE_Signature [protected, unprotected, signature] made with ESB256 over
 * that structure, verified before it is returned. Its protected bucket names
 * the algorithm, as a COSE_Signature's has to.
 */
function countersign8152({ protectedBucket, payload, key }) {

    const signProtected = bstr(map([[int(1), int(ESB256)]]));
    const toBeSigned    = counterSignatureStructure({ protectedBucket, signProtected, payload });
    const made          = brainpoolP256r1.sign(sha256(toBeSigned), key, { prehash: false, lowS: false });

    if (!brainpoolP256r1.verify(made, sha256(toBeSigned), brainpoolP256r1.getPublicKey(key, false),
                                { prehash: false, lowS: false }))
        throw new Error('the RFC 8152 countersignature this generator just made does not verify');

    return array([signProtected, map([]), bstr(made)]);

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


/**
 * The four parts of a finished COSE_Sign1: the protected bucket as it lies in
 * the message (the encoded byte string, which is what a Countersign_structure
 * holds), the unprotected bucket by label, the payload and the signature.
 */
function sign1Parts(message) {

    if (message[0] !== 0xD2 || message[1] !== 0x84)
        throw new Error('not a tagged COSE_Sign1 of four elements');

    const protectedEnd  = skip(message, 2);
    const unprotected   = readHead(message, protectedEnd);

    if (unprotected.major !== 5)
        throw new Error('the unprotected bucket is not a map');

    const headers = new Map();
    let   at      = unprotected.next;

    for (let entry = 0; entry < unprotected.value; entry++) {

        const key   = readHead(message, at);
        const label = key.major === 1 ? -1 - key.value : key.value;
        const from  = key.next;

        at = skip(message, from);
        headers.set(label, message.subarray(from, at));

    }

    const payloadEnd = skip(message, at);

    return { protectedBucket: message.subarray(2, protectedEnd),
             unprotected:     headers,
             payload:         byteString(message.subarray(at, payloadEnd)),
             signature:       byteString(message.subarray(payloadEnd, skip(message, payloadEnd))) };

}

/** The contents of an encoded byte string. */
function byteString(item) {

    const head = readHead(item, 0);

    if (head.major !== 2)
        throw new Error('not a byte string');

    return item.subarray(head.next, head.next + head.value);

}

/**
 * A COSE_Signature [protected, unprotected, signature] as it lies in the
 * message: its protected bucket as the encoded byte string, its signature.
 */
function coseSignatureParts(item) {

    const head = readHead(item, 0);

    if (head.major !== 4 || head.value !== 3)
        throw new Error('not a COSE_Signature of three elements');

    const protectedEnd   = skip(item, head.next);
    const unprotectedEnd = skip(item, protectedEnd);

    return { protectedBucket: item.subarray(head.next, protectedEnd),
             signature:       byteString(item.subarray(unprotectedEnd, skip(item, unprotectedEnd))) };

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


// ------------------------------------------------- minting one of them again --

/**
 * The key that signed `rsaMeter` and `rsaMeterWideHash`, from the corpus's
 * `issuerKeys` — a different object from the `privateKeys` every other case
 * here draws on, because a key that signs certificates has no COSE algorithm
 * and signs no message.
 *
 * That it really is the authority's key is checked rather than trusted: its
 * modulus has to be the 256 octets `rsaManufacturerCA` carries in its subject
 * public key info. Two hundred and fifty-six octets do not appear in a
 * certificate by coincidence, and if the corpus ever published a different key
 * under this name, the certificates minted below would chain to nothing and
 * every row of this family would be refused for that instead.
 */
const issuerKey = corpus.issuerKeys.rsaManufacturerCA.keyRsa;

if (!upper(hex(corpus.certificates.rsaManufacturerCA)).includes(upper(hex(issuerKey.n))))
    throw new Error('the published issuer key is not the key in rsaManufacturerCA');

// Three object identifiers, each as it is encoded with its tag and length,
// because that is how they are compared and written back below.

/** sha256WithRSAEncryption [RFC 4055, Section 5], which `rsaMeter` is signed with. */
const OID_SHA256_WITH_RSA = '06092A864886F70D01010B';

/** rsaEncryption [RFC 4055, Section 1.2], which every RSA key in the corpus is named by. */
const OID_RSA_ENCRYPTION  = '06092A864886F70D010101';

/** id-RSASSA-PSS [RFC 4055, Section 3.1], which is a signature algorithm and a key type. */
const OID_RSASSA_PSS      = '06092A864886F70D01010A';

/**
 * The three ways the parameters beside that identifier are written below.
 *
 * RFC 4055 §5 allows two of them: "the parameters MUST be NULL. Implementations
 * MUST accept the parameters being absent as well as present." The third is
 * neither, and is a zero-length OCTET STRING rather than anything larger
 * because it is the shortest thing that is not those two — so the certificate
 * carrying it differs from the corpus's in one octet of its two copies, and in
 * the signature that follows.
 */
const PARAMETERS = {
    'a NULL':                     hex('0500'),
    'a zero-length OCTET STRING': hex('0400'),
    'nothing at all':             new Uint8Array(0),
};

/** `AlgorithmIdentifier ::= SEQUENCE { algorithm, parameters OPTIONAL }`. */
function algorithmIdentifier(oid, parameters) {

    const content = concat(oid, parameters);

    if (content.length > 127)
        throw new Error('an algorithm identifier this generator writes is short-form');

    return concat(Uint8Array.from([0x30, content.length]), content);

}


/**
 * The corpus's `rsaMeter`, with the parameters beside its signature algorithm
 * written as `parameters` says and the issuer's signature made again over the
 * body that holds one of them.
 *
 * Both copies, which is the whole point: a certificate states its signature
 * algorithm twice, once within the TBSCertificate and once beside it, and the
 * copy within is under the signature. Neither of the two patches §28 could
 * make produces that — patching the copy within breaks the signature over it,
 * patching the copy beside leaves two statements that contradict each other,
 * and both implementations refuse both. A certificate consistent in its own
 * oddity and sound in every other way has to be signed into existence.
 *
 * Nothing else about the certificate moves: the serial number, the validity,
 * the subject, the key and the extensions are the corpus's, read out of it and
 * written back unchanged. The TBSCertificate's own length is recomputed
 * because absent parameters are two octets shorter than the NULL they replace.
 */
function remint(parameters) {

    const minted        = hex(corpus.certificates.rsaMeter);
    const { tbs, rest } = parts(minted);

    // The signature field is the TBSCertificate's third element, after the
    // version and the serial number [RFC 5280, Section 4.1] - the version
    // being present because the corpus mints v3 certificates. Nothing here
    // relies on that: the object identifier is checked below, and a field
    // counted wrong would not be sha256WithRSAEncryption.
    const content = record(tbs, 0);
    const at      = record(tbs, record(tbs, content.from).to).to;

    const within  = record(tbs, at);
    const beside  = record(rest, 0);

    if (tbs[at] !== 0x30 || rest[0] !== 0x30)
        throw new Error('a signature algorithm is a SEQUENCE in both of its copies');

    const oid = tbs.subarray(within.from, record(tbs, within.from).to);

    if (upper(oid) !== OID_SHA256_WITH_RSA)
        throw new Error(`rsaMeter is signed with ${upper(oid)}, not sha256WithRSAEncryption`);

    if (upper(oid) !== upper(rest.subarray(beside.from, record(rest, beside.from).to)))
        throw new Error('the two copies of the signature algorithm name different algorithms');

    const identifier = algorithmIdentifier(oid, parameters);

    return certificateOf(concat(tbs.subarray(content.from, at), identifier,
                                tbs.subarray(within.to)),
                         identifier);

}


/**
 * One TBSCertificate's contents, signed by the authority above `rsaMeter` and
 * wrapped as a certificate.
 *
 * `signatureAlgorithm` is the copy beside the body, and it has to be the copy
 * within it: the two families here each vary one field, and each varies it in
 * both of its copies or in neither. Which is also why this is one function and
 * not two — the reminting is identical once the body is decided, and the
 * signature is PKCS #1 v1.5 over SHA-256 in both, because that is what the
 * authority signed `rsaMeter` with and what both reminted certificates still
 * claim.
 */
function certificateOf(contents, signatureAlgorithm) {

    const signed    = concat(Uint8Array.from([0x30]), twoOctets(contents.length), contents);
    const signature = pkcs1Sign(signed, issuerKey);

    // signatureValue is a BIT STRING with no unused bits [RFC 5280, §4.1.1.3].
    const value     = concat(Uint8Array.from([0x03]), twoOctets(signature.length + 1),
                             Uint8Array.from([0x00]), signature);

    const whole     = concat(signed, signatureAlgorithm, value);

    return concat(Uint8Array.from([0x30]), twoOctets(whole.length), whole);

}


/**
 * The RSASSA-PSS parameter set Bouncy Castle writes for one hash, lifted out
 * of a certificate it signed with it.
 *
 * Lifted rather than written, so that this file does not own a second encoder
 * of the one parameter set in X.509 that is hard to write: these are the bytes
 * the corpus already carries, and a row built on them is a row about the key
 * type rather than about this generator's idea of RFC 4055 Section 3.1.
 */
function pssParametersOf(name) {

    const { rest }   = parts(hex(corpus.certificates[name]));
    const identifier = record(rest, 0);
    const oid        = rest.subarray(identifier.from, record(rest, identifier.from).to);

    if (upper(oid) !== OID_RSASSA_PSS)
        throw new Error(`${name} is signed with ${upper(oid)}, not id-RSASSA-PSS`);

    return rest.subarray(record(rest, identifier.from).to, identifier.to);

}


/**
 * Bouncy Castle's parameter set with its salt length lowered to the DEFAULT of
 * RFC 4055 Section 3.1, which is also the value Section 3.3 makes a floor.
 *
 * `A2 03 02 01 20` is a 32-octet salt and `A2 03 02 01 14` a 20-octet one, so
 * this is one octet of Bouncy Castle's own bytes and not a parameter set of
 * this generator's. Twenty is below what any PS* signs with, which is the
 * point: a floor is cleared from above.
 */
function withSaltLength(parameters, octets) {

    // A2 03 02 01 <length>: the context tag of saltLength around a one-octet
    // INTEGER, which is how every parameter set in the corpus writes it.
    const asked = upper(parameters);
    const salt  = count => `A2030201${count.toString(16).toUpperCase().padStart(2, '0')}`;

    if (asked.split(salt(32)).length - 1 !== 1)
        throw new Error('the parameter set does not ask for a 32-octet salt exactly once');

    return hex(asked.replace(salt(32), salt(octets)));

}


/**
 * The five ways the subject public key algorithm is written below.
 *
 * `rsaEncryption` is what the corpus carries and is here as the control's.
 * The three others are `id-RSASSA-PSS`, which says the key is for RSASSA-PSS
 * and nothing else, with the parameters that name a hash and without any —
 * "The parameters may be either absent or present when used as subject public
 * key information" [RFC 4055, Section 3.1], which is the one place in a
 * certificate where this identifier may stand alone.
 */
const KEY_ALGORITHMS = {
    'rsaEncryption':
        algorithmIdentifier(hex(OID_RSA_ENCRYPTION), PARAMETERS['a NULL']),
    'id-RSASSA-PSS, with parameters naming SHA-256':
        algorithmIdentifier(hex(OID_RSASSA_PSS), pssParametersOf('rsaPssMeter')),
    'id-RSASSA-PSS, with parameters naming SHA-384':
        algorithmIdentifier(hex(OID_RSASSA_PSS), pssParametersOf('rsaPssManufacturerCA')),
    'id-RSASSA-PSS, with parameters asking for a salt of 20':
        algorithmIdentifier(hex(OID_RSASSA_PSS),
                            withSaltLength(pssParametersOf('rsaPssMeter'), 20)),
    'id-RSASSA-PSS, with no parameters':
        algorithmIdentifier(hex(OID_RSASSA_PSS), new Uint8Array(0)),
};


/**
 * The corpus's `rsaMeter` with the algorithm of its subject public key info
 * replaced, and the issuer's signature made again over the body that holds it.
 *
 * The same two integers are the key either way, and what changes is what the
 * certificate says they are *for*. Everything above the identifier is
 * recomputed, because an identifier that names its parameters is 52 octets
 * longer than `rsaEncryption`'s and one that omits them is two shorter: the
 * subject public key info, the TBSCertificate and the certificate all change
 * length, which is the other reason this had to be minted rather than patched.
 */
function remintKey(identifier) {

    const minted  = hex(corpus.certificates.rsaMeter);
    const { tbs } = parts(minted);

    // The subject public key info is the TBSCertificate's seventh element,
    // after the version, the serial number, the signature, the issuer, the
    // validity and the subject [RFC 5280, Section 4.1].
    const content = record(tbs, 0);
    let   at      = content.from;

    for (let element = 0; element < 6; element++)
        at = record(tbs, at).to;

    const spki      = record(tbs, at);
    const algorithm = record(tbs, spki.from);
    const oid       = tbs.subarray(algorithm.from, record(tbs, algorithm.from).to);

    if (upper(oid) !== OID_RSA_ENCRYPTION)
        throw new Error(`rsaMeter holds a key of type ${upper(oid)}, not rsaEncryption`);

    // The subject public key info, with the identifier replaced and the BIT
    // STRING after it kept as it is - the key itself never moves.
    const info = concat(identifier, tbs.subarray(algorithm.to, spki.to));

    return certificateOf(concat(tbs.subarray(content.from, at),
                                Uint8Array.from([0x30]), twoOctets(info.length), info,
                                tbs.subarray(spki.to)),
                         algorithmIdentifier(hex(OID_SHA256_WITH_RSA), PARAMETERS['a NULL']));

}


// ---------------------------------------------- an authority issued again --

/**
 * The key that signed `rsaManufacturerCA`, from the corpus's `issuerKeys`,
 * checked against the certificate the way `issuerKey` is: the 384 octets of
 * its modulus have to be in `rsaRoot`.
 */
const rootIssuerKey = corpus.issuerKeys.rsaRoot.keyRsa;

if (!upper(hex(corpus.certificates.rsaRoot)).includes(upper(hex(rootIssuerKey.n))))
    throw new Error('the published issuer key is not the key in rsaRoot');

/** sha384WithRSAEncryption [RFC 4055, Section 5], which `rsaManufacturerCA` is signed with. */
const OID_SHA384_WITH_RSA = '06092A864886F70D01010C';


/**
 * A corpus certificate issued again: its signature algorithm replaced in the
 * copy within the TBSCertificate and in the copy beside it, its subject public
 * key algorithm replaced where `keyAlgorithm` says so, and the body signed
 * again by `sign`. Everything else is the corpus's, read out and written back.
 *
 * The general form of `remint` and `remintKey` above, which each vary one
 * field of `rsaMeter` under one signature. The seventh family needs both
 * fields varied, of two certificates, under three signatures, and the check
 * below - that issuing both certificates again unchanged gives the corpus's
 * bytes - is what says the surgery is right.
 */
function reissue(name, { keyAlgorithm = null, signatureAlgorithm, sign }) {

    const { tbs }  = parts(hex(corpus.certificates[name]));
    const content  = record(tbs, 0);

    // The version, the serial number, the signature, the issuer, the
    // validity, the subject and the subject public key info [RFC 5280,
    // Section 4.1], and the extensions after them, which are kept as they are.
    const elements = [];
    let   at       = content.from;

    for (let element = 0; element < 7; element++) {
        elements.push(record(tbs, at));
        at = elements[element].to;
    }

    const field = element => tbs.subarray(element === 0 ? content.from : elements[element - 1].to,
                                          elements[element].to);

    let info = field(6);

    if (keyAlgorithm !== null) {

        const spki      = elements[6];
        const algorithm = record(tbs, spki.from);
        const inner     = concat(keyAlgorithm, tbs.subarray(algorithm.to, spki.to));

        info = concat(Uint8Array.from([0x30]), twoOctets(inner.length), inner);

    }

    const body      = concat(field(0), field(1), signatureAlgorithm, field(3), field(4), field(5),
                             info, tbs.subarray(elements[6].to, content.to));

    const signed    = concat(Uint8Array.from([0x30]), twoOctets(body.length), body);
    const signature = sign(signed);
    const value     = concat(Uint8Array.from([0x03]), twoOctets(signature.length + 1),
                             Uint8Array.from([0x00]), signature);
    const whole     = concat(signed, signatureAlgorithm, value);

    return concat(Uint8Array.from([0x30]), twoOctets(whole.length), whole);

}


/**
 * `rsaManufacturerCA` issued again by `rsaRoot`, with its key written as
 * `keyAlgorithm` says - one of KEY_ALGORITHMS - and signed as the corpus
 * signed it, PKCS #1 v1.5 over SHA-384. Only the key type moves.
 */
const authority = keyAlgorithm => reissue('rsaManufacturerCA', {
    keyAlgorithm:       KEY_ALGORITHMS[keyAlgorithm],
    signatureAlgorithm: algorithmIdentifier(hex(OID_SHA384_WITH_RSA), PARAMETERS['a NULL']),
    sign:               signed => pkcs1Sign(signed, rootIssuerKey, HASHES['SHA-384']),
});

/**
 * How the authority signs `rsaMeter` below: as the corpus did, and in the two
 * RSASSA-PSS that a key restricted to a hash can be asked about. The PSS
 * parameter sets are Bouncy Castle's own, lifted out of the corpus.
 */
const ISSUER_SIGNATURES = {
    'sha256WithRSAEncryption': {
        identifier: algorithmIdentifier(hex(OID_SHA256_WITH_RSA), PARAMETERS['a NULL']),
        sign:       signed => pkcs1Sign(signed, issuerKey),
    },
    'RSASSA-PSS over SHA-256': {
        identifier: algorithmIdentifier(hex(OID_RSASSA_PSS), pssParametersOf('rsaPssMeter')),
        sign:       signed => pssSign(signed, issuerKey),
    },
    'RSASSA-PSS over SHA-384': {
        identifier: algorithmIdentifier(hex(OID_RSASSA_PSS), pssParametersOf('rsaPssManufacturerCA')),
        sign:       signed => pssSign(signed, issuerKey, HASHES['SHA-384']),
    },
};

/** `rsaMeter` issued again by its authority, signed as `signature` says. */
const meterSignedWith = signature => reissue('rsaMeter', {
    signatureAlgorithm: ISSUER_SIGNATURES[signature].identifier,
    sign:               ISSUER_SIGNATURES[signature].sign,
});

// The surgery held to the corpus: both certificates issued again with nothing
// changed are the corpus's, byte for byte - which is possible only because
// PKCS #1 v1.5 is deterministic, and which says that `reissue`, the SHA-384
// signature and the root's key are what Bouncy Castle used.
if (upper(authority('rsaEncryption')) !== upper(hex(corpus.certificates.rsaManufacturerCA)))
    throw new Error('rsaManufacturerCA issued again unchanged is not the corpus\'s');

if (upper(meterSignedWith('sha256WithRSAEncryption')) !== upper(hex(corpus.certificates.rsaMeter)))
    throw new Error('rsaMeter issued again unchanged is not the corpus\'s');


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

const digests = { 'sha-256': digest, 'sha-1': sha1(source.chain[0]) };

if (upper(digests['sha-1']) !== upper(sha1(hex(corpus.certificates.meter))))
    throw new Error('the SHA-1 digest is not the hash of the certificate in the corpus');

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
 * Who countersigns in the sixth family: `strangerMeter`'s key, a second party
 * under the same authority, so the countersignature can be checked by anybody
 * holding the corpus.
 */
if (corpus.privateKeys.strangerMeter.algorithm !== 'ESB256')
    throw new Error(`the corpus's strangerMeter signs with ${corpus.privateKeys.strangerMeter.algorithm}, not ESB256`);

const countersigner = hex(corpus.privateKeys.strangerMeter.keyD);

// The label-7 row asks each implementation to verify its countersignature
// under the key of the certificate `strangerMeter`, so that certificate must
// carry the key this generator countersigns with. Its uncompressed point is
// looked for in the certificate's bytes rather than parsed out of them: one
// occurrence of 65 bytes cannot be there by accident.
{
    const point = Buffer.from(brainpoolP256r1.getPublicKey(countersigner, false)).toString('hex').toUpperCase();

    if (upper(stranger).split(point).length !== 2)
        throw new Error('the certificate strangerMeter does not carry the key this generator countersigns with');
}

/**
 * Where the third family's x5u says a certificate may be found.
 *
 * `.invalid` is reserved and resolves for nobody [RFC 2606, Section 2], so no
 * run of this suite can reach anything, whatever a verifier decides to do with
 * the header.
 */
const URI = 'https://example.invalid/metrology/meter.der';


/**
 * The fourth family draws on the RSA hierarchy instead, because the
 * certificate it mints is an RSA certificate: the key an end-entity
 * certificate certifies is the key the message it travels in has to be signed
 * with, or the chain would not bind the message at all.
 */
const rsaAuthority = hex(corpus.certificates.rsaManufacturerCA);
const rsaKey       = corpus.privateKeys.rsaMeter.keyRsa;

if (corpus.privateKeys.rsaMeter.algorithm !== 'RS256')
    throw new Error(`the corpus's RSA meter signs with ${corpus.privateKeys.rsaMeter.algorithm}, ` +
                    'not RS256');


/** The algorithms the first family labels its thumbprint with. */
const LABELS = [
    {
        id:          'thumbprint-labelled-with-sha-256',
        algorithm:   -16,
        name:        'SHA-256',
        expected:    'accept',
        description: 'The control, and the one of these five messages that neither implementation ' +
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
    {
        id:          'thumbprint-labelled-with-sha-1',
        algorithm:   -14,
        name:        'SHA-1',
        digest:      'sha-1',
        class:       'survey',
        expected:    'reject',
        reason:      'the thumbprint is a correct SHA-1 of the certificate, and neither ' +
                     'implementation computes SHA-1',
        description: 'The fourth label after the control, and the first one here that really is ' +
                     'a hash algorithm: SHA-1, which RFC 9054 §3.1 registers for exactly this ' +
                     'field and recommends "Filter Only" - which the registry defines as not for ' +
                     'purposes that require collision resistance. So the digest beside it is not ' +
                     'the ' +
                     'SHA-256 of the three rows above but the correct SHA-1 of the end-entity ' +
                     'certificate, a value neither implementation can compute, which is why a ' +
                     'third encoder has to write it. The question is therefore a different one: ' +
                     'not whether an implementation checks that the label names a hash algorithm, ' +
                     'but what it does with a hash algorithm it does not have. Verifying is one ' +
                     'wrong answer; silently ignoring the thumbprint is the dangerous one, ' +
                     'because a verifier that skips a check it cannot perform accepts the chain ' +
                     'the thumbprint was there to pin. Measured: both refuse, and both say the ' +
                     'same thing. Until this row existed that sentence was that SHA-1 is not a ' +
                     'hash algorithm, which is false; since COSE.TS 87264c2 and Styx 59211b99 it ' +
                     'is that SHA-1 is a hash algorithm they do not compute. No error text is ' +
                     'judged in this family either way - the verdict is the row, and FINDINGS ' +
                     '§24 keeps the record of the wording. ' +
                     '`survey`, because the premise is a reading ' +
                     'and a property of these two rather than a rule: RFC 9054 keeps SHA-1 ' +
                     'registered for the situations that still need it, naming historic HSMs and ' +
                     'filtering, where collision resistance is not needed - and an implementation ' +
                     'that computed it and took x5t for a filter would be within the ' +
                     'specification verifying this message. Whether a thumbprint beside a sound ' +
                     'chain is a filter or a binding check is what the class leaves open, and it ' +
                     'is for the specification to settle rather than for this suite.',
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


/**
 * The sixth family: countersignatures neither implementation reads.
 *
 * Label 12, `Countersignature0 version 2` [RFC 9338], and label 7, the
 * `counter signature` of RFC 8152. Of §26's three questions only one can be
 * asked of either. "Instead of a chain" means nothing for
 * a header that is no certificate source. And `crit` names *protected* header
 * parameters [RFC 9052, Section 3.1], while this one "is then encoded as an
 * unprotected header parameter" [RFC 9338, Section 3.2]. So `crit: [12]` is
 * refused for naming a label absent from the protected bucket, which
 * `cose-crit:crit-label-absent` already asks, before anybody gets to whether
 * label 12 is understood. What is left is the one with an answer: whether a
 * header nobody reads may cost a sound message its verification.
 */
const COUNTERSIGNATURES = [
    {
        id:          'a-countersignature0-beside-the-chain',
        expected:    'accept',
        class:       'normative',
        carries:     'Countersignature0 version 2 (label 12), made with the key of strangerMeter, beside the chain',
        description: 'The sound chain in x5chain, and in the unprotected bucket a ' +
                     '`Countersignature0 version 2` [RFC 9338, label 12]: a bare ESB256 ' +
                     'signature over the Countersign_structure of Section 3.3, the context ' +
                     '"CounterSignature0V2", the body\'s protected bucket, no external data, the ' +
                     'payload and the body\'s signature, made with the key of the corpus\'s ' +
                     '`strangerMeter`, a second party certified by the same authority, and ' +
                     'verified by the generator before the file is written. Both implementations ' +
                     'carry the name and neither reads it: COSE.TS leaves it out of scope ' +
                     'because its algorithm and key "travel outside the message, by agreement", ' +
                     'and in Styx it is a constant nothing else reads. An implementation that ' +
                     'treats a header it does not read as fatal refuses this message. One that ' +
                     'read it, with the algorithm and the key from its context as RFC 9338 says, ' +
                     'would verify it as well, because the countersignature is sound. So the ' +
                     'row holds whoever implements what. `normative` on the sentence of RFC ' +
                     '9052 §3 the bag and URI rows of §26 stand on. There is no `crit` row ' +
                     'beside it: `crit` names protected header parameters and this one is ' +
                     'unprotected, so `crit: [12]` would be refused for naming a label absent ' +
                     'from the protected bucket, which cose-crit already asks.',
    },
    {
        id:          'a-counter-signature-of-rfc-8152-beside-the-chain',
        label:       7,
        expected:    'accept',
        class:       'normative',
        // A second question, asked of each implementation on its own: does
        // the countersignature verify under the key of the certificate
        // `strangerMeter`? `normative` since 2026-11-05, by the maintainer's
        // decision, although the "must be understood" of RFC 9052 §3.1 is
        // lowercase and the label deprecated: both implementations read it.
        countersignature: { signer: 'strangerMeter', expected: 'verifies', class: 'normative' },
        carries:     'counter signature (label 7) of RFC 8152, made with the key of strangerMeter, beside the chain',
        description: 'The sound chain in x5chain, and in the unprotected bucket the `counter ' +
                     'signature` of RFC 8152 [label 7]: a COSE_Signature whose protected bucket ' +
                     'names ESB256, signed over the Sig_structure of RFC 8152 Section 4.4 with the ' +
                     'context "CounterSignature", the body\'s protected bucket, its own, no ' +
                     'external data and the payload. Like the row above it is made with the key ' +
                     'of the corpus\'s `strangerMeter` and verified by the generator before the ' +
                     'file is written. Unlike it, it does not cover the body\'s signature, which ' +
                     'is the flaw RFC 9338 replaced it for. RFC 9052 §3.1 still says the label ' +
                     '"must be understood by new implementations, to remain compatible with ' +
                     'senders that adhere to" RFC 8152. Styx reads and verifies it since fb3314be, ' +
                     'COSE.TS since a42bffa. The verdict on the body asks ' +
                     'only what the row above asks, whether a header nobody reads may cost a sound ' +
                     'message its verification, and both verify. `normative` on the same ' +
                     'sentence. Whether a verifier also processes the countersignature is what ' +
                     'RFC 9052 asks, and no verdict on the body can show it, so the row asks it ' +
                     'separately: `countersignature` names whose key it must verify under, the ' +
                     'certificate `strangerMeter` of the corpus, and each implementation is asked ' +
                     'whether it does. That second question is `normative` too since 2026-11-05, ' +
                     'by the maintainer\'s decision: the "must" is lowercase and the label ' +
                     'deprecated, but both implementations read it, and only a required row ' +
                     'fails a run in which both stop reading it at once. There is no ' +
                     '`crit` row for the same reason as above, and besides, RFC 9052 §3.1 says ' +
                     'labels 0 to 7 "SHOULD be omitted" from crit.',
    },
];


/**
 * The fourth family: the parameters beside a signature algorithm.
 *
 * `parameters` keys into PARAMETERS above, and the certificate at position 0 of
 * the chain is `remint(...)` of it — the corpus's `rsaMeter` with that encoding
 * in both copies of its signature algorithm. Position 1 and the anchor are the
 * corpus's own, untouched.
 *
 * All three rows carry DER. That is not an aside: it is what separates this
 * family from the second one. A zero-length OCTET STRING is a perfectly good
 * DER encoding of a perfectly good ASN.1 value — the encoding rules have
 * nothing to say against it, and tools/DerArbiter confirms as much — and what
 * forbids it is RFC 4055 §5, one layer up. So this is the first family here
 * where a refusal is a refusal of a certificate that is written down correctly.
 */
const RFC4055 = [
    {
        id:          'the-parameter-rfc-4055-asks-for',
        parameters:  'a NULL',
        expected:    'accept',
        class:       'normative',
        description: 'The control of this family, and the one whose bytes carry the most: they ' +
                     'are byte for byte the message both implementations produce and agree on ' +
                     'for `cose-x509:chain-signed-with-rsa`, and the generator refuses to write ' +
                     'this file unless it reproduces them. So the RSA written out in this file — ' +
                     'from the modular exponentiation and the EMSA-PKCS1-v1_5 encoding up, ' +
                     'because the noble packages have none — makes the same 256 octets two ' +
                     'independent implementations make, and the certificate it mints with the ' +
                     'parameter the corpus has comes out as the corpus certificate itself, which ' +
                     'the generator also refuses to write this file without. Both pins matter ' +
                     'more here than in the families above, because this is the one family that ' +
                     'signs: without them the two rows below would be refusals of whatever this ' +
                     'generator got wrong about RSA or about DER.',
    },
    {
        id:          'a-parameter-rfc-4055-does-not-allow',
        parameters:  'a zero-length OCTET STRING',
        expected:    'reject',
        class:       'normative',
        reason:      'the signature algorithm carries a zero-length OCTET STRING where RFC 4055 ' +
                     '§5 requires a NULL or nothing, and the certificate is consistent in it: ' +
                     'both copies carry it and the issuer\'s signature covers one of them',
        description: 'The row §28 recorded as not measured, now minted. `sha256WithRSAEncryption` ' +
                     'with a zero-length OCTET STRING beside it instead of the NULL — in both of ' +
                     'the copies a certificate holds, with the issuer\'s signature made again ' +
                     'over the body that holds one of them, so the certificate is sound in every ' +
                     'respect but the one it is about. That consistency is why the row needed a ' +
                     'third encoder: patching a minted certificate reaches only an inconsistent ' +
                     'one, which both implementations refuse, and the refusals say so. Measured ' +
                     'here: Bouncy Castle reads this certificate, reports its parameters as `04 ' +
                     '00`, and verifies the signature, so Styx verified this message until ' +
                     '82af43fd; since then it refuses it as well, where it reads the chain, next ' +
                     'to the DER check. COSE.TS refuses it at the parse, saying the identifier ' +
                     '"carries parameters … where RFC 4055 allows a NULL or nothing at all". So ' +
                     'the row that was a divergence is an agreement now, and it is `normative` ' +
                     'since 2026-11-04 by the maintainer\'s decision. RFC 4055 §5 says the ' +
                     'parameters MUST be NULL, so nothing here is a valid certificate and ' +
                     'refusing it is right. Nothing in RFC 4055 or RFC 9360 is addressed to a ' +
                     'verifier of COSE messages, so this is a requirement of this suite: a third ' +
                     'implementation that verified the message would fail here for being lenient ' +
                     'about a field it does not interpret, and not for breaking a rule addressed ' +
                     'to it.',
    },
    {
        id:          'no-parameters-at-all',
        parameters:  'nothing at all',
        expected:    'accept',
        class:       'normative',
        description: 'The same identifier with no parameters after it — the AlgorithmIdentifier ' +
                     'two octets shorter, the TBSCertificate\'s own length redone, the signature ' +
                     'made over the result. This is the encoding RFC 4055 §2 calls "the correct ' +
                     'encoding", and §5 puts the requirement on the reader in its own words: ' +
                     '"Implementations MUST accept the parameters being absent as well as ' +
                     'present." So the row is `normative` on a sentence rather than on a reading, ' +
                     'and it is the one that gives the row above its meaning: without it a ' +
                     'refusal there could be a reader that simply demands the NULL, where the ' +
                     'pair shows exactly where each side draws its line. Both accept. COSE.TS ' +
                     'accepts absent parameters by a decision in `expectNoParameters` and not by ' +
                     'omission, which is what this row holds it to; Bouncy Castle reports the ' +
                     'parameters as null and verifies.',
    },
];


/**
 * The fifth family: what the key itself says it is for.
 *
 * `key` keys into KEY_ALGORITHMS above and `algorithm` is what the message is
 * signed with, and those two are the whole of each row: the certificate at
 * position 0 is `remintKey(...)` of the first, the message is signed with the
 * second, and the key is `rsaMeter`'s either way. Position 1 and the anchor
 * are the corpus's own.
 *
 * The rows are RFC 4055 Section 3.3's own scenarios. Scenario 1 is
 * `rsaEncryption`, where "no parameter validation is needed", and the suite
 * already has it four times over in `cose-x509`. Scenario 2 is id-RSASSA-PSS
 * with the parameters absent, where no validation is needed either. Scenario 3
 * is id-RSASSA-PSS with the parameters present, where "all parameters in the
 * signature structure algorithm identifier MUST match the parameters in the
 * key structure algorithm identifier except the saltLength field" — and for a
 * COSE message the signature structure is the `alg` header, so matching means
 * the message's PS* is the one the key's hash names.
 */
const KEY_TYPES = [
    {
        id:          'a-key-restricted-to-the-scheme-its-message-uses',
        key:         'id-RSASSA-PSS, with parameters naming SHA-256',
        algorithm:   PS256,
        expected:    'accept',
        class:       'normative',
        description: 'The control of this family: the key is restricted to RSASSA-PSS with ' +
                     'SHA-256 and the message is signed with PS256, which is that. It is also ' +
                     'the family\'s one anchor for the signing, because no row in this suite ' +
                     'carries a PSS signature these bytes could be compared against — a PSS ' +
                     'signature is salted, and Bouncy Castle draws its salt from a random this ' +
                     'file cannot reproduce. So what says the signature is right is that both ' +
                     'implementations verify this message, measured rather than pinned; the ' +
                     'certificate is pinned the other way, by reminting it with the identifier ' +
                     'the corpus has and requiring `rsaMeter` back octet for octet. Without ' +
                     'this row the four beside it would prove nothing: a message refused by ' +
                     'everybody is refused whatever anybody checks.',
    },
    {
        id:          'a-key-restricted-to-the-other-rsa-scheme',
        key:         'id-RSASSA-PSS, with parameters naming SHA-256',
        algorithm:   RS256,
        expected:    'reject',
        class:       'normative',
        reason:      'the certificate restricts the key to RSASSA-PSS with SHA-256 and the ' +
                     'message is signed with RSASSA-PKCS1-v1_5, which no key named by ' +
                     'id-RSASSA-PSS is for',
        description: 'The row the key type exists for. The same certificate as the control, ' +
                     'with the message signed PKCS #1 v1.5 instead — and the key is an RSA key, ' +
                     'so the signature is perfectly good arithmetic that an implementation ' +
                     'reading `rsaEncryption` would verify without hesitating, which is what ' +
                     'makes refusing it an answer. What forbids it is one sentence about intent: ' +
                     'id-RSASSA-PSS is in the subject public key info "when the RSA private key ' +
                     'owner wishes to limit the use of the public key exclusively to RSASSA-PSS" ' +
                     '[RFC 4055 §3.1]. Measured: COSE.TS attached the PS256 the parameters name ' +
                     'to the key and refused the message for stating another algorithm; ' +
                     'Bouncy Castle hands Styx an RsaKeyParameters that is indistinguishable ' +
                     'from the control\'s, keeping the identifier on the certificate structure ' +
                     'and not on the key, so Styx verified. Since 2026-11-05, by the ' +
                     'maintainer\'s decision, both honour the restriction: Styx since 70e1eac1 and ' +
                     'COSE.TS since 2cf2699 refuse any message under such a key that is not ' +
                     'RSASSA-PSS, and say so for the scheme. `normative` since 2026-11-05, by ' +
                     'the same decision, although RFC 4055 states the restriction as what the ' +
                     'owner wishes rather than as what a verifier must enforce, and RFC 9360 ' +
                     'says nothing about it at all: a required row is what fails a run in ' +
                     'which both implementations go lenient at once.',
    },
    {
        id:          'a-key-restricted-to-another-hash',
        key:         'id-RSASSA-PSS, with parameters naming SHA-384',
        algorithm:   PS256,
        expected:    'reject',
        class:       'normative',
        reason:      'the certificate restricts the key to RSASSA-PSS with SHA-384 and the ' +
                     'message is signed with PS256, and RFC 4055 §3.3 requires the signature\'s ' +
                     'parameters to be the key\'s',
        description: 'The same question one level finer, and the one RFC 4055 answers with a ' +
                     'MUST rather than with a wish. The scheme agrees — the key is for ' +
                     'RSASSA-PSS and the message is RSASSA-PSS — and the hash does not: the key ' +
                     'names SHA-384 and PS256 hashes with SHA-256. Scenario 3 of §3.3 says all ' +
                     'parameters of the signature must match the key\'s but the salt length, ' +
                     'which this message\'s do not. The parameter set is Bouncy Castle\'s own, ' +
                     'lifted out of `rsaPssManufacturerCA`, so nothing here turns on this ' +
                     'generator\'s idea of how to write one. Measured: COSE.TS attaches PS384 ' +
                     'and refuses PS256 beside it. Styx verified it until 2041ccbc, because ' +
                     'Bouncy Castle keeps the identifier on the certificate and not on the key, ' +
                     'and since then reads the restriction from the certificate and refuses ' +
                     'as well. So the row that was a divergence is an agreement now, and it is ' +
                     '`normative` since 2026-11-04 by the maintainer\'s decision: the half of ' +
                     'the pair with a MUST behind it, so an implementation that verifies this ' +
                     'message breaks RFC 4055 rather than declining an option.',
    },
    {
        id:          'a-key-whose-salt-is-a-floor-and-not-a-width',
        key:         'id-RSASSA-PSS, with parameters asking for a salt of 20',
        algorithm:   PS256,
        expected:    'accept',
        class:       'normative',
        description: 'The other half of scenario 3, and the one field a key and a signature are ' +
                     'read differently for. "The saltLength field in the signature parameters ' +
                     'MUST be greater or equal to that in the key parameters field" [RFC 4055 ' +
                     '§3.3] — so the key states a floor and not a width, and this key asks for ' +
                     'twenty octets, which is also what the DEFAULT of §3.1 gives. PS256 signs ' +
                     'with a salt as long as its hash [RFC 8230 §2], which is 32, and 32 is ' +
                     'above 20, so the message is one this key is for. Both accept. The row is ' +
                     'here because an implementation that read a key\'s parameters the way it ' +
                     'reads a signature\'s would require the 32 and refuse a certificate the ' +
                     'specification allows — and nothing else in this suite would notice, every ' +
                     'parameter set Bouncy Castle writes asking for exactly the hash\'s width. ' +
                     'These are Bouncy Castle\'s bytes with one octet lowered, so what the row ' +
                     'turns on is the twenty and nothing else.',
    },
    {
        id:          'a-restriction-that-names-no-hash',
        key:         'id-RSASSA-PSS, with no parameters',
        algorithm:   PS256,
        expected:    'accept',
        class:       'normative',
        description: 'The identifier alone, which is scenario 2 of §3.3: "The key is identified ' +
                     'by the id-RSASSA-PSS signature algorithm identifier, but the parameters ' +
                     'field is absent. In this case no parameter validation is needed." This is ' +
                     'also the one place in a certificate where that identifier may stand ' +
                     'without parameters at all — beside a signature value they "MUST be ' +
                     'present" — so a reader that learned to require them from the signature ' +
                     'side refuses this certificate, and both of these accept it. `normative` ' +
                     'on that sentence, and the shorter certificate besides: the ' +
                     'AlgorithmIdentifier is two octets smaller than `rsaEncryption`\'s, where ' +
                     'the parameterised ones are 52 larger, so the three rows of this family ' +
                     'move the subject public key info\'s length in both directions.',
    },
    {
        id:          'a-restriction-that-names-no-hash-with-the-other-scheme',
        key:         'id-RSASSA-PSS, with no parameters',
        algorithm:   RS256,
        expected:    'reject',
        class:       'normative',
        reason:      'the certificate restricts the key to RSASSA-PSS, naming no hash, and the ' +
                     'message is signed with RSASSA-PKCS1-v1_5',
        description: 'The second row\'s question with the parameters gone, and until ' +
                     '2026-11-05 the one row here where both implementations were lenient ' +
                     'together. Both verified this message: Styx for the reason it verified the ' +
                     'second row, and COSE.TS because the restriction here is to a scheme and ' +
                     'not to an algorithm, and "RSASSA-PSS with whichever hash" is not a name ' +
                     'COSE has to attach to the key. Since then, by the maintainer\'s decision, ' +
                     'both refuse it: Styx since 70e1eac1, and COSE.TS since 2cf2699, which ' +
                     'keeps the restriction on the certificate rather than on the key. So the ' +
                     'enforcement no longer comes from the parameters naming a hash but from ' +
                     'the identifier. §3.1 puts the restriction in the key owner\'s wishes and ' +
                     'no specification here turns it into a verifier\'s duty, and the row is ' +
                     '`normative` since 2026-11-05 all the same, by the maintainer\'s decision: ' +
                     'it is the shape §25 warns about, two implementations lenient at once, ' +
                     'which only a required row catches.',
    },
];


/**
 * The seventh family: an authority whose key is `id-RSASSA-PSS`.
 *
 * The family above asks what such a key may verify when it signed the message.
 * The restriction belongs to the key, though, and an authority's key signs
 * certificates: "when the RSA private key owner wishes to limit the use of the
 * public key exclusively to RSASSA-PSS" [RFC 4055, Section 3.1] says nothing
 * about which signatures. So here the key restricted is `rsaManufacturerCA`'s,
 * issued again by `rsaRoot` with only its key type changed, and what it is
 * asked about is the certificate it signed, `rsaMeter`, issued again with only
 * its signature changed. The message is signed RS256 with `rsaMeter`'s own key,
 * which is `rsaEncryption` throughout, so only the chain is under test.
 *
 * `authority` keys into KEY_ALGORITHMS and `signature` into ISSUER_SIGNATURES.
 * `anchor` puts the authority in the trust anchors instead of the chain, so
 * that the restriction is asked of a key that is trusted rather than
 * certified: the last certificate of a chain is checked against its anchor.
 * Every reject row has an accept row beside it that differs in one thing.
 */
const AUTHORITIES = [
    {
        id:          'an-authority-open-to-either-rsa-scheme',
        authority:   'rsaEncryption',
        signature:   'sha256WithRSAEncryption',
        expected:    'accept',
        description: 'The control: `rsaManufacturerCA` issued again by `rsaRoot` with its key as ' +
                     'the corpus writes it, `rsaEncryption`, over `rsaMeter` as the corpus signed ' +
                     'it. Both come out byte for byte the corpus\'s, which the generator ' +
                     'checks before it writes anything, so this row is the corpus\'s own RSA ' +
                     'chain and says that issuing the authority again is sound. `rsaEncryption` ' +
                     '"says what the key is and nothing about what it is for", so the PKCS #1 ' +
                     'v1.5 signature on the meter certificate is one this authority may make.',
    },
    {
        id:          'an-authority-restricted-to-the-other-rsa-scheme',
        authority:   'id-RSASSA-PSS, with no parameters',
        signature:   'sha256WithRSAEncryption',
        expected:    'reject',
        reason:      'the authority\'s key is restricted to RSASSA-PSS and the certificate ' +
                     'it signed is signed with RSASSA-PKCS1-v1_5',
        description: 'The same chain with the authority\'s key written as `id-RSASSA-PSS` ' +
                     'without parameters: the key restricted to RSASSA-PSS, naming no hash, and ' +
                     'the meter certificate under it signed with sha256WithRSAEncryption, which ' +
                     'is perfectly good arithmetic with that key. The restriction belongs to the ' +
                     'key, and this key signs certificates [RFC 4055, Section 3.1]. Styx since ' +
                     '7642de3d and COSE.TS since d1c7c54 refuse it. Before that, both verified ' +
                     'it: the restriction of 2026-11-05 was enforced only on the key that signed ' +
                     'the message. `normative` on the maintainer\'s decision of that day, ' +
                     'which honours the restriction although RFC 4055 states it as a wish.',
    },
    {
        id:          'an-authority-restricted-to-rsassa-pss-signing-with-it',
        authority:   'id-RSASSA-PSS, with no parameters',
        signature:   'RSASSA-PSS over SHA-256',
        expected:    'accept',
        description: 'The control for the row above: the same authority, naming no hash, and ' +
                     'the meter certificate signed with RSASSA-PSS over SHA-256, MGF1 over ' +
                     'SHA-256 and a 32-octet salt, with Bouncy Castle\'s parameter set. ' +
                     'Scenario 2 of RFC 4055 Section 3.3: no parameters, so no parameter ' +
                     'validation, and any RSASSA-PSS is one this key may make. It also says ' +
                     'that an authority written as `id-RSASSA-PSS` chains at all, so that the ' +
                     'row above is refused for its scheme and not for its key type.',
    },
    {
        id:          'an-authority-restricted-to-another-hash',
        authority:   'id-RSASSA-PSS, with parameters naming SHA-256',
        signature:   'RSASSA-PSS over SHA-384',
        expected:    'reject',
        reason:      'the authority\'s key is restricted to RSASSA-PSS with SHA-256 and the ' +
                     'certificate it signed is signed with RSASSA-PSS over SHA-384, and RFC 4055 ' +
                     '§3.3 requires the signature\'s parameters to be the key\'s',
        description: 'The authority\'s key restricted to RSASSA-PSS with SHA-256, and the ' +
                     'meter certificate under it signed with RSASSA-PSS over SHA-384, with ' +
                     'Bouncy Castle\'s SHA-384 parameter set. The scheme agrees and the hash ' +
                     'does not. Scenario 3 of RFC 4055 Section 3.3 is a MUST: "all parameters ' +
                     'in the signature structure algorithm identifier MUST match the parameters ' +
                     'in the key structure algorithm identifier except the saltLength field". ' +
                     'Styx since 7642de3d and COSE.TS since d1c7c54 refuse it; both verified it ' +
                     'before. `normative`.',
    },
    {
        id:          'an-authority-restricted-to-the-hash-it-signs-with',
        authority:   'id-RSASSA-PSS, with parameters naming SHA-256',
        signature:   'RSASSA-PSS over SHA-256',
        expected:    'accept',
        description: 'The control for the row above: the same authority and a meter certificate ' +
                     'signed with the RSASSA-PSS its parameters name, SHA-256, MGF1 over ' +
                     'SHA-256 and a 32-octet salt.',
    },
    {
        id:          'an-authority-restricted-to-sha-384-signing-with-it',
        authority:   'id-RSASSA-PSS, with parameters naming SHA-384',
        signature:   'RSASSA-PSS over SHA-384',
        expected:    'accept',
        description: 'The control for the signature two rows up: the same certificate signed ' +
                     'with RSASSA-PSS over SHA-384, under an authority whose parameters name ' +
                     'SHA-384. Without it, a SHA-384 signature this generator had got wrong ' +
                     'would make that row refused for a broken signature, and it would pass ' +
                     'for the wrong reason.',
    },
    {
        id:          'an-authority-whose-salt-is-a-floor',
        authority:   'id-RSASSA-PSS, with parameters asking for a salt of 20',
        signature:   'RSASSA-PSS over SHA-256',
        expected:    'accept',
        description: 'The salt length of a key is a floor and not a width [RFC 4055, Section ' +
                     '3.3], at the authority as at the signer: the key asks for at least twenty ' +
                     'octets and the meter certificate is signed with a 32-octet salt. An ' +
                     'implementation that compared an authority\'s parameters with the ' +
                     'signature\'s for equality would refuse it.',
    },
    {
        id:          'an-anchor-restricted-to-the-other-rsa-scheme',
        authority:   'id-RSASSA-PSS, with no parameters',
        signature:   'sha256WithRSAEncryption',
        anchor:      true,
        expected:    'reject',
        reason:      'the trust anchor\'s key is restricted to RSASSA-PSS and the ' +
                     'certificate it signed is signed with RSASSA-PKCS1-v1_5',
        description: 'The second row\'s question asked of a trust anchor: the chain is ' +
                     '`rsaMeter` alone, as the corpus signed it, and the anchor is ' +
                     '`rsaManufacturerCA` with its key written as `id-RSASSA-PSS` without ' +
                     'parameters. That certificate is not in the corpus, so it travels in the ' +
                     'row\'s `anchorCertificates`. A key that is trusted is restricted as ' +
                     'much as one that is certified. Both implementations check the last ' +
                     'certificate against its anchor with the method that checks each ' +
                     'certificate against its issuer, so both refuse it since 7642de3d and ' +
                     'd1c7c54. `normative`, as the second row.',
    },
    {
        id:          'an-anchor-open-to-either-rsa-scheme',
        authority:   'rsaEncryption',
        signature:   'sha256WithRSAEncryption',
        anchor:      true,
        expected:    'accept',
        description: 'The control for the row above: the same anchor with its key as the corpus ' +
                     'writes it, `rsaEncryption`, carried the same way, in `anchorCertificates`. ' +
                     'It is byte for byte the corpus\'s `rsaManufacturerCA`, so this also ' +
                     'says that a chain of `rsaMeter` alone ends at an anchor both ' +
                     'implementations accept.',
    },
];


const cases = [

    ...LABELS.map(entry => ({
        id:                   entry.id,
        // Per row, because one of them records a verdict rather than requiring
        // it: see LABELS above for which and why.
        class:                entry.class ?? 'normative',
        message:              upper(sign1({ ...source,
                                            thumbprint: { algorithm: entry.algorithm,
                                                          digest:    digests[entry.digest ?? 'sha-256'] } })),
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

    ...COUNTERSIGNATURES.map(entry => ({
        id:            entry.id,
        class:         entry.class,
        message:       upper(sign1({ ...source,
                                     ...(entry.label === 7 ? { countersigner8152: countersigner }
                                                           : { countersigner }) })),
        trustAnchors:  ['metrologyRoot'],
        expected:      entry.expected,
        ...(entry.countersignature ? { countersignature: { label: entry.label, ...entry.countersignature } } : {}),
        certificates:  2,
        der:           true,
        headers:       entry.carries,
        computedBy:    'tools/X509Cases',
        description:   entry.description,
    })),

    ...RFC4055.map(entry => ({
        id:            entry.id,
        // Per row again, and both classes appear: see RFC4055 above.
        class:         entry.class,
        message:       upper(sign1({
                           payload:    source.payload,
                           chain:      [remint(PARAMETERS[entry.parameters]), rsaAuthority],
                           signingKey: rsaKey,
                           algorithm:  RS256,
                       })),
        trustAnchors:  ['rsaRoot'],
        expected:      entry.expected,
        ...(entry.reason ? { reason: entry.reason } : {}),
        certificates:  2,
        // All three of them, which is this family's point: see RFC4055 above.
        der:           true,
        parameters:    `${entry.parameters}, beside sha256WithRSAEncryption`,
        computedBy:    'tools/X509Cases',
        description:   entry.description,
    })),

    ...KEY_TYPES.map(entry => ({
        id:            entry.id,
        class:         entry.class,
        message:       upper(sign1({
                           payload:    source.payload,
                           chain:      [remintKey(KEY_ALGORITHMS[entry.key]), rsaAuthority],
                           signingKey: rsaKey,
                           algorithm:  entry.algorithm,
                       })),
        trustAnchors:  ['rsaRoot'],
        expected:      entry.expected,
        ...(entry.reason ? { reason: entry.reason } : {}),
        certificates:  2,
        // Every one of them, as in the family above: what a certificate may
        // say is not a question the encoding rules have an opinion about.
        der:           true,
        keyType:       `${entry.key}, over a message signed with ` +
                       `${entry.algorithm === PS256 ? 'PS256' : 'RS256'}`,
        computedBy:    'tools/X509Cases',
        description:   entry.description,
    })),

    ...AUTHORITIES.map(entry => ({
        id:            entry.id,
        // Every row is normative: see AUTHORITIES above.
        class:         'normative',
        message:       upper(sign1({
                           payload:    source.payload,
                           chain:      entry.anchor
                                           ? [meterSignedWith(entry.signature)]
                                           : [meterSignedWith(entry.signature), authority(entry.authority)],
                           signingKey: rsaKey,
                           algorithm:  RS256,
                       })),
        trustAnchors:  entry.anchor ? [] : ['rsaRoot'],
        ...(entry.anchor ? { anchorCertificates: [upper(authority(entry.authority))] } : {}),
        expected:      entry.expected,
        ...(entry.reason ? { reason: entry.reason } : {}),
        certificates:  entry.anchor ? 1 : 2,
        der:           true,
        authority:     `${entry.anchor ? 'a trust anchor' : 'an authority'} whose key is ` +
                       `${entry.authority}, over a certificate signed with ${entry.signature}`,
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
    // cose-x509:chain-signed-with-rsa, 1912 bytes. This one pins more than the
    // other two: the message is RSA-signed, so reproducing it says that the
    // 256 octets this file computes are the 256 octets two independent
    // implementations compute, and that the certificate it mints is theirs.
    'the-parameter-rfc-4055-asks-for':
        'F91EC294B639FF648C54AE86C17C407E838383FBC9A75C2AE674203E6B743B1B',
};

// And the two reminting pins, which the control above implies for the first
// and cannot give at all for the second: minting the certificate with the
// field the corpus has gives the corpus certificate back, every octet of it,
// whichever of the two fields is being varied. Stated on their own so that a
// break here reads as a break in the minting rather than in a message — and
// for the fifth family this is the only pin there is, a PSS signature being
// salted and so not comparable with anything either implementation wrote.
for (const [what, reminted] of [['parameter', remint(PARAMETERS['a NULL'])],
                                ['key type',  remintKey(KEY_ALGORITHMS['rsaEncryption'])]])
    if (upper(reminted) !== upper(hex(corpus.certificates.rsaMeter)))
        throw new Error(`reminting rsaMeter with the ${what} the corpus has does not reproduce ` +
                        'it — refusing to write');

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

    // The sixth family: the countersignature is taken out of the message and
    // verified against the structure rebuilt from the message's own bytes.
    if (COUNTERSIGNATURES.some(candidate => candidate.id === entry.id)) {

        const parts = sign1Parts(message);
        const label = COUNTERSIGNATURES.find(candidate => candidate.id === entry.id).label ?? 12;

        if (parts.unprotected.size !== 1 || !parts.unprotected.has(label))
            throw new Error(`${entry.id} does not carry label ${String(label)} and nothing else unprotected`);

        let countersignature, toBeSigned;

        if (label === 12) {
            countersignature = byteString(parts.unprotected.get(12));
            toBeSigned       = countersignStructure(parts);
        }
        else {
            const signature  = coseSignatureParts(parts.unprotected.get(7));
            countersignature = signature.signature;
            toBeSigned       = counterSignatureStructure({ ...parts, signProtected: signature.protectedBucket });
        }

        if (!brainpoolP256r1.verify(countersignature, sha256(toBeSigned),
                                    brainpoolP256r1.getPublicKey(countersigner, false),
                                    { prehash: false, lowS: false }))
            throw new Error(`${entry.id} carries a countersignature that does not verify`);

        if (chain === null ||
            chain.length !== 2 ||
            upper(chain[0]) !== upper(source.chain[0]) ||
            upper(chain[1]) !== upper(source.chain[1]))
            throw new Error(`${entry.id} does not carry the chain as it was minted`);

        if (thumbprint !== null || criticalIn(message) !== null)
            throw new Error(`${entry.id} carries a thumbprint or a crit, which this family does not`);

        continue;

    }

    // The seventh family: the certificates are the ones the case names, the
    // authority's key type is stated exactly once, and the meter certificate
    // states its signature algorithm in both of its copies.
    const issuing = AUTHORITIES.find(candidate => candidate.id === entry.id);

    if (issuing !== undefined) {

        const meter    = meterSignedWith(issuing.signature);
        const issuer   = authority(issuing.authority);
        const expected = issuing.anchor ? [meter] : [meter, issuer];

        if (chain === null ||
            chain.length !== expected.length ||
            chain.some((certificate, at) => upper(certificate) !== upper(expected[at])))
            throw new Error(`${entry.id} does not carry the chain its case claims`);

        const anchors = entry.anchorCertificates ?? [];

        if (issuing.anchor
                ? anchors.length !== 1 || anchors[0] !== upper(issuer) || entry.trustAnchors.length !== 0
                : anchors.length !== 0 || entry.trustAnchors.join() !== 'rsaRoot')
            throw new Error(`${entry.id} does not carry the anchor its case claims`);

        if (upper(issuer).split(upper(KEY_ALGORITHMS[issuing.authority])).length - 1 !== 1 ||
            !upper(issuer).includes(upper(hex(issuerKey.n))))
            throw new Error(`${entry.id} does not certify the authority's key as the key type its case names`);

        if (upper(meter).split(upper(ISSUER_SIGNATURES[issuing.signature].identifier)).length - 1 !== 2)
            throw new Error(`${entry.id} does not state the signature its case names in both copies`);

        if (thumbprint !== null)
            throw new Error(`${entry.id} carries a thumbprint, which this family does not`);

        continue;

    }

    if (chain === null || chain.length !== 2)
        throw new Error(`${entry.id} does not carry a chain of two certificates`);

    const restricted = KEY_TYPES.find(candidate => candidate.id === entry.id);

    if (restricted !== undefined) {

        if (upper(chain[0]) !== upper(remintKey(KEY_ALGORITHMS[restricted.key])) ||
            upper(chain[1]) !== upper(rsaAuthority))
            throw new Error(`${entry.id} does not carry the chain its case claims`);

        // The key type is read back out of the certificate, and so is the fact
        // that the key under it is still `rsaMeter`'s: a row that certified
        // some other key would be refused for that, and the restriction the
        // row is about would never be reached. The modulus is what ties the
        // certificate to the key the message was signed with.
        const identifier = upper(KEY_ALGORITHMS[restricted.key]);

        if (upper(chain[0]).split(identifier).length - 1 !== 1)
            throw new Error(`${entry.id} does not state the key type its case names, exactly once`);

        if (!upper(chain[0]).includes(upper(hex(rsaKey.n))))
            throw new Error(`${entry.id} does not certify the key its message is signed with`);

        if (thumbprint !== null)
            throw new Error(`${entry.id} carries a thumbprint, which this family does not`);

        continue;

    }

    const parameterised = RFC4055.find(candidate => candidate.id === entry.id);

    if (parameterised !== undefined) {

        if (upper(chain[0]) !== upper(remint(PARAMETERS[parameterised.parameters])) ||
            upper(chain[1]) !== upper(rsaAuthority))
            throw new Error(`${entry.id} does not carry the chain its case claims`);

        // The parameter is read back out of the certificate rather than
        // believed of the variable it was minted from, and *both* copies of it
        // are counted — a row that was consistent in one place only would be
        // refused by everything and would prove nothing. The whole
        // AlgorithmIdentifier is compared and not just the parameter, so that
        // the row with no parameters is held to the shorter length octet too.
        const identifier = upper(algorithmIdentifier(hex(OID_SHA256_WITH_RSA),
                                                     PARAMETERS[parameterised.parameters]));
        const copies     = upper(chain[0]).split(identifier).length - 1;

        if (copies !== 2)
            throw new Error(`${entry.id} states the parameter its case names ${String(copies)} ` +
                            'times, not twice');

        if (thumbprint !== null)
            throw new Error(`${entry.id} carries a thumbprint, which this family does not`);

        continue;

    }

    if (entry.thumbprintAlgorithm !== undefined) {

        // The first family: the label is the one the case claims, the digest
        // beside it is the true hash of the end-entity certificate under the
        // algorithm that label names — the property that makes a skipped check
        // verify the message rather than stumble over a thumbprint that was
        // wrong anyway — and the chain is the one the corpus minted, so the
        // label is the only thing at issue. Three of these rows carry a
        // SHA-256 digest under a label that is not SHA-256; the fourth carries
        // the SHA-1 its label really names.
        if (thumbprint === null ||
            !entry.thumbprintAlgorithm.startsWith(`${String(thumbprint.algorithm)} `))
            throw new Error(`${entry.id} does not carry the label it claims`);

        if (upper(thumbprint.digest) !== upper(thumbprint.algorithm === -14 ? digests['sha-1']
                                                                           : digest))
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
                               'that is not a hash algorithm, or with one that is and that ' +
                               'neither of them computes (§24, normative but for the SHA-1 row), ' +
                               'a certificate ' +
                               'written down in an encoding that is not DER (§25, normative ' +
                               'since 2026-11-02), and a certificate source neither ' +
                               'implementation reads — x5bag and x5u (§26, normative where an ' +
                               'unread header must not cost a sound message its verification, ' +
                               'survey where a verifier that read the label would be right to ' +
                               'answer differently), and a certificate whose signature ' +
                               'algorithm carries a parameter RFC 4055 §5 does not allow, ' +
                               'consistently in both of the copies a certificate holds — which ' +
                               'no patch can reach, so this family mints its certificate and ' +
                               'signs it (§28, normative where RFC 4055 puts the rule on the ' +
                               'reader in its own words, survey where the two disagree), and an ' +
                               'authority or a trust anchor whose key is id-RSASSA-PSS over a ' +
                               'certificate it signed, which has to be issued again under the ' +
                               'root (§28, normative). A row may carry `anchorCertificates`, ' +
                               'trust anchors that are not in the corpus, as DER in hex. ' +
                               'Generated by tools/X509Cases from the noble primitives and the ' +
                               'RSA written out in it; the chain, the signing key and the ' +
                               'issuing key come from cose-x509-corpus.json, and three ' +
                               'families\' controls are byte for byte messages both ' +
                               'implementations produce. Each case ' +
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
                       : entry.encoding ?? entry.headers ?? entry.parameters ?? entry.keyType ??
                         entry.authority}` +
                `${entry.thumbprintOver !== undefined
                       ? `, x5t over ${entry.thumbprintOver}`
                       : ''}`);

for (const [id, pinned] of Object.entries(CONTROLS))
    console.log(`  the control ${id} reproduces a message both implementations produce ` +
                `(sha256 ${pinned.slice(0, 16)}…)`);
