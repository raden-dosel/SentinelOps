using SentinelOps.Api.Sync;

namespace SentinelOps.Api.Tests;

public sealed class CursorCodecTests
{
    [Fact]
    public void Encoded_cursor_round_trips_without_exposing_json_shape()
    {
        var original = new SyncCursor(Guid.NewGuid(), 42);

        var encoded = CursorCodec.Encode(original);

        Assert.DoesNotContain("BusinessId", encoded);
        Assert.True(CursorCodec.TryDecode(encoded, out var decoded));
        Assert.Equal(original, decoded);
    }

    [Fact]
    public void Tampered_sequence_in_payload_is_rejected_by_hmac_signature()
    {
        var original = new SyncCursor(Guid.NewGuid(), 42);
        var encoded = CursorCodec.Encode(original);

        var parts = encoded.Split('.');
        Assert.Equal(2, parts.Length);

        // Tamper with payload portion by flipping characters
        var tamperedPayload = parts[0].EndsWith('A') ? parts[0][..^1] + 'B' : parts[0][..^1] + 'A';
        var tamperedCursor = $"{tamperedPayload}.{parts[1]}";

        Assert.False(CursorCodec.TryDecode(tamperedCursor, out _));
    }

    [Fact]
    public void Forged_signature_is_rejected()
    {
        var original = new SyncCursor(Guid.NewGuid(), 42);
        var encoded = CursorCodec.Encode(original);

        var parts = encoded.Split('.');
        var forgedCursor = $"{parts[0]}.forgedsignature1234567890";

        Assert.False(CursorCodec.TryDecode(forgedCursor, out _));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not-a-cursor")]
    [InlineData("invalid.payload.extra")]
    public void Invalid_cursor_is_rejected(string? value)
    {
        Assert.False(CursorCodec.TryDecode(value, out _));
    }
}