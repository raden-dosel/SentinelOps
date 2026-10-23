using Microsoft.EntityFrameworkCore;
using SentinelOps.Api.Persistence;

namespace SentinelOps.Api.Tests;

[Trait("Category", "NeonIntegration")]
public sealed class NeonIntegrationTests
{
    [Fact]
    public async Task Neon_database_is_reachable_and_contains_the_migrated_schema()
    {
        var rawConnectionString = Environment.GetEnvironmentVariable("ConnectionStrings__SentinelOps")
                               ?? Environment.GetEnvironmentVariable("NEON_CONNECTION_STRING")
                               ?? Environment.GetEnvironmentVariable("DATABASE_URL")
                               ?? Environment.GetEnvironmentVariable("DATABASE_CONNECTION_STRING");

        if (string.IsNullOrWhiteSpace(rawConnectionString))
        {
            throw new InvalidOperationException(
                "Neon connection string must be configured via 'ConnectionStrings__SentinelOps', " +
                "'NEON_CONNECTION_STRING', or 'DATABASE_URL' environment variable to run integration tests.");
        }

        // Normalize connection string (supports Neon postgresql:// URI format, ensures SSL Mode & Trust Server Certificate)
        var connectionString = PostgresConnectionHelper.Normalize(rawConnectionString);

        var options = new DbContextOptionsBuilder<SentinelOpsDbContext>()
            .UseNpgsql(connectionString, npgsql =>
            {
                npgsql.EnableRetryOnFailure(
                    maxRetryCount: 3,
                    maxRetryDelay: TimeSpan.FromSeconds(5),
                    errorCodesToAdd: null);
                npgsql.CommandTimeout(30);
            })
            .Options;

        await using var db = new SentinelOpsDbContext(options);

        // Explicitly open the connection so any Npgsql / TLS / Authentication exception
        // is surfaced in full diagnostic detail in GitHub Actions rather than silently
        // masked as 'false' by CanConnectAsync().
        try
        {
            await db.Database.OpenConnectionAsync();
        }
        catch (Exception ex)
        {
            var sanitizedTarget = PostgresConnectionHelper.SanitizeForLogging(connectionString);
            throw new InvalidOperationException(
                $"Neon database connection failed for '{sanitizedTarget}'. " +
                $"Underlying error ({ex.GetType().Name}): {ex.Message}. " +
                $"Please verify: 1) Connection string is valid and endpoint is active; " +
                $"2) IP / SSL restrictions in Neon console; " +
                $"3) GitHub repository secret is set under Environment 'production' if using environment secrets.",
                ex);
        }

        var appliedMigrations = (await db.Database.GetAppliedMigrationsAsync()).ToList();
        Assert.NotEmpty(appliedMigrations);

        // Verify that entity schemas are recognized by EF Core
        Assert.NotNull(db.Model.FindEntityType(typeof(Domain.Business)));
        Assert.NotNull(db.Model.FindEntityType(typeof(Domain.RegisteredDevice)));
        Assert.NotNull(db.Model.FindEntityType(typeof(Domain.SyncEntity)));
        Assert.NotNull(db.Model.FindEntityType(typeof(Domain.ChangeFeedEntry)));
        Assert.NotNull(db.Model.FindEntityType(typeof(Domain.EntityTombstone)));
        Assert.NotNull(db.Model.FindEntityType(typeof(Domain.SyncIdempotencyRecord)));
    }
}
