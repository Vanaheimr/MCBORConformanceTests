/*
 * A third reader for the certificates of vectors/cose-x509-messages.json, and
 * for one question about them: is each certificate in a message a single DER
 * encoding of something, or is it not?
 *
 *     dotnet run --project tools/DerArbiter -c Release -- <output.json> <vectors.json>
 *
 * Why a third one. FINDINGS.md §25 measured four encodings that are not DER
 * against both implementations under test and decided to record, rather than
 * require, what each of them does with such a certificate. That catches a
 * disagreement between the two — the divergence pass does, whatever class a row
 * carries — and it does not catch the two of them going lenient together, which
 * §25 says in those words. Neither of them can close that gap: COSE.TS reads
 * certificate DER with a reader of its own and Styx reads it with Bouncy
 * Castle, so a third answer has to come from outside both.
 *
 * It comes from System.Formats.Asn1, which is Microsoft's ASN.1 reader, ships
 * with the framework and belongs to neither project. `AsnEncodingRules.DER`
 * refuses an indefinite length and a length that is not written in the fewest
 * octets that hold it. That a record has to be one TLV and nothing after it is
 * checked here, in NotDer below — the same question COSE.TS's
 * `DerReader.expectEnd` asks, and not the same code answering it.
 *
 * Nothing else is checked. Not the signature, not the validity dates, not the
 * chain, not whether the structure is an X.509 certificate at all: a reader
 * that judged those would be a third implementation of this suite rather than a
 * third opinion about an encoding.
 *
 * The CBOR walk that finds the certificates is this tool's own and deliberately
 * minimal, because CBOR is not what it answers about. A tool that walked a
 * message wrongly could not produce the expected count and the expected verdict
 * on the untampered controls, and compare/run.mjs holds it to both for every
 * case in the file.
 */

using System.Formats.Asn1;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;


if (args.Length < 2)
{
    Console.Error.WriteLine("usage: DerArbiter <output.json> <vectors.json> [<vectors.json> ...]");
    return 1;
}

var outputFile = args[0];
var results    = new JsonObject();

foreach (var vectorFile in args[1..])
{

    var suite = JsonNode.Parse(File.ReadAllText(vectorFile))!.AsObject();
    var name  = suite["suite"]!.GetValue<String>();

    foreach (var entry in suite["cases"]!.AsArray())
    {

        var testCase = entry!.AsObject();
        var id       = testCase["id"]!.GetValue<String>();
        var checks   = new JsonObject();

        try
        {

            var certificates = CertificatesIn(Convert.FromHexString(testCase["message"]!.GetValue<String>()));
            var complaints   = new List<String>();

            foreach (var (label, position, bytes) in certificates)
                if (NotDer(bytes) is String why)
                    complaints.Add($"the certificate at position {position} of the {LabelName(label)}: {why}");

            checks["der"] = new JsonObject {
                                ["status"]       = "ok",
                                // Vacuously true for a message that carries no
                                // certificate at all: the count below is what
                                // says so, and the case has to claim it.
                                ["verified"]     = complaints.Count == 0,
                                ["certificates"] = certificates.Count,
                                ["reason"]       = String.Join("; ", complaints)
                            };

        }
        catch (Exception e)
        {
            checks["der"] = new JsonObject { ["status"] = "error", ["error"] = e.Message };
        }

        results[$"{name}:{id}"] = checks;

    }

}

var document = new JsonObject {
    ["runner"]         = "arbiter",
    ["implementation"] = "System.Formats.Asn1, AsnEncodingRules.DER",
    ["version"]        = typeof(AsnReader).Assembly.GetName().Version?.ToString() ?? "unknown",
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

Console.WriteLine($"der arbiter: {results.Count} cases -> {outputFile}");
return 0;


// ------------------------------------------------------------------- the DER --

/// <summary>
/// Why this record is not DER, or null when it is.
/// </summary>
static String? NotDer(Byte[] record)
{
    try
    {

        AsnDecoder.ReadEncodedValue(record,
                                    AsnEncodingRules.DER,
                                    out var contentOffset,
                                    out var contentLength,
                                    out var consumed);

        if (consumed != record.Length)
            return $"{record.Length - consumed} octets follow the structure";

        Walk(record.AsSpan(contentOffset, contentLength));

        return null;

    }
    catch (AsnContentException e)
    {
        return e.Message;
    }
}

/// <summary>
/// Every length inside a constructed value, down to the primitives.
///
/// The outer header alone would miss a length that is not DER further in: the
/// `signatureAlgorithm` of a certificate whose own outer length is minimal, for
/// instance. Primitive contents are not descended into, which is what makes
/// this a question about the certificate's encoding rather than about what its
/// BIT STRINGs happen to wrap.
/// </summary>
static void Walk(ReadOnlySpan<Byte> contents)
{

    var at = 0;

    while (at < contents.Length)
    {

        var tag = Asn1Tag.Decode(contents[at..], out _);

        AsnDecoder.ReadEncodedValue(contents[at..],
                                    AsnEncodingRules.DER,
                                    out var contentOffset,
                                    out var contentLength,
                                    out var consumed);

        if (tag.IsConstructed)
            Walk(contents.Slice(at + contentOffset, contentLength));

        at += consumed;

    }

}


// ------------------------------------------------------------------ the CBOR --

/// <summary>
/// The certificates a COSE_Sign1 carries in its protected bucket, as they lie
/// in the message: the x5bag (label 32) first, then the x5chain (33), each in
/// the order it was written.
/// </summary>
static List<(Int32 Label, Int32 Position, Byte[] Bytes)> CertificatesIn(Byte[] message)
{

    if (message.Length < 3 || message[0] != 0xD2 || message[1] != 0x84)
        throw new Exception("not a tagged COSE_Sign1 of four elements");

    var bucket = Head(message, 2);

    if (bucket.Major != 2)
        throw new Exception("the protected bucket is not a byte string");

    var header  = message[bucket.Next..(bucket.Next + (Int32) bucket.Value)];
    var headers = Headers(header);
    var found   = new List<(Int32, Int32, Byte[])>();

    foreach (var label in new[] { 32, 33 })
    {

        if (!headers.TryGetValue(label, out var at))
            continue;

        var value = Head(header, at);

        // COSE_X509 is one certificate as a byte string, or two and more as an
        // array of them [RFC 9360, Section 2]. Both forms appear in this file.
        if (value.Major == 2)
            found.Add((label, 0, header[value.Next..(value.Next + (Int32) value.Value)]));

        else if (value.Major == 4)
        {
            var item = value.Next;
            for (var position = 0; position < value.Value; position++)
            {
                var certificate = Head(header, item);
                if (certificate.Major != 2)
                    throw new Exception($"an entry of the header with label {label} is not a byte string");
                found.Add((label, position, header[certificate.Next..(certificate.Next + (Int32) certificate.Value)]));
                item = certificate.Next + (Int32) certificate.Value;
            }
        }

        else
            throw new Exception($"the header with label {label} is neither a byte string nor an array of them");

    }

    return found;

}

/// <summary>Where each header parameter's value begins, by label.</summary>
static Dictionary<Int64, Int32> Headers(Byte[] bucket)
{

    var map = Head(bucket, 0);

    if (map.Major != 5)
        throw new Exception("the protected bucket does not hold a map");

    var headers = new Dictionary<Int64, Int32>();
    var at      = map.Next;

    for (var entry = 0; entry < map.Value; entry++)
    {

        var key = Head(bucket, at);

        if (key.Major > 1)
            throw new Exception("a header parameter label that is not an integer is not one these vectors use");

        headers[key.Major == 1 ? -1 - key.Value : key.Value] = key.Next;

        at = Skip(bucket, key.Next);

    }

    return headers;

}

/// <summary>One CBOR head, for the shapes these vectors use.</summary>
static (Int32 Major, Int64 Value, Int32 Next) Head(Byte[] data, Int32 at)
{

    var major = data[at] >> 5;
    var info  = data[at] & 31;

    if (info < 24)
        return (major, info, at + 1);

    if (info == 24)
        return (major, data[at + 1], at + 2);

    if (info == 25)
        return (major, (data[at + 1] << 8) | data[at + 2], at + 3);

    throw new Exception($"a CBOR head with additional information {info} is not one these vectors use");

}

/// <summary>Where the item at <paramref name="at"/> ends.</summary>
static Int32 Skip(Byte[] data, Int32 at)
{

    var item = Head(data, at);

    switch (item.Major)
    {

        case 0:
        case 1:
            return item.Next;

        case 2:
        case 3:
            return item.Next + (Int32) item.Value;

        case 4:
        case 5:
        {
            var position = item.Next;
            for (var n = 0; n < item.Value * (item.Major == 5 ? 2 : 1); n++)
                position = Skip(data, position);
            return position;
        }

        default:
            throw new Exception($"CBOR major type {item.Major} is not one these vectors use");

    }

}

static String LabelName(Int32 Label)

    => Label switch {
           32 => "x5bag",
           33 => "x5chain",
           _  => $"header with label {Label}"
       };
