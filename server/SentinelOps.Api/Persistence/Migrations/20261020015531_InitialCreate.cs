using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace SentinelOps.Api.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Businesses",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Businesses", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ChangeFeedEntries",
                columns: table => new
                {
                    Sequence = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    BusinessId = table.Column<Guid>(type: "uuid", nullable: false),
                    EntityType = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    EntityId = table.Column<Guid>(type: "uuid", nullable: false),
                    Operation = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Revision = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    PayloadJson = table.Column<string>(type: "jsonb", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ChangeFeedEntries", x => x.Sequence);
                });

            migrationBuilder.CreateTable(
                name: "EntityTombstones",
                columns: table => new
                {
                    BusinessId = table.Column<Guid>(type: "uuid", nullable: false),
                    EntityType = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    EntityId = table.Column<Guid>(type: "uuid", nullable: false),
                    Revision = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    DeletionSequence = table.Column<long>(type: "bigint", nullable: false),
                    DeletedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EntityTombstones", x => new { x.BusinessId, x.EntityType, x.EntityId });
                });

            migrationBuilder.CreateTable(
                name: "SyncIdempotencyRecords",
                columns: table => new
                {
                    OperationId = table.Column<Guid>(type: "uuid", nullable: false),
                    BusinessId = table.Column<Guid>(type: "uuid", nullable: false),
                    DeviceId = table.Column<Guid>(type: "uuid", nullable: false),
                    ResultJson = table.Column<string>(type: "jsonb", nullable: false),
                    ProcessedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SyncIdempotencyRecords", x => x.OperationId);
                });

            migrationBuilder.CreateTable(
                name: "RegisteredDevices",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    BusinessId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    RegisteredAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    RevokedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RegisteredDevices", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RegisteredDevices_Businesses_BusinessId",
                        column: x => x.BusinessId,
                        principalTable: "Businesses",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ChangeFeedEntries_BusinessId_EntityType_EntityId_Sequence",
                table: "ChangeFeedEntries",
                columns: new[] { "BusinessId", "EntityType", "EntityId", "Sequence" });

            migrationBuilder.CreateIndex(
                name: "IX_ChangeFeedEntries_BusinessId_Sequence",
                table: "ChangeFeedEntries",
                columns: new[] { "BusinessId", "Sequence" });

            migrationBuilder.CreateIndex(
                name: "IX_EntityTombstones_BusinessId_DeletionSequence",
                table: "EntityTombstones",
                columns: new[] { "BusinessId", "DeletionSequence" });

            migrationBuilder.CreateIndex(
                name: "IX_RegisteredDevices_BusinessId_RevokedAtUtc",
                table: "RegisteredDevices",
                columns: new[] { "BusinessId", "RevokedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_SyncIdempotencyRecords_BusinessId_DeviceId_ProcessedAtUtc",
                table: "SyncIdempotencyRecords",
                columns: new[] { "BusinessId", "DeviceId", "ProcessedAtUtc" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ChangeFeedEntries");

            migrationBuilder.DropTable(
                name: "EntityTombstones");

            migrationBuilder.DropTable(
                name: "RegisteredDevices");

            migrationBuilder.DropTable(
                name: "SyncIdempotencyRecords");

            migrationBuilder.DropTable(
                name: "Businesses");
        }
    }
}
