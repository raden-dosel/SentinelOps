using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using SentinelOps.Api.Contracts;
using SentinelOps.Api.Domain;
using SentinelOps.Api.Persistence;
using SentinelOps.Api.Sync;

namespace SentinelOps.Api.Controllers;

[ApiController]
[Route("api/v1/sync")]
[EnableRateLimiting("sync")]
public sealed class SyncController(SentinelOpsDbContext db, IConfiguration configuration) : ControllerBase
{
    private const int MaxBatchSize = 100;
    private const int MaxPayloadBytes = 512 * 1024;
    private static readonly HashSet<string> AllowedEntityTypes =
        ["Client", "Project", "ProjectProgressNote", "Settings"];
    private string CursorSigningKey =>
        !string.IsNullOrWhiteSpace(configuration["Sync:CursorSigningKey"])
            ? configuration["Sync:CursorSigningKey"]!
            : throw new InvalidOperationException("Sync:CursorSigningKey must be configured.");

    [HttpPost("push")]
    public async Task<ActionResult<PushResponse>> Push(PushRequest request, CancellationToken cancellationToken)
    {
        if (request.Operations is null || request.Operations.Count > MaxBatchSize)
            return Problem(statusCode: 413, title: "Push batch is too large.");

        var identity = await AuthenticateAsync(request.DeviceId, cancellationToken);
        if (identity is null) return Unauthorized();

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var results = new List<PushOperationResult>(request.Operations.Count);
        foreach (var operation in request.Operations)
        {
            if (operation.OperationId == Guid.Empty || operation.EntityId == Guid.Empty ||
                string.IsNullOrWhiteSpace(operation.EntityType) ||
                operation.EntityType.Length > 80 || !AllowedEntityTypes.Contains(operation.EntityType) ||
                operation.Payload is null ||
                operation.Operation is not ("upsert" or "delete"))
            {
                results.Add(new(operation.OperationId, "rejected", ErrorCode: "invalid_operation",
                    Message: "The operation shape is invalid."));
                continue;
            }

            var existingResult = await db.SyncIdempotencyRecords.SingleOrDefaultAsync(
                x => x.OperationId == operation.OperationId, cancellationToken);
            if (existingResult is not null && (existingResult.BusinessId != identity.Value.BusinessId ||
                existingResult.DeviceId != identity.Value.DeviceId))
            {
                results.Add(new(operation.OperationId, "rejected", ErrorCode: "operation_id_in_use",
                    Message: "The operation ID is already associated with another device."));
                continue;
            }
            if (existingResult is not null)
            {
                results.Add(JsonSerializer.Deserialize<PushOperationResult>(existingResult.ResultJson)! with
                {
                    Status = "already_applied"
                });
                continue;
            }

            var payloadJson = JsonSerializer.Serialize(operation.Payload);
            if (Encoding.UTF8.GetByteCount(payloadJson) > MaxPayloadBytes)
            {
                results.Add(new(operation.OperationId, "rejected", ErrorCode: "payload_too_large",
                    Message: "The operation payload exceeds the permitted size."));
                continue;
            }

            var current = await db.SyncEntities.SingleOrDefaultAsync(x =>
                x.BusinessId == identity.Value.BusinessId && x.EntityType == operation.EntityType &&
                x.EntityId == operation.EntityId, cancellationToken);
            var tombstone = await db.EntityTombstones.SingleOrDefaultAsync(x =>
                x.BusinessId == identity.Value.BusinessId && x.EntityType == operation.EntityType &&
                x.EntityId == operation.EntityId, cancellationToken);
            if (current is not null && !string.Equals(current.Revision, operation.BaseRevision, StringComparison.Ordinal))
            {
                results.Add(new(operation.OperationId, "conflict", current.Revision, "stale_revision",
                    "The record changed on another device."));
                continue;
            }
            if (current is null && tombstone is not null &&
                !string.Equals(tombstone.Revision, operation.BaseRevision, StringComparison.Ordinal))
            {
                results.Add(new(operation.OperationId, "conflict", tombstone.Revision, "stale_revision",
                    "The record was deleted on another device."));
                continue;
            }

            var revision = Guid.NewGuid().ToString("N");
            if (operation.Operation == "delete")
            {
                if (current is not null) db.SyncEntities.Remove(current);
                if (tombstone is null)
                {
                    tombstone = new EntityTombstone
                    {
                        BusinessId = identity.Value.BusinessId, EntityType = operation.EntityType,
                        EntityId = operation.EntityId, Revision = string.Empty
                    };
                    db.EntityTombstones.Add(tombstone);
                }
                tombstone.Revision = revision;
                tombstone.DeletedAtUtc = DateTime.UtcNow;
            }
            else
            {
                if (tombstone is not null) db.EntityTombstones.Remove(tombstone);
                if (current is null)
                {
                    current = new SyncEntity
                    {
                        BusinessId = identity.Value.BusinessId, EntityType = operation.EntityType,
                        EntityId = operation.EntityId, Revision = revision,
                        PayloadJson = payloadJson, CreatedAtUtc = DateTime.UtcNow
                    };
                    db.SyncEntities.Add(current);
                }
                current.Revision = revision;
                current.PayloadJson = payloadJson;
                current.CreatedAtUtc = DateTime.UtcNow;
            }

            db.ChangeFeedEntries.Add(new ChangeFeedEntry
            {
                BusinessId = identity.Value.BusinessId,
                EntityType = operation.EntityType,
                EntityId = operation.EntityId,
                Operation = operation.Operation,
                Revision = revision,
                PayloadJson = operation.Operation == "delete" ? "{}" : payloadJson,
                CreatedAtUtc = DateTime.UtcNow
            });
            var result = new PushOperationResult(operation.OperationId, "accepted", revision);
            db.SyncIdempotencyRecords.Add(new SyncIdempotencyRecord
            {
                OperationId = operation.OperationId, BusinessId = identity.Value.BusinessId,
                DeviceId = identity.Value.DeviceId, ResultJson = JsonSerializer.Serialize(result),
                ProcessedAtUtc = DateTime.UtcNow
            });
            results.Add(result);
        }

        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return Ok(new PushResponse(results));
    }

    [HttpGet("changes")]
    public async Task<ActionResult<ChangesResponse>> Changes(
        [FromQuery] string? cursor, [FromQuery] int limit = 50, CancellationToken cancellationToken = default)
    {
        if (limit is < 1 or > MaxBatchSize) return Problem(statusCode: 400, title: "Limit must be between 1 and 100.");
        var deviceId = Request.Headers["X-Device-Id"].ToString();
        if (!Guid.TryParse(deviceId, out var parsedDeviceId)) return Unauthorized();
        var identity = await AuthenticateAsync(parsedDeviceId, cancellationToken);
        if (identity is null) return Unauthorized();

        var sequence = 0L;
        if (!string.IsNullOrWhiteSpace(cursor) &&
            (!CursorCodec.TryDecode(cursor, CursorSigningKey, out var decoded) ||
             decoded!.BusinessId != identity.Value.BusinessId))
            return Problem(statusCode: 400, title: "Cursor is invalid or belongs to another business.");
        if (CursorCodec.TryDecode(cursor, CursorSigningKey, out var decodedCursor))
            sequence = decodedCursor!.Sequence;

        var changes = await db.ChangeFeedEntries.AsNoTracking()
            .Where(x => x.BusinessId == identity.Value.BusinessId && x.Sequence > sequence)
            .OrderBy(x => x.Sequence).Take(limit).ToListAsync(cancellationToken);
        var next = changes.Count == 0 ? sequence : changes[^1].Sequence;
        return Ok(new ChangesResponse(changes.Select(x => new ChangeDto(
            x.Sequence, x.EntityType, x.EntityId, x.Operation, x.Revision,
            x.Operation == "delete" ? null : JsonSerializer.Deserialize<JsonElement>(x.PayloadJson),
            x.CreatedAtUtc)).ToList(), CursorCodec.Encode(new(identity.Value.BusinessId, next), CursorSigningKey)));
    }

    private async Task<(Guid BusinessId, Guid DeviceId)?> AuthenticateAsync(Guid deviceId, CancellationToken cancellationToken)
    {
        var presented = Request.Headers.Authorization.ToString();
        if (!presented.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)) return null;
        var token = presented["Bearer ".Length..].Trim();
        if (token.Length < 32) return null;
        var device = await db.RegisteredDevices.AsNoTracking().SingleOrDefaultAsync(
            x => x.Id == deviceId && x.RevokedAtUtc == null, cancellationToken);
        if (device is null || !CryptographicOperations.FixedTimeEquals(
            Convert.FromHexString(device.TokenHash), SHA256.HashData(Encoding.UTF8.GetBytes(token)))) return null;
        return (device.BusinessId, device.Id);
    }
}
