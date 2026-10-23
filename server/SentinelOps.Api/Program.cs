using System.Security.Cryptography;
using System.Text.Json;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using SentinelOps.Api.Persistence;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddProblemDetails();
builder.Services.AddControllers();
builder.Services.AddOpenApi();

// Container-friendly Forwarded Headers configuration for Render & cloud reverse proxies
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor |
                               ForwardedHeaders.XForwardedProto |
                               ForwardedHeaders.XForwardedHost;
    // In container platforms like Render, the reverse proxy IP changes dynamically
    // and is outside loopback. Clearing KnownNetworks and KnownProxies allows
    // X-Forwarded-* headers from any incoming proxy hop to be processed.
    options.KnownNetworks.Clear();
    options.KnownProxies.Clear();
    options.ForwardLimit = null;
});

// Configure HTTPS redirection to explicitly use port 443 behind reverse proxies
builder.Services.AddHttpsRedirection(options =>
{
    options.HttpsPort = 443;
    options.RedirectStatusCode = StatusCodes.Status308PermanentRedirect;
});

// Support both standard ConnectionStrings:SentinelOps and Render/Cloud DATABASE_URL
var rawConnectionString = ResolveNonEmptyConfig(
    builder.Configuration,
    "ConnectionStrings:SentinelOps",
    "ConnectionStrings__SentinelOps",
    "DATABASE_URL",
    "DATABASE_CONNECTION_STRING",
    "SentinelOps");

if (string.IsNullOrWhiteSpace(rawConnectionString))
{
    if (builder.Environment.IsDevelopment())
    {
        rawConnectionString = "Host=localhost;Port=5432;Database=sentinelops;Username=sentinelops;Password=development-only";
    }
    else
    {
        throw new InvalidOperationException("Database connection string must be configured via 'ConnectionStrings:SentinelOps' or 'DATABASE_URL' environment variable.");
    }
}

var connectionString = PostgresConnectionHelper.Normalize(rawConnectionString);

// Resilient Sync Key & Registration Token setup:
// Explicitly checks SYNC_CURSOR_SIGNING_KEY and SYNC_REGISTRATION_TOKEN (Render/GitHub Actions conventions)
// as well as ASP.NET Core hierarchical naming (Sync__CursorSigningKey / Sync:CursorSigningKey).
var cursorKey = ResolveNonEmptyConfig(
    builder.Configuration,
    "SYNC_CURSOR_SIGNING_KEY",
    "Sync__CursorSigningKey",
    "Sync:CursorSigningKey",
    "CURSOR_SIGNING_KEY");

if (string.IsNullOrWhiteSpace(cursorKey) || cursorKey.Length < 32 || cursorKey.Contains("CHANGE_ME"))
{
    var generatedCursorKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
    builder.Configuration["Sync:CursorSigningKey"] = generatedCursorKey;
    Console.WriteLine("[WARN] [SentinelOps Security] 'SYNC_CURSOR_SIGNING_KEY' or 'Sync__CursorSigningKey' was not supplied or invalid in configuration. " +
                      "Generated an ephemeral 256-bit cryptographic signing key for this instance session. " +
                      "To preserve sync cursor continuity across container restarts or horizontally scaled replicas on Render, " +
                      "configure 'SYNC_CURSOR_SIGNING_KEY' or 'Sync__CursorSigningKey' in your Render Environment Variables.");
}
else
{
    builder.Configuration["Sync:CursorSigningKey"] = cursorKey;
    Console.WriteLine("[INFO] [SentinelOps Security] 'Sync:CursorSigningKey' loaded successfully from environment configuration.");
}

var regToken = ResolveNonEmptyConfig(
    builder.Configuration,
    "SYNC_REGISTRATION_TOKEN",
    "Sync__RegistrationToken",
    "Sync:RegistrationToken",
    "REGISTRATION_TOKEN");

if (string.IsNullOrWhiteSpace(regToken) || regToken.Length < 16 || regToken.Contains("CHANGE_ME"))
{
    var generatedRegToken = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
    builder.Configuration["Sync:RegistrationToken"] = generatedRegToken;
    Console.WriteLine($"[WARN] [SentinelOps Security] 'SYNC_REGISTRATION_TOKEN' or 'Sync__RegistrationToken' was not configured. " +
                      $"Generated an ephemeral device registration token: '{generatedRegToken}'. " +
                      "To set a permanent secret for device onboarding, configure 'SYNC_REGISTRATION_TOKEN' or 'Sync__RegistrationToken' in Render Environment Variables.");
}
else
{
    builder.Configuration["Sync:RegistrationToken"] = regToken;
    Console.WriteLine("[INFO] [SentinelOps Security] 'Sync:RegistrationToken' loaded successfully from environment configuration.");
}

builder.Services.AddDbContext<SentinelOpsDbContext>(options =>
    options.UseNpgsql(connectionString, npgsql =>
    {
        npgsql.MigrationsAssembly(typeof(SentinelOpsDbContext).Assembly.FullName);
        // Connection resilience for cloud databases (Render/Neon transient retries)
        npgsql.EnableRetryOnFailure(
            maxRetryCount: 3,
            maxRetryDelay: TimeSpan.FromSeconds(5),
            errorCodesToAdd: null);
        npgsql.CommandTimeout(30);
    }));

// Health checks with custom database query and tags
builder.Services.AddHealthChecks()
    .AddDbContextCheck<SentinelOpsDbContext>(
        name: "postgresql",
        failureStatus: HealthStatus.Unhealthy,
        tags: ["ready", "db"],
        customTestQuery: async (dbContext, cancellationToken) =>
        {
            return await dbContext.Database.CanConnectAsync(cancellationToken);
        });

builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("sync", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            // When UseForwardedHeaders is enabled, RemoteIpAddress reflects the real client IP from X-Forwarded-For
            context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 120,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
            }));
});

builder.Services.AddCors(options =>
    options.AddPolicy("pwa", policy =>
    {
        var origins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];
        if (origins.Length > 0)
        {
            policy.WithOrigins(origins).AllowAnyHeader().AllowAnyMethod();
        }
    }));

var app = builder.Build();

// Forwarded headers MUST be called before UseHttpsRedirection, UseExceptionHandler,
// UseRateLimiter, and routing to ensure Request.Scheme is https and RemoteIpAddress is the real client IP.
app.UseForwardedHeaders();

app.UseExceptionHandler();
app.UseHttpsRedirection();
app.UseCors("pwa");
app.UseRateLimiter();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

// Liveness probe: returns 200 OK if Kestrel process is alive (use for Render Health Check Path)
app.MapHealthChecks("/api/v1/health/live", new HealthCheckOptions
{
    Predicate = _ => false,
    ResponseWriter = WriteHealthResponse
});

// Readiness probe: verifies PostgreSQL connectivity and database readiness (returns 200 if DB is healthy, 503 if unhealthy)
app.MapHealthChecks("/api/v1/health/ready", new HealthCheckOptions
{
    Predicate = check => check.Tags.Contains("ready") || check.Name == "postgresql",
    ResponseWriter = WriteHealthResponse
});

app.MapControllers();

app.Run();

// Health check JSON formatter
static async Task WriteHealthResponse(HttpContext context, HealthReport report)
{
    context.Response.ContentType = "application/json; charset=utf-8";

    var response = new
    {
        status = report.Status.ToString(),
        timestampUtc = DateTime.UtcNow,
        totalDurationMs = Math.Round(report.TotalDuration.TotalMilliseconds, 2),
        checks = report.Entries.Select(e => new
        {
            component = e.Key,
            status = e.Value.Status.ToString(),
            durationMs = Math.Round(e.Value.Duration.TotalMilliseconds, 2),
            description = e.Value.Description ?? (e.Value.Status == HealthStatus.Healthy ? "Operational" : "Check failed"),
            error = e.Value.Exception?.Message
        })
    };

    var jsonBytes = JsonSerializer.SerializeToUtf8Bytes(response, new JsonSerializerOptions
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    });

    await context.Response.Body.WriteAsync(jsonBytes);
}

// Helper to support both standard ADO.NET and Render/Neon postgres:// or postgresql:// URIs
static string NormalizePostgresConnectionString(string connection) => PostgresConnectionHelper.Normalize(connection);

// Scans IConfiguration and Environment Variables for the first non-empty, non-whitespace value
static string? ResolveNonEmptyConfig(IConfiguration config, params string[] keyNames)
{
    foreach (var key in keyNames)
    {
        var configVal = config[key];
        if (!string.IsNullOrWhiteSpace(configVal))
        {
            return configVal.Trim();
        }

        var envVal = Environment.GetEnvironmentVariable(key);
        if (!string.IsNullOrWhiteSpace(envVal))
        {
            return envVal.Trim();
        }
    }
    return null;
}

public partial class Program;
