namespace SentinelOps.Api.Configuration;

public static class SecurityConfiguration
{
    public static bool IsAcceptableSecret(string? value, int minimumLength = 32)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Trim().Length < minimumLength)
            return false;

        return !value.Contains("CHANGE_ME", StringComparison.OrdinalIgnoreCase)
            && !value.Contains("development-only", StringComparison.OrdinalIgnoreCase)
            && !value.Contains("default", StringComparison.OrdinalIgnoreCase);
    }
}