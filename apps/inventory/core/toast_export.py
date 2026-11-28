"""toast_export — canonical items -> Toast Retail import rows.

The export target is the populated Toast Retail template Justin already
uses (777_-_Retail_Template_-_POPULATED_2026-09-17.xlsx, "Template"
sheet). Column names and order below are copied from that file exactly —
do not rename or reorder; Toast's importer keys off them.

Mapping notes (from phase3_logic_spec.md section 9):
  * category group is uniformly "Retail".
  * The template's Category is the operative level (BEER, RTD (READY TO
    DRINK), LIQUOR/SPIRITS, WINE, DRINKS, MIXERS, ...). It is derived
    from the item's beverage class, not copied blindly from Clover —
    Clover's "Beer & Seltzers" spans BEER and RTD, and the populated
    template itself has blank/conflicting categories.
  * subcategory is empty in the template and stays empty.
  * Price/Cost are "$12.99" strings in the file (Toast's format), even
    though the API carries numbers.
  * Hawaii GET is a register-level tax in Toast settings — it is NOT
    part of item data and never appears here. HI-5 deposits are Toast
    fixed tax rates keyed to pack size, also settings, not item rows.
"""

from __future__ import annotations

import csv
import io
from typing import Optional

from . import pricing

# Exact header row of the populated template's "Template" sheet.
TOAST_COLUMNS = [
    "Item Name",
    "optional (variation)",
    "pos name",
    "description",
    "category group",
    "Category",
    "subcategory",
    "Price",
    "Cost",
    "Barcode",
    "plu",
    "brand",
    "supplier",
    "supplier item id",
    "selling strategy",
    "embedded amount type",
    "unit of measure",
    "prompt for quantity",
    "inventory quantity",
    "Min Qty",
    "Max Qty",
    "receiving units",
    "receiving unit quantities",
    "image url",
    "region (Custom Attribute - Select)",
    "abv (Custom Attribute - Number)",
]

# Beverage class (core.pricing) -> Toast Category.
_BEV_TO_TOAST = {
    "BEER_RTD": "BEER",
    "RTD_AMBIG": "RTD (READY TO DRINK)",
    "SPIRITS": "LIQUOR/SPIRITS",
    "SPIRITS_WINE": "LIQUOR/SPIRITS",
    "WINE": "WINE",
    "NONALC": "DRINKS",
    "NA_BEV": "DRINKS",
}

# Non-beverage Clover categories -> Toast Category (best-effort passthrough;
# anything unmapped falls back to the uppercased source category).
_CATEGORY_FALLBACK = {
    "Drinks & Mixers": "DRINKS",
    "Vapes & Tobacco": "VAPES",
    "Smoke Shop & Hemp": "SMOKE SHOP",
    "Snacks & Grocery": "GROCERY",
    "Fees & Misc": "FEES",
}


def toast_category(item: dict) -> str:
    bev_class, _hi5, _conflict = pricing.classify_beverage(
        item.get("name") or "", item.get("category"))
    if bev_class in _BEV_TO_TOAST:
        return _BEV_TO_TOAST[bev_class]
    cat = item.get("category") or ""
    if cat in _CATEGORY_FALLBACK:
        return _CATEGORY_FALLBACK[cat]
    return cat.upper() if cat else ""


def _money(value: Optional[float]) -> str:
    return f"${value:.2f}" if value is not None else ""


def item_to_toast_row(item: dict) -> dict:
    """One canonical item -> one Toast template row (dict by column)."""
    packs = item.get("packs_per_case")
    return {
        "Item Name": item.get("normalized_name") or item.get("name") or "",
        "optional (variation)": "",
        "pos name": "",
        "description": "",
        "category group": "Retail",
        "Category": toast_category(item),
        "subcategory": "",
        "Price": _money(item.get("price")),
        "Cost": _money(item.get("cost")),
        "Barcode": item.get("upc") or "",
        "plu": "",
        "brand": item.get("brand") or "",
        "supplier": item.get("vendor") or "",
        "supplier item id": "",
        "selling strategy": "",
        "embedded amount type": "",
        "unit of measure": "",
        "prompt for quantity": "",
        "inventory quantity": item.get("quantity") if item.get("quantity") is not None else 0,
        "Min Qty": 0,
        "Max Qty": 0,
        "receiving units": "Case" if packs else "",
        "receiving unit quantities": packs if packs else "",
        "image url": item.get("image_url") or item.get("logo_url") or "",
        "region (Custom Attribute - Select)": "",
        "abv (Custom Attribute - Number)": "",
    }


def items_to_toast_rows(items: list[dict]) -> list[dict]:
    return [item_to_toast_row(it) for it in items]


def to_csv(items: list[dict]) -> str:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=TOAST_COLUMNS)
    writer.writeheader()
    for row in items_to_toast_rows(items):
        writer.writerow(row)
    return buf.getvalue()


def to_xlsx_bytes(items: list[dict]) -> bytes:
    """Workbook bytes with a single "Template" sheet matching the
    populated template's structure (header row + data rows)."""
    import openpyxl

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Template"
    ws.append(TOAST_COLUMNS)
    for row in items_to_toast_rows(items):
        ws.append([row[col] for col in TOAST_COLUMNS])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
