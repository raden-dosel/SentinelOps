# SentinelOps Phase 2 Deployment Runbook & Operational Guide

**Document Version:** 2.0.0  
**Effective Date & Market Research Audit:** October 2026  
**Audience:** Principal Architects, Systems Administrators, Security Officers, Field Operations  

---

## 1. Deployment Topology Diagram

```mermaid
flowchart TD
  subgraph FieldDevices [Field Operations - Tablets & Mobile]
    T1[Tablet 1: Field Site Estimator\nIndexedDB + PWA]
    T2[Tablet 2: Lead Technician Van\nIndexedDB + PWA]
    T3[Tablet 3: Showroom & Billing\nIndexedDB + PWA]
  end

  subgraph Perimeter [Security & Transport Edge]
    Caddy[Edge Reverse Proxy: Caddy / Nginx\nAutomatic HTTPS / Let's Encrypt\nRate Limiting: 120 req/min\nCORS Header Restriction]
    Static[Static PWA Host\nService Worker / Precached Assets]
  end

  subgraph ApplicationTier [SentinelOps Server Tier]
    API[ASP.NET Core Web API v1 .NET 10\nSync Controller & Device Controller\nDomain Financial Validator]
    Health[/api/v1/health/live\n/api/v1/health/ready]
  end

  subgraph DataTier [Storage & Persistence Tier]
    PG[(PostgreSQL 16/17 Database\nPrivate Network Only\nNo Public Internet Port)]
    Feed[(Monotonic Change Feed)]
    OutboxStore[(Server Audit Events)]
  end

  subgraph BackupSubsystem [Durable Backup & Recovery]
    Cron[Scheduled pg_dump Encrypted Cron Job\nDaily 02:00 AM UTC+8]
    ColdStorage[Off-Host Encrypted Cloud/NAS Storage\n30-Day Retention Policy]
  end

  T1 <-->|HTTPS Bearer Token\n/api/v1/sync/push\n/api/v1/sync/changes| Caddy
  T2 <-->|HTTPS Bearer Token\n/api/v1/sync/push\n/api/v1/sync/changes| Caddy
  T3 <-->|HTTPS Bearer Token\n/api/v1/sync/push\n/api/v1/sync/changes| Caddy
  Caddy -->|Host Static Dist| Static
  Caddy -->|Reverse Proxy :5000| API
  API --> Health
  API -->|Npgsql Connection Pool| PG
  PG --> Feed
  PG --> OutboxStore
  PG -->|Local Dump| Cron
  Cron -->|GPG AES-256| ColdStorage
```

---

## 2. Platform Comparison & Evaluation (Market Audit October 2026)

| Deployment Model | Hardware / Hosting Cost | Database & Storage Cost | Key Operational Constraints | Best Suited For |
| :--- | :--- | :--- | :--- | :--- |
| **Option A: Existing Office PC / Mini-PC** *(Recommended Initial Default)* | **₱0** incremental (utilizes existing office hardware) | **₱0** local PostgreSQL 16 container or native service | Requires office host to stay powered; local UPS recommended; local network VPN or port forward with Cloudflare Tunnel/Tailscale | **Controlled Pilot & Secure Production Prototype** (Zero cloud risk, zero 30-day database wipe risk) |
| **Option B: Free Cloud Evaluation** *(Render + Neon + GitHub Pages)* | **$0 / ₱0** | Free tier (Neon 100 CU-hrs/mo, Render 1GB 30-day DB) | **CRITICAL RISK:** Render free databases expire after 30 days and are permanently purged; Render free web services spin down after 15 min; Neon compute can exhaust during batch sync. | **Ephemeral Dev / Disposable Demo ONLY** (Never use for real customer financial data) |
| **Option C: Low-Cost Managed Production** *(Hetzner Cloud / DigitalOcean / Railway)* | **€3.79 - €6.00 / mo** (~₱240 - ₱370 PHP/mo) | Included 40GB NVMe storage + automated snapshot (~₱60 PHP/mo) | 99.9% uptime SLA, persistent IPv4/IPv6, daily automated backup, no spin-down delay, unrestricted bandwidth. | **Standard Production Deployment** (Full company multi-tablet rollout) |

### Formal Recommendation:
1. **Immediate Pilot:** Deploy **Option A** using an existing office computer (Intel i5/N100 mini-PC, 8GB+ RAM, Ubuntu Server 24.04 LTS or Windows 11 Pro with WSL2). This guarantees complete business ownership, zero monthly fees, zero cloud vendor lock-in, and avoids free-tier data expiration.
2. **Growth/Cloud Expansion:** Transition to **Option C** (Hetzner VPS or DigitalOcean Basic Droplet at ~₱350/mo) once more than 5 tablets are operating in the field concurrently without VPN.

---

## 3. Official References & Quotas Checked (October 2026)

- **Render Cloud:** Free Web Service provides 512 MB RAM, 0.1 CPU, spins down after 15 minutes of inactivity; free PostgreSQL is deleted 30 days after creation; free bandwidth capped at 5 GB/month *(Verified October 2026)*.
- **Neon Serverless Postgres:** Free tier provides 100 CU-hours/month, 1 GB storage, scale-to-zero after 5 minutes of inactivity. Compute hours rapidly consumed under active polling *(Verified October 2026)*.
- **GitHub Pages:** Free static hosting with 100 GB bandwidth/month and 1 GB site size limit. Suitable for static PWA distribution *(Verified October 2026)*.
- **Let's Encrypt / Caddy:** Automated TLS certificates at $0 cost for public hostnames.

---

## 4. Prerequisites and Required Accounts

- **Operating System:** Linux (Ubuntu 24.04 LTS recommended), macOS, or Windows with WSL2/Docker.
- **Runtimes:**
  - .NET 10.0 SDK (`dotnet --version` >= 10.0.100) or Docker Engine 24+.
  - Node.js 20+ LTS or Bun 1.2+ (for building the static PWA bundle).
  - PostgreSQL 16 or 17 Server.
- **Networking Tools:** `curl`, `openssl`, `jq`, `tar`, `gzip`, `gpg`.

---

## 5. Environment Variables & Secret Configuration

Create a production `.env` file on the server. **Never commit this file or real secrets to Git.**

```bash
# ASP.NET Core Hosting Environment
ASPNETCORE_ENVIRONMENT=Production
ASPNETCORE_URLS=http://127.0.0.1:5000

# PostgreSQL Connection String (Private Localhost or Internal Docker Network Only)
ConnectionStrings__SentinelOps="Host=127.0.0.1;Port=5432;Database=sentinelops_prod;Username=sentinelops_app;Password=REPLACE_WITH_HIGH_ENTROPY_PASSWORD;Maximum Pool Size=50;Timeout=15;"

# Sync Authentication Secrets
Sync__RegistrationToken="REPLACE_WITH_HIGH_ENTROPY_REGISTRATION_TOKEN_MIN_32_CHARS"
Sync__CursorSecret="REPLACE_WITH_RANDOM_HMAC_SECRET_MIN_64_CHARS"

# CORS Configuration (Only allowed PWA origins)
Cors__AllowedOrigins__0="https://sentinelops.yourcompany.com"
Cors__AllowedOrigins__1="https://app.sentinelops.local"

# Rate Limiting
RateLimiting__SyncPermitsPerMinute=120
```

---

## 6. PostgreSQL Provisioning & Hardened Network Setup

### 6.1 Create Isolated Database and User

Connect to PostgreSQL as administrative `postgres` user:

```sql
-- Create isolated database
CREATE DATABASE sentinelops_prod WITH OWNER postgres ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C';

-- Create least-privilege application user
CREATE USER sentinelops_app WITH ENCRYPTED PASSWORD 'REPLACE_WITH_HIGH_ENTROPY_PASSWORD';

-- Grant required permissions
GRANT CONNECT ON DATABASE sentinelops_prod TO sentinelops_app;
\c sentinelops_prod
GRANT USAGE, CREATE ON SCHEMA public TO sentinelops_app;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO sentinelops_app;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO sentinelops_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO sentinelops_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO sentinelops_app;
```

### 6.2 Bind PostgreSQL to Localhost Only

In `/etc/postgresql/16/main/postgresql.conf`:
```ini
listen_addresses = '127.0.0.1'
max_connections = 100
shared_buffers = 512MB
```
In `/etc/postgresql/16/main/pg_hba.conf`:
```ini
# TYPE  DATABASE        USER            ADDRESS         METHOD
host    sentinelops_prod sentinelops_app 127.0.0.1/32    scram-sha-256
```
Restart PostgreSQL service:
```bash
sudo systemctl restart postgresql
```

---

## 7. Migration Execution as a Deliberate Step

**Rule:** Never run migrations automatically on API startup in production. Migrations must be run as an intentional pre-deploy gate.

```bash
# 1. Install or verify dotnet-ef tool
dotnet tool restore || dotnet tool install --global dotnet-ef --version 10.0.1

# 2. Check pending migrations without applying
dotnet ef migrations has-pending-model-changes --project server/SentinelOps.Api/SentinelOps.Api.csproj

# 3. Apply migrations to production database
export ConnectionStrings__SentinelOps="Host=127.0.0.1;Port=5432;Database=sentinelops_prod;Username=sentinelops_app;Password=REPLACE_WITH_HIGH_ENTROPY_PASSWORD;"
dotnet ef database update --project server/SentinelOps.Api/SentinelOps.Api.csproj --startup-project server/SentinelOps.Api/SentinelOps.Api.csproj
```

---

## 8. API Build, Publish & Service Configuration

### 8.1 Publish Release Binaries

```bash
dotnet publish server/SentinelOps.Api/SentinelOps.Api.csproj \
  -c Release \
  -o /opt/sentinelops/api \
  --runtime linux-x64 \
  --self-contained false
```

### 8.2 Systemd Service Unit (`/etc/systemd/system/sentinelops-api.service`)

```ini
[Unit]
Description=SentinelOps Phase 2 Web API (.NET 10)
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=sentinelops
Group=sentinelops
WorkingDirectory=/opt/sentinelops/api
ExecStart=/usr/bin/dotnet /opt/sentinelops/api/SentinelOps.Api.dll
Restart=always
RestartSec=5
KillSignal=SIGINT
SyslogIdentifier=sentinelops-api
EnvironmentFile=/etc/sentinelops/sentinelops.env

# Hardening
ProtectSystem=full
ProtectHome=true
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Enable and start the service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now sentinelops-api
sudo systemctl status sentinelops-api
```

---

## 9. PWA Frontend Build & Static Web Hosting

### 9.1 Build the PWA Static Assets

```bash
# 1. Install frontend dependencies
npm ci

# 2. Compile production build
npm run build
# Outputs optimized production assets into ./dist
```

### 9.2 Copy to Web Root

```bash
sudo mkdir -p /var/www/sentinelops/html
sudo cp -r dist/* /var/www/sentinelops/html/
sudo chown -R www-data:www-data /var/www/sentinelops/html
```

---

## 10. Edge Reverse Proxy, TLS & Hardened Headers

### Caddyfile Configuration (`/etc/caddy/Caddyfile`)

```caddy
sentinelops.yourcompany.com {
    # Automatic HTTPS via Let's Encrypt / ZeroSSL
    tls admin@yourcompany.com

    # Security Headers
    header {
        Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
        Permissions-Policy "camera=(self), geolocation=(), microphone=()"
    }

    # API Proxy
    handle /api/* {
        reverse_proxy 127.0.0.1:5000 {
            header_up X-Forwarded-Proto https
            header_up X-Forwarded-Host {host}
        }
    }

    # Static PWA App Files
    handle {
        root * /var/www/sentinelops/html
        try_files {path} /index.html
        file_server
    }
}
```

Reload Caddy:
```bash
sudo systemctl reload caddy
```

---

## 11. Initial Business & Device Onboarding Procedure

1. **Step 1:** Administrator sets a strong random `Sync:RegistrationToken` on the server and restarts `sentinelops-api`.
2. **Step 2:** Open the SentinelOps PWA on Tablet 1 in the field or office.
3. **Step 3:** Go to **Settings -> Sync & Multi-Tablet**.
4. **Step 4:** Enter:
   - Central API Base URL: `https://sentinelops.yourcompany.com`
   - Business Organization Name: `Sentinel Security PH`
   - Device Name: `Field Tablet 01 - Lead Tech`
   - Registration Key: The token configured in Step 1.
5. **Step 5:** Tap **Connect & Enroll Tablet**. The device receives a unique cryptographic token and registers in the server's `RegisteredDevices` table.
6. **Step 6:** Repeat for Tablet 2 (`Field Tablet 02 - Pasig Van`).

---

## 12. Automated Backup, Retention & Tested Restoration

### 12.1 Daily Encrypted Backup Script (`/usr/local/bin/sentinelops-backup.sh`)

```bash
#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="/var/backups/sentinelops"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/sentinelops_db_${TIMESTAMP}.sql.gz"
GPG_FILE="${BACKUP_FILE}.gpg"
GPG_RECIPIENT="ops@yourcompany.com"

mkdir -p "${BACKUP_DIR}"

# 1. Consistent PostgreSQL snapshot
PGPASSWORD="REPLACE_WITH_HIGH_ENTROPY_PASSWORD" pg_dump \
  -h 127.0.0.1 -U sentinelops_app -d sentinelops_prod \
  --format=custom --no-owner --no-privileges \
  | gzip > "${BACKUP_FILE}"

# 2. Encrypt dump using GPG
gpg --yes --batch --encrypt --recipient "${GPG_RECIPIENT}" "${BACKUP_FILE}"
rm -f "${BACKUP_FILE}"

# 3. Retain last 30 days locally
find "${BACKUP_DIR}" -type f -name "*.sql.gz.gpg" -mtime +30 -delete

# 4. Sync to off-host storage (e.g., rclone to encrypted remote or NAS)
# rclone copy "${GPG_FILE}" remote_nas:sentinelops_backups/

echo "SentinelOps backup completed successfully: ${GPG_FILE}"
```

### 12.2 Cron Job (`/etc/cron.d/sentinelops-backup`)

```cron
0 2 * * * root /usr/local/bin/sentinelops-backup.sh >> /var/log/sentinelops-backup.log 2>&1
```

### 12.3 Tested Restoration Drill Procedure

To verify backup validity, rehearse restoration into an isolated test database every quarter:

```bash
# 1. Decrypt dump
gpg --decrypt /var/backups/sentinelops/sentinelops_db_YYYYMMDD.sql.gz.gpg | gunzip > /tmp/test_restore.dump

# 2. Create isolated sandbox database
createdb -U postgres sentinelops_restore_test

# 3. Restore data
pg_restore -U postgres -d sentinelops_restore_test /tmp/test_restore.dump

# 4. Validate record count integrity
psql -U postgres -d sentinelops_restore_test -c "SELECT COUNT(*) FROM \"SyncEntities\";"
psql -U postgres -d sentinelops_restore_test -c "SELECT COUNT(*) FROM \"ChangeFeedEntries\";"

# 5. Clean up sandbox
dropdb -U postgres sentinelops_restore_test
rm -f /tmp/test_restore.dump
```

---

## 13. Lost / Compromised Tablet Credential Revocation

If an employee loses a field tablet or leaves the company:

```bash
# Revoke device immediately using its Device UUID:
curl -X POST "https://sentinelops.yourcompany.com/api/v1/devices/{DEVICE_UUID}/revoke" \
  -H "X-Registration-Token: REPLACE_WITH_ADMIN_REGISTRATION_TOKEN"

# Result: HTTP 204 No Content.
# The revoked device will receive HTTP 401 Unauthorized on all future sync attempts.
```

---

## 14. Verification Smoke Test Checklist

- [ ] Run health check: `curl -i https://sentinelops.yourcompany.com/api/v1/health/live` (Returns HTTP 200)
- [ ] Run database readiness probe: `curl -i https://sentinelops.yourcompany.com/api/v1/health/ready` (Returns HTTP 200)
- [ ] Enroll Tablet A and create a test client record.
- [ ] Verify outbox counter decrements to 0.
- [ ] Enroll Tablet B and verify client appears via `/api/v1/sync/changes`.
- [ ] Turn off Wi-Fi on Tablet A, edit client address, reconnect Wi-Fi, verify automatic synchronization.
- [ ] Issue quotation on Tablet A, record partial payment, verify balance calculations match across both tablets.

---

*SentinelOps Operations Engineering — Built for Reliable Physical Security Automation.*
