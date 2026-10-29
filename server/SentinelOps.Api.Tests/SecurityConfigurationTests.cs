using SentinelOps.Api.Configuration;

namespace SentinelOps.Api.Tests;

public sealed class SecurityConfigurationTests
{
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("short")]
    [InlineData("development-only-registration-token")]
    [InlineData("CHANGE_ME_please_replace_this_secret_value")]
    public void Development_or_default_secrets_are_rejected(string? value)
    {
        Assert.False(SecurityConfiguration.IsAcceptableSecret(value, 16));
    }

    [Fact]
    public void Cryptographically_sized_secret_is_accepted()
    {
        var value = new string('a', 32);

        Assert.True(SecurityConfiguration.IsAcceptableSecret(value));
    }

    [Fact]
    public void Registration_tokens_can_use_the_shorter_minimum_length()
    {
        var value = new string('b', 16);

        Assert.True(SecurityConfiguration.IsAcceptableSecret(value, 16));
        Assert.False(SecurityConfiguration.IsAcceptableSecret(value));
    }
}