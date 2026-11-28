"""pricing — the Phase 3 pricing rulebook as a library.

Ported from inventory-pipeline/phase3_pricing.py, which implements
phase3_logic_spec.md under PRICING_POLICY.md. The rules, in short:

  * Suggested = CEILING( (Unit_Cost * 1.30) + (Bottle_Count * 0.06), 1 )
    - Unit_Cost = vendor case cost / sellable packs per case, or the
      existing per-unit (Clover) cost.
    - The $0.06/container HI-5 term is added ONLY for deposit-eligible
      containers (beer / malt RTD / non-alcohol beverages). Distilled
      spirits and wine are EXEMPT under Hawaii's HI-5 program.
  * Johnson Brothers items are priced off the ListCase market anchor,
    never off Justin's discounted Net cost, and the result must clear a
    >30%-profit floor over actual Net cost or it is blocked.
  * Missing inputs -> NO suggestion, with a flag saying why. The engine
    never guesses a price.
  * Original prices are NEVER modified by computing suggestions.
    apply_prices() is the only function that produces new prices, it is
    explicit, it returns new item dicts, and it requires a preview token
    from preview_apply() (the API's preview-then-apply semantics).

All arithmetic lives here in code — never in an LLM (pipeline rule).
"""

from __future__ import annotations

import hashlib
import math
from typing import Any, Optional

MARKUP = 1.30
HI5_PER_CONTAINER = 0.06
REVIEW_THRESHOLD = 0.20  # suggested > +20% vs current price -> REVIEW
BLOCKING_FLAGS = ("REVIEW", "PRICE_DROP")  # held out of master apply

# ---------------------------------------------------------------------------
# Beverage classification (drives HI-5 eligibility + category sanity).
# Ported verbatim in behavior from phase3_pricing.py / spec section 6.
# Classes: BEER_RTD, NONALC, NA_BEV -> HI-5 "Yes"; SPIRITS, WINE,
# SPIRITS_WINE -> "No"; RTD_AMBIG -> "Confirm" (priced without deposit
# until Justin rules); NON_BEV, FEE -> not beverages.
# ---------------------------------------------------------------------------

SPIRIT_WORDS = [
    "vodka", "whiskey", "whisky", "bourbon", "tequila", "mezcal", "rum",
    "gin", "brandy", "cognac", "scotch", "liqueur", "schnapps", "amaretto",
    "triple sec", "ouzo", "grappa", "pisco", "soju", "shochu", "baijiu",
    "moonshine", "everclear", "absinthe", "chartreuse", "aperol", "campari",
    "jagermeister", "fireball", "irish cream", "kahlua", "baileys",
]
WINE_WORDS = [
    "wine", "chardonnay", "merlot", "cabernet", "pinot", "sauvignon",
    "riesling", "prosecco", "champagne", "moscato", "zinfandel", "malbec",
    "shiraz", "syrah", "sangria", "port", "sherry", "vermouth", "sake",
    "bordeaux", "chianti", "tempranillo", "grenache", "rosé", "rose wine",
]
RTD_WORDS = [
    "cooler", "spritzer", "hard lemonade", "hard tea", "hard soda",
    "canned cocktail", "ready to drink", "margarita cocktail",
    "wine cocktail", "spiked",
]
RTD_AMBIG_BRANDS = [
    "cutwater", "high noon", "nutrl", "buzzballz", "beatbox", "buzz ball",
    "on the rocks", "cayman jack",
]
BEER_WORDS = [
    "beer", "lager", "ale", "ipa", "stout", "pilsner", "porter", "hefeweizen",
    "seltzer", "cider", "malt", "shandy", "radler", "bock", "amber ale",
    "pale ale", "wheat", "sour", "gose", "kolsch", "brew",
]
NONALC_BEV_WORDS = [
    "soda", "cola", "water", "juice", "tea", "lemonade", "energy drink",
    "sports drink", "tonic", "ginger ale", "ginger beer", "root beer",
    "sparkling", "kombucha", "coffee", "drink", "beverage", "mixer", "mix",
    "syrup", "bitters",
]
NA_MARKERS = [
    "non-alcoholic", "non alcoholic", "alcohol free", "alcohol-free",
    "0.0%", "0.0 ", "athletic brewing", "near beer",
]


def _has(text: str, words: list[str]) -> bool:
    return any(w in text for w in words)


def classify_beverage(name: str, category: Optional[str]) -> tuple[str, str, bool]:
    """Return (bev_class, hi5_eligible, cat_conflict).

    hi5_eligible is "Yes", "No", or "Confirm" (ambiguous RTD case).
    Deterministic keyword + category logic; every rule is in the spec.
    """
    n = " " + (name or "").lower() + " "
    cat = (category or "").strip()

    if cat == "Fees & Misc":
        return "FEE", "No", False

    na = _has(n, NA_MARKERS)
    spirit = _has(n, SPIRIT_WORDS)
    wine = _has(n, WINE_WORDS)
    rtd_ambig = _has(n, RTD_AMBIG_BRANDS)
    rtd = _has(n, RTD_WORDS)
    beer = _has(n, BEER_WORDS)

    if cat == "Beer & Seltzers":
        if na:
            return "NA_BEV", "Yes", False
        if rtd_ambig:
            return "RTD_AMBIG", "Confirm", False
        return "BEER_RTD", "Yes", False

    if cat == "Liquor & Wine":
        if na:
            return "NA_BEV", "Yes", True
        if rtd_ambig or rtd:
            return "RTD_AMBIG", "Confirm", False
        if spirit and not wine:
            return "SPIRITS", "No", False
        if wine and not spirit:
            return "WINE", "No", False
        if spirit and wine:
            return "SPIRITS", "No", True
        return "SPIRITS_WINE", "No", False

    if cat == "Drinks & Mixers":
        if spirit:
            return "SPIRITS", "No", True
        if wine:
            return "WINE", "No", True
        if beer and not na:
            return "BEER_RTD", "Yes", True
        return "NONALC", "Yes", False

    if cat in ("Vapes & Tobacco", "Smoke Shop & Hemp"):
        # Keyword hits here are NOT beverages (vape "juice" is e-liquid).
        if _has(n, NONALC_BEV_WORDS) or spirit or wine or beer:
            return "NON_BEV", "No", True
        return "NON_BEV", "No", False
    if _has(n, NONALC_BEV_WORDS) and not spirit and not wine:
        return "NONALC", "Yes", True
    if spirit:
        return "SPIRITS", "No", True
    if wine:
        return "WINE", "No", True
    return "NON_BEV", "No", False


# ---------------------------------------------------------------------------
# Suggestion computation
# ---------------------------------------------------------------------------

def ceil_dollar(x: float) -> float:
    """Excel CEILING(x, 1)."""
    return float(math.ceil(round(x, 9)))


def _is_johnson(item: dict) -> bool:
    vendor = (item.get("vendor") or "") + " " + (item.get("cost_source") or "")
    return "johnson" in vendor.lower()


def compute_suggestion(item: dict) -> dict:
    """Compute the pricing record for one canonical item.

    Never mutates the item. Returns:
      { item_id, name, current_price, suggested_price (or None),
        unit_cost, cost_source, delta_pct, flags, blocked_reason }
    """
    name = item.get("name") or ""
    category = item.get("category")
    current = item.get("price")
    if current is not None and current <= 0:
        current = current if current == 0 else None

    bev_class, hi5, cat_conflict = classify_beverage(name, category)

    flags: list[str] = []
    if not category:
        flags.append("CAT_MISSING")
    if cat_conflict:
        flags.append("CAT_CONFLICT")
    if bev_class == "FEE":
        flags.append("FEE_ITEM")
    if hi5 == "Confirm":
        flags.append("HI5_CONFIRM")
    if current is None:
        flags.append("NO_PRICE")
    elif current == 0:
        flags.append("ZERO_PRICE")

    case_cost = item.get("case_cost")
    packs = item.get("packs_per_case")
    unit_cost_input = item.get("cost")  # per-unit cost (Clover path)
    cost_source = item.get("cost_source") or ""
    johnson_net_unit: Optional[float] = None
    johnson_anchor = False
    blocked: Optional[str] = None
    cost_used: Optional[float] = None

    if case_cost is not None:
        # Vendor invoice path: cost is per case, divide by packs per case.
        if _is_johnson(item):
            if item.get("list_case_cost"):
                cost_used = item["list_case_cost"]
                cost_source = cost_source or "Johnson Brothers (List anchor)"
                johnson_anchor = True
                if packs:
                    johnson_net_unit = case_cost / packs
            else:
                cost_used = case_cost
                cost_source = cost_source or "Johnson Brothers (Net — no List anchor)"
                blocked = "JOHNSON_NO_LIST_ANCHOR"
                flags.append("JOHNSON_NO_LIST_ANCHOR")
        else:
            cost_used = case_cost
        if packs is None and blocked is None:
            blocked = "NEED_PACK_CONFIG"
            flags.append("NEED_PACK_CONFIG")
    elif unit_cost_input is not None and unit_cost_input > 0:
        cost_used = unit_cost_input
        packs = 1.0  # per-unit cost is already per sellable unit
        cost_source = cost_source or "Clover"
    else:
        flags.append("NO_COST")
        blocked = "NO_COST"

    if bev_class == "FEE":
        blocked = blocked or "FEE_ITEM"

    unit_cost: Optional[float] = None
    if cost_used is not None and packs:
        unit_cost = round(cost_used / packs, 4)

    # Bottle count (containers per sellable unit).
    bottle_count: Optional[int]
    if bev_class in ("NON_BEV", "FEE"):
        bottle_count = 0
    elif item.get("sell_pack_qty"):
        bottle_count = int(item["sell_pack_qty"])
    elif item.get("unit_size"):
        bottle_count = 1
    else:
        bottle_count = None

    suggested: Optional[float] = None
    if blocked is None and unit_cost is not None:
        if hi5 == "Yes" and bottle_count is None:
            blocked = "NEED_PACK_CONFIG"
            flags.append("NEED_PACK_CONFIG")
        else:
            hi5_amt = HI5_PER_CONTAINER * bottle_count if hi5 == "Yes" else 0.0
            s = ceil_dollar(unit_cost * MARKUP + hi5_amt)
            if johnson_anchor and johnson_net_unit is not None:
                if not (s > johnson_net_unit * MARKUP):
                    blocked = "JOHNSON_FLOOR_FAIL"
                    flags.append("JOHNSON_FLOOR_FAIL")
                    s = None
                else:
                    flags.append("JOHNSON_MARKET_ANCHOR")
            suggested = s

    # Guardrails.
    delta: Optional[float] = None
    if suggested is not None and current:
        delta = (suggested - current) / current
        if delta > REVIEW_THRESHOLD:
            flags.append("REVIEW")
        elif delta < 0:
            flags.append("PRICE_DROP")
    true_unit = johnson_net_unit if (johnson_anchor and johnson_net_unit) else unit_cost
    if true_unit is not None and current is not None and current > 0 and true_unit >= current:
        flags.append("COST_GE_PRICE")

    return {
        "item_id": item.get("id"),
        "clover_id": item.get("clover_id"),
        "name": name,
        "current_price": item.get("price"),
        "suggested_price": suggested,
        "unit_cost": unit_cost,
        "cost_source": cost_source or None,
        "bev_class": bev_class,
        "hi5_eligible": hi5,
        "bottle_count": bottle_count,
        "delta_pct": delta,
        "flags": flags,
        "blocked_reason": blocked,
    }


def compute_suggestions(items: list[dict]) -> dict:
    """Suggestions for a list of items + the summary block of the API
    contract (GET /api/pricing/suggestions). Read-only."""
    rows = [compute_suggestion(it) for it in items]
    by_id = {it.get("id"): it for it in items}

    def total(which: str) -> float:
        t = 0.0
        for r in rows:
            cur = r["current_price"] or 0.0
            if which == "current":
                t += cur
            elif which == "all":
                t += r["suggested_price"] if r["suggested_price"] is not None else cur
            elif which == "unflagged":
                blocked = any(f in r["flags"] for f in BLOCKING_FLAGS)
                t += r["suggested_price"] if (r["suggested_price"] is not None and not blocked) else cur
        return round(t, 2)

    return {
        "items": rows,
        "summary": {
            "suggestions": sum(1 for r in rows if r["suggested_price"] is not None),
            "blocked": sum(1 for r in rows if r["suggested_price"] is None),
            "total_current": total("current"),
            "total_if_all_applied": total("all"),
            "total_if_unflagged_applied": total("unflagged"),
        },
        "_by_id": by_id,  # internal helper for preview/apply; strip before API output
    }


# ---------------------------------------------------------------------------
# Preview / apply — the ONLY path from suggestion to price.
# ---------------------------------------------------------------------------

def _change_set(suggestions: dict, mode: str, item_ids: Optional[list[str]]) -> list[dict]:
    changes = []
    for r in suggestions["items"]:
        if r["suggested_price"] is None:
            continue
        if mode == "selected":
            if item_ids is None or r["item_id"] not in item_ids:
                continue
        elif mode == "master_unflagged":
            if any(f in r["flags"] for f in BLOCKING_FLAGS):
                continue
        else:
            raise ValueError(f"unknown apply mode: {mode}")
        changes.append({
            "item_id": r["item_id"],
            "from": r["current_price"],
            "to": r["suggested_price"],
        })
    return changes


def _token_for(changes: list[dict]) -> str:
    payload = "|".join(
        f"{c['item_id']}:{c['from']}->{c['to']}" for c in sorted(changes, key=lambda c: str(c["item_id"]))
    )
    return "pv_" + hashlib.sha256(payload.encode()).hexdigest()[:24]


def preview_apply(suggestions: dict, mode: str = "master_unflagged",
                  item_ids: Optional[list[str]] = None) -> dict:
    """Preview an apply WITHOUT changing anything (POST /api/pricing/apply
    with apply=false). Returns the change list and a preview token that
    apply_prices() requires."""
    changes = _change_set(suggestions, mode, item_ids)
    return {
        "would_change": len(changes),
        "total_before": round(sum(c["from"] or 0.0 for c in changes), 2),
        "total_after": round(sum(c["to"] or 0.0 for c in changes), 2),
        "changes": changes,
        "preview_token": _token_for(changes),
    }


def apply_prices(items: list[dict], suggestions: dict, preview_token: str,
                 mode: str = "master_unflagged",
                 item_ids: Optional[list[str]] = None) -> list[dict]:
    """Produce a NEW item list with the previewed prices applied.

    Explicit and side-effect free: the input items are not mutated, each
    changed item keeps its old price under "previous_price", and a stale
    preview token (data changed since preview) raises ValueError — the
    API maps that to HTTP 409.
    """
    changes = _change_set(suggestions, mode, item_ids)
    if _token_for(changes) != preview_token:
        raise ValueError("stale preview token: recompute the preview before applying")
    change_by_id = {c["item_id"]: c for c in changes}
    out: list[dict] = []
    for item in items:
        new_item = dict(item)
        change = change_by_id.get(item.get("id"))
        if change is not None:
            new_item["previous_price"] = item.get("price")
            new_item["price"] = change["to"]
        out.append(new_item)
    return out
