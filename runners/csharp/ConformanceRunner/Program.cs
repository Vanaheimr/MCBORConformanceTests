/*
 * Metrological CBOR conformance runner for the C# reference implementation
 * (Vanaheimr Styx). Reads the shared vector files, executes every check with
 * the implementation's DEFAULT settings, and writes the observed behaviour as
 * JSON. All judging happens in the comparison driver — this program only
 * records what the implementation does.
 *
 * Usage: ConformanceRunner <output.json> <vectorFileOrDir> [more...]
 */

using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

using Org.BouncyCastle.Crypto;
using Org.BouncyCastle.Crypto.Parameters;
using Org.BouncyCastle.Math;
using Org.BouncyCastle.X509;

using org.GraphDefined.Vanaheimr.Illias;

if (args.Length < 2)
{
    Console.Error.WriteLine("Usage: ConformanceRunner <output.json> <vectorFileOrDir> [more...]");
    return 2;
}

var outputFile   = args[0];
var vectorFiles  = new List<String>();

foreach (var argument in args.Skip(1))
{
    if (Directory.Exists(argument))
        vectorFiles.AddRange(Directory.GetFiles(argument, "*.json").Order());
    else
        vectorFiles.Add(argument);
}

var results = new JsonObject();

// The certificate corpus, minted by Bouncy Castle and read back by both
// implementations. It is loaded from beside the vector file rather than
// compiled in, because the cross-feed suites live in a directory of their own
// and have to find the very same certificates there.
JsonObject? corpus = null;

foreach (var vectorFile in vectorFiles)
{

    var root = JsonNode.Parse(File.ReadAllText(vectorFile, Encoding.UTF8))!.AsObject();

    if (root["suite"] is null || root["cases"] is null)
        continue;

    var suite = root["suite"]!.GetValue<String>();

    if (suite.StartsWith("cose-x509"))
        corpus = JsonNode.Parse(
                     File.ReadAllText(
                         Path.Combine(Path.GetDirectoryName(Path.GetFullPath(vectorFile))!,
                                      "cose-x509-corpus.json"),
                         Encoding.UTF8
                     )
                 )!.AsObject();

    foreach (var caseNode in root["cases"]!.AsArray())
    {

        var testCase  = caseNode!.AsObject();
        var id        = testCase["id"]!.GetValue<String>();
        var checks    = new JsonObject();

        try
        {
            switch (suite)
            {
                case "values":         RunValues       (testCase, checks); break;
                case "values-invalid": RunValuesInvalid(testCase, checks); break;
                case "cbor-robustness": RunCBORRobustness(testCase, checks); break;
                case "default-encoding": RunDefaultEncoding(testCase, checks); break;
                case "default-readings": RunDefaultReadings(testCase, checks); break;
                case "documents":      RunDocuments    (testCase, checks); break;
                case "json-to-cbor":   RunJsonToCbor   (testCase, checks); break;
                case "json-escapes":   RunJSONEscapes  (testCase, checks); break;
                // One-way tag conversions: the same two checks a document
                // needs, judged against the text the specification prescribes.
                case "json-tags":      RunDocuments    (testCase, checks); break;
                case "parse-texts":    RunParseTexts   (testCase, checks); break;
                case "cose-sign":      RunCoseSign     (testCase, checks); break;
                case "cose-crit":      RunCOSECrit     (testCase, checks); break;
                case "cose-verify":    RunCoseVerify   (testCase, checks); break;

                case "cose-encrypt":     RunCoseEncrypt   (testCase, checks); break;

                // ECDH-ES runs through the same machinery; a case that has to
                // be refused carries the message and is only ever opened.
                case "cose-ecdh":
                    if (testCase["expected"]?.GetValue<String>() == "reject") RunCoseDecrypt(testCase, checks);
                    else                                                      RunCoseEncrypt(testCase, checks);
                    break;
                case "cose-decrypt":     RunCoseDecrypt   (testCase, checks); break;
                case "cose-mac0":        RunCoseMac0      (testCase, checks); break;
                case "cose-mac0-verify": RunCoseMac0Verify(testCase, checks); break;

                case "cose-x509":
                    RunCoseX509(testCase, checks,
                                corpus ?? throw new Exception("No certificate corpus was found beside the vector file!"));
                    break;

                case "cose-x509-validate":
                // Messages a third party assembled, because neither side will
                // write them: the same reading path as the cross-feed above.
                case "cose-x509-messages":
                    RunCoseX509Validate(testCase, checks,
                                        corpus ?? throw new Exception("No certificate corpus was found beside the vector file!"));
                    break;
            }
        }
        catch (Exception e)
        {
            checks["runner"] = Error($"Unhandled runner exception: {e.Message}");
        }

        results[$"{suite}:{id}"] = checks;

    }

}

var document = new JsonObject {
    ["runner"]         = "csharp",
    ["implementation"] = "Vanaheimr Styx",
    ["version"]        = typeof(CBORValue).Assembly.GetName().Version?.ToString() ?? "unknown",
    ["results"]        = results
};

File.WriteAllText(
    outputFile,
    document.ToJsonString(new JsonSerializerOptions {
        WriteIndented = true,
        Encoder       = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    }),
    new UTF8Encoding(false)
);

Console.WriteLine($"csharp runner: {results.Count} cases -> {outputFile}");
return 0;


// ------------------------------------------------------------------ suites --

static void RunValues(JsonObject TestCase, JsonObject Checks)
{

    var hex = TestCase["hex"]!.GetValue<String>();

    Checks["decode"] = TryDecodeValue(hex, out var value, out var decodeError)
                           ? Ok()
                           : Error(decodeError!);

    if (decodeError is null)
    {
        Checks["reencode"] = Capture(() => OkHex(EncodeCanonical(value)));
        Checks["format"]   = Capture(() => OkText(value.ToString()));
    }

    if (TestCase["text"] is not null)
        Checks["parse"] = ParseTextToHex(TestCase["text"]!.GetValue<String>());

    if (TestCase["parseTexts"] is JsonArray parseTexts)
    {
        var index = 0;
        foreach (var entry in parseTexts)
        {
            Checks[$"parse:{index}"] = ParseTextToHex(entry!["text"]!.GetValue<String>());
            index++;
        }
    }

}


static void RunValuesInvalid(JsonObject TestCase, JsonObject Checks)
{

    if (TestCase["hex"] is not null)
    {
        var hex = TestCase["hex"]!.GetValue<String>();
        Checks["decode"] = TryDecodeValue(hex, out var value, out var decodeError)
                               ? new JsonObject {
                                     ["status"] = "ok",
                                     ["hex"]    = Capture(() => OkHex(EncodeCanonical(value)))["hex"]?.DeepClone()
                                 }
                               : Error(decodeError!);
    }

    if (TestCase["text"] is not null)
        Checks["parse"] = ParseTextToHex(TestCase["text"]!.GetValue<String>());

}


/// <summary>
/// Hand raw CBOR to the generic reader and record what happened.
///
/// Everything else in this file goes through a metrological entry point, which
/// means the layer beneath - the CBOR reader itself - is only ever exercised on
/// bytes that were already going to be a reading. These cases exercise it
/// directly: a text string that is not UTF-8 and a document nested past any
/// sensible bound are refused by the reader, not by anything above it.
///
/// Deliberately parsed with the DEFAULT reader options rather than a strict
/// preset, because what is being compared is what each library does to a caller
/// who asked for nothing in particular.
///
/// The re-encoded bytes are recorded for the accepted cases as well, so that
/// "both accepted it" is not mistaken for "both read the same thing". Canonical
/// writer options are used for that, since the question here is what was read
/// rather than how it is written back.
/// </summary>
static void RunCBORRobustness(JsonObject TestCase, JsonObject Checks)
{

    Checks["decode"] = Capture(() => {

        var bytes = Convert.FromHexString(TestCase["hex"]!.GetValue<String>());

        return CBORValue.TryParse(bytes, out var cbor, out var errorResponse)
                   ? OkHex(Convert.ToHexString(cbor.ToByteArray(CBORWriterOptions.Canonical)))
                   : Error(errorResponse!);

    });

}


/// <summary>
/// Encode a value with this library's DEFAULT writer options.
///
/// Deliberately NOT CBORWriterOptions.Canonical, which is what every other
/// comparison in this project passes - the conformance runner above and Styx's
/// own specification-vector tests alike. CBORWriterOptions.Default has
/// Deterministic = false, so map entries are written in insertion order rather
/// than sorted, and until this suite existed that path was covered by no
/// vector at all.
///
/// Specification Section 6 is what makes this normative: the encoding of a
/// given metrological value is a function of the value alone, so producing
/// anything but the canonical bytes is a violation whatever the options say.
/// </summary>
static void RunDefaultEncoding(JsonObject TestCase, JsonObject Checks)
{

    Checks["defaultEncoding"] = Capture(() => {

        if (!MetrologicalValue.TryParse(TestCase["text"]!.GetValue<String>(),
                                        out var value,
                                        out var errorResponse))
            return Error(errorResponse);

        return OkHex(Convert.ToHexString(value.ToCBOR().ToByteArray()));

    });

}


/// <summary>
/// Convert a JSON document with this library's DEFAULT options.
///
/// Deliberately NOT the Readings = Auto that JsonToCborHex passes, and that
/// is the entire point of the suite. Every other JSON comparison in this
/// project asks for the conversion metrological-text.md Section 3.2
/// describes, so a suite that overrides the default can never see a
/// divergence in it - which is not hypothetical: the two implementations
/// disagreed about this exact default for a day and nothing here noticed.
///
/// The writer options ARE canonical, because what is under test is the
/// reading decision and not the writing one.
/// </summary>
static void RunDefaultReadings(JsonObject TestCase, JsonObject Checks)
{

    Checks["defaultReadings"] = Capture(() =>
        OkHex(
            Convert.ToHexString(
                CBORJSON.ToCBOR(TestCase["json"]!.GetValue<String>()).
                         ToByteArray(CBORWriterOptions.Canonical)
            )
        ));

}


static void RunDocuments(JsonObject TestCase, JsonObject Checks)
{

    var cborHex = TestCase["cborHex"]!.GetValue<String>();
    String? json = null;

    Checks["toJson"] = Capture(() => {
        json = CBORJSON.ToJSONText(Convert.FromHexString(cborHex));
        return new JsonObject { ["status"] = "ok", ["json"] = json };
    });

    if (json is not null)
        Checks["roundtrip"] = JsonToCborHex(json);

}


/// <summary>
/// String escapes, in whichever direction the case names.
///
/// The reading direction is the one that matters: the TypeScript side carries
/// its own JSON reader, and therefore its own unescaper, which no vector in
/// this project had ever reached - not one of the JSON-carrying cases contained
/// a backslash. The writing direction records what each side produces without
/// insisting they agree, because JSON permits several spellings of one string;
/// what has to hold is that each reads its own output back.
/// </summary>
static void RunJSONEscapes(JsonObject TestCase, JsonObject Checks)
{

    if (TestCase["json"] is not null)
        Checks["toCbor"] = JsonToCborHex(TestCase["json"]!.GetValue<String>());

    if (TestCase["cborHex"] is not null)
    {

        var cborHex = TestCase["cborHex"]!.GetValue<String>();
        String? json = null;

        Checks["toJson"] = Capture(() => {
            json = CBORJSON.ToJSONText(Convert.FromHexString(cborHex));
            return new JsonObject { ["status"] = "ok", ["json"] = json };
        });

        if (json is not null)
            Checks["roundtrip"] = JsonToCborHex(json);

    }

}


static void RunJsonToCbor(JsonObject TestCase, JsonObject Checks)
{
    Checks["toCbor"] = JsonToCborHex(TestCase["json"]!.GetValue<String>());
}


static void RunParseTexts(JsonObject TestCase, JsonObject Checks)
{
    Checks["parse"] = ParseTextToHex(TestCase["text"]!.GetValue<String>());
}


// -------------------------------------------------------------------- COSE --

/// <summary>
/// The key a case signs or verifies with. Both halves are derived from the
/// private scalar, so a signer and a verifier can never disagree about which
/// public key belongs to which private one.
/// </summary>
static (AsymmetricKeyParameter PrivateKey,
        AsymmetricKeyParameter PublicKey,
        COSEAlgorithm          Algorithm,
        Byte[]?                KeyIdentifier,
        COSEKey                Key) CoseKeyOf(JsonObject TestCase, Boolean Secondary)
{

    var suffix         = Secondary ? "2" : "";
    var algorithmName  = TestCase[$"algorithm{suffix}"]!.GetValue<String>();
    var d              = TestCase[$"keyD{suffix}"]!.GetValue<String>();

    if (!COSEAlgorithm.TryParse(algorithmName, out var algorithm))
        throw new Exception($"Unknown COSE algorithm '{algorithmName}'!");

    var keyIdentifier  = TestCase[$"keyIdentifier{suffix}"] is null
                             ? null
                             : Convert.FromHexString(TestCase[$"keyIdentifier{suffix}"]!.GetValue<String>());

    AsymmetricKeyParameter privateKey;

    if (algorithm.Family == COSEAlgorithmFamily.MLDSA)
    {
        // An algorithm key pair has no curve to name, and its private key is
        // the 32-byte seed rather than the expanded secret key [RFC 9964].
        privateKey = MLDsaPrivateKeyParameters.FromSeed(
                         algorithm.MLDsaParameterSet!,
                         Convert.FromHexString(d)
                     );
    }

    else
    {

        var curveName = TestCase[$"curve{suffix}"]?.GetValue<String>()
                            ?? throw new Exception($"The COSE algorithm '{algorithmName}' needs a curve!");

        if (!COSECurve.TryParse(curveName, out var curve))
            throw new Exception($"Unknown COSE curve '{curveName}'!");

        privateKey = algorithm.Family switch {

            // EdDSA keys are fixed-width octet strings rather than scalars.
            COSEAlgorithmFamily.EdDSA when curve == COSECurve.Ed448
                => new Ed448PrivateKeyParameters  (Convert.FromHexString(d), 0),

            COSEAlgorithmFamily.EdDSA
                => new Ed25519PrivateKeyParameters(Convert.FromHexString(d), 0),

            _   => new ECPrivateKeyParameters(
                       new BigInteger(d, 16),
                       curve.DomainParameters
                           ?? throw new Exception($"The COSE curve '{curveName}' has no domain parameters!")
                   )

        };

    }

    var key = COSEKey.From(privateKey, keyIdentifier, algorithm);

    return (privateKey,
            key.ToPublicCOSEKey().ToPublicKey(),
            algorithm,
            keyIdentifier,
            key);

}


/// <summary>
/// Sign one case, recording what a second implementation has to agree with:
/// the structure that was signed, the signature bytes, the whole message and
/// the key thumbprints.
///
/// Signing is deterministic (RFC 6979) rather than randomized, which is the
/// one departure of this suite from "the implementation's default settings" —
/// and it is the only mode in which the signature bytes of two implementations
/// can be compared at all. Randomized signing is exercised by the
/// cross-verification instead, which accepts either.
/// </summary>
/// <summary>
/// Sign a message whose protected bucket carries a "crit" demand, then verify it.
///
/// Both halves matter and for different reasons. Signing has to succeed for the
/// message to exist at all - except in the one case where the demand itself is
/// malformed, where refusing to build it is a perfectly good answer and the
/// suite says so. Verifying is where the demand is either honoured or ignored,
/// and a verifier that ignores "crit" passes every other suite in this project.
///
/// The message is verified with the same key that signed it, so a false verdict
/// can only come from the crit processing: the signature is over bytes this
/// implementation produced one line earlier.
/// </summary>
static void RunCOSECrit(JsonObject TestCase, JsonObject Checks)
{

    var payload  = Convert.FromHexString(TestCase["payload"]!.GetValue<String>());
    var primary  = CoseKeyOf(TestCase, false);

    COSESign1? message = null;

    Checks["message"] = Capture(() => {

        var protectedHeader = COSEHeaders.Create(primary.Algorithm, primary.KeyIdentifier);

        if (TestCase["protectedExtra"] is not null)
        {
            foreach (var entry in TestCase["protectedExtra"]!.AsArray())
            {
                var pair = entry!.AsArray();
                protectedHeader = protectedHeader.Set(CBORValue.FromInt64(pair[0]!.GetValue<Int64>()),
                                                      CBORValue.FromInt64(pair[1]!.GetValue<Int64>()));
            }
        }

        var critical = CBORValue.FromArray(
                           (TestCase["crit"]?.AsArray() ?? [])
                               .Select(each => CBORValue.FromInt64(each!.GetValue<Int64>()))
                       );

        // Moving the demand to the unprotected bucket is the point of one case:
        // there it is outside the signature, so anyone in the middle can strip
        // it, which is why RFC 9052 Section 3.1 requires it to be protected.
        COSEHeaders? unprotectedHeader = null;

        if (TestCase["critUnprotected"]?.GetValue<Boolean>() == true)
            unprotectedHeader = COSEHeaders.Create().Set(COSEHeaderLabel.Critical, critical);
        else
            protectedHeader = protectedHeader.Set(COSEHeaderLabel.Critical, critical);

        message = COSESign1.Sign(payload, primary.PrivateKey, protectedHeader, unprotectedHeader,
                                 null, false, true, null, null, true);

        return OkHex(Convert.ToHexString(message.ToByteArray()));

    });

    Checks["verify"] = message is null
                           ? Error("the message could not be built")
                           : Capture(() => Verified(message.Verify(primary.Key, out var error), error));

}


static void RunCoseSign(JsonObject TestCase, JsonObject Checks)
{

    var shape        = TestCase["shape"]!.GetValue<String>();
    var payload      = Convert.FromHexString(TestCase["payload"]!.GetValue<String>());
    var externalAAD  = TestCase["externalAad"] is null
                           ? null
                           : Convert.FromHexString(TestCase["externalAad"]!.GetValue<String>());
    var detached     = TestCase["detached"]?.GetValue<Boolean>() ?? false;
    var tagged       = TestCase["tagged"]?.GetValue<Boolean>()   ?? true;

    var primary      = CoseKeyOf(TestCase, false);

    Checks["thumbprint"] = Capture(() => OkHex(Convert.ToHexString(primary.Key.Thumbprint())));

    switch (shape)
    {

        case "sign1":
        case "sign1-app-algorithm":
        {

            var message = shape == "sign1"
                              ? COSESign1.Sign(payload, primary.PrivateKey, primary.Algorithm,
                                               primary.KeyIdentifier, externalAAD, detached, tagged, null, true)
                              : COSESign1.SignWithApplicationAlgorithm(payload, primary.PrivateKey, primary.Algorithm,
                                               primary.KeyIdentifier, externalAAD, detached, tagged, null, true);

            Checks["toBeSigned"] = Capture(() => OkHex(Convert.ToHexString(
                                       COSESign1.ToBeSigned(message.ProtectedHeaderBytes, message.Payload ?? payload, externalAAD))));
            Checks["signature"]  = Capture(() => OkHex(Convert.ToHexString(message.Signature)));
            Checks["message"]    = Capture(() => OkHex(Convert.ToHexString(message.ToByteArray())));

            break;

        }

        case "sign":
        {

            var second   = CoseKeyOf(TestCase, true);

            var message  = COSESign.Sign(payload, primary.PrivateKey, primary.Algorithm,
                                         primary.KeyIdentifier, externalAAD, detached, tagged, null, true).
                                    AddSignature(second.PrivateKey, second.Algorithm,
                                                 second.KeyIdentifier, externalAAD,
                                                 detached ? payload : null, null, true);

            var signatures = message.Signatures.ToArray();

            Checks["toBeSigned"]  = Capture(() => OkHex(Convert.ToHexString(
                                        message.ToBeSigned(signatures[0], externalAAD, detached ? payload : null))));
            Checks["toBeSigned2"] = Capture(() => OkHex(Convert.ToHexString(
                                        message.ToBeSigned(signatures[1], externalAAD, detached ? payload : null))));
            Checks["signature"]   = Capture(() => OkHex(Convert.ToHexString(signatures[0].Signature)));
            Checks["signature2"]  = Capture(() => OkHex(Convert.ToHexString(signatures[1].Signature)));
            Checks["message"]     = Capture(() => OkHex(Convert.ToHexString(message.ToByteArray())));
            Checks["thumbprint2"] = Capture(() => OkHex(Convert.ToHexString(second.Key.Thumbprint())));

            break;

        }

        case "countersign":
        {

            var second   = CoseKeyOf(TestCase, true);

            var signed   = COSESign1.Sign(payload, primary.PrivateKey, primary.Algorithm,
                                          primary.KeyIdentifier, externalAAD, detached, tagged, null, true);

            var message  = signed.AddCountersignature(second.PrivateKey, second.Algorithm,
                                                      second.KeyIdentifier, externalAAD,
                                                      detached ? payload : null, null, true);

            var countersignature = message.Countersignatures.First();

            Checks["toBeSigned"]  = Capture(() => OkHex(Convert.ToHexString(
                                        COSESign1.ToBeSigned(signed.ProtectedHeaderBytes, signed.Payload ?? payload, externalAAD))));
            Checks["toBeSigned2"] = Capture(() => OkHex(Convert.ToHexString(
                                        message.ToBeCountersigned(countersignature, externalAAD, detached ? payload : null))));
            Checks["signature"]   = Capture(() => OkHex(Convert.ToHexString(message.Signature)));
            Checks["signature2"]  = Capture(() => OkHex(Convert.ToHexString(countersignature.Signature)));
            Checks["message"]     = Capture(() => OkHex(Convert.ToHexString(message.ToByteArray())));
            Checks["thumbprint2"] = Capture(() => OkHex(Convert.ToHexString(second.Key.Thumbprint())));

            break;

        }

        default:
            Checks["message"] = Error($"Unknown COSE shape '{shape}'!");
            break;

    }

}


/// <summary>
/// Verify a message the OTHER implementation produced.
///
/// Everything a case carries has to verify, not merely something: a COSE_Sign
/// verifies only when every one of its signatures does, and a countersigned
/// message only when the body and the vouching both do.
/// </summary>
static void RunCoseVerify(JsonObject TestCase, JsonObject Checks)
{

    Checks["verify"] = Capture(() => {

        var shape            = TestCase["shape"]!.GetValue<String>();
        var payload          = Convert.FromHexString(TestCase["payload"]!.GetValue<String>());
        var externalAAD      = TestCase["externalAad"] is null
                                   ? null
                                   : Convert.FromHexString(TestCase["externalAad"]!.GetValue<String>());
        var detachedPayload  = (TestCase["detached"]?.GetValue<Boolean>() ?? false) ? payload : null;
        var messageBytes     = Convert.FromHexString(TestCase["message"]!.GetValue<String>());

        var primary          = CoseKeyOf(TestCase, false);

        switch (shape)
        {

            case "sign1":
            case "sign1-app-algorithm":
            {
                var parsed = COSESign1.Parse(messageBytes);
                return Verified(parsed.Verify(primary.PublicKey, out var errorResponse,
                                              externalAAD, detachedPayload, primary.Algorithm),
                                errorResponse);
            }

            case "sign":
            {

                var second      = CoseKeyOf(TestCase, true);
                var parsed      = COSESign.Parse(messageBytes);
                var signatures  = parsed.Signatures.ToArray();

                if (signatures.Length != 2)
                    return Verified(false, $"Expected 2 signatures, found {signatures.Length}!");

                var first  = parsed.Verify(signatures[0], primary.PublicKey, out var firstError,
                                           externalAAD, detachedPayload, primary.Algorithm);
                var other  = parsed.Verify(signatures[1], second.PublicKey,  out var otherError,
                                           externalAAD, detachedPayload, second.Algorithm);

                return Verified(first && other,
                                String.Join("; ", new[] { firstError, otherError }.Where(each => each is not null)));

            }

            case "countersign":
            {

                var second            = CoseKeyOf(TestCase, true);
                var parsed            = COSESign1.Parse(messageBytes);
                var countersignatures = parsed.Countersignatures.ToArray();

                if (countersignatures.Length != 1)
                    return Verified(false, $"Expected 1 countersignature, found {countersignatures.Length}!");

                var body     = parsed.Verify(primary.PublicKey, out var bodyError,
                                             externalAAD, detachedPayload, primary.Algorithm);
                var vouched  = parsed.VerifyCountersignature(countersignatures[0], second.PublicKey, out var vouchedError,
                                                             externalAAD, detachedPayload, second.Algorithm);

                return Verified(body && vouched,
                                String.Join("; ", new[] { bodyError, vouchedError }.Where(each => each is not null)));

            }

            default:
                return Error($"Unknown COSE shape '{shape}'!");

        }

    });

}


// ----------------------------- Encrypted and enveloped [RFC 9052 5, 6] --

static COSEKey SymmetricKeyOf(String KeyHex, String? AlgorithmName = null, String? KeyIdentifier = null)
{

    COSEAlgorithm? algorithm = null;

    if (AlgorithmName is not null)
    {

        if (!COSEAlgorithm.TryParse(AlgorithmName, out var parsed))
            throw new Exception($"Unknown COSE algorithm '{AlgorithmName}'!");

        algorithm = parsed;

    }

    return COSEKey.FromSymmetricKey(
               Convert.FromHexString(KeyHex),
               KeyIdentifier is not null ? Convert.FromHexString(KeyIdentifier) : null,
               algorithm
           );

}


// One recipient as a vector describes it. For "direct" and key wrap the key is
// the symmetric key the recipient holds; for ECDH-ES it is the recipient's
// private key on the named curve, and "ephemeral" the sender's private key made
// for the one message, given rather than drawn so that the bytes stay
// comparable.

static Boolean IsECDH(JsonNode? Entry)

    => Entry?["algorithm"]?.GetValue<String>().StartsWith("ECDH-ES") == true;

/// <summary>
/// A private key on the curve a vector names, from its raw private key.
/// </summary>
static COSEKey ECDHKeyOf(String CurveName, String KeyHex, String? KeyIdentifier = null)
{

    var curve = COSECurve.Parse(CurveName);
    var d     = Convert.FromHexString(KeyHex);
    var kid   = KeyIdentifier is not null ? Convert.FromHexString(KeyIdentifier) : null;

    return curve == COSECurve.X25519 ? COSEKey.From(new X25519PrivateKeyParameters(d, 0), kid)
         : curve == COSECurve.X448   ? COSEKey.From(new X448PrivateKeyParameters  (d, 0), kid)
         :                             COSEKey.From(new ECPrivateKeyParameters("ECDH", new BigInteger(1, d), curve.DomainParameters!), kid);

}

static COSEPartyInfo? PartyOf(JsonNode? Party)
{

    if (Party is null)
        return null;

    var nonce = Party["nonce"];

    return new COSEPartyInfo(
               Party["identity"] is not null ? Convert.FromHexString(Party["identity"]!.GetValue<String>()) : null,
               nonce is null                                    ? (CBORValue?) null
             : nonce.GetValueKind() == JsonValueKind.Number     ? CBORValue.FromInt64(nonce.GetValue<Int64>())
             :                                                    CBORValue.FromBytes(Convert.FromHexString(nonce.GetValue<String>())),
               Party["other"]    is not null ? Convert.FromHexString(Party["other"]!.GetValue<String>())    : null
           );

}

static Byte[]? SaltOf(JsonNode Entry)

    => Entry["salt"] is not null ? Convert.FromHexString(Entry["salt"]!.GetValue<String>()) : null;

/// <summary>
/// The certificate an ECDH-ES recipient is named by, as DER: written into the
/// recipient as x5t, and handed to whoever opens the message (EVQI Transport
/// section 6.8). Null when the entry names none.
/// </summary>
static X509Certificate? CertificateOfEntry(JsonNode? Entry)

    => Entry?["certificate"] is not null
           ? new X509CertificateParser().ReadCertificate(Convert.FromHexString(Entry["certificate"]!.GetValue<String>()))
           : null;

static COSECertificateHash? ThumbprintOf(JsonNode Entry)

    => CertificateOfEntry(Entry) is X509Certificate certificate
           ? COSECertificateHash.From(certificate)
           : null;

/// <summary>
/// The recipient's public key and the sender's ephemeral private key of an
/// ECDH-ES entry.
/// </summary>
static (COSEKey Recipient, COSEKey Ephemeral) ECDHPartiesOf(JsonNode Entry)
{

    var recipient = ECDHKeyOf(Entry["curve"]!.GetValue<String>(),
                              Entry["key"]!.GetValue<String>(),
                              Entry["keyIdentifier"]?.GetValue<String>());

    return (COSEKey.From(recipient.ToPublicKey(), recipient.KeyIdentifier),
            ECDHKeyOf(Entry["curve"]!.GetValue<String>(), Entry["ephemeral"]!.GetValue<String>()));

}

/// <summary>
/// The key a party opening the message holds for a recipient entry.
/// </summary>
static COSEKey OpeningKeyOf(JsonNode Entry)

    => IsECDH(Entry)
           ? ECDHKeyOf(Entry["curve"]!.GetValue<String>(), Entry["key"]!.GetValue<String>(), Entry["keyIdentifier"]?.GetValue<String>())
           : SymmetricKeyOf(Entry["key"]!.GetValue<String>());

/// <summary>
/// The content key and the recipients of an enveloped case. With a direct
/// ECDH-ES recipient the content key is not given but agreed, so it comes out
/// of the recipient rather than going into it.
/// </summary>
static (COSEKey ContentKey, List<COSERecipient> Recipients) ContentKeyAndRecipientsOf(JsonObject TestCase)
{

    var first = TestCase["recipients"]?.AsArray().FirstOrDefault();

    if (IsECDH(first) &&
        COSEAlgorithm.Parse(first!["algorithm"]!.GetValue<String>()).Family == COSEAlgorithmFamily.ECDHDirect)
    {

        var (recipient, ephemeral) = ECDHPartiesOf(first);

        var (structure, agreedKey) = COSERecipient.ECDHDirect(recipient,
                                                              ephemeral,
                                                              COSEAlgorithm.Parse(TestCase["algorithm"]!.GetValue<String>()),
                                                              COSEAlgorithm.Parse(first["algorithm"]!.GetValue<String>()),
                                                              SaltOf(first),
                                                              PartyOf(first["partyU"]),
                                                              PartyOf(first["partyV"]),
                                                              CertificateThumbprint: ThumbprintOf(first));

        return (agreedKey, [structure]);

    }

    var contentKey = SymmetricKeyOf(TestCase["key"]!.GetValue<String>(),
                                    TestCase["algorithm"]!.GetValue<String>(),
                                    TestCase["keyIdentifier"]?.GetValue<String>());

    return (contentKey, RecipientsOf(TestCase, contentKey.K!));

}

/// <summary>
/// What an ECDH-ES recipient adds to the record: the raw secret, the encoded
/// COSE_KDF_Context and - for direct agreement - the derived content key.
///
/// The message bytes alone cannot isolate these. COSE_KDF_Context is derived
/// rather than transmitted, so a field built wrongly on both sides opens
/// perfectly, and where it does break it reports an AEAD failure two layers
/// from the cause (FINDINGS §12). The context is encoded by the library's own
/// encoder from what the RFC says goes into it; that the library's derivation
/// puts the same into it is what the derived key and the published bytes
/// establish.
/// </summary>
static void RecordECDH(JsonObject TestCase, COSEKey ContentKey, List<COSERecipient> Recipients, JsonObject Checks)
{

    var first = TestCase["recipients"]?.AsArray().FirstOrDefault();

    if (!IsECDH(first))
        return;

    var algorithm              = COSEAlgorithm.Parse(first!["algorithm"]!.GetValue<String>());
    var direct                 = algorithm.Family == COSEAlgorithmFamily.ECDHDirect;
    var (recipient, ephemeral) = ECDHPartiesOf(first);

    Checks["secret"]     = Capture(() => OkHex(Convert.ToHexString(COSEKeyAgreement.SharedSecret(ephemeral, recipient))));

    Checks["kdfContext"] = Capture(() => OkHex(Convert.ToHexString(COSEKeyAgreement.KDFContext(
                               direct ? COSEAlgorithm.Parse(TestCase["algorithm"]!.GetValue<String>())
                                      : COSEAlgorithm.ForKeyWrap(algorithm.KeySizeInBytes!.Value),
                               direct ? ContentKey.K!.Length : algorithm.KeySizeInBytes!.Value,
                               Recipients[0].ProtectedHeaderBytes,
                               PartyOf(first["partyU"]),
                               PartyOf(first["partyV"])))));

    if (direct)
        Checks["agreedKey"] = Capture(() => OkHex(Convert.ToHexString(ContentKey.K!)));

    if (CertificateOfEntry(first) is X509Certificate certificate)
    {

        // The thumbprint as it went into the message, not as computed beside it.
        Checks["thumbprint"] = Capture(() =>
            Recipients[0].UnprotectedHeader.TryGet(COSEHeaderLabel.X5T, out var written)
                ? OkHex(Convert.ToHexString(written.ToByteArray()))
                : Error("The recipient carries no x5t!"));

        // That the certificate certifies the key the case agrees with: the
        // pairing is a row of its own rather than a comment that might stop
        // being true.
        Checks["certificateKey"] = Capture(() =>
            certificate.GetPublicKey() is ECPublicKeyParameters certified &&
            recipient.ToPublicKey()    is ECPublicKeyParameters agreed    &&
            certified.Q.Equals(agreed.Q)
                ? Verified(true,  null)
                : Verified(false, "The certificate certifies another key!"));

    }

}

static List<COSERecipient> RecipientsOf(JsonObject TestCase, Byte[] ContentKey)
{

    var recipients = new List<COSERecipient>();

    if (TestCase["recipients"] is null)
        return recipients;

    foreach (var entry in TestCase["recipients"]!.AsArray())
    {

        var recipient  = entry!.AsObject();
        var algorithm  = recipient["algorithm"]!.GetValue<String>();

        if (IsECDH(recipient))
        {

            var (theirs, ephemeral) = ECDHPartiesOf(recipient);

            recipients.Add(COSERecipient.ECDHKeyWrap(ContentKey, theirs, ephemeral, COSEAlgorithm.Parse(algorithm),
                                                     SaltOf(recipient), PartyOf(recipient["partyU"]), PartyOf(recipient["partyV"]),
                                                     CertificateThumbprint: ThumbprintOf(recipient)));

            continue;

        }

        var key = SymmetricKeyOf(recipient["key"]!.GetValue<String>(),
                                 null,
                                 recipient["keyIdentifier"]?.GetValue<String>());

        recipients.Add(algorithm == "direct"
                           ? COSERecipient.Direct(key)
                           : COSERecipient.KeyWrap(ContentKey, key));

    }

    return recipients;

}


/// <summary>
/// Encrypt or authenticate one case, recording what the other implementation
/// has to agree with: the structure that was authenticated, the ciphertext or
/// tag, and the whole message.
///
/// Everything is deterministic once the content key and the nonce are given,
/// and the vector gives both - which is the same departure from "default
/// settings" the signing suite makes, and for the same reason.
/// </summary>
static void RunCoseEncrypt(JsonObject TestCase, JsonObject Checks)
{

    var shape        = TestCase["shape"]!.GetValue<String>();
    var payload      = Convert.FromHexString(TestCase["payload"]!.GetValue<String>());
    var externalAAD  = TestCase["externalAad"] is null
                           ? null
                           : Convert.FromHexString(TestCase["externalAad"]!.GetValue<String>());
    var detached     = TestCase["detached"]?.GetValue<Boolean>() ?? false;
    var tagged       = TestCase["tagged"]?.GetValue<Boolean>()   ?? true;

    switch (shape)
    {

        case "encrypt0":
        {

            var contentKey = SymmetricKeyOf(TestCase["key"]!.GetValue<String>(),
                                            TestCase["algorithm"]!.GetValue<String>(),
                                            TestCase["keyIdentifier"]?.GetValue<String>());
            var iv       = Convert.FromHexString(TestCase["iv"]!.GetValue<String>());

            // A case that names a Partial IV or a crit composes both buckets
            // itself, because the encrypt call writes neither: label 6 is one
            // this library can name and does not read, and crit belongs in the
            // protected bucket beside the algorithm. Every other case takes the
            // ordinary path, so its bytes are the ones it always produced.
            var protectedHeader = COSEHeaders.Create(contentKey.Algorithm);

            if (TestCase["crit"] is not null)
                protectedHeader = protectedHeader.Set(
                                      COSEHeaderLabel.Critical,
                                      CBORValue.FromArray(TestCase["crit"]!.AsArray()
                                          .Select(each => CBORValue.FromInt64(each!.GetValue<Int64>()))));

            var unprotectedHeader = new COSEHeaders((COSEHeaderLabel.IV, CBORValue.FromBytes(iv)));

            if (TestCase["partialIv"] is not null)
                unprotectedHeader = unprotectedHeader.Set(
                                        COSEHeaderLabel.PartialIV,
                                        CBORValue.FromBytes(Convert.FromHexString(TestCase["partialIv"]!.GetValue<String>())));

            var message  = TestCase["partialIv"] is null && TestCase["crit"] is null
                               ? COSEEncrypt0.Encrypt(payload, contentKey, iv, externalAAD, detached, tagged)
                               : COSEEncrypt0.Encrypt(payload, contentKey, protectedHeader, unprotectedHeader,
                                                      iv, externalAAD, detached, tagged);

            Checks["toBeEncrypted"] = Capture(() => OkHex(Convert.ToHexString(message.ToBeEncrypted(externalAAD))));
            Checks["ciphertext"]    = Capture(() => OkHex(Convert.ToHexString(
                                          message.Ciphertext
                                              ?? COSEEncrypt0.Encrypt(payload, contentKey, iv, externalAAD).Ciphertext!)));
            Checks["message"]       = Capture(() => OkHex(Convert.ToHexString(message.ToByteArray())));

            break;

        }

        case "encrypt":
        {

            var iv                       = Convert.FromHexString(TestCase["iv"]!.GetValue<String>());
            var (contentKey, recipients) = ContentKeyAndRecipientsOf(TestCase);

            RecordECDH(TestCase, contentKey, recipients, Checks);

            var message     = COSEEncrypt.Encrypt(payload, contentKey, recipients, iv, externalAAD, detached, tagged);

            Checks["toBeEncrypted"] = Capture(() => OkHex(Convert.ToHexString(message.ToBeEncrypted(externalAAD))));
            Checks["ciphertext"]    = Capture(() => OkHex(Convert.ToHexString(message.Ciphertext!)));
            Checks["message"]       = Capture(() => OkHex(Convert.ToHexString(message.ToByteArray())));
            Checks["recipient0"]    = Capture(() => OkHex(Convert.ToHexString(recipients[0].Ciphertext)));

            break;

        }

        case "mac":
        {

            var (contentKey, recipients) = ContentKeyAndRecipientsOf(TestCase);

            RecordECDH(TestCase, contentKey, recipients, Checks);

            var message     = COSEMac.Create(payload, contentKey, recipients, externalAAD, detached, tagged);

            Checks["toBeEncrypted"] = Capture(() => OkHex(Convert.ToHexString(
                                          COSEMac.ToBeMACed(message.ProtectedHeaderBytes, payload, externalAAD))));
            Checks["ciphertext"]    = Capture(() => OkHex(Convert.ToHexString(message.Tag)));
            Checks["message"]       = Capture(() => OkHex(Convert.ToHexString(message.ToByteArray())));
            Checks["recipient0"]    = Capture(() => OkHex(Convert.ToHexString(recipients[0].Ciphertext)));

            break;

        }

        default:
            Checks["message"] = Error($"Unknown COSE shape '{shape}'!");
            break;

    }

}


/// <summary>
/// Open a message the OTHER implementation produced.
///
/// Where the recipient is named by a certificate, the message is opened
/// twice: once given that certificate, which lets the library pass over
/// recipients naming another (EVQI Transport section 6.8), and once without,
/// which must change nothing for a caller who names none.
/// </summary>
static void RunCoseDecrypt(JsonObject TestCase, JsonObject Checks)
{

    var certificate = CertificateOfEntry(TestCase["recipients"]?.AsArray().FirstOrDefault());

    Checks["open"] = Capture(() => OpenCoseMessage(TestCase, certificate));

    if (certificate is not null)
        Checks["openWithoutCertificate"] = Capture(() => OpenCoseMessage(TestCase, null));

}

static JsonObject OpenCoseMessage(JsonObject TestCase, X509Certificate? RecipientCertificate)
{

    var shape        = TestCase["shape"]!.GetValue<String>();
    var bytes        = Convert.FromHexString(TestCase["message"]!.GetValue<String>());
    var payload      = Convert.FromHexString(TestCase["payload"]!.GetValue<String>());
    var externalAAD  = TestCase["externalAad"] is null
                           ? null
                           : Convert.FromHexString(TestCase["externalAad"]!.GetValue<String>());

    var detachedCiphertext = (TestCase["detached"]?.GetValue<Boolean>() ?? false)
                                 ? Convert.FromHexString(TestCase["detachedCiphertext"]!.GetValue<String>())
                                 : null;

    // Whoever opens the message holds a recipient key, or - for the bare
    // form - the content key itself.
    var recipientKey = TestCase["recipients"] is not null && TestCase["recipients"]!.AsArray().Count > 0
                           ? OpeningKeyOf(TestCase["recipients"]![0]!)
                           : SymmetricKeyOf(TestCase["key"]!.GetValue<String>(), TestCase["algorithm"]!.GetValue<String>());

    if (shape == "mac")
    {

        if (!COSEMac.TryParse(bytes, out var mac, out var macParseError))
            return Error($"The COSE_Mac message could not be read: {macParseError}");

        return Verified(mac.Verify(recipientKey, out var macError, externalAAD,
                                   RecipientCertificate: RecipientCertificate), macError);

    }

    Byte[]? plaintext;
    String? errorResponse;

    if (shape == "encrypt0")
    {

        if (!COSEEncrypt0.TryParse(bytes, out var encrypt0, out var parseError))
            return Error($"The COSE_Encrypt0 message could not be read: {parseError}");

        var key = SymmetricKeyOf(TestCase["key"]!.GetValue<String>(), TestCase["algorithm"]!.GetValue<String>());

        encrypt0.Decrypt(key, out plaintext, out errorResponse, externalAAD, detachedCiphertext);

    }

    else
    {

        if (!COSEEncrypt.TryParse(bytes, out var encrypt, out var parseError))
            return Error($"The COSE_Encrypt message could not be read: {parseError}");

        encrypt.Decrypt(recipientKey, out plaintext, out errorResponse, externalAAD, detachedCiphertext,
                        RecipientCertificate: RecipientCertificate);

    }

    if (plaintext is null)
        return Verified(false, errorResponse);

    // Decrypting is only half of it: the plaintext has to be the payload
    // the vector names, or the two implementations agree about nothing.
    return plaintext.SequenceEqual(payload)
               ? Verified(true, null)
               : Verified(false, $"decrypted to {Convert.ToHexString(plaintext)} rather than to the expected payload");

}


// ------------------------------------------- COSE_Mac0 [RFC 9052 6.2] --

static COSEKey Mac0KeyOf(JsonObject TestCase)
{

    var algorithmName = TestCase["algorithm"]!.GetValue<String>();

    if (!COSEAlgorithm.TryParse(algorithmName, out var algorithm))
        throw new Exception($"Unknown COSE algorithm '{algorithmName}'!");

    return COSEKey.FromSymmetricKey(
               Convert.FromHexString(TestCase["key"]!.GetValue<String>()),
               TestCase["keyIdentifier"] is null
                   ? null
                   : Convert.FromHexString(TestCase["keyIdentifier"]!.GetValue<String>()),
               algorithm
           );

}


/// <summary>
/// Authenticate one case, recording what the other implementation has to
/// agree with: the MAC_structure, the tag, the whole message and the key
/// thumbprint.
///
/// Nothing has to be arranged for the bytes to be comparable. A MAC is
/// deterministic by construction - there is no nonce to draw and nothing to
/// derive - so a tag that differs means the two implementations disagree
/// about the structure, the truncation or the primitive, and nothing else.
/// </summary>
static void RunCoseMac0(JsonObject TestCase, JsonObject Checks)
{

    var key          = Mac0KeyOf(TestCase);
    var payload      = Convert.FromHexString(TestCase["payload"]!.GetValue<String>());
    var externalAAD  = TestCase["externalAad"] is null
                           ? null
                           : Convert.FromHexString(TestCase["externalAad"]!.GetValue<String>());
    var detached     = TestCase["detached"]?.GetValue<Boolean>() ?? false;
    var tagged       = TestCase["tagged"]?.GetValue<Boolean>()   ?? true;

    var message      = COSEMac0.Create(payload, key, externalAAD, detached, tagged);

    Checks["toBeMaced"]  = Capture(() => OkHex(Convert.ToHexString(
                               COSEMac0.ToBeMACed(message.ProtectedHeaderBytes, payload, externalAAD))));
    Checks["tag"]        = Capture(() => OkHex(Convert.ToHexString(message.Tag)));
    Checks["message"]    = Capture(() => OkHex(Convert.ToHexString(message.ToByteArray())));

    // The thumbprint of a symmetric key covers kty and k and nothing else
    // [RFC 9679, Section 4.4] - notably not the algorithm, unlike an
    // algorithm key pair.
    Checks["thumbprint"] = Capture(() => OkHex(Convert.ToHexString(key.Thumbprint())));

}


/// <summary>
/// Verify a COSE_Mac0 message the OTHER implementation produced.
/// </summary>
static void RunCoseMac0Verify(JsonObject TestCase, JsonObject Checks)
{

    Checks["verify"] = Capture(() => {

        var key          = Mac0KeyOf(TestCase);
        var externalAAD  = TestCase["externalAad"] is null
                               ? null
                               : Convert.FromHexString(TestCase["externalAad"]!.GetValue<String>());

        var detached     = (TestCase["detached"]?.GetValue<Boolean>() ?? false)
                               ? Convert.FromHexString(TestCase["payload"]!.GetValue<String>())
                               : null;

        if (!COSEMac0.TryParse(Convert.FromHexString(TestCase["message"]!.GetValue<String>()),
                               out var parsed, out var parseError))
            return Error($"The COSE_Mac0 message could not be read: {parseError}");

        return Verified(parsed.Verify(key, out var errorResponse, externalAAD, detached),
                        errorResponse);

    });

}


// --------------------------------------------------- X.509 [RFC 9360] --

static X509Certificate CertificateOf(JsonObject Corpus, String Name)
{

    var encoded = Corpus["certificates"]?[Name]?.GetValue<String>()
                      ?? throw new Exception($"The certificate corpus holds no certificate '{Name}'!");

    return new X509CertificateParser().ReadCertificate(Convert.FromHexString(encoded));

}


static (AsymmetricKeyParameter PrivateKey, COSEAlgorithm Algorithm) CorpusKeyOf(JsonObject Corpus, String Name)
{

    var entry = Corpus["privateKeys"]?[Name]?.AsObject()
                    ?? throw new Exception($"The certificate corpus holds no private key for '{Name}'!");

    // The same shape the cose-sign vectors use, so that one helper reads both.
    var wrapped = new JsonObject {
                      ["algorithm"] = entry["algorithm"]!.GetValue<String>(),
                      ["keyD"]      = entry["keyD"]!.GetValue<String>()
                  };

    if (entry["curve"] is not null)
        wrapped["curve"] = entry["curve"]!.GetValue<String>();

    var key = CoseKeyOf(wrapped, false);

    return (key.PrivateKey, key.Algorithm);

}


static DateTimeOffset ValidateAt(JsonObject Corpus)

    => DateTimeOffset.Parse(Corpus["validateAt"]!.GetValue<String>(),
                            null,
                            System.Globalization.DateTimeStyles.AdjustToUniversal |
                            System.Globalization.DateTimeStyles.AssumeUniversal);


/// <summary>
/// Sign a message carrying a certificate chain, and record what the other
/// implementation has to agree with: the message, the end-entity
/// certificate's thumbprint and subject, and the verdict on the chain.
///
/// The chain goes into the PROTECTED bucket, which is not a formality: an
/// unprotected one can be swapped for another without disturbing the
/// signature, and a verifier that then reported the new subject as the signer
/// would have been told who signed by somebody who did not.
/// </summary>
static void RunCoseX509(JsonObject TestCase, JsonObject Checks, JsonObject Corpus)
{

    var at        = ValidateAt(Corpus);
    var signer    = CorpusKeyOf(Corpus, TestCase["signer"]!.GetValue<String>());
    var payload   = Convert.FromHexString(TestCase["payload"]!.GetValue<String>());

    var chain     = new COSECertificateChain(
                        TestCase["chain"]!.AsArray().
                            Select(each => CertificateOf(Corpus, each!.GetValue<String>()))
                    );

    var anchors   = TestCase["trustAnchors"]!.AsArray().
                        Select(each => CertificateOf(Corpus, each!.GetValue<String>())).
                        ToArray();

    var parameters = new List<(CBORValue, CBORValue)> {
                         (COSEHeaderLabel.Algorithm, signer.Algorithm.ToCBOR())
                     };

    if (TestCase["critical"]?.GetValue<Boolean>() == true)
        parameters.Add((COSEHeaderLabel.Critical, CBORValue.FromArray(COSEHeaderLabel.X5Chain)));

    parameters.Add((COSEHeaderLabel.X5Chain, chain.ToCBOR()));

    // The hash the thumbprint is taken with, where the case names one. RFC 9360
    // leaves the choice to the sender, so a reader that assumes SHA-256 computes
    // a digest of the wrong width and refuses a sound message - which is what
    // the SHA-384 and SHA-512 cases measure.
    var thumbprintAlgorithm = TestCase["thumbprintAlgorithm"] is not null
                                  ? new COSEAlgorithm(TestCase["thumbprintAlgorithm"]!.GetValue<Int32>())
                                  : (COSEAlgorithm?) null;

    if (TestCase["thumbprintOf"] is not null)
        parameters.Add((COSEHeaderLabel.X5T,
                        COSECertificateHash.From(CertificateOf(Corpus, TestCase["thumbprintOf"]!.GetValue<String>()),
                                                 thumbprintAlgorithm).ToCBOR()));

    var message = COSESign1.Sign(payload,
                                 signer.PrivateKey,
                                 new COSEHeaders([.. parameters]),
                                 null, null, false, true, null, null, true);

    Checks["message"]    = Capture(() => OkHex (Convert.ToHexString(message.ToByteArray())));
    Checks["thumbprint"] = Capture(() => OkHex (Convert.ToHexString(COSECertificateHash.From(chain.EndEntity, thumbprintAlgorithm).Value)));
    Checks["subject"]    = Capture(() => OkText(chain.EndEntity.SubjectDN.ToString()));

    Checks["validate"]   = Capture(() => ValidateChain(message.ToByteArray(), anchors, at));

}


/// <summary>
/// Validate a chained message the OTHER implementation produced.
/// </summary>
static void RunCoseX509Validate(JsonObject TestCase, JsonObject Checks, JsonObject Corpus)
{

    Checks["validate"] = Capture(() => {

        var anchors = TestCase["trustAnchors"]!.AsArray().
                          Select(each => CertificateOf(Corpus, each!.GetValue<String>())).
                          ToArray();

        return ValidateChain(Convert.FromHexString(TestCase["message"]!.GetValue<String>()),
                             anchors,
                             ValidateAt(Corpus));

    });

}


static JsonObject ValidateChain(Byte[] Message, X509Certificate[] TrustAnchors, DateTimeOffset At)
{

    if (!COSESign1.TryParse(Message, out var parsed, out var parseError))
        return Error($"The COSE_Sign1 message could not be read: {parseError}");

    return parsed.VerifyWithCertificateChain(TrustAnchors,
                                             out var signer,
                                             out var errorResponse,
                                             null,
                                             null,
                                             null,
                                             At)

               ? new JsonObject { ["status"] = "ok", ["verified"] = true,
                                  ["text"] = signer.SubjectDN.ToString() }

               : new JsonObject { ["status"] = "ok", ["verified"] = false,
                                  ["reason"] = errorResponse ?? "" };

}


static JsonObject Verified(Boolean Ok, String? Reason)

    => Ok
           ? new JsonObject { ["status"] = "ok", ["verified"] = true  }
           : new JsonObject { ["status"] = "ok", ["verified"] = false, ["reason"] = Reason ?? "" };


// ------------------------------------------------------------- primitives --

/// <summary>
/// Read a metrological value from its encoded bytes.
///
/// Through MetrologicalValue.TryParse(bytes, ...), which reads the STRICT
/// decoder profile of specification Section 6 by default - the same profile
/// the TypeScript decode() reads by default, which is what makes the two
/// columns of this suite comparable at all. Going through CBORValue.TryParse
/// first, as this did until the profile existed, reads leniently: the
/// byte-level facts are normalized away before the metrological layer is
/// asked anything, and the two implementations then disagree about inputs
/// neither of them is wrong about.
///
/// The lenient profile is not untested by that. RunCBORRobustness above asks
/// the generic reader directly and deliberately with default options, which
/// is where "what does a caller who asked for nothing in particular get"
/// belongs.
/// </summary>
static Boolean TryDecodeValue(String Hex, out MetrologicalValue Value, out String? ErrorResponse)
{

    Value = default;

    Byte[] bytes;
    try
    {
        bytes = Convert.FromHexString(Hex);
    }
    catch (Exception e)
    {
        ErrorResponse = $"Invalid hex in vector: {e.Message}";
        return false;
    }

    try
    {

        if (!MetrologicalValue.TryParse(bytes, out Value, out var valueError))
        {
            ErrorResponse = valueError;
            return false;
        }

        ErrorResponse = null;
        return true;

    }
    catch (Exception e)
    {
        ErrorResponse = e.Message;
        return false;
    }

}


static String EncodeCanonical(MetrologicalValue Value)

    => Convert.ToHexString(
           Value.ToCBOR().ToByteArray(CBORWriterOptions.Canonical)
       );


static JsonObject ParseTextToHex(String Text)
{

    try
    {

        if (!MetrologicalValue.TryParse(Text, out var value, out var errorResponse))
            return Error(errorResponse);

        return OkHex(EncodeCanonical(value));

    }
    catch (Exception e)
    {
        return Error(e.Message);
    }

}


/// <summary>
/// Convert a JSON document back into CBOR.
///
/// `Readings = Auto` explicitly, because that is what is being compared:
/// metrological-text.md Section 3 says a string that reads as a reading
/// converts back into one, and neither library guesses that unless asked.
/// Leaving the default here would compare one implementation declining to
/// perform the conversion against the other declining to perform it, which
/// is agreement about nothing.
/// </summary>
static JsonObject JsonToCborHex(String JsonText)
{

    try
    {
        return OkHex(
            Convert.ToHexString(
                CBORJSON.ToCBOR(JsonText, new CBORJSONOptions { Readings = CBORJSONReadings.Auto }).
                         ToByteArray(CBORWriterOptions.Canonical)
            )
        );
    }
    catch (Exception e)
    {
        return Error(e.Message);
    }

}


// ---------------------------------------------------------------- helpers --

static JsonObject Ok()
    => new () { ["status"] = "ok" };

static JsonObject OkHex(String Hex)
    => new () { ["status"] = "ok", ["hex"] = Hex };

static JsonObject OkText(String Text)
    => new () { ["status"] = "ok", ["text"] = Text };

static JsonObject Error(String Message)
    => new () { ["status"] = "error", ["message"] = Message };

static JsonObject Capture(Func<JsonObject> Action)
{
    try
    {
        return Action();
    }
    catch (Exception e)
    {
        return Error(e.Message);
    }
}
