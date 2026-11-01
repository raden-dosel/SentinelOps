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
    public DbSet<ProjectAttachment> ProjectAttachments => Set<ProjectAttachment>();
    public DbSet<InvoiceRecord> Invoices => Set<InvoiceRecord>();
    public DbSet<PaymentRecord> Payments => Set<PaymentRecord>();
    public DbSet<ServerAuditEvent> ServerAuditEvents => Set<ServerAuditEvent>();
    public DbSet<DeviceRecoveryChallenge> DeviceRecoveryChallenges => Set<DeviceRecoveryChallenge>();

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
            entity.Property(x => x.Role).HasMaxLength(32).HasDefaultValue("Admin");
            entity.Property(x => x.RegisteredAtUtc).HasColumnType("timestamp with time zone");
            entity.Property(x => x.RevokedAtUtc).HasColumnType("timestamp with time zone");
            entity.Property(x => x.LastSeenAtUtc).HasColumnType("timestamp with time zone");
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

        modelBuilder.Entity<ProjectAttachment>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.Property(x => x.ProjectId).HasMaxLength(128).IsRequired();
            entity.Property(x => x.ObjectKey).HasMaxLength(512).IsRequired();
            entity.Property(x => x.FileName).HasMaxLength(256).IsRequired();
            entity.Property(x => x.FileType).HasMaxLength(80).IsRequired();
            entity.Property(x => x.Status).HasMaxLength(32).IsRequired();
            entity.Property(x => x.UploadedAtUtc).HasColumnType("timestamp with time zone");
            entity.Property(x => x.DeletedAtUtc).HasColumnType("timestamp with time zone");
            entity.HasIndex(x => new { x.BusinessId, x.ProjectId, x.Status });
            entity.HasIndex(x => new { x.BusinessId, x.ObjectKey }).IsUnique();
        });

        modelBuilder.Entity<InvoiceRecord>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.Property(x => x.InvoiceNumber).HasMaxLength(80).IsRequired();
            entity.Property(x => x.Status).HasMaxLength(32).IsRequired();
            entity.Property(x => x.IssueDate).HasColumnType("timestamp with time zone");
            entity.Property(x => x.DueDate).HasColumnType("timestamp with time zone");
            entity.Property(x => x.CreatedAtUtc).HasColumnType("timestamp with time zone");
            entity.Property(x => x.UpdatedAtUtc).HasColumnType("timestamp with time zone");
            entity.HasIndex(x => new { x.BusinessId, x.InvoiceNumber }).IsUnique();
            entity.HasIndex(x => new { x.BusinessId, x.Status });
        });

        modelBuilder.Entity<PaymentRecord>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.Property(x => x.PaymentNumber).HasMaxLength(80).IsRequired();
            entity.Property(x => x.PaymentMethod).HasMaxLength(50).IsRequired();
            entity.Property(x => x.ReferenceNumber).HasMaxLength(100);
            entity.Property(x => x.ReversalReason).HasMaxLength(256);
            entity.Property(x => x.PaymentDate).HasColumnType("timestamp with time zone");
            entity.Property(x => x.ReversedAtUtc).HasColumnType("timestamp with time zone");
            entity.Property(x => x.CreatedAtUtc).HasColumnType("timestamp with time zone");
            entity.HasIndex(x => new { x.BusinessId, x.PaymentNumber }).IsUnique();
            entity.HasIndex(x => new { x.BusinessId, x.InvoiceId });
            entity.HasOne(x => x.Invoice).WithMany(x => x.Payments).HasForeignKey(x => x.InvoiceId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<ServerAuditEvent>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Action).HasMaxLength(80).IsRequired();
            entity.Property(x => x.EntityType).HasMaxLength(80).IsRequired();
            entity.Property(x => x.EntityId).HasMaxLength(128).IsRequired();
            entity.Property(x => x.DetailsJson).HasColumnType("jsonb");
            entity.Property(x => x.TimestampUtc).HasColumnType("timestamp with time zone");
            entity.HasIndex(x => new { x.BusinessId, x.TimestampUtc });
        });

        modelBuilder.Entity<DeviceRecoveryChallenge>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.Property(x => x.CodeHash).HasMaxLength(128).IsRequired();
            entity.Property(x => x.CreatedAtUtc).HasColumnType("timestamp with time zone");
            entity.Property(x => x.ExpiresAtUtc).HasColumnType("timestamp with time zone");
            entity.Property(x => x.UsedAtUtc).HasColumnType("timestamp with time zone");
            entity.HasIndex(x => new { x.DeviceId, x.ExpiresAtUtc, x.UsedAtUtc });
            entity.HasOne(x => x.Device).WithMany().HasForeignKey(x => x.DeviceId);
        });
    }
}