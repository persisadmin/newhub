# PERSIS — Tender Analysis & Pricing Intelligence Platform

PERSIS is a B2B SaaS platform for Malaysian contractors: upload a tender document once, and
PERSIS extracts structured requirements, generates a Bill of Quantities (BOQ), matches prices
from contractor and benchmark sources, flags items that need human review, and gives you a
transparent commercial starting point for tender preparation.

## Tech stack

- **Frontend:** Next.js 15 (App Router), TypeScript, Tailwind CSS 4, shadcn-style UI primitives, dark/light themes
- **Backend:** Next.js Route Handlers (REST), TypeScript, layered service architecture
- **Database:** MongoDB (`mongodb` driver), indexed collections, audit-friendly structures
- **Auth:** NextAuth v5 — Google OAuth + email/password (bcrypt), JWT sessions, RBAC
- **Payments:** Touch 'n Go QR flow behind a swappable provider interface (mock provider included, HMAC webhook verification)
- **Processing:** asynchronous in-process pipeline runner with live stage polling (swap for BullMQ/Redis at scale)

## Architecture

```
app/                    UI + API route handlers (thin)
  (app)/                Protected app: dashboard, projects, pricing review, settings
  api/                  REST endpoints (auth, projects, documents, processing, pricing, payments)
components/             Reusable UI (shadcn-style primitives, app shell, theme)
lib/
  domain/               Types + pricing engine (normalisation, matching, waterfall, hybrid strategies)
  services/             Business services: extraction, pipeline runner, pricing, payments
  db.ts                 MongoDB connection + index bootstrap
  auth-helpers.ts       requireUser / requireOwnedProject (server-side ownership enforcement)
  audit.ts              Append-only audit log writer
scripts/seed.ts         Seed benchmarks, demo user, contractor price library
```

Swappable seams (per spec §17): pricing strategies (`lib/domain/pricing/hybrid.ts`),
benchmark providers (`benchmark_prices` collection), payment provider (`lib/services/payment.ts`),
document extraction (`lib/services/extraction.ts`).

## Setup

```bash
cp .env.example .env.local   # fill in values (see below)
npm install
npx tsx scripts/seed.ts      # optional demo data
npm run dev                  # http://localhost:3000
```

### Required environment variables

| Var | Purpose |
|---|---|
| `NEXTAUTH_SECRET` | JWT/session secret (32+ chars) |
| `MONGODB_URI` / `MONGODB_DB` | MongoDB connection |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth (optional; email/password works without) |
| `TNG_WEBHOOK_SECRET` | HMAC secret for payment webhooks |
| `PRICE_OFF_BENCHMARK_THRESHOLD_PCT` | Off-benchmark flag threshold (default 25) |
| `PRICE_MATCH_CONFIDENCE_THRESHOLD` | Low-confidence flag threshold (default 0.6) |
| `PRICE_HYBRID_STRATEGY` | `weighted_average` or `benchmark_anchored` |
| `TNG_MOCK_AUTO_VERIFY` | Dev convenience for mock payment verification |

### Demo credentials (after seeding)

- Email: `demo@persis.my` · Password: `Demo1234`

### Payments (development)

The mock Touch 'n Go provider implements the full lifecycle
(initiate → QR → paid → server-side verify → subscription activated). In development,
the payment modal includes a simulated wallet scan; production integrations implement the
same `PaymentProvider` interface with real TNGD merchant credentials. Webhooks are
HMAC-SHA256 verified at `POST /api/payments/webhook`.

## Security model

- Every protected API route calls `requireUser()`; project-scoped routes additionally call
  `requireOwnedProject()` so users can never reach another user's data by guessing IDs.
- Manual price overrides are optimistic-locked (`version`) and written to `audit_logs`.
- Uploads are validated for MIME type, extension, and size; auth/payment endpoints are rate-limited.
- Password reset tokens are stored hashed and expire after 1 hour.
- Secrets live only in environment variables.

## Deployment

```bash
npm run build
npm start
```

Requires a reachable MongoDB (Atlas or self-hosted). Set all env vars, run the seed script
once if you want sample data, and point your payment gateway webhook to `/api/payments/webhook`.

## Notes on data

Benchmark entries shipped via `scripts/seed.ts` are **clearly marked sample data**
(`isSeedSample: true`) to exercise the engine. Integrate licensed JKR/CIDB datasets in
production — PERSIS never fabricates prices when data is unavailable; items without a
match are flagged `missing_price` for human review.
