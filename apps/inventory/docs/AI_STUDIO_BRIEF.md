# Paste this whole brief into Google AI Studio as the project prompt.

---

Build the front-end for **777 Inventory**, a single-user inventory
management web app for a liquor store in Honolulu, Hawaii (777 LIQUOR
GROCERY & GIFT SHOP). This is a working store-operations tool used daily
by the store manager — not a marketing page, not a demo. Dense, fast,
keyboard-friendly, zero decoration that doesn't carry information.

## Tech + data rules

- React + TypeScript + Tailwind. Single-page app.
- The app talks to a backend ONLY through the API contracts pasted at the
  end of this brief (`API_CONTRACTS.md`). Build a typed API client module
  implementing every endpoint, but run it against **mock data in exactly
  the contract shapes** behind a `USE_MOCK = true` flag, so swapping to
  the real backend is a one-line change.
- Money is a number in dollars; `null` means "no value" and must render
  blank, never `$0.00` (except a real price of 0, which the data flags
  with `ZERO_PRICE`).
- The canonical item shape is defined in the contracts. Use it verbatim.

## Screens

1. **Login** — username/password form posting to `/login`; on 401 show a
   plain error. Everything else sits behind the session.
2. **Dashboard** — inventory health at a glance: total items, items
   missing cost / UPC / logo / price (clickable counts that deep-link to
   the filtered grid), pending pricing suggestions summary (count +
   dollar impact of master apply), recent imports, enrichment job
   status, quick actions (Import, Export to Toast, Push to Cooler Door).
3. **Import wizard** — drag-and-drop spreadsheet upload (any structure),
   then a normalization preview: parsed items table, issue list grouped
   by type (malformed UPCs, duplicates, missing prices) with counts, and
   a Commit button. Show "nothing is saved until you commit" plainly.
4. **Inventory grid** — the core screen. Full-text search (name, brand,
   UPC), filters (category, vendor, brand, flag, missing cost/UPC/logo),
   sortable columns, pagination, inline editing of name/brand/category/
   UPC/price/cost/vendor/size/pack/quantity, flag chips on rows
   (NO_COST, REVIEW, PRICE_DROP, CAT_CONFLICT, HI5_CONFIRM…), row
   selection with bulk actions (enrich, add to label print queue, export
   selection to Toast).
5. **Pricing review** — current price vs suggested price side by side,
   delta %, flags, cost source. Per-row apply toggle plus a "master
   preview" that applies only unflagged suggestions (REVIEW and
   PRICE_DROP rows are always held out). A sticky summary bar shows
   total before/after for the current preview. Applying requires the
   preview step (call preview first, then commit with the preview
   token). Original prices must be visually sacrosanct: suggested values
   styled as proposals, never as edits to the current price.
6. **Analytics** — Clover sales overview (period picker, top categories,
   top items), per-item drill-down (velocity, margin, trend), and a
   Suggestions panel: price-change suggestions with reasons, and new
   product suggestions from vendors with popularity/market-trend notes
   for Honolulu.
7. **Product suggestions** — can live inside Analytics: cards for
   suggested new products (name, vendor, why, popularity signal) with
   "add to inventory (draft)" action.
8. **Label Studio** — pick items from a searchable/filterable list (or
   the grid's print queue), choose a built-in Avery template (5160/8160,
   5161, 5163, 5164, 5167) or a saved custom template, design the label
   with a field palette ({name}, {price}, {upc}, {upc_barcode}, {brand},
   {size}, {category}) — drag fields, set font size/weight/alignment —
   set start offset for partially used sheets and copies per item, and
   see a **live, print-accurate preview** of the full Letter sheet.
   Print button renders via `/api/labels/render`.
9. **Settings / Integrations** — status cards for the Clover sales
   adapter (default: sales report/CSV exports dropped into Import;
   Clover API shown as "pending approval" and only offered if it is
   ever approved — the app must work fully without it), Gemini, vendor
   portals (SipMarket, JB Hub, Southern Proof), website push target;
   enrichment job history.

## Design language

- Clean, dense, utilitarian: think Linear/Stripe dashboard meets a POS
  back-office. Small type (13–14px base), tight tables, sticky headers.
- Neutral palette with one accent; flags get consistent semantic colors
  (amber = review/confirm, red = losing money/conflict, gray = missing
  data). Dark mode optional; light mode must be flawless.
- No hero sections, no illustrations, no marketing copy. Every pixel
  either shows data or does work.
- Tables must handle 4,594 items smoothly (virtualize or paginate).

## Now paste the contracts

[The contents of docs/API_CONTRACTS.md go here when Justin pastes this
brief — the file sits next to this one in the repo at
`docs/API_CONTRACTS.md`. Paste it in full below this line.]

---
