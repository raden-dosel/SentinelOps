# SentinelOps Application Audit

Audit date: 2026-10-29

## Executive Summary

SentinelOps is a substantial offline-first operations application for security-installation businesses. The local tablet workflow is the strongest part of the system: CRM, quotations, revisions, invoices, payments, projects, PDFs, backups, local authentication, IndexedDB persistence, and a durable outbox are implemented.

The shared-cloud layer is not yet production-ready for real financial data. The API currently behaves primarily as a tenant-scoped generic JSON synchronization store. It does not yet provide authoritative relational financial aggregates, complete server identity and role management, verified attachment persistence, tested disaster recovery, or end-to-end two-device assurance. The application should be treated as local-first beta software until the P0 gates below are closed.

Validation note: local validation was rerun on 2026-10-29. Frontend tests passed with 12 test files and 84 tests; `npm run lint` passed; `npm run build` passed; and the non-Neon .NET suite passed with 15 tests and 0 failures. The production frontend bundle is 1.56 MB before gzip and triggers Vite's 500 kB chunk warning. The API warning cleanup was completed: forwarded-header configuration now uses the current API and the unused `NormalizePostgresConnectionString` helper was removed.

Current validation status:

- **Passing:** frontend tests, TypeScript validation, Vite production build, API build, and non-Neon API tests.
- **Unverified:** Neon/PostgreSQL integration, HTTP endpoint integration, two-device browser workflows, attachment lifecycle, and backup restoration.
- **Technical debt surfaced by the build:** targeted frontend code splitting remains.

## Priority Model

- **P0 - Critical:** data loss, unauthorized access, financial integrity, or production-readiness blocker.
- **P1 - High:** required for dependable multi-device operation or a serious operational release.
- **P2 - Medium:** materially improves maintainability, usability, observability, or scale.
- **P3 - Later:** valuable product expansion after reliability foundations are complete.

## P0 - Critical

### P0.1 Establish a server-authoritative financial model

**Finding:** The sync API stores allowlisted entities as generic JSON in `SyncEntities`. Client payload validation checks selected fields, but invoices, payments, issued quotations, reversals, and document numbering are not represented as server-side aggregates and commands.

**Evidence:** [SyncController.cs](../server/SentinelOps.Api/Controllers/SyncController.cs), [Entities.cs](../server/SentinelOps.Api/Domain/Entities.cs), [phase2-api-database-readiness-audit.md](phase2-api-database-readiness-audit.md).

**Improve:** Add typed relational tables/aggregates for clients, quotations and revisions, invoices, payments/reversals, projects, attachments, settings, and audit events. Make issue, void, payment, and reversal operations explicit idempotent commands. Recalculate financial balances on the server rather than trusting client-provided totals.

**Acceptance check:** Two concurrent devices cannot create an overpayment, alter an issued invoice in place, duplicate a payment after retry, or reduce an invoice below collected payments.

### P0.2 Complete server authentication and authorization

**Finding:** Device registration is protected by one shared registration token and device bearer tokens, but there is no server user identity, role model, business-admin boundary, token rotation, expiry, or authenticated administrative workflow.

**Evidence:** [DeviceController.cs](../server/SentinelOps.Api/Controllers/DeviceController.cs), [Program.cs](../server/SentinelOps.Api/Program.cs), [AuthContext.tsx](../src/app/providers/AuthContext.tsx).

**Improve:** Introduce server-side business principals and roles such as owner, operations, finance, and read-only. Add short-lived access credentials, refresh/revocation, device-token rotation, lost-device recovery, and audit records for administrative actions. Keep local vault authentication separate from server identity.

**Acceptance check:** Every read, write, upload, download, revoke, and export is authorized by both business scope and role; a revoked or expired device cannot access data.

### P0.3 Protect credentials and fail closed in production

**Finding:** The browser stores `deviceToken` in IndexedDB through `SyncConfig`; token rotation and browser-storage exposure remain unresolved. The API previously generated ephemeral secrets when production secrets were missing, and `SyncController` had a fallback cursor signing key; those production fallbacks are now removed.

**Evidence:** [database.ts](../src/storage/database.ts), [syncCoordinator.ts](../src/services/syncCoordinator.ts), [Program.cs](../server/SentinelOps.Api/Program.cs), [SyncController.cs](../server/SentinelOps.Api/Controllers/SyncController.cs).

**Improve:** Complete the implemented fail-closed startup policy with device-token rotation, reduced long-lived-token exposure, a documented key-rotation procedure, and secret redaction checks for logs and errors. Forwarded headers now trust only explicitly configured proxy IPs through `ForwardedHeaders:KnownProxies`.

**Acceptance check:** Production startup fails closed, cursor continuity survives restart, token rotation is tested, and no token, hash, secret, or payload appears in logs.

### P0.4 Make resynchronization complete and loss-aware

**Finding:** Client snapshot recovery preserves pending outbox records, but the server snapshot uses `Take(limit)` without a stable ordering or continuation cursor, and the client does not loop while `hasMore` is true. Existing local records absent from a partial snapshot are not explicitly removed. Attachments are also excluded from the snapshot target stores.

**Evidence:** [SyncController.cs](../server/SentinelOps.Api/Controllers/SyncController.cs), [syncCoordinator.ts](../src/services/syncCoordinator.ts).

**Improve:** Implement paged snapshots with a signed continuation cursor, deterministic ordering, deletion/tombstone handling, attachment metadata, and a transactionally verified replacement plan. Preserve local writes and surface conflicts instead of silently overwriting them.

**Acceptance check:** A dataset larger than one page, a deleted remote entity, an expired cursor, and a pending local edit all recover correctly without data loss.

### P0.5 Make backup and restore safe for real recovery

**Finding:** Local restore clears business stores and repopulates them from a file. Validation is structural and relationship-oriented, but there is no encrypted backup requirement, checksum/signature, automatic pre-restore snapshot, rollback drill, or centralized database restore process.

**Evidence:** [backupService.ts](../src/services/backupService.ts), [phase2-deployment-runbook.md](phase2-deployment-runbook.md), [server/docker-compose.yml](../server/docker-compose.yml).

**Improve:** Require a pre-restore backup, validate all records and attachment hashes before mutation, provide transactional rollback or restore-to-new-database behavior, and add encrypted off-device PostgreSQL backups with retention and a witnessed restore drill.

**Acceptance check:** A failed or interrupted restore leaves the previous local dataset recoverable; a clean environment can be restored from an encrypted backup within the agreed RPO/RTO.

### P0.6 Make attachment authorization and persistence authoritative

**Finding:** R2 and Cloudinary upload paths coexist. The completion endpoint validates object-key shape but does not persist an attachment record server-side or verify object existence/size/checksum. The download endpoint accepts a client-provided key within the business prefix rather than resolving a stored authorized attachment.

**Evidence:** [ProjectImagesController.cs](../server/SentinelOps.Api/Controllers/ProjectImagesController.cs), [r2UploadService.ts](../src/services/r2UploadService.ts), [cloudinaryUploadService.ts](../src/services/cloudinaryUploadService.ts).

**Improve:** Select one provider and one lifecycle. Persist attachment metadata in the server database, bind it to a real project/business, verify the uploaded object with a HEAD/checksum, enforce quotas, and generate downloads only from server-owned metadata. Keep private buckets and restrict CORS to real origins.

**Acceptance check:** An authenticated user cannot upload to or download another business's object, a missing object cannot be marked complete, and a failed upload is retryable without orphaned metadata.

## P1 - High

### P1.1 Complete sync semantics and conflict resolution UI

**Finding:** The client has atomic outbox writes and a conflict store, but users need an explicit way to inspect local/server versions, choose a resolution, retry, discard, or export conflicts. Failed operations can remain in the outbox indefinitely.

**Evidence:** [repositories.ts](../src/storage/repositories.ts), [syncCoordinator.ts](../src/services/syncCoordinator.ts), [database.ts](../src/storage/database.ts).

**Improve:** Add a conflict center with entity diffs, field-level guidance, retry/discard actions, retry limits, dead-letter status, and a visible sync health history. Treat payments, reversals, issued documents, revisions, deletes, and attachment metadata as non-coalescible events.

**Acceptance check:** A user can resolve a stale edit from the UI and prove that the selected result is synchronized on both devices.

### P1.2 Prevent offline document-number collisions

**Finding:** Human-readable quotation, invoice, payment, and project numbers are allocated locally by year/prefix. Independent tablets can generate the same number.

**Evidence:** [database.ts](../src/storage/database.ts), [types/index.ts](../src/types/index.ts), [phase2-architecture.md](phase2-architecture.md).

**Improve:** Use stable UUIDs for identity and server allocation for issued numbers. Define an explicit offline draft number policy and never silently renumber an externally shared or issued document.

**Acceptance check:** Concurrent devices can create offline drafts, reconcile them, and produce unique issued numbers with a visible audit trail.

### P1.3 Add PostgreSQL, HTTP, and two-device integration coverage

**Finding:** Existing tests are primarily domain and service-level tests. The repository has cursor and optional Neon tests, but no complete API request suite, local PostgreSQL fixture, two-browser-profile workflow, attachment integration test, or restore drill.

**Evidence:** [server/SentinelOps.Api.Tests](../server/SentinelOps.Api.Tests), [tests](../tests), [ci.yml](../.github/workflows/ci.yml).

**Improve:** Add containerized PostgreSQL tests for migrations, tenant isolation, duplicate retries, concurrency, pagination, tombstones, auth failures, and server validation. Add Playwright or equivalent tests for two independent IndexedDB profiles and offline transitions.

**Acceptance check:** CI proves fresh migration, upgrade migration, push/pull, conflict, resync, revocation, upload finalization, and restore behavior without external production secrets.

### P1.4 Reconcile documentation and implementation claims

**Finding:** Several documents describe Phase 2 as implemented or enterprise-grade while the architecture/readiness documents state that generic JSON sync, attachment transfer, migration, and recovery remain incomplete. The architecture document also says schema version 1 while the code defines version 4.

**Evidence:** [README.md](../README.md), [phase2-architecture.md](phase2-architecture.md), [phase2-api-database-readiness-audit.md](phase2-api-database-readiness-audit.md), [database.ts](../src/storage/database.ts).

**Improve:** Add a single release-readiness matrix generated or maintained with the code. Mark every feature as local-only, tested staging, or production-ready. Update schema/version and deployment claims after each release.

**Acceptance check:** A new operator can determine exactly which workflows are safe to use with one tablet, multiple tablets, or production cloud storage.

### P1.5 Add operational resilience and observability

**Finding:** Health endpoints, rate limiting, and retry behavior exist, but there is no visible metrics, structured sync telemetry, alerting, backup monitoring, retention job, or documented RPO/RTO verification in the repository.

**Evidence:** [Program.cs](../server/SentinelOps.Api/Program.cs), [phase2-deployment-runbook.md](phase2-deployment-runbook.md), [docker-compose.yml](../server/docker-compose.yml).

**Improve:** Add structured correlation IDs, request/operation metrics, sync lag and conflict counters, database connection alerts, storage quota alerts, backup success/failure alerts, change-feed retention jobs, and a restore runbook with an owner.

**Acceptance check:** Operators can detect a failing API, stalled sync, growing outbox, expired credentials, failed backup, or storage quota breach before users lose data.

### P1.6 Harden local security and recovery UX

**Finding:** Local PBKDF2 authentication, auto-lock, and AES-GCM helpers exist, but the local session is in memory only, recovery relies on a browser security answer, the sync token is locally stored, and the password hashing cost/policy has no upgrade path.

**Evidence:** [security.ts](../src/services/security.ts), [AuthContext.tsx](../src/app/providers/AuthContext.tsx), [types/index.ts](../src/types/index.ts).

**Improve:** Define password policy and rehash-on-login, rate-limit local attempts, add recovery-code/device-recovery options, clarify what local encryption is actually applied to, and protect or rotate server credentials on logout/device disconnect. Document browser data-clearing risk in the product UI.

**Acceptance check:** Brute-force attempts are throttled, password upgrades are automatic, recovery is auditable, and users understand what is and is not encrypted at rest.

## P2 - Medium

### P2.1 Improve application architecture and typing

- Replace generic `any` payloads in sync and attachment code with versioned DTOs and runtime schemas.
- Centralize API transport, authentication headers, problem-details parsing, timeouts, cancellation, and retry policy instead of calling `fetch` from multiple services.
- Separate repository mutation commands from view components; the largest views currently combine data loading, forms, workflow rules, and rendering.
- Add explicit schema migrations for domain shape changes and backup up-converters, not only object-store creation.
- Add server-side unique constraints for tenant-scoped document numbers and relevant foreign-key relationships.

Evidence: [syncCoordinator.ts](../src/services/syncCoordinator.ts), [ProjectImagesController.cs](../server/SentinelOps.Api/Controllers/ProjectImagesController.cs), [QuotationsView.tsx](../src/features/quotations/QuotationsView.tsx), [BillingView.tsx](../src/features/billing/BillingView.tsx).

### P2.2 Improve usability, accessibility, and tablet ergonomics

- Add keyboard navigation and focus restoration for modal/dialog flows.
- Verify labels, error associations, contrast, screen-reader status announcements, and touch target sizes.
- Add loading, empty, retry, offline, conflict, and permission-denied states consistently across each module.
- Make navigation deep-linkable and preserve selected record/filter state on refresh.
- Add bulk actions, saved filters, sortable tables, and exportable reports for clients, quotations, invoices, payments, and projects.

Evidence: [App.tsx](../src/app/App.tsx), [Modal.tsx](../src/components/ui/Modal.tsx), feature views under [src/features](../src/features).

### P2.3 Improve financial and document correctness

- Add date/timezone tests for due dates, issue dates, and Philippine local time.
- Add limits for negative, non-finite, excessively large, and fractional quantities and prices.
- Make invoice status transitions explicit and prevent editable issued documents locally as well as remotely.
- Add immutable receipt numbering, cancellation/reversal rules, and reports that reconcile invoice, payment, and project totals.
- Add configurable currencies/tax rules only when the document/legal model supports them; currently the defaults are strongly PHP-specific.

Evidence: [calculations.ts](../src/domain/calculations.ts), [repositories.ts](../src/storage/repositories.ts), [types/index.ts](../src/types/index.ts).

### P2.4 Improve PWA and storage lifecycle

- Add quota warnings and cleanup controls for local blobs.
- Expose pending backup and sync status before browser data is cleared.
- Test service-worker update rollback and stale asset recovery.
- Add attachment thumbnail generation, orientation handling, and offline upload queue visibility.
- Define behavior for multiple browser tabs writing the same IndexedDB data.

Evidence: [backupService.ts](../src/services/backupService.ts), [database.ts](../src/storage/database.ts), [PWAStatus.tsx](../src/components/ui/PWAStatus.tsx).

## P3 - Later Product Features

These should follow the P0/P1 reliability work:

- Role-based staff accounts, approval workflows, and activity dashboards.
- Scheduling for site surveys, installation crews, maintenance visits, and emergency callouts.
- Inventory and procurement for fence wire, energizers, gate motors, CCTV, access-control parts, and serial numbers.
- Customer communication integrations for quotation delivery, reminders, payment receipts, and status updates.
- Recurring maintenance contracts, service-level agreements, warranties, and renewal reminders.
- Supplier and subcontractor management with purchase orders and cost/margin tracking.
- Mobile camera workflows with annotations, checklists, signatures, and geotagging subject to privacy review.
- Customer portal for quotation approval, document download, project progress, and payment evidence.
- Analytics for conversion rate, project margin, receivables aging, technician utilization, and lead sources.
- Multi-language and region-specific tax/document templates after the financial model is server-authoritative.

## Recommended Delivery Order

1. Close P0.1-P0.5: server financial authority, authentication, secret handling, resync correctness, and recoverable backups.
2. Close P0.6 and P1.1-P1.3: one attachment provider, conflict UX, unique issued numbering, and integration tests.
3. Reconcile documentation and add operational telemetry before accepting production data.
4. Harden local security, accessibility, PWA lifecycle, and financial edge cases.
5. Build scheduling, inventory, communications, customer portal, and analytics on the verified foundation.

## Release Gate

Do not label the application production-ready for shared business data until all of the following are demonstrated in a controlled environment:

- Fresh and upgrade PostgreSQL migrations succeed.
- Tenant isolation and revoked-device tests pass.
- Two independent devices synchronize clients, quotations, projects, invoices, payments, deletes, and conflicts.
- Expired-cursor recovery handles multi-page snapshots and preserves pending local writes.
- Attachment authorization, completion, download, and orphan cleanup are verified.
- Encrypted backup restoration is witnessed and meets the agreed RPO/RTO.
- Frontend and API tests, lint, and production build pass in CI.
