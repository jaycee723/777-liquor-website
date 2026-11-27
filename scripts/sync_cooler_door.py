#!/usr/bin/env python3
"""Cooler Door inventory connector.

Translates the inventory spreadsheet filed in this repository (a Clover
inventory export, .xlsx or .csv) into the JSON catalog the Cooler Door page
renders:

  * keeps only alcoholic beverages and liquor (Beer, RTD, Spirits, Wine),
  * keeps each item's name, brand, size, and price,
  * resolves a brand logo for every item from the local brand logo index
    (public/images/brands/brands.json + the overrides in
    src/lib/brand-logos.ts), optionally fetching logos for new brands
    online through the existing fetch_logos pipeline,
  * writes website/src/data/cooler-door-items.json.

The output is regenerated from scratch on every run, so the page mirrors
the spreadsheet exactly: add or remove rows in the sheet, push it, and the
GitHub Action (.github/workflows/sync-cooler-door.yml) re-runs this script
and commits the result — items removed from the sheet disappear from the
page, new items appear.

Usage:
  python scripts/sync_cooler_door.py [--input PATH] [--output PATH]
                                     [--fetch-missing] [--report-dir DIR]
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import subprocess
import sys
import unicodedata
from datetime import date
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
WEBSITE = REPO_ROOT / "777-Liquor-Website" / "website"
DEFAULT_INPUT = WEBSITE / "public" / "inventory" / "cooler-door-inventory.xlsx"
DEFAULT_OUTPUT = WEBSITE / "src" / "data" / "cooler-door-items.json"
BRANDS_JSON = WEBSITE / "public" / "images" / "brands" / "brands.json"
BRANDS_DIR = WEBSITE / "public" / "images" / "brands"
BRAND_LOGOS_TS = WEBSITE / "src" / "lib" / "brand-logos.ts"
BRAND_LIST_CSV = REPO_ROOT / "scripts" / "brand_list.csv"
DEFAULT_REPORT_DIR = REPO_ROOT / "reports" / "cooler-door"

ALCOHOL_CATEGORIES = ["Beer", "RTD", "Spirits", "Wine"]
NA_NAME_MARKERS = (
    "non-alcoholic",
    "non alcoholic",
    "alcohol free",
    "alcohol-free",
    "0.0%",
    "zero alcohol",
)
NA_BRANDS = {"athletic brewing"}

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

NAME_FIELDS = ["product name", "item name", "name", "product", "item", "title"]
BRAND_FIELDS = ["brand", "vendor", "manufacturer", "maker"]
CATEGORY_FIELDS = ["category", "department", "type", "section", "group"]
SIZE_FIELDS = ["size", "pack", "unit", "volume", "package"]
PRICE_FIELDS = ["price", "retail price", "retail", "unit price", "amount", "cost"]
DESCRIPTION_FIELDS = ["tasting notes", "product description", "notes", "details", "description"]
ABV_FIELDS = ["abv", "alcohol %", "alc %", "alcohol", "proof"]
ORIGIN_FIELDS = ["origin", "country", "region"]


# --------------------------------------------------------------------------
# Normalization (Python port of src/lib/inventory.ts)
# --------------------------------------------------------------------------

def _capitalize_word(word: str) -> str:
    if not word:
        return word
    if re.fullmatch(r"\d+(?:\.\d+)?(?:oz|ml|pk)", word) or word == "L":
        return word
    bare = re.sub(r"[^a-zA-Z0-9]", "", word).upper()
    if bare in PRESERVE_UPPERCASE:
        return word.upper()
    out = []
    found = False
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


def parse_price(raw) -> float | None:
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


def pick_field(row: dict, candidates: list[str]):
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


# --------------------------------------------------------------------------
# Brand slugs and logo resolution (mirrors src/lib/brand-logos.ts)
# --------------------------------------------------------------------------

def brand_slug(name: str, aliases: dict[str, str]) -> str:
    slug = unicodedata.normalize("NFD", name.lower())
    slug = "".join(ch for ch in slug if not unicodedata.combining(ch))
    slug = slug.replace("’", "").replace("'", "")
    slug = slug.replace("&", " and ")
    slug = re.sub(r"[^a-z0-9]+", " ", slug).strip()
    slug = re.sub(r"\s+", "-", slug)
    return aliases.get(slug, slug)


def _parse_ts_record(text: str, record_name: str) -> dict[str, str]:
    match = re.search(record_name + r"[^=]*=\s*\{(.*?)\n\};", text, flags=re.S)
    if not match:
        return {}
    pairs = re.findall(r'"([^"]+)":\s*(?:`[^`]*?/([^/`]+)`|"([^"]+)")', match.group(1))
    out = {}
    for key, file_from_template, plain in pairs:
        out[key] = file_from_template or plain
    return out


def load_logo_resolver():
    ts_text = BRAND_LOGOS_TS.read_text(encoding="utf-8")
    aliases = _parse_ts_record(ts_text, "BRAND_SLUG_ALIASES")
    overrides_raw = _parse_ts_record(ts_text, "LOCAL_LOGO_OVERRIDES")
    overrides = {}
    for slug, value in overrides_raw.items():
        # Values are either bare filenames (from `.../file` templates) or paths.
        overrides[slug] = value if "/" in value else value
    index = json.loads(BRANDS_JSON.read_text(encoding="utf-8"))
    by_slug: dict[str, str] = {}
    by_brand: dict[str, str] = {}
    for entry in index.get("brands", []):
        if entry.get("logo"):
            by_slug[entry["slug"]] = entry["logo"]
            by_brand[entry["brand"].lower()] = entry["logo"]
    return aliases, overrides, by_slug, by_brand


def resolve_logo(brand: str, aliases, overrides, by_slug, by_brand) -> str | None:
    slug = brand_slug(brand, aliases)
    raw_slug = brand_slug(brand, {})
    candidates = []
    if slug in overrides:
        candidates.append(overrides[slug])
    if raw_slug in overrides:
        candidates.append(overrides[raw_slug])
    if slug in by_slug:
        candidates.append(by_slug[slug])
    if raw_slug in by_slug:
        candidates.append(by_slug[raw_slug])
    if brand.lower() in by_brand:
        candidates.append(by_brand[brand.lower()])
    # Prefix matches, mirroring getBrandLogoSources.
    for entry_slug, logo in by_slug.items():
        if raw_slug.startswith(entry_slug + "-") or slug.startswith(entry_slug + "-") or entry_slug.startswith(slug + "-"):
            candidates.append(logo)
    # Dash-insensitive match (e.g. brand "La Marca" vs index slug "lamarca").
    squashed = slug.replace("-", "")
    for entry_slug, logo in by_slug.items():
        if entry_slug.replace("-", "") == squashed:
            candidates.append(logo)
    for cand in candidates:
        filename = cand.split("/")[-1]
        if (BRANDS_DIR / filename).exists():
            return f"/images/brands/{filename}"
    return None


# --------------------------------------------------------------------------
# Spreadsheet reading (xlsx via openpyxl, or csv — e.g. a Clover export)
# --------------------------------------------------------------------------

def read_rows(path: Path) -> list[dict]:
    if path.suffix.lower() == ".csv":
        with path.open(newline="", encoding="utf-8-sig") as fh:
            return [dict(row) for row in csv.DictReader(fh)]
    try:
        import openpyxl
    except ImportError:
        sys.exit("openpyxl is required to read .xlsx files (pip install openpyxl).")
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


def load_known_brands() -> list[str]:
    names: set[str] = set()
    if BRAND_LIST_CSV.exists():
        with BRAND_LIST_CSV.open(newline="", encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                if row.get("brand"):
                    names.add(row["brand"].strip())
                for alias in (row.get("aliases") or "").split(";"):
                    if alias.strip():
                        names.add(alias.strip())
    if BRANDS_JSON.exists():
        index = json.loads(BRANDS_JSON.read_text(encoding="utf-8"))
        for entry in index.get("brands", []):
            if entry.get("brand"):
                names.add(entry["brand"])
    return sorted(names, key=len, reverse=True)


def derive_brand(name: str, known_brands: list[str]) -> str:
    lowered = name.lower()
    for brand in known_brands:
        if lowered.startswith(brand.lower() + " ") or lowered == brand.lower():
            return normalize_text(brand)
    return " ".join(name.split(" ")[:2])


# --------------------------------------------------------------------------
# Logo fetching for new brands (reuses the existing fetch_logos pipeline)
# --------------------------------------------------------------------------

def fetch_missing_logos(missing: dict[str, str]) -> None:
    """Append missing brands to scripts/brand_list.csv and run run_fetch.py."""
    existing = set()
    if BRAND_LIST_CSV.exists():
        with BRAND_LIST_CSV.open(newline="", encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                existing.add((row.get("brand") or "").strip().lower())
    appended = []
    with BRAND_LIST_CSV.open("a", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        for brand, category in sorted(missing.items()):
            if brand.lower() in existing:
                continue
            slug = re.sub(r"[^a-z0-9]+", "-", brand.lower()).strip("-")
            writer.writerow([category, brand, "", f"{slug}.png", "0"])
            appended.append(brand)
    if appended:
        print(f"Added to brand_list.csv for logo fetch: {', '.join(appended)}")
    print("Running logo fetch pipeline (scripts/run_fetch.py)…")
    result = subprocess.run(
        [sys.executable, str(REPO_ROOT / "scripts" / "run_fetch.py"),
         str(BRAND_LIST_CSV), "--category", "all", "--limit", "0"],
        cwd=REPO_ROOT, capture_output=True, text=True, timeout=3300,
    )
    tail = "\n".join((result.stdout or "").splitlines()[-15:])
    print(tail)
    if result.returncode != 0:
        print(result.stderr[-2000:], file=sys.stderr)
        print("WARNING: logo fetch pipeline exited non-zero; continuing.", file=sys.stderr)


# --------------------------------------------------------------------------
# Main translation
# --------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--report-dir", type=Path, default=DEFAULT_REPORT_DIR)
    parser.add_argument("--fetch-missing", action="store_true",
                        help="Search online for logos for brands that have none yet.")
    args = parser.parse_args()

    input_path = args.input if args.input.is_absolute() else REPO_ROOT / args.input
    if not input_path.exists():
        sys.exit(f"Inventory spreadsheet not found: {input_path}")

    rows = read_rows(input_path)
    aliases, overrides, by_slug, by_brand = load_logo_resolver()
    known_brands = load_known_brands()

    existing_meta: dict[str, dict] = {}
    if args.output.exists():
        try:
            prev_catalog = json.loads(args.output.read_text(encoding="utf-8"))
            for prev_item in prev_catalog.get("items", []):
                if isinstance(prev_item, dict) and prev_item.get("id"):
                    existing_meta[prev_item["id"]] = prev_item
        except Exception:
            pass

    items = []
    dropped = {"no-name-or-price": 0, "non-alcohol": 0, "duplicate": 0}
    seen_ids = set()
    for row in rows:
        raw_name = str(pick_field(row, NAME_FIELDS) or pick_field(row, ["description"]) or "").strip()
        price = parse_price(pick_field(row, PRICE_FIELDS))
        if not raw_name or price is None:
            dropped["no-name-or-price"] += 1
            continue
        raw_brand = str(pick_field(row, BRAND_FIELDS) or "").strip()
        raw_category = str(pick_field(row, CATEGORY_FIELDS) or "").strip()
        raw_size = str(pick_field(row, SIZE_FIELDS) or "").strip()
        raw_description = str(pick_field(row, DESCRIPTION_FIELDS) or "").strip()
        raw_abv = str(pick_field(row, ABV_FIELDS) or "").strip()
        raw_origin = str(pick_field(row, ORIGIN_FIELDS) or "").strip()

        size = normalize_text(raw_size) if raw_size else ""
        name = normalize_text(raw_name)
        if size and size.lower() not in name.lower():
            name = f"{name} {size}"
        brand = normalize_text(raw_brand) if raw_brand else derive_brand(name, known_brands)
        category = normalize_category(raw_category)

        haystack = f"{name} {brand}".lower()
        is_na = any(marker in haystack for marker in NA_NAME_MARKERS) or brand.lower() in NA_BRANDS
        if is_na or category not in ALCOHOL_CATEGORIES:
            # A Clover export holds the whole store; keep an uncategorized or
            # generically categorized row only when its brand is a known
            # alcohol brand from the logo index / brand list.
            known = brand.lower() in {b.lower() for b in known_brands}
            if is_na or not known or category == "Beverages":
                dropped["non-alcohol"] += 1
                continue
            category = "Beer" if category not in ALCOHOL_CATEGORIES else category

        item_id = re.sub(r"[^a-z0-9]+", "-", f"{brand}-{name}".lower()).strip("-")
        if item_id in seen_ids:
            dropped["duplicate"] += 1
            continue
        seen_ids.add(item_id)

        prev = existing_meta.get(item_id, {})
        description = (
            raw_description
            if raw_description and raw_description.lower() != raw_name.lower()
            else prev.get("description")
        )
        abv = raw_abv or prev.get("abv")
        origin = normalize_text(raw_origin) if raw_origin else prev.get("origin")

        item_entry = {
            "id": item_id,
            "name": name,
            "brand": brand,
            "category": category,
            "size": size,
            "price": price,
            "logo": resolve_logo(brand, aliases, overrides, by_slug, by_brand),
        }
        if abv:
            item_entry["abv"] = abv
        if origin:
            item_entry["origin"] = origin
        if description:
            item_entry["description"] = description
        items.append(item_entry)

    missing: dict[str, str] = {}
    for item in items:
        if item["logo"] is None:
            missing[item["brand"]] = item["category"]

    if missing and args.fetch_missing:
        fetch_missing_logos(missing)
        aliases, overrides, by_slug, by_brand = load_logo_resolver()
        for item in items:
            if item["logo"] is None:
                item["logo"] = resolve_logo(item["brand"], aliases, overrides, by_slug, by_brand)
        missing = {i["brand"]: i["category"] for i in items if i["logo"] is None}

    order = {cat: idx for idx, cat in enumerate(ALCOHOL_CATEGORIES)}
    items.sort(key=lambda i: (order.get(i["category"], 99), i["name"].lower()))

    catalog = {
        "sourceFile": input_path.name,
        "generatedAt": date.today().strftime("%B %d, %Y"),
        "itemCount": len(items),
        "items": items,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(catalog, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    args.report_dir.mkdir(parents=True, exist_ok=True)
    with (args.report_dir / "missing-logos.csv").open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(["brand", "category"])
        for brand, category in sorted(missing.items()):
            writer.writerow([brand, category])

    resolved = sum(1 for i in items if i["logo"])
    counts = {c: sum(1 for i in items if i["category"] == c) for c in ALCOHOL_CATEGORIES}
    print(f"Read {len(rows)} rows from {input_path.name}")
    print(f"Kept {len(items)} alcoholic beverage / liquor items "
          f"({', '.join(f'{c}: {n}' for c, n in counts.items())})")
    print(f"Dropped: {dropped}")
    print(f"Logos resolved: {resolved}/{len(items)}; missing: {sorted(missing) or 'none'}")
    print(f"Wrote {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
