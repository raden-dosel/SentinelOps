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

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not-a-cursor")]
    public void Invalid_cursor_is_rejected(string? value)
    {
        Assert.False(CursorCodec.TryDecode(value, out _));
    }
}