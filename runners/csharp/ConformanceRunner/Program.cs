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
                case "documents":      RunDocuments    (testCase, checks); break;
                case "json-to-cbor":   RunJsonToCbor   (testCase, checks); break;
                case "parse-texts":    RunParseTexts   (testCase, checks); break;
                case "cose-sign":      RunCoseSign     (testCase, checks); break;
                case "cose-crit":      RunCOSECrit     (testCase, checks); break;
                case "cose-verify":    RunCoseVerify   (testCase, checks); break;

                case "cose-encrypt":     RunCoseEncrypt   (testCase, checks); break;
                case "cose-decrypt":     RunCoseDecrypt   (testCase, checks); break;
                case "cose-mac0":        RunCoseMac0      (testCase, checks); break;
                case "cose-mac0-verify": RunCoseMac0Verify(testCase, checks); break;

                case "cose-x509":
                    RunCoseX509(testCase, checks,
                                corpus ?? throw new Exception("No certificate corpus was found beside the vector file!"));
                    break;

                case "cose-x509-validate":
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
                                       COSESign1.ToBeSigned(message.ProtectedHeaderBytes, payload, externalAAD))));
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
                                        COSESign1.ToBeSigned(signed.ProtectedHeaderBytes, payload, externalAAD))));
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


static List<COSERecipient> RecipientsOf(JsonObject TestCase, Byte[] ContentKey)
{

    var recipients = new List<COSERecipient>();

    if (TestCase["recipients"] is null)
        return recipients;

    foreach (var entry in TestCase["recipients"]!.AsArray())
    {

        var recipient  = entry!.AsObject();
        var algorithm  = recipient["algorithm"]!.GetValue<String>();

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
    var contentKey   = SymmetricKeyOf(TestCase["key"]!.GetValue<String>(),
                                      TestCase["algorithm"]!.GetValue<String>(),
                                      TestCase["keyIdentifier"]?.GetValue<String>());

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

            var iv       = Convert.FromHexString(TestCase["iv"]!.GetValue<String>());
            var message  = COSEEncrypt0.Encrypt(payload, contentKey, iv, externalAAD, detached, tagged);

            Checks["toBeEncrypted"] = Capture(() => OkHex(Convert.ToHexString(message.ToBeEncrypted(externalAAD))));
            Checks["ciphertext"]    = Capture(() => OkHex(Convert.ToHexString(
                                          message.Ciphertext
                                              ?? COSEEncrypt0.Encrypt(payload, contentKey, iv, externalAAD).Ciphertext!)));
            Checks["message"]       = Capture(() => OkHex(Convert.ToHexString(message.ToByteArray())));

            break;

        }

        case "encrypt":
        {

            var iv          = Convert.FromHexString(TestCase["iv"]!.GetValue<String>());
            var recipients  = RecipientsOf(TestCase, contentKey.K!);
            var message     = COSEEncrypt.Encrypt(payload, contentKey, recipients, iv, externalAAD, detached, tagged);

            Checks["toBeEncrypted"] = Capture(() => OkHex(Convert.ToHexString(message.ToBeEncrypted(externalAAD))));
            Checks["ciphertext"]    = Capture(() => OkHex(Convert.ToHexString(message.Ciphertext!)));
            Checks["message"]       = Capture(() => OkHex(Convert.ToHexString(message.ToByteArray())));
            Checks["recipient0"]    = Capture(() => OkHex(Convert.ToHexString(recipients[0].Ciphertext)));

            break;

        }

        case "mac":
        {

            var recipients  = RecipientsOf(TestCase, contentKey.K!);
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
/// </summary>
static void RunCoseDecrypt(JsonObject TestCase, JsonObject Checks)
{

    Checks["open"] = Capture(() => {

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
                               ? SymmetricKeyOf(TestCase["recipients"]![0]!["key"]!.GetValue<String>())
                               : SymmetricKeyOf(TestCase["key"]!.GetValue<String>(), TestCase["algorithm"]!.GetValue<String>());

        if (shape == "mac")
        {

            if (!COSEMac.TryParse(bytes, out var mac, out var macParseError))
                return Error($"The COSE_Mac message could not be read: {macParseError}");

            return Verified(mac.Verify(recipientKey, out var macError, externalAAD), macError);

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

            encrypt.Decrypt(recipientKey, out plaintext, out errorResponse, externalAAD, detachedCiphertext);

        }

        if (plaintext is null)
            return Verified(false, errorResponse);

        // Decrypting is only half of it: the plaintext has to be the payload
        // the vector names, or the two implementations agree about nothing.
        return plaintext.SequenceEqual(payload)
                   ? Verified(true, null)
                   : Verified(false, $"decrypted to {Convert.ToHexString(plaintext)} rather than to the expected payload");

    });

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

    if (TestCase["thumbprintOf"] is not null)
        parameters.Add((COSEHeaderLabel.X5T,
                        COSECertificateHash.From(CertificateOf(Corpus, TestCase["thumbprintOf"]!.GetValue<String>())).ToCBOR()));

    var message = COSESign1.Sign(payload,
                                 signer.PrivateKey,
                                 new COSEHeaders([.. parameters]),
                                 null, null, false, true, null, null, true);

    Checks["message"]    = Capture(() => OkHex (Convert.ToHexString(message.ToByteArray())));
    Checks["thumbprint"] = Capture(() => OkHex (Convert.ToHexString(COSECertificateHash.From(chain.EndEntity).Value)));
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

        if (!CBORValue.TryParse(bytes, out var cbor, out var cborError))
        {
            ErrorResponse = $"CBOR: {cborError}";
            return false;
        }

        if (!MetrologicalValue.TryParse(cbor, out Value, out var valueError))
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


static JsonObject JsonToCborHex(String JsonText)
{

    try
    {
        return OkHex(
            Convert.ToHexString(
                CBORJSON.ToCBOR(JsonText).ToByteArray(CBORWriterOptions.Canonical)
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
