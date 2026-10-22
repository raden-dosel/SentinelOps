using Microsoft.EntityFrameworkCore;
using SentinelOps.Api.Persistence;

namespace SentinelOps.Api.Tests;

[Trait("Category", "NeonIntegration")]
public sealed class NeonIntegrationTests
{
    [Fact]
    public async Task Neon_database_is_reachable_and_contains_the_migrated_schema()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__SentinelOps");
        if (string.IsNullOrWhiteSpace(connectionString))
            throw new InvalidOperationException(
                "ConnectionStrings__SentinelOps must be set to run Neon integration tests.");

        var options = new DbContextOptionsBuilder<SentinelOpsDbContext>()
            .UseNpgsql(connectionString)
            .Options;

        await using var db = new SentinelOpsDbContext(options);
        Assert.True(await db.Database.CanConnectAsync());
        var appliedMigrations = await db.Database.GetAppliedMigrationsAsync();
        Assert.NotEmpty(appliedMigrations);
        Assert.NotNull(db.Model.FindEntityType(typeof(Domain.Business)));
    }
}
