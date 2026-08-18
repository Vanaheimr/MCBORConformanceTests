# Metrological CBOR conformance tests

[![CI](https://github.com/Vanaheimr/MCBORConformanceTests/actions/workflows/ci.yml/badge.svg)](https://github.com/Vanaheimr/MCBORConformanceTests/actions/workflows/ci.yml)
[![Nightly](https://github.com/Vanaheimr/MCBORConformanceTests/actions/workflows/nightly.yml/badge.svg)](https://github.com/Vanaheimr/MCBORConformanceTests/actions/workflows/nightly.yml)

Cross-implementation conformance testing for **Metrological CBOR**
(CBOR tag 44252): the C# reference implementation ([Vanaheimr
Styx](https://github.com/Vanaheimr/Styx)) and the TypeScript reference
implementation
([MetrologicalCBOR.TS](https://github.com/Vanaheimr/MetrologicalCBOR.TS)) are
run against the same language-neutral vectors, against **each other**, and
against the specification
([OpenChargingTechnology/Whitepapers → MetrologicalCBOR](https://github.com/OpenChargingTechnology/Whitepapers)).

A particular focus is the **CBOR ↔ JSON document conversion**, in which every
metrological value travels as one string in the metrological text format
(`"1.10 kWh"`, `"(230.00 ±0.12) V, k=2"`): the suite verifies that JSON
written by one implementation converts back to the same canonical bytes by
the other.

## Layout

| Path | Content |
|---|---|
| `libs/specification` | the specification (git submodule) — including `MetrologicalCBOR/test-vectors/`, the normative vector annex this suite executes |
| `libs/Styx` | the C# implementation (git submodule) |
| `libs/MetrologicalCBOR.TS` | the TypeScript implementation (git submodule) |
| `runners/csharp/` | console runner referencing `Styx.csproj` (net10.0) |
| `runners/typescript/` | `tsx` runner importing the TS implementation from source |
| `compare/run.mjs` | the driver: runs both, cross-feeds, judges, reports |
| `results/` | generated: raw recordings, `report.md`, `verdicts.json` |
| `FINDINGS.md` | the current findings and the open specification decisions |

## Running

Prerequisites: .NET SDK 10, Node.js ≥ 20, and one-time network access for
NuGet restore and `npm install` (the TypeScript runner needs `tsx`).

```
npm test
```

(equivalently `./run-conformance.sh` or `node compare/run.mjs`). The driver

1. runs the C# and the TypeScript runner over the specification's
   [test-vectors annex](libs/specification/MetrologicalCBOR/test-vectors/) —
   each records what its implementation does with **default settings**,
   without judging;
2. **cross-feeds**: every JSON document and every canonical text produced by
   one implementation is handed to the other to convert back;
3. judges everything against the vector expectations — `normative` mismatches
   fail, `survey` observations are collected — and against the other
   implementation;
4. writes `results/report.md` and exits non-zero on normative failures.

`node compare/run.mjs --skip-run` re-judges existing recordings without
re-running the implementations.

## Continuous integration

The same two-leg matrix as the Styx and Hermod gates — windows-latest and
Debian 13 in a bare `debian:13` container. `ci.yml` gates every push against
the **pinned** submodule states; `nightly.yml` advances all three submodules
to their latest `master` and runs the same suite, so an upstream change that
breaks conformance or cross-implementation interop surfaces the next morning
— red there and green on CI means the fix belongs upstream before the pins
are bumped. Both publish the verdict to the run's summary page and upload
`results/` as an artifact, red runs most of all.

## Reading the results

- `results/report.md` — summary, normative failures, cross-implementation
  divergences, survey observations.
- [FINDINGS.md](FINDINGS.md) — the curated outcome: what interoperates, what
  fails which specification clause, and the list of points the specification
  has to decide (each with a proposal).

## Specification status

The tag specification lives in `libs/specification/MetrologicalCBOR/README.md`.
The text-format and CBOR/JSON-conversion specification (`metrological-text.md`)
was written on the Styx side and was missing from the specification
repository; this project adds it there (see the submodule working tree) so
that both implementations and this suite can cite one normative source.
The open conversion questions surfaced by this suite are listed in
[FINDINGS.md](FINDINGS.md) §4.

## License

[Apache License 2.0](LICENSE), matching both reference implementations.
