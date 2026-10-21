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
| P0-1 | Critical | `src/storage/database.ts` migration callback | Confirmed | Moved v2 store creation outside the v1-only block so upgrades from an existing v1 database receive `syncOutbox`, `syncMetadata`, and `syncConflicts`. | Type-check and frontend tests pass; browser upgrade fixture not available. | Blocker until a real v1 IndexedDB upgrade test passes. |
| P0-2 | Critical | `src/storage/repositories.ts`, `src/services/syncService.ts` | Confirmed | No safe narrow wiring was possible without changing every repository transaction and defining domain payload contracts. | Existing tests do not cover it. | Blocker: local writes can remain unsynchronized. |
| P0-3 | Critical | `server/SentinelOps.Api/Controllers/SyncController.cs` | Confirmed | Restricted generic sync to `Client`, `Project`, `ProjectProgressNote`, and `Settings`; financial, attachment, quotation, and audit payloads are rejected until typed server rules exist. | API tests pass; endpoint integration test is still required. | Blocker for broad business sync scope. |
| P0-4 | Critical | `server/SentinelOps.Api/Controllers/SyncController.cs`, `Sync/CursorCodec.cs` | Confirmed | Added HMAC signing for cursors and required `Sync:CursorSigningKey`. | Cursor round-trip and tamper tests pass. | Requires production secret provisioning and endpoint test. |
| P1-1 | High | `src/services/syncService.ts` | Confirmed | Not changed: callback application and cursor write are separate operations. | Not run. | Blocker until one IndexedDB transaction owns both operations. |
| P1-2 | High | `server/SentinelOps.Api/Persistence/Migrations/` | Partially verified | Migration chain exists. | EF migration execution against PostgreSQL was not run in this environment. | Blocked pending disposable PostgreSQL migration test. |
| P1-3 | High | `src/services/backupService.ts` | Confirmed | Browser export/import exists, but no encrypted off-host backup or restore drill exists. | Not run. | Production recovery blocker. |
| P1-4 | Medium | `server/docker-compose.yml` | Confirmed | Bound the local PostgreSQL port to loopback rather than all interfaces. | Configuration diff reviewed. | Production topology still needs private networking and TLS. |
| P2-1 | Medium | `Program.cs`, `appsettings*.json` | Partially verified | Required connection string and registration/cursor secrets fail closed; CORS is explicit and readiness checks PostgreSQL. | Build/tests pass; production proxy smoke test not run. | Requires deployment smoke test and forwarded-header policy. |

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

