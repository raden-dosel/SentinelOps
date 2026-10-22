# SentinelOps — Security Installation Operations Management System

SentinelOps is an **offline-first Business Operations Management System** designed for security installation service businesses specializing in:
- **Electric fence installation**
- **Automatic gate automation systems**
- **CCTV & access control infrastructure**
- **Perimeter maintenance & emergency callouts**

Built as a tablet-first Progressive Web Application (PWA), SentinelOps allows business owners and operational managers to run customer CRM, quotation preparation, billing, payment collections, and project tracking directly from an Android tablet (or any modern tablet/desktop browser) without requiring an internet connection or cloud database.

---

## 1. Technology Stack

| Domain | Technology | Justification |
|---|---|---|
| **Frontend Framework** | React 19 + TypeScript | Strict typing, declarative UI, robust component architecture |
| **Build & Dev Tooling** | Vite 8 | Fast dev server, instant compilation, HMR control |
| **Styling & Design System** | Tailwind CSS v4 | High-contrast dark theme, touch-friendly tablet sizing |
| **Local Persistence** | IndexedDB via `idb` | Structured transactional database for relational-style business records |
| **Offline PWA** | `vite-plugin-pwa` + Service Worker | Offline cache, install prompt (`beforeinstallprompt`), standalone display |
| **PDF Generation** | `pdf-lib` | 100% offline client-side vector PDF generation for quotes, invoices & receipts |
| **Data Compression** | `jszip` | Offline ZIP bundle export & restore for database + site photos |
| **Charts & Metrics** | `recharts` | Responsive SVG charts for revenue flow and project pipelines |
| **Local Security** | Web Crypto API | PBKDF2 (100,000 iterations) password hashing with unique salt |
| **Testing** | Vitest | Fast automated unit & domain test coverage |

---

## 2. Architecture & Directory Structure

```text
src/
├── app/
│   ├── App.tsx                     # Top-level shell & navigation router
│   └── providers/
│       ├── AuthContext.tsx         # PBKDF2 master authentication & session lock
│       └── ToastContext.tsx        # Non-blocking user feedback notifications
├── components/
│   ├── layout/
│   │   └── AppLayout.tsx           # Tablet-first navigation bar & responsive drawer
│   └── ui/
│       ├── Badge.tsx               # Status indicators for leads, quotes, invoices
│       ├── ConfirmDialog.tsx       # Safe confirmation dialogs for destructive actions
│       ├── Modal.tsx               # Touch-friendly accessible dialogs
│       ├── OfflineIndicator.tsx    # Live network connectivity monitor
│       └── PWAInstallButton.tsx    # In-app installation prompt (Android / iOS)
├── domain/
│   └── calculations.ts             # Integer centavos monetary math, VAT & overdue logic
├── features/
│   ├── auth/
│   │   ├── SetupScreen.tsx         # First-run admin vault initialization
│   │   ├── LoginScreen.tsx         # Local vault unlock & security question recovery
│   │   └── LockScreen.tsx          # Auto-lock / manual session lock overlay
│   ├── clients/
│   │   └── ClientsView.tsx         # CRM registry, inquiry pipeline, search & details
│   ├── quotations/
│   │   └── QuotationsView.tsx      # Quotation builder, revision history & PDF generator
│   ├── billing/
│   │   └── BillingView.tsx         # Invoices, partial payment collections & receipts
│   ├── projects/
│   │   └── ProjectsView.tsx        # Project tracking, progress notes & photo attachments
│   ├── dashboard/
│   │   └── DashboardView.tsx       # Real-time metrics, KPI cards & Recharts graphs
│   └── settings/
│       └── SettingsView.tsx        # Business profile, tax, security, backup/restore
├── services/
│   ├── backupService.ts            # JSON & ZIP export/import, schema validation
│   ├── pdfGenerator.ts             # Offline PDF layout engine via pdf-lib
│   └── security.ts                 # Web Crypto PBKDF2 hashing, AES-GCM & salts
├── storage/
│   ├── database.ts                 # IndexedDB schema, migrations & number sequences
│   └── repositories.ts             # Repository pattern isolating IndexedDB access
├── types/
│   └── index.ts                    # Central domain TypeScript definitions
└── main.tsx                        # Application mount entrypoint
```

---

## 3. Local Setup & Commands

### Prerequisites
- Node.js 20+ installed
- npm or bun package manager

### Installation
```bash
npm install
```

### Development Server
```bash
npm run dev
```
Launches the local Vite dev server at `http://localhost:3000`.

### Production Build
```bash
npm run build
```
Creates an optimized production bundle in `dist/`.

### Automated Testing
```bash
npm test
```
Runs the Vitest test suite validating monetary precision, tax calculations, overdue evaluation, and security functions.

### Phase 2 API development

The API is an additive, authenticated sync slice; the existing IndexedDB application remains usable without it. IndexedDB is the tablet's offline cache and durable outbox, while PostgreSQL is the shared cloud source of truth after a device is enrolled. Client and settings changes request an immediate sync when online and are retried by the coordinator when offline.

```bash
docker compose -f server/docker-compose.yml up -d postgres
dotnet ef database update --project server/SentinelOps.Api --startup-project server/SentinelOps.Api
dotnet run --project server/SentinelOps.Api
```

Configure `ConnectionStrings__SentinelOps`, `Sync__RegistrationToken`,
`Sync__CursorSigningKey`, and explicit `Cors__AllowedOrigins` values outside
development. Register a device through
`POST /api/v1/devices/register` using the registration token, then use the returned
device token as a bearer token for `/api/v1/sync/push` and `/api/v1/sync/changes`.
The device token is only returned at registration time and is stored server-side as
a SHA-256 hash. Do not use the development token in a deployed environment.

For a production PWA build, set `VITE_API_BASE_URL` to the public HTTPS API origin
before `npm run build` (for example, `https://api.example.com`). Enroll each tablet
from Settings > Cloud Sync using the same business name and production registration
token. Existing local records are uploaded through the outbox; the browser never
connects directly to Neon.

The current API sync slice accepts only `Client`, `Project`, `ProjectProgressNote`,
and `Settings` payloads. Invoices, payments, quotations, revisions, attachments,
and audit events remain local-only until typed server validation and transaction
tests are implemented. See the [Phase 2 readiness audit](docs/phase2-api-database-readiness-audit.md)
and [deployment runbook](docs/phase2-deployment-runbook.md) before using business data.

### Production workflow

The `production` job in `.github/workflows/ci.yml` is manual and runs only when
the `deploy_production` input is enabled. Configure these secrets in the
repository's `production` GitHub environment:

- `NEON_CONNECTION_STRING`: Neon connection string used for EF migrations and
  the Neon integration test.
- `RENDER_DEPLOY_HOOK_URL`: Render service deploy-hook URL.
- `RENDER_API_HEALTH_URL`: the deployed API readiness URL, for example
  `https://api.example.com/api/v1/health/ready`.

The Render service itself must also have `ConnectionStrings__SentinelOps`,
`Sync__RegistrationToken`, `Sync__CursorSigningKey`, and
`Cors__AllowedOrigins__0` configured as runtime environment variables. GitHub
does not copy these values into Render automatically; configure them in Render
directly or add a separate deployment step for that purpose.

### PWA Verification

PWA installation and service-worker registration require HTTPS in production. `localhost` and loopback origins are also supported for development; opening `index.html` with a `file://` URL is not supported.

To verify the production PWA locally:

```bash
npm run build
npm run preview
```

Open the preview URL in Chrome or Edge, wait for the `Offline startup is ready` message, then use DevTools to confirm that the manifest, service worker, and three PNG icons load successfully. Reload once, enable network throttling or offline mode, and reload again to verify the application shell and local IndexedDB records remain available. Reconnect before testing an update; updates are offered through the `Load update` action so an active form is not silently reloaded.

The service worker precaches generated application assets, the manifest, and local icons only. It does not cache credentials, session responses, business records, or IndexedDB data. The first visit must be online so those resources can be cached.

---

## 4. Android Tablet Installation Guide

1. Ensure your tablet is connected to the same local network or accessing SentinelOps via HTTPS (Chrome and Android require HTTPS or `localhost` to register Service Workers and trigger PWA installation).
2. Open Google Chrome on your Android tablet and navigate to the application URL.
3. Tap the **"Install App"** button located in the top navigation bar, or open the Chrome menu (`⋮`) and tap **"Add to Home Screen"** / **"Install app"**.
4. SentinelOps will be added to your tablet's home screen as an independent app icon.
5. Tap the home screen icon to launch SentinelOps in `standalone` display mode (no browser URL bar or controls).
6. Complete the **First-Run Administrator Setup** to establish your local master password.

---

## 5. Offline Operation & Cache Update Behavior

- **Offline Shell**: Once cached by the Service Worker, SentinelOps opens and functions without an active internet connection.
- **Offline Data**: All client profiles, quotations, billing statements, payment ledgers, and site photos persist directly inside the tablet's browser IndexedDB database.
- **PDF Generation**: Powered by `pdf-lib`, quotations, invoices, and collection receipts are compiled entirely on-device without contacting any remote API or server.
- **Offline Indicator**: If the tablet goes offline, an ambient badge displays: `Offline Mode — All changes persist locally in IndexedDB`.
- **Cache Updates**: When a new version is built and served, the service worker automatically detects changes and updates precached assets in the background.

---

## 6. Business User Guide

### A. First-Run Setup & Security
1. On first launch, SentinelOps prompts you to configure your administrator name, master password, and recovery security question.
2. Credentials are salted and hashed using PBKDF2 (SHA-256) inside the browser.
3. If left idle, SentinelOps locks the session after your configured timeout (default: 15 minutes) to protect customer data.

### B. Client Management (CRM)
1. Navigate to **Clients & CRM**.
2. Tap **Add New Client** to record name, phone number, installation address, lead source (e.g., Referral, Facebook), and status (`New Inquiry`, `Site Visit Scheduled`, `Quotation Sent`, `Won`, `Lost`).
3. Tap any client card to inspect linked quotations, projects, and billing records.

### C. Preparing a Quotation & Generating a PDF
1. Go to **Quotations** or tap **"Draft Quotation for Client"** from a client card.
2. Add line items under relevant categories (**Materials**, **Labor**, **Mobilization**, **Contingency**).
3. The system computes integer centavo totals and applies the configured VAT mode (VAT Exclusive, VAT Inclusive, or Non-VAT).
4. Tap **PDF** to download an itemized commercial quotation ready for client sign-off.
5. Tap **Print** to send to any Bluetooth or Wi-Fi tablet printer.
6. When the client approves, tap **Mark Accepted**. You can then tap **Generate Invoice** or **Start Project** with one click.

### D. Invoicing & Payment Collection
1. Navigate to **Billing & Payments**.
2. Invoices generated from accepted quotations or standalone services display grand totals and remaining balances.
3. Tap **Record Payment** to log partial or full payments. Select payment method (Cash, BDO, BPI, GCash, Maya, Check) and enter reference numbers.
4. Overpayment is strictly blocked by business logic.
5. Tap **Receipt** to download or print a **Collection Receipt** with amount in words, remaining balance, and received-by signature line.

### E. Project Tracking & Site Photos
1. Navigate to **Projects**.
2. Track installation statuses: `Planning`, `Survey`, `Approved`, `Ongoing`, `Completed`, `Closed`.
3. Tap **Add Photo / File** to attach site survey photos, fence bracket pictures, or motor wiring diagrams. Photos are stored locally in IndexedDB as binary blobs.
4. Add timestamped progress notes to record daily installation milestones.

### F. Backups & Disaster Recovery
1. Navigate to **Settings > Backup & Storage**.
2. Tap **Export Full ZIP Archive (with Photos)**.
3. Save the ZIP file to a USB flash drive (via tablet USB-C adapter) or upload it to Google Drive / OneDrive.
4. To restore onto a new tablet: open Settings, select the `.zip` or `.json` file, verify the preview counts, and tap **Confirm & Restore**.

---

## 7. Data Storage & Security Boundaries

1. **Local Isolation**: All records reside within the browser's IndexedDB partition for the host origin. Data does not leave your tablet unless you explicitly export a backup.
2. **Browser Clearing Risk**: If browser site data is manually cleared in Android settings, IndexedDB data will be lost. **Regular weekly ZIP backups to external media are required.**
3. **Password Security**: Passwords are never stored in plaintext. They are hashed using 100,000 iterations of PBKDF2-HMAC-SHA-256 with cryptographically random 16-byte salts.
4. **Philippine Tax Notice**: Generated documents are internal commercial quotations, billing invoices, and collection receipts. They do not claim to be authorized BIR Computerized Accounting System (CAS) or Point-of-Sale (POS) tax documents.

---

## 8. Multi-Tablet Backend & Synchronization (Phase 2 Implemented)

SentinelOps includes an enterprise-grade, offline-first synchronization subsystem connecting multiple Android field tablets to an ASP.NET Core Web API with PostgreSQL:

```text
[Multi-Tablet Phase 2 Architecture]
Tablet 1 (PWA) ──> Atomic Outbox ──┐
Tablet 2 (PWA) ──> Atomic Outbox ──┼─> Sync Coordinator ──> ASP.NET Core API ──> PostgreSQL 16
Tablet 3 (PWA) ──> Atomic Outbox ──┘   (HMAC Cursors,           (Domain Validation,    (Monotonic Change
                                       Crash-Safe Pulls)        Financial Invariants)   Feed, Audit Log)
```

Implemented capabilities:
- **Atomic Local Mutations & Durable Outbox:** Every client, quotation, revision, invoice, payment, project, and attachment write commits its entity record and outbox operation in a single IndexedDB transaction.
- **HMAC Authenticated Cursors:** Sync cursors are signed with HMAC-SHA256, protecting against sequence tampering and cross-business leakage.
- **Push Idempotency & Financial Invariants:** Duplicate payment operations return `already_applied` without double-deduction. Invoices maintain `remainingBalance = grandTotal - paidAmount`.
- **Full Resync & Stale-Cursor Recovery:** If a cursor expires, full snapshot recovery applies remote state while preserving unpushed local outbox edits.
- **Device Credential Revocation:** Immediate lost-device revocation via `POST /api/v1/devices/{id}/revoke`.
- **Dry-Run Backup Migration:** Automated analysis of `.json` and `.zip` backups with relationship audits, numbering collision detection, and safe non-destructive merge.
- **Complete Deployment Runbook:** Refer to `docs/phase2-deployment-runbook.md` for production topologies, $0 office host setups, security hardening, and backup automation.
