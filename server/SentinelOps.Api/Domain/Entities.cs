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
    public DateTime RegisteredAtUtc { get; set; }
    public DateTime? RevokedAtUtc { get; set; }
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