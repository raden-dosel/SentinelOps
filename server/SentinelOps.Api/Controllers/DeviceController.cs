using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using SentinelOps.Api.Contracts;
using SentinelOps.Api.Domain;
using SentinelOps.Api.Persistence;

namespace SentinelOps.Api.Controllers;

[ApiController]
[Route("api/v1/devices")]
[EnableRateLimiting("sync")]
public sealed class DeviceController(SentinelOpsDbContext db, IConfiguration configuration) : ControllerBase
{
    [HttpPost("register")]
    public async Task<ActionResult<RegisterDeviceResponse>> Register(
        RegisterDeviceRequest request, CancellationToken cancellationToken)
    {
        var expected = configuration["Sync:RegistrationToken"];
        var presented = Request.Headers["X-Registration-Token"].ToString();
        if (string.IsNullOrWhiteSpace(expected) ||
            !CryptographicOperations.FixedTimeEquals(
                SHA256.HashData(Encoding.UTF8.GetBytes(expected)),
                SHA256.HashData(Encoding.UTF8.GetBytes(presented))))
            return Unauthorized();
        if (string.IsNullOrWhiteSpace(request.DeviceName) || request.DeviceName.Length > 200)
            return Problem(statusCode: 400, title: "Device name is invalid.");

        var business = await db.Businesses.FindAsync([request.BusinessId], cancellationToken);
        if (business is null)
        {
            business = new Business
            {
                Id = request.BusinessId == Guid.Empty ? Guid.NewGuid() : request.BusinessId,
                Name = request.BusinessName.Trim(),
                CreatedAtUtc = DateTime.UtcNow
            };
            db.Businesses.Add(business);
        }
        var deviceId = Guid.NewGuid();
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        db.RegisteredDevices.Add(new RegisteredDevice
        {
            Id = deviceId,
            BusinessId = business.Id,
            Name = request.DeviceName.Trim(),
            TokenHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token))),
            RegisteredAtUtc = DateTime.UtcNow
        });
        await db.SaveChangesAsync(cancellationToken);
        return Ok(new RegisterDeviceResponse(business.Id, deviceId, token));
    }

    [HttpPost("{id:guid}/revoke")]
    public async Task<IActionResult> Revoke(Guid id, CancellationToken cancellationToken)
    {
        var expected = configuration["Sync:RegistrationToken"];
        var presented = Request.Headers["X-Registration-Token"].ToString();
        if (string.IsNullOrWhiteSpace(expected) ||
            !CryptographicOperations.FixedTimeEquals(
                SHA256.HashData(Encoding.UTF8.GetBytes(expected)),
                SHA256.HashData(Encoding.UTF8.GetBytes(presented))))
            return Unauthorized();

        var device = await db.RegisteredDevices.FindAsync([id], cancellationToken);
        if (device is null) return NotFound();

        device.RevokedAtUtc = DateTime.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<DeviceSummaryDto>>> List(CancellationToken cancellationToken)
    {
        var expected = configuration["Sync:RegistrationToken"];
        var presented = Request.Headers["X-Registration-Token"].ToString();
        if (string.IsNullOrWhiteSpace(expected) ||
            !CryptographicOperations.FixedTimeEquals(
                SHA256.HashData(Encoding.UTF8.GetBytes(expected)),
                SHA256.HashData(Encoding.UTF8.GetBytes(presented))))
            return Unauthorized();

        var devices = await db.RegisteredDevices.AsNoTracking()
            .Select(d => new DeviceSummaryDto(d.Id, d.BusinessId, d.Name, d.RegisteredAtUtc, d.RevokedAtUtc))
            .ToListAsync(cancellationToken);
        return Ok(devices);
    }
}
