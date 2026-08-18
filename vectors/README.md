# Conformance test vectors

Language-neutral test vectors for Metrological CBOR (tag 44252), consumed by
every runner under `../runners/`. All hex strings are uppercase and contain no
whitespace. All JSON documents inside vectors are given as *exact text*
(compact, no insignificant whitespace), because the digits of a JSON number
are data and must be compared textually, not numerically.

Each file is one suite, selected by its `"suite"` field.

## Classes

Every expectation carries a class, explicit or implied:

- **normative** — required by the specification (or by the text-format /
  JSON-conversion specification). A mismatch is a conformance failure.
- **survey** — the specification does not (yet) decide this point, or the two
  implementations are known to disagree by design. Runners record their
  behaviour; the comparison report presents both sides without failing. Survey
  results feed the specification work in `../spec-draft/`.

## Suite `values` (`values.json`)

Single metrological values: wire bytes, canonical re-encoding, canonical text
form, and text parsing.

| Field | Meaning |
|---|---|
| `id` | unique case id |
| `description` | what the case exercises |
| `source` | where the expectation comes from (e.g. `spec §5`) |
| `hex` | the encoded value; the decoder MUST accept it |
| `canonicalHex` | what re-encoding the decoded value must produce (default: `hex`) |
| `canonicalHexClass` | `normative` (default) or `survey` |
| `text` | expected canonical text rendering (optional) |
| `textClass` | `normative` (default) or `survey` |
| `parseTexts` | additional texts to parse: `{text, hex?, expect}` where `expect` is `accept` (must parse to `hex`, defaulting to `canonicalHex`), `reject` (must not parse) or `survey` |

Runner checks per case: `decode` (accept `hex`), `reencode` (emit bytes),
`format` (emit text), `parse` (parse `text` back, when present), `parse:N`
(each `parseTexts` entry).

## Suite `values-invalid` (`values-invalid.json`)

Inputs that a conforming decoder / text parser must reject (`expect:
"reject"`), or whose treatment is undecided (`expect: "survey"`).

| Field | Meaning |
|---|---|
| `id`, `description`, `reason` | as above; `reason` names the violated rule |
| `hex` | encoded input for the CBOR decoder (mutually exclusive with `text`) |
| `text` | input for the text parser |
| `expect` | `reject` (default) or `survey` |

For survey cases the runner also records the re-encoded hex when the input was
accepted, so the report can show what the value was taken to mean.

## Suite `documents` (`documents.json`)

Document-level CBOR → JSON conversion (and back), the profile of
`metrological-text.md` Section 3.

| Field | Meaning |
|---|---|
| `cborHex` | the CBOR document |
| `json` | expected JSON text (optional) |
| `jsonClass` | `normative` (default when `json` present) or `survey` |
| `expectToJsonError` | the conversion must refuse the document |
| `roundtrip` | `true`: converting the produced JSON back must reproduce `cborHex` byte for byte; `false`: documented one-way; `"survey"`: record only |
| `roundtripHex` | when converting back yields *different, expected* bytes (e.g. a prose string that reads as a measurement), the bytes it must yield |

Runner checks: `toJson` (convert `cborHex`), `roundtrip` (convert own JSON
output back to bytes).

## Suite `json-to-cbor` (`json-to-cbor.json`)

The JSON → CBOR direction alone, exercised on exact JSON text.

| Field | Meaning |
|---|---|
| `json` | the JSON document, as exact text |
| `cborHex` | expected canonical CBOR (optional) |
| `class` | `normative` (default when `cborHex` present) or `survey` |

Note for runner authors: implementations whose JSON parser cannot preserve
number digits (e.g. JavaScript `JSON.parse`) convert what their parser hands
them. That is part of the observed behaviour and is *meant* to show up in the
comparison report — do not work around it.

## Cross-feeding

The comparison driver additionally feeds each implementation's `toJson` output
of the `documents` suite into the *other* implementation's `json-to-cbor`
conversion. For cases with `roundtrip: true` this must reproduce `cborHex`;
everything else is recorded as survey. This is the actual interoperability
test: a JSON document written by one side, read by the other.
