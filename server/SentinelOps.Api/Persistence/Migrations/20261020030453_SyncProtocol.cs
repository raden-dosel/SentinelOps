using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SentinelOps.Api.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class SyncProtocol : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "TokenHash",
                table: "RegisteredDevices",
                type: "character varying(128)",
                maxLength: 128,
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateTable(
                name: "SyncEntities",
                columns: table => new
                {
                    BusinessId = table.Column<Guid>(type: "uuid", nullable: false),
                    EntityType = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    EntityId = table.Column<Guid>(type: "uuid", nullable: false),
                    Revision = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    PayloadJson = table.Column<string>(type: "jsonb", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SyncEntities", x => new { x.BusinessId, x.EntityType, x.EntityId });
                });

            migrationBuilder.CreateIndex(
                name: "IX_SyncEntities_BusinessId_CreatedAtUtc",
                table: "SyncEntities",
                columns: new[] { "BusinessId", "CreatedAtUtc" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "SyncEntities");

            migrationBuilder.DropColumn(
                name: "TokenHash",
                table: "RegisteredDevices");
        }
    }
}
