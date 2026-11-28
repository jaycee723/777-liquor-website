# 777 Inventory

A single-user, login-gated web app for running **777 LIQUOR GROCERY & GIFT
SHOP** (931 University Ave, Honolulu, HI) inventory end to end: import
spreadsheets of any structure, clean and enrich the data, price it with the
store's proven rules, review every change before it applies, export to
Toast Retail, push the Cooler Door catalog to the store website, analyze
Clover sales, and print Avery price tags.

This app productizes the spreadsheet pipeline built in
`~/workspace/inventory-pipeline/` (Phases 1–3: cleanup, vendor invoice cost
matching, and the hardened Phase 3 pricing rulebook). The rules in that
pipeline — not new inventions — are what `core/` implements.

## Feature map (Justin's requirements → where they live)

| Requirement | Where |
|---|---|
| Import spreadsheets with different structures (flexible headers, any vendor/Clover layout) | `POST /api/import`, `core/ingest.py` |
| OCR + Gemini scan of invoices/documents, find context, add what's needed, remove what's not | `POST /api/enrich` (job pipeline; stubs here, bulk UI in AI Studio build) |
| Same cleanup/enrichment/pricing process as the proven pipeline | `core/` (ingest → pricing, ported from Phase 1 + Phase 3) |
| Latest prices from vendor websites (SipMarket, JB Hub, Southern Proof, UPC databases) | `POST /api/enrich` vendor-lookup jobs |
| Brand logos / product images | enrichment + R2 asset store; logo index shared with the website |
| One-click export in Toast Retail format (the populated template's exact columns) | `POST /api/export/toast`, `core/toast_export.py` |
| Clover integration: pull sales data, analytics, price-change suggestions from sales + Honolulu market trends | `GET /api/analytics/*` via the sales adapter — Clover report/CSV exports through the import flow; Clover API only if approved (see ARCHITECTURE.md) |
| New product suggestions from vendors (popularity potential, market trends) | `GET /api/analytics/suggestions` |
| "Push to website" — regenerate the Cooler Door spreadsheet/JSON the store site renders | `POST /api/push/cooler-door` (mirrors `scripts/sync_cooler_door.py` in the website repo) |
| Searchable/filterable price-tag printing, customizable templates, Avery label sheets to spec | Label Studio UI + `POST /api/labels/render`, `core/labels.py` |
| Login screen; only Justin's credentials get in | Worker auth gate (secrets, never code) |

## Build split

- **Built here (this repo):** repo foundation, architecture, API contracts,
  the Cloudflare Worker (auth gate + endpoint stubs), and `core/` — the
  Python reference engine (ingest, pricing, Toast export, Avery labels)
  ported from the verified pipeline.
- **Built in Google AI Studio:** the bulk of the UI (Dashboard, Import
  wizard, Inventory grid, Pricing review, Analytics, Label Studio),
  generated against `docs/API_CONTRACTS.md` with mock data in the same
  shapes. Paste-ready brief: **`docs/AI_STUDIO_BRIEF.md`**.
- **Hosting:** Cloudflare Worker on Justin's domain (777liquor.com
  subdomain TBD), D1 for item data, R2 for uploads/logos/images.

## What's implemented vs stubbed (honest status)

- ✅ `core/ingest.py` — working flexible-header spreadsheet reader → canonical items.
- ✅ `core/pricing.py` — working Phase 3 rules: standard formula, Johnson Brothers market-anchor + floor, HI-5 eligibility, guardrail flags, preview/apply semantics.
- ✅ `core/toast_export.py` — working canonical → Toast Retail template rows/CSV/XLSX.
- ✅ `core/labels.py` — working Avery layout engine (5 templates) + print-accurate HTML renderer.
- ✅ Worker — working login gate, session cookie, 401s on `/api/*`; endpoint handlers are **stubs** returning contract-shaped bodies with `501`/`TODO` markers.
- ⛔ Not built yet: D1 persistence wiring, OCR/Gemini calls, vendor-site crawling, the Clover sales adapter (export-file path first; API path pending merchant/developer approval and may never be enabled), Gemini calls, the real UI. These land in later phases against the contracts in `docs/API_CONTRACTS.md`.

## Local development

```bash
# Reference engine + smoke test (Python 3.10+, openpyxl)
python3 core/tests/smoke_test.py

# Worker (Node 18+)
cd worker
cp .dev.vars.example .dev.vars   # set APP_USERNAME / APP_PASSWORD_HASH locally
npm install
npm run dev                      # wrangler dev
# APP_PASSWORD_HASH = hex SHA-256 of the password:
#   printf %s 'your-password' | shasum -a 256
```

Production secrets are set with `wrangler secret put APP_USERNAME` /
`wrangler secret put APP_PASSWORD_HASH` — never committed, never in code.

## Layout

```
docs/API_CONTRACTS.md   JSON contracts the UI calls (source of truth)
docs/AI_STUDIO_BRIEF.md paste-ready Google AI Studio prompt
ARCHITECTURE.md         system design, storage, auth, integrations
worker/                 Cloudflare Worker (TypeScript): shell + auth + API stubs
core/                   Python reference engine (ingest, pricing, toast_export, labels)
core/tests/             smoke tests
```
