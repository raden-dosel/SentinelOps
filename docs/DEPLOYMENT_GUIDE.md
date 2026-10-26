# Cloudflare Free Plan — Plain R2 Project Image Upload Production Deployment Guide

## 1. Executive Summary & Architecture Decision

This guide provides an end-to-end, copy-paste-accurate deployment runbook for SentinelOps project image uploads operating **strictly on the Cloudflare Free Plan**.

### Architecture Overview (Option A: Direct-to-R2 via API-Issued SigV4 Presigned URLs)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       CLOUDFLARE FREE TIER DEPLOYMENT                       │
│                                                                             │
│   ┌──────────────────────────┐                   ┌───────────────────────┐  │
│   │   Browser / Mobile PWA   │                   │ Cloudflare Pages Free │  │
│   │ (Client-Side Compression │ ◄──────────────── │   (React + Vite SPA)  │  │
│   │   & Online-Only Gating)  │                   └───────────────────────┘  │
│   └─────────────┬────────────┘                                              │
│                 │                                                           │
│     1. POST /images/upload-urls         3. Direct PUT upload                │
│        (File metadata)                     (Raw binary with signed SigV4)   │
│                 │                                    │                      │
│                 ▼                                    ▼                      │
│   ┌──────────────────────────┐                   ┌───────────────────────┐  │
│   │ Existing ASP.NET Core API│                   │  Cloudflare Plain R2  │  │
│   │   (/server/SentinelOps)  │                   │     Private Bucket    │  │
│   │  Issues 15-min SigV4 URL │                   │ (sentinelops-projects)│  │
│   │  Verifies HeadObject     │ ────────────────► │                       │  │
│   └──────────────────────────┘  4. HeadObject /  └───────────────────────┘  │
│                                    Verification                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Free Plan Compliance & Zero Paid Compute
- **Zero Cloudflare Paid Compute**: Does **NOT** use Containers, Docker, `@cloudflare/sandbox`, or paid Workers plans.
- **R2 Free Tier Allowances**:
  - **10 GB** standard storage per month ($0/month).
  - **1,000,000 Class A operations** per month (writes, `PutObject`, list).
  - **10,000,000 Class B operations** per month (reads, `GetObject`, `HeadObject`).
  - **$0 Egress fees**: Cloudflare R2 charges **zero egress bandwidth fees** worldwide.
- **Client-Side Safeguards**:
  - Automatic browser-side canvas downscaling (max dimension 1600px, 0.8 JPEG quality), reducing typical camera photos from 5–15 MB down to ~300–800 KB.
  - Hard limit of 10 MB per file before compression.
  - Free-tier guardrail cap of 50 images per project.
  - Soft budget threshold at 8 GB total storage.

---

## 2. Manual Configuration Checklist (Owner Actions)

The following steps must be performed by the account owner in the Cloudflare Dashboard and hosting environment.

| # | Item | Location | Secret? | Verification / Action |
|---|---|---|---|---|
| **M1** | Cloudflare Free Account | [dash.cloudflare.com](https://dash.cloudflare.com) | No | Log in to your Cloudflare account. Paid subscription is **NOT** required. |
| **M2** | Enable R2 Object Storage | Cloudflare Dashboard → **R2 Object Storage** | No | **Important:** Cloudflare requires a payment method on file to activate R2 (standard anti-abuse verification), but usage within the free tier (10 GB, 1M Class A, 10M Class B) is billed at **$0.00**. |
| **M3** | Retrieve Cloudflare Account ID | Cloudflare Dashboard → Right Sidebar | No | Copy your 32-character hexadecimal Account ID (e.g. `4a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d`). |
| **M4** | Create Private R2 Bucket | Dashboard → R2 → **Create Bucket** | No | Bucket Name: `sentinelops-projects` (Location: `Automatic` / `WNAM` / `EEUR` / `APAC`). Keep **Public Access disabled** and **r2.dev disabled**. |
| **M5** | Configure Bucket CORS | Dashboard → R2 → `sentinelops-projects` → **Settings** → **CORS Policy** | No | Paste the CORS policy JSON permitting `PUT`, `GET`, `HEAD` from your frontend origin (detailed in Section 4). |
| **M6** | Create Scoped R2 API Token | Dashboard → R2 → **Manage R2 API Tokens** | **YES** | Permissions: **Object Read & Write**. Scope: Apply only to bucket `sentinelops-projects`. Copy `Access Key ID` and `Secret Access Key` immediately (shown only once). |
| **M7** | Configure API Host Secrets | ASP.NET Core API environment or `appsettings.Production.json` | **YES** | Set `R2__AccountId`, `R2__AccessKeyId`, `R2__SecretAccessKey`, `R2__BucketName`. |
| **M8** | Configure Frontend Origin | Cloudflare Pages or frontend hosting | No | Set `VITE_API_BASE_URL` to point to the deployed SentinelOps API URL. |

---

## 3. Storage & Naming Specification

All project images adhere to deterministic, clean folder and sequence naming rules:

### 3.1 Folder Naming: `{ProjectName}_{StartDate}`
- **Format**: Sanitized project name + `_` + date-only start date (`YYYY-MM-DD`).
- **Sanitization**: NFKC Unicode normalization, whitespace collapsed to hyphens, removal of illegal characters (`/\:*?"<>|`), capped at 60 characters, Windows reserved names guarded (`CON`, `PRN`, `AUX`, `NUL`).
- **Date Handling**: Formatted date-only (`YYYY-MM-DD`) without UTC shifts, preventing the 1-day backward shift common in UTC+8 (Philippines timezone). Falls back to `'undated'` if missing.
- **Folder Immutability**: The folder name is established upon the first image upload and stored in metadata (`r2FolderName`). Renaming the project later will **not** rename the R2 folder, avoiding expensive Class A rewrite operations.
- **Collision Resolution**: If two projects share the exact same sanitized name and start date, subsequent folders deterministically append `_2`, `_3`, etc.

### 3.2 File Naming: `{N}.{ext}`
- **Sequence**: Monotonically increasing positive integer starting from 1 (`1.jpg`, `2.png`, `3.webp`).
- **Delete Durability**: Sequence numbers are **never reused** when an earlier photo is deleted (next sequence is always `max(existing) + 1`).
- **Extension**: Always derived from the validated MIME type (`image/jpeg` → `.jpg`, `image/png` → `.png`, `image/webp` → `.webp`), never trusting raw client filenames.

### 3.3 Full Object Key: `[{scope}/]{ProjectFolder}/{N}.{ext}`
- Example without tenant scope: `Main-Lobby-CCTV_2026-10-26/1.jpg`
- Example with tenant scope: `sentinelops/{businessId}/Main-Lobby-CCTV_2026-10-26/1.jpg`

---

## 4. Cloudflare R2 Bucket & CORS Configuration

### 4.1 Bucket Creation (via Dashboard or Wrangler)
If using Cloudflare Dashboard:
1. Navigate to **R2** → **Create bucket**.
2. Name: `sentinelops-projects`.
3. Location: `Automatic` (or choose specific jurisdiction if required by compliance).
4. Click **Create Bucket**.
5. Under **Settings**, verify **Public access** is **Not allowed** and **R2.dev subdomain** is **Disabled**.

If using Wrangler CLI locally:
```bash
npx wrangler r2 bucket create sentinelops-projects
```

### 4.2 Configure CORS Policy
In the Cloudflare Dashboard, open `sentinelops-projects` → **Settings** → **CORS Policy** → **Add CORS policy**, and paste:

```json
[
  {
    "AllowedOrigins": [
      "https://*.pages.dev",
      "https://app.sentinelops.com",
      "http://localhost:3000",
      "http://localhost:5173"
    ],
    "AllowedMethods": [
      "GET",
      "PUT",
      "HEAD"
    ],
    "AllowedHeaders": [
      "Content-Type",
      "Content-Length",
      "ETag",
      "x-amz-date",
      "x-amz-content-sha256",
      "authorization"
    ],
    "ExposeHeaders": [
      "ETag",
      "Content-Length",
      "x-amz-request-id"
    ],
    "MaxAgeSeconds": 3600
  }
]
```

### 4.3 Configure Incomplete Multipart Upload Lifecycle Rule
To ensure failed or partial uploads never consume free-tier disk space:
1. Open bucket `sentinelops-projects` → **Settings** → **Lifecycle Rules**.
2. Click **Add rule**:
   - Rule name: `abort-incomplete-multiparts`
   - Action: **Delete incomplete multipart uploads**
   - After: **7 days**
3. Save the rule.

---

## 5. ASP.NET Core API Configuration (`/server/SentinelOps.Api`)

The SentinelOps backend issues AWS SigV4 presigned PUT and GET URLs using the official AWS S3 SDK pointed to Cloudflare's S3 endpoint.

### 5.1 Environment Variables
Configure these variables in your hosting environment (Azure App Service, Linux VM, Docker container on VPS, or Railway/Render):

```bash
# Cloudflare Account ID & R2 Bucket
R2__AccountId="<YOUR_32_CHAR_CLOUDFLARE_ACCOUNT_ID>"
R2__BucketName="sentinelops-projects"
R2__PublicEndpoint="https://<YOUR_32_CHAR_CLOUDFLARE_ACCOUNT_ID>.r2.cloudflarestorage.com"

# Scoped R2 API Token Credentials
R2__AccessKeyId="<R2_ACCESS_KEY_ID>"
R2__SecretAccessKey="<R2_SECRET_ACCESS_KEY>"

# Optional storage prefix scope
R2__TenantPrefix="sentinelops"
```

### 5.2 `appsettings.Production.json` (Template)
```json
{
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning"
    }
  },
  "R2": {
    "AccountId": "YOUR_CLOUDFLARE_ACCOUNT_ID",
    "BucketName": "sentinelops-projects",
    "PublicEndpoint": "https://YOUR_CLOUDFLARE_ACCOUNT_ID.r2.cloudflarestorage.com",
    "AccessKeyId": "YOUR_R2_ACCESS_KEY_ID",
    "SecretAccessKey": "YOUR_R2_SECRET_ACCESS_KEY",
    "TenantPrefix": "sentinelops"
  }
}
```

---

## 6. Frontend Deployment (Cloudflare Pages Free Tier)

Deploying the React Vite SPA on Cloudflare Pages is 100% free with unlimited bandwidth.

### 6.1 Build Settings for Cloudflare Pages
- **Framework preset**: `Vite`
- **Build command**: `npm run build`
- **Build output directory**: `dist`
- **Root directory**: `/` (or repository root)
- **Node.js version**: `20.x` or `22.x`

### 6.2 Frontend Environment Variables
In Cloudflare Pages → **Project Settings** → **Environment variables**:

| Variable | Value | Description |
|---|---|---|
| `VITE_API_BASE_URL` | `https://api.yourdomain.com` | Production URL of SentinelOps API |

### 6.3 Deploying via Wrangler (Direct Upload)
```bash
# 1. Install dependencies
npm install

# 2. Build production assets
npm run build

# 3. Deploy to Cloudflare Pages (Free tier)
npx wrangler pages deploy dist --project-name sentinelops-app
```

---

## 7. Verification & Health Checks

Verify your deployment with these step-by-step checks:

### 7.1 Verify Automated Unit Tests
Run the test suite locally or in CI:
```bash
npm test
```
**Expected Output**:
```
✓ tests/r2Upload.test.ts (16 tests)
✓ tests/projectImageNaming.test.ts (17 tests)
✓ tests/connectivity.test.ts (3 tests)
All 11 test files passed (77 tests)
```

### 7.2 Test Presigned URL Generation via cURL
Test your API endpoint directly:

```bash
# 1. Request presigned PUT URL
curl -X POST "https://api.yourdomain.com/api/v1/projects/PRJ-001/images/upload-urls" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TEST_OR_DEVICE_TOKEN>" \
  -d '{
    "files": [
      {
        "fileName": "test_photo.jpg",
        "fileType": "image/jpeg",
        "fileSize": 102400,
        "attachmentId": "test-att-001",
        "sequenceNumber": 1,
        "folderName": "Test-Project_2026-10-26"
      }
    ]
  }'

# 2. Check JSON response contains uploadUrl and objectKey:
# {
#   "presignedUrls": [
#     {
#       "uploadUrl": "https://<ACCOUNT_ID>.r2.cloudflarestorage.com/sentinelops-projects/...",
#       "objectKey": "sentinelops/default/Test-Project_2026-10-26/1.jpg",
#       "attachmentId": "test-att-001",
#       "sequenceNumber": 1,
#       "expiresInSeconds": 900
#     }
#   ]
# }
```

### 7.3 Test Direct PUT Upload to R2
```bash
# 3. Upload a sample image using the generated presigned PUT URL:
curl -X PUT "<UPLOAD_URL_FROM_PREVIOUS_STEP>" \
  -H "Content-Type: image/jpeg" \
  --data-binary "@sample.jpg" \
  -v

# Expected: HTTP 200 OK or HTTP 204 No Content with ETag header.
```

### 7.4 Test Online-Only Gating UI Behavior
1. Open the web app and navigate to **Security Projects & Installations**.
2. Select any project.
3. Open browser DevTools → **Network** tab → set throttling to **Offline**:
   - The upload button becomes disabled with a muted cursor.
   - The file input is disabled.
   - The alert displays: `"No internet connection. Connect to the internet to upload project images."`
4. Set throttling back to **Online**, and stop the local API server:
   - The alert displays: `"SentinelOps server is unreachable. Image uploads are temporarily unavailable. Check your connection and try again."`
5. Restart the API server and click **Retry Check**:
   - The ready badge displays: `"SentinelOps API connected. Cloudflare R2 uploads enabled."`
   - The upload button is re-enabled.

---

## 8. Free-Tier Monitoring & Budget Management

To guarantee operations never exceed the Cloudflare free limits:

### 8.1 Free Tier Limits Summary
| Metric | Monthly Free Allowance | SentinelOps Safety Guardrail |
|---|---|---|
| **Storage** | 10 GB-months | Max 50 photos per project + client canvas compression to ~400 KB |
| **Class A Operations** (Writes) | 1,000,000 requests | ~2 requests per upload (PUT + HeadObject). Capable of ~500,000 uploads/month |
| **Class B Operations** (Reads) | 10,000,000 requests | Download URL requests are signed and cached |
| **Egress Bandwidth** | **Unlimited $0.00** | Cloudflare R2 has zero egress fees |

### 8.2 Monitoring Dashboard
1. Go to Cloudflare Dashboard → **R2** → **sentinelops-projects** → **Metrics**.
2. Track **Total Storage**, **Class A Operations**, and **Class B Operations**.
3. Optional: Set up Cloudflare Notifications under **Manage Account** → **Notifications** to alert if storage exceeds 8 GB.

---

## 9. Rollback & Emergency Runbook

### 9.1 Temporary Reversion to Local-Only Storage
If Cloudflare R2 experiences an outage or account access is temporarily interrupted:
1. SentinelOps includes an integrated offline-first local storage option (**"Add Local Photo"**).
2. Users can continue capturing photos directly into the device's IndexedDB without interrupting field operations.
3. Photos stored locally remain accessible on the device and can be exported as reports.

### 9.2 Rotating R2 API Tokens
If an R2 API token is compromised:
1. In Cloudflare Dashboard → **R2** → **Manage R2 API Tokens**.
2. Click **Create API Token** → configure with **Object Read & Write** on `sentinelops-projects`.
3. Update `R2__AccessKeyId` and `R2__SecretAccessKey` in the ASP.NET Core API environment.
4. Restart the API server.
5. In the Cloudflare Dashboard, delete the old compromised API token.

---

## 10. Troubleshooting Reference

| Symptom / Error | Root Cause | Resolution |
|---|---|---|
| `CORS error: Response to preflight request doesn't pass access control check` | R2 bucket CORS policy missing or does not include origin | Verify R2 bucket CORS policy in Section 4. Ensure `AllowedOrigins` includes `https://*.pages.dev` and your production domain. |
| `SignatureDoesNotMatch` on direct PUT | Client sent a `Content-Type` differing from the signed URL | Ensure browser PUT request uses exact `Content-Type` matching the presigned URL request (`image/jpeg`, `image/png`, or `image/webp`). |
| `Upload button disabled with offline message` | Browser is offline or network interface disconnected | Connect to Wi-Fi / cellular data. Message clears automatically when network recovers. |
| `Server unreachable alert displayed` | SentinelOps API `/api/v1/health` failed or returned non-200 | Verify API service is running and accessible at `VITE_API_BASE_URL`. Click **Retry Check**. |
| `Project image limit reached` | Project already contains 50 attachments | Free-tier safeguard prevents excessive storage bloat. Delete unused photos or archive old records. |
| `File size exceeds 10 MB free-tier limit` | Raw uncompressed file exceeds 10 MB | Choose a file under 10 MB. Client-side canvas compression automatically reduces size to ~400 KB before upload. |
| `R2 service activation error` | No payment method on Cloudflare account | Add a valid credit card or PayPal in Cloudflare billing (required to activate R2, even though 10 GB free tier is $0.00). |
