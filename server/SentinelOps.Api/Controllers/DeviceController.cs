using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
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
    private string? ExpectedRegistrationToken =>
        configuration["Sync:RegistrationToken"] ?? configuration["SYNC_REGISTRATION_TOKEN"];

    [HttpPost("register")]
    public async Task<ActionResult<RegisterDeviceResponse>> Register(
        RegisterDeviceRequest request, CancellationToken cancellationToken)
    {
        var expected = ExpectedRegistrationToken;
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
        var role = string.IsNullOrWhiteSpace(request.Role) ? "Admin" : request.Role.Trim();
        if (role is not ("Admin" or "Operations" or "Finance" or "ReadOnly"))
        {
            role = "Admin";
        }

        db.RegisteredDevices.Add(new RegisteredDevice
        {
            Id = deviceId,
            BusinessId = business.Id,
            Name = request.DeviceName.Trim(),
            Role = role,
            TokenHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token))),
            RegisteredAtUtc = DateTime.UtcNow,
            LastSeenAtUtc = DateTime.UtcNow
        });

        db.ServerAuditEvents.Add(new ServerAuditEvent
        {
            Id = Guid.NewGuid(),
            BusinessId = business.Id,
            DeviceId = deviceId,
            Action = "DEVICE_REGISTERED",
            EntityType = "RegisteredDevice",
            EntityId = deviceId.ToString(),
            DetailsJson = JsonSerializer.Serialize(new { deviceName = request.DeviceName, role }),
            TimestampUtc = DateTime.UtcNow
        });

        await db.SaveChangesAsync(cancellationToken);
        return Ok(new RegisterDeviceResponse(business.Id, deviceId, token, role));
    }

    [HttpPost("{id:guid}/revoke")]
    public async Task<IActionResult> Revoke(Guid id, CancellationToken cancellationToken)
    {
        var expected = ExpectedRegistrationToken;
        var presented = Request.Headers["X-Registration-Token"].ToString();
        if (string.IsNullOrWhiteSpace(expected) ||
            !CryptographicOperations.FixedTimeEquals(
                SHA256.HashData(Encoding.UTF8.GetBytes(expected)),
                SHA256.HashData(Encoding.UTF8.GetBytes(presented))))
            return Unauthorized();

        var device = await db.RegisteredDevices.FindAsync([id], cancellationToken);
        if (device is null) return NotFound();

        device.RevokedAtUtc = DateTime.UtcNow;

        db.ServerAuditEvents.Add(new ServerAuditEvent
        {
            Id = Guid.NewGuid(),
            BusinessId = device.BusinessId,
            DeviceId = device.Id,
            Action = "DEVICE_REVOKED",
            EntityType = "RegisteredDevice",
            EntityId = device.Id.ToString(),
            DetailsJson = "{}",
            TimestampUtc = DateTime.UtcNow
        });

        await db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    [HttpPost("{id:guid}/rotate-token")]
    public async Task<ActionResult<RegisterDeviceResponse>> RotateToken(Guid id, CancellationToken cancellationToken)
    {
        var device = await db.RegisteredDevices.Include(d => d.Business).SingleOrDefaultAsync(d => d.Id == id && d.RevokedAtUtc == null, cancellationToken);
        if (device is null) return NotFound();

        var isAuthorized = false;
        var regHeader = Request.Headers["X-Registration-Token"].ToString();
        var expected = ExpectedRegistrationToken;
        if (!string.IsNullOrWhiteSpace(expected) && !string.IsNullOrWhiteSpace(regHeader) &&
            CryptographicOperations.FixedTimeEquals(
                SHA256.HashData(Encoding.UTF8.GetBytes(expected)),
                SHA256.HashData(Encoding.UTF8.GetBytes(regHeader))))
        {
            isAuthorized = true;
        }
        else
        {
            var auth = Request.Headers.Authorization.ToString();
            if (auth.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            {
                var presentedToken = auth["Bearer ".Length..].Trim();
                if (presentedToken.Length >= 32 &&
                    CryptographicOperations.FixedTimeEquals(
                        Convert.FromHexString(device.TokenHash),
                        SHA256.HashData(Encoding.UTF8.GetBytes(presentedToken))))
                {
                    isAuthorized = true;
                }
            }
        }

        if (!isAuthorized) return Unauthorized();

        var newToken = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        device.TokenHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(newToken)));
        device.LastSeenAtUtc = DateTime.UtcNow;

        db.ServerAuditEvents.Add(new ServerAuditEvent
        {
            Id = Guid.NewGuid(),
            BusinessId = device.BusinessId,
            DeviceId = device.Id,
            Action = "DEVICE_TOKEN_ROTATED",
            EntityType = "RegisteredDevice",
            EntityId = device.Id.ToString(),
            DetailsJson = "{}",
            TimestampUtc = DateTime.UtcNow
        });

        await db.SaveChangesAsync(cancellationToken);
        return Ok(new RegisterDeviceResponse(device.BusinessId, device.Id, newToken, device.Role));
    }

    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<DeviceSummaryDto>>> List(CancellationToken cancellationToken)
    {
        var expected = ExpectedRegistrationToken;
        var presented = Request.Headers["X-Registration-Token"].ToString();
        if (string.IsNullOrWhiteSpace(expected) ||
            !CryptographicOperations.FixedTimeEquals(
                SHA256.HashData(Encoding.UTF8.GetBytes(expected)),
                SHA256.HashData(Encoding.UTF8.GetBytes(presented))))
            return Unauthorized();

        var devices = await db.RegisteredDevices.AsNoTracking()
            .Select(d => new DeviceSummaryDto(d.Id, d.BusinessId, d.Name, d.Role, d.RegisteredAtUtc, d.RevokedAtUtc, d.LastSeenAtUtc))
            .ToListAsync(cancellationToken);
        return Ok(devices);
    }

    [HttpPost("{id:guid}/recovery/request")]
    public async Task<ActionResult<RequestDeviceRecoveryResponse>> RequestRecovery(Guid id, CancellationToken cancellationToken)
    {
        var expected = ExpectedRegistrationToken;
        var regHeader = Request.Headers["X-Registration-Token"].ToString();
        var isAuthorized = false;

        if (!string.IsNullOrWhiteSpace(expected) &&
            CryptographicOperations.FixedTimeEquals(
                SHA256.HashData(Encoding.UTF8.GetBytes(expected)),
                SHA256.HashData(Encoding.UTF8.GetBytes(regHeader))))
        {
            isAuthorized = true;
        }
        else
        {
            var authHeader = Request.Headers.Authorization.ToString();
            if (authHeader.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            {
                var token = authHeader["Bearer ".Length..].Trim();
                var callerDevice = await db.RegisteredDevices.SingleOrDefaultAsync(
                    x => x.Id == id && x.RevokedAtUtc == null, cancellationToken);
                if (callerDevice is not null && CryptographicOperations.FixedTimeEquals(
                    Convert.FromHexString(callerDevice.TokenHash), SHA256.HashData(Encoding.UTF8.GetBytes(token))))
                {
                    isAuthorized = true;
                }
            }
        }

        if (!isAuthorized) return Unauthorized();

        var device = await db.RegisteredDevices.FindAsync([id], cancellationToken);
        if (device is null || device.RevokedAtUtc != null) return NotFound();

        // Supersede any prior pending recovery challenges
        var pending = await db.DeviceRecoveryChallenges
            .Where(c => c.DeviceId == id && c.UsedAtUtc == null && c.ExpiresAtUtc > DateTime.UtcNow)
            .ToListAsync(cancellationToken);
        foreach (var p in pending)
        {
            p.UsedAtUtc = DateTime.UtcNow;
        }

        // Generate high-entropy 8-character code
        var rawCodeBytes = RandomNumberGenerator.GetBytes(6);
        var hex = Convert.ToHexString(rawCodeBytes);
        var rawCode = $"REC-{hex[..4]}-{hex[4..8]}";
        var cleanCode = rawCode.Replace("-", "").ToUpperInvariant();
        var codeHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(cleanCode)));

        var challenge = new DeviceRecoveryChallenge
        {
            Id = Guid.NewGuid(),
            BusinessId = device.BusinessId,
            DeviceId = device.Id,
            CodeHash = codeHash,
            CreatedAtUtc = DateTime.UtcNow,
            ExpiresAtUtc = DateTime.UtcNow.AddMinutes(15),
            UsedAtUtc = null
        };
        db.DeviceRecoveryChallenges.Add(challenge);

        db.ServerAuditEvents.Add(new ServerAuditEvent
        {
            Id = Guid.NewGuid(),
            BusinessId = device.BusinessId,
            DeviceId = device.Id,
            Action = "ADMIN_RECOVERY_REQUESTED",
            EntityType = "DeviceRecoveryChallenge",
            EntityId = challenge.Id.ToString(),
            DetailsJson = JsonSerializer.Serialize(new { deviceName = device.Name, expiresAtUtc = challenge.ExpiresAtUtc }),
            TimestampUtc = DateTime.UtcNow
        });

        await db.SaveChangesAsync(cancellationToken);
        return Ok(new RequestDeviceRecoveryResponse(challenge.Id, rawCode, challenge.ExpiresAtUtc));
    }

    [HttpPost("{id:guid}/recovery/verify")]
    public async Task<ActionResult<VerifyDeviceRecoveryResponse>> VerifyRecovery(
        Guid id, VerifyDeviceRecoveryRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.RecoveryAuthorizationCode))
            return Problem(statusCode: 400, title: "Recovery code is required.");

        var device = await db.RegisteredDevices.FindAsync([id], cancellationToken);
        if (device is null || device.RevokedAtUtc != null)
            return Problem(statusCode: 404, title: "Device not found or revoked.");

        var cleanAttempt = request.RecoveryAuthorizationCode.Trim().Replace("-", "").Replace("REC", "", StringComparison.OrdinalIgnoreCase).ToUpperInvariant();
        var normalizedFull = cleanAttempt.StartsWith("REC", StringComparison.OrdinalIgnoreCase) ? cleanAttempt : "REC" + cleanAttempt;
        var cleanCode = request.RecoveryAuthorizationCode.Trim().Replace("-", "").ToUpperInvariant();
        var attemptHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(cleanCode)));

        var challenge = await db.DeviceRecoveryChallenges
            .Where(c => c.DeviceId == id && c.UsedAtUtc == null && c.ExpiresAtUtc > DateTime.UtcNow)
            .OrderByDescending(c => c.CreatedAtUtc)
            .FirstOrDefaultAsync(cancellationToken);

        if (challenge is null || !CryptographicOperations.FixedTimeEquals(
            Convert.FromHexString(challenge.CodeHash), Convert.FromHexString(attemptHash)))
        {
            db.ServerAuditEvents.Add(new ServerAuditEvent
            {
                Id = Guid.NewGuid(),
                BusinessId = device.BusinessId,
                DeviceId = device.Id,
                Action = "PASSWORD_RESET_FAILED",
                EntityType = "DeviceRecoveryChallenge",
                EntityId = id.ToString(),
                DetailsJson = JsonSerializer.Serialize(new { reason = "Invalid or expired recovery authorization code" }),
                TimestampUtc = DateTime.UtcNow
            });
            await db.SaveChangesAsync(cancellationToken);
            return Problem(statusCode: 401, title: "Invalid or expired recovery authorization code.");
        }

        challenge.UsedAtUtc = DateTime.UtcNow;

        db.ServerAuditEvents.Add(new ServerAuditEvent
        {
            Id = Guid.NewGuid(),
            BusinessId = device.BusinessId,
            DeviceId = device.Id,
            Action = "ADMIN_RECOVERY_COMPLETED",
            EntityType = "DeviceRecoveryChallenge",
            EntityId = challenge.Id.ToString(),
            DetailsJson = JsonSerializer.Serialize(new { deviceName = device.Name }),
            TimestampUtc = DateTime.UtcNow
        });

        await db.SaveChangesAsync(cancellationToken);
        return Ok(new VerifyDeviceRecoveryResponse(true, "Emergency recovery verified by server.", device.Id, device.BusinessId));
    }
}
