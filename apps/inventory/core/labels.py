"""labels — Avery label layout engine + print-accurate HTML renderer.

Template dimensions are Avery's published template specifications for
Letter (8.5" x 11") sheets: label size, top/left margins, and horizontal
/ vertical pitch (label + gap). Every spec is stored in inches AND mm
(1 in = 25.4 mm). Sources: Avery Design & Print template definitions for
5160/8160, 5161, 5163, 5164, 5167 (avery.com/templates). If a sheet ever
prints off-register, adjust the printer's margin calibration — do not
"fix" it by editing these specs away from Avery's published numbers.

Layout math: label (row r, col c) on a page sits at
  x = left_margin + c * horizontal_pitch
  y = top_margin  + r * vertical_pitch
with the label's own width/height. Boxes are computed per label cell so
the renderer (and the UI's live preview) share one source of truth.
"""

from __future__ import annotations

import html
from dataclasses import dataclass
from typing import Optional

MM_PER_IN = 25.4


@dataclass(frozen=True)
class AverySpec:
    key: str
    name: str
    label_width_in: float
    label_height_in: float
    page_width_in: float = 8.5
    page_height_in: float = 11.0
    top_margin_in: float = 0.5
    left_margin_in: float = 0.1875
    horizontal_pitch_in: float = 2.75
    vertical_pitch_in: float = 1.0
    columns: int = 3
    rows: int = 10

    @property
    def per_sheet(self) -> int:
        return self.columns * self.rows

    def _mm(self, inches: float) -> float:
        return round(inches * MM_PER_IN, 2)

    def to_dict(self) -> dict:
        return {
            "key": self.key,
            "name": self.name,
            "label": {"width_in": self.label_width_in, "height_in": self.label_height_in,
                      "width_mm": self._mm(self.label_width_in),
                      "height_mm": self._mm(self.label_height_in)},
            "page": {"width_in": self.page_width_in, "height_in": self.page_height_in,
                     "width_mm": self._mm(self.page_width_in),
                     "height_mm": self._mm(self.page_height_in)},
            "margins": {"top_in": self.top_margin_in, "left_in": self.left_margin_in,
                        "top_mm": self._mm(self.top_margin_in),
                        "left_mm": self._mm(self.left_margin_in)},
            "pitch": {"horizontal_in": self.horizontal_pitch_in,
                      "vertical_in": self.vertical_pitch_in,
                      "horizontal_mm": self._mm(self.horizontal_pitch_in),
                      "vertical_mm": self._mm(self.vertical_pitch_in)},
            "columns": self.columns,
            "rows": self.rows,
            "per_sheet": self.per_sheet,
        }


# Avery published template dimensions (Letter sheets).
AVERY_TEMPLATES: dict[str, AverySpec] = {
    # Address labels 1" x 2-5/8", 30 per sheet.
    "5160": AverySpec("5160", 'Avery 5160 — 1" × 2-5/8" (30/sheet)',
                      label_width_in=2.625, label_height_in=1.0,
                      left_margin_in=0.1875, horizontal_pitch_in=2.75,
                      vertical_pitch_in=1.0, columns=3, rows=10),
    # 8160 is the inkjet twin of 5160 — identical geometry.
    "8160": AverySpec("8160", 'Avery 8160 — 1" × 2-5/8" (30/sheet)',
                      label_width_in=2.625, label_height_in=1.0,
                      left_margin_in=0.1875, horizontal_pitch_in=2.75,
                      vertical_pitch_in=1.0, columns=3, rows=10),
    # Address labels 1" x 4", 20 per sheet.
    "5161": AverySpec("5161", 'Avery 5161 — 1" × 4" (20/sheet)',
                      label_width_in=4.0, label_height_in=1.0,
                      left_margin_in=0.15625, horizontal_pitch_in=4.1875,
                      vertical_pitch_in=1.0, columns=2, rows=10),
    # Shipping labels 2" x 4", 10 per sheet.
    "5163": AverySpec("5163", 'Avery 5163 — 2" × 4" (10/sheet)',
                      label_width_in=4.0, label_height_in=2.0,
                      left_margin_in=0.15625, horizontal_pitch_in=4.1875,
                      vertical_pitch_in=2.0, columns=2, rows=5),
    # Shipping labels 3-1/3" x 4", 6 per sheet.
    "5164": AverySpec("5164", 'Avery 5164 — 3-1/3" × 4" (6/sheet)',
                      label_width_in=4.0, label_height_in=3.3333,
                      left_margin_in=0.15625, horizontal_pitch_in=4.1875,
                      vertical_pitch_in=3.3333, columns=2, rows=3),
    # Return address labels 1/2" x 1-3/4", 80 per sheet.
    "5167": AverySpec("5167", 'Avery 5167 — 1/2" × 1-3/4" (80/sheet)',
                      label_width_in=1.75, label_height_in=0.5,
                      left_margin_in=0.3125, horizontal_pitch_in=1.9375,
                      vertical_pitch_in=0.5, columns=4, rows=20),
}


def get_spec(key: str) -> AverySpec:
    try:
        return AVERY_TEMPLATES[key]
    except KeyError:
        raise ValueError(f"unknown Avery template: {key!r} "
                         f"(have: {', '.join(sorted(AVERY_TEMPLATES))})") from None


def compute_layout(key: str, count: int, start_offset: int = 0) -> list[dict]:
    """Per-label box coordinates for `count` labels on template `key`.

    start_offset skips that many cells (partially used sheet). Each box:
    { index, page, row, col, x_in, y_in, width_in, height_in, x_mm, ... }
    """
    spec = get_spec(key)
    boxes = []
    for i in range(count):
        cell = start_offset + i
        page, within = divmod(cell, spec.per_sheet)
        row, col = divmod(within, spec.columns)
        x = spec.left_margin_in + col * spec.horizontal_pitch_in
        y = spec.top_margin_in + row * spec.vertical_pitch_in
        boxes.append({
            "index": i,
            "page": page,
            "row": row,
            "col": col,
            "x_in": round(x, 4),
            "y_in": round(y, 4),
            "width_in": spec.label_width_in,
            "height_in": spec.label_height_in,
            "x_mm": round(x * MM_PER_IN, 2),
            "y_mm": round(y * MM_PER_IN, 2),
            "width_mm": round(spec.label_width_in * MM_PER_IN, 2),
            "height_mm": round(spec.label_height_in * MM_PER_IN, 2),
        })
    return boxes


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------

DEFAULT_FIELDS = [
    {"key": "name", "x_pct": 4, "y_pct": 6, "font_size": 10, "bold": True},
    {"key": "brand", "x_pct": 4, "y_pct": 34, "font_size": 8, "bold": False},
    {"key": "price", "x_pct": 4, "y_pct": 55, "font_size": 18, "bold": True},
    {"key": "upc_barcode", "x_pct": 58, "y_pct": 50, "font_size": 7, "bold": False},
]

_PLACEHOLDERS = ("name", "price", "upc", "upc_barcode", "brand", "size", "category")


def _field_value(item: dict, key: str) -> str:
    if key == "name":
        return str(item.get("name") or "")
    if key == "price":
        price = item.get("price")
        return f"${price:.2f}" if price is not None else ""
    if key == "upc":
        return str(item.get("upc") or "")
    if key == "brand":
        return str(item.get("brand") or "")
    if key == "size":
        return str(item.get("unit_size") or "")
    if key == "category":
        return str(item.get("category") or "")
    return ""


def _barcode_html(upc: str) -> str:
    """Barcode PLACEHOLDER: striped block + human-readable UPC.

    Deliberately not a scannable barcode — real Code128/UPC-A rendering
    lands with the Label Studio phase. The geometry (position/size) is
    the contract; the stripes mark where the barcode goes.
    """
    return (
        '<div class="barcode" title="barcode placeholder"></div>'
        f'<div class="barcode-text">{html.escape(upc)}</div>'
    )


def render_html(items: list[dict], template: str = "5160",
                fields: Optional[list[dict]] = None,
                start_offset: int = 0, copies_per_item: int = 1) -> str:
    """Render a print-accurate HTML sheet set for `items`.

    One absolutely-positioned div per label cell, positioned from
    compute_layout(); @page is Letter with zero margin so the browser's
    print output registers to the Avery sheet. Set the printer to
    "Actual size / 100%" — any fit-to-page scaling breaks registration.
    """
    spec = get_spec(template)
    fields = fields or DEFAULT_FIELDS
    expanded: list[dict] = []
    for item in items:
        expanded.extend([item] * max(1, copies_per_item))
    boxes = compute_layout(template, len(expanded), start_offset=start_offset)
    pages: dict[int, list[str]] = {}
    for item, box in zip(expanded, boxes):
        parts = []
        for field in fields:
            key = field["key"]
            style = (
                f"left:{field.get('x_pct', 0)}%;top:{field.get('y_pct', 0)}%;"
                f"font-size:{field.get('font_size', 10)}pt;"
                f"font-weight:{'700' if field.get('bold') else '400'};"
                f"text-align:{field.get('align', 'left')};"
            )
            if key == "upc_barcode":
                content = _barcode_html(str(item.get("upc") or ""))
            elif key in _PLACEHOLDERS:
                content = html.escape(_field_value(item, key))
            else:
                content = html.escape(str(key))  # literal text field
            parts.append(f'<div class="fld" style="{style}">{content}</div>')
        label = (
            f'<div class="label" style="left:{box["x_in"]}in;top:{box["y_in"]}in;'
            f'width:{box["width_in"]}in;height:{box["height_in"]}in;">'
            + "".join(parts) + "</div>"
        )
        pages.setdefault(box["page"], []).append(label)

    sheets = "\n".join(
        f'<div class="sheet">{"".join(labels)}</div>'
        for _page, labels in sorted(pages.items())
    )
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Labels — Avery {spec.key}</title>
<style>
  @page {{ size: Letter; margin: 0; }}
  * {{ box-sizing: border-box; }}
  body {{ margin: 0; font-family: Arial, Helvetica, sans-serif; }}
  .sheet {{ position: relative; width: {spec.page_width_in}in; height: {spec.page_height_in}in;
            page-break-after: always; overflow: hidden; }}
  .label {{ position: absolute; overflow: hidden; }}
  .fld {{ position: absolute; white-space: nowrap; line-height: 1.1; }}
  .barcode {{ width: 0.9in; height: 0.28in;
              background: repeating-linear-gradient(90deg, #000 0 2px, transparent 2px 4px, #000 4px 5px, transparent 5px 8px); }}
  .barcode-text {{ font-size: 7pt; letter-spacing: 1px; }}
  @media print {{ .sheet {{ page-break-after: always; }} }}
</style></head><body>
{sheets}
</body></html>"""
