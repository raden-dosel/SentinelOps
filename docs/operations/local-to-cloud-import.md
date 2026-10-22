# Local-to-Cloud Import

This is an explicit initial import workflow. Ongoing sync and initial import are different operations.

## Supported source format

The frontend supports SentinelOps JSON backups and ZIP backups produced by Settings > Backup & Storage:

- JSON contains business records and attachment metadata.
- ZIP contains the same JSON plus attachment files.
- Local users, password hashes, sessions, and encryption keys are not part of the backup payload.

The current server sync protocol accepts attachment metadata only. Attachment bytes remain local until a private authenticated file-storage workflow is implemented.

## Safe staging procedure

1. Export and preserve an original JSON or ZIP backup from every tablet. Do not clear IndexedDB.
2. Confirm the API target and migration state using `docs/operations/database-target-verification.md`.
3. Enroll the staging tablet in Settings > Cloud Sync. Use a staging business or a confirmed empty business scope.
4. Select the backup in Settings > Backup & Storage. The application validates the manifest and runs a dry-run analysis.
5. Review source counts, existing counts, duplicate IDs, missing relationships, and document-number collisions.
6. Resolve all missing relationships and document-number collisions. The cloud-import action remains disabled until the dry run is clean.
7. Choose **Queue Cloud Import** and confirm. This does not replace local records. It creates durable outbox operations for settings, clients, quotations, quotation revisions, invoices, payments, projects, and attachment metadata.
8. Keep the tablet online and observe the Sync status until operations are accepted or explicitly reported as rejected/conflicted.
9. Verify server-side records in `SyncEntities` and `ChangeFeedEntries` using an authorized read-only check. Verify counts and representative IDs, relationships, document totals, and payment balances.
10. Enroll a second isolated browser profile and pull the data. Confirm that supported records match.

## Idempotency and conflict behavior

- Source UUIDs are preserved in queued payloads.
- Each queued operation has a new local operation ID, so the server can retry it safely.
- The server's generic sync model rejects stale existing server records as conflicts when the import has no base revision. It does not silently overwrite them.
- The current UI blocks known local relationship and document-number problems before queueing.
- A failed or conflicted operation remains visible through sync state/conflict storage for operator review.
- Repeating an import requires a fresh dry run. Do not assume a second import is safe if the first run is still pending.

## What is not imported

- Local users, password hashes, security answers, sessions, or keys.
- Local audit events.
- Attachment binary content. The current server supports metadata only.
- Typed relational aggregates. The current API stores accepted payloads as generic JSON in `SyncEntities`.

## Rollback and recovery

The source backup and local IndexedDB remain untouched. If an import is incomplete:

1. Stop using the affected staging business scope.
2. Preserve the sync status and conflict records.
3. Export the local source again and retain the original backup.
4. Investigate rejected operations and target identity before retrying.
5. For a staging target, discard the staging business scope only through an approved database procedure. Do not delete production records as a rollback shortcut.

A production import is blocked until typed financial persistence or an explicitly approved generic-JSON contract has PostgreSQL integration, reconciliation, backup, and restore evidence.
