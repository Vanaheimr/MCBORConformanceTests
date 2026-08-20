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

The second focus is **COSE cross-signing** ([RFC 9052](https://www.rfc-editor.org/rfc/rfc9052)):
each implementation signs, and the other one verifies. That is the sharpest
test of an encoder there is — a reading encodes to a pure function of its
value, unit, prefix and uncertainty, so two implementations disagreeing about
one byte produce signatures that fail at the other, and nothing in either
implementation's own test suite would show it. It runs over ECDSA on seven
curves, EdDSA on Ed25519 and Ed448, and the three ML-DSA parameter sets of
RFC 9964 — where a 4627-byte signature over a thirty-byte reading is exactly
why a signed measurement belongs in CBOR rather than in base64 within JSON.
Classical and post-quantum signatures also meet inside single messages: a
hybrid `COSE_Sign` carrying one of each, and a meter reading signed with the
key the meter was manufactured with and countersigned post-quantum by the
gateway that received it. That is what a fleet emits while it is being
migrated, and neither half of it can be tested by one implementation alone.

A third strand is **message authentication and encryption** — `COSE_Mac0` and
`COSE_Mac` with HMAC, `COSE_Encrypt0` and `COSE_Encrypt` with AES-GCM, and the
recipient structures that carry a content key by `direct` or AES key wrap.
These need no arrangement to be compared beyond the vector supplying the key
and the nonce: everything about them is deterministic once those are fixed.

They are included for what they make visible rather than for what they protect.
A tag proves nothing to anyone who cannot also produce it; an encrypted message
proves even less about origin; and with more than one recipient the guarantee
stops distinguishing the recipients at all, since they all hold the same content
key. The metrological record therefore stays *signed*, with the symmetric forms
belonging on the link beneath it — eight bytes against sixty-four, or against
4627 post-quantum. The vector descriptions say so case by case, because a
passing row must not be read as more than it is.

The same argument runs a second time for **X.509 certificate chains**
([RFC 9360](https://www.rfc-editor.org/rfc/rfc9360)), where the message carries
the chain and the recipient holds only an anchor: each implementation signs a
reading with a certified key and then validates the *other* one's message,
which is where two DER parsers meet. The certificates come from a corpus minted
by Bouncy Castle rather than by either party being tested — a parser checked
against certificates its own package produced would agree with itself about any
misreading.

## Layout

| Path | Content |
|---|---|
| `libs/specification` | the specification (git submodule) — including `MetrologicalCBOR/test-vectors/`, the normative vector annex this suite executes |
| `libs/Styx` | the C# implementation (git submodule) |
| `libs/MetrologicalCBOR.TS` | the TypeScript implementation (git submodule) |
| `libs/COSE.TS` | [Vanaheimr COSE](libs/COSE.TS/README.md) (git submodule) — the TypeScript COSE implementation, the second party the cross-signing tests need |
| `vectors/` | the suites that are not what a metrological value *is*, and so do not belong in the specification's annex: COSE cross-signing, authentication, encryption, `crit` and certificate chains — COSE is how a value is signed — plus `cbor-robustness`, the layer beneath the one the specification describes |
| `tools/CertificateCorpus/` | generates `vectors/cose-x509-corpus.json` — fifteen certificates, deterministically, so it can be regenerated and diffed rather than believed |
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
   [test-vectors annex](libs/specification/MetrologicalCBOR/test-vectors/) and
   over [`vectors/`](vectors/) — each records what its implementation does with
   **default settings**, without judging;
2. **cross-feeds**: every JSON document and every canonical text produced by
   one implementation is handed to the other to convert back, and every COSE
   message signed by one is handed to the other to verify;
3. judges everything against the vector expectations — `normative` mismatches
   fail, `survey` observations are collected — and against the other
   implementation;
4. writes `results/report.md` and exits non-zero on normative failures.

`node compare/run.mjs --skip-run` re-judges existing recordings without
re-running the implementations.

The COSE package has golden vectors of its own — RFC 9052, RFC 9338, RFC 6979,
RFC 8032 and the specification's worked signed record — worth running first,
since an implementation that cannot verify a published example has nothing to
say about whether it agrees with the C# one:

```
cd libs/COSE.TS && npm install && npm test
```

The one departure from "default settings" is that both sides sign
**deterministically** for the COSE suite, which is the only mode in which two
implementations can be compared byte for byte. What that means differs by
family: RFC 6979 for ECDSA, nothing at all for EdDSA — which has no nonce to
draw and is deterministic whether or not anybody asks — and the variant of
FIPS 204 whose per-signature randomness is 32 zero bytes for ML-DSA, where
RFC 9964 declines to choose. Randomized signing is exercised by the
cross-verification instead, which accepts either.

## Continuous integration

The same two-leg matrix as the Styx and Hermod gates — windows-latest and
Debian 13 in a bare `debian:13` container. `ci.yml` gates every push against
the **pinned** submodule states; `nightly.yml` advances all four submodules
to their latest `master` and runs the same suite, so an upstream change that
breaks conformance or cross-implementation interop surfaces the next morning
— red there and green on CI means the fix belongs upstream before the pins
are bumped. Both publish the verdict to the run's summary page and upload
`results/` as an artifact, red runs most of all.

## Reading the results

- `results/report.md` — summary, normative failures, cross-implementation
  divergences, survey observations.
- [FINDINGS.md](FINDINGS.md) — the curated outcome: what interoperates, what
  each specification question was decided as, and what the cross-signing work
  surfaced that no single implementation could have.

## Specification status

The tag specification lives in `libs/specification/MetrologicalCBOR/README.md`.
The text-format and CBOR/JSON-conversion specification (`metrological-text.md`)
was written on the Styx side and was missing from the specification
repository; this project moved it there, so that both implementations and this
suite cite one normative source. The vectors followed it, as the normative
annex both implementations now execute in their own suites.

Every conversion question this suite surfaced has since been decided — see
[FINDINGS.md](FINDINGS.md) §4 for what was decided and why. COSE is
deliberately *not* part of that specification: it is how a metrological value
is signed, not what one is, so the algorithms and the cross-signing vectors
live here instead ([FINDINGS.md](FINDINGS.md) §6 and §7).

## License

[Apache License 2.0](LICENSE), matching both reference implementations.
