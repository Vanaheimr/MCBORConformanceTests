/*
 * Metrological CBOR conformance runner for the TypeScript reference
 * implementation (MetrologicalCBOR.TS, imported from source). Reads the
 * shared vector files, executes every check with the implementation's DEFAULT
 * settings, and writes the observed behaviour as JSON. All judging happens in
 * the comparison driver — this program only records what the implementation
 * does.
 *
 * JSON conversion goes through the library's exact text path
 * (mcborToJsonText / jsonTextToMcbor), which reads and writes the digits as
 * written — the tree path through JSON.parse cannot, and is not under test.
 *
 * Usage: tsx runner.ts <output.json> <vectorFileOrDir> [more...]
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join }                                      from 'node:path';

import {
    decodeMetrologicalValue,
    encodeMetrologicalValue,
    formatMetrologicalValue,
    parseMetrologicalValue,
    mcborToJsonText,
    jsonTextToMcbor,
    decodeHex,
    encodeToHex,
    bytesToHex,
    hexToBytes,
    type MetrologicalValue,
} from '../../libs/MetrologicalCBOR.TS/src/index.ts';

import {
    algorithmByName,
    cbor,
    CoseCertificateChain,
    CoseCertificateHash,
    CoseHeaders,
    CoseEncrypt,
    CoseEncrypt0,
    CoseKey,
    CoseMac,
    CoseMac0,
    CoseRecipient,
    CoseSign,
    CoseSign1,
    curveByName,
    HeaderLabel,
    label,
    X509Certificate,
} from '../../libs/COSE.TS/src/index.ts';
import type { CborEntry, CoseSignature, Verification } from '../../libs/COSE.TS/src/index.ts';


type Check = Record<string, unknown>;

const ok      = (): Check                    => ({ status: 'ok' });
const okHex   = (hex: string): Check         => ({ status: 'ok', hex });
const okText  = (text: string): Check        => ({ status: 'ok', text });
const okJson  = (json: string): Check        => ({ status: 'ok', json });

function error(cause: unknown): Check {
    if (cause instanceof Error) {
        const code = (cause as { code?: unknown }).code;
        return { status: 'error', message: typeof code === 'string' ? `${code}: ${cause.message}` : cause.message };
    }
    return { status: 'error', message: String(cause) };
}

function capture(action: () => Check): Check {
    try {
        return action();
    }
    catch (cause) {
        return error(cause);
    }
}


// ------------------------------------------------------------- primitives --

function encodeCanonical(value: MetrologicalValue): string {
    return bytesToHex(encodeMetrologicalValue(value));
}

function parseTextToHex(text: string): Check {
    return capture(() => okHex(encodeCanonical(parseMetrologicalValue(text))));
}

function jsonToCborHex(jsonText: string): Check {
    return capture(() => okHex(bytesToHex(jsonTextToMcbor(jsonText))));
}


// ------------------------------------------------------------------ suites --

interface VectorCase {
    id:           string;
    hex?:         string;
    text?:        string;
    parseTexts?:  { text: string }[];
    cborHex?:     string;
    json?:        string;

    // cose-sign / cose-verify
    shape?:            string;
    algorithm?:        string;
    curve?:            string;
    keyD?:             string;
    keyIdentifier?:    string;
    algorithm2?:       string;
    curve2?:           string;
    keyD2?:            string;
    keyIdentifier2?:   string;
    payload?:          string;
    externalAad?:      string;
    detached?:         boolean;
    tagged?:           boolean;
    message?:          string;

    // cose-crit
    crit?:             number[];
    protectedExtra?:   [number, number][];
    critUnprotected?:  boolean;

    // cose-mac0 / cose-mac0-verify
    key?:              string;

    // cose-encrypt / cose-decrypt
    iv?:               string;
    recipients?:       { algorithm: string; key: string; keyIdentifier?: string }[];
    expectedTag?:      string;
    expectedWrapped?:  string;
    detachedCiphertext?: string;

    // cose-x509 / cose-x509-validate
    signer?:           string;
    chain?:            string[];
    trustAnchors?:     string[];
    thumbprintOf?:     string;
    critical?:         boolean;
    expected?:         string;
}


/**
 * The certificate corpus, minted by Bouncy Castle and read back here.
 *
 * It is loaded from beside the vector file rather than compiled in, because
 * the cross-feed suites are written to a directory of their own and have to
 * find the very same certificates there.
 */
interface Corpus {
    validateAt:   string;
    certificates: Record<string, string>;
    privateKeys:  Record<string, { algorithm: string; curve?: string; keyD: string }>;
}

let corpus: Corpus | null = null;

function corpusOrThrow(): Corpus {

    if (corpus === null)
        throw new Error('No certificate corpus was found beside the vector file!');

    return corpus;

}

function certificateOf(name: string): X509Certificate {

    const encoded = corpusOrThrow().certificates[name];

    if (encoded === undefined)
        throw new Error(`The certificate corpus holds no certificate '${name}'!`);

    return X509Certificate.parse(hexToBytes(encoded));

}

function corpusKeyOf(name: string): CoseKey {

    const entry = corpusOrThrow().privateKeys[name];

    if (entry === undefined)
        throw new Error(`The certificate corpus holds no private key for '${name}'!`);

    return keyOf(entry.curve, entry.keyD, entry.algorithm);

}

function runValues(testCase: VectorCase, checks: Record<string, Check>): void {

    let value: MetrologicalValue | undefined;

    checks['decode'] = capture(() => {
        value = decodeMetrologicalValue(hexToBytes(testCase.hex!));
        return ok();
    });

    if (value !== undefined) {
        const decoded = value;
        checks['reencode']    = capture(() => okHex(encodeCanonical(decoded)));
        checks['format']      = capture(() => okText(formatMetrologicalValue(decoded)));
        checks['formatAscii'] = capture(() => okText(formatMetrologicalValue(decoded, { ascii: true })));
    }

    if (testCase.text !== undefined)
        checks['parse'] = parseTextToHex(testCase.text);

    testCase.parseTexts?.forEach((entry, index) => {
        checks[`parse:${index}`] = parseTextToHex(entry.text);
    });

}

function runValuesInvalid(testCase: VectorCase, checks: Record<string, Check>): void {

    if (testCase.hex !== undefined)
        checks['decode'] = capture(() => {
            const value = decodeMetrologicalValue(hexToBytes(testCase.hex!));
            return okHex(encodeCanonical(value));
        });

    if (testCase.text !== undefined)
        checks['parse'] = parseTextToHex(testCase.text);

}

/**
 * Hand raw CBOR to the generic reader and record what happened.
 *
 * Everything else in this file goes through a metrological entry point, which
 * means the layer beneath - the CBOR reader itself - is only ever exercised on
 * bytes that were already going to be a reading. These cases exercise it
 * directly: a text string that is not UTF-8 and a document nested past any
 * sensible bound are refused by the reader, not by anything above it.
 *
 * The re-encoded bytes are recorded for the accepted cases as well, so that
 * "both accepted it" is not mistaken for "both read the same thing".
 */
function runCborRobustness(testCase: VectorCase, checks: Record<string, Check>): void {

    checks['decode'] = capture(() => okHex(encodeToHex(decodeHex(testCase.hex!))));

}

/**
 * Encode a value with this library's DEFAULT writer options.
 *
 * There is nothing to choose here: `encodeMetrologicalValue` writes through
 * `encode`, whose default is `mapKeys: 'sorted'`, and no option makes it write
 * otherwise. That is the whole reason this suite exists — the other side *does*
 * have a choice, its default is the non-deterministic one, and every other
 * comparison in this project hands it `Canonical` explicitly. This records what
 * a caller who asked for nothing in particular gets, on both sides.
 */
function runDefaultEncoding(testCase: VectorCase, checks: Record<string, Check>): void {

    checks['defaultEncoding'] = capture(() =>
        okHex(bytesToHex(encodeMetrologicalValue(parseMetrologicalValue(testCase.text!)))));

}

function runDocuments(testCase: VectorCase, checks: Record<string, Check>): void {

    let json: string | undefined;

    checks['toJson'] = capture(() => {
        json = mcborToJsonText(hexToBytes(testCase.cborHex!));
        return okJson(json);
    });

    if (json !== undefined)
        checks['roundtrip'] = jsonToCborHex(json);

}

/**
 * String escapes, in whichever direction the case names.
 *
 * The reading direction is the one that matters: this implementation carries
 * its own JSON reader, and therefore its own unescaper, which no vector in this
 * project had ever reached - not one of the JSON-carrying cases contained a
 * backslash. The writing direction records what each side produces without
 * insisting they agree, because JSON permits several spellings of one string;
 * what has to hold is that each reads its own output back.
 */
function runJsonEscapes(testCase: VectorCase, checks: Record<string, Check>): void {

    if (testCase.json !== undefined)
        checks['toCbor'] = jsonToCborHex(testCase.json);

    if (testCase.cborHex !== undefined) {

        let json: string | undefined;

        checks['toJson'] = capture(() => {
            json = mcborToJsonText(hexToBytes(testCase.cborHex!));
            return okJson(json);
        });

        if (json !== undefined)
            checks['roundtrip'] = jsonToCborHex(json);

    }

}

function runJsonToCbor(testCase: VectorCase, checks: Record<string, Check>): void {
    checks['toCbor'] = jsonToCborHex(testCase.json!);
}

function runParseTexts(testCase: VectorCase, checks: Record<string, Check>): void {
    checks['parse'] = parseTextToHex(testCase.text!);
}


// -------------------------------------------------------------------- COSE --

/**
 * The key a case signs or verifies with. Both halves are derived from the
 * private scalar, so a verifier and a signer can never disagree about which
 * public key belongs to which private one.
 */
function keyOf(curveName: string | undefined, dHex: string,
               algorithmName: string, keyIdentifier?: string): CoseKey {

    const algorithm = algorithmByName(algorithmName);

    if (algorithm === null)
        throw new Error(`unknown algorithm '${algorithmName}'`);

    const parts = {
        algorithm,
        keyIdentifier: keyIdentifier !== undefined ? hexToBytes(keyIdentifier) : null,
    };

    // An algorithm key pair has no curve to name: its parameter set comes
    // from the algorithm, and its private key is the seed.
    if (algorithm.family === 'mldsa')
        return CoseKey.fromAkpSeed(algorithm, hexToBytes(dHex), parts);

    if (curveName === undefined)
        throw new Error(`the algorithm '${algorithmName}' needs a curve`);

    const curve = curveByName(curveName);

    if (curve === null)
        throw new Error(`unknown curve '${curveName}'`);

    // fromPrivateScalar routes an OKP curve onward by itself, so EdDSA needs
    // no case of its own here.
    return CoseKey.fromPrivateScalar(curve, hexToBytes(dHex), parts);

}

const optionalBytes = (hex?: string): Uint8Array | null =>
    hex !== undefined ? hexToBytes(hex) : null;

const primaryKey   = (testCase: VectorCase): CoseKey =>
    keyOf(testCase.curve, testCase.keyD!, testCase.algorithm!, testCase.keyIdentifier);

const secondaryKey = (testCase: VectorCase): CoseKey =>
    keyOf(testCase.curve2, testCase.keyD2!, testCase.algorithm2!, testCase.keyIdentifier2);


/**
 * Sign one case, recording what a second implementation has to agree with:
 * the structure that was signed, the signature bytes, the whole message, and
 * the key thumbprints.
 *
 * Signing is deterministic (RFC 6979), which is what makes the signature bytes
 * comparable at all — a randomized signature is a different 64 bytes every
 * time and says nothing about whether two implementations agree.
 */
/**
 * Sign a message whose protected bucket carries a `crit` demand, then verify it.
 *
 * Both halves matter and for different reasons. Signing has to succeed for the
 * message to exist at all — except in the one case where the demand itself is
 * malformed, where refusing to build it is a perfectly good answer and the
 * suite says so. Verifying is where the demand is either honoured or ignored,
 * and a verifier that ignores `crit` passes every other suite in this project.
 *
 * The message is verified with the same key that signed it, so a false verdict
 * can only come from the crit processing: the signature is over bytes this
 * implementation produced one line earlier.
 */
function runCoseCrit(testCase: VectorCase, checks: Record<string, Check>): void {

    const key     = primaryKey(testCase);
    const payload = hexToBytes(testCase.payload!);

    let message: CoseSign1 | undefined;

    checks['message'] = capture(() => {

        let protectedHeader = CoseHeaders.create(key.algorithm);

        for (const [extra, value] of testCase.protectedExtra ?? [])
            protectedHeader = protectedHeader.set(label(extra), cbor.int(value));

        const crit = cbor.array((testCase.crit ?? []).map(each => label(each)));

        // Moving the demand to the unprotected bucket is the point of one case:
        // there it is outside the signature, so anyone in the middle can strip
        // it, which is why RFC 9052 Section 3.1 requires it to be protected.
        let unprotectedHeader: CoseHeaders | null = null;

        if (testCase.critUnprotected === true)
            unprotectedHeader = new CoseHeaders([[label(HeaderLabel.critical), crit]]);
        else
            protectedHeader = protectedHeader.set(label(HeaderLabel.critical), crit);

        message = CoseSign1.signWithHeaders(payload, key, protectedHeader, unprotectedHeader);

        return okHex(bytesToHex(message.toBytes()));

    });

    checks['verify'] = message === undefined
                           ? { status: 'error', message: 'the message could not be built' }
                           : capture(() => verification(message!.verify(key)));

}


function runCoseSign(testCase: VectorCase, checks: Record<string, Check>): void {

    const key         = primaryKey(testCase);
    const payload     = hexToBytes(testCase.payload!);
    const externalAad = optionalBytes(testCase.externalAad);

    const options = {
        externalAad,
        detachPayload: testCase.detached === true,
        tagged:        testCase.tagged !== false,
    };

    checks['thumbprint'] = capture(() => okHex(bytesToHex(key.thumbprint())));

    switch (testCase.shape) {

        case 'sign1':
        case 'sign1-app-algorithm': {

            const message = testCase.shape === 'sign1'
                                ? CoseSign1.sign(payload, key, options)
                                : CoseSign1.signWithApplicationAlgorithm(payload, key, options);

            checks['toBeSigned'] = capture(() => okHex(bytesToHex(
                CoseSign1.toBeSigned(message.protectedHeaderBytes, payload, externalAad))));
            checks['signature']  = capture(() => okHex(bytesToHex(message.signature)));
            checks['message']    = capture(() => okHex(bytesToHex(message.toBytes())));

            break;

        }

        case 'sign': {

            const second  = secondaryKey(testCase);
            const message = CoseSign.sign(payload, key, options).addSignature(second, options);

            checks['toBeSigned']  = capture(() => okHex(bytesToHex(
                message.toBeSigned(message.signatures[0]!, { externalAad }))));
            checks['toBeSigned2'] = capture(() => okHex(bytesToHex(
                message.toBeSigned(message.signatures[1]!, { externalAad }))));
            checks['signature']   = capture(() => okHex(bytesToHex(message.signatures[0]!.signature)));
            checks['signature2']  = capture(() => okHex(bytesToHex(message.signatures[1]!.signature)));
            checks['message']     = capture(() => okHex(bytesToHex(message.toBytes())));
            checks['thumbprint2'] = capture(() => okHex(bytesToHex(second.thumbprint())));

            break;

        }

        case 'countersign': {

            const second  = secondaryKey(testCase);
            const signed  = CoseSign1.sign(payload, key, options);
            const message = signed.addCountersignature(second, options);

            checks['toBeSigned']  = capture(() => okHex(bytesToHex(
                CoseSign1.toBeSigned(signed.protectedHeaderBytes, payload, externalAad))));
            checks['toBeSigned2'] = capture(() => okHex(bytesToHex(
                message.toBeCountersigned(message.countersignatures[0]!, { externalAad }))));
            checks['signature']   = capture(() => okHex(bytesToHex(message.signature)));
            checks['signature2']  = capture(() => okHex(bytesToHex(message.countersignatures[0]!.signature)));
            checks['message']     = capture(() => okHex(bytesToHex(message.toBytes())));
            checks['thumbprint2'] = capture(() => okHex(bytesToHex(second.thumbprint())));

            break;

        }

        default:
            checks['message'] = error(`unknown COSE shape '${String(testCase.shape)}'`);

    }

}


/**
 * Sign a message carrying a certificate chain, and record what the other
 * implementation has to agree with: the message, the end-entity certificate's
 * thumbprint and subject, and the verdict on the chain.
 *
 * The chain goes into the *protected* bucket. That is not a formality: an
 * unprotected one can be swapped for another without disturbing the signature,
 * and a verifier that then reported the new subject as the signer would have
 * been told who signed by somebody who did not.
 */
function runCoseX509(testCase: VectorCase, checks: Record<string, Check>): void {

    const at       = new Date(corpusOrThrow().validateAt);
    const key      = corpusKeyOf(testCase.signer!);
    const chain    = (testCase.chain ?? []).map(certificateOf);
    const anchors  = (testCase.trustAnchors ?? []).map(certificateOf);
    const payload  = hexToBytes(testCase.payload!);

    const parameters: CborEntry[] = [
        [label(HeaderLabel.algorithm), cbor.int(key.algorithm!.id)],
    ];

    if (testCase.critical === true)
        parameters.push([label(HeaderLabel.critical), cbor.array([label(HeaderLabel.x5Chain)])]);

    parameters.push([label(HeaderLabel.x5Chain), new CoseCertificateChain(chain).toCbor()]);

    if (testCase.thumbprintOf !== undefined)
        parameters.push([label(HeaderLabel.x5T),
                         CoseCertificateHash.from(certificateOf(testCase.thumbprintOf)).toCbor()]);

    const message = CoseSign1.signWithHeaders(payload, key, new CoseHeaders(parameters));

    checks['message']    = capture(() => okHex (bytesToHex(message.toBytes())));
    checks['thumbprint'] = capture(() => okHex (bytesToHex(chain[0]!.thumbprint())));
    checks['subject']    = capture(() => okText(chain[0]!.subject.toString()));

    checks['validate']   = capture(() => {

        const result = CoseSign1.parse(message.toBytes())
                           .verifyWithCertificateChain(anchors, { at });

        return result.verified
                   ? { status: 'ok', verified: true, text: result.signer.subject.toString() }
                   : { status: 'ok', verified: false, reason: result.reason };

    });

}


/** Validate a chained message the *other* implementation produced. */
function runCoseX509Validate(testCase: VectorCase, checks: Record<string, Check>): void {

    checks['validate'] = capture(() => {

        const at      = new Date(corpusOrThrow().validateAt);
        const anchors = (testCase.trustAnchors ?? []).map(certificateOf);

        const result  = CoseSign1.parse(hexToBytes(testCase.message!))
                            .verifyWithCertificateChain(anchors, { at });

        return result.verified
                   ? { status: 'ok', verified: true, text: result.signer.subject.toString() }
                   : { status: 'ok', verified: false, reason: result.reason };

    });

}


/**
 * Authenticate one case, recording what the other implementation has to agree
 * with: the MAC_structure, the tag, the whole message and the key thumbprint.
 *
 * Nothing has to be arranged for the bytes to be comparable. A MAC is
 * deterministic by construction — there is no nonce to draw and nothing to
 * derive — so a tag that differs means the two implementations disagree about
 * the structure, the truncation or the primitive, and about nothing else.
 */
function runCoseMac0(testCase: VectorCase, checks: Record<string, Check>): void {

    const algorithm = algorithmByName(testCase.algorithm!);

    if (algorithm === null)
        throw new Error(`Unknown algorithm '${String(testCase.algorithm)}'`);

    const key = CoseKey.fromSymmetricKey(hexToBytes(testCase.key!), {
                    algorithm,
                    keyIdentifier: testCase.keyIdentifier !== undefined
                                       ? hexToBytes(testCase.keyIdentifier)
                                       : null,
                });

    const payload     = hexToBytes(testCase.payload!);
    const externalAad = optionalBytes(testCase.externalAad);

    const message = CoseMac0.create(payload, key, {
                        externalAad,
                        detachPayload: testCase.detached === true,
                        tagged:        testCase.tagged !== false,
                    });

    checks['toBeMaced']  = capture(() => okHex(bytesToHex(
        CoseMac0.toBeMaced(message.protectedHeaderBytes, payload, externalAad))));
    checks['tag']        = capture(() => okHex(bytesToHex(message.tag)));
    checks['message']    = capture(() => okHex(bytesToHex(message.toBytes())));

    // The thumbprint of a symmetric key covers kty and k and nothing else
    // [RFC 9679, Section 4.4] — notably not the algorithm, unlike an
    // algorithm key pair.
    checks['thumbprint'] = capture(() => okHex(bytesToHex(key.thumbprint())));

}


/** Verify a COSE_Mac0 message the *other* implementation produced. */
function runCoseMac0Verify(testCase: VectorCase, checks: Record<string, Check>): void {

    checks['verify'] = capture(() => {

        const algorithm = algorithmByName(testCase.algorithm!);

        if (algorithm === null)
            throw new Error(`Unknown algorithm '${String(testCase.algorithm)}'`);

        const key      = CoseKey.fromSymmetricKey(hexToBytes(testCase.key!), { algorithm });
        const detached = testCase.detached === true ? hexToBytes(testCase.payload!) : null;

        return verification(CoseMac0.parse(hexToBytes(testCase.message!)).verify(key, {
                   externalAad:     optionalBytes(testCase.externalAad),
                   detachedPayload: detached,
               }));

    });

}


/** A symmetric key from a vector entry. */
function symmetricKeyOf(keyHex: string, algorithmName?: string, keyIdentifier?: string): CoseKey {

    const algorithm = algorithmName !== undefined ? algorithmByName(algorithmName) : null;

    if (algorithmName !== undefined && algorithm === null)
        throw new Error(`Unknown algorithm '${algorithmName}'`);

    return CoseKey.fromSymmetricKey(hexToBytes(keyHex), {
               algorithm,
               keyIdentifier: keyIdentifier !== undefined ? hexToBytes(keyIdentifier) : null,
           });

}


/** The recipient structures a case describes. */
function recipientsOf(testCase: VectorCase, contentKey: Uint8Array): CoseRecipient[] {

    return (testCase.recipients ?? []).map(entry => {

        const key = symmetricKeyOf(entry.key, undefined, entry.keyIdentifier);

        return entry.algorithm === 'direct'
                   ? CoseRecipient.direct(key)
                   : CoseRecipient.keyWrap(contentKey, key);

    });

}


/**
 * Encrypt or authenticate one case, recording what the other implementation
 * has to agree with: the structure that was authenticated, the ciphertext or
 * tag, and the whole message.
 *
 * Everything is deterministic once the content key and the nonce are given,
 * and the vector gives both — which is the same departure from "default
 * settings" the signing suite makes, and for the same reason.
 */
function runCoseEncrypt(testCase: VectorCase, checks: Record<string, Check>): void {

    const contentKey = symmetricKeyOf(testCase.key!, testCase.algorithm, testCase.keyIdentifier);
    const payload    = hexToBytes(testCase.payload!);
    const external   = optionalBytes(testCase.externalAad);
    const detached   = testCase.detached === true;
    const tagged     = testCase.tagged !== false;

    switch (testCase.shape) {

        case 'encrypt0': {

            const message = CoseEncrypt0.encrypt(payload, contentKey, {
                                iv:            hexToBytes(testCase.iv!),
                                externalAad:   external,
                                detachPayload: detached,
                                tagged,
                            });

            checks['toBeEncrypted'] = capture(() => okHex(bytesToHex(message.toBeEncrypted(external))));
            checks['ciphertext']    = capture(() => okHex(bytesToHex(
                message.ciphertext ?? CoseEncrypt0.encrypt(payload, contentKey,
                    { iv: hexToBytes(testCase.iv!), externalAad: external }).ciphertext!)));
            checks['message']       = capture(() => okHex(bytesToHex(message.toBytes())));

            break;

        }

        case 'encrypt': {

            const recipients = recipientsOf(testCase, contentKey.privateKeyBytes());

            const message = CoseEncrypt.encrypt(payload, contentKey, recipients, {
                                iv:            hexToBytes(testCase.iv!),
                                externalAad:   external,
                                detachPayload: detached,
                                tagged,
                            });

            checks['toBeEncrypted'] = capture(() => okHex(bytesToHex(message.toBeEncrypted(external))));
            checks['ciphertext']    = capture(() => okHex(bytesToHex(message.ciphertext!)));
            checks['message']       = capture(() => okHex(bytesToHex(message.toBytes())));
            checks['recipient0']    = capture(() => okHex(bytesToHex(recipients[0]!.ciphertext)));

            break;

        }

        case 'mac': {

            const recipients = recipientsOf(testCase, contentKey.privateKeyBytes());

            const message = CoseMac.create(payload, contentKey, recipients, {
                                externalAad:   external,
                                detachPayload: detached,
                                tagged,
                            });

            checks['toBeEncrypted'] = capture(() => okHex(bytesToHex(
                CoseMac.toBeMaced(message.protectedHeaderBytes, payload, external))));
            checks['ciphertext']    = capture(() => okHex(bytesToHex(message.tag)));
            checks['message']       = capture(() => okHex(bytesToHex(message.toBytes())));
            checks['recipient0']    = capture(() => okHex(bytesToHex(recipients[0]!.ciphertext)));

            break;

        }

        default:
            checks['message'] = error(`unknown COSE shape '${String(testCase.shape)}'`);

    }

}


/** Open a message the *other* implementation produced. */
function runCoseDecrypt(testCase: VectorCase, checks: Record<string, Check>): void {

    checks['open'] = capture(() => {

        const external = optionalBytes(testCase.externalAad);
        const bytes    = hexToBytes(testCase.message!);
        const payload  = hexToBytes(testCase.payload!);

        // Whoever opens the message holds a recipient key, or — for the bare
        // form — the content key itself.
        const key = testCase.recipients !== undefined && testCase.recipients.length > 0
                        ? symmetricKeyOf(testCase.recipients[0]!.key)
                        : symmetricKeyOf(testCase.key!, testCase.algorithm);

        if (testCase.shape === 'mac')
            return verification(CoseMac.parse(bytes).verify(key, { externalAad: external }));

        const detached = testCase.detached === true
                             ? hexToBytes(testCase.detachedCiphertext!)
                             : null;

        const result = testCase.shape === 'encrypt0'
                           ? CoseEncrypt0.parse(bytes).decrypt(symmetricKeyOf(testCase.key!, testCase.algorithm),
                                                               { externalAad: external, detachedCiphertext: detached })
                           : CoseEncrypt.parse(bytes).decrypt(key,
                                                              { externalAad: external, detachedCiphertext: detached });

        if (!result.decrypted)
            return { status: 'ok', verified: false, reason: result.reason };

        // Decrypting is only half of it: the plaintext has to be the payload
        // the vector names, or the two implementations agree about nothing.
        return bytesToHex(result.plaintext) === bytesToHex(payload)
                   ? { status: 'ok', verified: true }
                   : { status: 'ok', verified: false,
                       reason: `decrypted to ${bytesToHex(result.plaintext)} rather than to the expected payload` };

    });

}


/** A verification, recorded rather than judged. */
function verification(result: Verification): Check {
    return result.verified
               ? { status: 'ok', verified: true }
               : { status: 'ok', verified: false, reason: result.reason };
}


/**
 * Verify a message the *other* implementation produced.
 *
 * Everything a case carries has to verify, not merely something: a COSE_Sign
 * verifies only when every one of its signatures does, and a countersigned
 * message only when the body and the vouching both do.
 */
function runCoseVerify(testCase: VectorCase, checks: Record<string, Check>): void {

    checks['verify'] = capture(() => {

        const key         = primaryKey(testCase).publicKey();
        const externalAad = optionalBytes(testCase.externalAad);
        const detached    = testCase.detached === true ? hexToBytes(testCase.payload!) : null;
        const options     = { externalAad, detachedPayload: detached };
        const message     = hexToBytes(testCase.message!);

        switch (testCase.shape) {

            case 'sign1':
            case 'sign1-app-algorithm':
                return verification(CoseSign1.parse(message).verify(key, options));

            case 'sign': {

                const parsed = CoseSign.parse(message);
                const second = secondaryKey(testCase).publicKey();

                if (parsed.signatures.length !== 2)
                    return { status: 'ok', verified: false, reason: `expected 2 signatures, found ${String(parsed.signatures.length)}` };

                const first  = parsed.verify(parsed.signatures[0] as CoseSignature, key,    options);
                const other  = parsed.verify(parsed.signatures[1] as CoseSignature, second, options);

                return first.verified && other.verified
                           ? { status: 'ok', verified: true }
                           : { status: 'ok', verified: false,
                               reason: [first, other].filter(each => !each.verified)
                                                     .map(each => each.verified ? '' : each.reason).join('; ') };

            }

            case 'countersign': {

                const parsed = CoseSign1.parse(message);
                const second = secondaryKey(testCase).publicKey();

                if (parsed.countersignatures.length !== 1)
                    return { status: 'ok', verified: false, reason: `expected 1 countersignature, found ${String(parsed.countersignatures.length)}` };

                const body    = parsed.verify(key, options);
                const vouched = parsed.verifyCountersignature(parsed.countersignatures[0] as CoseSignature, second, options);

                return body.verified && vouched.verified
                           ? { status: 'ok', verified: true }
                           : { status: 'ok', verified: false,
                               reason: [body, vouched].filter(each => !each.verified)
                                                      .map(each => each.verified ? '' : each.reason).join('; ') };

            }

            default:
                return error(`unknown COSE shape '${String(testCase.shape)}'`);

        }

    });

}


// -------------------------------------------------------------------- main --

const [outputFile, ...inputs] = process.argv.slice(2);

if (outputFile === undefined || inputs.length === 0) {
    console.error('Usage: tsx runner.ts <output.json> <vectorFileOrDir> [more...]');
    process.exit(2);
}

const vectorFiles: string[] = [];

for (const input of inputs) {
    if (statSync(input).isDirectory())
        vectorFiles.push(...readdirSync(input).filter(name => name.endsWith('.json')).sort().map(name => join(input, name)));
    else
        vectorFiles.push(input);
}

const results: Record<string, Record<string, Check>> = {};

for (const vectorFile of vectorFiles) {

    const root = JSON.parse(readFileSync(vectorFile, 'utf8')) as { suite?: string; cases?: VectorCase[] };

    if (root.suite === undefined || root.cases === undefined)
        continue;

    if (root.suite.startsWith('cose-x509')) {
        corpus = JSON.parse(readFileSync(join(dirname(vectorFile), 'cose-x509-corpus.json'), 'utf8')) as Corpus;
    }

    for (const testCase of root.cases) {

        const checks: Record<string, Check> = {};

        try {
            switch (root.suite) {
                case 'values':         runValues       (testCase, checks); break;
                case 'values-invalid': runValuesInvalid(testCase, checks); break;
                case 'cbor-robustness': runCborRobustness(testCase, checks); break;
                case 'default-encoding': runDefaultEncoding(testCase, checks); break;
                case 'documents':      runDocuments    (testCase, checks); break;
                case 'json-to-cbor':   runJsonToCbor   (testCase, checks); break;
                case 'json-escapes':   runJsonEscapes  (testCase, checks); break;
                // One-way tag conversions: the same two checks a document
                // needs, judged against the text the specification prescribes.
                case 'json-tags':      runDocuments    (testCase, checks); break;
                case 'parse-texts':    runParseTexts   (testCase, checks); break;
                case 'cose-sign':      runCoseSign     (testCase, checks); break;
                case 'cose-crit':      runCoseCrit     (testCase, checks); break;
                case 'cose-verify':    runCoseVerify   (testCase, checks); break;
                case 'cose-encrypt':   runCoseEncrypt  (testCase, checks); break;
                case 'cose-decrypt':   runCoseDecrypt  (testCase, checks); break;
                case 'cose-mac0':      runCoseMac0     (testCase, checks); break;
                case 'cose-mac0-verify': runCoseMac0Verify(testCase, checks); break;
                case 'cose-x509':      runCoseX509     (testCase, checks); break;
                case 'cose-x509-validate': runCoseX509Validate(testCase, checks); break;
            }
        }
        catch (cause) {
            checks['runner'] = error(cause);
        }

        results[`${root.suite}:${testCase.id}`] = checks;

    }

}

const packageJson = JSON.parse(
    readFileSync(new URL('../../libs/MetrologicalCBOR.TS/package.json', import.meta.url), 'utf8')
) as { version?: string };

writeFileSync(outputFile, JSON.stringify({
    runner:         'typescript',
    implementation: 'MetrologicalCBOR.TS',
    version:        packageJson.version ?? 'unknown',
    results,
}, null, 2), 'utf8');

console.log(`typescript runner: ${Object.keys(results).length} cases -> ${outputFile}`);
