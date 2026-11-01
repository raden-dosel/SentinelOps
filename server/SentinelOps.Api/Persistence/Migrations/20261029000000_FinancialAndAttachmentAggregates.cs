using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SentinelOps.Api.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class FinancialAndAttachmentAggregates : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Role",
                table: "RegisteredDevices",
                type: "character varying(32)",
                maxLength: 32,
                nullable: false,
                defaultValue: "Admin");

            migrationBuilder.AddColumn<DateTime>(
                name: "LastSeenAtUtc",
                table: "RegisteredDevices",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ProjectAttachments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    BusinessId = table.Column<Guid>(type: "uuid", nullable: false),
                    ProjectId = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    ObjectKey = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: false),
                    FileName = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    FileType = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    FileSize = table.Column<long>(type: "bigint", nullable: false),
                    ETag = table.Column<string>(type: "text", nullable: true),
                    ChecksumSha256 = table.Column<string>(type: "text", nullable: true),
                    Status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    UploadedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    DeletedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProjectAttachments", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Invoices",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    BusinessId = table.Column<Guid>(type: "uuid", nullable: false),
                    InvoiceNumber = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    ClientId = table.Column<Guid>(type: "uuid", nullable: true),
                    ProjectId = table.Column<Guid>(type: "uuid", nullable: true),
                    QuotationId = table.Column<Guid>(type: "uuid", nullable: true),
                    Status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    SubtotalCentavos = table.Column<long>(type: "bigint", nullable: false),
                    DiscountCentavos = table.Column<long>(type: "bigint", nullable: false),
                    TaxCentavos = table.Column<long>(type: "bigint", nullable: false),
                    GrandTotalCentavos = table.Column<long>(type: "bigint", nullable: false),
                    PaidAmountCentavos = table.Column<long>(type: "bigint", nullable: false),
                    RemainingBalanceCentavos = table.Column<long>(type: "bigint", nullable: false),
                    IssueDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    DueDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Invoices", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Payments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    BusinessId = table.Column<Guid>(type: "uuid", nullable: false),
                    InvoiceId = table.Column<Guid>(type: "uuid", nullable: false),
                    PaymentNumber = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    AmountCentavos = table.Column<long>(type: "bigint", nullable: false),
                    PaymentMethod = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    ReferenceNumber = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    ReversalReason = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    PaymentDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    IsReversed = table.Column<bool>(type: "boolean", nullable: false),
                    ReversedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Payments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Payments_Invoices_InvoiceId",
                        column: x => x.InvoiceId,
                        principalTable: "Invoices",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ServerAuditEvents",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    BusinessId = table.Column<Guid>(type: "uuid", nullable: false),
                    DeviceId = table.Column<Guid>(type: "uuid", nullable: true),
                    Action = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    EntityType = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    EntityId = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    DetailsJson = table.Column<string>(type: "jsonb", nullable: true),
                    TimestampUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ServerAuditEvents", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ProjectAttachments_BusinessId_ObjectKey",
                table: "ProjectAttachments",
                columns: new[] { "BusinessId", "ObjectKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ProjectAttachments_BusinessId_ProjectId_Status",
                table: "ProjectAttachments",
                columns: new[] { "BusinessId", "ProjectId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_Invoices_BusinessId_InvoiceNumber",
                table: "Invoices",
                columns: new[] { "BusinessId", "InvoiceNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Invoices_BusinessId_Status",
                table: "Invoices",
                columns: new[] { "BusinessId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_Payments_BusinessId_InvoiceId",
                table: "Payments",
                columns: new[] { "BusinessId", "InvoiceId" });

            migrationBuilder.CreateIndex(
                name: "IX_Payments_BusinessId_PaymentNumber",
                table: "Payments",
                columns: new[] { "BusinessId", "PaymentNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ServerAuditEvents_BusinessId_TimestampUtc",
                table: "ServerAuditEvents",
                columns: new[] { "BusinessId", "TimestampUtc" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "ServerAuditEvents");
            migrationBuilder.DropTable(name: "Payments");
            migrationBuilder.DropTable(name: "Invoices");
            migrationBuilder.DropTable(name: "ProjectAttachments");
            migrationBuilder.DropColumn(name: "LastSeenAtUtc", table: "RegisteredDevices");
            migrationBuilder.DropColumn(name: "Role", table: "RegisteredDevices");
        }
    }
}
