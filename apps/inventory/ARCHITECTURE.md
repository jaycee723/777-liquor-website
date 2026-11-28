# Architecture — 777 Inventory

## Data flow

```
            ┌─────────────┐   ┌──────────────┐   ┌───────────────┐
 spreadsheets│   IMPORT    │   │   ENRICH     │   │    PRICE      │
 invoices ──▶│ flexible-   │──▶│ OCR (scans)  │──▶│ Phase 3 rules │
 Clover ────▶│ header      │   │ Gemini       │   │ suggestions + │
 exports     │ ingest      │   │ (context)    │   │ guardrail     │
             └─────────────┘   │ vendor sites │   │ flags         │
                               │ UPC APIs     │   └──────┬────────┘
                               │ logos/images │          │
                               └──────────────┘          ▼
                                              ┌───────────────────┐
                                              │  REVIEW / APPLY   │
                                              │ originals kept;   │
                                              │ apply is explicit │
                                              └──────┬────────────┘
              ┌──────────────┬──────────────┬────────┴───────┬──────────────┐
              ▼              ▼              ▼                ▼              ▼
        Toast Retail    Cooler Door    Sales data     Analytics     Avery label
        export file     push to site   sync (read)     + suggestions sheets (print)
```

1. **Import** — a spreadsheet of *any* structure is uploaded; the ingest
   engine maps whatever headers it finds (Clover exports, vendor price
   books, Toast templates, the Cooler Door sheet) onto the canonical item
   schema and returns a normalized preview with per-row issues. Nothing is
   committed until the user confirms the import.
2. **Normalize** — names/sizes/packs parsed deterministically (ported from
   the pipeline: `phase1_cleanup.py`, `sync_cooler_door.py`). Duplicates,
   malformed UPCs, and dead SKUs are flagged, never silently dropped.
3. **Enrich** — async jobs fill gaps: OCR for scanned invoices, Gemini for
   context/classification where deterministic rules can't decide, vendor
   websites (SipMarket = Reyes/Island Distributing, JB Hub = Johnson
   Brothers, shop.sgproof.com = Southern Glazer's) and UPC databases for
   missing costs, logo/image lookup for brands. All arithmetic stays in
   code — the LLM never computes prices (pipeline rule).
4. **Price** — the Phase 3 engine (`core/pricing.py`) computes suggested
   prices + guardrail flags from the best cost source. Suggestions are
   proposals only.
5. **Review / apply** — the user previews current vs suggested, per-row or
   master apply; originals are preserved until an explicit apply writes
   new prices (and even then the previous price is kept in history).
6. **Outputs** — Toast Retail export file, Cooler Door push, analytics,
   label sheets.

## Module map

| Module | Responsibility |
|---|---|
| `worker/src/index.ts` | HTTP shell, auth gate, routing, API stubs → later: D1/R2 wiring |
| `core/ingest.py` | Spreadsheet → canonical items (flexible headers) |
| `core/pricing.py` | Phase 3 rulebook: formula, Johnson rule, HI-5, flags, preview/apply |
| `core/toast_export.py` | Canonical items → Toast Retail template rows |
| `core/labels.py` | Avery template registry, layout math, print HTML |
| AI Studio UI | All screens; calls `docs/API_CONTRACTS.md` only |

The Python `core/` is the **reference engine**: it is the executable spec
the pipeline already proved. The Worker mirrors the same contracts; where
behavior matters (pricing!), the TypeScript port must match `core/` outputs
on the shared test fixtures.

## Storage

- **Cloudflare D1 (chosen) for item/app data.** The canonical item is a
  flat relational record (one row per item, indexed by UPC, brand,
  category, vendor); the UI's core operations are exactly SQL-shaped:
  search, filter, sort, paginate over ~5k items. D1 gives that for free
  with zero egress cost and keeps label templates, price history, import
  batches, and enrichment jobs as ordinary tables. KV was rejected for
  items: it has no query model — every filter/sort would become a full
  scan in the Worker. KV may still be used later as a read cache for the
  Cooler Door JSON.
- **Cloudflare R2 for files:** uploaded spreadsheets and invoice scans,
  brand logos, product images, generated Toast exports and label PDFs.
  Zero egress fees matter because the store website pulls logos from the
  same bucket.
- **Secrets** (Worker secrets / `.dev.vars` locally): `APP_USERNAME`,
  `APP_PASSWORD_HASH`, `GEMINI_API_KEY`. Never in code, never in git.
  Clover API credentials (`CLOVER_API_TOKEN` / OAuth client credentials)
  are **optional and pending approval** — they are only needed if the
  Clover API sales adapter (below) is ever enabled; the app runs fully
  without them.

## Auth design

Single user (Justin). The Worker checks every request:

- `POST /login` compares the submitted username to `APP_USERNAME` and the
  SHA-256 of the submitted password to `APP_PASSWORD_HASH` (both Worker
  secrets), then sets an HttpOnly, Secure, SameSite=Lax session cookie
  containing an HMAC-signed, expiring token.
- All `/api/*` routes return `401 { "error": "unauthorized" }` without a
  valid session. The app shell HTML is served only behind the same gate
  (the login page is the only public route besides `/api/health`).
- No user database, no registration, no password reset flow — credentials
  are rotated by changing the Worker secret.

## Sales data adapter (Clover)

**Design rule: the app must not depend on Clover API access.** Justin
will attempt to obtain it, but approval is not guaranteed, so sales data
enters through an adapter interface with two interchangeable
implementations. Everything downstream — analytics, per-item velocity,
price-change suggestions — consumes only the adapter's normalized sales
records and works identically either way.

```
                 ┌─────────────────────┐
  Clover API ───▶│                     │
  (OAuth,        │   SalesAdapter      │──▶ normalized sales records ──▶ analytics
   PENDING)      │                     │    (D1: sales_records)
  Clover report/ ├─────────────────────┤
  CSV exports ──▶│  export-file impl   │
  (no API needed)└─────────────────────┘
```

- **Implementation A — Clover API (pending merchant/developer
  approval).** OAuth app / merchant API token held as a Worker secret;
  a sync job pulls orders/line items on a schedule. Status: **not
  approved yet; nothing in the app may assume it exists.** If approval
  never comes, this implementation is simply never enabled and nothing
  else changes.
- **Implementation B — Clover report/CSV exports (works today, no API
  needed).** Justin exports sales reports from the Clover dashboard and
  drops the files into the **same spreadsheet import flow** as
  everything else (`POST /api/import` with `kind: "sales"`). The
  flexible-header ingest maps Clover's report columns (in whatever
  layout the export uses) onto the same normalized sales records.
  This is the default path and the one the UI is built around.

**Normalized sales record** (the adapter's output; stored in D1):

```jsonc
{ "sold_at": "2026-11-25T14:03:00-10:00", "clover_id": "DQ43608XZ45TP",
  "item_name": "Smirnoff Ice Original 6pk", "upc": "082000807407",
  "quantity": 2, "gross_amount": 7.98, "discount_amount": 0,
  "net_amount": 7.98, "source": "clover_export" }  // or "clover_api"
```

Records join to catalog items by `clover_id` first, then UPC, then
normalized name — the same matching discipline as the vendor pipelines.
`source` is provenance only; no analytics query branches on it.

Catalog reconciliation by `clover_id` (the canonical key) also uses
whichever path is available: API item reads under Implementation A, or
ordinary Clover item-export spreadsheets through the import flow under
Implementation B. **Writes to Clover are out of scope** in both paths.

## Integration points

- **Clover** — via the sales data adapter above only. API path pending
  merchant/developer approval; export-file path needs no approval.
- **Gemini** — `GEMINI_API_KEY` secret; called server-side only, for
  document context extraction (invoice → line items), ambiguous
  classification, and product-suggestion drafting. Gemini output is
  always validated by deterministic code before it touches data, and it
  never does price arithmetic.
- **Vendor sites** — SipMarket, JB Hub, shop.sgproof.com are login-walled
  (verified 2026-11-26: prices require the store's account sign-in).
  Lookups run as enrichment jobs inside Justin's signed-in session
  context; credentials are never stored in the app.
- **Store website** — `POST /api/push/cooler-door` regenerates
  `cooler-door-items.json` in the exact shape `777liquor.com/cooler-door`
  already consumes (alcohol-only filter, brand logos resolved), replacing
  the repo's GitHub-Action spreadsheet sync with an app-driven push.
