# Production Database Deployment

Production schema changes are deliberate deployment steps. The API does not apply EF migrations at startup.

## Preconditions

- Confirm the exact Neon project, branch, database, and role used by the API.
- Run the read-only checks in `docs/operations/database-target-verification.md`.
- Confirm an off-host backup exists and that the restore procedure is known.
- Review the migration list and release commit.
- Use a migration identity with schema privileges and a separate least-privilege runtime identity. Configure them as `NEON_MIGRATION_CONNECTION_STRING` and `NEON_CONNECTION_STRING` respectively in the protected production environment.
- Do not place a database connection string in frontend variables.

If the migration fails with PostgreSQL `42501: permission denied for schema public`, the
connection is valid but its role cannot create the EF history table. Using a separate
migration role is preferred. An owner must grant that role access in the confirmed Neon
database, without sharing credentials in chat:

```sql
GRANT USAGE, CREATE ON SCHEMA public TO migration_role;
```

The runtime role also needs access to the tables after migration. Grant only the
required application privileges according to the hosting/security policy; do not grant
schema creation to the runtime role merely to make deployment pass.

## Disposable verification first

Use a disposable PostgreSQL instance or CI service. From the repository root:

```bash
dotnet restore server/SentinelOps.Api.Tests/SentinelOps.Api.Tests.csproj
dotnet build server/SentinelOps.Api.Tests/SentinelOps.Api.Tests.csproj --no-restore
dotnet test server/SentinelOps.Api.Tests/SentinelOps.Api.Tests.csproj --no-build --filter "Category!=NeonIntegration"
```

Apply migrations to the disposable target only after verifying its connection target:

```bash
ConnectionStrings__SentinelOps='Host=...;Database=...;Username=...;Password=...' \
  dotnet ef database update \
  --project server/SentinelOps.Api/SentinelOps.Api.csproj \
  --startup-project server/SentinelOps.Api/SentinelOps.Api.csproj
```

Never paste the value into chat or commit it. Verify the disposable target's migration history and expected infrastructure tables.

## Approved production sequence

1. Announce a migration window and preserve the current release identifier.
2. Capture and verify the database backup and restore point.
3. Re-run target verification against the selected Neon branch.
4. Run the reviewed EF command from a protected CI environment using `NEON_MIGRATION_CONNECTION_STRING`. The repository's manual GitHub workflow is the intended production mechanism; it is gated by the `deploy_production` input and production environment secrets.
5. Verify `__EFMigrationsHistory` contains the repository migrations and the expected infrastructure tables exist.
6. Deploy the API commit that matches the migration source.
7. Check `/api/v1/health/live` and `/api/v1/health/ready`. Readiness must report PostgreSQL healthy without revealing credentials or connection details.
8. Build the PWA with `VITE_API_BASE_URL` set to the public HTTPS API origin. Confirm the built frontend contains no database connection string.
9. Enroll one staging tablet, create a synthetic client, and verify push, server persistence in `SyncEntities`, pull, retry, and device revocation.
10. Keep the release blocked for real data until the two-device and backup/restore acceptance checks pass.

## Rollback decision

Do not roll back by deleting tables or clearing tablet data. If the migration or smoke test fails:

- Stop the deployment and preserve logs without secrets.
- Keep the database backup and migration history intact.
- Revert the API/static release only if the previous release is compatible with the applied schema.
- Restore into an isolated database for recovery testing. Restore production only under an explicit incident procedure.

## Current repository limitations

The current API persists synchronized business payloads as generic JSON in `SyncEntities`; it does not provide typed `Clients`, `Invoices`, or `Payments` tables. Financial production readiness therefore requires an approved generic contract with real PostgreSQL integration tests or a versioned typed-domain migration before cloud cutover.
