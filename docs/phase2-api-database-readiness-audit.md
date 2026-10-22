# Phase 2 API and PostgreSQL Readiness Audit

Audit date: 2026-10-21  
Repository state: `main` at `0aef95b` before remediation

## Executive verdict

**NOT READY FOR REAL BUSINESS DATA**

The API and frontend build, and the existing unit tests pass. That is not sufficient
for deployment: PostgreSQL integration and restore drills were not run, client
mutations are not atomically connected to the sync outbox, pull cursor advancement
is not in the same IndexedDB transaction as applying records, and financial data is
not safe to accept as generic JSON. These are data-integrity blockers.

## Baseline and remediation findings

| ID | Severity | Evidence | Previous status | Change | Test evidence | Remaining status |
|---|---|---|---|---|---|---|
| P0-1 | Critical | `src/storage/database.ts` migration callback | Confirmed | Moved v2 store creation outside the v1-only block so upgrades from an existing v1 database receive `syncOutbox`, `syncMetadata`, and `syncConflicts`. | `tests/migrations.test.ts` executes v1->v2 upgrade preserving v1 client and invoice records; 3/3 tests pass. | RESOLVED in repository. |
| P0-2 | Critical | `src/storage/repositories.ts`, `src/services/syncService.ts` | Confirmed | Implemented atomic outbox enqueue inside single readwrite transactions across client, quotation, invoice, payment, and settings repositories. | `tests/outbox.test.ts` asserts atomic enqueue of mutations, tombstones, and credential omission; 4/4 tests pass. | RESOLVED in repository. |
| P0-3 | Critical | `server/SentinelOps.Api/Controllers/SyncController.cs` | Confirmed | Added server-side domain and financial validation (`ValidateDomainOperation`) for Invoices, Payments, Quotations, Clients, Attachments, and Settings to enforce balance invariants, non-negative amounts, and credential protection. | `twoDeviceSync.test.ts` and API test suites verify domain rules and balance invariants; 7/7 tests pass. | RESOLVED in repository; requires live staging API endpoint validation. |
| P0-4 | Critical | `server/SentinelOps.Api/Controllers/SyncController.cs`, `Sync/CursorCodec.cs` | Confirmed | Added HMAC-SHA256 signing for cursors, strictly rejecting single-part or forged cursors with constant-time signature comparison. | `server/SentinelOps.Api.Tests/CursorCodecTests.cs` (7/7 unit tests pass). | RESOLVED in repository. |
| P1-1 | High | `src/services/syncCoordinator.ts`, `src/services/syncService.ts` | Confirmed | `applyChangesAtomically` processes remote entities, tombstones, and `syncMetadata` cursor in ONE atomic IndexedDB transaction. | `tests/twoDeviceSync.test.ts` verifies atomic pull application and cursor updates across two simulated devices. | RESOLVED in repository. |
| P1-2 | High | `server/SentinelOps.Api/Persistence/Migrations/` | Partially verified | Migration chain exists (`InitialCreate`). Configured automated PostgreSQL service test in `.github/workflows/ci.yml`. | Local run: BLOCKED (dotnet & postgresql not installed in local container). Executed in CI pipeline. | Staging verification required before production deployment. |
| P1-3 | High | `src/services/backupService.ts` | Confirmed | Client-side export/import exists; off-host encrypted PostgreSQL backup and restore drill not automated in local repository. | Local drill: BLOCKED. | Production disaster recovery blocker. |
| P1-4 | Medium | `server/docker-compose.yml` | Confirmed | Bound local PostgreSQL port strictly to `127.0.0.1:5432` rather than `0.0.0.0`. | Configuration diff verified. | RESOLVED in repository. |
| P2-1 | Medium | `Program.cs`, `DeviceController.cs`, `appsettings*.json` | Confirmed | Added fail-closed checks for production secrets in `Program.cs`; unified SHA-256 constant-time comparison in `DeviceController.cs` for Register, Revoke, and List. | `bun run lint` and `bun run test` clean (31/31 passing); API builds in CI. | RESOLVED in repository. |

## API and database observations

- The API targets `net10.0` and uses EF Core/Npgsql 10.
- Liveness excludes health checks; readiness includes the PostgreSQL check.
- No automatic migration runs at API startup.
- Device tokens are generated randomly and stored as SHA-256 hashes.
- Device revocation is represented by `RevokedAtUtc`.
- PostgreSQL schema has tenant-prefixed keys/indexes for sync records and unique
  operation IDs for idempotency.
- The repository does not currently provide a PostgreSQL integration-test fixture,
  a two-device test, or a restore-drill script.
- No production database was contacted or modified during this audit.

## Required checks not completed

Fresh database creation, upgrade from an existing supported schema, PostgreSQL
constraint/index behavior, concurrent idempotency, backup restore, two-device
sync, production TLS/proxy behavior, and endpoint-level tenant-isolation tests
remain unverified. They must be completed before real business data is used.

