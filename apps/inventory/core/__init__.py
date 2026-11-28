"""777 Inventory — Python reference engine.

Modules:
  ingest       spreadsheet (any structure) -> canonical item dicts
  pricing      Phase 3 pricing rulebook (suggestions, flags, preview/apply)
  toast_export canonical items -> Toast Retail template rows
  labels       Avery label layout engine + print HTML renderer

The canonical item schema is defined in docs/API_CONTRACTS.md.
"""

__all__ = ["ingest", "pricing", "toast_export", "labels"]
__version__ = "0.1.0"
