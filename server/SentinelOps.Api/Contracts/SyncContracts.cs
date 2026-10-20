namespace SentinelOps.Api.Contracts;

public sealed record PushRequest(Guid DeviceId, IReadOnlyList<PushOperation> Operations);

public sealed record PushOperation(
    Guid OperationId,
    string EntityType,
    Guid EntityId,
    string Operation,
    string? BaseRevision,
    object Payload);

public sealed record PushOperationResult(
    Guid OperationId,
    string Status,
    string? Revision = null,
    string? ErrorCode = null,
    string? Message = null);

public sealed record PushResponse(IReadOnlyList<PushOperationResult> Results);

public sealed record ChangeDto(
    long Sequence,
    string EntityType,
    Guid EntityId,
    string Operation,
    string Revision,
    object? Payload,
    DateTime CreatedAtUtc);

public sealed record ChangesResponse(
    IReadOnlyList<ChangeDto> Changes,
    string? NextCursor,
    bool ResyncRequired = false);

public sealed record RegisterDeviceRequest(Guid BusinessId, string BusinessName, string DeviceName);
public sealed record RegisterDeviceResponse(Guid BusinessId, Guid DeviceId, string DeviceToken);