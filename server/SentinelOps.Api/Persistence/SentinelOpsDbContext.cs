using Microsoft.EntityFrameworkCore;
using SentinelOps.Api.Domain;

namespace SentinelOps.Api.Persistence;

public sealed class SentinelOpsDbContext(DbContextOptions<SentinelOpsDbContext> options) : DbContext(options)
{
    public DbSet<Business> Businesses => Set<Business>();
    public DbSet<RegisteredDevice> RegisteredDevices => Set<RegisteredDevice>();
    public DbSet<SyncIdempotencyRecord> SyncIdempotencyRecords => Set<SyncIdempotencyRecord>();
    public DbSet<ChangeFeedEntry> ChangeFeedEntries => Set<ChangeFeedEntry>();
    public DbSet<EntityTombstone> EntityTombstones => Set<EntityTombstone>();
    public DbSet<SyncEntity> SyncEntities => Set<SyncEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Business>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Name).HasMaxLength(200).IsRequired();
            entity.Property(x => x.CreatedAtUtc).HasColumnType("timestamp with time zone");
        });

        modelBuilder.Entity<RegisteredDevice>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Name).HasMaxLength(200).IsRequired();
            entity.Property(x => x.RegisteredAtUtc).HasColumnType("timestamp with time zone");
            entity.Property(x => x.RevokedAtUtc).HasColumnType("timestamp with time zone");
            entity.Property(x => x.TokenHash).HasMaxLength(128).IsRequired();
            entity.HasIndex(x => new { x.BusinessId, x.RevokedAtUtc });
            entity.HasOne(x => x.Business).WithMany(x => x.Devices).HasForeignKey(x => x.BusinessId);
        });

        modelBuilder.Entity<SyncIdempotencyRecord>(entity =>
        {
            entity.HasKey(x => x.OperationId);
            entity.Property(x => x.ResultJson).HasColumnType("jsonb").IsRequired();
            entity.Property(x => x.ProcessedAtUtc).HasColumnType("timestamp with time zone");
            entity.HasIndex(x => new { x.BusinessId, x.DeviceId, x.ProcessedAtUtc });
        });

        modelBuilder.Entity<ChangeFeedEntry>(entity =>
        {
            entity.HasKey(x => x.Sequence);
            entity.Property(x => x.EntityType).HasMaxLength(80).IsRequired();
            entity.Property(x => x.Operation).HasMaxLength(32).IsRequired();
            entity.Property(x => x.Revision).HasMaxLength(128).IsRequired();
            entity.Property(x => x.PayloadJson).HasColumnType("jsonb").IsRequired();
            entity.Property(x => x.CreatedAtUtc).HasColumnType("timestamp with time zone");
            entity.HasIndex(x => new { x.BusinessId, x.Sequence });
            entity.HasIndex(x => new { x.BusinessId, x.EntityType, x.EntityId, x.Sequence });
        });

        modelBuilder.Entity<EntityTombstone>(entity =>
        {
            entity.HasKey(x => new { x.BusinessId, x.EntityType, x.EntityId });
            entity.Property(x => x.EntityType).HasMaxLength(80).IsRequired();
            entity.Property(x => x.Revision).HasMaxLength(128).IsRequired();
            entity.Property(x => x.DeletedAtUtc).HasColumnType("timestamp with time zone");
            entity.HasIndex(x => new { x.BusinessId, x.DeletionSequence });
        });

        modelBuilder.Entity<SyncEntity>(entity =>
        {
            entity.HasKey(x => new { x.BusinessId, x.EntityType, x.EntityId });
            entity.Property(x => x.EntityType).HasMaxLength(80).IsRequired();
            entity.Property(x => x.Revision).HasMaxLength(128).IsRequired();
            entity.Property(x => x.PayloadJson).HasColumnType("jsonb").IsRequired();
            entity.Property(x => x.CreatedAtUtc).HasColumnType("timestamp with time zone");
            entity.HasIndex(x => new { x.BusinessId, x.CreatedAtUtc });
        });
    }
}