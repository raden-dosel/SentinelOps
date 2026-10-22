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

var rawConnectionString = builder.Configuration.GetConnectionString("SentinelOps")
    ?? throw new InvalidOperationException("ConnectionStrings:SentinelOps must be configured.");

var connectionString = NormalizePostgresConnectionString(rawConnectionString);

if (builder.Environment.IsProduction())
{
    var cursorKey = builder.Configuration["Sync:CursorSigningKey"];
    if (string.IsNullOrWhiteSpace(cursorKey) || cursorKey.Length < 32 || cursorKey.Contains("CHANGE_ME"))
    {
        throw new InvalidOperationException("Sync:CursorSigningKey must be a secure key with at least 32 characters in Production.");
    }

    var regToken = builder.Configuration["Sync:RegistrationToken"];
    if (string.IsNullOrWhiteSpace(regToken) || regToken.Length < 16 || regToken.Contains("CHANGE_ME"))
    {
        throw new InvalidOperationException("Sync:RegistrationToken must be configured securely in Production.");
    }
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
static string NormalizePostgresConnectionString(string connection)
{
    if (string.IsNullOrWhiteSpace(connection)) return connection;

    if (connection.StartsWith("postgres://", StringComparison.OrdinalIgnoreCase) ||
        connection.StartsWith("postgresql://", StringComparison.OrdinalIgnoreCase))
    {
        var uri = new Uri(connection);
        var userInfo = uri.UserInfo.Split(':', 2);
        var username = userInfo.Length > 0 ? Uri.UnescapeDataString(userInfo[0]) : "";
        var password = userInfo.Length > 1 ? Uri.UnescapeDataString(userInfo[1]) : "";
        var database = uri.AbsolutePath.TrimStart('/');
        var port = uri.Port > 0 ? uri.Port : 5432;

        var sb = new System.Text.StringBuilder();
        sb.Append($"Host={uri.Host};Port={port};Database={database};");
        if (!string.IsNullOrEmpty(username)) sb.Append($"Username={username};");
        if (!string.IsNullOrEmpty(password)) sb.Append($"Password={password};");
        sb.Append("SSL Mode=Require;Trust Server Certificate=true;");
        return sb.ToString();
    }

    return connection;
}

public partial class Program;
