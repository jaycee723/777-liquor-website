# API Contracts — 777 Inventory

The UI (Google AI Studio build) talks to the app **only** through these
contracts. The Cloudflare Worker implements them; `core/` (Python) is the
reference implementation of the underlying logic. All bodies are JSON
unless noted. All `/api/*` routes require the session cookie (see
ARCHITECTURE.md → Auth); unauthenticated requests get
`401 { "error": "unauthorized" }`.

Conventions:

- Money is a number in dollars (`12.99`), never a string, except inside
  the Toast export file itself (Toast's template uses `$12.99` strings).
- `null` means "no value on record" — the UI must render it as blank,
  never as 0.
- Lists use `{ "items": [...], "total": n, "page": p, "page_size": s }`.
- Errors: `{ "error": "<machine_code>", "message": "<human text>" }`
  with a matching HTTP status.
- IDs are strings. `id` is the app's internal id; `clover_id` is the
  Clover item id when the item came from Clover.

---

## Canonical item schema

```jsonc
{
  "id": "itm_01J…",                 // app id (string)
  "clover_id": "DQ43608XZ45TP",     // Clover item id, or null
  "name": "Smirnoff Ice Original 6pk",
  "normalized_name": "Smirnoff Ice Original 6pk",  // [Brand] [Product] [Size] [Pack]
  "brand": "Smirnoff",
  "category": "Beer & Seltzers",    // store category (Clover taxonomy today)
  "subcategory": null,              // Toast subcategory is unused today; keep null
  "upc": "082000807407",            // string, digits only, or null
  "price": 3.99,                    // current retail price — the LIVE price
  "cost": 2.74,                     // best unit cost on record, or null
  "case_cost": null,                // vendor case cost when cost came from an invoice
  "list_case_cost": null,           // Johnson Brothers ListCase (market anchor), or null
  "packs_per_case": null,           // sellable packs per case, or null if unknown
  "cost_source": "Clover",          // "Vendor: <name>" | "Clover" | "Website: <name>" | null
  "vendor": "Island Distributing",  // vendor tag, or null
  "unit_size": "12oz",              // parsed size token, or null
  "sell_pack_qty": 6,               // containers per sellable unit, or null
  "hi5_eligible": "Yes",            // "Yes" | "No" | "Confirm" (ambiguous RTD) | null
  "quantity": 5,                    // on-hand (negatives are zeroed at ingest)
  "hidden": false,
  "logo_url": "/images/brands/smirnoff.png",  // or null
  "image_url": null,                // product photo, or null
  "flags": ["CAT_CONFLICT"],        // pipeline flags, may be []
  "updated_at": "2026-11-26T17:00:00Z"
}
```

Flag vocabulary (from the Phase 3 rulebook — see `core/pricing.py`):
`NO_COST`, `NEED_PACK_CONFIG`, `PACK_DERIVED`, `REVIEW` (suggested > +20%
vs current), `PRICE_DROP`, `COST_GE_PRICE`, `COST_OUTLIER`,
`COST_CONFLICT`, `ZERO_PRICE`, `NO_PRICE`, `CAT_CONFLICT`, `CAT_MISSING`,
`HI5_CONFIRM`, `FEE_ITEM`, `JOHNSON_MARKET_ANCHOR`, `JOHNSON_FLOOR_FAIL`,
`JOHNSON_NO_LIST_ANCHOR`.

---

## Endpoints

### `GET /api/health`
No auth. → `200 { "ok": true, "service": "777-inventory", "version": "0.1.0" }`

### `POST /login` / `POST /logout`
Form or JSON `{ "username": "...", "password": "..." }`.
Success: `200 { "ok": true }` + `Set-Cookie: session=…; HttpOnly; Secure; SameSite=Lax`.
Failure: `401 { "error": "invalid_credentials" }`.

### `POST /api/import`
Multipart form upload: `file` (`.xlsx` / `.csv`, any structure) +
optional `source_label` (e.g. `"Clover export"`, `"Johnson invoice book"`) +
optional `kind`:

- `kind: "inventory"` (default) — item spreadsheets; behavior below.
- `kind: "sales"` — **Clover sales report/CSV exports.** This is the
  no-API sales path of the sales data adapter (see ARCHITECTURE.md →
  "Sales data adapter"): the file goes through the same flexible-header
  ingest, but rows normalize into **sales records**, not items:
  `{ "sold_at", "clover_id", "item_name", "upc", "quantity",
  "gross_amount", "discount_amount", "net_amount",
  "source": "clover_export" }`. The preview/commit flow is identical
  (preview first, nothing committed until commit); the preview body
  carries `records` instead of `items`. Analytics endpoints consume
  these records exactly as they consume records from the Clover API
  adapter (`source: "clover_api"`, **pending merchant/developer
  approval** — the API path may never be enabled, and no endpoint
  depends on it).

The server runs the flexible-header ingest (`core/ingest.py`) and returns
a **preview** — nothing is committed yet.

→ `200`
```jsonc
{
  "import_id": "imp_…",
  "source_file": "inventory-export.xlsx",
  "rows_read": 5296,
  "items_parsed": 5189,
  "items": [ /* canonical items, first page of 100 */ ],
  "issues": [
    { "row": 42, "code": "NO_NAME_OR_PRICE", "detail": "…" },
    { "row": 87, "code": "MALFORMED_UPC", "detail": "…" }
  ],
  "issue_counts": { "MALFORMED_UPC": 46, "DUPLICATE_UPC": 217 }
}
```
Commit step: `POST /api/import/:import_id/commit` →
`200 { "committed": 4594, "archived_duplicates": 496 }`.
Status semantics: `400` unreadable file / no recognizable header row;
`413` file too large; `422` parsed but zero items.

### `POST /api/enrich`
Starts an async enrichment job over a set of items.
```jsonc
// request
{ "item_ids": ["itm_…"],            // or "filter": { …GET /api/items query… }
  "tasks": ["ocr", "gemini_context", "vendor_cost", "upc_lookup", "logo", "image"] }
// → 202
{ "job_id": "job_…", "status": "queued", "item_count": 120 }
```
`GET /api/enrich/:job_id` →
`200 { "job_id": "…", "status": "running|done|failed", "progress": 0.5,
       "results": { "costs_found": 31, "logos_found": 12, "still_missing": 77 },
       "updates": [ { "item_id": "…", "field": "cost", "old": null, "new": 23.65,
                      "source": "Website: SipMarket" } ] }`
Vendor lookups never guess: a price is recorded only when the exact
UPC/size matches on the vendor page; otherwise the item stays missing.

### `GET /api/items`
Query params: `q` (name/brand/UPC search), `category`, `vendor`,
`brand`, `flag`, `missing` (`cost|logo|upc|price`), `sort`
(`name|price|cost|quantity|updated_at`), `order` (`asc|desc`),
`page`, `page_size` (default 50, max 200).
→ `200 { "items": [ …canonical items… ], "total": 4594, "page": 1, "page_size": 50 }`

### `PATCH /api/items/:id`
JSON partial update of editable fields (`name`, `brand`, `category`,
`upc`, `price`, `cost`, `vendor`, `unit_size`, `sell_pack_qty`,
`quantity`, `hidden`). Price edits are direct user edits (not pricing
suggestions) and are recorded in price history.
→ `200 { …updated item… }`; `404` unknown id; `422` invalid value
(e.g. negative price).

### `GET /api/pricing/suggestions`
Query params mirror `GET /api/items` filters. Returns one row per item
that has (or could not get) a suggestion:
```jsonc
{ "items": [ {
    "item_id": "itm_…", "name": "…", "current_price": 9.99,
    "suggested_price": 14.00,          // null when blocked
    "unit_cost": 10.47, "cost_source": "Clover",
    "delta_pct": 0.401, "flags": ["REVIEW", "COST_GE_PRICE"],
    "blocked_reason": null             // or "NO_COST" | "NEED_PACK_CONFIG" | …
} ],
  "summary": { "suggestions": 2502, "blocked": 2092,
               "total_current": 59640.08,
               "total_if_all_applied": 52249.93,
               "total_if_unflagged_applied": 60130.73 } }
```
Rules (Phase 3, see `core/pricing.py`): originals are never modified by
this endpoint; a suggestion is a proposal. `REVIEW`/`PRICE_DROP` rows are
excluded from master apply.

### `POST /api/pricing/apply`
Preview-then-apply semantics — two modes:
```jsonc
// 1) Preview (default): "apply": false
{ "apply": false, "mode": "selected", "item_ids": ["itm_…"] }
//    or { "apply": false, "mode": "master_unflagged" }
// → 200 { "would_change": 423, "total_before": 59640.08,
//         "total_after": 60130.73,
//         "changes": [ { "item_id": "…", "from": 9.99, "to": 14.00 } ] }

// 2) Commit: same body with "apply": true and the preview token returned above
{ "apply": true, "preview_token": "pv_…", "mode": "master_unflagged" }
// → 200 { "applied": 423, "applied_at": "…" }
```
`409` if the preview token is stale (data changed since preview).
There is **no** apply path that skips preview.

### `POST /api/export/toast`
```jsonc
{ "item_ids": ["itm_…"] }        // or "filter": { … } ; omit both = all items
// → 200, Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
// File: the Toast Retail template with the populated template's exact 26 columns:
// Item Name, optional (variation), pos name, description, category group,
// Category, subcategory, Price ("$12.99"), Cost, Barcode, plu, brand,
// supplier, supplier item id, selling strategy, embedded amount type,
// unit of measure, prompt for quantity, inventory quantity, Min Qty,
// Max Qty, receiving units, receiving unit quantities, image url,
// region (Custom Attribute - Select), abv (Custom Attribute - Number).
// Price exported = current price, or applied Final Price after a pricing apply.
```

### `POST /api/push/cooler-door`
Regenerates the Cooler Door catalog exactly as the website consumes it
today (alcohol-only: Beer/RTD/Spirits/Wine, NA items excluded, brand
logos resolved) and publishes it for 777liquor.com.
```jsonc
// → 200
{ "pushed": 43, "by_category": { "Beer": 23, "RTD": 9, "Spirits": 9, "Wine": 2 },
  "missing_logos": ["Crown Royal"],
  "catalog": { "sourceFile": "777-inventory-app", "generatedAt": "…",
               "itemCount": 43, "items": [ { "id": "…", "name": "…", "brand": "…",
               "category": "Beer", "size": "6pk", "price": 12.99, "logo": "/images/brands/…" } ] } }
```

### Analytics — sales data adapter

All `/api/analytics/*` endpoints read **normalized sales records** from
the sales data adapter (ARCHITECTURE.md → "Sales data adapter"). Two
sources produce identical records, and no analytics response changes
shape or meaning based on which one supplied the data:

- `"clover_export"` — Clover report/CSV files imported via
  `POST /api/import` with `kind: "sales"`. **No API access needed; this
  is the default path.**
- `"clover_api"` — Clover API sync (OAuth). **Pending merchant/developer
  approval**; may never be enabled. The app must not depend on it.

Normalized sales record:
```jsonc
{ "sold_at": "2026-11-25T14:03:00-10:00", "clover_id": "DQ43608XZ45TP",
  "item_name": "Smirnoff Ice Original 6pk", "upc": "082000807407",
  "quantity": 2, "gross_amount": 7.98, "discount_amount": 0,
  "net_amount": 7.98, "source": "clover_export" }
```
Records join to items by `clover_id`, then UPC, then normalized name.
Responses include `"sales_source"`: `"clover_export"`, `"clover_api"`,
`"mixed"`, or `null` when no sales data has been loaded yet (endpoints
still return `200` with zeroed/empty values in that case).

### `GET /api/analytics/overview`
Sales rollup over normalized sales records (either adapter source). →
`200 { "period": "last_30d", "sales_source": "clover_export",
"net_sales": 0, "orders": 0, "top_categories": [], "top_items": [] }`
(shape stable; values live once sales data has been loaded by either
adapter path — no Clover API access required).

### `GET /api/analytics/items/:id`
Per-item sales velocity, margin at current price, and trend:
`200 { "item_id": "…", "units_sold_30d": 0, "revenue_30d": 0,
"margin_pct": null, "trend": "flat", "suggested_action": null }`.

### `GET /api/analytics/suggestions`
Price-change and assortment suggestions from sales + Honolulu market
trends: `200 { "price_suggestions": [ { "item_id": "…", "reason": "…",
"current_price": 0, "suggested_price": 0 } ],
"new_products": [ { "name": "…", "vendor": "…", "reason": "…",
"popularity_signal": "…" } ] }`.

### Label templates — CRUD `/api/label-templates`
```jsonc
// template object
{ "id": "lt_…", "name": "Shelf talker — price big",
  "avery": "5160",                    // built-in Avery spec key, or null for custom
  "page": { "width_in": 8.5, "height_in": 11 },
  "label": { "width_in": 2.625, "height_in": 1.0 },
  "fields": [ { "key": "name", "x_pct": 4, "y_pct": 8, "font_size": 11, "bold": true },
              { "key": "price", "x_pct": 4, "y_pct": 55, "font_size": 20, "bold": true },
              { "key": "upc_barcode", "x_pct": 55, "y_pct": 60, "font_size": 8 } ],
  "custom_css": "" }
// POST → 201 template; GET list → 200 { "items": [...] };
// GET /:id → 200; PATCH /:id → 200; DELETE /:id → 204.
```
Built-in Avery specs (in `core/labels.py`): `5160`/`8160`, `5161`,
`5163`, `5164`, `5167` — exact published dimensions, margins, pitch,
rows/cols. `GET /api/label-templates/builtins` lists them.

### `POST /api/labels/render`
```jsonc
{ "template_id": "lt_…",            // or "avery": "5160" + "fields": […]
  "item_ids": ["itm_…"],            // order = sheet order
  "start_offset": 0,                // skip N label cells (partially used sheet)
  "copies_per_item": 1 }
// → 200, Content-Type: text/html — a print-accurate sheet:
// @page Letter, labels positioned to the Avery spec within print tolerance.
// Field placeholders: {name} {price} {upc} {upc_barcode} {brand} {size} {category}.
```
