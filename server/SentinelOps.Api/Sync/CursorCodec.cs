using System.Text;
using System.Text.Json;
using System.Security.Cryptography;

namespace SentinelOps.Api.Sync;

public sealed record SyncCursor(Guid BusinessId, long Sequence);

public static class CursorCodec
{
    public static string Encode(SyncCursor cursor, string signingKey)
    {
        var json = JsonSerializer.Serialize(cursor);
        var payload = Convert.ToBase64String(Encoding.UTF8.GetBytes(json))
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');
        return $"{payload}.{Sign(payload, signingKey)}";
    }

    public static bool TryDecode(string? encoded, string signingKey, out SyncCursor? cursor)
    {
        cursor = null;
        if (string.IsNullOrWhiteSpace(encoded))
        {
            return false;
        }

        try
        {
            var parts = encoded.Split('.', 2);
            if (parts.Length != 2 || !CryptographicOperations.FixedTimeEquals(
                    Encoding.UTF8.GetBytes(parts[1]),
                    Encoding.UTF8.GetBytes(Sign(parts[0], signingKey))))
                return false;

            var padded = parts[0].Replace('-', '+').Replace('_', '/');
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

    private static string Sign(string payload, string signingKey) =>
        Convert.ToBase64String(HMACSHA256.HashData(
            Encoding.UTF8.GetBytes(signingKey), Encoding.UTF8.GetBytes(payload)))
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');
}