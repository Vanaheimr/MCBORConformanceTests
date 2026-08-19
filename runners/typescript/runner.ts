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
import { join }                                               from 'node:path';

import {
    decodeMetrologicalValue,
    encodeMetrologicalValue,
    formatMetrologicalValue,
    parseMetrologicalValue,
    mcborToJsonText,
    jsonTextToMcbor,
    bytesToHex,
    hexToBytes,
    type MetrologicalValue,
} from '../../libs/MetrologicalCBOR.TS/src/index.ts';

import {
    algorithmByName,
    CoseKey,
    CoseSign,
    CoseSign1,
    curveByName,
} from '../../libs/COSE.TS/src/index.ts';
import type { CoseSignature, Verification } from '../../libs/COSE.TS/src/index.ts';


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

function runDocuments(testCase: VectorCase, checks: Record<string, Check>): void {

    let json: string | undefined;

    checks['toJson'] = capture(() => {
        json = mcborToJsonText(hexToBytes(testCase.cborHex!));
        return okJson(json);
    });

    if (json !== undefined)
        checks['roundtrip'] = jsonToCborHex(json);

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
function keyOf(curveName: string, dHex: string, algorithmName: string, keyIdentifier?: string): CoseKey {

    const curve = curveByName(curveName);

    if (curve === null)
        throw new Error(`unknown curve '${curveName}'`);

    const algorithm = algorithmByName(algorithmName);

    if (algorithm === null)
        throw new Error(`unknown algorithm '${algorithmName}'`);

    return CoseKey.fromPrivateScalar(curve, hexToBytes(dHex), {
        algorithm,
        keyIdentifier: keyIdentifier !== undefined ? hexToBytes(keyIdentifier) : null,
    });

}

const optionalBytes = (hex?: string): Uint8Array | null =>
    hex !== undefined ? hexToBytes(hex) : null;

const primaryKey   = (testCase: VectorCase): CoseKey =>
    keyOf(testCase.curve!, testCase.keyD!, testCase.algorithm!, testCase.keyIdentifier);

const secondaryKey = (testCase: VectorCase): CoseKey =>
    keyOf(testCase.curve2!, testCase.keyD2!, testCase.algorithm2!, testCase.keyIdentifier2);


/**
 * Sign one case, recording what a second implementation has to agree with:
 * the structure that was signed, the signature bytes, the whole message, and
 * the key thumbprints.
 *
 * Signing is deterministic (RFC 6979), which is what makes the signature bytes
 * comparable at all — a randomized signature is a different 64 bytes every
 * time and says nothing about whether two implementations agree.
 */
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

    for (const testCase of root.cases) {

        const checks: Record<string, Check> = {};

        try {
            switch (root.suite) {
                case 'values':         runValues       (testCase, checks); break;
                case 'values-invalid': runValuesInvalid(testCase, checks); break;
                case 'documents':      runDocuments    (testCase, checks); break;
                case 'json-to-cbor':   runJsonToCbor   (testCase, checks); break;
                case 'parse-texts':    runParseTexts   (testCase, checks); break;
                case 'cose-sign':      runCoseSign     (testCase, checks); break;
                case 'cose-verify':    runCoseVerify   (testCase, checks); break;
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
