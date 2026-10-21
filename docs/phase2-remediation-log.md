# Phase 2 Remediation Log

Audit/remediation date: 2026-10-21

## Completed

1. Corrected the IndexedDB version-2 migration guard. Existing version-1 users now
   receive all sync stores during upgrade.
2. Replaced registration-token comparison with fixed-length SHA-256 comparisons,
   avoiding a length-mismatch exception and preserving constant-time comparison.
3. HMAC-signed sync cursors and added a required `Sync:CursorSigningKey`.
4. Restricted generic server synchronization to non-financial records whose typed
   domain rules are not being claimed by this API slice.
5. Restricted local Compose PostgreSQL exposure to `127.0.0.1`.

## Intentionally not completed

- Repository mutations still need transaction-level outbox integration. This
  requires a coordinated change to each supported mutation and its delete/
  tombstone behavior.
- Pull application and cursor advancement still need one IndexedDB transaction.
  The callback API must be replaced or extended so the sync coordinator owns the
  transaction.
- Typed server DTOs and domain services are required before invoices, payments,
  quotations, revisions, attachments, or audit events can be synchronized.
- PostgreSQL integration tests, migration upgrade tests, backup encryption/
  off-host retention, restore drills, and two-device browser tests are absent.

## Operator actions before a controlled pilot

- Generate distinct high-entropy values for `ConnectionStrings__SentinelOps`,
  `Sync__RegistrationToken`, and `Sync__CursorSigningKey`.
- Run migrations with a separate migration identity, then run the API with a
  least-privilege runtime identity.
- Configure explicit HTTPS frontend origins in `Cors__AllowedOrigins`.
- Execute a disposable-database migration test and an isolated restore drill.
- Register test devices, verify revocation, and run push/pull retry tests with
  two independent browser profiles.

