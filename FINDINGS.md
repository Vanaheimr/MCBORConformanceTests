# Conformance findings

**Date:** 2026-08-19 · produced by this suite against
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

## 2. Interoperability breaks — all resolved (2026-08-18)

Every break listed here on the first run is closed: the specification now
names one canonical spelling per point (metrological-text.md §2), both
implementations write it, and both accept the other's former spelling as
input. Concretely: the canonical form is the caret form (`9.81 m·s^-2`,
`×10^3`) with superscripts accepted on input everywhere; `+/-` and `x` are
accepted spellings of `±` and `×`; the canonical distribution name is
`student-t` with `t` accepted; the canonical degrees-of-freedom key is `ν=`
with `nu=` accepted; a dimensionless reading states the unit `1` (`42 1`),
so a bare numeric string is never a reading; and decimal fractions with a
non-negative exponent no longer exist on the wire (finding 4.1), so the
`500e0 V` spelling is gone.

The cross-feed of the suite — every canonical text and every JSON document
written by one implementation, read back by the other — passes with **zero
failures in both directions**.

## 3. Normative failures against the current specification texts

**All resolved on 2026-08-18** — the suite reports **zero normative
failures** for both implementations (335 normative passes each, §4-decision
state). What happened to each finding:

| Finding was | Resolution |
|---|---|
| **both** accepted a bare bignum (tag 2/3) as `value`, which spec §3.1 forbade | **Specification changed** (§3.1 + CDDL): a bignum is now a legal value for integers beyond major type 0/1. Bignum mantissas were already legal — every parser handles bignums anyway — and huge integral readings were otherwise unrepresentable. Writing an integer that fits major type 0/1 as a bignum stays forbidden (preferred serialization); whether a decoder rejects that spelling is the deterministic-profile question of §4.11, surveyed as `value-non-preferred-bignum`. |
| C# accepted `{1: 1, 4: 0}` (distribution 0) and silently normalised it away | **Styx fixed**: decoding now rejects a written distribution 0. |
| C# text parser accepted `5. A` and `.5 A` | **Styx fixed**: a number-grammar gate requires digits on both sides of the decimal point and after the exponent marker — for the value, the uncertainty magnitude and the `k=`/`p=`/`ν=` statement values alike. |
| TS text parser accepted `5.0mA` (missing space before the unit) | **MetrologicalCBOR.TS fixed**: the space between the number (with its scale) and the unit is now required. |
| TS text parser accepted duplicate statements (`k=2, k=3` yielded k=3) | **MetrologicalCBOR.TS fixed**: the same statement twice is now an error, matching metrological-text §2.5. |

## 4. Divergences the specification decided (2026-08-18)

Every row below is **resolved**: the specification was amended (tag
specification `README.md` §3.1–§3.4 and §6; `metrological-text.md` §2 and
§3), and both implementations were brought to it. The suite reports zero
normative failures per implementation — including the cross-feed of the
TypeScript ASCII rendering into the C# parser. The strict/lenient
decoder-profile difference that outlived this section (non-shortest heads,
indefinite lengths, non-preferred bignums) was closed on 2026-08-22, when C#
gained a byte-level metrological entry point that reads the RECOMMENDED
strict profile by default; see §18. The last one — the two JSON spellings of
an astral character — went on 2026-08-22 as well, and not by a decision about
spelling: it was a defect in one writer, see §22. **The suite records no
cross-implementation divergence at all.**

What was decided, per row of the original table:

| # | Decision |
|---|---|
| 4.1 | Decimal fractions with exponent ≥ 0 are **forbidden on the wire** (§3.1): an integral reading is written as an integer (or bignum), scientific text input with no decimal places left denotes that integer, and both decoders reject the wire spelling. This also dissolved C#'s `Decimal`-model limitation and TS's `500e0` output. |
| 4.2/4.3 | Canonical text = the **caret form** (`m·s^-2`, `×10^3`). Superscripts, `x` for `×` and `+/-` for `±` are accepted input in both implementations and listed in §2.6. TS changed its default output; C# gained the tolerances. |
| 4.4 | **`dist=student-t`** is written; `t` is an accepted input alias. C# changed its output, TS gained the alias. |
| 4.5 | **`ν=`** is written (`nu=` in ASCII mode and always accepted). TS changed its Unicode output. |
| 4.6 | A metrological text **always states its unit**; dimensionless readings are `42 1`. TS dropped its bare-number form, which also stopped its JSON conversion from tagging every numeric string. |
| 4.7 | **`km²` is rejected** — a prefix never folds onto a factor that is not at the first power, superscript or caret (`ks^-2`). TS fixed both paths. |
| 4.8 | Unit **names are not symbols** (`1 hour` is prose). §2.1 says symbols and aliases only; C# restricted its text and wire lookups. |
| 4.9 | Non-reduced rational exponents (and the rational spelling of an integer, `[2, 1]`) are **rejected**, not reduced (§3.2). C# added the checks. |
| 4.10 | `[[unit, 1]]`, the redundant prefix 0, unknown uncertainty-map keys and the exponent zero are all **decoder-MUST rejections** now (§3.2–§3.4). C# added the first three, TS the last. |
| 4.11 | §6 now names the two decoder profiles: **strict (RECOMMENDED)** verifies deterministic encoding; **lenient** MAY accept non-deterministic bytes but MUST NOT reproduce them. Both defaults became describable at once — and on 2026-08-22 they also became the same: `MetrologicalValue.TryParse(bytes, …)` reads the strict profile, which is where the rule belongs, while C#'s *generic* reader stays lenient because RFC 9052 requires it to (§18). |
| 4.12–4.16 | The JSON conversion is **exact and pinned** (metrological-text §3): integers of any size and decimal fractions are exact JSON numbers in both directions and never pass through binary floats; floats are written with their point (`1.0`) and come back as exact decimals; tag 1 becomes the instant as `YYYY-MM-DDThh:mm:ss.fffZ`; tags 2/3/4 outside readings convert as numbers. TS grew the exact text path this requires (`mcborToJsonText` / `jsonTextToMcbor`), since JavaScript's `JSON.parse`/`stringify` cannot carry exact digits; C# normalises JSON exponents that leave no decimal places to integers. |

The last tolerance questions were decided on 2026-08-18 as well, each the
way both implementations already agreed where they agreed: the coverage
factor MUST be positive (§3.4); leading zeros, surrounding whitespace, the
missing space inside the `±` parenthesis and after the statement comma are
accepted input (§2.6); and a bare space is **never** a factor separator —
`5 m s` stays prose (§2.6, the one point where the implementations differed;
TypeScript dropped the tolerance). Nothing from this section remains open:
the decoder-profile choice, the last thing that did, was settled on
2026-08-22 — see §18.

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

## 5. Specification housekeeping (applied by this project, upstream since 2026-08-18)

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

## 6. COSE cross-signing (added 2026-08-18)

Signing is what turns a metrological value into something a third party can
check, and it is also the sharpest possible conformance test of the encoders:
the encoding of a reading is a pure function of its value, scale, unit, prefix
and uncertainty, so two implementations that disagree about **one byte** of one
reading produce signatures that fail at the other. Nothing about that failure
is visible in either implementation's own test suite.

Styx has carried a full COSE implementation (`Styx/Illias/COSE`) since before
this project; MetrologicalCBOR.TS deliberately has none and never will — a data
format that also carried a crypto stack would be unusable as the leaf of
somebody else's schema. There was therefore nothing to cross-sign against. This
project adds the missing half as [`libs/COSE.TS`](libs/COSE.TS/README.md), a separate
TypeScript package with its own dependency (`@noble/curves`), leaving the mCBOR
library's dependency tree empty exactly as Styx keeps `Illias/COSE` beside
`Illias/CBOR` rather than inside it.

**Result: 23 cases, 110 byte-level agreements, 46 cross-verifications, zero
failures.** Both implementations produce *identical bytes* for the
Sig_structure, the signature, the complete message and the RFC 9679 key
thumbprint, and each verifies everything the other signed — across `ES256`,
`ES384`, `ES512`, `ESP256`, `ESB256` (brainpoolP256r1), `ESB320`
(brainpoolP320r1), `ES256K` (secp256k1), `Ed25519`, `Ed448` and all three
ML-DSA parameter sets, tagged and untagged messages, detached
payloads, external additional authenticated data, the empty-protected-bucket
application-algorithm form, `COSE_Sign` with two signers, and RFC 9338 version 2
countersignatures — the last two both with the signers drawn from one family
and from two (§8). One case signs a tag-44252 reading directly, which is the
claim the whole suite exists to make.

Byte-for-byte comparison is possible at all only because both sides sign
**deterministically** for this suite — RFC 6979 for ECDSA, and see §7 for what
the same word means in the other two families. That is the one place where
the runners depart from "the implementation's default settings" — Styx's
default is a randomized nonce — and it is recorded in the vector file. The
randomized mode is still exercised, by the cross-verification, which accepts
either form.

Three things this surfaced that a single implementation could not have:

- **Low-S normalization is an interoperability trap, not a detail.**
  `@noble/curves` normalizes `s` to its low form by default; COSE does not, and
  RFC 6979 publishes the un-normalized values. With the default left alone, the
  TypeScript side produced signatures that verified everywhere and were
  nevertheless *different bytes* from the C# ones for the same key and message.
  Signing now passes `lowS: false`, and verification passes it too, so a meter
  that signs without normalizing is not refused.
- **The RFC 9052 examples are themselves deterministic.** Signing Appendix
  C.2.1's payload with its published key reproduces the published signature
  byte for byte, which is a considerably stronger check on the Sig_structure
  than verifying it, and the suite now takes it.
- **brainpoolP320r1 had to be defined by hand**, because the TypeScript curve
  library ships the other three brainpool curves and not that one. It is now
  written out in `libs/COSE.TS/src/ecdsa.ts` from RFC 5639 §3.4, and the cross-signing
  case is what proves the transcription: a curve with one wrong hex digit in
  `p`, `a`, `b`, `n`, `Gx` or `Gy` works perfectly, signs and verifies against
  itself, and produces different bytes from everybody else. Byte agreement with
  Bouncy Castle's own brainpoolP320r1 settles all six constants at once, and
  incidentally confirms that both sides derive the RFC 6979 nonce with SHA-384
  there — the digest RFC 9864 pairs with a 320-bit curve, which looks like a
  mistake and is not. There is now **no asymmetry left**: every EC2 curve in
  the COSE registry is computable on both sides.

The COSE vectors live in [`vectors/cose-sign.json`](vectors/cose-sign.json)
rather than in the specification's annex, because COSE is how a metrological
value is signed and not what one is. The new package is additionally pinned
against RFC 9052 C.2.1/C.1.1/C.1.2, RFC 9338 A.2.1, RFC 6979 A.2.5 and the
specification's own 713-byte worked signed record — whose station signature,
both meter signatures and operator countersignature it verifies, and three of
whose four signatures it reproduces byte for byte.

## 7. EdDSA and post-quantum signatures (added 2026-08-19)

Both implementations now sign with **EdDSA** (Ed25519 = −19, Ed448 = −53,
RFC 9864) and with **ML-DSA** (−48/−49/−50, RFC 9964 over FIPS 204), and every
one of them cross-signs byte for byte.

The change that made both possible is one change. ECDSA signs a *digest* of the
Sig_structure, chosen by the algorithm; EdDSA and ML-DSA are **pure** and sign
the Sig_structure itself. Both implementations assumed the ECDSA shape
throughout — TypeScript threw on a null hash, Styx threw "does not define a
separate message digest" — so both gained an algorithm *family* and a signing
path that hands the structure over whole. Getting that backwards is the failure
with no symptom: a signature over the digest verifies perfectly against an
implementation making the same mistake, and against nothing else.

Two new key types came with them, and one of the two is a genuine trap:

- **OKP** for EdDSA, where the public key is the whole of `x` and there is no
  `y`. Styx's COSEKey was explicitly EC2-only ("Only COSE keys of key type EC2
  are supported"); it now reads all three.
- **AKP** for ML-DSA [RFC 9964] — and there the labels shift underfoot. On an
  EC2 or OKP key, `−1` is the curve and `−2` the x coordinate; on an AKP key
  they are the public and the private key. A parser that switches on the label
  alone reads a 1312-byte ML-DSA public key as a curve identifier and reports
  nothing wrong at all. Both implementations therefore establish the key type
  in a pass of its own before reading anything else, and both have a test that
  fails if that ordering is lost.

Two further RFC 9964 particulars are pinned by tests on both sides: `priv` is
the **32-byte seed** rather than the expanded secret key — which keeps a
private ML-DSA-87 key at 32 bytes instead of 4896 — and the thumbprint covers
**`alg`**, unlike every other key type, because an ML-DSA public key does not
say which parameter set produced it and two strengths must not be able to share
an identity.

**On determinism**, the two families sit at opposite ends. EdDSA is
deterministic by construction: RFC 8032 derives the nonce from the key and the
message and offers no alternative, so the published vectors are not merely
verifiable but *recomputable* — both implementations reproduce RFC 8032 §7.1
and §7.4 byte for byte, which is a stronger check than any ECDSA vector allows.
ML-DSA is randomized by default and RFC 9964 declines to choose; FIPS 204 also
defines a deterministic variant in which the per-signature randomness is 32
zero bytes. That variant is what both sides use here — `MLDsaSigner(…, true)`
in Bouncy Castle, `extraEntropy: false` in `@noble/post-quantum` — and the open
question of whether those two mean the same thing is now answered empirically:
**they produce identical bytes**.

The Styx COSE signing API was widened rather than overloaded, since nothing
outside this project uses it yet: `ECPrivateKeyParameters` and
`ECPublicKeyParameters` became `AsymmetricKeyParameter` across `COSESign1`,
`COSESign`, `COSEAlgorithm` and `COSEKey`. Not one call site needed changing —
an elliptic curve key *is* an `AsymmetricKeyParameter` — and the certificate
chain check dropped its EC-only gate, because whether a certified key can
verify is the algorithm's question rather than the chain's.

One methodological note, because it cost real time: the RFC 8032 vectors
fetched through a summarising web tool came back **corrupted** — one signature
had 129 hex characters, an odd number, and one public key had a duplicated
octet. Long hex constants must be taken from the raw document and verified
mechanically, which is how the ones in both test suites were finally obtained.

## 8. Mixed-family messages (added 2026-08-19)

EdDSA and ML-DSA arrived in the `COSE_Sign1` shape only, which is the shape
that exercises the least: one signer, one Sig_structure, one signature. The two
shapes that carry a second signer — `COSE_Sign` and the RFC 9338
countersignature — were still tested with ECDSA on both sides, so nothing in
the suite had ever put a classical and a post-quantum signature in the same
message. That is the one arrangement the transition guarantees, and four cases
now cover it.

- **`sign-hybrid-classical-and-postquantum`** — `ES256` and `ML-DSA-65` as the
  two signers of one `COSE_Sign`. A verifier that knows only ECDSA and a
  verifier that already requires ML-DSA are then satisfied by the same bytes,
  which is how a fleet is migrated without a flag day.
- **`sign-two-pure-schemes`** — `Ed25519` and `ML-DSA-44`: two pure schemes side
  by side, and two key types whose label `−1` means different things within one
  message.
- **`countersign-postquantum-over-classical`** — a meter signs its tag-44252
  reading with the brainpoolP256r1 key it was manufactured with, and the
  gateway countersigns with `ML-DSA-87`. The meter cannot be replaced; the
  archive can be protected against an adversary the meter's own signature is
  not. The whole message is 4760 bytes, for a 31-byte reading.
- **`countersign-classical-over-postquantum`** — the reverse, which tests a
  structure rather than a scenario.

All four agree byte for byte across the Sig_structures, both signatures, the
complete message and both thumbprints, and cross-verify in both directions.

Two things are worth recording.

**Neither runner needed a line of change.** Both had already been widened to
choose a key by algorithm family rather than by shape, so a second signer of a
different family was simply a second key. Going further — three or more signers
— was considered and left out: `COSE_Sign` iterates its signature array, and a
third entry would exercise no path in either implementation that the second
does not.

**The last case is the one worth having written.** RFC 9338's version-2
structure ends in `other_fields`, an array holding the body signature, and every
countersignature in this suite until now put 64 or 96 bytes there — comfortably
inside CBOR's one-byte length form, `81 58 40`. An ML-DSA-87 body signature is
4627 bytes and crosses into the two-byte form, `81 59 1213`. Both
implementations emit exactly that, and the two countersignature cases now sit on
either side of that boundary on purpose.

## 9. X.509 certificate chains (added 2026-08-19)

Styx validated certificate chains and COSE.TS carried them without looking:
both READMEs said so, and a `crit` demanding `x5chain` was consequently
refused on the TypeScript side. That asymmetry is now gone. `x5chain` and
`x5t` are read, walked to a trust anchor and bound to the key that signed on
both sides, and fourteen cases check that the two reach the same verdict —
first each on its own message, then each on the message the other produced.

**The library question decided the design.** The obvious TypeScript X.509
libraries verify certificate signatures through WebCrypto, which supports
neither the brainpool curves nor ML-DSA. A meter certificate on
brainpoolP256r1 — the one this whole project turns on — is exactly the
certificate they cannot check, so adopting one would have moved the asymmetry
rather than removed it. The DER is therefore read in
`libs/COSE.TS/src/asn1.ts` and `src/x509.ts`, and verification goes through
the same path as every other signature the package verifies: whatever COSE can
verify, a certificate can be signed with. The precedent is brainpoolP320r1,
written out by hand for the same reason.

**The certificates are minted by neither party.** `tools/CertificateCorpus`
issues them with Bouncy Castle: fifteen certificates, fixed scalars, fixed
serial numbers, fixed validity periods and a seeded random, so re-running the
generator changes nothing and the corpus can be diffed rather than believed. A
DER parser checked against certificates its own package produced would agree
with itself about any misreading whatsoever, which is the one thing a corpus
must not allow.

Three things this surfaced:

- **A named curve is not the same as its parameters.** The first corpus was
  rejected wholesale by the TypeScript parser, and the parser was right: Bouncy
  Castle, handed plain `ECDomainParameters`, writes the curve out
  *explicitly* — p, a, b, G, n and h, some 200 octets — where every real
  certificate carries an object identifier. `ECNamedDomainParameters` is what
  produces the shape RFC 5480 asks for. The failure was in the generator and
  looked exactly like a failure in the parser.
- **The chain changes curve halfway down**, on purpose: the root is on P-256
  and the manufacturer authority beneath it on brainpoolP256r1. An
  implementation taking the curve from the certificate being checked rather
  than from the key doing the checking passes every same-curve test and fails
  this one.
- **A valid chain is not an answer.** One case signs with the meter's key and
  attaches a chain certifying somebody else. The chain validates — the test
  asserts that separately — and the message is still refused, because the key
  it ends in is not the key that signed. An implementation reporting the
  chain's subject as the signer here would name the wrong meter with every
  certificate in order.

What is deliberately not checked, on both sides and identically, so that a pass
means the same thing: revocation, name constraints, certificate policies, and
path length beyond the CA flag. `x5bag` and `x5u` remain unimplemented in
both — a bag is an unordered heap with no path to follow, and a URI is a fetch.

The suite now stands at **429 (C#) / 393 (TypeScript) normative passes, 138
cross-implementation agreements, zero failures**.

## 10. Message authentication (added 2026-08-19)

Both implementations now carry `COSE_Mac0` [RFC 9052 §6.2] with the four HMAC
algorithms of RFC 9053 §3.1, and ten cases check that they authenticate alike.
This is the plainest cross-check in the suite: a MAC is deterministic by
construction, so nothing had to be arranged for the bytes to be comparable —
where an ECDSA comparison needs RFC 6979 and an ML-DSA one needs the
zero-randomness variant of FIPS 204, a tag is simply a function of the key and
the message.

**Why it is here at all, given that the record is signed.** A MAC and a
signature answer different questions, and the difference is not one of strength.
A signature says *the holder of that private key produced this*, to anybody who
cares to check. A tag says *someone holding the shared key produced this*, and
says it only to someone who holds that key too — because verifying one requires
the very key that creates one. Between two parties that is still useful: each
knows the other made it, having not made it themselves. Towards a third party it
is worth nothing, and a party who later denies having sent a reading cannot be
contradicted with a tag.

So the metrological record stays signed: the customer, the operator and the
regulator all have to be able to check it, and none of them may be able to
manufacture one. What a MAC is *for* is the link beneath — two ends that already
share a secret and want cheap tamper detection. The suite prices that out on the
same reading it signs elsewhere: **59 bytes** under an eight-byte tag, against
118 for the smallest signed form and 4675 post-quantum. COSE nests, so the
honest arrangement is both.

**Why HMAC and not AES-CBC-MAC.** RFC 9053 §3.2 registers the latter too, and it
is deliberately absent from both implementations. Raw CBC-MAC is secure only for
messages of a *fixed* length: given the tag `T` of a one-block message `M`, the
two-block message `M ‖ (T ⊕ M)` carries the very same tag — a forgery built
without the key. §3.2.1 says so itself and names what rescues it inside COSE,
*"a specific encoding structure that includes lengths"*. Its safety there is a
property of the `MAC_structure` rather than of the primitive, and HMAC needs no
such argument.

That section also settles a contradiction between the two RFCs, which cost some
reading: RFC 9052 Appendix C.6.1 describes algorithm 15 as *"AES-CMAC"*, while
RFC 9053 §3.2 states outright that AES-CBC-MAC **is not** AES-CMAC [RFC 4493] —
a different construction, which fixes exactly the length problem above. The
identifier is CBC-MAC; the prose of the other RFC is wrong.

**Three things the vectors pin that a single implementation would not have.**

- **Truncation is on the output.** `HMAC 256/64` is the leftmost eight bytes of
  the full HMAC-SHA-256, never a shortened key. An implementation doing it the
  other way verifies its own tags perfectly, which is why this needs two
  parties to catch — and it is what the falsification below actually broke.
- **A short key must be accepted.** RFC 9053 says a key SHOULD be as wide as
  the hash output, and SHOULD is not MUST: RFC 2104 accepts any width, and the
  published vectors of RFC 4231 depend on a four-byte key. A case exists so
  that neither side quietly tightens that into a refusal.
- **A key longer than the block size must be folded.** The 131-byte case
  crosses SHA-256's 64-byte boundary, where the primitive has to hash the key
  down first. It is the one step a hand-written HMAC gets wrong, and it is
  invisible below the boundary.

**No published vector pins both halves.** RFC 9052's only `COSE_Mac0` example,
Appendix C.6.1, uses AES-CBC-MAC. Both implementations therefore pin the
*structure* against it anyway — its 37 bytes are parsed, checked field by field,
re-encoded identically, and the `MAC_structure` built from its inputs asserted —
and the *primitive* against RFC 4231. The gap between the two is exactly what
the cross-implementation agreement closes.

**Falsified before being believed.** Reversing the truncation direction in the
TypeScript implementation alone — keeping the rightmost bytes instead of the
leftmost, a change that leaves it verifying its own messages perfectly — turns
the suite red on precisely the two truncated cases, in both directions, and
nowhere else. The full-width cases are unaffected, which is the correct
behaviour and the check that the harness is measuring what it claims.

Key type **Symmetric** (4) came with it, and label `−1` now means a third thing:
the curve on an EC2 or OKP key, the public key on an algorithm key pair, the
shared secret here. Both implementations already established the key type in a
pass of its own, so nothing had to change for that. `ToPublicCOSEKey()` /
`publicKey()` now throw on a symmetric key rather than returning it unchanged —
RFC 9053 §7.3 says the structure has no public form, and stripping the private
fields would hand a caller the secret under a name promising the opposite.

The suite now stands at **439 (C#) / 403 (TypeScript) normative passes, 178
cross-implementation agreements, zero failures**.

## 11. Recipient structures and encryption (added 2026-08-19)

`COSE_Mac` (tag 97), `COSE_Encrypt0` (tag 16) and `COSE_Encrypt` (tag 96) are
now implemented on both sides, with AES-GCM in all three key widths, AES key
wrap and the `direct` recipient algorithm. Thirteen cases check that the two
implementations produce the same bytes and can open each other's messages.

**What a recipient structure is for.** `COSE_Mac0` and `COSE_Encrypt0` assume
both parties already hold the key. The enveloped forms solve the distribution
problem *inside the message*: one content key protects the body, and one
recipient structure per party delivers that key by a route only that party can
walk. `direct` transports nothing — the recipient's key *is* the content key —
which makes a one-`direct`-recipient `COSE_Mac` a `COSE_Mac0` with ceremony,
and is precisely why the bare forms exist. AES key wrap carries the content key
encrypted under a key-encryption key.

**What it costs, which is the part worth writing down.** Every recipient holds
the same content key afterwards, so with more than one of them the tag stops
distinguishing them at all: any recipient can produce a message the others will
accept as coming from the sender. A `COSE_Mac0` between two parties at least
tells each of them that the other made it, on the grounds that they did not
make it themselves; a `COSE_Mac` to three parties tells nobody that. RFC 9052
§8.2 is blunt — a MAC *"cannot be used to prove the identity of the sender to a
third party"* — and §8.3 says the same of content encryption: *"either no or
very limited data origination"*. Two vector cases carry two recipients each,
and their descriptions say this out loud, because a passing row in the report
must not be read as more than it is.

**Three things about the encrypted structures that catch people out**, all of
them checked separately rather than only through the final bytes:

- **The `Enc_structure` has three elements, not four.** It is
  `[context, protected, external_aad]` — no payload. The payload is what gets
  *encrypted*; the `Enc_structure` is what gets *authenticated* alongside, as
  the AEAD's additional data. The suite compares it as its own check, because a
  message that comes out right by way of a wrong AAD stops coming out right the
  moment anything changes — which is exactly what the falsification below did.
- **The authentication tag is not a field.** AES-GCM's 16 bytes are appended to
  the ciphertext inside the same byte string.
- **The nonce is public and must never repeat.** Both implementations refuse to
  invent one: it is a required argument with no default, because a nonce reused
  under one key breaks GCM outright — two messages under one nonce leak the XOR
  of their plaintexts *and* the authentication subkey — and neither library can
  know which nonces a caller has spent. The vectors supply it, which is also
  what makes these bytes comparable at all.

**The strongest vectors this project has consumed so far.** RFC 9052 Appendix
C.5.4 is a `COSE_Mac` whose second recipient wraps the content key under a
published 256-bit key. Unwrapping it with A256KW, building the `MAC_structure`
with the `"MAC"` context and recomputing the tag reproduces the RFC's published
value byte for byte — one chain covering key wrap, the recipient structure, the
context string and HMAC at once, and both implementations reproduce the
published wrapped key as well. The COSE working group's AES-GCM examples add
whole messages *together with their intermediates* (the `Enc_structure` as hex,
the content key, the nonce), and all of those are checked rather than only the
output.

**Falsified.** Changing `COSE_Encrypt`'s context string from `"Encrypt"` to
`"Encrypt0"` in the TypeScript implementation alone — a mistake that leaves it
perfectly self-consistent — turns the suite red on exactly the three enveloped
encryption cases, nine agreement checks and both cross-open directions, and
nowhere else. The `recipient0` check keeps passing, which is correct: the
recipient structure does not depend on the body's context.

**Deliberately not implemented, identically on both sides**, so that a pass
means the same thing: AES-CBC-MAC (see §10), AES-CCM, ChaCha20/Poly1305, and
ECDH key agreement with the HKDF-based key derivations. The last of those is
filed with its reasons in §12, because it is the one omission here that is a
decision rather than a gap. *(Since 2026-11-01 two of these are built on both
sides, identically: ECDH-ES, whose conditions §12 records as met, and
ChaCha20/Poly1305, built the same day at the maintainer's decision and held to
the COSE working group's two examples by `encrypt0-chacha20poly1305` and
`encrypt-chacha20poly1305-direct`, whole message included.)*

The suite now stands at **454 (C#) / 418 (TypeScript) normative passes, 223
cross-implementation agreements, zero failures**.


## 12. ECDH-ES and the HKDF derivations: filed 2026-08-19, built 2026-11-01

Filed on 2026-08-19 as not built, deliberately, with the conditions that would
change that. Built on 2026-11-01, on both sides at once: ECDH-ES + HKDF-256
and + HKDF-512 (the agreed key *is* the content key), ECDH-ES + A128KW,
+ A192KW and + A256KW (the agreed key wraps it), on every EC2 curve both
implementations compute with and on X25519 and X448 — in COSE.TS (`f561b5f`)
and in Styx's `Illias/COSE` (`d438b6ee`), pinned here since `cc0361a`. Below,
the reasoning of the original entry stands where it still holds, and each of
its conditions is answered separately: the vectors by this repository, the
use case by the maintainer.

### The structure is derived, not transmitted

Every other structure in COSE is rebuilt from what the message carries.
`Sig_structure`, `MAC_structure` and `Enc_structure` are assembled out of the
protected bucket and the payload, so an implementation that builds one wrongly
produces bytes unlike everybody else's and fails loudly, at the layer where the
mistake lives.

`COSE_KDF_Context` [RFC 9053 §5.2] is not like that. It is assembled out of
what each side *believes*: which algorithm the derived key is about to serve,
how many bits it should be, who is PartyU and who is PartyV. None of it
travels. Both sides construct it independently, and the derivation succeeds
when they happen to construct the same thing.

**A mistake is self-consistent.** Sender and recipient run the same code, so a
wrong field is wrong on both sides and the message opens perfectly. Vectors
generated from the same lineage do not catch it, because they carry the same
mistake. The only instrument that finds it is an independent party — which is
why agreement between the two implementations here was never going to be
enough on its own, and is not what the cases rest on.

**A mistake is silent.** A wrong KDF context reports "AEAD tag mismatch": two
layers from the cause, and indistinguishable from a corrupted message, a wrong
key or a flipped bit on the wire. The cases therefore record the context, the
agreed secret and the derived key as values of their own, not only the message
they end in.

### The fields that go wrong

RFC 9052 Appendix C.3.1 — `ECDH-ES+HKDF-256` delivering a key for `A128GCM`,
recipient protected bucket `h'a1013818'` — has an eighteen-byte context, and
every plausible misreading is a different eighteen bytes:

| | encoded `COSE_KDF_Context` |
|---|---|
| correct | `840183f6f6f683f6f6f682188044a1013818` |
| `AlgorithmID` = −25 rather than 1 | `84`**`3818`**`83f6f6f683f6f6f6…` |
| absent `PartyInfo` fields omitted rather than `nil` | `8401`**`8080`**`82188044a1013818` |
| empty protected bucket written as `h'a0'` | `…83f6f6f6821880`**`41a0`** |
| `keyDataLength` counted in bytes | `…83f6f6f682`**`10`**`44a1013818` |

- **`AlgorithmID` names the algorithm the derived key will be used *for*, not
  the recipient algorithm that derived it**: `1` when ECDH-ES + HKDF-256
  agrees an A128GCM key, `-3` when ECDH-ES + A128KW agrees a key-encryption
  key. `-25` belongs only inside the protected bytes further down.
- **`PartyInfo` is a group of three fields that are always present** and may be
  `nil`.
- **`protected` is `empty_or_serialized_map`**, the recipient's protected
  bucket as it travels.
- **`keyDataLength` counts bits.**

The case `ecdh-direct-p256-cose-wg` pins the first row of that table as
`expectedContext` — the working group's example uses the very context C.3.1
prints — and the other two anchored cases pin theirs, including the `-3`-style
AlgorithmID of key wrap (`A256KW`, `0x24`). Both implementations reproduce all
three. What a recorded context establishes, and what it does not: it is
encoded by each library's own encoder from the fields the RFC names, so it
pins the encoder; that each library's *derivation* puts the same fields into
it is pinned by the derived key and the message, both checked against the
published values.

### The key agreement has edges of its own

- **The shared secret is the x-coordinate alone, through I2OSP, left-padded to
  the field size.** An implementation taking it from a big-integer library that
  strips leading zeros is wrong roughly once in 256 messages on P-256 and
  P-384, and roughly every second message on P-521. *Now covered:* two key
  pairs found by searching — `ecdh-direct-p256-zero-leading-secret` and
  `ecdh-key-wrap-p521-zero-leading-secret` — whose secrets begin with `00`, and
  a check that each implementation's secret keeps that byte at full width
  (32 and 66 bytes). Both do.
- **Static-Static derives the same secret every time**, so RFC 9053 §6.3.1
  makes `salt` or a PartyU nonce a MUST for it. *Moot here:* ECDH-SS is
  implemented on neither side. What it would add is that the recipient learns
  who sent the message, and a signature inside the envelope says that to
  everybody. Salt and party information *are* supported for ECDH-ES and
  covered by `ecdh-direct-salt-and-parties` and, since 2026-11-04 for the two
  fields that row leaves out, `ecdh-direct-the-other-party-fields` (§28).
- **Invalid-curve attacks.** The recipient key is static; without validating
  the received ephemeral point, the agreement runs on a curve the attacker
  chose, and whether decryption succeeds is the oracle. RFC 9053 §6.3.1.1
  names a check without making it a MUST, and for OKP has none; RFC 7748 §6.1's
  check of the output for all zeroes is the substitute. *Now covered:* three
  messages both implementations must refuse, each built by
  `tools/EcdhCases` so that it **opens** for an implementation that skipped
  the check — an ephemeral point of order two on a curve sharing P-256's `a`
  but not its `b`, encrypted under the key its secret `x0` derives; and the
  X25519 points u = 0 and u = 1, encrypted under the key the all-zero secret
  derives. The second of those is the one an *input* check for zero lets
  through and the *output* check catches. Both implementations refuse all
  three, and refuse them at the key agreement — "none of the recipients
  yielded a content key" — not at the AEAD tag.
- **HKDF-AES-MAC cannot be combined with ECDH at all.** Not implemented on
  either side, and not needed by anything implemented.

### The two conditions, one at a time

The original entry named two things that would change the decision, and said
the effort was not one of them.

**Vectors that can actually falsify it — answered.** Required were published
third-party vectors, a zero-byte x-coordinate chosen on purpose, and
point-validation cases that must be *rejected* rather than merely disagreed
about. All three are in `vectors/cose-ecdh.json`, and the third-party part
runs twice over: both libraries' own test suites carry all 31
ephemeral-static ECDH examples of the COSE working group, checked at every
intermediate they publish; here three of them are anchored with their
published secret, context, key and message. The generator of the cases depends
on neither implementation — only on the noble primitives, with the CBOR, the
KDF context, the COSE structures and the attack points written out by hand —
and refuses to write anything unless it first reproduces the working group's
`p256-hkdf-256-01` byte for byte. Beyond the published examples the two
implementations meet on X448, brainpool, P-384, secp256k1, salt and party
information and two recipients, and write identical bytes throughout.

### A use case was named

The original entry closed on a sentence no amount of building could answer:
"ECDH earns its keep when a content key must reach a party with whom nothing
was shared in advance — a situation this system does not currently have."
Whether the system has such a party is a decision about the system rather than
about the implementations, and this repository left it to the maintainer.

Achim Friedland took it on 2026-11-01: *"Ende-zu-Ende durch den Local
Controller und andere Use Cases sind wichtig"* — end to end through the Local
Controller, and other use cases besides. The specification records it the same
day in EVQI Transport §7.2, under "Delivering the key by ECDH-ES"
(`libs/specification` at `fd92f60`, pinned here since `300b416`), which names
the parties: CSMS and station, with a Local Controller between them that
relays the message and cannot read it; and beyond that a CSMS forwarding data
to a third party, data addressed to a contract holder, a station's log for its
manufacturer.

No case changed because of it — the decision says what ECDH-ES is for, not
what it does — so the position the original entry ended on is superseded
rather than revised: implemented, tested on both sides identically, and
called for.

The suite now stands at **577 (C#) / 541 (TypeScript) normative passes, 348
cross-implementation agreements, zero failures, zero divergences**; the
fourteen ECDH-ES cases account for 31 of each side's passes and 73 of the
agreements. The fourteenth, `ecdh-direct-x25519-chacha20poly1305`, is the one
no published example covers, so its secret, context, key and message are
checked against values `tools/EcdhCases` computes itself — independent of both
implementations, and labelled *computed* rather than *published* wherever the
suite reports them.

### A recipient named by its certificate (added 2026-11-01)

EVQI Transport §6.8, decided the same day, addresses an ECDH-ES recipient by
the SHA-256 thumbprint of its key-agreement certificate (`x5t`, RFC 9360)
rather than by a `kid`, because a station renewing its key holds the old and
the new one at once. Both libraries gained it together — COSE.TS `3b19e5b`,
Styx `9e0633a7`, pinned since `bc1d899` — and two cases hold them to it.

**The key and the certificate have one owner.** `tools/CertificateCorpus`
mints an operator authority on P-256 and two generations of one station's
key-agreement certificate, shaped as §6.8 has them: `keyUsage: keyAgreement`
and nothing else, critical, 90 days each, overlapping. `tools/EcdhCases` reads
key and DER from the corpus rather than writing its own, so two generators in
two languages never have to agree on a constant. Appended after everything
else, the new certificates leave every earlier byte of the corpus as it was.

`ecdh-direct-p256-x5t` is addressed to the renewed key and names it. Beyond the
agreements and the values the generator computes — thumbprint included — each
side must confirm that the certificate certifies the key the case agrees with,
so that the pairing is a row rather than a comment; open the other's message
given the certificate; and open it **without** one, because naming a
certificate is the opener's choice and a caller who names none must see no
change.

`ecdh-refuses-recipient-naming-another-certificate` is the station still
holding the old key and the old certificate, handed a recipient that names the
renewed one. §6.8 says the recipient "refuses a thumbprint that matches none of
its certificates instead of trying its keys in turn" — stated, not recommended,
so by this project's rule (§23) the case is normative. The first design of it
measured nothing, and it was the suite's own session that saw why: with the
message encrypted for the renewed key, an implementation that ignores `x5t`
tries the old key, derives another content key and fails at the AEAD tag —
refusing as well, for the wrong reason. The message is therefore encrypted for
the **old** key and names the renewed certificate anyway. Anybody can write
that, since nothing authenticates a recipient's unprotected bucket: the
`Enc_structure` covers the body's protected bucket, `COSE_KDF_Context` the
recipient's protected one. Ignoring the thumbprint now opens the message, which
makes opening the one wrong answer, and no error text is judged. Beside it
stands the control: the same message, same key, no certificate, must open —
without it a refusal would prove nothing, since a message that opens for nobody
is refused by everybody. The control is the second correction to the first
design: a "positive half" with the renewed key cannot exist, because the
message is not encrypted for it.

**Falsified, on both sides.** Making `isFor` answer yes to every certificate —
COSE.TS and Styx in turn, each alone — turns exactly one row red: `refuses`, on
the side that was changed. The control, the positive case and everything else
stay green.

`x5t` is a selector, not a protected statement. A matching thumbprint proves
nothing; it says which key to use. Whoever reads it as evidence of anything has
a vulnerability, and the description of both cases says so.

The suite now stands at **587 (C#) / 551 (TypeScript) normative passes, 356
cross-implementation agreements, zero failures, zero divergences**.

### What a recipient's unprotected bucket proves: nothing (added 2026-11-01)

The same principle has now come up three times in this section, so it is
stated once here, with the three cases under it. **Nothing in a recipient's
unprotected bucket is authenticated.** The `Enc_structure` covers the body's
protected bucket, and `COSE_KDF_Context` covers the recipient's *protected*
one. The ephemeral key, `kid`, `x5t` and the party information all travel
uncovered, and anybody who relays the message can rewrite them.

- **`x5t` is a selector.** It says which key to try and proves nothing about
  the certificate it names. `ecdh-refuses-recipient-naming-another-certificate`
  exists because of this: the message names the renewed certificate and is
  encrypted for the old key, which anybody can arrange.
- **Party information in the headers binds nothing.** PartyU and PartyV enter
  the derivation, but a recipient that reads them from the message's own
  headers derives whatever the message says. EVQI Transport first claimed that
  naming the CSMS and the station there would bind a possession challenge to
  the station (`ce3915d`), and withdrew the claim the same day (`7d569fb`).
  Party information binds only what each side supplies from its own context,
  and neither implementation reads it from anywhere but the message.
- **The ephemeral key is whatever the sender says it is.** That is why three
  of this section's refusals are built from ephemeral keys chosen by an
  attacker, and why the point checks matter.

What does authenticate a message lies elsewhere: a signature inside the
envelope, or, for a protocol, a request identifier together with the signature
on the answer.

### The possession challenge: filed, with reasons (added 2026-11-01)

EVQI Transport §6.8 has an X25519 key prove possession by decrypting a
challenge: a `COSE_Encrypt` by `ECDH-ES + HKDF-256` to the requested key, named
by `kid` = SHA-256 of its `SubjectPublicKeyInfo`, carrying a 32-byte nonce.
A case for it was proposed and **not built**, at the maintainer's decision of
2026-11-01, for three reasons:

- **The wire format is already covered.** `ecdh-direct-x25519-chacha20poly1305`
  has the same shape: X25519, ChaCha20/Poly1305, a `kid`, no `x5t`, no party
  information, generator-computed values, cross-opened. A challenge would
  differ in the *value* of the `kid` and the *content* of the payload, and
  COSE treats neither as behaviour. A `kid` is an opaque byte string, and a
  nonce is a payload like any other.
- **The derivation worth pinning is computed by nobody here.** `kid =
  SHA-256(SPKI)` is the kind of rule §12 was written against. It is derived
  rather than transmitted, and if both sides got it wrong in the same way,
  nothing would show, because the `kid` selects nothing. Hashing the bare
  32-byte key instead of the RFC 8410 structure would interoperate with
  exactly one implementation. But neither implementation computes the hash,
  neither exports a parser for an OKP `SubjectPublicKeyInfo`, and the runners
  copy the `kid` from the vector. A row judging it would compare the input
  with itself. Such a row cannot fail, which is worse than having no row,
  because it looks like coverage.
- **The refusals the flow needs are not COSE behaviour.** A wrong, late or
  reused nonce, a `requestId` that does not match, an unsigned answer: all of
  that is the CSMS's protocol logic. It belongs to the tests of work package
  D6 in WWCP, not to a suite of the COSE libraries. The one COSE-level
  refusal, a wrong `kid`, cannot be built so that it opens for whoever
  ignores it. Both implementations try every recipient regardless of `kid`,
  and such a message fails at the AEAD tag whichever way the check goes.

A case here would start to measure something under either of two conditions:
an implementation derives `kid = SHA-256(SPKI)` itself, and the derivation is
then pinned; or a refusal can be built that opens for an implementation which
skips the check.


## 13. Symmetry audit of the two implementations (added 2026-08-19)

The last three documented asymmetries were closed this week, but the feature
surfaces have grown in both repositories since. This is a systematic
comparison rather than an impression: the registries were extracted from both
codebases and diffed mechanically, and the option surfaces were read off the
declarations rather than off the documentation.

### COSE is symmetric, and now that is a measured statement

| | C# (Styx) | TypeScript (COSE.TS) |
|---|---|---|
| algorithms | 32 | 32 — **identical list**, identifiers and names |
| curves | 12 | 12 — identical |
| header parameter labels | 13 | 13 — identical (1–7, 11, 12, 32–35) |
| message types | 6 + recipient | 6 + recipient |
| understood labels for `crit` | {1, 2, 3, 4} | {1, 2, 3, 4} |

**The first row of that table expired, and nothing noticed for ten weeks.**
Re-measured the same way on 2026-11-03: 44 algorithms in Styx against 38 in
COSE.TS, the six being RSA, which Styx signs and COSE.TS does not know. The
other four rows still hold — 21 header parameter labels each now, identical.
§28 has the measurement and what it leaves open; what matters here is that a
hand audit is a photograph, and this one was taken before both libraries grew.

The features match as well — detached payloads, external additional
authenticated data, `crit`, RFC 9338 countersignatures, `x5chain`/`x5t`,
several signers, recipients by `direct` and key wrap — and so do the
deliberate omissions: `COSE_Countersignature0`, `x5bag`, `x5u`, AES-CBC-MAC
(§10), AES-CCM, ChaCha20/Poly1305, ECDH with the HKDF derivations (§12).
*(ECDH-ES and ChaCha20/Poly1305 have since been built on both sides,
identically; see §11 and §12.)*

One candidate finding did not survive checking. `CoseEncrypt0` and
`CoseEncrypt` share a source file in the TypeScript implementation, so a
naive extraction of its members attributed the headers-taking variant to
both; it exists on the bare form only, on both sides. Recorded because the
correction is the interesting part: an audit that reports its first
impression is worse than no audit.

What remains are idiom differences a C#/TypeScript pair is entitled to:
`CoseKey.withAlgorithm` exists only in TypeScript, and C# enumerates all
eight IANA key types where TypeScript exports the four it implements.

### The CBOR side: what "default settings" means differs

The one real asymmetry, and it is about testing rather than about behaviour:

```
Styx  CBORWriterOptions.Default   → Deterministic = false   (insertion order)
TS    EncodeOptions               → mapKeys: 'sorted'       (deterministic)
```

That much is a design choice. What makes it a finding is that **every**
golden-vector comparison on the C# side passes `CBORWriterOptions.Canonical`
explicitly — the conformance runner and Styx's own specification-vector tests
alike — while the TypeScript side gets deterministic encoding by default and
therefore exercises its normal path. A caller who writes a metrological value
with Styx's default writer options is on a code path no vector covers.

This is the writer-side counterpart of the reader-side divergence §4.11
records, and §4.11 names only the reader side. Not established: whether the
bytes actually differ — that depends on the order in which the encoder builds
the uncertainty map, which is very likely ascending anyway. The distinction
worth keeping is between *correct* and *correct by accident*.

C# also exposes two knobs TypeScript does not — `DuplicateKeyPolicy.TakeFirst`
and `UTF8Validation` — both defaulting to the strict behaviour TypeScript
hardcodes. Same shape as §4.11: C# configurable towards lenient, TypeScript
strict and fixed.

### Three gaps the audit found, and the vectors that close them

Of 141 specification vector cases, **none** touched text-string validity or
nesting depth; `crit` had exactly one case, inside the certificate-chain
suite, and it exercised only the honoured path. Both implementations claimed
the same behaviour in all three areas and nothing compared them.

**`vectors/cbor-robustness.json`, 16 cases** — the CBOR layer beneath the
metrological one, read with each library's *default* reader options. Seven
invalid UTF-8 strings that must be refused (a lone continuation byte, two
truncations, an overlong solidus, a lone surrogate, 0xFE and 0xFF), three
valid ones that must be read, and nesting at depths 1, 32 and 200. Where both
accept, the report compares what they *read*: two decoders can accept one
string and disagree about what it says.

Three survey cases sit at the bound — depths 63, 64 and 65 — because where a
depth count starts is documented by neither library. They now record the
answer: both accept 64 and refuse 65. That agreement was previously an
assumption; it is now a measurement, and it is what a maintainer needs before
changing the number.

**`vectors/cose-crit.json`, 7 cases** — every way a `crit` demand can fail,
with the expected verdict taken from RFC 9052 §3.1 rather than from either
implementation: a label nobody understands, a label listed but absent from the
protected bucket (*"this is a fatal error in processing the message"*), a
mixture where one of two labels is unknown, a `crit` travelling in the
unprotected bucket where an attacker could strip it, and the empty array the
RFC forbids outright. Two honoured cases guard the other direction, so that a
verifier which simply refuses anything carrying `crit` fails too.

Refusing to *build* a forbidden message counts as refusing it, and the report
says which answer each implementation gave. In the event both build all seven
and both refuse at verification, byte-identically.

### Falsified, twice, with a prediction the second time

Disabling UTF-8 validation in the TypeScript reader — one `{ fatal: true }` —
turns exactly the seven UTF-8 rejection rows red on that side, leaves C#
untouched and moves the divergence count from 3 to 10.

The second was a prediction made before the run: making the TypeScript
`isUnderstood` accept every integer label should fail exactly two crit cases,
because the other three rejections are structural rather than vocabulary
questions. It failed exactly `crit-unknown-label` and `crit-mixed-one-unknown`,
and the byte-agreement rows stayed green — the messages were still identical,
only the verdicts differed. A harness that discriminates at that granularity
is one whose green can be believed.

### The default writer path, measured

The finding above needed a suite of its own, because it could not be closed by
adding a case to an existing one: every path there passes `Canonical` on the C#
side by construction. `vectors/default-encoding.json` is that suite — five
cases, each **parsed from its text form** rather than decoded from bytes, so
that the map order comes from the encoder and not from something it read, and
each encoded with the library's *default* writer options. The expected bytes are
the specification annex's own, cited per case and checked against it
programmatically rather than retyped.

Specification §6 is what makes the cases normative rather than a survey: the
encoding of a metrological value *"is a function of its value, scale, unit,
prefix and uncertainty alone"*, so an encoder producing anything but the
canonical bytes has violated it whatever its options say.

**The answer is that Styx's default writer options do produce the canonical
bytes — and not for the reason one would hope.** The writer sorts map keys only
in deterministic mode; `CBORWriterOptions.Default` writes them in insertion
order. What saves it is that `MetrologicalValue.ToCBORUncertainty` appends keys
1 to 5 in ascending order by construction, so insertion order happens to equal
sorted order. The behaviour was correct; the guarantee was incidental. It is now
pinned by a test, which is the difference this entry was about.

**Falsified, with the prediction stated first.** Reversing those appends —
`entries.Reverse()`, one line — should turn exactly the three map-carrying cases
red on the C# side and leave the two map-free controls green. It did, and the
part worth reading is what *stayed* green: every other suite in the project,
all 479 other normative rows, despite the encoder now building the map the wrong
way round. They pass `Canonical`, which sorts it back. Nothing but this suite
could have seen it.

The suite now stands at **479 (C#) / 443 (TypeScript) normative passes, 240
cross-implementation agreements, zero failures**, with the three by-design
decoder-profile divergences of §4.11 unchanged. Nothing from this audit remains
open.


## 14. String escapes in the JSON profile (added 2026-08-20)

Found by coverage rather than by reading APIs, which is why §13 missed it.
`src/json/text.ts` in the TypeScript implementation stood at **74.19 % of
statements and 60.51 % of branches** where every other module in that library
was above 97 %. The uncovered part was not error handling: it was the entire
hand-written string unescaper, and the tag paths beside it.

**Why a hand-written unescaper exists at all.** JavaScript's own `JSON.parse`
rounds 2^53+1 to 2^53 before any library sees a digit, so the exact JSON text
path — `mcborToJsonText` and `jsonTextToMcbor`, which the specification's §3
conversion requires and which the TypeScript conformance runner uses for every
JSON suite — carries its own reader. Its own reader means its own unescaper:
sixty lines of `switch` that no test had ever executed, on the critical path of
this project.

**And nothing compared it.** Of the 37 JSON-carrying vector cases in this
project, **not one contained a backslash.**

`vectors/json-escapes.json`, 23 cases, closes both halves:

- **Reading is normative.** RFC 8259 §7 says exactly what each escape denotes,
  so the same text has to become the same bytes on both sides: all eight
  two-character escapes, unicode escapes in either digit case, a three-byte
  character, a surrogate pair that must join into one character rather than two
  sequences, an escaped NUL that is a character and not a terminator, the
  optional `\/`, and an escape in a map *name* rather than a value. Five more
  are refusals — a truncated escape, a non-hexadecimal one, an escape JSON does
  not define, an unterminated string and a raw control character.
- **Writing is recorded, not judged.** JSON permits several spellings of one
  string, so insisting the two agree would invent a requirement RFC 8259 does
  not make. What is held normative is that each implementation reads its own
  output back to the bytes it started from — and phase two's cross-feed makes
  each read the *other's*, which is the guarantee that actually matters. All
  eight written cases cross-fed in both directions; none refused.

### Two things the comparison found on its first run

**A legitimate spelling difference.** For U+1F600, C# writes the escaped
surrogate pair `"\uD83D\uDE00"` and TypeScript writes the character. Both are
correct JSON, each reads the other's, and the suite says so rather than picking
a winner. Recorded because a passing row should not be mistaken for byte
agreement that does not exist.

**A real divergence, and the more interesting one.** Given an unpaired
surrogate `"\uD800"`:

| | |
|---|---|
| **C#** | refuses — *"Cannot read incomplete UTF-16 JSON text as string with missing low surrogate"* |
| **TypeScript** | accepts, and substitutes U+FFFD (`63EFBFBD`) |

RFC 8259 §8.2 leaves unpaired surrogates to the implementation and UTF-8 cannot
carry one at all, so the case is classed **survey**: there is no requirement to
hold either side to, and the suite records the answers rather than failing
somebody. That is also why the case existed — it was written knowing the answer
was open.

**Decided, and the case is now normative.** A substitution silently changes
content, so the same document meant different things to the two of them; and
refusing what cannot be represented is the habit this library follows
everywhere else. TypeScript now refuses too, and the vector says `reject` for
both.

The change went into the **CBOR writer** rather than into the JSON reader, which
is the part worth recording. `TextEncoder` substitutes U+FFFD instead of
failing, so the writer was the one place in that library which silently changed
what it was given — while its reader has always refused a text string that is
not valid UTF-8. That asymmetry was the actual defect: the JSON path was only
where it happened to show. Putting the check at the writer means every path that
writes text inherits it, and `ERR_CBOR_UNENCODABLE` already existed for exactly
this ("a value cannot be encoded"), so no error taxonomy had to grow.

The vector is normative rather than survey now, and the classification is
honest about why: RFC 8259 §8.2 declines to decide, so the row records **this
project's** decision, in the same way §4 records the specification's. A third
implementation that substitutes is not violating the RFC; it is disagreeing
with us, and the suite should say so.

### Still uncovered, and deliberately out of this scope

The tag paths of the same module — UUID, URI, base64url, base64, MIME and
self-described CBOR, plus the `onUnknownTag` hook. Closing the escape gap took
`src/json/text.ts` from 74.19/60.51 to **85.88/69.74**, and the library as a
whole from 95.58/93.21 to **97.46/94.71**. Those tags are one-way conversions
rather than a hand-written parser, so they are worth less per test than the
unescaper was; they remain the largest single gap left in that library.

The suite now stands at **502 (C#) / 466 (TypeScript) normative passes, 249
cross-implementation agreements, zero failures**, with **four** divergences:
the three by-design decoder profiles of §4.11, and the astral spelling
difference above. The unpaired surrogate is no longer among them.


## 15. The conversion table, and what it says about RFC 8949 (added 2026-08-20)

§14 closed the escape gap and left the tag rows of the JSON profile open. Closing
those turned up something larger than a coverage number, from a question that
sounds like it has an obvious answer: *is there not already a specification for
converting CBOR to JSON?*

There is. **RFC 8949 §6.1** for CBOR to JSON and **§6.2** for the reverse, and
`metrological-text.md` §3 names the first of them: *"The base is [RFC 8949]
Section 6.1, extended by one rule: tag 44252 becomes one JSON string."*

That sentence understates what the table beneath it does.

### Where §3.1 departs from the advice it cites

§6.1 is explicitly **non-normative advice**, and it is written for *lossy
display*: its opening promise is to deal with what JSON cannot carry "by
converting them to a single substitute value, such as a JSON null". A
metrological record needs the opposite. So the table departs, and every
departure is right:

| Row | RFC 8949 §6.1 advises | `metrological-text.md` §3.1 |
|---|---|---|
| bignum (tag 2/3) | base64url **string**, with `~` prefixed for a negative | **number, exactly** |
| decimal fraction (tag 4) | ignore the tag, represent the content — the array `[exponent, mantissa]` | **number, with its scale** |
| tag 1 | ignore the tag, represent the content — a **number** | **ISO 8601 instant** |
| tag 37 | ignore the tag, represent the content — a byte string, hence base64url | **UUID string** |
| any other tag | **ignore the tag number**, represent the content | **error** |
| byte string | base64url, unpadded | base64url *(default)*, base64, hex — the default agrees |

The last row of that table is the sharpest: §6.1 would take an unregistered tag,
throw the number away and hand back the content. A reading that arrived wrapped
in a tag nobody registered would become a plain number, and nothing downstream
could tell that anything had been dropped. §3.1 refuses instead, which is the
same reject-don't-guess stance the tag specification takes everywhere else.

So the base is not "§6.1 extended by one rule". It is §6.1's *shape* — the same
item-by-item mapping — with five of its rules replaced because they trade
exactness for displayability, and one row added for tag 44252.

### And §3.2 cites nothing at all

The reverse direction has an RFC 8949 section too, and §3.2 does not mention it.
§6.2's suggested conversion says numbers with fractional parts *"are represented
as floating-point values"* through binary64 — precisely what §3.2 forbids in its
first sentence: *"Numbers never become binary floats."*

That looks like the largest contradiction in the document until the last
sentence of §6.2, which reads:

> Decimal representation should only be used on the CBOR side if that is
> specified in a protocol.

**This is that protocol.** §3.2 is not departing from §6.2; it is taking the
exemption §6.2 provides, and the same is true of the integer range, which §6.2
explicitly leaves to the protocol to widen. Saying so would make the document
stronger, not weaker: an implementer who reads §6.2 and finds no acknowledgement
of it in §3.2 has to guess whether the omission was considered.

### Applied to the specification, and pushed upstream

Done in `metrological-text.md` at `ce4765b`. Three corrections, **none of them a
rule change** — both implementations already did what the table said, and what
was wrong was the prose describing it:

- **§3's opening** is now a table naming the five replaced rules, with the
  reason in front of it: §6.1 is non-normative advice and says what it is for.
- **§3.2** cites §6.2 and its protocol sentence, which removes the appearance of
  a contradiction and tells an implementer that the omission was considered.
- **§3.3's** list of what does not round-trip was three rows short: tags 32, 33,
  34 and 36 keep the string and lose the tag that said what kind of string it
  was, and tag 55799 says something a JSON document has no way of saying.

The reason it was worth doing is what a third implementer sees. Reading "the
base is §6.1" and implementing §6.1 faithfully produced base64url where this
profile produces a UUID, a bare number where it produces a timestamp, and a
silently discarded tag where it refuses. The document now says which rows those
are, so the disagreement is visible before it is shipped rather than after.

### The vectors, and the coverage behind them

`vectors/json-tags.json`, 11 cases — one per row of §3.1 that no vector had
reached: tags 0, 1, 32, 33, 34, 36, 37 and 55799, a document-level decimal
fraction with a non-negative exponent (inside a reading §3.1 forbids one, so
only a document-level tag 4 can reach that branch), and the refusal of an
unregistered tag. **Six of those rows appeared in no vector at all**, in either
directory — a normative table with rows nothing verified on either side.

They are one-way conversions, so there is no round trip to hold them to; what
holds them is that the specification prescribes the text. **All eleven agree
across the two implementations**, including the four that depart from §6.1.

The library-side gap closed with them, and the distinction is worth keeping
straight: conformance vectors drive the *runners*, not the library's own tests,
so the first pass moved nothing. `src/json/text.ts` went from 85.88/69.74 to
**93.95/86.15** and the library from 97.46/94.71 to **98.73/97.27**, with
**function coverage reaching 100 %** for the first time. What is left there is
sixteen error paths and one defensive branch for a bignum a conforming reader
never hands over.

The suite now stands at **513 (C#) / 477 (TypeScript) normative passes, 259
cross-implementation agreements, zero failures**, with the same four divergences
as §14.


## 16. The last open flake was under the implementation, not in it (added 2026-08-20)

MetrologicalCBOR.TS carried one open fault: a property that had failed twice
under load with a shrunk counterexample that passed on replay, and that two
million further executions could not reproduce. It was written down as *"the
property is not a function of its input, cause unknown"*.

It is closed. The property **is** a function of its input. What is not is the
platform beneath it. V8 caches an object's property keys against the keys of
the object it parsed before, and a key ending in an **escaped backslash**
poisons that cache:

```js
JSON.parse('{"h":[],"\\\\":0}');                  // poison
Object.keys(JSON.parse('{"h":1,"\\"":2}'))[1];    // '"' comes back as '\'
```

It was **already reported** — [nodejs/node#63785](https://github.com/nodejs/node/issues/63785),
open since 2026-06-07, forwarded to V8 the next day as
[issue 521080746](https://issues.chromium.org/issues/521080746) — which is
worth knowing before anyone files anything. This project is the third
independent sighting; what it added upstream is the narrowing, and the rest of
the detail lives where the fix does not: MetrologicalCBOR.TS `WORKPLAN.md`, WP8,
and `scripts/v8-json-key-repro.mjs`. Three things belong here instead.

### Why a conformance suite has a stake in this

This suite's whole method is to run two independent implementations over the
same vectors and report where they disagree. That reasoning has a premise
nobody states: **that the ground under each implementation holds**. Where it
does not, a disagreement is still recorded faithfully and still attributed
wrongly — the report would say *TypeScript disagrees*, and every subsequent
hour would go into TypeScript.

So the first question to ask of a divergence that appears in one implementation
only, in a suite that has been green, is not "what changed in that
implementation" but "what is underneath it". Nothing here has ever needed that
question. It is written down now because the cost of not asking it was measured:
two days, on the wrong suspect, in a library that was correct.

### Why this suite is not exposed, and why that is worth checking rather than assuming

`runners/typescript/runner.ts` and `compare/run.mjs` both read their inputs with
`JSON.parse`. Two things keep them clear of it:

- **The keys never need escaping.** Vector files and result files are keyed by
  field names and case identifiers — `id`, `expect`, `hex`, `json-tags:tag-37`.
  The fault only reaches a key whose **last** character comes from an escape,
  and it only fires at all once some earlier object has left a key ending in
  `\\` in the cache. Neither happens here.
- **Values are not affected.** That is measured on the reduced trigger rather
  than assumed: the same escape that corrupts a key is read correctly in a
  value. Our files carry escapes in quantity, all of them in values.
- **The version this suite runs on is one of the clean ones.** Both CI legs put
  the TypeScript runner on Node 22, and the trigger reads every key back
  correctly there. Measured, not assumed — MetrologicalCBOR.TS sweeps four
  versions nightly, `ubuntu-latest` x64, a fresh process each:

  | Node | V8 | result |
  |---|---|---|
  | v20.20.2 | 11.3.244.8 | reads every key back correctly |
  | v22.23.2 | 12.4.254.21 | reads every key back correctly |
  | v24.19.0 | 13.6.233.17 | **loses 5 of 36 keys** |
  | v26.7.0 | 14.6.202.34 | **loses 5 of 36 keys** |

  The break falls between V8 12.4 and 13.6 — the 22 → 24 jump — and it is not
  fixed on the current line. Moving these runners to Node 24 or later would put
  them on an affected platform. The two bullets above say why that would still
  be safe; this one says it would stop being safe *by construction* and start
  being safe *by argument*, which is a different thing to rely on.

The earlier reading of this — *"the processes here are short, and the fault
needs a long-lived one"* — was wrong, and is left here because the error is
instructive. Process length was never a requirement; it was a proxy for how
long a fuzzer takes to stumble on a poisoning key followed by a matching one.
Given the two lines above, a cold process shows it immediately.

### What actually made it findable

Nothing about the search was cleverer than what had already been tried — two
million executions had been. What was missing was the ability to look twice:

- **A pinned seed.** `fc.assert` defaults to a clock-derived seed, so the
  original failure's inputs left with the process. Since MetrologicalCBOR.TS
  `4cd12dc` the properties run from a fixed seed and the nightly explores from
  its own run number.
- **A scale.** `MCBOR_PROPERTY_RUNS` multiplies a run for a campaign, so a
  search can be a hundred times larger than any push should pay for.
- **The one question already being asked.** `assertStable` had been added to
  distinguish a counterexample from a flake, and it answered *repeats
  identically* — which had been written down as meaning *the input is the
  cause*. It does not. A process that has fallen into a fault stays in it and
  repeats just as faithfully, and the difference between those two readings is
  a fresh process.

With those, `MCBOR_PROPERTY_SEED=83 MCBOR_PROPERTY_RUNS=5` fails at case 78 602
on demand. The campaign that produced it: **21 failures in 99 million property
executions** in long processes, against **1 in 43 million** in short ones — the
rate is a rate per process, not per case, which is the other reason the earlier
search came back empty.

The same campaign against the tree as it stood when the fault first appeared
reproduces it with the identical signature, so nothing committed since
introduced it, and nothing committed since would have fixed it.

### And one description written here was wrong

Worth recording, because the shape of the error is the kind this suite exists to
avoid. Every corruption observed looked like *the raw characters of the key, cut
to the length it would have had unescaped*: `\"` gave `\`, `*\"` gave `*\`. It
fits every case seen, it sounds mechanical, and it is a coincidence — the
poisoning key and the key it replaces differ only in the final escaped
character, so a substitution is indistinguishable from a truncation until you
try a key with something *after* the escape. `"ab\"cd"` reads back intact, which
refutes it in one line, and nobody thought to write that line until the reduced
trigger made the mechanism obvious.

A description that fits every observation is not thereby the mechanism. Finding
the case that would tell two explanations apart is the work; collecting more
cases that fit both is not.

### The ending, ten weeks later (added 2026-11-01)

V8 fixed it on main on 2026-09-17 —
[93cd21e](https://chromium.googlesource.com/v8/v8/+/93cd21e8254b65c15ff131b2dcadf19beadb559d),
*"skip fast transition path for escaped keys"*, crbug 521080746 — and
[nodejs/node#63785](https://github.com/nodejs/node/issues/63785) closed as
completed on 2026-10-26.

A fix on main is not a fix anybody has, and the nightly `platform` job was
built for exactly that gap: **v24.22.1 with V8 13.6.233.17 now reads every
escaped key back**, where on 2026-08-22 the same V8 line lost five of
thirty-six. Node 20, 22 and latest are clean as well. The backport has landed
and the hazard is gone from every supported Node.

Two things worth taking from how that was learned. The job **reports rather
than fails**, which is why it could be left running for ten weeks across four
Node versions without anybody tending it — a check that fails on somebody
else's defect gets disabled, and a check that reports gets read. And it was
written to answer *"which versions carry it, and when does it go away"*, a
question nobody could answer from one machine; it answered the second half on
its own, without anybody asking upstream.

The job stays, with its reason changed: it watched a live defect and is now a
regression guard.


## 17. A divergence this suite could not have found (added 2026-08-21)

The two implementations disagreed about an input for as long as both have
existed, and this suite reported zero failures throughout. Not a bug in the
suite — a limit of the method, and one worth writing down.

**What it was.** An uncertainty written as a map that states only its
magnitude, `44252([5, 4, 0, {1: 2}])`. The coverage factor defaults to 1, so
the map says exactly what the bare number `2` says. TypeScript refused it;
C# accepted it. Measured, not read:

| | `A10102` as an uncertainty |
|---|---|
| TypeScript, strict (its default) | `ERR_UNCERTAINTY_REDUNDANT_MAP` |
| TypeScript, lenient | accepted, re-encodes to `D9ACDC8405040002` |
| C# (Styx), default reader | accepted, re-encodes to `D9ACDC8405040002` |

Note the second and third rows: both implementations agree on what the map
*means*, and normalise it to the identical bare form. That is why nothing
downstream ever complained — the bytes that came out were right. What differed
was only whether the input was taken at all, which matters exactly once: a
signed document read and written back changed its bytes on one side.

**Why the suite was blind to it.** This suite finds disagreements the vectors
ask about, and the vectors can only ask what the specification says. §3.4
described the two forms an uncertainty may take and never said which one a
decoder must refuse, so there was no rule to write a vector against, so there
was no vector, so there was nothing to disagree in. **The suite's blind spot
is the specification's silence** — and silence is not visible in a report of
zero failures.

§6 made the silence checkable in hindsight: it collects the value-level
uniqueness rules as "one spelling per reading (§3.1), per exponent and per
unit (§3.2), per prefix (§3.3)". Four subsections state such a rule and the
list names three. The gap was in the sentence the whole time.

**What surfaced it** was not a test. It was writing down, in
MetrologicalCBOR.TS `WORKPLAN.md` §10.4, that four of the five strict-mode
refusals now rested on an explicit *decoders MUST reject* **and the fifth did
not**. Naming the residue instead of rounding it up to "closed" is what made
somebody go and measure the fifth.

**The closure**, in the order it had to happen: §3.4 gained the sentence in
the words its siblings use; §6's list gained §3.4; the annex gained
`uncertainty-map-only-magnitude`; and Styx was brought to it, since the
specification decides and both implementations follow. TypeScript needed no
change — its default already refused.

Falsified rather than assumed: removing the two lines from the Styx reader
turns exactly two tests red, the new unit assertion and the specification
vector, and nothing else. The suite now stands at **514 (C#) / 478
(TypeScript) normative passes**, one more per side, **259 cross-implementation
agreements, zero failures**, and the same four by-design divergences.

**What to take from it.** A conformance suite audits implementations against
a document. Nothing in it audits the document for the questions it forgets to
answer, and those are the questions where two honest implementations quietly
part company. The four subsections of §3 were readable as a checklist —
*does each rule that forbids a second spelling say what a decoder does with
it?* — and that check took an afternoon once someone thought to run it.


## 18. The signature covered a spelling, not a record (added 2026-08-22)

**Asked for**, in two sentences: make the C# side strict as well, and give
signing a parameter for whether the payload is canonicalized first — with the
default on, *because in e-mobility a record is typically received, parsed and
forwarded, so parsing and re-serializing has to be deterministic.*

Both are done. Between them they closed the last decoder-profile divergence
this suite had, and they turned up something about the specification's own
worked example.

### Strict, but at the layer the rule belongs to

The obvious reading — flip `CBORReaderOptions.Default.RequireDeterministic`
to `true` — was measured first, and it is wrong. Twelve call sites of
`CBORValue.TryParse` / `Parse` exist in Styx outside its tests and **not one
of them passes options**, so they all ride on that default; eight of the
twelve are COSE parsers. Flipping it turns **18 of 619** Styx tests red, in
two groups that both matter:

- `AppendixA_indefinite_length_vectors_normalize_to_their_definite_counterparts`
  fails with *"Indefinite-length arrays are not allowed within deterministic
  CBOR encoding (position 1)!"* — those are **RFC 8949 Appendix A's own
  vectors**. A strict-by-default generic reader is not a conforming CBOR
  reader.
- `The_whole_record_verifies_from_the_published_bytes_alone` fails with *"The
  CBOR map keys are not sorted in bytewise lexicographic order at position
  36!"* — the specification's own 713-byte worked record. More generally,
  **RFC 9052 does not require a received COSE message to be deterministically
  encoded**: a verifier hashes the bytes that arrived, and what the sender
  wrote is not its decision.

So the profile does not belong to the CBOR reader, which serves COSE. It
belongs to the tag, which is where it was put:

```csharp
MetrologicalValue.TryParse(bytes, out var value, out var error);           // strict
MetrologicalValue.TryParse(bytes, out …, CBORReaderOptions.Default);       // lenient
```

Strict by default, matching TypeScript's `decode()`. The `CBORValue` overload
deliberately grew **no** options parameter: by the time a caller holds a
`CBORValue`, the byte-level evidence has been read away, and an option there
would be a promise the layer cannot keep. `MetrologicalValue.ToByteArray()`
is the other half — deterministic by default, because §6 makes the encoding a
function of the value and the writer options do not get a vote.

The C# conformance runner now reads readings through that entry point, which
is what makes the two columns comparable at all; the deliberately-lenient
`cbor-robustness` cases still ask the generic reader directly, which is where
*"what does a caller who asked for nothing in particular get"* belongs.

**Cross-implementation divergences: 4 → 2.**

### Preferred bignums: the rule that was left over

What remained was `values-invalid:value-non-preferred-bignum` — `5` written
as a tag-2 bignum. §6 lists *"shortest integer heads, definite lengths,
sorted map keys, preferred bignums"* as the byte level, and C# implemented
the first three: `RequireDeterministic` is documented as RFC 8949 §4.2.1,
and preferred bignums live in §4.2.2. So the flag was right and the profile
was short one rule.

`CBORReaderOptions.RequirePreferredBignums` closes it, kept as its own
property for the reason the divergence existed — RFC 8949 keeps the two
sections apart, and so should the options. `CBORReaderOptions.Canonical` sets
both. The check needed two homes, because a bignum is a tag followed by a
byte string and neither of the reader's two calls knows it is looking at one.

**Cross-implementation divergences: 2 → 1**, and the one left is the astral
escape of §14, where both spellings are correct JSON.

### Signing the deterministic encoding

`COSESign1.Sign(…, CanonicalizePayload: true)` — and the same on
`COSESign.Sign` and on `CoseSign1.sign` / `CoseSign.sign` in COSE.TS.
`COSEPayload` / `payload.ts` hold the three operations: `Canonicalize`,
`IsCanonical`, `TryCanonicalize`.

Three decisions worth writing down:

- **A payload that is not CBOR is signed as it is.** RFC 9052 says nothing
  about what a payload contains, and every published COSE example carries
  `"This is the content."`. Refusing those would make the default useless for
  the format's own vectors.
- **`IsCanonical` is the round trip, not a strict decode.** What a forwarding
  receiver does is decode and re-encode; the question worth answering is
  whether *that* changes anything, not whether a list of rules is satisfied.
- **A detached payload that canonicalization would change is refused.** The
  message does not carry it, so the verifier is handed the caller's own
  bytes: signing a different spelling of them produces a message that can
  never verify, whoever holds it. The exception names the fix.

The conformance suite grew `sign1-non-canonical-payload`, a COSE_Sign1 over
`{"meter": …, "time": …}` written in reading order. Both implementations sign
the sorted 49 bytes and produce **byte-identical** messages — which is the
only way to know they agree about *which* of the two spellings a signature
covers. The two runners also stopped recording `toBeSigned` over the payload
they handed in rather than over the one the message carries; on every earlier
vector those are the same bytes, which is why nothing had caught it.

### What that found: the published worked example does not survive forwarding

Every map in the specification's worked record is in **reading order** —
`chargingStation`, `transaction`, `readings` — which is what a person wants
and not what RFC 8949 §4.2.1 asks for. So:

- `COSEPayload.IsCanonical(released.Payload)` is `false`, and so is every one
  of the two inner meter readings.
- A receiver that decodes the bundle and encodes it again — a backend, a
  roaming hub, anything that keeps a record as a model rather than as bytes —
  passes on a record whose signature no longer holds, **having altered
  nothing**. The forwarded payload is even the same length: sorting a map
  moves bytes without adding any.

That is exactly the failure the new default exists to prevent, and the
document that demonstrates the format demonstrated the failure. It was
recorded rather than repaired here, because regenerating a published example
rewrites a published document and its three signatures — a maintainer's
decision and not this project's. **It was taken the same day: see §19.**

### Falsification

- Flipping `CanonicalizePayload` back to `false`: exactly two tests red —
  `Signing_canonicalizes_by_default_so_forwarding_survives` (the payload the
  message carries equals the one handed in) and
  `A_detached_payload_that_canonicalization_would_change_is_refused` (no
  exception thrown). Nothing else moves.
- Each profile step was measured by the divergence count alone, and each time
  the rows that vanished were the predicted ones: the two byte-level rows for
  the strict entry point, the bignum row for §4.2.2.

The suite now stands at **515 (C#) / 479 (TypeScript) normative passes, 263
cross-implementation agreements, zero failures, one by-design divergence**;
Styx at **626** tests, COSE.TS at **224**.

**What to take from it.** A default that only ever changes bytes nobody
compares is invisible until somebody compares them — and a forwarder does,
every time, on behalf of a party who never chose. The specification's own
example had been through four implementations and a publication without
anyone asking whether *re-encoding it* preserved it, because every check it
had ever been given handed it the same bytes twice.


## 19. Four decisions, taken (added 2026-08-22)

§18 closed with four things **recorded rather than decided**, in this
project's habit of leaving to a maintainer what belongs to one. All four were
taken the same day, and three of them changed code.

### The worked example was regenerated

The published record is now written the way §18 says a signed document has to
be: every map in it, at both layers, is the deterministic encoding of itself.
`COSEPayload.IsCanonical` says yes of the bundle and of both meter readings,
and `The_published_record_survives_being_forwarded()` is the test that until
that morning was named for the opposite.

What did **not** change is the part worth reading. The record is the same
**713 bytes**; the bundle payload the same 511; the signed readings the same
221 and 219; the unsigned reading the same 134; the metrological value inside
it the same 31, byte for byte, because it was already canonical. The key
identifiers, the three protected buckets and the whole size table of the
document survived untouched. Sorting a map moves bytes without adding any —
which is exactly why the old spelling was so easy to publish without noticing.

The record is quoted in **seven places across four repositories**: Styx's
test, COSE.TS's, MetrologicalCBOR.TS's vectors and two of its examples, the
fetched `spec/` copy, and the published document. Every one was rewritten from
a single regeneration, wrapping preserved per file, rather than by hand —
hand-authored hex is what produced this project's only vector bugs.

Two tests had pinned the old spelling as a **property** rather than as data,
and both were turned around rather than adjusted: one asserted that the
payload was *not* in lexicographic order and that strict mode said so; the
other pinned the diagnostic notation in reading order. A test that says "and
this is fine" about a thing that is not fine is the most expensive kind to
leave lying around.

### Section 6 gained a sentence about the carrier

§6 made the encoding of a **value** a function of that value. The hazard §18
found lives one layer up — in the map that carries readings — and the section
said nothing about it. It does now: a document that will be signed SHOULD be
written in the deterministic encoding of RFC 8949 §4.2.1 throughout, because a
receiver that decodes it and encodes it again produces that encoding, and a
signature over another spelling of the same data fails in a way
indistinguishable from tampering. SHOULD and not MUST, because this
specification cannot bind a format it does not define.

### `readings` defaults to `'none'`

WORKPLAN §10.3 had carried *"taken by default, not decided"* since day one.
The decision went to `'none'`: nothing is guessed, a string stays a string
until the caller names which strings are readings. The argument for the old
default was that the round trip then worked without configuration; the
argument against it is that this put the risk on the party who had not chosen,
and the failure it risks is the invisible kind — a prose field holding
`"1 h"` becomes a perfectly well-formed reading of something nobody measured.

What it cost was measured before it was done, and the measurement moved the
question:

- **27 tests across five files** go red on the flip alone.
- Among them the **specification's own document vectors** — `meter-reading-sorted`,
  `transaction-record-sorted`, `nested-reading`, all marked `roundtrip: true`.
  The specification asserts that `"1.10 kWh"` converts back to tag 44252, so a
  default that declines is a default that does not perform the conversion the
  document specifies.
- And the **conformance runner** called `jsonTextToMcbor(jsonText)` bare, so
  the flip would have compared C#'s conversion against this library declining
  to perform one — a divergence in the whole JSON column that says nothing
  about either implementation.

That reframes the change from "a safer default" to "the conversion is
something a caller asks for, and asking is visible in the source". Every
caller that means the specified conversion now says `readings: 'auto'` — the
round-trip properties, the spec-vector tests, the runner, each with the reason
beside it. The suite is unchanged afterwards: **515 / 479 normative, 263
cross-implementation agreements, one divergence**, exactly as before.

It is a breaking change to published behaviour, made deliberately: at this
stage of the project a clean API outranks backwards compatibility, which the
maintainer said in as many words.

### The four unreachable branches are marked as unreachable

They had been annotated with the argument for their unreachability and left
uncovered on purpose, so that a reader would meet the argument rather than a
suppression. They now carry `/* v8 ignore */` hints **beside** those arguments
— the prose stays, because the prose is what a reader has. Coverage reads
**100% of statements, branches, functions and lines** (1570/1570, 1240/1240,
263/263, 1520/1520) instead of 99.9% with four exceptions one had to go and
look up.

Two things worth writing down from doing it:

- `/* v8 ignore next 3 */` in front of an `else` clause does **not** cover the
  clause. `/* v8 ignore start */` … `/* v8 ignore stop */` around it does. This
  was found by measuring, after the first attempt left the same line uncovered.
- Two of the four sites are the else-arm of a **conditional expression**, and
  v8 has no branch-level hint for one. The line hint therefore also stops
  reporting the arm that *is* taken. That is a real loss of signal, it is named
  in the comment at both sites, and it is the reason the argument in prose was
  not replaced by the hint but joined by it.

### What to take from it

Three of these four had been sitting in a document as "the maintainer's call"
— which is the right place for them, and also a place where a decision can
quietly become a non-decision. What moved them was not new information about
the code. It was someone reading the list and saying *do them*. The value of
writing an open question down is only realised when something makes the list
get read.


## 20. Two asymmetries, closed the same day they were named (added 2026-08-22)

§19 changed two defaults, and both changes stopped halfway across the project
without anyone intending them to. Naming them in an inventory is what made
them visible; both are now closed.

### C# was still guessing which strings are readings

`readings: 'none'` landed in MetrologicalCBOR.TS and Styx kept guessing:
`CBORJSONOptions.Metrology` defaulted to `Text` with no
`DetectMetrologicalValues` predicate, which means every string in a foreign
document was tried against the reading grammar. That is exactly the `'auto'`
TypeScript had just abandoned, and the argument for abandoning it — *a caller
who passes nothing should not get a guess* — says nothing about which language
the caller is writing in.

The conformance suite could not see it. Both runners now opt in explicitly, so
both columns compare the conversion metrological-text.md §3 describes rather
than two defaults; a divergence in defaults is invisible to a suite that
overrides them. **That is worth remembering about this suite in general: it
compares what it asks for.**

Styx gained `CBORJSONReadings { None, Auto }` with `Readings` defaulting to
`None`, and the existing per-path predicate keeps precedence where it is
given — the same three-way shape as `'none' | 'auto' | predicate`. Measured
rather than assumed: **13 of 627 tests** go red on the flip, the same shape as
the TypeScript 27 — the specification's document vectors, the JSON round
trips, and the detector test whose whole point was that the caller decides.

### `CanonicalizePayload` existed only on the two signing types

A COSE authentication tag covers bytes exactly as a signature does, so a
forwarder that decodes a payload and encodes it again destroys a MAC in
precisely the way §18 measured for a signature — and the party who loses is,
again, never the party who chose. The default was on `COSESign1` and
`COSESign` and not on `COSEMac0` or `COSEMac`, because the request had said
*signing* and that was taken literally.

Both MAC types now carry it, in both implementations, with the same three
decisions: a payload that is not CBOR is authenticated as it is; a detached
payload that canonicalizing would change is refused; and the test pair is the
same pair — the same record, forwarded the same way, survives with the default
and breaks without it.

`COSEEncrypt0` and `COSEEncrypt` deliberately did **not** get it. Their
ciphertext travels opaque and no forwarder re-encodes it without holding the
key, at which point it is composing a new message rather than passing one on.

### Falsification

Flipping the MAC default back turns **exactly one** test red per
implementation — the new pair — and nothing else. The suite is unchanged
throughout: **515 / 479 normative, 263 cross-implementation agreements, one
divergence**; Styx 628, COSE.TS 379.

### What to take from it

Both of these were consequences of decisions taken hours earlier, in the same
session, by the person who took them. Neither was caught by a test, because
each half of the project was internally consistent — and neither was caught by
the conformance suite, because the suite had been taught to ask for the
behaviour it wanted to compare. What caught them was writing an inventory and
reading it out loud.


## 21. A suite that asks for nothing (added 2026-08-22)

§20 ended on the limit of this method: **the suite compares what it asks
for.** Both runners pass `readings: 'auto'` where they mean the conversion
metrological-text.md §3.2 describes, which is right — and it is why a
day-long disagreement about the *default* passed through 263 green
cross-implementation rows without a mark.

There was already a precedent for closing exactly this kind of hole.
`default-encoding` exists because every other comparison hands the C# writer
`CBORWriterOptions.Canonical`, leaving the default writer on a path no vector
took. `default-readings` is the same idea one direction over: five documents
converted with **no options at all**, on both sides.

The five are chosen so that passing them means something: a reading at the
document root, a reading under a member called `energy` (a suggestive name is
still not an instruction), `"1 h"` — the prose that is also a measurement —
a document mixing a convertible string with one that never could be, and a
control that holds a *number*, so the suite cannot be satisfied by a converter
that has simply stopped converting.

**Falsified, and this is the part that matters.** Putting the TypeScript
default back to `'auto'` — the exact state of yesterday morning — turns **four
TypeScript rows and four cross-implementation rows red** and takes the
divergence count from 1 to 5. The same edit, before this suite existed, moved
nothing at all. The fifth row stays green in both states, because it is the
number: a control that went red would mean the suite was measuring something
other than what it claims.

The specification followed the same reasoning in the other direction. §3.2
described try-parsing as what the conversion does, with the caller narrowing
it per JSON Pointer path; both implementations now do the opposite, and a
document that describes a different default than every implementation of it
is the §17 failure mode exactly. §3.2 now says which strings are examined is
the caller's to name and that a converter SHOULD examine none until told, with
both ways of naming — every string, or per path — spelled out. §3.3's
byte-for-byte round trip gained the condition it always had and never stated:
*given a caller that named the strings to examine.*

The suite now stands at **520 (C#) / 484 (TypeScript) normative passes, 268
cross-implementation agreements, zero failures, one by-design divergence**.


## 22. "Both are valid" is a reason to stop comparing — and a reason nobody looks (added 2026-08-22)

The last divergence in this suite was `json-escapes:write-astral`: C# wrote
`"\uD83D\uDE00"`, TypeScript wrote `"😀"`, both are correct JSON for U+1F600
under RFC 8259 §7, and both read back to the identical `64F09F9880`. It had
been recorded as by design for two days, and everything in that sentence was
true.

It was also beside the point, and what surfaced that was not a test but a
throwaway remark that the TypeScript spelling looked nicer. Measuring before
answering turned it into something else entirely:

```
astral U+1F600   writer="\uD83D\uDE00"   tree="😀"
BMP    U+00E4    writer="ä"                tree="ä"
BMP    U+20AC    writer="€"                tree="€"
```

Three facts fell out of that, none of which anybody had.

**Styx was not choosing to escape.** Its UTF-8 writer is configured with
`JavaScriptEncoder.UnsafeRelaxedJsonEscaping` — "escape as little as
possible" — and for the whole Basic Multilingual Plane it obeys. Only above
U+FFFF does `Utf8JsonWriter` escape anyway.

**No built-in encoder can do otherwise.** `Default`,
`Create(UnicodeRanges.All)` and `UnsafeRelaxedJsonEscaping` all escape
U+1F600, measured on .NET 10. The reason is structural rather than a policy:
`JavaScriptEncoder.Create` takes `UnicodeRange`s, and a `UnicodeRange` is
built from `char`s, so `UnicodeRanges.All` means *all of the BMP*. Every
`System.Text.Json` producer in the world therefore escapes astral characters,
which is why this reads as a C#-versus-JavaScript difference and is really a
`System.Text.Json`-versus-everything-else one.

**Styx's own two paths disagreed with each other.** The Newtonsoft tree wrote
`"😀"` and the UTF-8 writer wrote the pair — for the same input, in the same
library. `CBORJSONTests.BothPathsAgree` exists precisely to catch that, and
was green, because not one vector in it carried a character above U+FFFF.

### The fix, and what it cost

`CBORJSONTextEncoder` escapes what RFC 8259 §7 requires — the quotation mark,
the reverse solidus, the controls below U+0020 — and nothing else. It has to
be a custom `JavaScriptEncoder`, and the two `TextEncoder` members a subclass
must override are abstract **and** `unsafe`, so Styx gained
`<AllowUnsafeBlocks>` for this one class. That is a real cost on a
general-purpose library and it is named in the csproj beside the flag: nothing
else in Styx uses pointers.

The conformance vector did not change here. The write direction of
`json-escapes` was deliberately built as **survey** — "a character above ASCII
may be escaped or not, and insisting on agreement there would invent a
requirement RFC 8259 does not make" — and that reasoning still stands; the row
simply agreed once the defect was gone. What it did not yet do was say what
the *right* spelling is, which §23 takes up.

**Falsified:** putting the old encoder back turns exactly one test red, the
new one, and nothing else.

### What to take from it

The row had a correct explanation attached to it, and the explanation is what
stopped anyone from looking. *Both spellings are valid* answers the question
"is this a conformance failure?" — it does not answer "why does each side
write what it writes?", and nobody had asked. Two days of a defect sitting
under a true sentence.

Worth carrying into the next by-design row: an explanation of why a
difference is *allowed* is not an explanation of why it *exists*.

**The suite now stands at 520 (C#) / 484 (TypeScript) normative passes, 268
cross-implementation agreements, zero failures and — for the first time —
zero divergences.**


## 23. RECOMMENDED, and what a suite does with one (added 2026-08-22)

§22 fixed a writer and left a gap that a one-line remark found: *you could
phrase it as highly recommended.* The suite had two verdicts, **normative** and
**survey**, and the escaping question fitted neither. Insisting on a spelling
would invent a requirement RFC 8259 §7 does not make; recording the spelling
without an opinion says nothing about which one to write.

RFC 2119 has the word for the middle, and the specification now uses it.
metrological-text.md §3.1 says a converter SHOULD escape only what §7 requires
— the quotation mark, the reverse solidus, the characters below U+0020 —
preferring the two-character forms where §7 defines one, and write every other
character as itself.

**Why it is worth saying at all**, given that both spellings are correct: it
makes the JSON text a *function of the CBOR document*. §3.1 already buys that
property for tag 1, by prescribing `YYYY-MM-DDThh:mm:ss.fffZ` down to the
millisecond, and for the same reason — a text two implementations derive
independently can be compared, and one that is a matter of taste cannot. The
escaping was the last place in the CBOR-to-JSON direction where the output was
not determined by the input.

### What that looks like in the harness

Eight write-direction vectors gained an `expectedJson`, and each is judged
against it **at survey class**, per implementation. That is the encoding of a
SHOULD: a deviation is recorded, legible and attributed —

```
| write-astral | wrote the recommended spelling | csharp | §3.1 recommends "😀", got "\uD83D\uDE00" |
```

— and the run stays green, because an implementation that escapes differently
is not failing the specification. The pairwise *"wrote the same spelling"* row
stays beside it, because the two catch different things: the pairwise row sees
the implementations drift apart, and the new rows see them **drift together**
away from the document. Nothing before could see the second.

Deriving the eight was the check worth having. Each expected spelling was
computed from the rule rather than copied from what the implementations
produce, and all eight matched what both already write — so the recommendation
names behaviour that agreed before it was written down, which is the cheapest
possible moment to write a rule.

**Falsified** by putting the old encoder back: the C# row for `write-astral`
reports `§3.1 recommends "😀", got "\uD83D\uDE00"` while the TypeScript row
beside it matches, the divergence count goes 0 → 1, and the normative counts
do not move at all.

Survey observations per implementation: 30 → **38**.

## 24. A rule both implementations enforced, and neither could be asked to break (added 2026-11-01)

COSE.TS 0.12.0 reads one thing more strictly than 0.11.0 did: a certificate
thumbprint whose algorithm names a signature or a MAC instead of a hash is
refused (`aec9823`). Styx enforces the same rule, with the same predicate —
`COSECertificateHash.IsHashAlgorithm`, which asks for `Family == None` *and* a
digest, and refuses both when reading the structure and when matching it
against a certificate.

Two implementations, one rule, agreed upon. And nothing in this suite measured
it. Each side checked it against itself: COSE.TS in
`tests/der-refusals.test.ts` and `tests/x509.test.ts`, whose own case title
reads *"refuses a signature algorithm in place of a hash, as Styx does"* — the
claim about the other implementation was in the test name, not in a row that
could fail.

### Why the suite could not reach it

`vectors/cose-x509.json` is generative: the runner builds each message through
the implementation under test and then reads it back. That is the right shape
for almost everything, and it cannot reach this rule at all. A rule enforced on
the way out cannot be violated on the way in by the same library —
`CoseCertificateHash.from` and `COSECertificateHash.From` both refuse to
construct the header, correctly, so there is no way to ask either side to write
the message that the other side must refuse.

So the message has to come from somewhere else. `tools/X509Cases` assembles it
from the noble primitives alone: the CBOR, the `COSE_Sign1`, the
`Sig_structure` and the `x5t` header are written out by hand, and the signature
is brainpool ECDSA over the bytes the generator built. It writes
`vectors/cose-x509-messages.json`, whose cases travel the reading path the
cross-feed already used (`cose-x509-validate`), so each runner needed one
dispatch line and no new code.

### Four messages that differ in one integer

Three label the thumbprint with an algorithm that is not a hash algorithm — a
signature one (`ES256`), a MAC one (`HMAC 256/256`) and a key-derivation one
(`ECDH-ES + HKDF-256`) — and one labels it `SHA-256`.

**The digest is correct in all four.** That is the whole construction. A
refusal is only measurable if the message verifies for an implementation that
skips the check, and here it does: all three wrong labels name SHA-256 for
their own purposes, so an implementation that reads the digest and hashes the
certificate without looking at the label finds a match and verifies the
message. Had the digest been wrong as well, both branches would have ended in
"does not verify" and the rows would have been green either way.

**Three, not one**, for the same reason the predicate has two halves. An
implementation that asked *"does this algorithm name a digest"* would accept
all three, because all three do; one that refused only signature algorithms
would pass the first row and fail the next two. The three rows separate those
from the question RFC 9054 actually registers, which is whether the algorithm
*is* a hash algorithm.

**The fourth row is the control**, and it is not the generator's word for what
a sound message looks like: its bytes are byte for byte the message both
implementations already produce and agree on for
`cose-x509:thumbprint-names-the-certificate`, and the generator refuses to
write the file unless it reproduces them — curve parameters, RFC 6979 nonce,
every CBOR head. The three refusals are therefore anchored in two independent
implementations rather than in a third party's say-so, and without the control
they would prove nothing: a message that verifies for nobody is refused by
everybody, whatever they check.

### Falsification

Each side alone, with the family check removed from its predicate and nothing
else touched:

| | normative | divergences | the three rows report |
|---|---|---|---|
| COSE.TS, `hashAlgorithmOf` | TS 555 → **552, 3 fail**; C# unchanged | 0 → **3** | `must refuse (…): verified` |
| Styx, `IsHashAlgorithm` | C# 591 → **588, 3 fail**; TS unchanged | 0 → **3** | `must refuse (…): verified` |

Exactly three rows per side, the same three, and the control stays green both
times. The word in the report is *verified*, not *error*: the mislabelled
message really does open for whoever skips the check, which is what the rows
were built to measure.

Both implementations, unpatched, refuse all three and name the algorithm while
doing it — Styx *"The certificate thumbprint of this COSE_Sign1 message is
invalid: The COSE algorithm 'ES256' of the COSE_CertHash is not a hash
algorithm!"*, COSE.TS the same sentence without the outer clause. The wording
is recorded and not judged; refusing is the measurement.

Suite: 587 / 551 normative and 356 agreements → **591 (C#) / 555 (TypeScript)
normative, 360 cross-implementation agreements**, zero failures, zero
divergences. Survey observations unchanged at 46.

### What to take from it

A rule two implementations agree on is the easiest kind to leave unmeasured,
because nothing goes wrong while they both hold it. The generative form of a
suite makes that worse rather than better: the better the implementations get
at refusing to write something, the less reachable the rule becomes from
inside, until the only party that can state the question is a third one. The
suite had such a third party for key agreement already, for a different reason
(§12: a derived structure nobody transmits). It needed a second one here for
the opposite reason — a structure that is transmitted, and that neither sender
will produce.

### A fifth message, and a sentence that is not true (added 2026-11-03)

The count of §28 found SHA-1 (−14) named by both implementations and computed
by neither, and that turns this family's question into a different one: not
whether an implementation checks that the label names a hash algorithm, but
what it does with a hash algorithm it does not have.
`thumbprint-labelled-with-sha-1` asks it. The same chain, an `x5t` naming
SHA-1, and beside it the correct **SHA-1** of the end-entity certificate rather
than the SHA-256 the other four carry — a digest neither implementation can
compute, so the third encoder computes it. RFC 9054 Section 3.1 registers
SHA-1 for exactly this field and recommends it "Filter Only", which the
registry defines as not for purposes that require collision resistance.

Both refuse, and both said the same thing: Styx *"The certificate thumbprint of
this COSE_Sign1 message is invalid: The COSE algorithm 'SHA-1' of the
COSE_CertHash is not a hash algorithm!"* and COSE.TS the same sentence without
the outer clause.

**That sentence was false.** SHA-1 is a hash algorithm, and RFC 9054 registers
it as one. What is true is that neither library computes it, because both
predicates ask for a digest they *have* rather than for a hash algorithm:
`Family == None` with a non-null `HashAlgorithmName` on one side,
`family === 'none'` with a non-null `hash` on the other — and both failures
came out as the one sentence. The verdict was defensible, since a verifier that
cannot perform a check it was asked to perform has little else to do, and the
reason it gave was wrong. By this family's own rule no error text is judged, so
the row recorded the verdict and this section recorded the wording.

It is fixed in both, the same day and the same way: COSE.TS `87264c2` and Styx
`59211b99` split the predicate's two failures into two sentences at all three
sites — computing a thumbprint, reading a `COSE_CertHash`, and matching one
against a certificate. An algorithm that is no hash algorithm at all keeps the
wording it had, so the three rows above read exactly as before; a hash
algorithm the implementation does not compute is now told that it is one and
that this implementation does not compute it. No verdict moved anywhere, and
each library's own test now asserts the sentence rather than the verdict, which
is the only way a wording stops regressing quietly. Styx lost a fourth wording
in the exchange: `Matches` had said *"not a hash algorithm this implementation
computes"*, which was true of SHA-1 and misleading about `ES256` — the same
mistake mirrored.

What produced all of it is a message neither implementation under test will
write. Neither can construct a SHA-1 thumbprint, which is the whole point, so
without a third encoder there is nothing to hand either of them — and the
sentence would have stayed wrong because nothing would ever have printed it.

`survey`, because the premise is a reading rather than a rule. RFC 9054 keeps
SHA-1 registered for the situations that still need it, naming historic HSMs
where only SHA-1 exists and filtering, where collision resistance is not
needed. An implementation that computed SHA-1 and took an `x5t` for a filter
would be within the specification verifying this message. Whether a thumbprint
beside a sound chain is a filter or a binding check is the question underneath,
and it is the specification's to settle rather than this suite's.

**Falsified** by giving COSE.TS a SHA-1 to compute — `DigestAlgorithm`,
`HASHES` and the `hash` field of the −14 entry, which is what an implementation
in one of those HSM situations would have: COSE.TS then **verifies** the
message and names `CN=Meter 1ISA0000000042`, Styx still refuses, and the run
reports one cross-implementation divergence, zero failures and exit **0**. That
is the survey class doing exactly what §26 says it does: the flip is visible as
a divergence and in one emphasised table cell, and in no number that fails
anything.

Suite with the fifth row: **616 (C#) / 580 (TypeScript) / 38 (the third reader)
normative, 413 agreements**, zero failures, zero divergences, 52 survey
observations each and 16 on the agreement rows.

## 25. The DER readers diverge four ways, and the corpus cannot see it (filed 2026-11-01, closed 2026-11-02)

Filed open, with nothing in `vectors/` deciding it: a normative row would say
which implementation is right, and that was the maintainer's call and probably
an upstream change rather than a line in this repository. It was put to him
with the measurements below and three ways to carry it here. He took the
correction, and the second of the three ways: the rows record what each side
does with an encoding that is not DER, and require it of neither.

### What was measured

COSE.TS reads certificate DER with a reader of its own (`src/asn1.ts`), and
reads it strictly — its test file says why in its own heading, *"DER is read
strictly, because that is where differentials live"*. Styx has no DER reader:
it parses certificates with `Org.BouncyCastle.X509.X509Certificate`
(BouncyCastle.Cryptography 2.7.0).

Four encodings were put to both, each tampered **outside** the
`TBSCertificate` so that the issuer's signature over the TBS bytes still
holds — which is what makes the question sharp: a lenient parser accepts the
certificate and walks the chain to the anchor, exactly as if nothing had
happened.

| the leaf certificate's encoding | Styx (Bouncy Castle) | COSE.TS |
|---|---|---|
| the outer SEQUENCE length as `83 00 01 4E` — three bytes where two suffice | verifies | refuses |
| the outer SEQUENCE with a BER indefinite length, `30 80` … `00 00` | verifies | refuses |
| one byte appended after the certificate, inside the `x5chain` byte string | verifies | refuses |
| the `signatureAlgorithm` SEQUENCE length as `81 0A` instead of `0A` | verifies | refuses |

Four to nothing, and the untampered control verifies on both sides, so the
construction is sound. COSE.TS refuses each at the reader: *"The certificate
at position 0 of the COSE_X509 could not be read"*.

### The second order, which matters more

`x5t` is the hash of a certificate's DER encoding [RFC 9360, Section 2]. So
when a parser accepts an encoding that is not DER, which bytes does it hash —
the ones that travelled, or its own re-encoding? Measured with the
BER-encoded leaf and two thumbprints over the same certificate:

| what `x5t` hashes | Styx | COSE.TS |
|---|---|---|
| the bytes that travelled | **refuses**: *"The certificate thumbprint does not belong to the given certificate!"* | refuses |
| the canonical DER, which did **not** travel | **verifies** | refuses |

Bouncy Castle re-encodes and hashes its own output. Under Styx the thumbprint
therefore covers a byte string the sender never sent — and the sense of it is
inverted: the honest sender, who hashes what it transmits, is the one refused.
COSE.TS answers the same way to both because it never gets that far, which is
why it never had to decide the question at all.

### Why this suite was never going to find it

The README states the principle and gets the instance wrong:

> The certificates come from a corpus minted by Bouncy Castle rather than by
> either party being tested — a parser checked against certificates its own
> package produced would agree with itself about any misreading.

The argument holds for COSE.TS, which reads certificates another package
wrote. It does not hold for Styx, because Bouncy Castle *is* Styx's parser:
for the C# side the corpus is precisely the self-check the sentence warns
about, and no amount of certificates in it can expose the leniency of the
library that minted them. It took a third encoder — `tools/X509Cases`, built
for §24 — to ask the question at all.

That is the general shape, and it is worth keeping: a corpus minted by one of
the parties under test is blind in exactly the direction that party is blind.

### Where it sits in the code

Both stages are two lines apart, and neither is an oversight that reading the
code would catch — each is the obvious way to use the library:

- `Styx/Illias/COSE/COSECertificateChain.cs` parses with
  `parser.ReadCertificate(certificate)` and keeps the certificate object. The
  bytes it was handed are not compared with anything afterwards, so an encoding
  Bouncy Castle tolerates is an encoding Styx accepts.
- `Styx/Illias/COSE/COSECertificateHash.cs` hashes
  `Certificate.GetEncoded()` — at the construction site and again where a
  thumbprint is matched. `GetEncoded()` is Bouncy Castle's own DER output, not
  the input, which is the second stage above.

### What was decided

RFC 5280 §4.1 requires DER, and RFC 9360 defines `x5t` over the DER encoding,
so the specifications pointed one way. The consequence did not follow from this
repository: it was either a strictness check in Styx ahead of Bouncy Castle, or
a decision that reading BER is acceptable and `x5t` is understood over the
parsed form. Three ways to carry it were offered:

1. nothing in `vectors/`, and this section is the record;
2. `survey` rows that record both verdicts side by side every run and fail
   nothing, which keeps the finding measured while the question is open;
3. `normative` rows once one behaviour is decided to be the right one — which
   turns the other side red until it changes.

The correction first, which is upstream and not a line here: after
`ReadCertificate`, `GetEncoded()` must equal the input byte for byte or the
certificate is refused. Bouncy Castle encodes DER canonically, so bytes that
survive that comparison *were* DER — and `GetEncoded()` is then exactly what
travelled, which makes the thumbprint cover the right string without a second
change.

Styx `f1057ea8` is that check, at every position of the chain rather than only
the first, refusing with *"The certificate at position {n} of the COSE_X509 is
not a single DER-encoded certificate!"*. Its own
`Only_a_certificate_in_DER_is_read` builds the four forgeries, each alone and
each behind a sound certificate, and fails on the first of them without the
check. The README of `Styx/Illias/COSE` now states the rule, which is also
what makes its sentence about *"the x5t thumbprint against the certificate that
actually travelled"* true.

And then option 2 rather than option 3 for this repository. The two readers now
agree, but what a reader *must* do with an encoding that is not DER is for the
specification to say and not for this suite to decide by turning a row red: RFC
5280 §4.1 is where the requirement lives, and this suite executes the
metrological specification's annex. So the rows record both verdicts every run
and require nothing of either side — which is a weaker claim than the
measurements above support, deliberately, and the next subsection but one says
exactly what it costs.

### The rows that record it

Eight `survey` rows in `vectors/cose-x509-messages.json`, beside §24's four
normative ones and built by the same generator, because neither implementation
will send a certificate its own library did not encode. One verifies, seven
refuse:

| row | what is in the message |
|---|---|
| `the-certificate-as-it-was-minted` | the chain as the corpus minted it — **verifies** |
| `a-leading-zero-in-the-outer-length` | the leaf's outer length as `83 00 01 4E` |
| `an-indefinite-outer-length` | the leaf wrapped in `30 80` … `00 00` |
| `one-byte-after-the-certificate` | one octet after the leaf, inside the `x5chain` entry |
| `a-long-form-length-inside-the-certificate` | the leaf's `signatureAlgorithm` length as `81 0A` |
| `one-byte-after-the-second-certificate` | the same octet, after the certification authority at position 1 |
| `not-der-with-a-thumbprint-over-what-travelled` | the leading-zero leaf, `x5t` over the bytes in the message |
| `not-der-with-a-thumbprint-over-the-re-encoding` | the leading-zero leaf, `x5t` over its canonical DER |

The control is not this generator's word for a sound message: its bytes are
byte for byte the message both implementations produce for
`cose-x509:chain-to-trusted-root`, and the generator stops rather than write
the file if it cannot reproduce them — the same anchoring §24's control has in
`thumbprint-names-the-certificate`. So the seven refusals are refusals of a
message that is sound but for one certificate's spelling.

Three of the rows earn their place against the other four. The one at position
1, because a check that runs only on the certificate a message is *about*
leaves the rest of the chain unread. The long-form length inside the
certificate, because a reader that validates the record it was handed is not
yet a reader that validates every record in it. And the last two are the second
order, which takes both of them: a lenient reader hashes either what it
received or what it re-encoded, so each of those two designs verifies exactly
one of the two rows — both green therefore means the certificate itself was
refused, which is established without matching any error text.

### Both falsifications, and they are mirror images

Each side's check was removed in turn and the suite re-run:

| the check that was removed | which rows come back *verified* |
|---|---|
| Styx: the `GetEncoded().SequenceEqual` comparison, leaving `8410073a`'s code | all five encodings **and** `…over-the-re-encoding` — six, and six divergences |
| COSE.TS: the leading-zero, minimal-form and `expectEnd` checks of `src/asn1.ts` | four encodings **and** `…over-what-travelled` — five, and five divergences |

The word that comes back is *verified*, not an error: the messages do open for
an implementation that does not check, which is what keeps `reject` from
meaning *nobody could read this anyway*. And the two sets are not the same set,
which is the part worth keeping:

- `an-indefinite-outer-length` stays green on a mutilated COSE.TS, because
  reading BER is not a check it could leave out — it would have to implement
  the end-of-contents marker. That this row opens is measured on a shipped
  implementation instead: Styx verified this message before `f1057ea8`.
- `…over-what-travelled` opens for the lenient COSE.TS, which hashes the record
  as it appeared, and stays refused by the lenient Styx with *"The certificate
  thumbprint does not belong to the given certificate!"* — the inversion the
  second table above measured, the honest sender refused.
- `…over-the-re-encoding` opens for the lenient Styx and stays refused by the
  lenient COSE.TS: *"The certificate thumbprint of this message does not name
  the certificate … that travelled with it!"*

So each implementation's leniency opens the row the other's cannot, and the
pair closes under both designs rather than under the one that happened to be
measured.

### What `survey` costs, measured rather than argued

The falsifications above were first run while these rows were `normative`, and
then they moved the counts: 599 → 593 with six failures, 563 → 558 with five.
As `survey` they move no count at all. The Styx falsification was re-run after
the change:

```
csharp       normative: 591 pass, 0 fail; survey: 54
typescript   normative: 555 pass, 0 fail; survey: 54
cross-implementation divergences: 6
npm test exit code: 0
```

Zero failures, and the run passes. What is lost is the gate; what remains is
the record, in three places at once — the family's own table prints
**verifies** against an `expected` of `reject`, the survey table prints *"must
refuse (…): verified"* beside the other side's refusal and its reason, and the
divergence pass lists the row, because that pass compares the two
implementations' records for every key whatever a row's class is.

So a regression on *one* side stays loud, in a report nobody has to be told to
read. What survey cannot catch is both sides going lenient together: the
verdicts would agree, the divergence count would stay at zero, and only the
`expected` beside the printed verdict would say anything is wrong. Turning that
into a gate again is one word per case in `tools/X509Cases/generate.mjs`, and
these rows were measured as a gate before they were made a record — which is
why that is a decision and not a risk.

Both sides green: 591 (C#) / 555 (TypeScript) normative, 360 agreements, 54
survey observations each and 18 on the agreement rows. §25 is no longer a
divergence.

### Required, not recorded (decided 2026-11-02)

The eight rows are `normative` since the same day §27 was measured. What
changed is not the measurement but what was left of the objection to a
normative row.

"What was decided" above is that objection: such a row would have said which
implementation was right, and that was the maintainer's call. It is no longer a
choice between two answers. Styx `f1057ea8` refuses all four encodings, COSE.TS
refused them from the start, and the third reader of §27 — Microsoft's ASN.1
reader, which has no stake in this repository — calls those four not DER and
the certificates of the other eleven messages DER. A normative row therefore
pins behaviour both sides already have, on a point a third party agrees with.
It declares no winner.

What it buys is what `survey` could not. Both falsifications, measured under
both classes:

| the falsification | as `survey` | as `normative` |
|---|---|---|
| Styx without its comparison of `GetEncoded()` against the bytes that arrived — Styx as it shipped before `f1057ea8` | 0 failures, 6 divergences, `npm test` exit **0** | 6 C# failures and 6 on the agreement rows, exit **1** |
| both implementations lenient at once, COSE.TS without its leading-zero check as well | 0 failures, 6 divergences, 8 disagreements with the third reader, exit **0** | 6 C# and 2 TypeScript failures, 6 agreement failures, exit **1** |

And the row the second one turns on, which is what this whole section was
about:

| | C# | TS | divergence | agreement row | normative failures |
|---|---|---|---|---|---|
| `a-leading-zero-in-the-outer-length` | verifies | verifies | none | **passes** | **two** |

Both implementations verified a message whose certificate is not DER, they
agreed with each other about it, their agreement row passed — and the run is
red, because the rows no longer ask what the two of them do and then write it
down. That the agreement row passes is the point rather than a flaw: agreement
was never what was wrong.

Two of §26's six label rows stay `survey`, for the reason this section first
gave for these eight: their premise is that a label has no reader, which is a
property of these two implementations rather than a rule anybody must follow.
The other two, the pair whose sender marked the label critical, were promoted
the same day on a premise that is a rule — RFC 9052, Section 3.1 — and §26 ends
with that decision. Sixteen of the eighteen cases in the file are normative
now, and two are not.

Green on both sides after the change: 601 (C#) / 565 (TypeScript) / 36 (the
third reader) normative, 370 agreements, zero failures, zero divergences, 50
survey observations each and 14 on the agreement rows.

## 26. Two header parameters both implementations can name and neither can read (added 2026-11-02)

RFC 9360 registers four X.509 header parameters for COSE, and both
implementations carry all four *names* while reading two of them: `x5chain`
(label 33) and `x5t` (34) are implemented, `x5bag` (32) and `x5u` (35) are not.
Not one vector in this suite mentioned either of the two until now, so nothing
held anybody to what they do with a certificate source they do not read — and
"ignore it" is not one answer but three, each of them a verdict rather than an
error message: whether the heap is walked like a path, whether a header nobody
reads may cost a sound message its verification, and whether the sender's
`crit` still binds when it names a label the verifier can name too.

### What is there, and what reads it

| | `x5bag`, label 32 | `x5u`, label 35 |
|---|---|---|
| COSE.TS | `src/labels.ts` gives it a name, `src/x5chain.ts` says why it has no reader | the same file, the same sentence |
| Styx | `COSEHeaderLabel.X5Bag`, a constant nothing else in the library reads | `COSEHeaderLabel.X5U`, likewise |

COSE.TS writes the decision down beside the two parameters it does read:
*"`x5bag` and `x5u` are not — a bag is an unordered heap with no path to
follow, and a URI is a fetch, which a signature library has no business
performing."* Styx states nothing and does the same thing.

### Six messages, three questions, twice

`tools/X509Cases` builds them as it builds §24's and §25's: from the noble
primitives alone, with the chain and the signing key out of
`cose-x509-corpus.json`. This family needs no control of its own — two of its
rows *are* §25's control with one header added, and the generator refuses to
write the file unless the chain in them is still the one the corpus minted.

| row | class | expected | what both implementations answer |
|---|---|---|---|
| `a-bag-instead-of-a-chain` | survey | reject | refuse: *"This COSE_Sign1 message carries no certificate chain!"* |
| `a-bag-that-contradicts-the-chain` | normative | accept | verify, naming `CN=Meter 1ISA0000000042` |
| `a-bag-the-sender-made-critical` | normative | reject | refuse: *"The "crit" header parameter demands that 'x5bag' be understood, which this implementation does not!"* |
| `a-uri-instead-of-a-chain` | survey | reject | refuse: *"This COSE_Sign1 message carries no certificate chain!"* |
| `a-uri-beside-the-chain` | normative | accept | verify, naming the same meter |
| `a-uri-the-sender-made-critical` | normative | reject | refuse, the same sentence with `'x5u'` in it |

Six for six, and the two implementations' texts are identical character for
character — which no row judges, and which is worth noting all the same.

The first row's bag holds the two certificates of the chain, in order, so a
reader that takes label 32 for label 33 walks them to the anchor and verifies.
The second and third hold a path that is *not* the signer's: `strangerMeter`
under the same authority, valid, leading to the same trusted root, certifying
a key that did not sign this message — the certificate
`cose-x509:chain-certifies-another-key` is built from. An implementation that
prefers the bag, or merges it into the chain and starts at the first entry it
finds, therefore does not stumble over nonsense: it validates a chain
beautifully, reaches the anchor, and then holds the wrong key. The two URI rows
point at `https://example.invalid/metrology/meter.der`, and `.invalid` resolves
for nobody [RFC 2606, Section 2], so no run of this suite reaches anything
whatever a verifier decides to do with the header.

### Falsification

| what was changed, and where | what flipped |
|---|---|
| `x5bag` read as a chain, before `x5chain` — COSE.TS `sign1.ts`, `certificateChain` | `a-bag-instead-of-a-chain` **verifies**, naming the right meter; `a-bag-that-contradicts-the-chain` **refuses**: *"The signature is not valid for this payload and this key!"* |
| the same change in the other implementation — Styx `COSESign1.cs`, `CertificateChain` | the same two rows with the columns swapped: C# verifies the first and refuses the second, *"The signature is invalid!"* |
| `x5bag` and `x5u` counted among the labels the call understands — COSE.TS `sign1.ts`, `verifyWithCertificateChain` | both `crit` rows **verify** |
| an `x5u` fetched and the failure taken for an error — COSE.TS `sign1.ts` | `a-uri-beside-the-chain` **refuses** |

Five of the six rows have a measured opening. `a-uri-instead-of-a-chain` has
none, and says so in its own description: a verifier that fetched would fail at
`.invalid` too, so the row cannot separate declining to fetch from trying and
not arriving. What it pins is the verdict, which is still worth pinning — an
implementation that began verifying that message would show up here — while the
abstention rests on the code and not on this row.

One claim in the table above was argued when this section was written and has
been measured since: that `a-bag-the-sender-made-critical` is refused for its
`crit` and for nothing else. No row in the suite is that exact message minus
the crit entry — the row beside it carries a whole stranger path in the bag
rather than the single certificate — so the message was rebuilt with the entry
left out and the signature recomputed over the shorter bucket, the rebuild
reproducing the suite's row byte for byte when the entry is put back. Both
implementations verify it and name `CN=Meter 1ISA0000000042`. The bag beside a
sound chain costs nothing, as the normative row of this family says; the
refusal belongs to the `crit`. The `x5u` pair needs no such probe:
`a-uri-beside-the-chain` is `a-uri-the-sender-made-critical` minus its crit,
header for header.

What a flip *costs* is the second measurement, and it is §25's lesson again.
The two accept rows fail the run: one normative failure plus the agreement row
beside it. The third falsification flipped the two `crit` rows, and what that
cost depended on their class — nothing at all until the decision at the end of
this section, where both halves of it are measured. The two rows that remain
`survey` fail nothing whatever happens to them: a flip there shows up only as a
cross-implementation divergence and as an emphasised cell in the report,
because `process.exit` reads the failure count and a divergence is not a
failure.

### Why two of the six are survey

The two accept rows are normative because their rule holds whoever implements
what: a header parameter that is neither critical nor understood is ignored
[RFC 9052, Section 3], and a bag beside a chain is extra evidence, never a
substitute for it. Those two stay right the day either implementation grows a
reader for label 32 or 35.

`a-bag-instead-of-a-chain` and `a-uri-instead-of-a-chain` rest on a premise
that is a property of these two implementations rather than a rule: that the
label has no reader. RFC 9360 Section 2 constrains a verifier that does read it
hardly at all — it describes building a path from a bag rather than requiring
it, in words that are not BCP 14 keywords; it gives no rule for which
certificate in a bag signed; and it does not require an `x5t` beside a bag,
mentioning one only as an example of the one thing it does require, that the
end-entity certificate be integrity protected by COSE. These messages satisfy
that: the bag is in the protected bucket, so neither row can be refused on that
ground. On `x5u` the same section says nothing whatever about what a verifier
does when the resource cannot be retrieved — fetching is permitted, TLS, DTLS
or OSCORE SHOULD be used for it, and a retrieved certificate that does not
chain to an existing trust anchor MUST NOT be trusted, and that is the whole of
it. So an implementation that read label 32 would be within the specification
walking the bag of the first row, and one that fetched would be within it
trying the second. The two rows record both verdicts and require nothing of
either side — §25's second option, applied without having to be asked for
again.

The other two refusals, the pair whose sender marked the label critical, stood
in that paragraph until the decision at the end of this section. What they rest
on is not a property of these two implementations but RFC 9052, Section 3.1.

### Where it leaves the suite

Eighteen cases in `vectors/cose-x509-messages.json` across three families, and
both sides green: 593 (C#) / 557 (TypeScript) normative, 362 agreements, zero
failures, zero divergences, 58 survey observations each and 22 on the agreement
rows — as this section was written, and before the decision at the end of §25
and the one below moved ten of those rows from `survey` to `normative`. The
counts at the end of the next subsection are the ones that hold. The two RFC
9360 header parameters that had no vector anywhere now have six, and `x5bag`
and `x5u` are no longer labels this suite is silent about.

### Required, not recorded: the two `crit` rows (decided 2026-11-02)

`a-bag-the-sender-made-critical` and `a-uri-the-sender-made-critical` are
`normative` since the day this section was written. Not one byte of either
message moved and no verdict changed; what changed is where their premise comes
from.

RFC 9052, Section 3.1 makes three structural demands of a `crit`, and these two
messages meet all three: the array holds at least one value, the `crit` is in
the protected bucket, and so is every label it lists. `cose-crit.json` has a
normative row for each of those three ways to get it wrong, so what is refused
here is not a malformed `crit`. What is left of Section 3.1 is its demand — a
label listed in `crit` must be *processed* — and neither implementation
processes label 32 or label 35. For a verifier that does not, refusing is what
the section prescribes and not what it prefers. That is the difference from the
two rows above: a rule rather than a property.

What puts these two on that side of the rule is still a published decision, and
the rows say so. COSE.TS writes it down beside the two parameters it does read;
Styx writes nothing and has no reader. An implementation that grew one would
understand the label and would be right to accept — which makes these rows ones
to read again on that day, out loud rather than in silence.

What the class buys, with both falsifications measured under both classes:

| the falsification | as `survey` | as `normative` |
|---|---|---|
| `x5bag` and `x5u` counted among the labels the call understands — COSE.TS `sign1.ts`, `verifyWithCertificateChain` | 0 failures, 2 divergences, `npm test` exit **0** | 2 TypeScript failures and 2 on the agreement rows, 2 divergences, exit **1** |
| the same change in both implementations at once — Styx `COSESign1.cs` as well | 0 failures, **0 divergences**, the summary identical to the green run, exit **0** | 2 C# and 2 TypeScript failures, the agreement rows **passing**, exit **1** |

The second line is why the decision was taken, and it is §25's lesson in this
family rather than in that one. Both implementations verified a message whose
`crit` demands a label neither of them processes; they agreed with each other
about it; the divergence pass had nothing to report, because there was no
divergence; and the summary `npm test` printed was the green one, number for
number — 601 and 565 normative, 370 agreements, zero failures, zero
divergences. The only trace anywhere was four emphasised cells in one table of
`results/report.md`. As `normative` the same run is red.

`cose-crit.json` would not have caught it either, though it looks like it
should. Its seven normative rows include `crit-unknown-label` with label 32767,
which nobody can ever understand, so a verifier that stopped honouring `crit`
fails there. What these two rows add is the accident that leaves that one
green: a *registered* label both implementations have a name for, counted as a
label they understand.

Green on both sides after the change: 603 (C#) / 567 (TypeScript) / 36 (the
third reader) normative, 372 agreements, zero failures, zero divergences, zero
messages verified against what the third reader refuses, 48 survey observations
each and 12 on the agreement rows. Sixteen of the eighteen cases in the file
are normative now, and the two that are not are the two RFC 9360 Section 2 does
not speak to.

## 27. The gap §25 left, and a third reader that is not allowed to close all of it (added 2026-11-02)

§25 ends with what its own rows cannot do. The eight DER rows are `survey`:
both verdicts recorded every run, nothing required of either implementation,
because what a reader must do with an encoding that is not DER was the
maintainer's call and not this suite's. That catches the two of them
disagreeing — the divergence pass does, whatever class a row carries — and it
does not catch them going lenient together. Two readers that agree with each
other agree whatever they do.

`tools/DerArbiter` asks the same question of a third one.

### Which third

Not a third encoder: `tools/X509Cases` already holds that place, it writes the
bytes that are not DER, and the README says why a corpus minted by a party
under test is blind in exactly the direction that party is blind. This is a
third **reader**, and it answers one question about the certificates of
`vectors/cose-x509-messages.json` — is each of them a single DER encoding of
something — with `System.Formats.Asn1`, Microsoft's ASN.1 reader. It is neither
of the two under test, it belongs to neither project, and the project that uses
it references nothing at all: no Styx, no Bouncy Castle, no COSE.TS.

`AsnEncodingRules.DER` refuses an indefinite length and a length not written in
the fewest octets that hold it. That a record must be one TLV with nothing
after it is asked in the tool's own loop — the same question COSE.TS's
`DerReader.expectEnd` asks, with different code answering it. Nothing else is
checked: not the signature, not the validity dates, not the chain, not whether
the structure is an X.509 certificate at all. A reader that judged those would
be a third implementation of this suite rather than a third opinion about an
encoding.

The CBOR walk that finds the certificates in a message is the tool's own and
deliberately minimal. It is held to it: every case states how many certificates
it carries, and the count is one of the two things judged.

### What it answered

| the certificate's encoding | COSE.TS | Styx | System.Formats.Asn1 |
|---|---|---|---|
| as `tools/CertificateCorpus` minted it | reads | reads | DER |
| the outer length as `83 00 01 4E` | refuses | refuses | *"The encoded length is not valid under the requested encoding rules, the value may be valid under the BER encoding."* |
| the outer length indefinite, `30 80` … `00 00` | refuses | refuses | the same sentence |
| one byte appended after the certificate | refuses | refuses | *"1 octets follow the structure"* |
| the `signatureAlgorithm` length as `81 0A` | refuses | refuses | the length sentence again |

Three for three on all four, and the eleven other messages in the file carry
certificates it calls DER, with the counts the cases claim — 2, 3, 4 and, for
`a-uri-instead-of-a-chain`, none. So §25's premise stops being this
repository's own claim: that those four encodings are not DER is now measured
every run by a reader with no stake in the answer, and measured
**normatively** — 36 checks, two per case — because a tampering that quietly
became valid DER would leave eight rows asking nothing at all.

### The gap, reproduced and then caught

Both implementations were made lenient at the same time: COSE.TS with the
leading-zero check removed from `src/asn1.ts`, Styx with the comparison of
`GetEncoded()` against the bytes that arrived removed from
`COSECertificateChain.cs` — which is Styx as it shipped before `f1057ea8`.

    csharp       normative: 593 pass, 0 fail; survey: 58
    typescript   normative: 557 pass, 0 fail; survey: 58
    csharp↔typescript normative: 362 pass, 0 fail; survey: 22
    arbiter      normative: 36 pass, 0 fail; survey: 0
    cross-implementation divergences: 6
    messages verified against what a third reader refuses: 8

Zero normative failures, as §25 said: a survey row that flips fails nothing.
Six of the seven rows diverged, because the two leniencies are not symmetric —
and one did not:

| | C# | TS | divergence | third reader |
|---|---|---|---|---|
| `a-leading-zero-in-the-outer-length` | verifies | verifies | **none** | refuses the certificate |

That row is the gap. Both implementations verified a message whose certificate
is not DER, they agreed with each other about it, and before this section the
whole suite would have said so in one bold table cell and in no number
anywhere. It now accounts for two of the eight counted disagreements, naming
both implementations — and, since the decision at the end of §25, for two
normative failures as well.

### What it does not do, and what became of the lever

It does not fail the run on an implementation's behalf. "The third reader
refuses this certificate, therefore an implementation must refuse this message"
would be a normative row about Styx and COSE.TS inferred from a reader neither
of them chose, and that is not how a row in this file gets its class. The
arbiter's rows require something of the vectors, and nothing of either
implementation. What `npm test` gains from them is a number that goes non-zero
— printed, reported, written to `results/verdicts.json` — where previously
there was nothing to read.

The lever this section named was the other one: making §25's eight rows
`normative`. It was pulled the same day, on the measurement above — the
decision, and what it is worth measured both ways, are at the end of §25. So
the two halves stand side by side now: those eight rows require both
implementations to refuse a certificate that is not DER, and the arbiter
requires of the vectors that such a certificate really is not DER. Neither
makes the other redundant. A tampering that had quietly become valid DER would
leave eight normative rows asking nothing at all, and the arbiter is what
notices; two implementations lenient at once would agree with each other, and
the class is what fails. The counted line keeps its job for whatever stays on
`survey` — §26's two remaining rows today, and any row a later decision does
not promote.

### Falsification

| what was changed | what happened |
|---|---|
| both implementations lenient at once | the run above: zero failures, six divergences, eight disagreements, and `a-leading-zero-in-the-outer-length` verified by both with no divergence at all |
| the arbiter's recursive walk removed, outer header only | `a-long-form-length-inside-the-certificate` reported as DER, and its normative row fails — the one row that needs the recursion, failing without it |
| the arbiter asking `AsnEncodingRules.BER` instead of DER | five of the seven rows reported as DER; the two trailing-byte rows still refused, because "one TLV and nothing after it" is the tool's own loop and not the library's rules |

The second and third are the tool measuring itself: the recursion is not
decoration, and the verdicts come from the DER rules rather than from a reader
that would refuse anything.

### Where it leaves the suite

593 (C#) / 557 (TypeScript) / 36 (the third reader) normative, 362 agreements,
zero failures, zero divergences, zero messages verified against what the third
reader refuses, 58 survey observations each and 22 on the agreement rows — as
this section was written, and before the decision at the end of §25 moved eight
of those rows from `survey` to `normative`. The counts there are the ones that
hold.

## 28. Counted against the registries, and the nineteen rows that count produced (added 2026-11-03)

§15 found its vectors by asking which row of a conversion table no vector
reached. This section asks the same question of COSE, and not the one that
sounds like it: not which features are implemented, but which *registry rows*
both implementations implement and no vector names. The answer was ten
algorithms, three header parameters, and one asymmetry nobody had written down.

### How it was counted

The IANA registries are the row list, and RFC 9052 Section 13 is why: an
algorithm identifier is whatever that registry says it is, which is what Styx's
own table says in the comment above it. Three files: COSE Algorithms, 86
assigned rows; COSE Header Parameters, 45; COSE Header Algorithm Parameters,
16. Both implementations' tables were extracted from source — the C# registry
literal and the TypeScript `algorithm(...)` calls — and diffed against every
algorithm name and every header label that appears anywhere in the thirteen
files of `vectors/` or in the specification's annex. By script, not by reading.

| | |
|---|---|
| algorithms both implement | 38 — 28 with a vector, **10 without** |
| algorithms only one implements | **6** when this was counted, all of them Styx's: PS256/384/512 [RFC 8230] and RS256/384/512 [RFC 8812] — **none since the same day**, and the last subsections here are why |
| algorithms neither implements | 42, of which the registry recommends 28 |
| header parameters both name | 13 of 45 — 10 with a vector, **3 without** |
| header algorithm parameters both name | 8 of 16 — 6 with a vector, 2 without |

The 42 fall into the families COSE.TS's scope block excludes with a reason:
AES-CCM (8 rows), AES-MAC (4), direct+HKDF (4), ECDH-SS (5), and then
RSAES-OAEP, HSS-LMS, the SHAKEs and SHA-512/256. So that block is complete for
RFC 9053 — with the one exception the asymmetry below is about.

### The ten, which all have a vector now

| row | registry | the vector |
|---|---|---|
| ESP384 (−51), ESP512 (−52) | Recommended | `cose-sign:sign1-esp384-fully-specified`, `…-esp512-…` |
| ESB384 (−267), ESB512 (−268) | — | `cose-sign:sign1-esb384-brainpool`, `…-esb512-…` |
| A192KW (−4) | Recommended | `cose-encrypt:encrypt-key-wrap-a192kw` |
| ECDH-ES + A192KW (−30) | Recommended | `cose-ecdh:ecdh-key-wrap-a192kw` |
| SHA-384 (−43), SHA-512 (−44) | Recommended | `cose-x509:thumbprint-with-sha-384`, `…-512` |
| EdDSA (−8) | Deprecated | `cose-sign:sign1-eddsa-ed25519`, `…-ed448` |
| SHA-1 (−14) | Filter Only | `cose-x509-messages:thumbprint-labelled-with-sha-1` |

Each of the four signature rows reuses the key of the deprecated algorithm
beside it where there is one, so ESP384 and ESP512 sign with the same key and
the same hash as ES384 and ES512 and still produce a different signature — the
alg label is in the protected bucket the Sig_structure covers. The two
brainpool rows carry fixed scalars of this suite's own, because no published
example covers those curves; both were checked against the curve before being
written down. The two thumbprint rows are the first in this suite to name a
hash for `x5t` other than the default, which is the whole point: §24 pins that
the label must *be* a hash algorithm, with three that are not, and nothing
until now held either side to *reading* it rather than assuming SHA-256.

The deprecated **EdDSA (−8)** is the tenth, and it is a pair rather than a row.
ES256, ES384 and ES512 are three deprecated identifiers for three curves, each
fixing its own hash; −8 is one identifier for *both* EdDSA curves, so a
verifier has nowhere to read the curve from but the key — which is what RFC
9864 deprecates it for, and what COSE.TS says in the comment above the entry.
One case carries it over the Ed25519 key of `sign1-ed25519` and one over the
Ed448 key of `sign1-ed448`, each with that case's key identifier and payload,
so each is its fully-specified neighbour with one label changed and nothing
else. The messages come out 98 and 148 bytes against 98 and 149, because `-8`
is a one-byte head where `-53` needs two. Deprecating an identifier does not
retire the messages that carry it.

**SHA-1 (−14)** was the one row this section first left out, with the argument
that a vector would ask nothing of anybody: both name it and neither computes
it, COSE.TS's entry carrying no hash function and Styx's a null
`HashAlgorithmName`. The argument was wrong, and the row that proves it is in
§24. What a message with a SHA-1 thumbprint asks is not whether the label names
a hash algorithm — SHA-1 does, RFC 9054 Section 3.1 registers it for this very
field — but what a verifier does with a hash algorithm it does not have. Both
refuse, both give the same false reason for refusing, and an implementation in
one of the situations RFC 9054 keeps SHA-1 registered for would be within the
specification verifying it. The whole of it is at the end of §24.

### What the new rows needed from the runners

The thumbprint cases needed a `thumbprintAlgorithm` field, because the hash was
the runner's default on both sides and no vector could name another; both
libraries' APIs already took one. The Partial IV cases needed the encrypt0 path
to compose both header buckets itself, which both libraries offer
(`encryptWithHeaders`, and the `COSEHeaders` overload of `Encrypt`), and one new
expectation in the driver: a case may now say that the message it describes has
to be *refused* by whoever opens it rather than opened, with the two cross-open
rows inverted and the byte agreements unchanged. Everything else in this
section is vector data.

### Label 6, which both can name and neither reads

RFC 9052 Section 3.1 defines a Partial IV as the part of the IV that changes
per message, the rest coming from a Context IV that travels with the key — and
says the two MUST NOT "both be present in the same security layer". Neither
implementation reads label 6, and neither can be handed a Base IV either: that
is a COSE *key* parameter, and neither reads it.

Two cases, differing by one header entry:

| row | class | expected | what both do |
|---|---|---|---|
| `encrypt0-partial-iv-beside-the-iv` | normative, `survey` until 2026-11-03 | reject | refuse, for the combination — and **open it**, by its IV, until both libraries grew the check |
| `encrypt0-partial-iv-the-sender-made-critical` | normative | reject | refuse, for a `crit` that names a label the protected bucket does not hold |

Both implementations build both messages byte for byte identically, and the
first one is `D08343A10101A2054C02D1F7E6F26C43D4868D87CE064261A75824…` — an
unprotected bucket holding label 5 and label 6 at once.

The second row is green, and was read when it was written as resting on the
sentence §26's two `crit` rows rest on: a label listed in `crit` must be
processed, and neither of these processes label 6. It does not rest on that
sentence at all — it rests on §3.1's other `crit` rule, which the second
subsection below is about. The first row recorded a message RFC 9052 forbids
and both implementations accepted. It was `survey` for a textual reason rather
than a lenient one: that sentence binds whoever *builds* the message, and no
sentence was found in RFC 9052 binding a recipient to police it. Where the
document wanted both sides bound it said both halves — Section 9, on a label
used twice as a key in one map, forbids generating such a message and forbids
parsing and processing one. Section 3.1 forbids only the first. So requiring
the refusal was a decision about published behaviour rather than a reading of
the specification, which is §25's question again and was the maintainer's to
answer. It was answered the same day, and the subsection below is what the
answer cost.

Two things this family does not have. RFC 9052 Appendix C.4.2 publishes a
Partial IV example and this suite cannot use it: it encrypts with
AES-CCM-16-64-128, one of the 42 algorithms neither implementation offers. Its
Partial IV value is the one both cases carry. And the third row label 6 would
want — a Partial IV and no IV at all — is absent because an encryptor needs a
real IV to encrypt with, so that message has to come from a third encoder the
way §24 to §26's do; what its refusal would measure is the absence of a Context
IV rather than a rule.

### Required, not recorded: the Partial IV row (decided 2026-11-03)

The subsection above argued itself into `survey` and left the promotion to the
maintainer, who took it. It is the first row in this suite whose promotion
neither library could already satisfy, so what it cost is worth the space.

**The flip alone turns the suite red.** 616 pass and **one fail** on the C#
side, 580 and one on the TypeScript side, exit 1, and the two failing rows name
a verdict rather than a byte: *typescript opening the message produced by
csharp: verified*, and the mirror of it. Zero divergences throughout, because
both sides were lenient in the same way — §25's lesson in one line, and the
reason a two-way comparison cannot be the judge of this.

**Then both libraries grew the check**: COSE.TS `1c93510`, Styx `9ef6e2dd`. One
function each, `verifyInitializationVectors` and
`COSEHeaders.VerifyInitializationVectors`, consulted by the decryption half
that `COSE_Encrypt0` and `COSE_Encrypt` share, and consulted *after* the `crit`
check, which the next subsection is about. Both answer with the same sentence,
word for word:

> The "IV" and "Partial IV" header parameters must not both be present within
> the same security layer!

Encrypting was not touched, and the half of §3.1 that binds a sender holds by
construction rather than by a check: neither library's ordinary encrypt call
can be asked for a Partial IV at all. Only the overload that takes both header
buckets from its caller can build such a message — which is how this suite
builds it, and therefore the half no row here can require. A vector family that
needs both libraries to produce its bytes cannot also demand that they refuse
to. That is not a gap in this increment but a limit of the shape, and it is
written down rather than left to be found.

### The sentence the critical row is refused for, which is not the one claimed

The critical row was described — by me, hours earlier the same day — as a
message that *meets* both of §3.1's `crit` rules and is therefore refused for
the demand itself. It does not, and both implementations had been saying so all
along:

> The "crit" header parameter lists 'Partial IV', which is not present within
> the protected header bucket!

§3.1 states a second rule about `crit`, and that is the one firing: *if the
"crit" value list includes a label for which the header parameter is not in the
protected-header-parameters bucket, this is a fatal error in processing the
message*. The Partial IV of that message sits in the unprotected bucket beside
the IV, so the `crit` naming it is malformed and the demand is never reached.
The row stays green, stays normative and still holds both sides to a refusal —
of a different sentence than its description claimed. Both descriptions say
what is measured now.

What caught it was a library test written to assert the sentence instead of the
verdict, which is §24's lesson one layer further in: there the suite caught a
false sentence in two libraries, here a library test caught a false claim in
the suite. Both libraries now carry a test that builds the message with the
Partial IV in each bucket and asserts both sentences — unprotected, the fatal
error; protected, the demand neither of them can meet.

That is also where the `crit` rule now lives, because this pair of rows has
stopped isolating it. Either check alone refuses the critical message, so a
library that dropped its `crit` handling altogether would keep that row green.
§26's two `crit` rows carry the rule instead, with x5bag and x5u, and they are
well formed: the label in the protected bucket, and a `crit` beside it naming
that label. Nothing is left unmeasured — it is measured somewhere else, which
is worth knowing before reading this row as evidence about `crit`.

One more sentence of §3.1 belongs here, because it binds the sender rather than
the recipient: integer labels in the range 0 to 7 SHOULD be omitted from
`crit`, and label 6 is one of them. The critical row is therefore a message the
specification advises against building and prescribes a fatal error for, which
is exactly the kind of message a conformance suite has to build itself.

### Falsification of the promotion

| what was changed | what happened |
|---|---|
| the new check disabled in COSE.TS alone | `encrypt0-partial-iv-beside-the-iv`: **one failure**, the row where TypeScript opens what C# produced, while C# refusing TypeScript's message keeps its own row green. **Zero divergences** — the divergence pass compares status and bytes, never verdicts, so a one-sided refusal is a failure here and never a divergence |
| the two checks swapped in COSE.TS alone, the IV check before the `crit` check | **nothing**: 617 / 581 / 416 / 38, zero failures, zero divergences — while the two implementations give different reasons for the same message, C# the fatal error and TypeScript the combination |

The second is a falsification that fails to fail, like the A192KW `keySize`
below, and it is here for the same reason: the order of the two reasons is held
by each library's own tests and by nothing at all in `vectors/`.

### The asymmetry the count turned up

§13 measured 32 algorithms against 32, an identical list, on 2026-08-19. Today
it is 44 against 38, and the six are RSA: PS256, PS384, PS512 [RFC 8230] and
RS256, RS384, RS512 [RFC 8812], Styx-only. They are not name-only entries —
`IsSupportedForSigning` is true for all six, and `COSERSATests.cs` has seven
tests of its own that sign real `COSE_Sign1` messages with them, verify them,
and detect tampering. COSE.TS knows none of the six, its scope block gives a
reason for every other omission and does not mention RSA, and neither README
does either. Three of the six the registry recommends.

No vector named them and none could: a cross-implementation vector compares
what both sides can do, so this was not a gap a row closes. It was a decision —
COSE.TS grows RSA, or the six are written down as a deliberate asymmetry, or a
`survey` row records that one side signs what the other cannot read — and it
was taken the same day, which the next subsection is about. §13's first row is
dated in place as well, because the interesting part is not the drift but that
a hand audit is a photograph: it was taken before both libraries grew, and
nothing in `npm test` was ever going to notice it ageing.

### Decided: COSE.TS grew RSA (2026-11-03)

The maintainer took the first of those three options, so the count's one
asymmetry is closed rather than written down. COSE.TS `c7a51f2` has
`src/rsa.ts`, key type RSA (3) and the six algorithms; `cose-sign` has six new
rows, `sign1-ps256-rsa` to `sign1-rs512-rsa`, one per registry row and all
`normative`. The count that found the gap now reads **44 against 44,
identical**, and its "only one implements" section is empty.

What had to be written rather than installed is the arithmetic. The `@noble`
family has no RSA at all, and WebCrypto — the other candidate — is
asynchronous end to end, which would put an `await` into every signature of
that API and is why COSE.TS touches neither it nor `node:crypto` anywhere in
`src/`. So EMSA-PSS, EMSA-PKCS1-v1_5 and MGF1 are that package's own, from
RFC 8017, over noble's modular exponentiation. Three decisions inside are
worth recording, because each is a place where a different choice would have
been defensible:

- **Signing goes through the CRT and then verifies its own output.** A CRT
  exponentiation that goes wrong in one of its two halves hands whoever
  receives the signature the factorization of the modulus (Boneh, DeMillo and
  Lipton, 1997). One exponentiation with 65537 turns that into an error.
- **The PSS salt defaults to zeroes**, and a caller may pass one instead. That
  keeps the package free of randomness, as ECDSA (RFC 6979) and ML-DSA (the
  deterministic variant of FIPS 204) already had it, and it is what makes
  these rows comparable byte for byte at all — the first falsification below
  is about exactly that. A fixed PSS salt costs nothing: the salt is recovered
  from the signature and never compared with anything, so no verifier can tell
  [RFC 8017, Section 9.1.2], which is the opposite of a repeated ECDSA nonce.
  Styx had already made the same choice for its deterministic mode, which is
  why no second decision was needed on that side.
- **Neither the exponentiation nor the padding is constant time**, and a
  pure-JavaScript RSA cannot be: `BigInt` offers no constant-time multiply,
  and any square-and-multiply follows the exponent. For a verifier that is no
  concern, since the public exponent is public; for a signer it is the concern
  every JavaScript RSA has. It is said in the module, in the README and in the
  changelog rather than left to be found.

Three implementations check it rather than two. COSE.TS's own tests hand the
same eight key parameters to `node:crypto`, which is OpenSSL — the only use of
`node:crypto` in that repository, and `tests/bundle.test.ts` is what keeps it
out of `src/` — and require that each verifies the other's signatures and that
RSASSA-PKCS1-v1_5, which has no randomness at all, comes out of both as the
same bytes. Styx checks its own RSA that way against the RSA of .NET. Only
then does this suite compare the two, and it finds **all four checks of all
six rows agreeing**, the RFC 9679 thumbprint over key type, modulus and public
exponent included — a code path neither library had ever had anything to
compare against.

### Falsification of the six rows

| what was changed | what happened |
|---|---|
| COSE.TS's default PSS salt filled with `0x01` instead of zeroes | the three PS rows: `signature` and `message` disagree — 6 agreement failures, 6 divergences — while **every cross-verification still passes**, because PSS verification recovers whatever salt it finds. That is the deterministic arrangement earning its place: without it these rows could only ask whether each side accepts the other's bytes |
| one byte of COSE.TS's SHA-256 `DigestInfo` prefix: the last byte of the hash OID, `01` → `02` | `sign1-rs256-rsa` alone fails four ways — the signature and the message disagree, *and* both cross-verifications fail, because the other side is handed a block whose ASN.1 says SHA-384 over a 32-byte digest. RS384 and RS512 stay green, which is what localizes it to one constant |

Both are one-sided changes and both have the shape a real bug has here: the
first is a mode nobody notices until two implementations meet, and the second
a typo in a 19-byte constant that no single implementation can catch, because
it signs and verifies with the same constant.

### What the six rows do not reach, and one asymmetry they uncovered

The multi-prime form of RFC 8230 — labels −9 to −12, `other`, `r_i`, `d_i`,
`t_i` — is read by neither implementation: both keep those parameters as
unknown ones for the round trip and sign with the two primes they do read.
COSE.TS at least cannot do that quietly, because it checks that p·q is the
modulus before it signs. No vector asks, because what this section counts is
registry rows of the algorithm registry and not shapes of keys. (When it was
measured, the second half of the first sentence turned out wrong for both:
neither signed with two primes. See *Decided: the key with three primes*
below.)

The other one is new, and it is an asymmetry rather than a boundary:
**Styx validates an RSA-signed certificate chain and COSE.TS refuses to parse
one.** Styx verifies a certificate with Bouncy Castle's
`Certificate.Verify(publicKey)`, which handles `sha256WithRSAEncryption` like
anything else; COSE.TS reads certificates itself and its OID table has no RSA,
so it answers *"was signed with '1.2.840.113549.1.1.11', which is not a
signature algorithm this implementation knows"*. Nothing changed there in this
increment — the gap predates it, and it is in the other registry, X.509's OIDs
rather than COSE's algorithms, which is why the count above never looked at it.
It was also not measurable when this was written: `tools/CertificateCorpus`
minted EC, EdDSA and ML-DSA certificates and no RSA one, so no row could ask.
Closing it is three things — the `rsaEncryption` and `sha*WithRSAEncryption`
OIDs with the `RSAPublicKey` SPKI beside them, an RSA certificate in the
corpus, and the rows — plus the PSS certificate form, which carries parameters
in the `AlgorithmIdentifier` and is its own small specification. The
subsection below is what happened next.

### Decided: the RSA certificates (2026-11-03)

The asymmetry above is closed the same day it was written down, and it took the
three things that subsection listed plus the one it called its own small
specification. COSE.TS `687c3c4`; `cose-x509` has four new rows and the corpus
eight new certificates. Styx needed nothing at all: Bouncy Castle reads both
forms, which is how the asymmetry arose in the first place.

**Two of the three were small.** The `rsaEncryption` key type, whose bit string
holds a structure of two integers rather than a value — and which says nothing
about what the key is *for*, an RSA key being as usable for PSS as for PKCS #1
v1.5, so no algorithm is attached to it and the certificate's own signature
algorithm is what a verification goes by. And the three
`sha*WithRSAEncryption` identifiers of RFC 4055 Section 5, which are three
lines in the table every other algorithm here is read from.

**The third is RSASSA-PSS, and it is the one identifier in a certificate that
does not say what it is.** "PSS" is the identifier; the digest, the mask
generation function, the length of the salt and the trailer field are written
in the parameters beside it [RFC 4055, Section 3.1], which "MUST be present
when used in the algorithm identifier associated with a signature value" and
whose defaults are SHA-1 throughout. So a parameter set has to be read, and
what is accepted is the shape RFC 8230 Section 2 fixes for the COSE PS*
algorithms: MGF1 over the same hash, a salt as long as that hash, the trailer
field that must be 1. That is arithmetic rather than strictness — COSE.TS takes
the salt length from the hash rather than from the signature, so a certificate
stating any other width is one it could not verify however leniently it read
the parameters.

**And it costs a check nothing else in a certificate needs.** A certificate
states its signature algorithm twice, once within the body it signed and once
beside it, and the existing agreement check compared the object identifiers.
For every other algorithm that is the whole statement, the parameters being
absent or a NULL. For RSASSA-PSS the statement *is* the parameters, so two
parameter sets that differ are two algorithms wearing one identifier — and they
are compared as the bytes they are now. Styx had that check already, through
Bouncy Castle, which the last subsection below is the measurement of.

**One ordering is the way it is because of a test.** A minted parameter set
leaves the trailer field to its default, so the only way to put a wrong one
there without re-encoding the certificate's lengths is to relabel the salt —
which leaves no salt, and a default salt length of 20 would then be refused
first, for something the certificate does not say. The trailer field is
therefore checked before the salt length, which is also the order the two
belong in: RFC 4055 requires that value outright, where the width of the salt
is fixed only by the COSE algorithm the identifier has to map onto.

**The corpus: two hierarchies of four, one per scheme.** The hash varies by
level rather than by hierarchy — each authority signed with the middle one and
the two meters beneath it with the outer two — so that walking one chain
verifies two of the three forms and the two hierarchies cover all six. The
roots sign themselves, which nothing verifies, so no form is left to a
self-signature. 3072 bits at each root and 2048 beneath it, because the width
of an RSA signature is the width of the signer's modulus: whoever checks an
authority's certificate takes 384 octets from the root's key and 256 from the
keys below it, and an implementation assuming one width would pass every other
certificate in this corpus. The keys are generated from a seeded stream rather
than written into the generator, which 1155 octets of parameters apiece makes
the obvious choice — what made this corpus reproducible was never that the keys
are printed in the file but that the primes are searched for deterministically.
Not one byte of the eighteen certificates already there changed, which was
checked rather than assumed, and a second run is byte for byte the first.

**The two rows that cross on purpose.** `rsa-chain-signed-with-sha-512` is a
PKCS #1 v1.5 certificate over a message signed with PSS, and
`rsassa-pss-chain-signed-with-sha-512` is the mirror. A certificate certifies a
key and says nothing about what that key will be asked to do, and an
implementation that read the message's algorithm off the certificate it arrived
with — or the certificate's off the message — would still pass the two plain
rows, where the two happen to agree.

### Falsification of the four rows

| what was changed | what happened |
|---|---|
| `sha512WithRSAEncryption` dropped from COSE.TS's identifier table | `rsa-chain-signed-with-sha-512` alone fails, in four places and one of them easy to miss: TypeScript cannot *mint* that row either, the signer's own certificate being the one it cannot read, so both byte agreements are "not recorded", its own verdict is missing, and the message C# produced is refused with the sentence naming the identifier. **Zero divergences** — a side that produced nothing has nothing to disagree with. The other three rows stay green |
| the RSASSA-PSS SHA-384 parameter set resolved to PS512 in COSE.TS | **the bytes still agree.** A parameter set is read to verify a certificate and not to write one, so both messages are identical to the octet; what fails is every verdict TypeScript gives on a PSS chain — 4 failures, 2 divergences, both PSS rows refused with *"The certificate 'CN=RSA-PSS Meter Manufacturer CA' was not signed by 'CN=RSA-PSS Root CA'!"*, the authority being the certificate that parameter set signed. The two PKCS #1 rows stay green, and C# still accepts what TypeScript produced |

The second is the shape of a bug no byte comparison can find on its own: two
implementations that agree about every octet and disagree about what one of
them means. It is caught here because the chain rows ask for a verdict as well
as for bytes, which §25 is the reason for.

### What the four rows do not reach

`id-RSASSA-PSS` as a *key* type [RFC 4055, Section 3.1] restricts a key to one
scheme where `rsaEncryption` leaves it open. COSE.TS refused it as a key type
it did not know. Nothing in the corpus mints one, and nothing would: the
subject public key info comes from the key rather than from the signature, so
Bouncy Castle writes `rsaEncryption` in both hierarchies. Once `tools/X509Cases`
could mint and sign, that stopped being a reason; the subsection after the next
is what it measured.

A parameter where RFC 4055 allows a NULL or nothing at all is what COSE.TS
refuses, and what nothing here could ask about — and the reason turned out to
be worth more than the row would have been. This subsection first recorded it as
a leniency Bouncy Castle would show, on the strength of its reading that field
for nothing. A probe against Bouncy Castle 2.7.0 says that was never measured
and could not have been. The `tbsCertificate` carries one of the two copies of
the signature algorithm, so patching that one breaks the signature over it, and
Bouncy Castle then answers *"Public key presented not for certificate
signature"* — which is the very sentence it gives for a plainly wrong key, and
is how the probe found out it was measuring nothing. Patching the copy beside
the body is the one change that leaves the signed bytes alone, and it is refused
as *"signature algorithm in TBS cert not same as outer cert"*: Bouncy Castle
compares the parameters of the two copies and not only their object
identifiers. So the agreement check COSE.TS gained for RSASSA-PSS in this
increment is one Styx has had all along, through the library it reads
certificates with.

What a patch cannot produce is a certificate whose odd parameter is consistent
throughout: that one has to be minted, by an encoder that writes a
`tbsCertificate` of its own and signs it, and `tools/X509Cases` is the only
candidate here. It was built the same day; the next subsection is what it
measured.

The multi-prime form of RFC 8230 is where the subsection above left it: read by
neither implementation, and asked by nothing. It is the last subsection of this
section that changes that.

### Decided: the parameter that had to be minted (2026-11-03)

The subsection above named what the row would cost and then did not pay it. It
is paid here. `tools/X509Cases` has a fourth family and RSA of its own — the
modular exponentiation, the EMSA-PKCS1-v1_5 encoding and the DigestInfo of RFC
8017, because the noble packages carry no RSA — and `tools/CertificateCorpus`
publishes one issuing key, in an `issuerKeys` object beside `privateKeys`
rather than in it: a key that signs messages carries the COSE algorithm it
signs with, and an authority's key signs certificates and has none, so
recording it beside the others with one invented would be a claim this corpus
cannot back.

**What was measured**, with `sha256WithRSAEncryption` as `rsaMeter` is signed
and the parameters beside it the only thing that varies:

| the parameters | Styx | COSE.TS | the third reader |
|---|---|---|---|
| a NULL, which is what the corpus writes | verified | verified | DER |
| a zero-length OCTET STRING | **verified** | **refused** | **DER** |
| absent | verified | verified | DER |

So the leniency this document asserted in the morning and withdrew in the
afternoon is there after all — and the withdrawal was still right, because what
was asserted was that Bouncy Castle "does not look at the field at all", and
that is false. It looks: it compares the two copies, which is what the previous
probe established. What it does not do is ask what the agreed value *is*. Those
two sentences are the whole of it, and only the second one is a leniency.
Bouncy Castle reads this certificate, reports its parameters as `04 00`,
verifies the signature, and Styx walks the chain to `rsaRoot` and verifies the
message; COSE.TS refuses at the parse, with the identifier in the sentence.
That is the one cross-implementation divergence in the suite, and
`a-parameter-rfc-4055-does-not-allow` is `survey` for the reason §25 gives:
RFC 4055 §5 says the parameters MUST be NULL, so nothing here is a valid
certificate and refusing it is right, and nothing asks a reader to police a
field it does not interpret, which is what a certificate library does for every
algorithm whose parameters it has no use for. Which of the two a verifier
should be is for the specification to settle rather than for this suite.
(Styx refuses it as well since `82af43fd`: see *Decided: Styx refuses what RFC
4055 does not allow* below.)

**The third reader is what makes this family different from §25's.** A
zero-length OCTET STRING is a correct DER encoding of a correct ASN.1 value;
what forbids it is one layer up. `tools/DerArbiter` says so of all three rows,
so this is the first family here where a refusal is the refusal of a
certificate that is written down properly — §25's four were refusals of writing.

**Why it had to be minted, demonstrated rather than argued.** A certificate
states its signature algorithm twice and the copy within the `tbsCertificate`
is under the signature, so a patcher can reach an inconsistent certificate and
nothing else. Minting the family that way — the parameter beside the body only,
as the probe did — leaves the suite with *nothing to say*: the divergence
disappears, nothing fails, and the two implementations refuse that row for two
different reasons, neither of which is the parameter. Styx answers *"The
certificate 'CN=Meter 1ISA0000000047' was not signed by 'CN=RSA Meter
Manufacturer CA': signature algorithm in TBS cert not same as outer cert"*,
which is about the inconsistency; COSE.TS reaches its parameter check first and
answers about the parameter. One sentence of the two is an accident of the
order the checks run in. And the absent row keeps verifying on both sides even
then, because RFC 4055 §2 makes a NULL and an absent field equivalent and both
libraries treat them so — so the half-patched certificate does not even
separate the two encodings.

**The two pins the family rests on**, both of which stop the generator rather
than quietly anchoring the rows in bytes nobody else produces. Its control is
byte for byte the message both implementations produce for
`cose-x509:chain-signed-with-rsa`, so the 256 octets this generator computes
are the 256 octets two independent implementations compute; and minting the
certificate with the parameter the corpus has gives the corpus certificate
back, octet for octet, so the surgery and the signing are not what the two rows
beside it measure. The issuing key is checked against the authority's
certificate as well: its modulus has to be the 256 octets `rsaManufacturerCA`
carries in its subject public key info.

**`no-parameters-at-all` is `normative`, and on a sentence rather than a
reading.** RFC 4055 §5 puts the rule on the reader in its own words —
"Implementations MUST accept the parameters being absent as well as present" —
and §2 calls the absent form "the correct encoding", the NULL being an artefact
of a defect report. Both accept. It is also the row that gives the one beside
it its meaning: without it a refusal there could be a reader that simply
demands the NULL, where the pair shows where each side draws its line.

### Falsification of the three rows

| what was changed | what happened |
|---|---|
| COSE.TS's parameter check made a no-op | the divergence goes from 1 to 0 and **nothing fails**, because the row that moves is `survey`: both sides verify and the suite records that they do. A survey row cannot fail a run, and its whole output is the pair of verdicts and the divergence line — which is what §25 says of recording and what this falsification shows the shape of |
| COSE.TS made to require the NULL, refusing an absent field | `no-parameters-at-all` fails, in both of the places a verdict is asked for: its own `validate` and the agreement check of the cross pass — 2 failures, 2 divergences. So the normative row of the family is load-bearing on exactly the sentence it cites, and the survey row beside it is untouched |
| the generator minting the parameter into the copy beside the body only | the family measures nothing, as described above: 0 divergences, 0 failures, and §28's reason for not building this row in the first place, reproduced |

### Decided: the key type that says what a key is for (2026-11-03)

The subsection above mints a certificate and signs it, and once that existed
the last recorded gap closed with it. COSE.TS `e3cb696` reads `id-RSASSA-PSS`
as a key type; `cose-x509-messages` has six rows for it. The pin moved to
v0.13.0 first, as released, so that the suite ran green against the published
version before anything new went on top of it.

**What the identifier says.** An `rsaEncryption` key is two integers and no
opinion — the same key serves RSASSA-PSS and PKCS #1 v1.5 — while the same two
integers under `id-RSASSA-PSS` are a key its owner has restricted: that
identifier is written into the subject public key info "when the RSA private
key owner wishes to limit the use of the public key exclusively to RSASSA-PSS",
and its parameters "may be either absent or present when used as subject public
key information" [RFC 4055, Section 3.1], which is the one place in a
certificate where this identifier may stand without them. Where they are
present they name the hash, and a scheme with a hash is exactly one COSE
algorithm — so COSE.TS attaches that algorithm to the key, and `resolveAlgorithm`
holds the message to it exactly as it holds an Ed25519 or an ML-DSA message to
its own. The restriction cost the reading and no new mechanism.

**What was measured**, with `rsaMeter`'s own key and `rsaMeter`'s own
certificate reminted around it:

| what the certificate says the key is for | the message | Styx | COSE.TS |
|---|---|---|---|
| RSASSA-PSS with SHA-256 | PS256 | verified | verified |
| RSASSA-PSS with SHA-256 | **RS256** | **verified** | **refused** |
| RSASSA-PSS with SHA-384 | **PS256** | **verified** | **refused** |
| RSASSA-PSS with SHA-256, salt 20 | PS256 | verified | verified |
| RSASSA-PSS, no hash named | PS256 | verified | verified |
| RSASSA-PSS, no hash named | RS256 | verified | verified |

Two more divergences, both of them Styx accepting what COSE.TS refuses, and
both of them one sentence: *"This COSE_Sign1 message was signed with the
algorithm 'RS256', but the algorithm 'PS256' was expected!"* and the same with
PS256 for PS384. Bouncy Castle reads all three forms — measured in a probe
before any row existed — and hands Styx an `RsaKeyParameters` that is
indistinguishable from an `rsaEncryption` key's, keeping the identifier on the
certificate structure and not on the key. So the restriction never reaches the
verification, and Styx verifies whatever the header asks for.

**The two rows are `survey`, and not for the same reason.** Both are the
situation §25 describes — the two disagree, and a normative row would declare
one of them wrong, which is the maintainer's call — but the sentences behind
them differ in force. The scheme restriction is stated as what the key owner
*wishes*, and nothing in RFC 4055 or RFC 9360 turns that wish into a verifier's
duty. The hash is a MUST: scenario 3 of Section 3.3 says "all parameters in
the signature structure algorithm identifier MUST match the parameters in the
key structure algorithm identifier except the saltLength field", and a PS256
message under a SHA-384 key does not match. So of the two rows the second has
the firmer ground, and the record says so rather than averaging them. (Styx
honours the MUST since `2041ccbc`: see *Decided: Styx honours the hash a key is
restricted to* below.)

**The salt is the one field a key and a signature are read differently for**,
and it has its own row because nothing else in this suite would notice. "The
saltLength field in the signature parameters MUST be greater or equal to that
in the key parameters field" — a key states a floor, where a signature states
the width it used. Every parameter set Bouncy Castle writes asks for exactly
the hash's width, so an implementation reading a key's parameters the way it
reads a signature's would pass every other row here and refuse a certificate
the specification allows. That row is Bouncy Castle's own SHA-256 parameter set
with one octet lowered, from 32 to the 20 that is also Section 3.1's DEFAULT.

**And one row records a leniency both sides share**, which is the shape §25
warns about: an `id-RSASSA-PSS` key with no parameters, carrying a message
signed with PKCS #1 v1.5. Both verify it. Styx for the reason above; COSE.TS
for a different one, which is that the restriction there is to a *scheme* and
not to an algorithm, and the COSE algorithms bundle a scheme with a hash — so
"RSASSA-PSS with whichever hash" is not a name it can attach to a key, and a
key would have to carry a family instead. Recorded in that package's changelog
as a limitation rather than fixed, because the fix is a change to a key model
and the specification asks for it only as a wish. Together with the row above
it, the pair says where the enforcement comes from: from the parameters naming
a hash, and not from the identifier.

**What anchors the family.** The certificate is pinned the way the fourth
family's is: reminting it with the identifier the corpus has gives `rsaMeter`
back, octet for octet, or the generator refuses to write the file. The
signature cannot be pinned that way — an RSASSA-PSS signature is salted, and
Bouncy Castle draws its salt from a random this generator cannot reproduce, so
no row in this suite carries PSS bytes to compare against. What says the PSS
written here is right is that both implementations verify the control, measured
rather than pinned; OpenSSL verified it too, through Node, in a probe. The salt
is fixed, which costs nothing: verification recovers the salt from the
signature, so what a random salt buys is a property of the signer, and a random
one would make this file different on every run.

### Falsification of the six rows

| what was changed | what happened |
|---|---|
| the key type made unknown again in COSE.TS, as it was before `e3cb696` | all three `normative` accept rows fail, each in both of the places a verdict is asked for — 6 failures — and the divergences go from 3 to 7, because every row of the family now has one. So the reading is what the three accept rows hold, and the three `survey` rows record the rest |
| an absent parameter set defaulting to PS256 in COSE.TS | nothing fails and the divergences go from 3 to 4. The new one is `a-restriction-that-names-no-hash-with-the-other-scheme`, which is the row that exists to record the shared leniency — so it is also the row that notices an implementation inventing a hash the certificate does not name. RFC 4055's own default is SHA-1, which no PS* is, and PS256 would be a guess |
| a key's salt length read as a width rather than a floor | `a-key-whose-salt-is-a-floor-and-not-a-width` fails in both places — 2 failures, 4 divergences — and every other row stays green, which is the whole reason that row is there. This is the mistake the row was written against, and it was a real one: the first draft of the reader required equality for keys as well |

### Decided: the key with three primes (2026-11-03)

The last gap this section recorded. RFC 8230 Section 4 "also provides support
for the so-called 'multi-prime' RSA keys, in which the modulus may have more
than two prime factors": the eight parameters as before, and the primes after
the second as an array at label −9, each a map of r_i, d_i and t_i at −10,
−11 and −12. COSE.TS `20a1a64` reads the form; `cose-sign` has one row for it.

**What was measured first, before either side changed.** The sentence above
that said both implementations "sign with the two primes they do read" was a
prediction, and it was wrong for both:

| a key with three primes | Styx | COSE.TS before `20a1a64` |
|---|---|---|
| parsed, and the array kept for the round trip | yes, 1245 bytes back as they came | yes, as a parameter it did not know |
| signed with | **refused**: *"Multi-prime RSA keys are not supported by this implementation!"* | **refused**: *"The prime factors of this RSA private key do not multiply to its modulus!"* |
| its public half | n and e, the array dropped | n and e **and the array** |
| its RFC 9679 thumbprint | `0DE18439…` | `0DE18439…` |

Styx's position is a decision, documented in its source and held by a test of
its own; COSE.TS's was an accident with two defects in it. The refusal blamed
the key for a form the package did not read. And the public half kept the
array, which is a factor of the modulus handed out under a name promising the
opposite — RFC 8230 says of a public key that "all other fields defined in the
following table below MUST be absent", and −9 is in that table. Nothing COSE.TS
constructed could reach that; a key it parsed could.

**What COSE.TS does now.** RSASP1 runs the steps RFC 8017 Section 5.1.2 adds for
the form — one more exponentiation per further prime, then the two-prime join
repeated with R the product of the primes already joined — and a two-prime key
runs exactly the code it ran before. The fault check that verifies every
signature before it is returned covers the new steps as well. The public half
drops the array with the rest. An array that names no prime is refused, because
for a two-prime key the field "MUST be absent", and so is a prime missing one
of its three fields. The key is OpenSSL's (`genrsa -primes 3 2048`, three
primes of 683, 683 and 682 bits), because nothing else in reach generates one,
and COSE.TS's tests hold the arithmetic to OpenSSL's: RS256, RS384 and RS512
byte for byte, PS256 both ways, and the CRT result equal to m^d mod n.

**What the row measured**, `sign1-rs256-rsa-three-primes`:

| check | Styx | COSE.TS |
|---|---|---|
| the RFC 9679 thumbprint | `0DE1843997C89C29…` | the same |
| the signature and the message | refused, in the sentence above | signed |
| verifying the other's message | **verified COSE.TS's** | — (Styx produced none) |

So Styx verifies what it will not sign, which is what one would expect and
still worth having measured: verifying takes the modulus and the public
exponent and nothing else, and a key with three primes has one of each.

**Why the row is `survey`.** RFC 8230 offers the form and requires it of
nobody, so a side that declines it is not wrong, and the refusal is a reasoned
one. The row records the asymmetry rather than judging it. The cost is that its
thumbprint agreement is a survey observation too: the class is per case, and the
one claim on this row that *is* a requirement — RFC 9679 takes kty, n and e,
so the further primes must not reach the identity — cannot fail a run from
here. What catches a regression there is the divergence pass, as the second
falsification below shows. RS256 rather than PS256 because RSASSA-PKCS1-v1_5 has
no randomness at all, so if both ever sign with this key the bytes are directly
comparable.

**Styx: measured, not changed.** Its refusal is a decision with a test behind
it, and reversing it is the maintainer's call. What it would take was measured
rather than guessed: Bouncy Castle has no multi-prime key class, but it signs
with `new RsaKeyParameters(true, n, d)` — the first form of RSASP1, no CRT — and
that signature verifies under n and e. And the mistake that refusal guards
against is caught there too: the two-prime CRT class handed this key's eight
parameters throws *"RSA engine faulty decryption/signing detected"*, the blinded
engine's own check of its output. So neither library would have sent the wrong
signature quietly. (Reversed the same day: see *Decided: Styx signs with the
three primes as well* below.)

**And the instrument needed one change.** The divergence pass compared only the
checks both sides recorded, so a side that stopped before the first of them left
nothing to compare, and the case read as agreement on its thumbprint: the first
run of this row reported three divergences, not four. It now counts a case
exactly one side could not run — a `runner` error on one side and none on the
other — as a divergence about the whole case. Before the change, this row was
the only such case in the suite, so nothing else moved. It is also the blind
spot behind *"5 failures, no divergence, because a side that produced nothing
has nothing to disagree with"* in the falsification table below; that row was
`normative` and failed regardless, and a `survey` row would not have.

### Falsification of the one row

| what was changed | what happened |
|---|---|
| COSE.TS reading the form no longer: the further primes ignored in RSASP1 | nothing fails and the divergences go from 4 to 3 — both sides now stop, so the case has no asymmetry left to show, and the agreement row loses its three observations of the signature, the message and the structure. The row is what tells the suite which side reads the form |
| COSE.TS putting the further primes into the thumbprint | nothing fails, and the divergences go from 4 to 5: the new one is the thumbprint of this row, `0DE18439…` against `311E6D77…`. So the identity claim is held — by the divergence pass, not by a failure, which is the cost of `survey` named above |
| the public half keeping the array | nothing in the suite: no row reads a public COSE key's bytes. That claim is held by COSE.TS's own test, which fails on it alone, and by Styx's, which already asserted it |

### Decided: Styx signs with the three primes as well (2026-11-03)

The refusal recorded above was the maintainer's to reverse, and it is reversed:
Styx `244aa8c3` signs with a key of more than two primes. Not by the route
measured above, `RsaKeyParameters(true, n, d)`, which works but gives up two
things the two-prime path has — Bouncy Castle blinds the private operation of a
CRT key only, and checks the result of a CRT key only. Instead by two classes of
Styx's own:

- `RSAMultiPrimePrivateKeyParameters` extends Bouncy Castle's two-prime CRT
  key on purpose. Its blinded engine therefore blinds this key as well, which a
  test asserts rather than assumes: a recording core sees m·r^e, never m, and
  another r every time. And an engine that knows two primes computes modulo p
  and q alone, and its check refuses to release that result — the measurement
  above, *"RSA engine faulty decryption/signing detected"*, is a test now.
- `RSAMultiPrimeCore` is the `IRsa` that computes with all of the primes: the
  second form of RSASP1 of RFC 8017 Section 5.1.2, inside the same blinded
  engine and the same PKCS #1 v1.5 and PSS encodings, with its own result
  checked against e and n before it is released.

`COSEKey` reads the array when parsing, with the refusals COSE.TS has (no
array, no prime, an entry that is no map, a field missing) and a leading zero
besides, and checks each d_i and t_i against d and the primes before it. Styx's
tests hold its bytes to the first form of RSASP1, m^d mod n, which needs no
prime at all, and let the RSA of .NET verify them under n and e. COSE.TS's tests
hold its bytes to OpenSSL's. So what agrees on this row now are two
implementations that each agree with a third computation already.

What the row measures now:

| check | Styx | COSE.TS |
|---|---|---|
| the RFC 9679 thumbprint | `0DE1843997C89C29…` | the same |
| the structure that was signed, the signature, the message | signed: `0831BDB33843FF41…`, 256 bytes | the same bytes |
| verifying the other's message | verified | verified |

4/4 on the agreement row, both cross-verifications, and the divergences go from
four to three: the one this row was built to show has nothing left to show.

**The row stays `survey`.** RFC 8230 still offers the form to whoever wants it,
and a third implementation that declines it would not be wrong — promoting the
row would make it wrong in this suite. Both implementations read the form now,
and a `normative` row would hold them to it; whether that is worth more than
the specification's own latitude is the maintainer's call, so it is offered
here and not made. (Made the next day: see *Decided: the row is normative*
below.)

**Falsified.** In Styx, seven changes, each failing only what it should:

| what was changed in Styx | Styx tests failing |
|---|---|
| R in step v not grown by the prime before | 3 — the signatures against the first form, the `COSE_Sign1`, and the blinded computation |
| no check of the result in `RSAMultiPrimeCore` | 1 — the faulty result that must be withheld |
| the signer ignoring `RSAMultiPrimeCore` | 3 — Bouncy Castle's own engine refuses every signature |
| `COSEKey.From` dropping the array | 1 — the round trip |
| t_i not checked | 1 — the further primes that do not belong to the key |
| the array not read when parsing | 1 — the malformed arrays |
| the public half keeping the array | 2 — the one in the two-prime tests and the new one |

In the suite, the third of them — Styx signing through Bouncy Castle's own
engine — fails nothing and moves the divergences from three back to four. The
runner error the C# side records is Bouncy Castle's sentence, *"RSA engine
faulty decryption/signing detected"*, and the cross-verification of COSE.TS's
message still succeeds. So a regression to two primes is seen, and is seen as
the safe failure it would be.

### Decided: the row is normative (2026-11-04)

The maintainer took the promotion offered above. `sign1-rs256-rsa-three-primes`
is `normative`: both implementations must sign with the key, to the same bytes,
and each must verify the other's message. RFC 8230 has not changed its mind —
the form is still offered and required of nobody — so this is a requirement of
this suite and not of the specification, and the row's description says so: a
third implementation that declines the form would fail here without being wrong
about RFC 8230. What the promotion buys is the half the divergence pass cannot
see. A survey row that one side stops reading shows up as a divergence and
fails nothing; now it fails the run.

It moved six checks across, and nothing else moved:

| | before | now |
|---|---|---|
| csharp | 636 normative, 60 survey | 637, 59 — verifying TypeScript's message |
| typescript | 600, 60 | 601, 59 — verifying C#'s message |
| csharp↔typescript | 453, 21 | 457, 17 — toBeSigned, signature, message, thumbprint |
| divergences | 3 | 3 |

**Falsified.** The C# runner made to ignore the further primes, so that Styx is
handed a two-prime key whose p and q do not multiply to n: the run exits 1 with
four normative failures, all on this row — the three byte agreements and
TypeScript's cross-verification, C# having produced no message to verify — and
four divergences. The thumbprint stays agreed, as it must: it reads n and e, and
those were never in question. Before the promotion the same change failed
nothing.

### The two party fields no row set (2026-11-04)

The count above left two header algorithm parameters without a row: `PartyU
other` (−23) and `PartyV nonce` (−25). `ecdh-direct-salt-and-parties` sets the
other four. `ecdh-direct-the-other-party-fields` sets these two and nothing
else. It uses the same keys and the same salt, so the secret is the same and
only the context differs. The nonce is a byte string where the older row's is an
integer, the other form RFC 9053 Section 5.2 allows. Neither party has an
identity, so four of the six fields enter `COSE_KDF_Context` as nil, never
omitted, and are absent from the headers.

A row that only compared the two implementations would have measured less than
it seems, and §12 says why: the context is derived and not transmitted, so a
field both sides build wrongly still opens. So both party rows now carry
expected values from `tools/EcdhCases`: the secret, the context, the derived key
and the message. The generator computes them from the noble primitives through
its own hand-written CBOR, which must first reproduce `p256-hkdf-256-01`. The
older row had held the two sides only to each other since it existed. Its new
expected values are the bytes both implementations had already recorded for it,
recomputed by a third party.

| | before | now |
|---|---|---|
| csharp | 637 normative | 646 — four computed values on each party row, and opening TypeScript's message on the new one |
| typescript | 601 | 610 — the same |
| csharp↔typescript | 457 | 464 — the seven agreements of the new row |
| divergences | 3 | 3 |

**Falsified**, twice:

| what was changed | what happened |
|---|---|
| both implementations writing nil for a byte-string nonce in the context, `ecdh.ts` and `COSEKeyAgreement.cs` together | the new row fails six times: the context, the key and the message computed by the generator, on each side. No agreement fails, no divergence appears, and each side still opens the other's message. With the computed values removed from the row, the same recordings fail nothing at all. That is the mistake §12 describes, and only a third party sees it |
| COSE.TS alone dropping `other` from its context | 18 failures, all on the two party rows, and 8 more divergences. Every agreement on those rows fails and both cross-openings fail. The computed values fail on the TypeScript side only, so they also say which side is wrong, which an agreement cannot |

### Decided: Styx honours the hash a key is restricted to (2026-11-04)

Of the two divergences that an `id-RSASSA-PSS` key raised, the maintainer had
Styx take up the one with a MUST behind it. `a-key-restricted-to-another-hash`
is a key restricted to RSASSA-PSS with SHA-384, carrying a PS256 message.
Scenario 3 of RFC 4055 Section 3.3 forbids that: "all parameters in the
signature structure algorithm identifier MUST match the parameters in the key
structure algorithm identifier except the saltLength field". Styx used to
verify it, because Bouncy Castle hands over an `RsaKeyParameters` that cannot
be told apart from an `rsaEncryption` key's and keeps the identifier on the
certificate. Since Styx `2041ccbc` the certificate is asked directly:
`COSECertificateChain.PermitsAlgorithm` reads the end-entity certificate's
subject public key info, and `VerifyWithCertificateChain` calls it after the
chain has validated and before the signature is checked.

For an RSASSA-PSS message under such a key with parameters, those parameters
have to be what a COSE PS* is [RFC 8230, Section 2]: its hash, MGF1 over the
same hash, trailer field 1, and a salt floor the hash reaches. These are the
same rules COSE.TS applies when it reads the key, reached by another route.
COSE.TS turns the parameters into the one algorithm the key carries. Styx
compares them with the message's algorithm when it verifies.

What it deliberately leaves alone is the scheme. An RSASSA-PKCS1-v1_5 message
under an `id-RSASSA-PSS` key still verifies in Styx, and
`a-key-restricted-to-the-other-rsa-scheme` is still a divergence. RFC 4055
states that restriction as what the owner wishes, and no MUST stands behind
it, so it remains open and was not part of this decision. Styx's tests pin the
leniency, so a change to it will be a decision and not an accident.

| row | Styx before | Styx now | COSE.TS |
|---|---|---|---|
| `a-key-restricted-to-another-hash` | verified | refused, *"restricts its key to RSASSA-PSS with SHA-384, and this message is signed with 'PS256', which hashes with SHA-256"* | refused |
| `a-key-restricted-to-the-other-rsa-scheme` | verified | verified | refused |
| the four rows that must verify | verified | verified | verified |

The divergences go from three to two, and nothing else moves: 646 / 610 / 464
/ 56, zero failures.

**The row stays `survey`.** Both sides refuse now, and a `normative` row would
hold them to it. Unlike the multi-prime row, a third implementation that
verified this message would be breaking a MUST rather than declining an
option, so the case for promoting it is stronger. Promoting it is still the
maintainer's call, so it is offered here and not made. (Made the same day: see
*Decided: the hash row is normative* below.)

**Falsified.** In Styx, seven changes, each failing only what it should:

| what was changed in Styx | Styx tests failing |
|---|---|
| the restriction never asked | 8: the four hash mismatches, the salt floor, MGF1 over another hash, another trailer field, and the defaults |
| the hash not compared | 5: the four hash mismatches and the defaults, which name SHA-1 |
| the salt read as a width | 1: the floor |
| the salt not compared | 1: the floor |
| the MGF1 hash not compared | 1 |
| the trailer field not compared | 1 |
| absent parameters read as their defaults | 1: the key without parameters, which takes any PS* |

In the suite, the first of them fails nothing and moves the divergences from
two back to three. That is the limit of a `survey` row. The divergence pass
sees the regression and the run stays green, which is what the promotion
offered above would change.

### Decided: the hash row is normative (2026-11-04)

The maintainer took that promotion as well. `a-key-restricted-to-another-hash`
is `normative`, and an implementation that verifies a PS256 message under a key
restricted to SHA-384 now fails the run. Unlike the multi-prime row, this is
not a requirement of this suite alone: RFC 4055 Section 3.3 states it as a MUST,
so a third implementation that fails the row is wrong about RFC 4055 and has not
merely declined an option. The description, written in `tools/X509Cases` and
regenerated, says so. Every message in the file is byte for byte what it was.

It moved three checks across, and nothing else moved:

| | before | now |
|---|---|---|
| csharp | 646 normative, 59 survey | 647, 58: its verdict on the row |
| typescript | 610, 59 | 611, 58: the same |
| csharp↔typescript | 464, 17 | 465, 16: the agreement of the two verdicts |
| divergences | 2 | 2 |

**Falsified** with the same change as above, Styx never asking
`PermitsAlgorithm`. Before the promotion it failed nothing. Now the run exits 1
with two normative failures, both on this row: C#'s verdict, and the agreement
of the two verdicts. The divergences go to three. The scheme row beside it is
untouched and still `survey`, as nothing was decided about it.

### Decided: Styx refuses what RFC 4055 does not allow (2026-11-04)

The maintainer had Styx take up the first divergence of the RSA certificates
as well. `a-parameter-rfc-4055-does-not-allow` is a certificate with a
zero-length OCTET STRING beside `sha256WithRSAEncryption`, consistent in both
copies and under a valid signature. Styx verified it, because Bouncy Castle
compares the two copies and accepts whatever parameters both share. Since Styx
`82af43fd`, `COSECertificateChain.TryParse` refuses it, next to the DER check
and at the same point. It checks every certificate of the `COSE_X509` and both
copies of the signature algorithm, for md5, sha1, sha224, sha256, sha384 and
sha512WithRSAEncryption. A NULL and nothing at all are read as before, and
every other signature algorithm is untouched. That is the line COSE.TS draws
with `expectNoParameters`.

| row | Styx before | Styx now | COSE.TS |
|---|---|---|---|
| `a-parameter-rfc-4055-does-not-allow` | verified | refused, *"says it was signed with '1.2.840.113549.1.1.11' and carries parameters beside it, where RFC 4055 Section 5 allows a NULL or nothing at all"* | refused |
| `the-parameter-rfc-4055-asks-for`, a NULL | verified | verified | verified |
| `no-parameters-at-all` | verified | verified | verified |

The divergences go from two to one, and nothing else moves: 647 / 611 / 465 /
56, zero failures.

**The row stays `survey`.** This time the reason is weaker than for the hash
row. RFC 4055 §5 makes the certificate invalid, but nothing in it or in RFC
9360 is addressed to a verifier of COSE messages. A third implementation that
verified the message would be lenient about a field it does not interpret, and
would not be breaking a rule addressed to it. Both sides refuse now, so a
`normative` row would hold them to it. Promoting it is the maintainer's call,
offered here and not made. (Made the same day: see *Decided: the NULL row is
normative* below.)

**Falsified.** In Styx, four changes, each failing only what it should:

| what was changed in Styx | Styx tests failing |
|---|---|
| the parameters never asked | 7: three odd parameter sets, three more PKCS #1 v1.5 hashes, and an issuing certificate at position 1 |
| a NULL refused as well | 19: every test whose certificates Bouncy Castle signs with RSA, since it writes a NULL |
| absent parameters refused | 1 |
| `sha1WithRSAEncryption` left out | 1 |

The Styx tests mint their certificates through a signature factory that signs
as Bouncy Castle does and names the algorithm with whatever parameters a test
asks for. So the odd parameters are consistent in both copies and the signature
verifies, which a test asserts before it expects the refusal. In the suite, the
first change fails nothing and moves the divergences from one back to two, the
limit of a `survey` row once again.

### Decided: the NULL row is normative (2026-11-04)

The maintainer took this promotion too. `a-parameter-rfc-4055-does-not-allow`
is `normative`, and an implementation that verifies a message whose
certificate carries anything other than a NULL, or nothing at all, beside
`sha256WithRSAEncryption` now fails the run. Of the three promotions of the
day it rests on the narrowest ground, and the description says so. RFC 4055 §5
makes the certificate invalid, but nothing in it or in RFC 9360 is addressed to
a verifier of COSE messages. So, as with the multi-prime row, this is a
requirement of this suite. A third implementation that verified the message
would fail here for being lenient about a field it does not interpret, not for
breaking a rule addressed to it. The description was written in
`tools/X509Cases` and the file regenerated. Every message in it is byte for
byte what it was.

It moved three checks across, and nothing else moved:

| | before | now |
|---|---|---|
| csharp | 647 normative, 58 survey | 648, 57: its verdict on the row |
| typescript | 611, 58 | 612, 57: the same |
| csharp↔typescript | 465, 16 | 466, 15: the agreement of the two verdicts |
| divergences | 1 | 1 |

**Falsified** with the same change as above: Styx never asks whether the
certificate has the parameters a PKCS #1 v1.5 signature allows. Before the
promotion that failed nothing. Now the run exits 1 with two normative
failures, both on this row: C#'s verdict and the agreement of the two
verdicts. The divergences go to two.

### Falsification

| what was changed | what happened |
|---|---|
| ESP384 resolved to SHA-256 — COSE.TS `algorithm.ts` | `sign1-esp384-fully-specified`: the signature and the message disagree and both cross-verifications fail — 4 failures, 2 divergences |
| the `x5t` thumbprint computed with SHA-256 whatever the label says — COSE.TS `x5chain.ts`, `CoseCertificateHash.from` | both new thumbprint rows: thumbprint and message disagree, TypeScript refuses its own message and C# refuses TypeScript's — 8 failures, 6 divergences |
| a 24-byte key-encryption key labelled A128KW — COSE.TS `recipient.ts`, `keyWrapAlgorithmFor` — and the ECDH-ES + A192KW entry sized for 16 bytes | both A192KW rows: the message, the first recipient structure and the `COSE_KDF_Context` disagree, and neither side opens the other's — 7 failures, 4 divergences |
| the `crit` entry taken out of the critical Partial IV row | that *is* the row beside it, which both implementations opened when this was written and both refuse since 2026-11-03 — so the change no longer separates the two rows, which is a finding of its own above |
| EdDSA (−8) given a fixed Ed25519 curve — COSE.TS `algorithm.ts` | `sign1-eddsa-ed448` alone: the TypeScript side produces no message at all, so its three agreements fail and both cross-verifications with it — 5 failures, no divergence, because a side that produced nothing has nothing to disagree with. `sign1-eddsa-ed25519` stays green, which is the whole reason the row is a pair |

One falsification caught nothing, and it belongs here for that reason. Changing
A192KW's `keySize` in the algorithm table from 24 to 16 changes nothing
whatsoever: the key-wrap algorithm is read off the key-encryption key's length
by `keyWrapAlgorithmFor`, and the field is consulted for content encryption
only. That was the first attempt at the third row above, and it looked exactly
like a suite passing over a broken library. A falsification that does not fail
has falsified nothing — including itself.

### Where it leaves the suite

Thirty-four cases: four signatures, the EdDSA pair, two key wraps, two
thumbprints, two Partial IV, the SHA-1 thumbprint of §24, the six RSA rows that
the count produced, the four certificate rows that the asymmetry it turned up
produced, the three parameter rows that had to be minted, the six key-type rows
that minting made possible, the key with three primes, and the two party fields
no row set. 648 (C#) / 612 (TypeScript) / 56 (the third reader) normative, 466
agreements, zero failures, zero messages verified against what the third reader
refuses, 57 survey observations each and 15 on the agreement rows.

And one cross-implementation divergence, where this suite ran at zero for a
while. It is a row built to produce it: the restriction of a key to RSASSA-PSS
as a scheme, which RFC 4055 states as a wish. Three more have been closed. The
first was a key form RFC 8230 offers and one side declined, until Styx
`244aa8c3` read it too. The second was the hash such a key is restricted to, a
MUST of Section 3.3, until Styx `2041ccbc` honoured it too. The third was a
parameter RFC 4055 does not allow, until Styx `82af43fd` refused it too.
Divergences are the first thing a reader of the report meets, and they are the point. A divergence is what this suite is for, and `survey` is
how one is written down while which side is right remains the specification's
question and not this suite's.

The promotion of 2026-11-03 moved five rows across: the two cross-open
verdicts, one per opening implementation, and the three byte agreements of the
case. The promotions of 2026-11-04 moved twelve: the four agreements and the
two cross-verifications of the key with three primes, the two verdicts and
their agreement on the hash a key is restricted to, and the same three on the
parameter RFC 4055 does not allow.

Of the 44 algorithms both implement, all 44 now have a vector. Of the 13 header
parameters both name, 11 do: the two that do not are the deprecated counter
signature of label 7 and `Countersignature0 version 2` of label 12 — and the
second is §26's shape exactly, a registered label both can name and neither
reads, with COSE.TS's scope block giving the reason. Of
the 8 header algorithm parameters both name, all 8 do since 2026-11-04: `PartyU
other` (−23) and `PartyV nonce` (−25) were the two the one party row left out,
and the row beside it sets them.
