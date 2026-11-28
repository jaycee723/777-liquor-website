import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, Plus, Search } from 'lucide-react';
import { CanonicalItem, ProductSuggestion } from '../types/inventory';
import { apiClient } from '../services/apiClient';
import { normalizeItemName } from '../utils/inventoryRules';
import { BrandThumbnail } from './BrandThumbnail';

interface ProductSuggestionsProps {
  onNavigateInventory: () => void;
  onToast: (tone: 'success' | 'error', text: string) => void;
}

type SortKey = 'margin_desc' | 'cost_asc' | 'retail_desc';

const CATEGORY_TABS = ['All', 'Beer', 'RTD', 'Spirits', 'Wine', 'Non-Alcoholic', 'Grocery'] as const;

export function ProductSuggestions({
  onNavigateInventory,
  onToast,
}: ProductSuggestionsProps) {
  const [suggestions, setSuggestions] = useState<ProductSuggestion[]>([]);
  const [catalogItems, setCatalogItems] = useState<CanonicalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [sortBy, setSortBy] = useState<SortKey>('margin_desc');
  const [addingId, setAddingId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, catalog] = await Promise.all([
        apiClient.getProductSuggestions(),
        apiClient.getAllItemsForMatching(),
      ]);
      setSuggestions(list);
      setCatalogItems(catalog);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load product suggestions.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const existingKeys = useMemo(() => {
    const upcs = new Set<string>();
    const names = new Set<string>();
    for (const item of catalogItems) {
      if (item.upc) upcs.add(item.upc.trim());
      names.add(item.normalized_name.trim().toLowerCase());
    }
    return { upcs, names };
  }, [catalogItems]);

  const isInCatalog = useCallback(
    (s: ProductSuggestion) => {
      if (s.upc && existingKeys.upcs.has(s.upc.trim())) return true;
      return existingKeys.names.has(normalizeItemName(s.name).trim().toLowerCase());
    },
    [existingKeys]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = suggestions.filter((s) => {
      if (categoryFilter !== 'All' && s.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.brand.toLowerCase().includes(q) ||
        s.vendor.toLowerCase().includes(q) ||
        s.hawaii_trend_note.toLowerCase().includes(q)
      );
    });

    return [...list].sort((a, b) => {
      if (sortBy === 'cost_asc') return a.estimated_cost - b.estimated_cost;
      if (sortBy === 'retail_desc') return b.estimated_retail - a.estimated_retail;
      return b.expected_margin_pct - a.expected_margin_pct;
    });
  }, [suggestions, search, categoryFilter, sortBy]);

  const summary = useMemo(() => {
    const avgMargin =
      suggestions.length > 0
        ? suggestions.reduce((sum, s) => sum + s.expected_margin_pct, 0) / suggestions.length
        : 0;
    const inCatalogCount = suggestions.filter(isInCatalog).length;
    const vendorCount = new Set(suggestions.map((s) => s.vendor)).size;
    return {
      total: suggestions.length,
      avgMargin,
      inCatalogCount,
      vendorCount,
    };
  }, [suggestions, isInCatalog]);

  const handleAddDraft = async (suggestion: ProductSuggestion) => {
    setAddingId(suggestion.id);
    try {
      const created = await apiClient.createDraftItemFromSuggestion(suggestion);
      setCatalogItems((prev) => [created, ...prev]);
      onToast(
        'success',
        `Added "${created.normalized_name}" as a Draft SKU flagged REVIEW (Qty 0).`
      );
    } catch (err) {
      onToast(
        'error',
        err instanceof Error ? err.message : 'Could not add draft SKU to inventory.'
      );
    } finally {
      setAddingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-4 py-3.5">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Honolulu Assortment Ideas
          </div>
          <div className="mt-1 text-xl font-display font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {loading ? '…' : summary.total}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            Oahu distributor picks
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-4 py-3.5">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Avg Expected Margin
          </div>
          <div className="mt-1 text-xl font-display font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
            {loading ? '…' : `${summary.avgMargin.toFixed(1)}%`}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            Est. retail vs. wholesale
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-4 py-3.5">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Added to Catalog
          </div>
          <div
            data-testid="suggestions-added-count"
            className="mt-1 text-xl font-display font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100"
          >
            {loading ? '…' : summary.inCatalogCount}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            Drafts flagged for counter check
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-4 py-3.5">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Hawaii Distributors
          </div>
          <div className="mt-1 text-xl font-display font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {loading ? '…' : summary.vendorCount}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            Active Oahu wholesale lines
          </div>
        </div>
      </div>

      {/* Filter & Sort Controls */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search
              className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search brand, item, distributor, or Hawaii trend…"
              aria-label="Search product suggestions"
              className="w-full h-10 pl-9 pr-3 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div className="flex items-center gap-2">
            <label
              htmlFor="suggestions-sort"
              className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap"
            >
              Sort by
            </label>
            <select
              id="suggestions-sort"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
              className="h-10 px-3 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="margin_desc">Highest Margin %</option>
              <option value="cost_asc">Lowest Wholesale Cost</option>
              <option value="retail_desc">Highest Retail Price</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Filter by category">
          {CATEGORY_TABS.map((cat) => {
            const active = categoryFilter === cat;
            return (
              <button
                key={cat}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setCategoryFilter(cat)}
                className={`h-8 px-3 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  active
                    ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950 font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="px-4 py-3 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50 text-xs text-red-800 dark:text-red-300"
        >
          {error}
        </div>
      )}

      {/* Suggestions Table / Ledger */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-display font-bold text-slate-900 dark:text-slate-100">
              Recommended SKUs for 931 University Ave
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Draft items are created at Qty 0 with normalized Title Case names and flagged REVIEW before going live on shelf.
            </p>
          </div>
          <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            {filtered.length} shown
          </span>
        </div>

        {loading ? (
          <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
            Loading Honolulu market suggestions…
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
            No suggestions match your search or category filter.
          </div>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {filtered.map((item) => {
              const alreadyAdded = isInCatalog(item);
              const isAdding = addingId === item.id;
              const normalizedPreview = normalizeItemName(item.name);

              return (
                <div
                  key={item.id}
                  data-testid={`suggestion-row-${item.id}`}
                  className="px-5 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors"
                >
                  {/* Primary Product Identity & Trend Note */}
                  <div className="flex items-start gap-3.5 min-w-0 flex-1">
                    <BrandThumbnail
                      logoUrl={null}
                      brand={item.brand}
                      itemName={normalizedPreview}
                      size="md"
                    />
                    <div className="min-w-0 space-y-1">
                      <h3 className="text-sm font-display font-bold text-slate-900 dark:text-slate-100 leading-snug">
                        {normalizedPreview}
                      </h3>
                      <div className="text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                        <span className="font-medium text-slate-700 dark:text-slate-300">
                          {item.vendor}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{item.category}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono text-[11px]">
                          {item.unit_size} · {item.sell_pack_qty}pk × {item.packs_per_case}/cs
                        </span>
                        {item.upc && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono text-[11px]">UPC {item.upc}</span>
                          </>
                        )}
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                        {item.hawaii_trend_note}
                      </p>
                    </div>
                  </div>

                  {/* Financial Metrics & Draft Action */}
                  <div className="flex flex-wrap sm:flex-nowrap items-center justify-between lg:justify-end gap-5 shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-slate-100 dark:border-slate-800">
                    <div className="grid grid-cols-3 gap-4 text-right">
                      <div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">Est. Cost</div>
                        <div className="text-xs font-mono tabular-nums font-medium text-slate-800 dark:text-slate-200">
                          ${item.estimated_cost.toFixed(2)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          Est. Retail
                        </div>
                        <div className="text-xs font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                          ${item.estimated_retail.toFixed(2)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">Margin</div>
                        <div className="text-xs font-mono tabular-nums font-semibold text-emerald-700 dark:text-emerald-400">
                          {item.expected_margin_pct.toFixed(1)}%
                        </div>
                      </div>
                    </div>

                    <div className="shrink-0">
                      {alreadyAdded ? (
                        <button
                          type="button"
                          onClick={onNavigateInventory}
                          data-testid={`suggestion-added-${item.id}`}
                          className="h-10 px-3.5 inline-flex items-center gap-1.5 text-xs font-semibold rounded-md border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-950 transition-colors whitespace-nowrap cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>In Catalog</span>
                          <ArrowRight className="w-3 h-3" aria-hidden="true" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={isAdding}
                          onClick={() => void handleAddDraft(item)}
                          data-testid={`add-draft-${item.id}`}
                          className="h-10 px-3.5 inline-flex items-center gap-1.5 text-xs font-semibold rounded-md bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white disabled:opacity-60 transition-colors whitespace-nowrap cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>{isAdding ? 'Adding…' : 'Add to Inventory (Draft)'}</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
