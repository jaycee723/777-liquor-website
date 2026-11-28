import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  SlidersHorizontal,
  X,
  ChevronLeft,
  ChevronRight,
  CheckSquare,
  RotateCcw,
  ScanBarcode,
} from 'lucide-react';
import {
  CanonicalItem,
  Hi5Status,
  InventoryFacets,
  InventorySummaryCounts,
  ItemFlag,
  ItemsQueryParams,
  PatchItemPayload,
  SortDirection,
  SortField,
  TriFilter,
} from '../types/inventory';
import { inventoryApi } from '../api/client';
import { calculateMarginPercent } from '../utils/inventoryRules';
import { findItemByBarcode } from '../utils/barcodeScanner';
import { BrandThumbnail } from './BrandThumbnail';
import { InlineNumericCell } from './InlineEditCell';
import { ItemDetailDrawer } from './ItemDetailDrawer';

interface InventoryGridProps {
  onToast: (tone: 'success' | 'error', text: string) => void;
  onOpenScanner?: () => void;
  scannedBarcode?: { code: string; nonce: number } | null;
}

const FLAG_META: Record<ItemFlag, { label: string; className: string }> = {
  NO_COST: {
    label: 'NO_COST',
    className:
      'text-red-800 dark:text-red-300 bg-red-50 dark:bg-red-950/60 border-red-200 dark:border-red-900',
  },
  NEED_PACK_CONFIG: {
    label: 'PACK_CFG',
    className:
      'text-amber-900 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 border-amber-200 dark:border-amber-900',
  },
  PRICE_DROP: {
    label: 'PRICE_DROP',
    className:
      'text-rose-800 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/60 border-rose-200 dark:border-rose-900',
  },
  HI5_CONFIRM: {
    label: 'HI5_CONFIRM',
    className:
      'text-amber-900 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 border-amber-200 dark:border-amber-900',
  },
  REVIEW: {
    label: 'REVIEW',
    className:
      'text-blue-900 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 border-blue-200 dark:border-blue-900',
  },
};

const ALL_FLAGS: ItemFlag[] = [
  'NO_COST',
  'NEED_PACK_CONFIG',
  'PRICE_DROP',
  'HI5_CONFIRM',
  'REVIEW',
];

export function InventoryGrid({
  onToast,
  onOpenScanner,
  scannedBarcode,
}: InventoryGridProps) {
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [category, setCategory] = useState('');
  const [vendor, setVendor] = useState('');
  const [brand, setBrand] = useState('');
  const [hasCost, setHasCost] = useState<TriFilter>('all');
  const [hasLogo, setHasLogo] = useState<TriFilter>('all');
  const [flag, setFlag] = useState<ItemFlag | 'ANY_FLAG' | ''>('');
  const [sortField, setSortField] = useState<SortField>('normalized_name');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  const [items, setItems] = useState<CanonicalItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [facets, setFacets] = useState<InventoryFacets>({
    categories: [],
    vendors: [],
    brands: [],
  });
  const [summary, setSummary] = useState<InventorySummaryCounts>({
    totalItems: 0,
    missingCostCount: 0,
    flaggedCount: 0,
    hi5ConfirmCount: 0,
    missingLogoCount: 0,
  });

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeItem, setActiveItem] = useState<CanonicalItem | null>(null);
  const [bulkCategory, setBulkCategory] = useState('');
  const [bulkVendor, setBulkVendor] = useState('');
  const [bulkHi5, setBulkHi5] = useState<Hi5Status | ''>('');
  const [bulkBusy, setBulkBusy] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut: "/" focuses search input
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === '/' &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA' &&
        document.activeElement?.tagName !== 'SELECT'
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Fast 150ms debounce for typing in search
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchInput);
      setPage(1);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const fetchInventory = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const params: ItemsQueryParams = {
      search: debouncedSearch,
      category,
      vendor,
      brand,
      hasCost,
      hasLogo,
      flag,
      sort: `${sortField}:${sortDir}`,
      page,
      pageSize,
    };

    try {
      const response = await inventoryApi.getItems(params);
      setItems(response.items);
      setTotal(response.total);
      setTotalPages(response.totalPages);
      setFacets(response.facets);
      setSummary(response.summary);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Unable to load inventory.');
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, category, vendor, brand, hasCost, hasLogo, flag, sortField, sortDir, page, pageSize]);

  useEffect(() => {
    void fetchInventory();
  }, [fetchInventory]);

  // Handle incoming barcode scan from header or toolbar scanner
  useEffect(() => {
    if (!scannedBarcode?.code) return;
    let cancelled = false;
    const code = scannedBarcode.code;

    setCategory('');
    setVendor('');
    setBrand('');
    setHasCost('all');
    setHasLogo('all');
    setFlag('');
    setSearchInput(code);
    setDebouncedSearch(code);
    setPage(1);

    void (async () => {
      try {
        const catalog = await inventoryApi.getAllItemsForMatching();
        if (cancelled) return;
        const matched = findItemByBarcode(catalog, code);
        if (matched) {
          setActiveItem(matched);
          onToast('success', `Scanned ${matched.normalized_name}`);
        } else {
          onToast('error', `No SKU matched UPC ${code}. Filtered inventory to check nearby items.`);
        }
      } catch (err) {
        if (!cancelled) {
          onToast('error', err instanceof Error ? err.message : 'Unable to look up scanned barcode.');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [scannedBarcode, onToast]);

  const hasActiveFilters = Boolean(
    searchInput.trim() ||
      category ||
      vendor ||
      brand ||
      hasCost !== 'all' ||
      hasLogo !== 'all' ||
      flag
  );

  const resetFilters = () => {
    setSearchInput('');
    setDebouncedSearch('');
    setCategory('');
    setVendor('');
    setBrand('');
    setHasCost('all');
    setHasLogo('all');
    setFlag('');
    setPage(1);
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
    setPage(1);
  };

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />;
    }
    return sortDir === 'asc' ? (
      <ArrowUp className="w-3.5 h-3.5 text-blue-700 dark:text-blue-400" aria-hidden="true" />
    ) : (
      <ArrowDown className="w-3.5 h-3.5 text-blue-700 dark:text-blue-400" aria-hidden="true" />
    );
  };

  const handlePatchItem = async (cloverId: string, patch: PatchItemPayload) => {
    const updated = await inventoryApi.patchItem(cloverId, patch);
    setItems((prev) => prev.map((row) => (row.clover_id === cloverId ? updated : row)));
    if (activeItem?.clover_id === cloverId) {
      setActiveItem(updated);
    }
    // Refresh summary counts & facets so missing-cost / HI-5 counts stay exact
    void fetchInventory();
    onToast('success', `Saved ${updated.normalized_name}`);
  };

  const allOnPageSelected =
    items.length > 0 && items.every((item) => selectedIds.has(item.clover_id));

  const toggleSelectAllOnPage = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        items.forEach((i) => next.delete(i.clover_id));
      } else {
        items.forEach((i) => next.add(i.clover_id));
      }
      return next;
    });
  };

  const toggleSelectRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runBulkAction = async (
    patch: PatchItemPayload,
    label: string,
    clearFlags?: ItemFlag[]
  ) => {
    if (selectedIds.size === 0) return;
    setBulkBusy(true);
    try {
      const res = await inventoryApi.bulkPatchItems({
        ids: Array.from(selectedIds),
        patch,
        clearFlags,
      });
      setSelectedIds(new Set());
      setBulkCategory('');
      setBulkVendor('');
      setBulkHi5('');
      await fetchInventory();
      onToast('success', `${label} applied to ${res.updatedCount} item${res.updatedCount === 1 ? '' : 's'}.`);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Bulk update failed.');
    } finally {
      setBulkBusy(false);
    }
  };

  const startRange = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const endRange = Math.min(total, page * pageSize);

  return (
    <div className="space-y-4">
      {/* Compact Operations Summary Strip (Clickable Quick Filters) */}
      <div
        className="grid grid-cols-2 sm:grid-cols-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800"
        aria-label="Inventory summary quick filters"
      >
        <button
          type="button"
          onClick={resetFilters}
          className={`px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors cursor-pointer ${
            !hasActiveFilters ? 'bg-slate-50/80 dark:bg-slate-800/40' : ''
          }`}
        >
          <span className="block text-xs text-slate-500 dark:text-slate-400">Total SKUs</span>
          <span className="mt-0.5 block text-lg font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
            {summary.totalItems}
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            resetFilters();
            setHasCost('no');
          }}
          className={`px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors cursor-pointer ${
            hasCost === 'no' ? 'bg-red-50/60 dark:bg-red-950/30' : ''
          }`}
        >
          <span className="block text-xs text-slate-500 dark:text-slate-400">Missing Cost</span>
          <span className="mt-0.5 block text-lg font-mono tabular-nums font-semibold text-red-700 dark:text-red-400">
            {summary.missingCostCount}
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            resetFilters();
            setFlag('ANY_FLAG');
          }}
          className={`px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors cursor-pointer ${
            flag === 'ANY_FLAG' ? 'bg-amber-50/60 dark:bg-amber-950/30' : ''
          }`}
        >
          <span className="block text-xs text-slate-500 dark:text-slate-400">Flagged Items</span>
          <span className="mt-0.5 block text-lg font-mono tabular-nums font-semibold text-amber-700 dark:text-amber-400">
            {summary.flaggedCount}
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            resetFilters();
            setFlag('HI5_CONFIRM');
          }}
          className={`px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors cursor-pointer ${
            flag === 'HI5_CONFIRM' ? 'bg-amber-50/60 dark:bg-amber-950/30' : ''
          }`}
        >
          <span className="block text-xs text-slate-500 dark:text-slate-400">HI-5 Confirm</span>
          <span className="mt-0.5 block text-lg font-mono tabular-nums font-semibold text-amber-700 dark:text-amber-400">
            {summary.hi5ConfirmCount}
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            resetFilters();
            setHasLogo('no');
          }}
          className={`col-span-2 sm:col-span-1 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors cursor-pointer ${
            hasLogo === 'no' ? 'bg-slate-100 dark:bg-slate-800/70' : ''
          }`}
        >
          <span className="block text-xs text-slate-500 dark:text-slate-400">Missing Logo</span>
          <span className="mt-0.5 block text-lg font-mono tabular-nums font-semibold text-slate-800 dark:text-slate-200">
            {summary.missingLogoCount}
          </span>
        </button>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-3.5 space-y-2.5">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          <div className="relative flex-1 min-w-0">
            <Search
              className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              ref={searchRef}
              id="inventory-search"
              type="search"
              aria-label="Search inventory by name, brand, UPC, vendor, or Clover ID"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search item name, brand, UPC, vendor, or Clover ID (press / to focus)"
              className="w-full h-10 pl-9 pr-3 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          {onOpenScanner && (
            <button
              type="button"
              onClick={onOpenScanner}
              className="h-10 px-3.5 inline-flex items-center justify-center gap-1.5 text-xs font-semibold rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ScanBarcode className="w-4 h-4 text-blue-700 dark:text-blue-400" aria-hidden="true" />
              <span>Scan Barcode</span>
            </button>
          )}

          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetFilters}
              className="h-10 px-3.5 inline-flex items-center justify-center gap-1.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Reset Filters</span>
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Filter by category"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
            className="h-9 px-2.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="">All Categories</option>
            {facets.categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by vendor"
            value={vendor}
            onChange={(e) => {
              setVendor(e.target.value);
              setPage(1);
            }}
            className="h-9 px-2.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600 max-w-[190px]"
          >
            <option value="">All Vendors</option>
            <option value="__MISSING__">No Vendor Assigned</option>
            {facets.vendors.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by brand"
            value={brand}
            onChange={(e) => {
              setBrand(e.target.value);
              setPage(1);
            }}
            className="h-9 px-2.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600 max-w-[170px]"
          >
            <option value="">All Brands</option>
            {facets.brands.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by cost availability"
            value={hasCost}
            onChange={(e) => {
              setHasCost(e.target.value as TriFilter);
              setPage(1);
            }}
            className="h-9 px-2.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="all">Cost: All</option>
            <option value="yes">Has Cost</option>
            <option value="no">Missing Cost</option>
          </select>

          <select
            aria-label="Filter by brand logo availability"
            value={hasLogo}
            onChange={(e) => {
              setHasLogo(e.target.value as TriFilter);
              setPage(1);
            }}
            className="h-9 px-2.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="all">Logo: All</option>
            <option value="yes">Has Logo</option>
            <option value="no">Missing Logo</option>
          </select>

          <select
            aria-label="Filter by operational flag"
            value={flag}
            onChange={(e) => {
              setFlag(e.target.value as ItemFlag | 'ANY_FLAG' | '');
              setPage(1);
            }}
            className="h-9 px-2.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="">Flags: All</option>
            <option value="ANY_FLAG">Any Flag</option>
            {ALL_FLAGS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>

        {/* Contextual Bulk Action Bar */}
        {selectedIds.size > 0 && (
          <div
            role="region"
            aria-label="Bulk inventory actions"
            className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3"
          >
            <div className="flex items-center gap-2 text-xs font-semibold text-blue-800 dark:text-blue-300">
              <CheckSquare className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="font-mono tabular-nums">{selectedIds.size}</span>
              <span>selected</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Bulk assign category"
                value={bulkCategory}
                disabled={bulkBusy}
                onChange={(e) => {
                  const val = e.target.value;
                  setBulkCategory(val);
                  if (val) void runBulkAction({ category: val }, `Category -> ${val}`);
                }}
                className="h-9 px-2.5 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200"
              >
                <option value="">Set Category...</option>
                {facets.categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>

              <select
                aria-label="Bulk assign vendor"
                value={bulkVendor}
                disabled={bulkBusy}
                onChange={(e) => {
                  const val = e.target.value;
                  setBulkVendor(val);
                  if (val) void runBulkAction({ vendor: val }, `Vendor -> ${val}`);
                }}
                className="h-9 px-2.5 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200"
              >
                <option value="">Set Vendor...</option>
                {facets.vendors.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>

              <select
                aria-label="Bulk assign HI-5 status"
                value={bulkHi5}
                disabled={bulkBusy}
                onChange={(e) => {
                  const val = e.target.value as Hi5Status | '';
                  setBulkHi5(val);
                  if (val) void runBulkAction({ hi5_eligible: val }, `HI-5 -> ${val}`);
                }}
                className="h-9 px-2.5 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200"
              >
                <option value="">Set HI-5...</option>
                <option value="Yes">HI-5: Yes ($0.06)</option>
                <option value="No">HI-5: No (Exempt)</option>
                <option value="Confirm">HI-5: Confirm</option>
              </select>

              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => void runBulkAction({}, 'Cleared REVIEW flag', ['REVIEW'])}
                className="h-9 px-3 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Clear REVIEW Flag
              </button>

              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="h-9 px-2.5 inline-flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Clear</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Main Dense Inventory Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        {loadError ? (
          <div className="p-8 text-center space-y-3">
            <p className="text-sm font-medium text-red-700 dark:text-red-400">{loadError}</p>
            <button
              type="button"
              onClick={() => void fetchInventory()}
              className="h-9 px-4 text-xs font-semibold rounded-md bg-blue-700 text-white hover:bg-blue-800 cursor-pointer"
            >
              Retry Load
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[1040px]">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-xs font-semibold text-slate-600 dark:text-slate-400">
                  <th className="w-9 px-2.5 py-2.5">
                    <input
                      type="checkbox"
                      aria-label="Select all items on this page"
                      checked={allOnPageSelected}
                      onChange={toggleSelectAllOnPage}
                      className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-600 cursor-pointer"
                    />
                  </th>

                  <th className="px-2 py-2.5">
                    <button
                      type="button"
                      onClick={() => handleSort('normalized_name')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100 whitespace-nowrap cursor-pointer"
                    >
                      <span>Item / Brand / UPC</span>
                      {renderSortIcon('normalized_name')}
                    </button>
                  </th>

                  <th className="px-2 py-2.5 w-28">
                    <button
                      type="button"
                      onClick={() => handleSort('category')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100 whitespace-nowrap cursor-pointer"
                    >
                      <span>Category</span>
                      {renderSortIcon('category')}
                    </button>
                  </th>

                  <th className="px-2 py-2.5 w-36">
                    <button
                      type="button"
                      onClick={() => handleSort('vendor')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100 whitespace-nowrap cursor-pointer"
                    >
                      <span>Vendor &amp; Pack</span>
                      {renderSortIcon('vendor')}
                    </button>
                  </th>

                  <th className="px-1.5 py-2.5 w-[74px] text-right">
                    <button
                      type="button"
                      onClick={() => handleSort('price')}
                      className="inline-flex items-center justify-end gap-1 hover:text-slate-900 dark:hover:text-slate-100 whitespace-nowrap cursor-pointer"
                    >
                      <span>Price</span>
                      {renderSortIcon('price')}
                    </button>
                  </th>

                  <th className="px-1.5 py-2.5 w-[74px] text-right">
                    <button
                      type="button"
                      onClick={() => handleSort('cost')}
                      className="inline-flex items-center justify-end gap-1 hover:text-slate-900 dark:hover:text-slate-100 whitespace-nowrap cursor-pointer"
                    >
                      <span>Cost</span>
                      {renderSortIcon('cost')}
                    </button>
                  </th>

                  <th className="px-1.5 py-2.5 w-[56px] text-right whitespace-nowrap">Margin</th>

                  <th className="px-1.5 py-2.5 w-[76px] text-right">
                    <button
                      type="button"
                      onClick={() => handleSort('suggested_price')}
                      className="inline-flex items-center justify-end gap-1 hover:text-slate-900 dark:hover:text-slate-100 whitespace-nowrap cursor-pointer"
                    >
                      <span>Sugg.</span>
                      {renderSortIcon('suggested_price')}
                    </button>
                  </th>

                  <th className="px-1.5 py-2.5 w-[54px] text-right">
                    <button
                      type="button"
                      onClick={() => handleSort('quantity')}
                      className="inline-flex items-center justify-end gap-1 hover:text-slate-900 dark:hover:text-slate-100 whitespace-nowrap cursor-pointer"
                    >
                      <span>Qty</span>
                      {renderSortIcon('quantity')}
                    </button>
                  </th>

                  <th className="px-1.5 py-2.5 w-[88px] whitespace-nowrap">HI-5</th>
                  <th className="px-2 py-2.5 w-[132px] whitespace-nowrap">Flags</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                {loading ? (
                  Array.from({ length: 8 }).map((_, idx) => (
                    <tr key={idx} className="h-[52px]">
                      <td colSpan={11} className="px-4 py-2">
                        <div className="h-5 w-full rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
                      </td>
                    </tr>
                  ))
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-6 py-12 text-center">
                      <SlidersHorizontal
                        className="w-7 h-7 mx-auto text-slate-400 dark:text-slate-600 mb-2"
                        aria-hidden="true"
                      />
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        No inventory items match your filters
                      </p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        Try clearing a category, vendor, or flag filter to view the full store catalog.
                      </p>
                      <button
                        type="button"
                        onClick={resetFilters}
                        className="mt-4 h-9 px-4 text-xs font-semibold rounded-md bg-blue-700 hover:bg-blue-800 text-white transition-colors cursor-pointer"
                      >
                        Clear All Filters
                      </button>
                    </td>
                  </tr>
                ) : (
                  items.map((item) => {
                    const isSelected = selectedIds.has(item.clover_id);
                    const margin = calculateMarginPercent(item.price, item.cost);
                    const packSummary =
                      item.sell_pack_qty && item.packs_per_case
                        ? `${item.sell_pack_qty}pk × ${item.packs_per_case}/cs`
                        : 'Pack config needed';

                    return (
                      <tr
                        key={item.clover_id}
                        className={`transition-colors ${
                          isSelected
                            ? 'bg-blue-50/70 dark:bg-blue-950/30'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                        }`}
                      >
                        <td className="px-2.5 py-2 align-middle">
                          <input
                            type="checkbox"
                            aria-label={`Select ${item.normalized_name}`}
                            checked={isSelected}
                            onChange={() => toggleSelectRow(item.clover_id)}
                            className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-600 cursor-pointer"
                          />
                        </td>

                        {/* Brand Thumbnail + Name + Metadata */}
                        <td className="px-2 py-2 align-middle">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <BrandThumbnail
                              logoUrl={item.logo_url}
                              brand={item.brand}
                              itemName={item.normalized_name}
                              size="sm"
                            />
                            <div className="min-w-0">
                              <button
                                type="button"
                                onClick={() => setActiveItem(item)}
                                aria-label={`Inspect and edit ${item.normalized_name}`}
                                className="text-left text-[13px] font-semibold text-slate-900 dark:text-slate-100 hover:text-blue-700 dark:hover:text-blue-400 transition-colors truncate block max-w-[235px] cursor-pointer"
                              >
                                {item.normalized_name}
                              </button>
                              <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[235px]">
                                <span className="truncate">{item.brand}</span>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono tabular-nums shrink-0">{item.unit_size}</span>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono tabular-nums shrink-0">{item.upc}</span>
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Category / Subcategory */}
                        <td className="px-2 py-2 align-middle">
                          <div className="text-slate-900 dark:text-slate-100 font-medium truncate max-w-[105px]">
                            {item.category}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[105px]">
                            {item.subcategory}
                          </div>
                        </td>

                        {/* Vendor & Pack */}
                        <td className="px-2 py-2 align-middle">
                          <div
                            className={`truncate max-w-[138px] ${
                              item.vendor
                                ? 'text-slate-800 dark:text-slate-200'
                                : 'text-amber-700 dark:text-amber-400 font-medium'
                            }`}
                          >
                            {item.vendor ?? 'No vendor'}
                          </div>
                          <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 truncate max-w-[138px]">
                            {packSummary}
                          </div>
                        </td>

                        {/* Inline Editable Current Price */}
                        <td className="px-1 py-2 align-middle text-right">
                          <InlineNumericCell
                            field="price"
                            value={item.price}
                            prefix="$"
                            itemLabel={item.normalized_name}
                            onCommit={(nextVal) =>
                              handlePatchItem(item.clover_id, { price: nextVal ?? item.price })
                            }
                          />
                        </td>

                        {/* Inline Editable Cost */}
                        <td className="px-1 py-2 align-middle text-right">
                          <InlineNumericCell
                            field="cost"
                            value={item.cost}
                            prefix="$"
                            highlightMissing
                            itemLabel={item.normalized_name}
                            onCommit={(nextVal) =>
                              handlePatchItem(item.clover_id, { cost: nextVal })
                            }
                          />
                        </td>

                        {/* Read-only Margin % (null when cost missing) */}
                        <td className="px-1.5 py-2 align-middle text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                          {margin !== null ? `${margin.toFixed(1)}%` : '—'}
                        </td>

                        {/* Read-only API Suggested Price */}
                        <td className="px-1.5 py-2 align-middle text-right font-mono tabular-nums">
                          {item.suggested_price !== null ? (
                            <span
                              className={
                                item.suggested_price < item.price
                                  ? 'text-rose-700 dark:text-rose-400 font-semibold'
                                  : 'text-slate-700 dark:text-slate-300'
                              }
                            >
                              ${item.suggested_price.toFixed(2)}
                            </span>
                          ) : (
                            <span className="text-slate-400 dark:text-slate-600">—</span>
                          )}
                        </td>

                        {/* Inline Editable Quantity */}
                        <td className="px-1 py-2 align-middle text-right">
                          <InlineNumericCell
                            field="quantity"
                            value={item.quantity}
                            itemLabel={item.normalized_name}
                            onCommit={(nextVal) =>
                              handlePatchItem(item.clover_id, { quantity: nextVal ?? 0 })
                            }
                          />
                        </td>

                        {/* Inline Editable HI-5 Status */}
                        <td className="px-1.5 py-2 align-middle">
                          <select
                            aria-label={`HI-5 deposit status for ${item.normalized_name}`}
                            value={item.hi5_eligible}
                            onChange={(e) =>
                              void handlePatchItem(item.clover_id, {
                                hi5_eligible: e.target.value as Hi5Status,
                              })
                            }
                            className={`w-full h-8 px-1.5 text-[11px] font-medium rounded border bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600 cursor-pointer ${
                              item.hi5_eligible === 'Confirm'
                                ? 'border-amber-400 dark:border-amber-700 text-amber-800 dark:text-amber-300'
                                : item.hi5_eligible === 'Yes'
                                  ? 'border-slate-300 dark:border-slate-700 text-emerald-800 dark:text-emerald-400'
                                  : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                            }`}
                          >
                            <option value="Yes">Yes 6¢</option>
                            <option value="No">No</option>
                            <option value="Confirm">Confirm</option>
                          </select>
                        </td>

                        {/* Operational Flags (Square-edged high-signal indicators, never pills) */}
                        <td className="px-2 py-2 align-middle">
                          {item.flags.length === 0 ? (
                            <span className="text-[11px] text-slate-400 dark:text-slate-600">
                              Clean
                            </span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {item.flags.map((f) => (
                                <span
                                  key={f}
                                  className={`px-1.5 py-0.5 text-[10px] font-mono font-medium rounded border whitespace-nowrap ${FLAG_META[f].className}`}
                                >
                                  {FLAG_META[f].label}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600 dark:text-slate-400">
          <div className="flex items-center gap-3">
            <span className="font-mono tabular-nums">
              Showing {startRange}–{endRange} of {total} items
            </span>
            <label className="inline-flex items-center gap-1.5">
              <span>Rows:</span>
              <select
                aria-label="Rows per page"
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="h-8 px-2 text-xs font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
              >
                <option value={15}>15</option>
                <option value={30}>30</option>
                <option value={50}>50</option>
              </select>
            </label>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="h-8 px-3 inline-flex items-center gap-1 font-medium rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Prev</span>
            </button>
            <span className="font-mono tabular-nums px-2">
              Page {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="h-8 px-3 inline-flex items-center gap-1 font-medium rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
            >
              <span>Next</span>
              <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {/* Slide-Over Detail Drawer */}
      <ItemDetailDrawer
        item={activeItem}
        vendors={facets.vendors}
        categories={facets.categories}
        onClose={() => setActiveItem(null)}
        onSave={handlePatchItem}
      />
    </div>
  );
}
