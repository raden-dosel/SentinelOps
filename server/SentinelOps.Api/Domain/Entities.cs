namespace SentinelOps.Api.Domain;

public sealed class Business
{
    public Guid Id { get; set; }
    public required string Name { get; set; }
    public DateTime CreatedAtUtc { get; set; }
    public ICollection<RegisteredDevice> Devices { get; set; } = [];
}

public sealed class RegisteredDevice
{
    public Guid Id { get; set; }
    public Guid BusinessId { get; set; }
    public required string Name { get; set; }
    public required string TokenHash { get; set; }
    public string Role { get; set; } = "Admin"; // Admin, Operations, Finance, ReadOnly
    public DateTime RegisteredAtUtc { get; set; }
    public DateTime? RevokedAtUtc { get; set; }
    public DateTime? LastSeenAtUtc { get; set; }
    public Business? Business { get; set; }
}

public sealed class SyncIdempotencyRecord
{
    public Guid OperationId { get; set; }
    public Guid BusinessId { get; set; }
    public Guid DeviceId { get; set; }
    public required string ResultJson { get; set; }
    public DateTime ProcessedAtUtc { get; set; }
}

public sealed class ChangeFeedEntry
{
    public long Sequence { get; set; }
    public Guid BusinessId { get; set; }
    public required string EntityType { get; set; }
    public Guid EntityId { get; set; }
    public required string Operation { get; set; }
    public required string Revision { get; set; }
    public required string PayloadJson { get; set; }
    public DateTime CreatedAtUtc { get; set; }
}

public sealed class EntityTombstone
{
    public Guid BusinessId { get; set; }
    public required string EntityType { get; set; }
    public Guid EntityId { get; set; }
    public required string Revision { get; set; }
    public long DeletionSequence { get; set; }
    public DateTime DeletedAtUtc { get; set; }
}

public sealed class SyncEntity
{
    public Guid BusinessId { get; set; }
    public required string EntityType { get; set; }
    public Guid EntityId { get; set; }
    public required string Revision { get; set; }
    public required string PayloadJson { get; set; }
    public DateTime CreatedAtUtc { get; set; }
}

public sealed class ProjectAttachment
{
    public Guid Id { get; set; }
    public Guid BusinessId { get; set; }
    public string ProjectId { get; set; } = string.Empty;
    public string ObjectKey { get; set; } = string.Empty;
    public string FileName { get; set; } = string.Empty;
    public string FileType { get; set; } = string.Empty;
    public long FileSize { get; set; }
    public string? ETag { get; set; }
    public string? ChecksumSha256 { get; set; }
    public string Status { get; set; } = "completed"; // pending, completed, failed, deleted
    public DateTime UploadedAtUtc { get; set; }
    public DateTime? DeletedAtUtc { get; set; }
}

public sealed class InvoiceRecord
{
    public Guid Id { get; set; }
    public Guid BusinessId { get; set; }
    public string InvoiceNumber { get; set; } = string.Empty;
    public Guid? ClientId { get; set; }
    public Guid? ProjectId { get; set; }
    public Guid? QuotationId { get; set; }
    public string Status { get; set; } = "DRAFT"; // DRAFT, ISSUED, PAID, PARTIALLY_PAID, OVERDUE, CANCELLED, VOID
    public long SubtotalCentavos { get; set; }
    public long DiscountCentavos { get; set; }
    public long TaxCentavos { get; set; }
    public long GrandTotalCentavos { get; set; }
    public long PaidAmountCentavos { get; set; }
    public long RemainingBalanceCentavos { get; set; }
    public DateTime IssueDate { get; set; }
    public DateTime DueDate { get; set; }
    public DateTime CreatedAtUtc { get; set; }
    public DateTime? UpdatedAtUtc { get; set; }
    public ICollection<PaymentRecord> Payments { get; set; } = [];
}

public sealed class PaymentRecord
{
    public Guid Id { get; set; }
    public Guid BusinessId { get; set; }
    public Guid InvoiceId { get; set; }
    public string PaymentNumber { get; set; } = string.Empty;
    public long AmountCentavos { get; set; }
    public string PaymentMethod { get; set; } = "CASH";
    public string? ReferenceNumber { get; set; }
    public DateTime PaymentDate { get; set; }
    public bool IsReversed { get; set; }
    public DateTime? ReversedAtUtc { get; set; }
    public string? ReversalReason { get; set; }
    public DateTime CreatedAtUtc { get; set; }
    public InvoiceRecord? Invoice { get; set; }
}

public sealed class ServerAuditEvent
{
    public Guid Id { get; set; }
    public Guid BusinessId { get; set; }
    public Guid? DeviceId { get; set; }
    public string Action { get; set; } = string.Empty;
    public string EntityType { get; set; } = string.Empty;
    public string EntityId { get; set; } = string.Empty;
    public string? DetailsJson { get; set; }
    public DateTime TimestampUtc { get; set; }
}

public sealed class DeviceRecoveryChallenge
{
    public Guid Id { get; set; }
    public Guid BusinessId { get; set; }
    public Guid DeviceId { get; set; }
    public required string CodeHash { get; set; }
    public DateTime CreatedAtUtc { get; set; }
    public DateTime ExpiresAtUtc { get; set; }
    public DateTime? UsedAtUtc { get; set; }
    public RegisteredDevice? Device { get; set; }
}