using SentinelOps.Api.Sync;

namespace SentinelOps.Api.Tests;

public sealed class CursorCodecTests
{
    private const string SigningKey = "test-signing-key";

    [Fact]
    public void Encoded_cursor_round_trips_without_exposing_json_shape()
    {
        var original = new SyncCursor(Guid.NewGuid(), 42);

        var encoded = CursorCodec.Encode(original, SigningKey);

        Assert.DoesNotContain("BusinessId", encoded);
        Assert.True(CursorCodec.TryDecode(encoded, SigningKey, out var decoded));
        Assert.Equal(original, decoded);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not-a-cursor")]
    public void Invalid_cursor_is_rejected(string? value)
    {
        Assert.False(CursorCodec.TryDecode(value, SigningKey, out _));
    }

    [Fact]
    public void Tampered_cursor_is_rejected()
    {
        var encoded = CursorCodec.Encode(new SyncCursor(Guid.NewGuid(), 42), SigningKey);

        Assert.False(CursorCodec.TryDecode($"{encoded[..^1]}x", SigningKey, out _));
    }
}