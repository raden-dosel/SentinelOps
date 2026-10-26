<!-- SentinelOps Cloudflare Free Plan Deployment Guide Reference -->
# Cloudflare Free Plan — Plain R2 Project Image Upload: Deployment Guide

The complete, verified production deployment guide for the Cloudflare Free Plan (Plain R2 Option A + Pages Free + ASP.NET Core API) is located at:

👉 [`docs/DEPLOYMENT_GUIDE.md`](docs/DEPLOYMENT_GUIDE.md)

### Key Architecture Highlights
- **100% Free-Tier Compliant**: Zero Cloudflare paid compute, no Containers, no Docker, and no `@cloudflare/sandbox`.
- **Option A Direct-to-R2 Architecture**: ASP.NET Core API issues short-lived AWS SigV4 presigned PUT/GET URLs; browser uploads directly to Cloudflare R2 private bucket.
- **Naming Specification**: Folder `{ProjectName}_{StartDate}` (immutable), File `{N}.{ext}` (monotonically increasing integer starting from 1).
- **Free-Tier Guardrails**: Browser-side canvas downscaling (max 1600px, 0.8 quality), 10 MB per-file limit, 50 images per project limit, 8 GB soft cap.
- **Online-Only Gating**: Exact offline and server-unreachable warning states with both upload button and file picker disabled. Zero-image project creation fully supported.

Please consult [`docs/DEPLOYMENT_GUIDE.md`](docs/DEPLOYMENT_GUIDE.md) for the Manual Configuration Checklist, CORS policy JSON, API environment secrets, and verification commands.
