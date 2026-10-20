using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.EntityFrameworkCore;
using System.Threading.RateLimiting;
using SentinelOps.Api.Persistence;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddProblemDetails();
builder.Services.AddControllers();
builder.Services.AddOpenApi();
var connectionString = builder.Configuration.GetConnectionString("SentinelOps")
    ?? throw new InvalidOperationException("ConnectionStrings:SentinelOps must be configured.");
builder.Services.AddDbContext<SentinelOpsDbContext>(options =>
    options.UseNpgsql(connectionString,
        npgsql => npgsql.MigrationsAssembly(typeof(SentinelOpsDbContext).Assembly.FullName)));
builder.Services.AddHealthChecks().AddDbContextCheck<SentinelOpsDbContext>("postgresql");
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("sync", context =>
        RateLimitPartition.GetFixedWindowLimiter(
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

app.UseExceptionHandler();
app.UseHttpsRedirection();
app.UseCors("pwa");
app.UseRateLimiter();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.MapHealthChecks("/api/v1/health/live", new HealthCheckOptions
{
    Predicate = _ => false,
});
app.MapHealthChecks("/api/v1/health/ready", new HealthCheckOptions
{
    Predicate = _ => true,
});
app.MapControllers();

app.Run();

public partial class Program;
