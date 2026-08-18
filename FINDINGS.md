# Conformance findings

**Date:** 2026-08-18 · produced by this suite against
Vanaheimr Styx (C#, submodule `libs/Styx`) and MetrologicalCBOR.TS 0.9.1
(submodule `libs/MetrologicalCBOR.TS`), judged against the specification in
`libs/specification/MetrologicalCBOR/` (tag specification `README.md` and
text-format/JSON specification `metrological-text.md`).

Full detail: run `npm test` and read `results/report.md`. This file names the
findings that need a human decision, most important first.

## 1. The good news

- **All ten §5 wire vectors** decode, re-encode and round-trip byte-identically
  in both implementations.
- **The worked signed example's meter reading converts to the *identical* JSON
  document in both implementations** — including the reading
  `"(1234.567 ±12.3) kWh, k=2, p=0.95, dist=normal"` — and both re-encode that
  JSON to the same canonical bytes.
- All normative document-level JSON round-trips (readings, prefixed units,
  uncertainty with `k=`, nested structures, base64url bytes, tag 0 dates,
  the `"1 h"` false-positive hazard) pass in **both directions across
  implementations**: JSON written by C# is read back to the same bytes by
  TypeScript, and vice versa.
- Both reject the same core of invalid inputs: floats/bigfloats as values,
  wrong arities, unknown units/ids/symbols, non-canonical prefixes, negative
  uncertainties, probability outside ]0,1], non-positive degrees of freedom,
  malformed rational exponents, unknown distributions.

## 2. Interoperability breaks (JSON written by one side, unreadable or misread by the other)

These are the findings that matter for the JSON conversion, because a reading
that fails to parse **silently stays a text string** — the measurement quietly
becomes prose.

| # | Producer writes | Consumer behaviour | Root cause |
|---|---|---|---|
| 2.1 | TS: `9.81 m·s⁻²` (superscript exponents, default output) | C# cannot parse it → stays a string | C# grammar/parser has no superscripts; TS default canonical uses them |
| 2.2 | TS: `5×10³ m²` / `1.25×10⁻² d` (superscript scale) | C# cannot parse it | same |
| 2.3 | TS (ascii mode): `(5 +/-1) A`, `2x10^3 s^-2` | C# accepts only `+-` and `×`/`*` before `10^` | C# §2.6 tolerance list is narrower than TS's |
| 2.4 | C#: `(5 ±1) A, dist=t` | TS rejects `t` (knows only `student-t`) | the two documents specify different distribution names; C# *parses* both, TS only its own |
| 2.5 | TS: `42` (dimensionless reading, unit omitted) | C# rejects: "a metrological value must state its unit" | TS grammar makes the unit optional; C# doc says a reading always states one |
| 2.6 | TS: `500e0 V`, `50e1 V` (decimal fractions with exponent ≥ 0) | C# parses them but collapses to the integer `500` | see finding 4.1 |

**Where they already interoperate:** `ν=45` (C#) ↔ `nu=45` (TS) parse in both
directions; `·`, `*`, `±`, `+-`, `µ`/`μ`, `Ω` both codepoints, `e`-notation
input, and the unit aliases all cross-parse.

## 3. Normative failures against the current specification texts

**All resolved on 2026-08-18** — the suite now reports **zero normative
failures** for both implementations. What happened to each finding:

| Finding was | Resolution |
|---|---|
| **both** accepted a bare bignum (tag 2/3) as `value`, which spec §3.1 forbade | **Specification changed** (§3.1 + CDDL): a bignum is now a legal value for integers beyond major type 0/1. Bignum mantissas were already legal — every parser handles bignums anyway — and huge integral readings were otherwise unrepresentable. Writing an integer that fits major type 0/1 as a bignum stays forbidden (preferred serialization); whether a decoder rejects that spelling is the deterministic-profile question of §4.11, surveyed as `value-non-preferred-bignum`. |
| C# accepted `{1: 1, 4: 0}` (distribution 0) and silently normalised it away | **Styx fixed**: decoding now rejects a written distribution 0. |
| C# text parser accepted `5. A` and `.5 A` | **Styx fixed**: a number-grammar gate requires digits on both sides of the decimal point and after the exponent marker — for the value, the uncertainty magnitude and the `k=`/`p=`/`ν=` statement values alike. |
| TS text parser accepted `5.0mA` (missing space before the unit) | **MetrologicalCBOR.TS fixed**: the space between the number (with its scale) and the unit is now required. |
| TS text parser accepted duplicate statements (`k=2, k=3` yielded k=3) | **MetrologicalCBOR.TS fixed**: the same statement twice is now an error, matching metrological-text §2.5. |

## 4. Divergences the specification must decide (currently undefined or contradictory)

Each row is observed behaviour with defaults; recommendations are proposals,
not applied anywhere.

| # | Question | C# (Styx) | TS | Recommendation |
|---|---|---|---|---|
| 4.1 | Decimal fractions with exponent ≥ 0 (`4([0, 500])`, `4([1, 50])`) | collapses to integer `500` on re-encode (its `Decimal` model cannot hold a negative scale) — breaks the §3.1 representation round-trip | preserves them; renders `500e0 V` / `50e1 V`, which its own doc says is never written and which C# reads as plain `500` | Forbid them on the wire: "the exponent of a decimal fraction MUST be negative; integral readings are written as integers". One rule, both implementations become conforming, the text format needs no scientific output. |
| 4.2 | Canonical text of integer unit exponents | `m·s^-2` | `m·s⁻²` (superscripts), ascii option `m*s^-2` | Canonical spelling = the caret form of metrological-text (`·` + `^`); superscripts stay accepted input. Readers MUST accept both; TS changes its default output (or C# adds superscript parsing — one of the two). |
| 4.3 | Canonical scale spelling | `×10^-2` | `×10⁻²`, ascii `x10^-2` | Same resolution as 4.2; also decide `x` as accepted input or not. |
| 4.4 | Student's t spelling | writes `dist=t`, accepts both | writes and accepts only `dist=student-t` | Pick `student-t` (self-describing); `t` becomes an accepted alias or is dropped. |
| 4.5 | Degrees-of-freedom key | writes `ν=`, accepts `nu=` | writes `nu=`, accepts `ν=` | Either works today; the spec should still name one canonical spelling (suggest `ν=` with `nu=` accepted, matching the ± convention). |
| 4.6 | Dimensionless readings in text | `42 1` (unit symbol `1` mandatory) | `42` (unit omitted); consequently TS tags **every numeric JSON string** as a dimensionless reading on the way back | Require the unit: `42 1`. A bare number MUST NOT be a metrological text — otherwise every numeric string in a JSON document silently becomes tag 44252 (observed: `{"s":"5"}` → tagged in TS, text in C#). |
| 4.7 | `km²` on input | rejected (`km²` would read as 10⁶ m²) | accepted as kilo·m² = 10³ m², and as the *product* `[[15,2]]` instead of unit 140 | Reject. TS's reading contradicts metrological-text §2.3 and its own refusal to write `km²`, and it creates a second wire spelling of m². |
| 4.8 | Unit *names* in text (`1 hour`) | accepted (doc says "symbol, alias or name") | rejected (symbols + aliases only) | Decide; suggest symbols + aliases only (names collide with prose in `auto` JSON detection). |
| 4.9 | Non-reduced rational exponents (`[-2, 4]`) | accepted and reduced (reads §3.2 "decoders MUST reduce") | rejected as a second spelling of the same exponent | State it explicitly. Reject fits the reject-don't-guess stance (§7) and deterministic encoding; accept-and-reduce fits the current wording. |
| 4.10 | `[[unit, 1]]`, `[unit, 0]`-prefix, `{…, 6: x}` unknown uncertainty keys, `[[m, 0]]` | accepted and silently *normalised away* (one-element product → named unit; redundant prefix dropped; unknown key dropped; m⁰ rejected) | all rejected | The spec bans the encoder from writing these; it should also say the decoder rejects them. Silently dropping an unknown uncertainty key is data loss (§7 spirit). |
| 4.11 | Non-shortest integer heads, indefinite lengths | accepted (lenient reader by default) | rejected (deterministic reader by default) | Spec §6 supports deterministic encoding; add: "decoders MAY/SHOULD reject non-deterministic encodings" and name the two profiles, so both defaults are describable. |
| 4.12 | Integers beyond 2^53 in JSON documents | exact JSON numbers (`18446744073709551615`) | refuses by default (`bigIntegers: 'error'`, opt-in `'string'`) | Spec decision per metrological-text §3.1: exact numbers, plus a note that ecosystem parsers may need a raw-number path; TS then needs a `'number'` option to conform. |
| 4.13 | Tag 4 / bignums *outside* readings in documents | converted to exact JSON numbers (`19.99`) | error (unknown tag) | Follow metrological-text §3.1 (convert); TS gains the two tag handlers. |
| 4.14 | Tag 1 (epoch time) | ISO 8601 string (`"2025-12-15T09:54:00.000Z"`) | the number it wraps (`1765792440`) | Both are documented one-way conversions; the spec must pick one (suggest the number — no timezone/format invention; the C# doc's own table currently says ISO 8601). |
| 4.15 | JSON numbers → CBOR (`5.0`, `1.10`, `1e2`) | exact decimal fractions from the digits as written (`4([-1, 50])`, `4([-2, 110])`, `4([2, 1])`) | binary float64 / integer via `JSON.parse` (`1.10` → 1.1, `2^53+1` → 2^53, `1e100` → the double's exact value as a 42-byte bignum) | The C# behaviour is metrological-text §3.2 and is the safe one; the spec should state that a converter MUST NOT go through binary floating point, and note what that requires of JavaScript (a raw-number JSON reader). |
| 4.16 | Floats in documents → JSON | `1.0` → `1.0` (keeps the point, reads back as a decimal fraction) | `1.0` → `1` (reads back as an integer) | Cosmetic on the surface, semantic on the way back; pick one (the C# form keeps float-ness visible, but neither round-trips the float — fine, floats are documented one-way). |

## 5. Specification housekeeping (applied by this project, to be committed upstream)

- The tag specification in the specification repository
  (`libs/specification/MetrologicalCBOR/README.md`) **lost the pointer to the
  text-format/JSON document**, and the document itself was not in the
  specification repository at all. → Added: `metrological-text.md` alongside
  the spec README, plus the restored pointer (see `libs/specification`).
- Styx carried its **own copies of the specification documents**
  (`tag-44252.md` — stale, with the pre-2026-08-18 registry numbering —
  `tag-44252-signed-example.md`, `IANA-registration.md`,
  `metrological-text.md`). All four were **removed from Styx**; every
  reference in Styx (code comments, the CBOR and COSE READMEs, test comments)
  now points at the official location,
  `https://github.com/OpenChargingTechnology/Whitepapers/tree/master/MetrologicalCBOR`.
  The IANA "Description of semantics" URL in the specification's Section 8,
  which pointed at the removed Styx file, now points at the specification
  itself.
