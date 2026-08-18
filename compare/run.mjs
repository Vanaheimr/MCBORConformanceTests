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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve }                             from 'node:path';
import { fileURLToPath }                                      from 'node:url';

const root       = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The vectors are the normative annex of the specification and live with it;
// this repository contributes the runners, the cross-feed and the judgement.
const vectorsDir = join(root, 'libs', 'specification', 'MetrologicalCBOR', 'test-vectors');
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

function runTypeScript(outputFile, ...inputs) {
    if (!existsSync(join(tsRunnerDir, 'node_modules', 'tsx')))
        sh('npm', ['install', '--no-audit', '--no-fund'], { cwd: tsRunnerDir });
    sh('npx', ['tsx', 'runner.ts', outputFile, ...inputs], { cwd: tsRunnerDir });
}

const phase1CSharp = join(resultsDir, 'csharp.json');
const phase1TS     = join(resultsDir, 'typescript.json');

if (!skipRun) {
    runCSharp(phase1CSharp, vectorsDir);
    runTypeScript(phase1TS, vectorsDir);
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

function crossVectorsFrom(sourceResults) {

    const jsonCases = [];
    const textCases = [];

    for (const testCase of vectors['documents']) {
        const recorded = sourceResults.results[`documents:${testCase.id}`];
        if (recorded?.toJson?.status === 'ok')
            jsonCases.push({ id: `xdoc-${testCase.id}`, json: recorded.toJson.json });
    }

    for (const testCase of vectors['values']) {
        const recorded = sourceResults.results[`values:${testCase.id}`];
        if (recorded?.format?.status === 'ok')
            textCases.push({ id: `xtext-${testCase.id}`, text: recorded.format.text });
    }

    return [
        { suite: 'json-to-cbor', description: 'cross-feed', cases: jsonCases },
        { suite: 'parse-texts',  description: 'cross-feed', cases: textCases },
    ];
}

const crossForTS     = join(resultsDir, 'cross-from-csharp');
const crossForCSharp = join(resultsDir, 'cross-from-typescript');

if (!skipRun) {

    for (const [prefix, source] of [[crossForTS, csharp], [crossForCSharp, ts]]) {
        const [jsonSuite, textSuite] = crossVectorsFrom(source);
        writeFileSync(`${prefix}-json.json`, JSON.stringify(jsonSuite, null, 2));
        writeFileSync(`${prefix}-text.json`, JSON.stringify(textSuite, null, 2));
    }

    runCSharp(join(resultsDir, 'csharp-cross.json'),
              `${crossForCSharp}-json.json`, `${crossForCSharp}-text.json`);

    runTypeScript(join(resultsDir, 'typescript-cross.json'),
                  `${crossForTS}-json.json`, `${crossForTS}-text.json`);

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
lines.push(`- Vector suites: values (${vectors['values'].length}), values-invalid (${vectors['values-invalid'].length}), documents (${vectors['documents'].length}), json-to-cbor (${vectors['json-to-cbor'].length})`);
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
