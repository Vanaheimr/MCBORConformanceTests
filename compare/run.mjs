/*
 * Conformance comparison driver.
 *
 * Phase 1: run the C# and the TypeScript runner over the shared vectors.
 * Phase 2: cross-feed — each implementation's document JSON and each
 *          implementation's canonical text is handed to the *other*
 *          implementation to convert back.
 * Then every recorded behaviour is judged against the vector expectations
 * (normative vs survey) and against the other implementation, and the whole
 * picture is written to results/report.md.
 *
 * Usage: node compare/run.mjs [--skip-run] [--offline]
 *   --skip-run  reuse results/*.json from a previous run (judge + report only)
 */

import { execFileSync }                                       from 'node:child_process';
import { existsSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve }                             from 'node:path';
import { fileURLToPath }                                      from 'node:url';

const root       = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The vectors are the normative annex of the specification and live with it;
// this repository contributes the runners, the cross-feed and the judgement.
const vectorsDir = join(root, 'libs', 'specification', 'MetrologicalCBOR', 'test-vectors');

// COSE is not part of the tag specification — it is how a metrological value
// is signed, not what one is — so its vectors belong to this repository.
const coseDir    = join(root, 'vectors');

const resultsDir = join(root, 'results');
const skipRun    = process.argv.includes('--skip-run');

mkdirSync(resultsDir, { recursive: true });

// ----------------------------------------------------------------- running --

function sh(command, args, options = {}) {
    console.log(`> ${command} ${args.join(' ')}`);
    execFileSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32', ...options });
}

const tsRunnerDir = join(root, 'runners', 'typescript');

function runCSharp(outputFile, ...inputs) {
    sh('dotnet', ['run', '--project', join('runners', 'csharp', 'ConformanceRunner'), '-c', 'Release', '--',
        outputFile, ...inputs], { cwd: root });
}

const coseDirTS = join(root, 'libs', 'COSE.TS');

function runTypeScript(outputFile, ...inputs) {
    if (!existsSync(join(tsRunnerDir, 'node_modules', 'tsx')))
        sh('npm', ['install', '--no-audit', '--no-fund'], { cwd: tsRunnerDir });
    // The COSE package carries the one cryptography dependency of this suite;
    // the runner imports it from source, as it does the mCBOR implementation.
    if (!existsSync(join(coseDirTS, 'node_modules', '@noble', 'curves')))
        sh('npm', ['install', '--no-audit', '--no-fund'], { cwd: coseDirTS });
    sh('npx', ['tsx', 'runner.ts', outputFile, ...inputs], { cwd: tsRunnerDir });
}

const phase1CSharp = join(resultsDir, 'csharp.json');
const phase1TS     = join(resultsDir, 'typescript.json');

if (!skipRun) {
    runCSharp(phase1CSharp, vectorsDir, coseDir);
    runTypeScript(phase1TS, vectorsDir, coseDir);
}

const loadResults = file => JSON.parse(readFileSync(file, 'utf8'));

let csharp = loadResults(phase1CSharp);
let ts     = loadResults(phase1TS);

// ------------------------------------------------------------- cross-feeds --

const vectors = {};
for (const name of ['values.json', 'values-invalid.json', 'documents.json', 'json-to-cbor.json']) {
    const suite = JSON.parse(readFileSync(join(vectorsDir, name), 'utf8'));
    vectors[suite.suite] = suite.cases;
}
for (const name of ['cose-sign.json', 'cose-mac0.json', 'cose-encrypt.json', 'cose-x509.json']) {
    const suite = JSON.parse(readFileSync(join(coseDir, name), 'utf8'));
    vectors[suite.suite] = suite.cases;
}

function crossVectorsFrom(sourceResults) {

    const jsonCases = [];
    const textCases = [];
    const coseCases = [];
    const mac0Cases = [];
    const encCases  = [];
    const x509Cases = [];

    for (const testCase of vectors['documents']) {
        const recorded = sourceResults.results[`documents:${testCase.id}`];
        if (recorded?.toJson?.status === 'ok')
            jsonCases.push({ id: `xdoc-${testCase.id}`, json: recorded.toJson.json });
    }

    for (const testCase of vectors['values']) {

        const recorded = sourceResults.results[`values:${testCase.id}`];

        if (recorded?.format?.status === 'ok')
            textCases.push({ id: `xtext-${testCase.id}`, text: recorded.format.text });

        // The ASCII rendering is a second spelling of the same reading and
        // must cross-parse just like the canonical one. Only the TypeScript
        // runner records it; the C# implementation has one canonical output.
        if (recorded?.formatAscii?.status === 'ok')
            textCases.push({ id: `xtext-ascii-${testCase.id}`, text: recorded.formatAscii.text });

    }

    // Every signed message one implementation produced, for the other one to
    // verify. The case travels with it, because a verifier needs to know which
    // key, which algorithm and whether the payload was detached — none of
    // which is guessable from the bytes alone.
    for (const testCase of vectors['cose-sign']) {
        const recorded = sourceResults.results[`cose-sign:${testCase.id}`];
        if (recorded?.message?.status === 'ok')
            coseCases.push({ ...testCase, id: `xcose-${testCase.id}`, message: recorded.message.hex });
    }

    // Every authenticated message one implementation produced, for the other
    // one to check. A MAC needs no arrangement to be comparable, so this is
    // the plainest cross-feed in the suite.
    for (const testCase of vectors['cose-mac0']) {
        const recorded = sourceResults.results[`cose-mac0:${testCase.id}`];
        if (recorded?.message?.status === 'ok')
            mac0Cases.push({ ...testCase, id: `xmac0-${testCase.id}`, message: recorded.message.hex });
    }

    // Every encrypted or enveloped message one implementation produced, for
    // the other one to open. A detached ciphertext travels alongside, since
    // the message deliberately does not carry it.
    for (const testCase of vectors['cose-encrypt']) {
        const recorded = sourceResults.results[`cose-encrypt:${testCase.id}`];
        if (recorded?.message?.status === 'ok')
            encCases.push({ ...testCase,
                            id: `xenc-${testCase.id}`,
                            message: recorded.message.hex,
                            detachedCiphertext: recorded.ciphertext?.hex });
    }

    // Every chained message one implementation produced, for the other one to
    // walk to an anchor. This is where two DER parsers meet: the chain travels
    // inside the message, so the receiving side has to read certificates it did
    // not itself encode.
    for (const testCase of vectors['cose-x509']) {
        const recorded = sourceResults.results[`cose-x509:${testCase.id}`];
        if (recorded?.message?.status === 'ok')
            x509Cases.push({ ...testCase, id: `xx509-${testCase.id}`, message: recorded.message.hex });
    }

    return [
        { suite: 'json-to-cbor',       description: 'cross-feed', cases: jsonCases },
        { suite: 'parse-texts',        description: 'cross-feed', cases: textCases },
        { suite: 'cose-verify',        description: 'cross-feed', cases: coseCases },
        { suite: 'cose-mac0-verify',   description: 'cross-feed', cases: mac0Cases },
        { suite: 'cose-decrypt',       description: 'cross-feed', cases: encCases },
        { suite: 'cose-x509-validate', description: 'cross-feed', cases: x509Cases },
    ];
}

const crossForTS     = join(resultsDir, 'cross-from-csharp');
const crossForCSharp = join(resultsDir, 'cross-from-typescript');

if (!skipRun) {

    for (const [prefix, source] of [[crossForTS, csharp], [crossForCSharp, ts]]) {
        const [jsonSuite, textSuite, coseSuite, mac0Suite, encSuite, x509Suite] = crossVectorsFrom(source);
        writeFileSync(`${prefix}-json.json`, JSON.stringify(jsonSuite, null, 2));
        writeFileSync(`${prefix}-text.json`, JSON.stringify(textSuite, null, 2));
        writeFileSync(`${prefix}-cose.json`, JSON.stringify(coseSuite, null, 2));
        writeFileSync(`${prefix}-mac0.json`, JSON.stringify(mac0Suite, null, 2));
        writeFileSync(`${prefix}-enc.json`,  JSON.stringify(encSuite,  null, 2));
        writeFileSync(`${prefix}-x509.json`, JSON.stringify(x509Suite, null, 2));
    }

    // The chained cases name their certificates rather than carrying them, so
    // the corpus has to travel to wherever the cross-feed files are read from.
    copyFileSync(join(coseDir, 'cose-x509-corpus.json'), join(resultsDir, 'cose-x509-corpus.json'));

    runCSharp(join(resultsDir, 'csharp-cross.json'),
              `${crossForCSharp}-json.json`, `${crossForCSharp}-text.json`,
              `${crossForCSharp}-cose.json`, `${crossForCSharp}-mac0.json`,
              `${crossForCSharp}-enc.json`,  `${crossForCSharp}-x509.json`);

    runTypeScript(join(resultsDir, 'typescript-cross.json'),
                  `${crossForTS}-json.json`, `${crossForTS}-text.json`,
                  `${crossForTS}-cose.json`, `${crossForTS}-mac0.json`,
                  `${crossForTS}-enc.json`,  `${crossForTS}-x509.json`);

}

const csharpCross = loadResults(join(resultsDir, 'csharp-cross.json'));
const tsCross     = loadResults(join(resultsDir, 'typescript-cross.json'));

// ---------------------------------------------------------------- judging --

/** @type {{caseId: string, check: string, impl: string, klass: 'normative'|'survey', outcome: 'pass'|'fail'|'info', detail: string}[]} */
const verdicts = [];

function judge(caseId, check, impl, klass, pass, detail) {
    verdicts.push({
        caseId, check, impl, klass,
        outcome: klass === 'normative' ? (pass ? 'pass' : 'fail') : 'info',
        pass, detail,
    });
}

const impls = [['csharp', csharp], ['typescript', ts]];

function checkOf(results, key, check) {
    return results.results[key]?.[check];
}

function describe(recorded) {
    if (recorded === undefined)            return 'not recorded';
    if (recorded.status === 'error')       return `error: ${recorded.message}`;
    if (recorded.verified === true)        return 'verified';
    if (recorded.verified === false)       return `NOT verified: ${recorded.reason}`;
    if (recorded.hex  !== undefined)       return `ok: ${recorded.hex}`;
    if (recorded.text !== undefined)       return `ok: ${JSON.stringify(recorded.text)}`;
    if (recorded.json !== undefined)       return `ok: ${recorded.json}`;
    return 'ok';
}

// --- suite: values ---

for (const testCase of vectors['values']) {

    const key          = `values:${testCase.id}`;
    const canonicalHex = testCase.canonicalHex ?? testCase.hex;
    const hexClass     = testCase.canonicalHexClass ?? 'normative';
    const textClass    = testCase.textClass ?? 'normative';

    for (const [impl, results] of impls) {

        const decode = checkOf(results, key, 'decode');
        judge(testCase.id, 'decode', impl, 'normative',
              decode?.status === 'ok', describe(decode));

        const reencode = checkOf(results, key, 'reencode');
        if (decode?.status === 'ok')
            judge(testCase.id, 'reencode', impl, hexClass,
                  reencode?.status === 'ok' && reencode.hex === canonicalHex,
                  `expected ${canonicalHex}, got ${describe(reencode)}`);

        const format = checkOf(results, key, 'format');
        if (decode?.status === 'ok' && testCase.text !== undefined)
            judge(testCase.id, 'format', impl, textClass,
                  format?.status === 'ok' && format.text === testCase.text,
                  `expected ${JSON.stringify(testCase.text)}, got ${describe(format)}`);
        else if (decode?.status === 'ok')
            judge(testCase.id, 'format', impl, 'survey', true, describe(format));

        if (testCase.text !== undefined) {
            const parse = checkOf(results, key, 'parse');
            judge(testCase.id, 'parse', impl, textClass,
                  parse?.status === 'ok' && parse.hex === canonicalHex,
                  `parsing the canonical text: expected ${canonicalHex}, got ${describe(parse)}`);
        }

        (testCase.parseTexts ?? []).forEach((entry, index) => {
            const parse    = checkOf(results, key, `parse:${index}`);
            const expected = entry.hex ?? canonicalHex;
            const klass    = entry.expect === 'survey' ? 'survey' : 'normative';
            const pass     = entry.expect === 'reject'
                                 ? parse?.status === 'error'
                                 : parse?.status === 'ok' && parse.hex === expected;
            judge(testCase.id, `parse ${JSON.stringify(entry.text)}`, impl, klass, pass,
                  entry.expect === 'reject'
                      ? `must reject, got ${describe(parse)}`
                      : `expected ${expected}, got ${describe(parse)}`);
        });

    }

    // cross-feed: my canonical text, parsed by the other implementation
    for (const [impl, own, otherName, otherCross] of [
             ['csharp', csharp, 'typescript', tsCross],
             ['typescript', ts, 'csharp', csharpCross]]) {

        const format = checkOf(own, key, 'format');
        if (format?.status !== 'ok')
            continue;

        const parsed = checkOf(otherCross, `parse-texts:xtext-${testCase.id}`, 'parse');
        const klass  = hexClass === 'normative' && textClass === 'normative' ? 'normative' : 'survey';
        judge(testCase.id, `cross-text ${impl}→${otherName}`, otherName, klass,
              parsed?.status === 'ok' && parsed.hex === canonicalHex,
              `${otherName} parsing ${JSON.stringify(format.text)} (written by ${impl}): expected ${canonicalHex}, got ${describe(parsed)}`);

    }

    // cross-feed: the TypeScript ASCII rendering, parsed by C#. A second
    // spelling of the same reading, held to the same expectation.
    {

        const ascii = checkOf(ts, key, 'formatAscii');

        if (ascii?.status === 'ok') {

            const parsed = checkOf(csharpCross, `parse-texts:xtext-ascii-${testCase.id}`, 'parse');
            const klass  = hexClass === 'normative' && textClass === 'normative' ? 'normative' : 'survey';
            judge(testCase.id, 'cross-text-ascii typescript→csharp', 'csharp', klass,
                  parsed?.status === 'ok' && parsed.hex === canonicalHex,
                  `csharp parsing the ASCII form ${JSON.stringify(ascii.text)} (written by typescript): expected ${canonicalHex}, got ${describe(parsed)}`);

        }

    }

}

// --- suite: values-invalid ---

for (const testCase of vectors['values-invalid']) {

    const key    = `values-invalid:${testCase.id}`;
    const klass  = (testCase.expect ?? 'reject') === 'survey' ? 'survey' : 'normative';
    const check  = testCase.hex !== undefined ? 'decode' : 'parse';

    for (const [impl, results] of impls) {
        const recorded = checkOf(results, key, check);
        judge(testCase.id, check, impl, klass,
              recorded?.status === 'error',
              klass === 'normative'
                  ? `must reject (${testCase.reason}), got ${describe(recorded)}`
                  : describe(recorded));
    }

}

// --- suite: documents ---

for (const testCase of vectors['documents']) {

    const key       = `documents:${testCase.id}`;
    const jsonClass = testCase.jsonClass ?? (testCase.json !== undefined ? 'normative' : 'survey');

    for (const [impl, results] of impls) {

        const toJson = checkOf(results, key, 'toJson');

        if (testCase.expectToJsonError === true) {
            judge(testCase.id, 'toJson', impl, 'normative',
                  toJson?.status === 'error',
                  `must refuse, got ${describe(toJson)}`);
            continue;
        }

        if (testCase.json !== undefined)
            judge(testCase.id, 'toJson', impl, jsonClass,
                  toJson?.status === 'ok' && toJson.json === testCase.json,
                  `expected ${testCase.json}, got ${describe(toJson)}`);
        else
            judge(testCase.id, 'toJson', impl, 'survey', toJson?.status === 'ok', describe(toJson));

        const roundtrip = checkOf(results, key, 'roundtrip');

        if (testCase.roundtripHex !== undefined)
            judge(testCase.id, 'roundtrip', impl, 'normative',
                  roundtrip?.status === 'ok' && roundtrip.hex === testCase.roundtripHex,
                  `expected ${testCase.roundtripHex}, got ${describe(roundtrip)}`);
        else if (testCase.roundtrip === true)
            judge(testCase.id, 'roundtrip', impl, 'normative',
                  roundtrip?.status === 'ok' && roundtrip.hex === testCase.cborHex,
                  `expected ${testCase.cborHex}, got ${describe(roundtrip)}`);
        else
            judge(testCase.id, 'roundtrip', impl, 'survey',
                  roundtrip?.status === 'ok',
                  describe(roundtrip));

    }

    // cross-feed: my JSON, converted back by the other implementation
    if (testCase.expectToJsonError === true)
        continue;

    for (const [impl, own, otherName, otherCross] of [
             ['csharp', csharp, 'typescript', tsCross],
             ['typescript', ts, 'csharp', csharpCross]]) {

        const toJson = checkOf(own, key, 'toJson');
        if (toJson?.status !== 'ok')
            continue;

        const back  = checkOf(otherCross, `json-to-cbor:xdoc-${testCase.id}`, 'toCbor');
        const klass = testCase.roundtrip === true ? 'normative' : 'survey';
        const expected = testCase.roundtrip === true ? testCase.cborHex : undefined;
        judge(testCase.id, `cross-json ${impl}→${otherName}`, otherName, klass,
              expected !== undefined
                  ? back?.status === 'ok' && back.hex === expected
                  : back?.status === 'ok',
              `${otherName} converting the JSON written by ${impl}: ` +
              (expected !== undefined ? `expected ${expected}, got ${describe(back)}` : describe(back)));

    }

}

// --- suite: json-to-cbor ---

for (const testCase of vectors['json-to-cbor']) {

    const key   = `json-to-cbor:${testCase.id}`;
    const klass = testCase.class ?? (testCase.cborHex !== undefined ? 'normative' : 'survey');

    for (const [impl, results] of impls) {
        const toCbor = checkOf(results, key, 'toCbor');
        if (testCase.cborHex !== undefined && klass === 'normative')
            judge(testCase.id, 'toCbor', impl, 'normative',
                  toCbor?.status === 'ok' && toCbor.hex === testCase.cborHex,
                  `expected ${testCase.cborHex}, got ${describe(toCbor)}`);
        else
            judge(testCase.id, 'toCbor', impl, 'survey', toCbor?.status === 'ok', describe(toCbor));
    }

}

// --- suite: cose-sign, and the cross-signing that is the point of it ---

/**
 * What a second implementation has to agree with, and why each one matters.
 *
 * `toBeSigned` is the structure claim: two implementations that disagree here
 * disagree about what a signature *means*, and no amount of correct
 * cryptography further down would help. `signature` is the arithmetic claim,
 * available only because both sides sign deterministically. `message` is the
 * serialization claim, and `thumbprint` the identity one.
 */
const COSE_AGREEMENTS = [
    ['toBeSigned',  'the structure that was signed'],
    ['toBeSigned2', 'the structure the second party signed'],
    ['signature',   'the signature bytes'],
    ['signature2',  'the second signature bytes'],
    ['message',     'the complete signed message'],
    ['thumbprint',  'the RFC 9679 key thumbprint'],
    ['thumbprint2', 'the second key thumbprint'],
];

for (const testCase of vectors['cose-sign']) {

    const key   = `cose-sign:${testCase.id}`;
    const klass = testCase.class ?? 'normative';

    for (const [check, what] of COSE_AGREEMENTS) {

        const a = checkOf(csharp, key, check);
        const b = checkOf(ts,     key, check);

        // Only the two-party shapes record a second signature.
        if (a === undefined && b === undefined)
            continue;

        judge(testCase.id, `agree ${check}`, 'csharp↔typescript', klass,
              a?.status === 'ok' && b?.status === 'ok' && a.hex === b.hex,
              `${what}: csharp ${describe(a)}, typescript ${describe(b)}`);

    }

    // The cross-signing itself: each implementation verifying what the other
    // one signed. This is the claim that a signed metrological record made by
    // one of them is checkable by the other.
    for (const [impl, own, otherName, otherCross] of [
             ['csharp', csharp, 'typescript', tsCross],
             ['typescript', ts, 'csharp', csharpCross]]) {

        const message = checkOf(own, key, 'message');

        if (message?.status !== 'ok') {
            judge(testCase.id, `cross-verify ${impl}→${otherName}`, otherName, klass, false,
                  `${impl} produced no message to verify: ${describe(message)}`);
            continue;
        }

        const verified = checkOf(otherCross, `cose-verify:xcose-${testCase.id}`, 'verify');

        judge(testCase.id, `cross-verify ${impl}→${otherName}`, otherName, klass,
              verified?.status === 'ok' && verified.verified === true,
              `${otherName} verifying the message signed by ${impl}: ${describe(verified)}`);

    }

}

// --- suite: cose-mac0, the authenticated messages ---

/**
 * What both implementations have to say the same thing about.
 *
 * All four are byte comparisons, and none of them needed arranging: a MAC has
 * no nonce, so a differing tag means a genuine disagreement about the
 * MAC_structure, the truncation or the primitive.
 */
const MAC0_AGREEMENTS = [
    ['toBeMaced',  'the MAC_structure'],
    ['tag',        'the authentication tag'],
    ['message',    'the complete message'],
    ['thumbprint', 'the RFC 9679 thumbprint of the symmetric key'],
];

for (const testCase of vectors['cose-mac0']) {

    const key   = `cose-mac0:${testCase.id}`;
    const klass = testCase.class ?? 'normative';

    for (const [check, what] of MAC0_AGREEMENTS) {

        const mine  = checkOf(csharp, key, check);
        const yours = checkOf(ts,     key, check);

        judge(testCase.id, `agree on ${what}`, 'csharp↔typescript', klass,
              mine?.status === 'ok' && mine.hex !== undefined && mine.hex === yours?.hex,
              `C#: ${describe(mine)} / TS: ${describe(yours)}`);

    }

    // ...and each has to accept what the other authenticated.
    for (const [impl, own, otherName, otherCross] of [
             ['csharp', csharp, 'typescript', tsCross],
             ['typescript', ts, 'csharp', csharpCross]]) {

        const message = checkOf(own, key, 'message');

        if (message?.status !== 'ok') {
            judge(testCase.id, `cross-verify ${impl}→${otherName}`, otherName, klass, false,
                  `${impl} produced no message to verify: ${describe(message)}`);
            continue;
        }

        const verified = checkOf(otherCross, `cose-mac0-verify:xmac0-${testCase.id}`, 'verify');

        judge(testCase.id, `cross-verify ${impl}→${otherName}`, otherName, klass,
              verified?.status === 'ok' && verified.verified === true,
              `${otherName} verifying the message authenticated by ${impl}: ${describe(verified)}`);

    }

}


// --- suite: cose-encrypt, the encrypted and enveloped structures ---

/**
 * What both implementations have to say the same thing about.
 *
 * `toBeEncrypted` is the structure claim — the Enc_structure for the encrypted
 * shapes, the MAC_structure for the enveloped MAC — and it is the one worth
 * checking separately: a message that comes out right by way of a wrong
 * additional-data structure stops coming out right the moment anything about
 * it changes.
 */
const ENCRYPT_AGREEMENTS = [
    ['toBeEncrypted', 'the structure that was authenticated'],
    ['ciphertext',    'the ciphertext or authentication tag'],
    ['message',       'the complete message'],
    ['recipient0',    'the first recipient structure'],
];

for (const testCase of vectors['cose-encrypt']) {

    const key   = `cose-encrypt:${testCase.id}`;
    const klass = testCase.class ?? 'normative';

    for (const [check, what] of ENCRYPT_AGREEMENTS) {

        const mine  = checkOf(csharp, key, check);
        const yours = checkOf(ts,     key, check);

        // Not every shape records every check: only the enveloped ones have a
        // recipient structure.
        if (mine === undefined && yours === undefined)
            continue;

        judge(testCase.id, `agree on ${what}`, 'csharp↔typescript', klass,
              mine?.status === 'ok' && mine.hex !== undefined && mine.hex === yours?.hex,
              `C#: ${describe(mine)} / TS: ${describe(yours)}`);

    }

    // The values RFC 9052 Appendix C.5.4 prints, where a case names them.
    if (testCase.expectedTag !== undefined) {
        for (const [impl, results] of impls) {
            const tag = checkOf(results, key, 'ciphertext');
            judge(testCase.id, 'the tag published by RFC 9052 C.5.4', impl, klass,
                  tag?.status === 'ok' && tag.hex === testCase.expectedTag, describe(tag));
        }
    }

    if (testCase.expectedWrapped !== undefined) {
        for (const [impl, results] of impls) {
            const wrapped = checkOf(results, key, 'recipient0');
            judge(testCase.id, 'the wrapped key published by RFC 9052 C.5.4', impl, klass,
                  wrapped?.status === 'ok' && wrapped.hex === testCase.expectedWrapped, describe(wrapped));
        }
    }

    // ...and each has to open what the other produced.
    for (const [impl, own, otherName, otherCross] of [
             ['csharp', csharp, 'typescript', tsCross],
             ['typescript', ts, 'csharp', csharpCross]]) {

        const message = checkOf(own, key, 'message');

        if (message?.status !== 'ok') {
            judge(testCase.id, `cross-open ${impl}→${otherName}`, otherName, klass, false,
                  `${impl} produced no message to open: ${describe(message)}`);
            continue;
        }

        const opened = checkOf(otherCross, `cose-decrypt:xenc-${testCase.id}`, 'open');

        judge(testCase.id, `cross-open ${impl}→${otherName}`, otherName, klass,
              opened?.status === 'ok' && opened.verified === true,
              `${otherName} opening the message produced by ${impl}: ${describe(opened)}`);

    }

}


// --- suite: cose-x509, the certificate chains ---

/**
 * What both implementations have to say the same thing about.
 *
 * `message` is the serialization claim and `thumbprint` the reading one: a
 * thumbprint is the hash of the DER encoding, so two implementations that
 * agree on it agree about where the certificate begins and ends. The subject
 * is surveyed rather than judged — that two X.509 name renderers print the
 * same string is a nicety, not an interoperability property.
 */
const X509_AGREEMENTS = [
    ['message',    'the complete signed message'],
    ['thumbprint', 'the thumbprint of the end-entity certificate'],
];

for (const testCase of vectors['cose-x509']) {

    const key    = `cose-x509:${testCase.id}`;
    const klass  = testCase.class ?? 'normative';
    const accept = testCase.expected === 'accept';

    for (const [check, what] of X509_AGREEMENTS) {

        const mine  = checkOf(csharp, key, check);
        const yours = checkOf(ts,     key, check);

        judge(testCase.id, `agree on ${what}`, 'csharp↔typescript', klass,
              mine?.status === 'ok' && mine.hex !== undefined && mine.hex === yours?.hex,
              `C#: ${describe(mine)} / TS: ${describe(yours)}`);

    }

    // Both must reach the verdict the vector states, on their own message...
    for (const [impl, results] of impls) {

        const validate = checkOf(results, key, 'validate');

        judge(testCase.id, `validate (${testCase.expected})`, impl, klass,
              validate?.status === 'ok' && validate.verified === accept,
              describe(validate));

    }

    // ...and on the other implementation's, which is the whole point.
    for (const [impl, cross] of [['csharp', csharpCross], ['typescript', tsCross]]) {

        const otherName = impl === 'csharp' ? 'typescript' : 'csharp';
        const validate  = checkOf(cross, `cose-x509-validate:xx509-${testCase.id}`, 'validate');

        judge(testCase.id, `cross-validate ${otherName}→${impl}`, impl, klass,
              validate?.status === 'ok' && validate.verified === accept,
              describe(validate));

    }

    // The subject as each side renders it, recorded and not judged.
    for (const [impl, results] of impls) {

        const subject = checkOf(results, key, 'subject');

        judge(testCase.id, 'the subject of the end-entity certificate', impl, 'survey',
              true, describe(subject));

    }

}

// --- cross-implementation agreement on every shared check ---

const divergences = [];

for (const key of Object.keys(csharp.results)) {

    const tsCase = ts.results[key];
    if (tsCase === undefined)
        continue;

    for (const check of Object.keys(csharp.results[key])) {

        if (check === 'formatAscii')
            continue;

        const a = csharp.results[key][check];
        const b = tsCase[check];
        if (a === undefined || b === undefined)
            continue;

        const same =
            a.status === b.status &&
            (a.hex ?? null)  === (b.hex ?? null) &&
            (a.text ?? null) === (b.text ?? null) &&
            (a.json ?? null) === (b.json ?? null);

        if (!same)
            divergences.push({
                key, check,
                csharp:     describe(a),
                typescript: describe(b),
                tsAscii:    check === 'format' ? describe(tsCase['formatAscii']) : undefined,
            });

    }

}

// ---------------------------------------------------------------- report --

const failures = verdicts.filter(v => v.outcome === 'fail');
const passes   = verdicts.filter(v => v.outcome === 'pass');
const surveys  = verdicts.filter(v => v.outcome === 'info');

const perImpl = {};
for (const v of verdicts) {
    perImpl[v.impl] ??= { pass: 0, fail: 0, info: 0 };
    perImpl[v.impl][v.outcome === 'pass' ? 'pass' : v.outcome === 'fail' ? 'fail' : 'info']++;
}

const lines = [];
lines.push('# Metrological CBOR conformance report');
lines.push('');
lines.push(`- C# implementation: Vanaheimr Styx (assembly ${csharp.version})`);
lines.push(`- TypeScript implementation: MetrologicalCBOR.TS ${ts.version}`);
lines.push(`- Vector suites: values (${vectors['values'].length}), values-invalid (${vectors['values-invalid'].length}), documents (${vectors['documents'].length}), json-to-cbor (${vectors['json-to-cbor'].length}), cose-sign (${vectors['cose-sign'].length}), cose-mac0 (${vectors['cose-mac0'].length}), cose-encrypt (${vectors['cose-encrypt'].length}), cose-x509 (${vectors['cose-x509'].length})`);
lines.push('');
lines.push('## Summary');
lines.push('');
lines.push('| Implementation | normative pass | normative fail | survey observations |');
lines.push('|---|---:|---:|---:|');
for (const [impl, counts] of Object.entries(perImpl))
    lines.push(`| ${impl} | ${counts.pass} | ${counts.fail} | ${counts.info} |`);
lines.push('');
lines.push(`Cross-implementation divergences on shared checks: **${divergences.length}**`);
lines.push('');

if (failures.length > 0) {
    lines.push('## Normative failures');
    lines.push('');
    lines.push('| Case | Check | Implementation | Detail |');
    lines.push('|---|---|---|---|');
    for (const v of failures)
        lines.push(`| ${v.caseId} | ${v.check} | ${v.impl} | ${v.detail.replace(/\|/g, '\\|')} |`);
    lines.push('');
}

if (divergences.length > 0) {
    lines.push('## Cross-implementation divergences');
    lines.push('');
    lines.push('Checks where the two implementations, run with their defaults, behave differently.');
    lines.push('');
    lines.push('| Case | Check | C# | TypeScript |');
    lines.push('|---|---|---|---|');
    for (const d of divergences) {
        const tsText = d.tsAscii !== undefined && d.tsAscii !== 'not recorded'
                           ? `${d.typescript} (ascii: ${d.tsAscii})`
                           : d.typescript;
        lines.push(`| ${d.key} | ${d.check} | ${d.csharp.replace(/\|/g, '\\|')} | ${tsText.replace(/\|/g, '\\|')} |`);
    }
    lines.push('');
}

// --- COSE cross-signing ---

const coseVerdicts = verdicts.filter(v => vectors['cose-sign'].some(each => each.id === v.caseId));

lines.push('## COSE cross-signing');
lines.push('');
lines.push('Each case is signed by both implementations and then handed to the other one to');
lines.push('verify. Both sides sign deterministically, which is the only mode in which two');
lines.push('implementations can be compared byte for byte at all — [RFC 6979](https://www.rfc-editor.org/rfc/rfc6979)');
lines.push('for ECDSA, nothing at all to arrange for EdDSA, and the zero-randomness variant of');
lines.push('FIPS 204 for ML-DSA.');
lines.push('');
lines.push('| Case | Shape | Algorithm | Bytes agree | C#→TS | TS→C# |');
lines.push('|---|---|---|---|---|---|');

for (const testCase of vectors['cose-sign']) {

    const own       = coseVerdicts.filter(v => v.caseId === testCase.id);
    const agreed    = own.filter(v => v.check.startsWith('agree'));
    const toTS      = own.find(v => v.check === 'cross-verify csharp→typescript');
    const toCSharp  = own.find(v => v.check === 'cross-verify typescript→csharp');
    const mark      = v => v === undefined ? '—' : v.pass ? 'yes' : '**NO**';
    const algorithm = testCase.algorithm2 !== undefined
                          ? `${testCase.algorithm} + ${testCase.algorithm2}`
                          : testCase.algorithm;

    lines.push(`| ${testCase.id} | ${testCase.shape} | ${algorithm} | ` +
               `${agreed.filter(v => v.pass).length}/${agreed.length} | ${mark(toTS)} | ${mark(toCSharp)} |`);

}

lines.push('');

// --- COSE_Mac0 ---

lines.push('## Message authentication (COSE_Mac0)');
lines.push('');
lines.push('HMAC over the same structures the signatures use — [RFC 9052](https://www.rfc-editor.org/rfc/rfc9052)');
lines.push('Section 6.2, tag 17, and a MAC_structure differing from the Sig_structure in one');
lines.push('string. Nothing had to be arranged for these bytes to be comparable: a MAC is');
lines.push('deterministic by construction, so a differing tag is a genuine disagreement.');
lines.push('');
lines.push('A passing row says the two implementations authenticate alike. It does *not* say');
lines.push('a tag is evidence: whoever can verify one can produce one, which is why the');
lines.push('metrological record is signed and a MAC belongs on the link beneath it.');
lines.push('');
lines.push('| Case | Algorithm | Tag | Bytes agree | C#→TS | TS→C# |');
lines.push('|---|---|---|---|---|---|');

for (const testCase of vectors['cose-mac0']) {

    const own      = verdicts.filter(v => v.caseId === testCase.id && v.klass === 'normative');
    const agreed   = own.filter(v => v.check.startsWith('agree'));
    const toTS     = own.find(v => v.check === 'cross-verify csharp→typescript');
    const toCSharp = own.find(v => v.check === 'cross-verify typescript→csharp');
    const mark     = v => v === undefined ? '—' : v.pass ? 'yes' : '**NO**';
    const tag      = csharp.results[`cose-mac0:${testCase.id}`]?.tag?.hex;

    lines.push(`| ${testCase.id} | ${testCase.algorithm} | ` +
               `${tag === undefined ? '—' : `${String(tag.length / 2)} bytes`} | ` +
               `${agreed.filter(v => v.pass).length}/${agreed.length} | ${mark(toTS)} | ${mark(toCSharp)} |`);

}

lines.push('');

// --- COSE_Encrypt / COSE_Mac ---

lines.push('## Encrypted and enveloped structures');
lines.push('');
lines.push('`COSE_Encrypt0` (tag 16), `COSE_Encrypt` (tag 96) and `COSE_Mac` (tag 97), with');
lines.push('AES-GCM, AES key wrap and the `direct` recipient algorithm. Each is produced by');
lines.push('both implementations and then handed to the other one to open.');
lines.push('');
lines.push('A passing row says the two agree. It does *not* say the message proves who sent');
lines.push('it: with several recipients they all hold the same content key, so any of them');
lines.push('could have produced it. That is why the metrological record is signed, and why a');
lines.push('signed payload inside an encrypted envelope is how one gets both.');
lines.push('');
lines.push('| Case | Shape | Algorithm | Recipients | Bytes agree | C#→TS | TS→C# |');
lines.push('|---|---|---|---|---|---|---|');

for (const testCase of vectors['cose-encrypt']) {

    const own     = verdicts.filter(v => v.caseId === testCase.id && v.klass === 'normative');
    const agreed  = own.filter(v => v.check.startsWith('agree'));
    const toTS    = own.find(v => v.check === 'cross-open csharp→typescript');
    const toCS    = own.find(v => v.check === 'cross-open typescript→csharp');
    const mark    = v => v === undefined ? '—' : v.pass ? 'yes' : '**NO**';

    const recipients = (testCase.recipients ?? []).map(each => each.algorithm).join(' + ') || '—';

    lines.push(`| ${testCase.id} | ${testCase.shape} | ${testCase.algorithm} | ${recipients} | ` +
               `${agreed.filter(v => v.pass).length}/${agreed.length} | ${mark(toTS)} | ${mark(toCS)} |`);

}

lines.push('');

// --- COSE certificate chains ---

lines.push('## X.509 certificate chains');
lines.push('');
lines.push('Each case signs a meter reading, puts a certificate chain in the protected header');
lines.push('bucket, and asks both implementations to trace it to a trust anchor — first on');
lines.push('their own message, then on the message the other one produced. The');
lines.push('certificates come from a corpus minted by Bouncy Castle rather than by either');
lines.push('party being tested, because a DER parser checked against certificates its own');
lines.push('package produced would agree with itself about any misreading.');
lines.push('');
lines.push('| Case | Expected | Bytes agree | C# | TS | C#→TS | TS→C# |');
lines.push('|---|---|---|---|---|---|---|');

for (const testCase of vectors['cose-x509']) {

    const own      = verdicts.filter(v => v.caseId === testCase.id && v.klass === 'normative');
    const agreed   = own.filter(v => v.check.startsWith('agree'));
    const mark     = v => v === undefined ? '—' : v.pass ? 'yes' : '**NO**';
    const validate = impl => own.find(v => v.impl === impl && v.check.startsWith('validate'));
    const cross    = to   => own.find(v => v.check === `cross-validate ${to === 'csharp' ? 'typescript' : 'csharp'}→${to}`);

    lines.push(`| ${testCase.id} | ${testCase.expected} | ` +
               `${agreed.filter(v => v.pass).length}/${agreed.length} | ` +
               `${mark(validate('csharp'))} | ${mark(validate('typescript'))} | ` +
               `${mark(cross('typescript'))} | ${mark(cross('csharp'))} |`);

}

lines.push('');

lines.push('## Survey observations');
lines.push('');
lines.push('Behaviour on points the specification does not (yet) decide. These feed the specification work.');
lines.push('');
lines.push('| Case | Check | Implementation | Observed |');
lines.push('|---|---|---|---|');
for (const v of surveys)
    lines.push(`| ${v.caseId} | ${v.check} | ${v.impl} | ${v.detail.replace(/\|/g, '\\|')} |`);
lines.push('');

writeFileSync(join(resultsDir, 'report.md'), lines.join('\n'), 'utf8');
writeFileSync(join(resultsDir, 'verdicts.json'), JSON.stringify({ verdicts, divergences }, null, 2), 'utf8');

console.log('');
console.log('==============================================================');
for (const [impl, counts] of Object.entries(perImpl))
    console.log(`${impl.padEnd(12)} normative: ${counts.pass} pass, ${counts.fail} fail; survey: ${counts.info}`);
console.log(`cross-implementation divergences: ${divergences.length}`);
console.log(`report: ${join(resultsDir, 'report.md')}`);
console.log('==============================================================');

process.exit(failures.length > 0 ? 1 : 0);
