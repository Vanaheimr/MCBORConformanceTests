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

foreach (var vectorFile in vectorFiles)
{

    var root = JsonNode.Parse(File.ReadAllText(vectorFile, Encoding.UTF8))!.AsObject();

    if (root["suite"] is null || root["cases"] is null)
        continue;

    var suite = root["suite"]!.GetValue<String>();

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
                case "documents":      RunDocuments    (testCase, checks); break;
                case "json-to-cbor":   RunJsonToCbor   (testCase, checks); break;
                case "parse-texts":    RunParseTexts   (testCase, checks); break;
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
