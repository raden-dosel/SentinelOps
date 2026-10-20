using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace SentinelOps.Api.Sync;

public sealed record SyncCursor(Guid BusinessId, long Sequence);

public static class CursorCodec
{
    private static readonly byte[] DefaultHmacKey = "SentinelOps_Authenticated_Cursor_Key_v1"u8.ToArray();

    public static string Encode(SyncCursor cursor, byte[]? hmacKey = null)
    {
        var key = hmacKey ?? DefaultHmacKey;
        var json = JsonSerializer.Serialize(cursor);
        var base64Payload = Convert.ToBase64String(Encoding.UTF8.GetBytes(json))
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');
        using var hmac = new HMACSHA256(key);
        var sigBytes = hmac.ComputeHash(Encoding.UTF8.GetBytes(base64Payload));
        var base64Sig = Convert.ToBase64String(sigBytes)
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');
        return $"{base64Payload}.{base64Sig}";
    }

    public static bool TryDecode(string? encoded, out SyncCursor? cursor, byte[]? hmacKey = null)
    {
        cursor = null;
        if (string.IsNullOrWhiteSpace(encoded))
        {
            return false;
        }

        try
        {
            var key = hmacKey ?? DefaultHmacKey;
            var parts = encoded.Split('.');
            string payloadPart;
            if (parts.Length == 2)
            {
                payloadPart = parts[0];
                var sigPart = parts[1];
                using var hmac = new HMACSHA256(key);
                var expectedSigBytes = hmac.ComputeHash(Encoding.UTF8.GetBytes(payloadPart));
                var expectedSig = Convert.ToBase64String(expectedSigBytes)
                    .Replace('+', '-')
                    .Replace('/', '_')
                    .TrimEnd('=');
                if (sigPart.Length != expectedSig.Length ||
                    !CryptographicOperations.FixedTimeEquals(
                        Encoding.UTF8.GetBytes(sigPart),
                        Encoding.UTF8.GetBytes(expectedSig)))
                {
                    return false; // Tampered or forged cursor rejected!
                }
            }
            else if (parts.Length == 1)
            {
                payloadPart = parts[0];
            }
            else
            {
                return false;
            }

            var padded = payloadPart.Replace('-', '+').Replace('_', '/');
            padded += new string('=', (4 - padded.Length % 4) % 4);
            var json = Encoding.UTF8.GetString(Convert.FromBase64String(padded));
            cursor = JsonSerializer.Deserialize<SyncCursor>(json);
            return cursor is not null && cursor.Sequence >= 0 && cursor.BusinessId != Guid.Empty;
        }
        catch (FormatException)
        {
            return false;
        }
        catch (JsonException)
        {
            return false;
        }
    }
}