# Phase 2 Remediation Log

Audit/remediation date: 2026-10-21

## Completed

1. Corrected the IndexedDB version-2 migration guard (`src/storage/database.ts`). Existing version-1 databases now receive `syncOutbox`, `syncMetadata`, `syncConflicts`, and `syncConfig` stores without data loss (verified by `tests/migrations.test.ts`).
2. Implemented transactional outbox enqueue (`src/storage/repositories.ts`) across client, quotation, invoice, payment, and settings repositories, ensuring local business writes and sync operations commit atomically (verified by `tests/outbox.test.ts`).
3. Added server-side domain and financial validation (`ValidateDomainOperation` in `server/SentinelOps.Api/Controllers/SyncController.cs`) for Invoices, Payments, Quotations, and Clients, enforcing balance invariants and blocking negative amounts and credential leakage.
4. HMAC-signed sync cursors with SHA-256 (`server/SentinelOps.Api/Sync/CursorCodec.cs`), strictly rejecting 1-part or tampered cursors with constant-time comparison (verified by `server/SentinelOps.Api.Tests/CursorCodecTests.cs`).
5. Unified device token comparison using fixed-length SHA-256 digests (`server/SentinelOps.Api/Controllers/DeviceController.cs`) for Register, Revoke, and List endpoints.
6. Atomic pull application and cursor advancement (`syncCoordinator.applyChangesAtomically` and `syncService.pullSyncChanges`) inside a single IndexedDB transaction.
7. Enforced fail-closed validation for `Sync:CursorSigningKey` and `Sync:RegistrationToken` in production environment (`Program.cs`).
8. Restricted local Docker Compose PostgreSQL exposure to loopback (`127.0.0.1:5432`).
9. Resolved Vite dev server pre-warming crash by stabilizing server configuration without `watch: null` and ensuring robust background process lifecycle.

## Remaining Non-Repository Blockers (External Operator Actions)

1. Live PostgreSQL migration and rollback drills against disposable cloud PostgreSQL instance (Neon / Supabase) before touching production data.
2. Production off-host automated backup drills with WAL archiving and restore validation drills.
3. Secret provisioning: Operator must generate high-entropy strings (>32 chars) for `Sync__CursorSigningKey` and `Sync__RegistrationToken`.

## Operator actions before a controlled pilot

- Generate distinct high-entropy values for `ConnectionStrings__SentinelOps`,
  `Sync__RegistrationToken`, and `Sync__CursorSigningKey`.
- Run migrations with a separate migration identity, then run the API with a
  least-privilege runtime identity.
- Configure explicit HTTPS frontend origins in `Cors__AllowedOrigins`.
- Execute a disposable-database migration test and an isolated restore drill.
- Register test devices, verify revocation, and run push/pull retry tests with
  two independent browser profiles.

