using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SentinelOps.Api.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class DeviceRecoveryChallenges : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "DeviceRecoveryChallenges",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    BusinessId = table.Column<Guid>(type: "uuid", nullable: false),
                    DeviceId = table.Column<Guid>(type: "uuid", nullable: false),
                    CodeHash = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ExpiresAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UsedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DeviceRecoveryChallenges", x => x.Id);
                    table.ForeignKey(
                        name: "FK_DeviceRecoveryChallenges_RegisteredDevices_DeviceId",
                        column: x => x.DeviceId,
                        principalTable: "RegisteredDevices",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_DeviceRecoveryChallenges_DeviceId_ExpiresAtUtc_UsedAtUtc",
                table: "DeviceRecoveryChallenges",
                columns: new[] { "DeviceId", "ExpiresAtUtc", "UsedAtUtc" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "DeviceRecoveryChallenges");
        }
    }
}
