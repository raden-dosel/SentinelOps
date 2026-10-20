using System.Text;
using System.Text.Json;

namespace SentinelOps.Api.Sync;

public sealed record SyncCursor(Guid BusinessId, long Sequence);

public static class CursorCodec
{
    public static string Encode(SyncCursor cursor)
    {
        var json = JsonSerializer.Serialize(cursor);
        return Convert.ToBase64String(Encoding.UTF8.GetBytes(json))
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');
    }

    public static bool TryDecode(string? encoded, out SyncCursor? cursor)
    {
        cursor = null;
        if (string.IsNullOrWhiteSpace(encoded))
        {
            return false;
        }

        try
        {
            var padded = encoded.Replace('-', '+').Replace('_', '/');
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