# Phase 2 Deployment Runbook

This runbook describes a controlled pilot only. The current implementation is
**NOT READY FOR REAL BUSINESS DATA** until the blockers in the audit and
remediation log are closed.

## Topology

Use an HTTPS reverse proxy in front of the ASP.NET API and a private PostgreSQL
service. PostgreSQL must not be publicly exposed. Store backups outside the
primary host or provider failure domain. Tablets should reach only the HTTPS API;
they must never connect directly to PostgreSQL.

## Configuration

Required environment variables (example values only):

```text
ConnectionStrings__SentinelOps=Host=<private-db-host>;Port=5432;Database=sentinelops;Username=<runtime-user>;Password=<secret>
Sync__RegistrationToken=<high-entropy-registration-secret>
Sync__CursorSigningKey=<high-entropy-cursor-secret>
Cors__AllowedOrigins__0=https://<pwa-host>
ASPNETCORE_ENVIRONMENT=Production
```

Do not commit values, print them in logs, or reuse the development token/key.

## Database provisioning and migrations

1. Provision PostgreSQL 16 or a compatible supported version with private access.
2. Create separate migration and runtime roles.
3. From a controlled release environment, run:

   ```bash
   dotnet ef database update \
     --project server/SentinelOps.Api/SentinelOps.Api.csproj \
     --startup-project server/SentinelOps.Api/SentinelOps.Api.csproj
   ```

4. Confirm the migration history and required indexes.
5. Start the API only after migration success. The API does not migrate on startup.

Rollback is a restore/recovery operation, not an automatic down-migration in
production. Take and verify a backup before schema changes.

## API and PWA

Publish the API using the repository's .NET release build and configure the
reverse proxy for HTTPS, request size limits, forwarded headers, and health
probes. Build the PWA with `npm run build` and configure its API base URL through
the deployment's supported frontend configuration mechanism. Allow only that
origin in CORS.

Health probes:

```text
GET /api/v1/health/live   -> 200 without requiring PostgreSQL
GET /api/v1/health/ready  -> 200 only when PostgreSQL is healthy
```

Registration is protected by `X-Registration-Token`; subsequent sync requests
use the returned bearer device token. Revoke a lost device by setting its
`RevokedAtUtc` through an authenticated administrative operation or approved
operator procedure. The current repository does not yet expose that admin API.

## Backups and restore

The current browser JSON/ZIP export is not an operational PostgreSQL backup.
Before pilot approval, establish a scheduled encrypted `pg_dump` stored
off-host, retain multiple restore points, and run a restore drill into an
isolated database. Match formats exactly:

```bash
pg_dump --format=custom --file=sentinelops.dump "$DATABASE_URL"
pg_restore --clean --if-exists --dbname="$RESTORE_DATABASE_URL" sentinelops.dump
```

Do not delete the source dump until encryption, upload, checksum, and retention
success are confirmed. Never place credentials in shell history or logs.

## Tablet smoke test

1. Register two test devices in the same business.
2. Verify invalid registration and bearer tokens are rejected.
3. Create and update only entities currently supported by the sync allowlist.
4. Retry the same push and confirm a stable idempotent result.
5. Pull changes on the second device and verify cursor progression.
6. Revoke one device and verify push and pull fail.
7. Test offline operation and local backup export separately from server sync.

## Cost and free-tier caveat

No provider or price is asserted here because the repository contains no selected
hosting plan. A pilot owner must price always-on API compute, PostgreSQL storage,
egress, backup storage, TLS/proxy, and monitoring. Free tiers may sleep, purge
storage, cap connections, or exclude backups; they are not an acceptable
recovery plan without a tested independent backup.

