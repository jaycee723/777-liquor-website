"""ingest — flexible-header spreadsheet reader -> canonical items.

Ported from the proven pipeline:
  * header mapping, text/price normalization, category normalization,
    brand derivation  <- website repo scripts/sync_cooler_door.py
    (itself a port of the site's src/lib/inventory.ts)
  * Unit_Size / Sell_Pack_Qty parsing and Normalized_Name construction
    <- inventory-pipeline/phase1_cleanup.py

Any spreadsheet structure works: headers are matched by candidate names
(exact first, then substring), so Clover exports, vendor price books,
Toast templates and the Cooler Door sheet all ingest through one path.

Output items use the canonical schema from docs/API_CONTRACTS.md.
Ingest never drops a row silently: unparseable rows come back in the
issues list with a code, and duplicates are reported, not merged.
"""

from __future__ import annotations

import csv
import re
import unicodedata
from pathlib import Path
from typing import Any, Iterable, Optional

# ---------------------------------------------------------------------------
# Field candidate headers (lowercase). Exact match wins, then substring.
# ---------------------------------------------------------------------------
NAME_FIELDS = ["product name", "item name", "name", "product", "item", "description", "title"]
BRAND_FIELDS = ["brand", "vendor brand", "manufacturer", "maker"]
CATEGORY_FIELDS = ["category", "categories", "department", "type", "section", "group"]
SIZE_FIELDS = ["size", "pack", "unit", "volume", "package"]
PRICE_FIELDS = ["price", "retail price", "retail", "unit price", "amount"]
COST_FIELDS = ["cost", "unit cost", "case cost", "net", "wholesale"]
UPC_FIELDS = ["product code", "upc", "barcode", "sku", "product code / upc"]
ID_FIELDS = ["clover id", "clover_id", "item id", "id"]
VENDOR_FIELDS = ["printer labels", "vendor tag", "supplier", "vendor"]
QTY_FIELDS = ["quantity", "quantity_clean", "qty", "on hand", "inventory quantity"]
HIDDEN_FIELDS = ["hidden?", "hidden", "inactive"]

PRESERVE_UPPERCASE = {
    "IPA", "DIPA", "IIPA", "APA", "RTD", "ABV", "ULTRA", "PBR", "VMC",
    "XXL", "MD", "VS", "VSOP", "XO", "USA", "HI", "OG", "BBL",
}
BRAND_CASING_OVERRIDES = {
    "michelob ultra": "Michelob ULTRA",
    "kirin ichiban": "Kirin Ichiban",
    "pabst blue ribbon": "Pabst Blue Ribbon",
    "titos": "Tito's",
    "tito's": "Tito's",
    "titos handmade vodka": "Tito's Handmade Vodka",
    "tito's handmade vodka": "Tito's Handmade Vodka",
    "patron": "Patrón",
    "patrón": "Patrón",
    "suntory -196": "Suntory -196",
    "196 suntory": "Suntory -196",
    "mickeys": "Mickey's",
    "mickey's": "Mickey's",
    "makers mark": "Maker's Mark",
    "maker's mark": "Maker's Mark",
    "jack daniels": "Jack Daniel's",
    "jack daniel's": "Jack Daniel's",
    "aloha beer co.": "Aloha Beer Co.",
    "aloha beer co": "Aloha Beer Co.",
    "dos equis": "Dos Equis",
    "vmc": "VMC",
    "xxl": "XXL",
    "md 20/20": "MD 20/20",
}


# ---------------------------------------------------------------------------
# Normalization (ported verbatim in behavior from sync_cooler_door.py)
# ---------------------------------------------------------------------------

def _capitalize_word(word: str) -> str:
    if not word:
        return word
    if re.fullmatch(r"\d+(?:\.\d+)?(?:oz|ml|pk)", word) or word == "L":
        return word
    bare = re.sub(r"[^a-zA-Z0-9]", "", word).upper()
    if bare in PRESERVE_UPPERCASE:
        return word.upper()
    out, found = [], False
    for ch in word:
        if re.match(r"[a-zA-ZÀ-ÿ]", ch):
            out.append(ch.upper() if not found else ch.lower())
            found = True
        else:
            out.append(ch)
    return "".join(out)


def normalize_text(raw: str) -> str:
    cleaned = re.sub(r"\s+", " ", str(raw)).strip()
    if not cleaned:
        return ""
    override = BRAND_CASING_OVERRIDES.get(cleaned.lower())
    if override:
        return override
    normalized = cleaned
    normalized = re.sub(r"(\d+(?:\.\d+)?)\s*(?:fl\.?\s*)?oz\.?\b", r"\1oz", normalized, flags=re.I)
    normalized = re.sub(r"(\d+(?:\.\d+)?)\s*(?:liters?|litres?|ltrs?|l)\b", r"\1 L", normalized, flags=re.I)
    normalized = re.sub(r"(\d+(?:\.\d+)?)\s*ml\.?\b", r"\1ml", normalized, flags=re.I)
    normalized = re.sub(r"(\d+)\s*(?:-?\s*packs?|-?\s*pk\.?)\b", r"\1pk", normalized, flags=re.I)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    words = []
    for word in normalized.split(" "):
        if not word:
            continue
        if re.fullmatch(r"\d+(?:\.\d+)?(?:oz|ml|pk)", word) or word == "L" or re.fullmatch(r"-?\d+(?:\.\d+)?", word):
            words.append(word)
            continue
        bare = re.sub(r"[^a-zA-Z0-9]", "", word).upper()
        if bare in PRESERVE_UPPERCASE:
            words.append(re.sub(r"[a-zA-Z]+", lambda m: m.group(0).upper(), word))
            continue
        if "-" in word and not word.startswith("-"):
            words.append("-".join(_capitalize_word(p) for p in word.split("-")))
            continue
        if "/" in word:
            words.append("/".join(_capitalize_word(p) for p in word.split("/")))
            continue
        words.append(_capitalize_word(word))
    return " ".join(words)


def normalize_category(raw: str) -> str:
    """Cooler-Door taxonomy normalization (Beer/RTD/Spirits/Wine/Beverages).

    Used for website-facing categorization; the canonical item keeps the
    source category as-is and the pricing engine classifies separately.
    """
    cleaned = str(raw).strip().lower()
    if not cleaned:
        return "Beverages"
    if cleaned == "rtd" or "ready" in cleaned or "seltzer" in cleaned or "cocktail" in cleaned:
        return "RTD"
    if any(k in cleaned for k in ("beer", "lager", "ale", "ipa", "cider")):
        return "Beer"
    if any(k in cleaned for k in ("spirit", "liquor", "vodka", "tequila", "whisk", "rum", "gin", "bourbon")):
        return "Spirits"
    if any(k in cleaned for k in ("wine", "champagne", "prosecco", "sake")):
        return "Wine"
    if any(k in cleaned for k in ("beverage", "mixer", "soda", "water", "non-alc")):
        return "Beverages"
    return normalize_text(raw)


def parse_price(raw: Any) -> Optional[float]:
    """Parse a price/cost cell; None if blank, unparseable, or <= 0."""
    if isinstance(raw, (int, float)):
        value = float(raw)
        return round(value, 2) if value > 0 else None
    if isinstance(raw, str):
        cleaned = re.sub(r"[$,\s]", "", raw)
        try:
            value = float(cleaned)
        except ValueError:
            return None
        return round(value, 2) if value > 0 else None
    return None


def pick_field(row: dict, candidates: list[str]) -> Any:
    items = [(str(k).strip().lower(), v) for k, v in row.items()]
    for cand in candidates:
        for key, value in items:
            if key == cand and value is not None and str(value).strip() != "":
                return value
    for cand in candidates:
        for key, value in items:
            if cand in key and value is not None and str(value).strip() != "":
                return value
    return None


# ---------------------------------------------------------------------------
# Size / pack parsing (ported from phase1_cleanup.py)
# ---------------------------------------------------------------------------

SIZE_RE = re.compile(r"(\d+(?:\.\d+)?)\s?(oz|ml|gal|qt|pt|liter|liters|litre|litres|l)\b", re.I)
PACK_RE = re.compile(r"(\d+)\s?[- ]?(pk|packs?|ct|count)\b", re.I)


def parse_size(text: Any) -> Optional[str]:
    if not text:
        return None
    m = SIZE_RE.search(str(text))
    if not m:
        return None
    num, unit = m.group(1), m.group(2).lower()
    if unit == "oz":
        return f"{num}oz"
    if unit == "ml":
        return f"{num}ml"
    if unit in ("l", "liter", "liters", "litre", "litres"):
        return f"{num}L"
    return f"{num}{unit}"


def parse_pack(text: Any) -> Optional[int]:
    if not text:
        return None
    m = PACK_RE.search(str(text))
    if not m:
        return None
    return int(m.group(1))


def build_normalized_name(name: str, size: Optional[str], pack: Optional[int]) -> str:
    """[Name minus size/pack tokens] + canonical size + Npk (Phase 1 rule)."""
    s = SIZE_RE.sub(" ", str(name))
    s = PACK_RE.sub(" ", s)
    s = re.sub(r"\s+", " ", s).strip(" -/,")
    parts = [s] if s else []
    if size:
        parts.append(size)
    if pack:
        parts.append(f"{int(pack)}pk")
    return " ".join(parts)


# ---------------------------------------------------------------------------
# UPC validation (Phase 1 rules: digits only; 8/12/13 length; no URLs)
# ---------------------------------------------------------------------------

def clean_upc(raw: Any) -> tuple[Optional[str], Optional[str]]:
    """Return (upc, issue_code). Issue is None when the UPC is clean."""
    if raw is None or str(raw).strip() == "":
        return None, None
    s = str(raw).strip()
    if "://" in s or s.lower().startswith("http"):
        return None, "QR_URL_IN_UPC"
    digits = re.sub(r"\D", "", s)
    if digits != s.replace(" ", "").replace("-", ""):
        return (digits or None), "MALFORMED_UPC"
    if len(digits) not in (8, 12, 13):
        return (digits or None), "MALFORMED_UPC"
    return digits, None


# ---------------------------------------------------------------------------
# Brand helpers (logo resolution lives with the website assets; ingest only
# derives the brand name and slug)
# ---------------------------------------------------------------------------

def brand_slug(name: str) -> str:
    slug = unicodedata.normalize("NFD", name.lower())
    slug = "".join(ch for ch in slug if not unicodedata.combining(ch))
    slug = slug.replace("’", "").replace("'", "")
    slug = slug.replace("&", " and ")
    slug = re.sub(r"[^a-z0-9]+", " ", slug).strip()
    return re.sub(r"\s+", "-", slug)


def derive_brand(name: str, known_brands: Iterable[str] = ()) -> str:
    lowered = name.lower()
    for brand in sorted(known_brands, key=len, reverse=True):
        if lowered.startswith(brand.lower() + " ") or lowered == brand.lower():
            return normalize_text(brand)
    return " ".join(name.split(" ")[:2])


# ---------------------------------------------------------------------------
# Spreadsheet reading (xlsx via openpyxl, or csv) — ported from
# sync_cooler_door.py: first worksheet that yields data rows wins.
# ---------------------------------------------------------------------------

def read_rows(path: str | Path) -> list[dict]:
    path = Path(path)
    if path.suffix.lower() == ".csv":
        with path.open(newline="", encoding="utf-8-sig") as fh:
            return [dict(row) for row in csv.DictReader(fh)]
    try:
        import openpyxl
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("openpyxl is required to read .xlsx files") from exc
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    for ws in wb.worksheets:
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            continue
        headers = [str(h).strip() if h is not None else "" for h in rows[0]]
        out = []
        for raw in rows[1:]:
            if raw is None or all(v is None or str(v).strip() == "" for v in raw):
                continue
            out.append({headers[i]: raw[i] for i in range(min(len(headers), len(raw)))})
        if out:
            return out
    return []


# ---------------------------------------------------------------------------
# Row -> canonical item
# ---------------------------------------------------------------------------

def row_to_item(row: dict, known_brands: Iterable[str] = ()) -> tuple[Optional[dict], list[str]]:
    """Convert one raw spreadsheet row to a canonical item dict.

    Returns (item, issue_codes). item is None only when the row has no
    usable name — the caller records it as an issue, never drops it
    silently.
    """
    issues: list[str] = []
    raw_name = str(pick_field(row, NAME_FIELDS) or "").strip()
    if not raw_name:
        return None, ["NO_NAME"]
    price = parse_price(pick_field(row, PRICE_FIELDS))
    if price is None:
        issues.append("NO_PRICE")

    raw_brand = str(pick_field(row, BRAND_FIELDS) or "").strip()
    raw_category = str(pick_field(row, CATEGORY_FIELDS) or "").strip()
    raw_size = str(pick_field(row, SIZE_FIELDS) or "").strip()
    raw_desc = str(row.get("Description") or row.get("description") or "").strip()

    name = normalize_text(raw_name)
    size = parse_size(raw_size) or parse_size(name) or parse_size(raw_desc)
    pack = parse_pack(raw_size) or parse_pack(name) or parse_pack(raw_desc)
    brand = normalize_text(raw_brand) if raw_brand else derive_brand(name, known_brands)
    upc, upc_issue = clean_upc(pick_field(row, UPC_FIELDS))
    if upc_issue:
        issues.append(upc_issue)

    cost = parse_price(pick_field(row, COST_FIELDS))
    qty_raw = pick_field(row, QTY_FIELDS)
    try:
        quantity = int(float(qty_raw)) if qty_raw is not None and str(qty_raw).strip() != "" else None
    except (TypeError, ValueError):
        quantity = None
    if quantity is not None and quantity < 0:
        quantity = 0  # Phase 1 rule: negatives zeroed in the clean quantity

    hidden_raw = pick_field(row, HIDDEN_FIELDS)
    hidden = str(hidden_raw).strip().lower() in ("yes", "true", "1") if hidden_raw is not None else False

    clover_id = pick_field(row, ID_FIELDS)
    item = {
        "id": None,
        "clover_id": str(clover_id).strip() if clover_id else None,
        "name": name,
        "normalized_name": build_normalized_name(name, size, pack),
        "brand": brand,
        "category": raw_category or None,
        "subcategory": None,
        "upc": upc,
        "price": price,
        "cost": cost,
        "case_cost": None,
        "list_case_cost": None,
        "packs_per_case": None,
        "cost_source": "Clover" if cost is not None else None,
        "vendor": (str(pick_field(row, VENDOR_FIELDS)).strip() or None)
                  if pick_field(row, VENDOR_FIELDS) else None,
        "unit_size": size,
        "sell_pack_qty": pack,
        "hi5_eligible": None,  # filled by pricing.classify_beverage
        "quantity": quantity,
        "hidden": hidden,
        "logo_url": None,
        "image_url": None,
        "flags": issues,
        "updated_at": None,
    }
    return item, issues


def ingest_file(path: str | Path, known_brands: Iterable[str] = ()) -> dict:
    """Full ingest: read a spreadsheet and return the import preview
    described in docs/API_CONTRACTS.md (POST /api/import)."""
    rows = read_rows(path)
    items: list[dict] = []
    issues: list[dict] = []
    issue_counts: dict[str, int] = {}
    seen_upcs: dict[str, int] = {}
    for idx, row in enumerate(rows, start=2):  # row 1 = header
        item, codes = row_to_item(row, known_brands)
        if item is None:
            codes = codes or ["NO_NAME_OR_PRICE"]
            for code in codes:
                issues.append({"row": idx, "code": code, "detail": "row has no usable name"})
                issue_counts[code] = issue_counts.get(code, 0) + 1
            continue
        if item["upc"]:
            if item["upc"] in seen_upcs:
                issues.append({"row": idx, "code": "DUPLICATE_UPC",
                               "detail": f"UPC {item['upc']} also on row {seen_upcs[item['upc']]}"})
                issue_counts["DUPLICATE_UPC"] = issue_counts.get("DUPLICATE_UPC", 0) + 1
            else:
                seen_upcs[item["upc"]] = idx
        for code in codes:
            issue_counts[code] = issue_counts.get(code, 0) + 1
            issues.append({"row": idx, "code": code, "detail": ""})
        items.append(item)
    return {
        "source_file": Path(path).name,
        "rows_read": len(rows),
        "items_parsed": len(items),
        "items": items,
        "issues": issues,
        "issue_counts": issue_counts,
    }
