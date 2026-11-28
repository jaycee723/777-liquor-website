#!/usr/bin/env python3
"""Smoke test for the 777 Inventory core engine.

Run from the repo root:  python3 core/tests/smoke_test.py
Prints PASS/FAIL per check and exits non-zero if anything fails.
No network, no writes outside temp files.
"""

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

FAILURES = []


def check(label, cond, detail=""):
    print(f"{'PASS' if cond else 'FAIL'}  {label}" + (f"  ({detail})" if detail else ""))
    if not cond:
        FAILURES.append(label)


def main() -> int:
    # 1. Imports -------------------------------------------------------------
    try:
        from core import ingest, labels, pricing, toast_export
        check("imports: core.ingest/pricing/toast_export/labels", True)
    except Exception as exc:  # noqa: BLE001
        check("imports", False, repr(exc))
        return 1

    # 2. Ingest the real Cooler Door spreadsheet (if present) ----------------
    sheet = (REPO_ROOT.parent / "777_liquor_website" / "777-Liquor-Website" / "website"
             / "public" / "inventory" / "cooler-door-inventory.xlsx")
    if sheet.exists():
        result = ingest.ingest_file(sheet)
        check("ingest: cooler-door spreadsheet parses",
              result["items_parsed"] > 0,
              f"rows={result['rows_read']} items={result['items_parsed']} "
              f"issues={result['issue_counts']}")
        first = result["items"][0]
        check("ingest: canonical fields present",
              all(k in first for k in ("clover_id", "name", "normalized_name", "brand",
                                       "category", "upc", "price", "cost", "vendor",
                                       "unit_size", "sell_pack_qty", "hi5_eligible",
                                       "logo_url", "image_url")))
    else:
        check("ingest: cooler-door spreadsheet parses", False, f"not found: {sheet}")

    def item(**kw):
        base = {
            "id": "itm_test", "clover_id": None, "name": "Test Item",
            "normalized_name": "Test Item", "brand": "Test", "category": None,
            "subcategory": None, "upc": None, "price": 10.00, "cost": None,
            "case_cost": None, "list_case_cost": None, "packs_per_case": None,
            "cost_source": None, "vendor": None, "unit_size": None,
            "sell_pack_qty": None, "hi5_eligible": None, "quantity": 0,
            "hidden": False, "logo_url": None, "image_url": None,
            "flags": [], "updated_at": None,
        }
        base.update(kw)
        return base

    # 3a. Pricing — standard vendor path (spec worked example #2) ------------
    pacifico = item(name="Pacifico Clara 18 Packs", category="Beer & Seltzers",
                    price=31.79, case_cost=23.65, packs_per_case=1,
                    sell_pack_qty=18, cost_source="Island Distributing",
                    vendor="Island Distributing")
    r = pricing.compute_suggestion(pacifico)
    check("pricing: standard vendor formula -> $32.00",
          r["suggested_price"] == 32.00, f"got {r['suggested_price']}")

    # 3b. Pricing — Clover cost, spirits (no HI-5) (spec worked example #3) --
    baileys = item(name="Bailey's Original Irish Cream 750ml",
                   category="Liquor & Wine", price=29.99, cost=10.00,
                   cost_source="Clover")
    r = pricing.compute_suggestion(baileys)
    check("pricing: spirits Clover cost -> $13.00, PRICE_DROP flagged",
          r["suggested_price"] == 13.00 and "PRICE_DROP" in r["flags"],
          f"got {r['suggested_price']} flags={r['flags']}")

    # 3c. Pricing — Johnson market anchor passes the floor --------------------
    karkov = item(name="Karkov Vodka 80pf 375ml", category="Liquor & Wine",
                  price=6.99, case_cost=92.16, list_case_cost=138.00,
                  packs_per_case=24, vendor="Johnson Brothers",
                  cost_source="Johnson Brothers")
    r = pricing.compute_suggestion(karkov)
    check("pricing: Johnson anchor -> $8.00 with JOHNSON_MARKET_ANCHOR",
          r["suggested_price"] == 8.00 and "JOHNSON_MARKET_ANCHOR" in r["flags"],
          f"got {r['suggested_price']} flags={r['flags']}")

    # 3d. Pricing — Johnson floor fail blocks the suggestion ------------------
    floor_fail = item(name="Johnson Floor Fail 750ml", category="Liquor & Wine",
                      price=20.00, case_cost=126.00, list_case_cost=120.00,
                      packs_per_case=12, vendor="Johnson Brothers",
                      cost_source="Johnson Brothers")
    r = pricing.compute_suggestion(floor_fail)
    check("pricing: Johnson floor fail -> no suggestion",
          r["suggested_price"] is None and r["blocked_reason"] == "JOHNSON_FLOOR_FAIL",
          f"got {r['suggested_price']} blocked={r['blocked_reason']}")

    # 3e. Pricing — no cost anywhere ------------------------------------------
    r = pricing.compute_suggestion(item(name="Mystery Item", price=5.00))
    check("pricing: NO_COST blocks suggestion",
          r["suggested_price"] is None and r["blocked_reason"] == "NO_COST")

    # 3f. Pricing — vendor case cost without pack config -----------------------
    r = pricing.compute_suggestion(item(
        name="Unknown Pack Beer", category="Beer & Seltzers", price=12.00,
        case_cost=40.00, packs_per_case=None, vendor="Odom Corp",
        cost_source="Odom Corp"))
    check("pricing: NEED_PACK_CONFIG blocks suggestion",
          r["suggested_price"] is None and r["blocked_reason"] == "NEED_PACK_CONFIG")

    # 3g. Pricing — ambiguous RTD: HI5_CONFIRM, priced without deposit ---------
    cutwater = item(name="Cutwater Margarita 4pk", category="Beer & Seltzers",
                    price=15.99, cost=10.00, sell_pack_qty=4, cost_source="Clover")
    r = pricing.compute_suggestion(cutwater)
    # Without deposit: CEILING(10.00*1.30) = 13.00 (with deposit it'd be 14.00)
    check("pricing: RTD_AMBIG -> HI5_CONFIRM, no deposit in price",
          "HI5_CONFIRM" in r["flags"] and r["suggested_price"] == 13.00,
          f"got {r['suggested_price']} flags={r['flags']}")

    # 3h. Preview / apply semantics --------------------------------------------
    items = [pacifico, baileys]
    for i, it in enumerate(items):
        it["id"] = f"itm_{i}"
    sugg = pricing.compute_suggestions(items)
    preview = pricing.preview_apply(sugg, mode="master_unflagged")
    # Pacifico is unflagged (applies); Baileys is PRICE_DROP (held out).
    check("apply: master preview holds PRICE_DROP rows out",
          preview["would_change"] == 1
          and preview["changes"][0]["item_id"] == "itm_0",
          f"changes={preview['changes']}")
    applied = pricing.apply_prices(items, sugg, preview["preview_token"],
                                   mode="master_unflagged")
    check("apply: applied copy updated, original untouched",
          applied[0]["price"] == 32.00 and items[0]["price"] == 31.79
          and applied[0].get("previous_price") == 31.79
          and applied[1]["price"] == 29.99)
    try:
        pricing.apply_prices(items, sugg, "pv_stale", mode="master_unflagged")
        check("apply: stale preview token rejected", False)
    except ValueError:
        check("apply: stale preview token rejected", True)

    # 4. Toast export -----------------------------------------------------------
    row = toast_export.item_to_toast_row(pacifico)
    check("toast: row has the template's exact 26 columns",
          list(row.keys()) == toast_export.TOAST_COLUMNS
          and len(toast_export.TOAST_COLUMNS) == 26)
    check("toast: price/cost formatted as template strings, group=Retail",
          row["Price"] == "$31.79" and row["category group"] == "Retail"
          and row["Category"] == "BEER",
          f"Price={row['Price']} Category={row['Category']}")
    xlsx = toast_export.to_xlsx_bytes([pacifico])
    check("toast: xlsx bytes produced", len(xlsx) > 0 and xlsx[:2] == b"PK")

    # 5. Labels ------------------------------------------------------------------
    spec = labels.get_spec("5160")
    check("labels: 5160 spec = 30/sheet, 1x2.625in",
          spec.per_sheet == 30 and spec.label_width_in == 2.625
          and spec.label_height_in == 1.0)
    boxes = labels.compute_layout("5160", 30)
    last = boxes[-1]
    check("labels: 5160 last cell at row 9, col 2, x=5.6875in, y=9.5in",
          last["row"] == 9 and last["col"] == 2
          and last["x_in"] == 5.6875 and last["y_in"] == 9.5,
          f"got row={last['row']} col={last['col']} x={last['x_in']} y={last['y_in']}")
    check("labels: mm conversion (2.625in = 66.675mm)",
          boxes[0]["width_mm"] == round(2.625 * 25.4, 2), f"got {boxes[0]['width_mm']}")
    page2 = labels.compute_layout("5160", 31)[-1]
    check("labels: 31st label spills to page 2", page2["page"] == 1)
    html_out = labels.render_html([pacifico], template="5160")
    check("labels: HTML sheet renders item + @page Letter",
          "Pacifico Clara" in html_out and "size: Letter" in html_out
          and "$31.79" in html_out)
    for key in ("5161", "5163", "5164", "5167"):
        s = labels.get_spec(key)
        check(f"labels: {key} spec loads ({s.per_sheet}/sheet)", s.per_sheet > 0)

    print()
    if FAILURES:
        print(f"SMOKE TEST: {len(FAILURES)} FAILURE(S): {FAILURES}")
        return 1
    print("SMOKE TEST: ALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
