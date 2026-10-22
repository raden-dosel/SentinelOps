# Database Target Verification

This procedure is read-only. It does not apply migrations, create tables, or inspect business payloads.

## Repository-verified configuration

`server/SentinelOps.Api/Program.cs` resolves the API database target in this order:

1. `ConnectionStrings:SentinelOps`
2. `ConnectionStrings__SentinelOps`
3. `DATABASE_URL`
4. `DATABASE_CONNECTION_STRING`
5. `SentinelOps`
6. Development-only localhost fallback when the environment is Development

The API normalizes `postgres://` and `postgresql://` URLs to an Npgsql connection string. The browser never receives a database connection string; it uses the enrolled API URL stored in the local `syncConfig` store.

The repository migrations are:

- `20261020015531_InitialCreate`
- `20261020030453_SyncProtocol`

They create `Businesses`, `RegisteredDevices`, `SyncIdempotencyRecords`, `ChangeFeedEntries`, `EntityTombstones`, and `SyncEntities`. They do not create typed `Clients` or `Invoices` tables.

## Operator checklist

1. In the hosting dashboard, confirm that the API has a non-empty database configuration value. Record only the provider/project/branch/database label; never copy the value or credentials.
2. In Neon, select the exact project and branch used by the API. Do not silently inspect another branch.
3. In the Neon SQL editor, run this query as a read-only transaction:

```sql
BEGIN TRANSACTION READ ONLY;

SELECT current_database() AS database_name,
       current_schema() AS current_schema,
       current_user AS database_user,
       inet_server_addr() AS server_address,
       inet_server_port() AS server_port,
       version() AS postgres_version;

SELECT schemaname, tablename
FROM pg_catalog.pg_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY schemaname, tablename;

SELECT to_regclass('public."__EFMigrationsHistory"') AS ef_migrations_history_table;

SELECT "MigrationId", "ProductVersion"
FROM public."__EFMigrationsHistory"
ORDER BY "MigrationId";

COMMIT;
```

4. Compare the result with the repository migration list and expect both migration IDs. Expected infrastructure tables are `Businesses`, `RegisteredDevices`, `SyncIdempotencyRecords`, `ChangeFeedEntries`, `EntityTombstones`, and `SyncEntities`.
5. Check the API readiness endpoint from the hosting dashboard or a trusted operator shell. Readiness checks PostgreSQL connectivity; liveness only checks that the process is alive.
6. Compare the PWA's enrolled API origin with the deployed API hostname. The PWA must use `VITE_API_BASE_URL` at build time or the explicit Settings > Cloud Sync URL. It must never contain a Neon connection string.

## Interpretation

- No `__EFMigrationsHistory`: migrations have not been applied to this target, or the target/schema is wrong.
- Migration history exists but expected tables are absent: target/schema drift or a migration mismatch requires investigation.
- Infrastructure tables exist but `SyncEntities` is empty: no accepted push has reached this target, or the inspected target is not the API target.
- `SyncEntities` contains records: synchronized payloads are present in the generic JSON model. This is not proof that typed relational financial aggregates exist.

Do not run `dotnet ef database update` until the target is positively identified, backed up, and explicitly approved.

## Verification status fields

Record these separately in an incident or release note:

- Repository migration list: verified from source control.
- Local/test migration state: verified only after using a disposable database.
- Remote/production migration state: verified only by the read-only query above.
- API/database target alignment: verified only when sanitized target labels match.
- Secrets and credentials: never recorded.
