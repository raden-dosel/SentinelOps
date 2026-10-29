# SentinelOps Audit Remediation Status

Audit baseline: 2026-10-29
Last updated: 2026-10-29

## Readiness

**Current level: local-only beta.** The application builds and its local/unit tests pass, but shared financial data is not production-ready. No production database, deployment, cloud storage, live credential, or customer data was changed during this remediation.

## Status Legend

- **Not Started:** no implementation beyond the baseline.
- **In Progress:** implementation is partial or needs dependent work.
- **Implemented / Not Verified:** code exists but required integration or recovery evidence is missing.
- **Verified:** acceptance criteria for the specific slice have been executed.
- **Blocked:** requires an external dependency, credential, or business decision.
- **Deferred:** intentionally postponed until a dependency is complete.

## Findings

| ID | Priority | Status | Current evidence | Remaining risk/dependency |
| --- | --- | --- | --- | --- |
| P0.1 | Critical | Not Started | API still persists synchronized entities primarily as generic JSON in `SyncEntities`. | Requires typed server aggregates, transactional financial commands, compatibility/backfill strategy, and PostgreSQL concurrency tests. |
| P0.2 | Critical | Not Started | Device bearer authentication and shared registration-token onboarding remain the current server identity model. | Requires server principals/roles, token lifecycle, administrative controls, and tenant-isolation tests. |
| P0.3 | Critical | In Progress | Production now rejects missing, weak, or development-default sync secrets. Cursor fallback was removed. Forwarded headers trust only configured proxy IPs. | Token storage/rotation, secret redaction, production startup tests, and documented proxy deployment configuration remain. |
| P0.4 | Critical | Not Started | Snapshot recovery still has single-page behavior and does not reconcile absent records. | Requires versioned paged snapshot contract, atomic staged replacement, tombstone/attachment reconciliation, and recovery tests. |
| P0.5 | Critical | Not Started | Local JSON/ZIP export and destructive restore exist. | Requires pre-restore recovery point, encrypted/off-host backups, restore drill, checksums, and RPO/RTO evidence. |
| P0.6 | Critical | Not Started | R2 and Cloudinary paths coexist; completion/download are not fully server-authoritative. | Requires provider decision, server metadata, object verification, private access, and orphan cleanup. |
| P1.1 | High | Not Started | Outbox/conflict stores exist, but no conflict center or dead-letter workflow is exposed. | Requires safe per-entity resolution rules and UI tests. |
| P1.2 | High | Not Started | Human-readable numbers are allocated locally. | Requires server-issued final numbering and visible collision reconciliation. |
| P1.3 | High | In Progress | Non-Neon API tests run locally; frontend tests/build pass. | HTTP, disposable PostgreSQL, browser two-device, attachment, and restore coverage remain. |
| P1.4 | High | In Progress | This status document now records implementation and evidence. | README, architecture, deployment, and readiness claims still need reconciliation. |
| P1.5 | High | Not Started | Health endpoints and rate limiting exist. | Requires correlation IDs, metrics, alerts, retention jobs, and operational ownership. |
| P1.6 | High | Not Started | Local PBKDF2 auth, auto-lock, and AES-GCM helpers exist. | Requires throttling, recovery UX, credential lifecycle, and accurate encryption-scope documentation. |
| P2 | Medium | Deferred | Architecture, UX, financial edge-case, and PWA improvements are identified in the audit. | Begin after P0/P1 release gates have evidence. |
| P3 | Later | Deferred | Product expansion is listed in the audit. | Do not substitute product features for reliability remediation. |

## Evidence Log

### P0.3 secret and proxy hardening

Changed:

- `server/SentinelOps.Api/Configuration/SecurityConfiguration.cs`
- `server/SentinelOps.Api/Program.cs`
- `server/SentinelOps.Api/Controllers/SyncController.cs`
- `server/SentinelOps.Api/appsettings.json`
- `server/SentinelOps.Api.Tests/SecurityConfigurationTests.cs`

Verified command:

```text
dotnet test server/SentinelOps.Api.Tests/SentinelOps.Api.Tests.csproj --filter 'Category!=NeonIntegration'
```

Result: **15 passed, 0 failed, 0 skipped.** API build completed without warnings after the change. Production was not started or contacted.

Scope of verification: secret validation helper behavior, API compilation, existing cursor tests, and existing non-Neon API tests. Production startup failure, restart cursor continuity, token rotation, log redaction, and real proxy behavior remain unverified.

### Baseline application checks

Verified on 2026-10-29 before this remediation slice:

- Frontend tests: 12 files, 84 tests passed.
- TypeScript validation: passed.
- Vite production build: passed, with a large-chunk warning.
- Non-Neon API tests: 15 passed after the security hardening changes.

## Release Gates

No gate is crossed out yet. The following remain open:

- [ ] Fresh and upgrade PostgreSQL migrations in a disposable environment.
- [ ] Production secrets fail closed and cursor continuity survives restart.
- [ ] Tenant isolation, role authorization, expired-device, and revoked-device tests.
- [ ] Two independent devices synchronize core business entities and conflicts.
- [ ] Concurrent payments and idempotent retries preserve financial invariants.
- [ ] Multi-page expired-cursor recovery preserves pending local writes.
- [ ] Attachment authorization, completion, download, checksum, and orphan cleanup.
- [ ] Encrypted backup restoration meets an agreed RPO/RTO.
- [ ] Local-to-cloud import reconciliation without mutating source tablets.
- [ ] Frontend/API tests, lint, and production build pass in CI.
- [ ] Documentation accurately distinguishes local-only, staging-verified, and production-ready behavior.

## Next Safe Work

1. Add disposable PostgreSQL/API integration coverage without production credentials.
2. Define and implement server-side roles and device lifecycle controls.
3. Design the typed financial command boundary before adding relational migrations.
4. Implement a versioned, paged snapshot contract with explicit completion and staged reconciliation.
