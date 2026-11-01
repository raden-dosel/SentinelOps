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

public sealed record SnapshotEntityDto(
    string EntityType,
    Guid EntityId,
    string Revision,
    object? Payload);

public sealed record SnapshotResponse(
    IReadOnlyList<SnapshotEntityDto> Entities,
    string SnapshotCursor,
    bool HasMore = false,
    string? ContinuationToken = null);

public sealed record RegisterDeviceRequest(Guid BusinessId, string BusinessName, string DeviceName, string? Role = "Admin");
public sealed record RegisterDeviceResponse(Guid BusinessId, Guid DeviceId, string DeviceToken, string Role = "Admin");
public sealed record DeviceSummaryDto(Guid Id, Guid BusinessId, string Name, string Role, DateTime RegisteredAtUtc, DateTime? RevokedAtUtc, DateTime? LastSeenAtUtc);

public sealed record IssueInvoiceCommand(Guid InvoiceId, string InvoiceNumber, long GrandTotalCentavos, DateTime IssueDate, DateTime DueDate);
public sealed record RecordPaymentCommand(Guid PaymentId, Guid InvoiceId, string PaymentNumber, long AmountCentavos, string PaymentMethod, DateTime PaymentDate);
public sealed record ReversePaymentCommand(Guid PaymentId, string Reason);

public sealed record RequestDeviceRecoveryResponse(Guid ChallengeId, string RecoveryAuthorizationCode, DateTime ExpiresAtUtc);
public sealed record VerifyDeviceRecoveryRequest(string RecoveryAuthorizationCode);
public sealed record VerifyDeviceRecoveryResponse(bool Verified, string Message, Guid DeviceId, Guid BusinessId);