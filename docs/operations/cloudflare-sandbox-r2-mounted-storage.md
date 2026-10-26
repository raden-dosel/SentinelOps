# Cloudflare Sandbox + R2 Mounted Storage — Operational Guide & Runbook

## 1. Overview & Architecture

This guide covers the deployment, configuration, security, and operation of **Cloudflare Sandbox 1.0 with R2 Mounted Storage (`S3Mount`)**.

```
[ Client / Webhook ]
        |  (Bearer Token Authenticated)
        v
[ Cloudflare Worker (index.ts) ] <---> [ S3Gateway (Signing Bridge) ]
        |
        v (Durable Object per Job)
[ SandboxDurableObject ]
        |
        +---> Starts / Monitors [ Container (`fuse3`, `s3fs`, `sandbox-shim`) ]
        |
        +---> Issues S3Mount.mount() to `/data`
                    | (S3 SigV4 via S3Gateway, Region auto)
                    v
      [ Cloudflare R2 Bucket (`sentinelops-sandbox-data`) ]
        Prefix: `sandbox/jobs/{tenantId}/{jobId}/`
```

---

## 2. Platform SDK Generation: Sandbox 1.0 (`S3Mount`)

- **Generation Chosen**: Sandbox SDK 1.0 (`S3Mount`).
- **Rationale**: Cloudflare directs all new container and sandbox deployments to 1.0. S3Mount uses an S3-compatible endpoint (`https://<ACCOUNT_ID>.r2.cloudflarestorage.com`) with region `auto`.
- **Security Boundary**: The Worker entrypoint re-exports `S3Gateway`. Container storage calls are routed through the S3Gateway bridge, ensuring **actual R2 API tokens and secret keys are held exclusively by the Worker and never passed into the sandbox container**.

---

## 3. Configuration & Environment Variables

### Variables (`wrangler.jsonc`)
| Variable | Value | Description |
|---|---|---|
| `S3_ENDPOINT` | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` | R2 account S3-compatible endpoint |
| `S3_BUCKET` | `sentinelops-sandbox-data` | Dedicated bucket for sandbox data |
| `R2_REGION` | `auto` | Always `auto` for Cloudflare R2 |
| `PERSISTENCE_ROOT_PREFIX` | `sandbox/jobs` | Isolated root namespace for sandbox jobs |

### Required Secrets (`wrangler secret put <NAME>`)
| Secret Name | Scope | Description |
|---|---|---|
| `S3_ACCESS_KEY_ID` | Worker-only | R2 API token Access Key ID |
| `S3_SECRET_ACCESS_KEY` | Worker-only | R2 API token Secret Access Key |
| `SANDBOX_API_TOKEN` | Worker-only | Shared secret for authenticating API callers |

---

## 4. R2 Bucket & Token Creation Steps

1. **Create Bucket**:
   ```bash
   npx wrangler r2 bucket create sentinelops-sandbox-data
   ```
2. **Create Scoped API Token**:
   - In Cloudflare Dashboard: **R2 -> Manage R2 API Tokens -> Create API Token**.
   - **Permissions**: `Object Read & Write`.
   - **Scope**: Apply strictly to the single bucket `sentinelops-sandbox-data`.
   - **TTL**: Specify token expiry matching organizational security policies.
   - Do **NOT** grant Account Admin or global bucket creation permissions.

---

## 5. Persistence Boundary: What Persists vs What Is Lost

| Location | Storage Type | Persists Across Destroy? | Notes |
|---|---|---|---|
| `/data` (or configured mount) | S3FS Mount -> Cloudflare R2 | **YES (Durable)** | Writes immediately stream to R2 prefix. Survives sandbox destruction and recreate. |
| `/tmp` | Local Container Disk | **NO (Ephemeral)** | Wiped when container stops or is destroyed. Use for staging and temporary scratch files. |
| `/workspace` | Local Container Disk | **NO (Ephemeral)** | Working directory for dependencies and build caches. Not persisted unless backed up separately. |

---

## 6. Object-Storage Semantics & S3FS Cache Tuning

Because mounted storage is backed by object storage (S3/R2) via `s3fs`, standard POSIX differences apply:
1. **Rename (`mv`)**: Implemented as S3 `CopyObject` followed by `DeleteObject`. It is not an atomic metadata pointer swap.
2. **No POSIX Locks**: Avoid software that relies on `flock` or atomic file locking on `/data`.
3. **Safe Write Pattern**: Always write files to `/tmp` first, compute the SHA-256 checksum, and copy to `/data/` in a single command. This prevents partial/interrupted uploads on network drops.
4. **Metadata Cache**: Default `s3fs` stat cache is 900 seconds. In `mountManager.ts`, this is tuned to:
   - `stat_cache_expire: 60`: Reduces external modification invisibility to 60 seconds.
   - `disable_noobj_cache: true`: Disables negative caching so newly uploaded objects appear immediately without waiting for negative cache eviction.

---

## 7. Deployment & Verification Runbook

### Deploy to Cloudflare
```bash
cd workers/sandbox

# 1. Build and push container image
docker build -t sentinelops-sandbox:latest .
# (or link your container registry in wrangler.jsonc)

# 2. Configure secrets
npx wrangler secret put S3_ACCESS_KEY_ID
npx wrangler secret put S3_SECRET_ACCESS_KEY
npx wrangler secret put SANDBOX_API_TOKEN

# 3. Deploy Worker and Durable Object
npx wrangler deploy
```

### Run Automated Tests Locally
```bash
# Runs full unit and lifecycle persistence verification suite
npm test
```
All 80 unit tests across 12 test suites execute in ~2 seconds, confirming validation, idempotency, busy-unmount protection, and destroy-and-recreate persistence.
