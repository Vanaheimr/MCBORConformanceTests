/*
 * Metrological CBOR conformance runner for the TypeScript reference
 * implementation (MetrologicalCBOR.TS, imported from source). Reads the
 * shared vector files, executes every check with the implementation's DEFAULT
 * settings, and writes the observed behaviour as JSON. All judging happens in
 * the comparison driver — this program only records what the implementation
 * does.
 *
 * Note on JSON numbers: this runner deliberately uses JSON.parse/JSON.stringify,
 * because that is what the ecosystem this library serves uses. Digit loss on
 * numbers like 1.10 or 2^53+1 is observed behaviour, not a runner bug.
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
    mcborToJson,
    jsonToMcbor,
    bytesToHex,
    hexToBytes,
    type MetrologicalValue,
} from '../../libs/MetrologicalCBOR.TS/src/index.ts';


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
    return capture(() => okHex(bytesToHex(jsonToMcbor(JSON.parse(jsonText)))));
}


// ------------------------------------------------------------------ suites --

interface VectorCase {
    id:           string;
    hex?:         string;
    text?:        string;
    parseTexts?:  { text: string }[];
    cborHex?:     string;
    json?:        string;
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
        json = JSON.stringify(mcborToJson(hexToBytes(testCase.cborHex!)));
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
