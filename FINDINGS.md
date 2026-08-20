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
TypeScript ASCII rendering into the C# parser — and the only remaining
default-behaviour divergences are exactly the strict/lenient decoder-profile
difference §6 describes (non-shortest heads, indefinite lengths,
non-preferred bignums — the strict profile is RECOMMENDED, TS's default;
the lenient profile is C#'s generic-reader default).

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
| 4.11 | §6 now names the two decoder profiles: **strict (RECOMMENDED)** verifies deterministic encoding; **lenient** MAY accept non-deterministic bytes but MUST NOT reproduce them. The defaults of the two implementations are both describable and stay as they are. |
| 4.12–4.16 | The JSON conversion is **exact and pinned** (metrological-text §3): integers of any size and decimal fractions are exact JSON numbers in both directions and never pass through binary floats; floats are written with their point (`1.0`) and come back as exact decimals; tag 1 becomes the instant as `YYYY-MM-DDThh:mm:ss.fffZ`; tags 2/3/4 outside readings convert as numbers. TS grew the exact text path this requires (`mcborToJsonText` / `jsonTextToMcbor`), since JavaScript's `JSON.parse`/`stringify` cannot carry exact digits; C# normalises JSON exponents that leave no decimal places to integers. |

The last tolerance questions were decided on 2026-08-18 as well, each the
way both implementations already agreed where they agreed: the coverage
factor MUST be positive (§3.4); leading zeros, surrounding whitespace, the
missing space inside the `±` parenthesis and after the statement comma are
accepted input (§2.6); and a bare space is **never** a factor separator —
`5 m s` stays prose (§2.6, the one point where the implementations differed;
TypeScript dropped the tolerance). Nothing outside the decoder-profile
choice remains open.

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
decision rather than a gap.

The suite now stands at **454 (C#) / 418 (TypeScript) normative passes, 223
cross-implementation agreements, zero failures**.


## 12. ECDH-ES and the HKDF derivations: filed, with reasons (recorded 2026-08-19)

Not built, deliberately. Both implementations omit ECDH key agreement and the
HKDF-based key derivations *identically*, which is what makes the omission
honest: no row in the report is green because one side quietly agreed with the
other about something neither of them performed.

The reasons belong on the record, because "not yet" and "not worth it" look
alike from outside and this is neither.

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

Two consequences follow, and together they are this entry.

**A mistake is self-consistent.** Sender and recipient run the same code, so a
wrong field is wrong on both sides and the message opens perfectly. The
implementation then interoperates with exactly one other implementation:
itself. Vectors generated from the same lineage do not catch it, because they
carry the same mistake. This is precisely the failure class this repository
exists to find, and the only instrument that finds it is a second, independent
implementation — which means implementing it *badly twice* would be worse than
not implementing it at all.

**A mistake is silent.** A wrong `Sig_structure` reports "signature invalid".
A wrong KDF context reports "AEAD tag mismatch": two layers from the cause, and
indistinguishable from a corrupted message, a wrong key or a flipped bit on the
wire. AEAD is built to reveal nothing about why it failed, and it reveals
nothing to the implementer either.

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
  the recipient algorithm that derived it.** For `direct+HKDF-SHA-256`
  protecting content with A128GCM the field holds `1`; for `ECDH-ES+A128KW` it
  holds `-3`, because what comes out is a key-encryption key. `-25` belongs
  nowhere in that field — it appears only inside the protected bytes carried
  further down the same structure. Putting the recipient algorithm in the slot
  is the most natural mistake available and yields code that looks right and
  works.
- **`PartyInfo` is a group of three fields that are always present** and may be
  `nil`. Reading "not needed" as "omitted" produces `80 80` where the RFC wants
  `83f6f6f6 83f6f6f6`, and the CDDL does not obviously forbid it.
- **`protected` is `empty_or_serialized_map`** — a zero-length byte string when
  the bucket is empty, not the encoded empty map. The same trap as everywhere
  else in COSE, in the one place with no error message.
- **`keyDataLength` counts bits.**

### The key agreement has edges of its own

- **The shared secret is the x-coordinate alone, through I2OSP, left-padded to
  the field size.** Not the point, not its DER encoding, not the minimal
  integer. An implementation taking it from a big-integer library that strips
  leading zeros is wrong roughly once in 256 messages on P-256 and P-384 — and
  roughly *every second message* on P-521, whose top byte of sixty-six carries
  a single bit. A defect that passes 255 of 256 fixed vectors and then fails
  sporadically in the field, with no pattern, is the worst shape a defect can
  have. Any vector set here has to include a key pair whose shared x-coordinate
  begins with a zero byte, chosen on purpose.
- **Static-Static derives the same secret every time.** Two static keys yield
  one shared secret, so without a distinguishing input every message gets the
  same content key — which under AES-GCM is nonce reuse by another route, with
  correctly fresh nonces. RFC 9053 §6.3.1 makes `salt` or `PartyU nonce` a MUST
  for exactly this, and permits a counter with the proviso that it be
  persisted: a power failure at the wrong moment becomes a cryptographic
  incident.
- **Invalid-curve attacks.** The recipient key is always static. Without
  validating the received ephemeral point, the agreement runs on a curve the
  attacker chose, of smooth order; whether decryption succeeds is the oracle,
  and the static private key falls out by the Chinese remainder theorem over a
  few thousand messages. This has been demonstrated against real
  implementations of JWE's ECDH-ES, COSE's sibling. RFC 9053 §6.3.1.1 says only
  that *"there is a method of checking that points provided from external
  entities are valid"* — no MUST — and, for OKP, that *"there is no simple way
  to perform point validation"*; the substitute there is RFC 7748 §6.1's check
  for an all-zero output, which catches small-order inputs.
- **HKDF-AES-MAC cannot be combined with ECDH at all**, because it always skips
  the extract step and an ECDH secret is not uniformly random. That rule lives
  in one sentence of RFC 9053 §5.1 and in none of its tables.

### What would change the decision

Not the effort; it is not much code. Two other things:

- **A use case.** The metrological record is *signed*, and that is what gives
  it standing with a third party; no key agreement changes that. Encryption
  sits on the link beneath, where the parties are already provisioned and a
  pre-shared secret with `direct` or key wrap covers the ground. ECDH earns its
  keep when a content key must reach a party with whom nothing was shared in
  advance — a situation this system does not currently have.
- **Vectors that can actually falsify it.** Cross-implementation agreement is
  not sufficient here, because agreement is precisely what a shared mistake
  produces. It would need published third-party vectors (RFC 9052 Appendix C.3
  and the COSE working group examples carry the ephemeral keys and the
  resulting messages), plus the zero-byte x-coordinate case above, plus
  point-validation cases that have to be *rejected* rather than merely
  disagreed about.

Until both hold, the honest position is the one both READMEs already state:
not implemented, on both sides, for the same stated reason.
