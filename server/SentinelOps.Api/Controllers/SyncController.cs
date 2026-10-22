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
        ["Client", "Quotation", "QuotationRevision", "Invoice", "Payment", "Project",
            "ProjectProgressNote", "Attachment", "AuditEvent", "Settings"];
    private string CursorSigningKey =>
        configuration["Sync:CursorSigningKey"]
        ?? configuration["SYNC_CURSOR_SIGNING_KEY"]
        ?? "SentinelOps_Authenticated_Cursor_Key_v1_Fallback";

    private static readonly HashSet<string> AllowedLeadStatuses =
        ["New Inquiry", "Contacted", "Site Visit Scheduled", "Site Visit Completed",
            "Proposal Sent", "Negotiation", "Won", "Lost", "Inactive"];

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

            // Optimistic concurrency base-revision validation
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

            // Server-side Domain Validation & Financial Invariant Enforcement
            if (operation.Operation == "upsert")
            {
                using var jsonDoc = JsonDocument.Parse(payloadJson);
                var root = jsonDoc.RootElement;
                if (!ValidateDomainOperation(operation.EntityType, root, current, out var valError, out var valMessage))
                {
                    results.Add(new(operation.OperationId, "rejected", ErrorCode: valError, Message: valMessage));
                    continue;
                }
            }

            var revision = Guid.NewGuid().ToString("N");
            if (operation.Operation == "delete")
            {
                if (current is not null) db.SyncEntities.Remove(current);
                if (tombstone is null)
                {
                    tombstone = new EntityTombstone
                    {
                        BusinessId = identity.Value.BusinessId,
                        EntityType = operation.EntityType,
                        EntityId = operation.EntityId,
                        Revision = string.Empty
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
                        BusinessId = identity.Value.BusinessId,
                        EntityType = operation.EntityType,
                        EntityId = operation.EntityId,
                        Revision = revision,
                        PayloadJson = payloadJson,
                        CreatedAtUtc = DateTime.UtcNow
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
                OperationId = operation.OperationId,
                BusinessId = identity.Value.BusinessId,
                DeviceId = identity.Value.DeviceId,
                ResultJson = JsonSerializer.Serialize(result),
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
        if (!string.IsNullOrWhiteSpace(cursor))
        {
            if (!CursorCodec.TryDecode(cursor, CursorSigningKey, out var decoded) ||
                decoded!.BusinessId != identity.Value.BusinessId)
            {
                return Problem(statusCode: 400, title: "Cursor is invalid, forged, or belongs to another business.");
            }
            sequence = decoded.Sequence;
        }

        var changes = await db.ChangeFeedEntries.AsNoTracking()
            .Where(x => x.BusinessId == identity.Value.BusinessId && x.Sequence > sequence)
            .OrderBy(x => x.Sequence).Take(limit).ToListAsync(cancellationToken);
        var next = changes.Count == 0 ? sequence : changes[^1].Sequence;
        return Ok(new ChangesResponse(changes.Select(x => new ChangeDto(
            x.Sequence, x.EntityType, x.EntityId, x.Operation, x.Revision,
            x.Operation == "delete" ? null : JsonSerializer.Deserialize<JsonElement>(x.PayloadJson),
            x.CreatedAtUtc)).ToList(),
            CursorCodec.Encode(new(identity.Value.BusinessId, next), CursorSigningKey)));
    }

    [HttpGet("snapshot")]
    public async Task<ActionResult<SnapshotResponse>> Snapshot(
        [FromQuery] int limit = 500, CancellationToken cancellationToken = default)
    {
        var deviceId = Request.Headers["X-Device-Id"].ToString();
        if (!Guid.TryParse(deviceId, out var parsedDeviceId)) return Unauthorized();
        var identity = await AuthenticateAsync(parsedDeviceId, cancellationToken);
        if (identity is null) return Unauthorized();

        var entities = await db.SyncEntities.AsNoTracking()
            .Where(x => x.BusinessId == identity.Value.BusinessId)
            .Take(limit)
            .ToListAsync(cancellationToken);

        var maxSeq = await db.ChangeFeedEntries.AsNoTracking()
            .Where(x => x.BusinessId == identity.Value.BusinessId)
            .MaxAsync(x => (long?)x.Sequence, cancellationToken) ?? 0L;

        var snapshotCursor = CursorCodec.Encode(new(identity.Value.BusinessId, maxSeq), CursorSigningKey);

        return Ok(new SnapshotResponse(
            entities.Select(x => new SnapshotEntityDto(
                x.EntityType,
                x.EntityId,
                x.Revision,
                JsonSerializer.Deserialize<JsonElement>(x.PayloadJson)
            )).ToList(),
            snapshotCursor,
            HasMore: entities.Count >= limit
        ));
    }

    private static bool ValidateDomainOperation(
        string entityType,
        JsonElement payload,
        SyncEntity? current,
        out string? errorCode,
        out string? errorMessage)
    {
        errorCode = null;
        errorMessage = null;

        switch (entityType)
        {
            case "Client":
                if (!payload.TryGetProperty("name", out var clientName) ||
                    string.IsNullOrWhiteSpace(clientName.GetString()) ||
                    clientName.GetString()!.Length > 200)
                {
                    errorCode = "invalid_client_name";
                    errorMessage = "Client name is required and must not exceed 200 characters.";
                    return false;
                }
                if (payload.TryGetProperty("leadStatus", out var leadStatus) &&
                    !string.IsNullOrWhiteSpace(leadStatus.GetString()) &&
                    !AllowedLeadStatuses.Contains(leadStatus.GetString()!))
                {
                    errorCode = "invalid_lead_status";
                    errorMessage = $"Lead status '{leadStatus.GetString()}' is not a recognized workflow state.";
                    return false;
                }
                return true;

            case "Quotation":
                if (!payload.TryGetProperty("quotationNumber", out var qNum) || string.IsNullOrWhiteSpace(qNum.GetString()))
                {
                    errorCode = "missing_quotation_number";
                    errorMessage = "Quotation number is required.";
                    return false;
                }
                if (payload.TryGetProperty("grandTotalCentavos", out var qGrandTotal) && qGrandTotal.GetInt64() < 0)
                {
                    errorCode = "negative_quotation_total";
                    errorMessage = "Quotation grand total cannot be negative.";
                    return false;
                }
                return true;

            case "QuotationRevision":
                if (!payload.TryGetProperty("quotationId", out _) || !payload.TryGetProperty("revisionNumber", out _))
                {
                    errorCode = "invalid_revision";
                    errorMessage = "Quotation revision requires quotationId and revisionNumber.";
                    return false;
                }
                return true;

            case "Invoice":
                if (!payload.TryGetProperty("invoiceNumber", out var invNum) || string.IsNullOrWhiteSpace(invNum.GetString()))
                {
                    errorCode = "missing_invoice_number";
                    errorMessage = "Invoice number is required.";
                    return false;
                }
                var grandTotal = payload.TryGetProperty("grandTotalCentavos", out var gt) ? gt.GetInt64() : 0L;
                var paidAmount = payload.TryGetProperty("paidAmountCentavos", out var pa) ? pa.GetInt64() : 0L;
                var remaining = payload.TryGetProperty("remainingBalanceCentavos", out var rb) ? rb.GetInt64() : 0L;

                if (grandTotal < 0 || paidAmount < 0 || remaining < 0)
                {
                    errorCode = "negative_financial_amount";
                    errorMessage = "Invoice amounts (grand total, paid, remaining balance) cannot be negative.";
                    return false;
                }

                // Balance invariant check
                var expectedRemaining = Math.Max(0, grandTotal - paidAmount);
                if (remaining != expectedRemaining)
                {
                    errorCode = "balance_invariant_violation";
                    errorMessage = $"Remaining balance ({remaining}) does not match grand total ({grandTotal}) minus paid ({paidAmount}).";
                    return false;
                }

                // Financial protection: Cannot reduce total below already paid amount
                if (current is not null)
                {
                    using var currentDoc = JsonDocument.Parse(current.PayloadJson);
                    var currentPaid = currentDoc.RootElement.TryGetProperty("paidAmountCentavos", out var cp) ? cp.GetInt64() : 0L;
                    if (grandTotal < currentPaid)
                    {
                        errorCode = "invalid_total_reduction";
                        errorMessage = "Cannot reduce invoice grand total below collected payments.";
                        return false;
                    }
                }
                return true;

            case "Payment":
                if (!payload.TryGetProperty("paymentNumber", out var payNum) || string.IsNullOrWhiteSpace(payNum.GetString()))
                {
                    errorCode = "missing_payment_number";
                    errorMessage = "Payment number is required.";
                    return false;
                }
                if (!payload.TryGetProperty("amountCentavos", out var payAmt) || payAmt.GetInt64() <= 0)
                {
                    errorCode = "invalid_payment_amount";
                    errorMessage = "Payment amount must be greater than zero centavos.";
                    return false;
                }
                return true;

            case "Project":
                if (!payload.TryGetProperty("projectNumber", out var prjNum) || string.IsNullOrWhiteSpace(prjNum.GetString()))
                {
                    errorCode = "missing_project_number";
                    errorMessage = "Project number is required.";
                    return false;
                }
                return true;

            case "Attachment":
                if (payload.TryGetProperty("fileSize", out var fSize) && fSize.GetInt64() > 15 * 1024 * 1024)
                {
                    errorCode = "attachment_too_large";
                    errorMessage = "Attachment file size exceeds 15 MB threshold.";
                    return false;
                }
                return true;

            case "Settings":
                // Strictly disallow passwords, secrets, and auth tokens from being synced
                if (payload.TryGetProperty("password", out _) ||
                    payload.TryGetProperty("passwordHash", out _) ||
                    payload.TryGetProperty("salt", out _) ||
                    payload.TryGetProperty("token", out _))
                {
                    errorCode = "forbidden_settings_payload";
                    errorMessage = "Authentication credentials and passwords must never be synchronized.";
                    return false;
                }
                return true;

            default:
                return true;
        }
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
