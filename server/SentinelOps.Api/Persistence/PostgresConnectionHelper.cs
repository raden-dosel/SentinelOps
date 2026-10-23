using System.Text;
using System.Text.RegularExpressions;

namespace SentinelOps.Api.Persistence;

public static class PostgresConnectionHelper
{
    /// <summary>
    /// Normalizes PostgreSQL connection strings supporting standard ADO.NET key-value
    /// as well as Neon and Render postgres:// and postgresql:// URI formats.
    /// Ensures required SSL Mode and certificate handling for cloud databases.
    /// </summary>
    public static string Normalize(string? connection)
    {
        if (string.IsNullOrWhiteSpace(connection))
            return string.Empty;

        var trimmed = connection.Trim();

        // 1. Handle URI format (postgres:// or postgresql://)
        if (trimmed.StartsWith("postgres://", StringComparison.OrdinalIgnoreCase) ||
            trimmed.StartsWith("postgresql://", StringComparison.OrdinalIgnoreCase))
        {
            var uri = new Uri(trimmed);
            var userInfo = uri.UserInfo.Split(':', 2);
            var username = userInfo.Length > 0 ? Uri.UnescapeDataString(userInfo[0]) : "";
            var password = userInfo.Length > 1 ? Uri.UnescapeDataString(userInfo[1]) : "";
            var database = uri.AbsolutePath.TrimStart('/');
            var port = uri.Port > 0 ? uri.Port : 5432;

            var sb = new StringBuilder();
            sb.Append($"Host={uri.Host};Port={port};Database={database};");
            if (!string.IsNullOrEmpty(username)) sb.Append($"Username={username};");
            if (!string.IsNullOrEmpty(password)) sb.Append($"Password={password};");
            sb.Append("SSL Mode=Require;Trust Server Certificate=true;");

            return sb.ToString();
        }

        // 2. Handle ADO.NET key-value format
        var result = trimmed;
        if (!result.EndsWith(';'))
        {
            result += ";";
        }

        // For non-localhost cloud connections (e.g. Neon, Render, Supabase), ensure SSL Mode is set
        var isLocalhost = result.Contains("Host=localhost", StringComparison.OrdinalIgnoreCase) ||
                          result.Contains("Host=127.0.0.1", StringComparison.OrdinalIgnoreCase);

        if (!isLocalhost)
        {
            if (!result.Contains("SSL Mode=", StringComparison.OrdinalIgnoreCase) &&
                !result.Contains("SslMode=", StringComparison.OrdinalIgnoreCase))
            {
                result += "SSL Mode=Require;";
            }

            if (!result.Contains("Trust Server Certificate=", StringComparison.OrdinalIgnoreCase) &&
                !result.Contains("TrustServerCertificate=", StringComparison.OrdinalIgnoreCase))
            {
                result += "Trust Server Certificate=true;";
            }
        }

        return result;
    }

    /// <summary>
    /// Returns a sanitized representation of the connection string safe for logging and diagnostics,
    /// masking user passwords while preserving target host, port, and database name.
    /// </summary>
    public static string SanitizeForLogging(string? connection)
    {
        if (string.IsNullOrWhiteSpace(connection))
            return "[Empty Connection String]";

        var trimmed = connection.Trim();

        // Sanitize URI format
        if (trimmed.StartsWith("postgres://", StringComparison.OrdinalIgnoreCase) ||
            trimmed.StartsWith("postgresql://", StringComparison.OrdinalIgnoreCase))
        {
            return Regex.Replace(trimmed, @":([^@]+)@", ":***@");
        }

        // Sanitize ADO.NET format
        var sanitized = Regex.Replace(trimmed, @"(?i)(Password|Pwd)\s*=\s*[^;]*", "$1=***");
        return sanitized;
    }
}
