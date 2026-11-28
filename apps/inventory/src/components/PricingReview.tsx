import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { PricingSuggestionRow } from '../types/inventory';
import { apiClient, apiConfig, ApiError } from '../services/apiClient';
import { calculateMarginPercent } from '../utils/inventoryRules';
import {
  computePricingImpact,
  getSafeSelectableCloverIds,
  isRowActionable,
} from '../utils/enrichmentPricingRules';
import { BrandThumbnail } from './BrandThumbnail';

interface PricingReviewProps {
  onToast: (tone: 'success' | 'error', text: string) => void;
}

type PricingTab = 'safe' | 'flagged' | 'all' | 'no_suggestion';

function formatMoney(value: number): string {
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatSignedMoney(value: number): string {
  const abs = formatMoney(Math.abs(value));
  if (value > 0) return `+${abs}`;
  if (value < 0) return `-${abs}`;
  return abs;
}

export function PricingReview({ onToast }: PricingReviewProps) {
  const [rows, setRows] = useState<PricingSuggestionRow[]>([]);
  const [previewToken, setPreviewToken] = useState<string>('');
  const [generatedAt, setGeneratedAt] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);

  // Every Apply toggle strictly defaults OFF on load and refresh.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [staleTokenMessage, setStaleTokenMessage] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const [tab, setTab] = useState<PricingTab>('all');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  const loadPreview = useCallback(
    async (opts?: { silent?: boolean }) => {
      setLoading(true);
      try {
        const res = await apiClient.getPricingSuggestions();
        setRows(res.rows);
        setPreviewToken(res.preview_token);
        setGeneratedAt(res.generated_at);
        // Reset toggles to OFF on fresh preview so nothing applies unintentionally.
        setSelectedIds(new Set());
        setStaleTokenMessage(null);
        setConfirmOpen(false);
        if (!opts?.silent) {
          onToast('success', 'Pricing preview refreshed with a fresh verification token.');
        }
      } catch (err) {
        onToast(
          'error',
          err instanceof Error ? err.message : 'Failed to load server pricing suggestions.'
        );
      } finally {
        setLoading(false);
      }
    },
    [onToast]
  );

  useEffect(() => {
    void loadPreview({ silent: true });
  }, [loadPreview]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) {
      if (row.category) set.add(row.category);
    }
    return Array.from(set).sort();
  }, [rows]);

  const tabCounts = useMemo(() => {
    let safe = 0;
    let flagged = 0;
    let noSuggestion = 0;
    for (const row of rows) {
      if (!isRowActionable(row)) {
        noSuggestion += 1;
      } else if (row.excluded_from_bulk) {
        flagged += 1;
      } else {
        safe += 1;
      }
    }
    return { safe, flagged, all: rows.length, noSuggestion };
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (tab === 'safe' && (!isRowActionable(row) || row.excluded_from_bulk)) return false;
      if (tab === 'flagged' && (!isRowActionable(row) || !row.excluded_from_bulk)) return false;
      if (tab === 'no_suggestion' && isRowActionable(row)) return false;
      if (categoryFilter && row.category !== categoryFilter) return false;
      if (q) {
        const hay = `${row.normalized_name} ${row.brand ?? ''} ${row.vendor ?? ''} ${row.clover_id}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, tab, search, categoryFilter]);

  const impact = useMemo(
    () => computePricingImpact(rows, selectedIds),
    [rows, selectedIds]
  );

  const safeIds = useMemo(() => getSafeSelectableCloverIds(rows), [rows]);

  const toggleRow = (row: PricingSuggestionRow) => {
    if (!isRowActionable(row)) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(row.clover_id)) {
        next.delete(row.clover_id);
      } else {
        next.add(row.clover_id);
      }
      return next;
    });
  };

  const handleSelectAllSafe = () => {
    setSelectedIds(new Set(safeIds));
  };

  const handleClearToggles = () => {
    setSelectedIds(new Set());
    setConfirmOpen(false);
  };

  const handleSimulateStale = async () => {
    await apiClient.simulateStalePricingToken();
    onToast(
      'error',
      'Simulated catalog edit on server — current preview token is now stale. Try Apply to see 409 recovery.'
    );
  };

  const handleConfirmApply = async () => {
    if (impact.selectedCount === 0 || !previewToken) return;
    setApplying(true);
    try {
      const res = await apiClient.applyPricing({
        preview_token: previewToken,
        clover_ids: Array.from(selectedIds),
      });
      setConfirmOpen(false);
      onToast(
        'success',
        `Applied ${res.appliedCount} price change${res.appliedCount === 1 ? '' : 's'} (${formatSignedMoney(res.shelfValueDelta)} shelf impact).`
      );
      await loadPreview({ silent: true });
    } catch (err) {
      if (err instanceof ApiError && err.isStalePreviewToken) {
        setStaleTokenMessage(err.message);
        setConfirmOpen(false);
        onToast('error', 'Preview token is stale (HTTP 409). Refresh preview before applying.');
      } else {
        onToast('error', err instanceof Error ? err.message : 'Failed to apply pricing changes.');
      }
    } finally {
      setApplying(false);
    }
  };

  const shortToken = previewToken ? `${previewToken.slice(0, 14)}…` : '—';
  const generatedLabel = generatedAt
    ? new Date(generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '—';

  return (
    <div className="space-y-4">
      {/* Stale Preview Token Recovery Banner (HTTP 409) */}
      {staleTokenMessage && (
        <div
          role="alert"
          className="px-4 py-3.5 rounded-lg border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/60 flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex items-start gap-2.5 min-w-0">
            <ShieldAlert className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="text-xs">
              <div className="font-semibold text-red-900 dark:text-red-200">
                Stale Preview Token Rejected (HTTP 409) — No Prices Were Changed
              </div>
              <div className="mt-0.5 text-red-800 dark:text-red-300">
                {staleTokenMessage}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void loadPreview()}
            className="h-9 px-4 inline-flex items-center gap-1.5 text-xs font-semibold rounded-md bg-red-700 hover:bg-red-800 text-white cursor-pointer shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Refresh Pricing Preview</span>
          </button>
        </div>
      )}

      {/* Master Shelf-Value Impact Preview Bar */}
      <div className="grid grid-cols-2 lg:grid-cols-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg divide-y lg:divide-y-0 lg:divide-x divide-slate-200 dark:divide-slate-800">
        <div className="px-4 py-3">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Selected to Apply
          </div>
          <div className="mt-0.5 flex items-baseline gap-2">
            <span className="text-lg font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
              {impact.selectedCount}
            </span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              SKUs ({impact.totalUnitsAffected} units)
            </span>
          </div>
          {impact.flaggedSelectedCount > 0 && (
            <div className="mt-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-300">
              Includes {impact.flaggedSelectedCount} manual flagged override
              {impact.flaggedSelectedCount === 1 ? '' : 's'}
            </div>
          )}
        </div>

        <div className="px-4 py-3">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Current Shelf Value
          </div>
          <div className="mt-0.5 text-lg font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
            {formatMoney(impact.currentShelfValue)}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            Across toggled items only
          </div>
        </div>

        <div className="px-4 py-3">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Projected Shelf Value
          </div>
          <div className="mt-0.5 text-lg font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
            {formatMoney(impact.projectedShelfValue)}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            {impact.avgPercentChange !== null
              ? `Avg change ${impact.avgPercentChange > 0 ? '+' : ''}${impact.avgPercentChange.toFixed(1)}%`
              : 'Toggle items ON to preview'}
          </div>
        </div>

        <div className="px-4 py-3">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Net Shelf-Value Impact
          </div>
          <div
            className={`mt-0.5 text-lg font-mono tabular-nums font-semibold ${
              impact.shelfValueDelta > 0
                ? 'text-emerald-700 dark:text-emerald-400'
                : impact.shelfValueDelta < 0
                  ? 'text-red-700 dark:text-red-400'
                  : 'text-slate-900 dark:text-slate-100'
            }`}
          >
            {formatSignedMoney(impact.shelfValueDelta)}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            Original prices untouched until Apply
          </div>
        </div>

        <div className="px-4 py-3 col-span-2 lg:col-span-1 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Preview Token
            </div>
            <div
              title={previewToken}
              className={`mt-0.5 text-xs font-mono font-semibold truncate ${
                staleTokenMessage
                  ? 'text-red-700 dark:text-red-400'
                  : 'text-slate-800 dark:text-slate-200'
              }`}
            >
              {staleTokenMessage ? 'STALE · REFRESH' : shortToken}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
              Snapshot {generatedLabel}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void loadPreview()}
            title="Refresh server suggestions and issue a new preview token"
            className="h-8 px-2.5 inline-flex items-center gap-1 text-xs font-medium rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Controls Toolbar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Segment Filter Tabs */}
          <div
            role="tablist"
            aria-label="Pricing review row filter"
            className="inline-flex bg-slate-100 dark:bg-slate-950 p-1 rounded-md border border-slate-200 dark:border-slate-800"
          >
            {[
              { id: 'all' as const, label: `All (${tabCounts.all})` },
              { id: 'safe' as const, label: `Safe Changes (${tabCounts.safe})` },
              { id: 'flagged' as const, label: `Flagged / Excluded (${tabCounts.flagged})` },
              { id: 'no_suggestion' as const, label: `No Suggestion (${tabCounts.noSuggestion})` },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                onClick={() => setTab(item.id)}
                className={`h-8 px-3 text-xs font-semibold rounded transition-colors whitespace-nowrap cursor-pointer ${
                  tab === item.id
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {/* Bulk Guardrail Controls */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={safeIds.length === 0 || Boolean(staleTokenMessage)}
              onClick={handleSelectAllSafe}
              className="h-8 px-3 inline-flex items-center gap-1.5 text-xs font-semibold rounded-md border border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/50 text-blue-800 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-950 disabled:opacity-40 cursor-pointer"
            >
              <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Select All Safe Changes ({safeIds.length})</span>
            </button>
            <button
              type="button"
              disabled={selectedIds.size === 0}
              onClick={handleClearToggles}
              className="h-8 px-3 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
            >
              Clear Toggles
            </button>
            {apiConfig.useMockApi && (
              <button
                type="button"
                onClick={() => void handleSimulateStale()}
                className="h-8 px-2.5 text-[11px] font-medium rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/30 text-amber-900 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-950/60 cursor-pointer"
              >
                Simulate Stale Token
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex-1 min-w-[220px]">
            <Search
              className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter pricing rows by item name, brand, vendor, or Clover ID..."
              aria-label="Filter pricing suggestions"
              className="w-full h-9 pl-8 pr-3 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <select
            aria-label="Filter pricing by category"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="h-9 px-3 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="">All Categories</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>

          <div className="text-[11px] text-slate-500 dark:text-slate-400 ml-auto">
            Suggested prices come from server rules only — flagged rows excluded from bulk select.
          </div>
        </div>
      </div>

      {/* Pricing Review Ledger Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs min-w-[960px]">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 font-semibold text-slate-600 dark:text-slate-400">
                <th className="px-3 py-2.5 w-16 text-center">Apply</th>
                <th className="px-3 py-2.5">Item / Brand / Vendor</th>
                <th className="px-3 py-2.5 w-24 text-right">Current</th>
                <th className="px-3 py-2.5 w-24 text-right">Suggested</th>
                <th className="px-3 py-2.5 w-20 text-right">% Diff</th>
                <th className="px-3 py-2.5 w-28 text-right">Cost · Proj. Margin</th>
                <th className="px-3 py-2.5 w-28 text-right">Shelf Impact</th>
                <th className="px-3 py-2.5 w-48">Guardrails &amp; Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                    Loading server pricing suggestions...
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                    No pricing rows match your current filter.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => {
                  const actionable = isRowActionable(row);
                  const isFlaggedActionable = actionable && row.excluded_from_bulk;
                  const isOn = selectedIds.has(row.clover_id);
                  const projectedMargin =
                    row.suggested_price !== null
                      ? calculateMarginPercent(row.suggested_price, row.cost)
                      : calculateMarginPercent(row.current_price, row.cost);
                  const rowShelfDelta =
                    row.suggested_price !== null
                      ? (row.suggested_price - row.current_price) * Math.max(0, row.quantity)
                      : null;
                  const isDrop =
                    row.suggested_price !== null && row.suggested_price < row.current_price;
                  const isLargeSwing =
                    row.percent_change !== null && Math.abs(row.percent_change) > 20;

                  return (
                    <tr
                      key={row.clover_id}
                      className={`transition-colors ${
                        isFlaggedActionable
                          ? 'bg-amber-50/55 dark:bg-amber-950/20 hover:bg-amber-50/90 dark:hover:bg-amber-950/30'
                          : isOn
                            ? 'bg-blue-50/55 dark:bg-blue-950/25'
                            : !actionable
                              ? 'bg-slate-50/50 dark:bg-slate-950/35 text-slate-500 dark:text-slate-400'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      {/* Apply Toggle (Defaults OFF) */}
                      <td className="px-3 py-2.5 text-center">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={isOn}
                          aria-label={`Apply suggested price for ${row.normalized_name}`}
                          disabled={!actionable}
                          onClick={() => toggleRow(row)}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-1 dark:focus:ring-offset-slate-900 ${
                            !actionable
                              ? 'bg-slate-200 dark:bg-slate-800 opacity-40 cursor-not-allowed'
                              : isOn
                                ? isFlaggedActionable
                                  ? 'bg-amber-600 cursor-pointer'
                                  : 'bg-blue-700 dark:bg-blue-600 cursor-pointer'
                                : 'bg-slate-300 dark:bg-slate-700 cursor-pointer'
                          }`}
                        >
                          <span
                            className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-xs ${
                              isOn ? 'translate-x-[18px]' : 'translate-x-[3px]'
                            }`}
                          />
                        </button>
                      </td>

                      {/* Item */}
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <BrandThumbnail
                            brand={row.brand ?? row.normalized_name}
                            itemName={row.normalized_name}
                            logoUrl={row.logo_url ?? null}
                            size="sm"
                          />
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                              {row.normalized_name}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                              {row.category || 'Catalog'} · {row.vendor || 'No vendor'} ·{' '}
                              <span className="font-mono tabular-nums">{row.quantity} on hand</span>
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Current Price */}
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                        {formatMoney(row.current_price)}
                      </td>

                      {/* Suggested Price (Server-Authoritative Only) */}
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                        {row.suggested_price !== null ? formatMoney(row.suggested_price) : '—'}
                      </td>

                      {/* % Change */}
                      <td
                        className={`px-3 py-2.5 text-right font-mono tabular-nums font-semibold ${
                          row.percent_change === null
                            ? 'text-slate-400 dark:text-slate-500'
                            : isDrop
                              ? 'text-red-700 dark:text-red-400'
                              : isLargeSwing
                                ? 'text-amber-800 dark:text-amber-300'
                                : 'text-emerald-700 dark:text-emerald-400'
                        }`}
                      >
                        {row.percent_change !== null
                          ? `${row.percent_change > 0 ? '+' : ''}${row.percent_change.toFixed(1)}%`
                          : '—'}
                      </td>

                      {/* Cost & Projected Margin */}
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                        {row.cost !== null ? (
                          <div>
                            <div className="text-slate-800 dark:text-slate-200">
                              {formatMoney(row.cost)}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              {projectedMargin !== null ? `${projectedMargin.toFixed(1)}% GM` : '—'}
                            </div>
                          </div>
                        ) : (
                          <span className="text-amber-700 dark:text-amber-400">— Missing</span>
                        )}
                      </td>

                      {/* Per-Row Shelf Impact */}
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                        {rowShelfDelta !== null ? (
                          <span
                            className={
                              rowShelfDelta > 0
                                ? 'text-emerald-700 dark:text-emerald-400 font-medium'
                                : rowShelfDelta < 0
                                  ? 'text-red-700 dark:text-red-400 font-medium'
                                  : 'text-slate-500'
                            }
                          >
                            {formatSignedMoney(rowShelfDelta)}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      {/* Guardrails & Status */}
                      <td className="px-3 py-2.5">
                        {!actionable ? (
                          <span className="text-[11px] text-slate-500 dark:text-slate-400">
                            {row.exclusion_reasons?.join(' · ') || 'No server suggestion'}
                          </span>
                        ) : row.excluded_from_bulk ? (
                          <div className="space-y-1">
                            <div className="flex flex-wrap gap-1">
                              {(row.exclusion_reasons ?? []).map((reason) => (
                                <span
                                  key={reason}
                                  className={`px-1.5 py-0.5 text-[10px] font-mono font-semibold rounded border whitespace-nowrap ${
                                    reason === 'Price drop'
                                      ? 'text-red-800 dark:text-red-300 bg-red-50 dark:bg-red-950/60 border-red-200 dark:border-red-900'
                                      : 'text-amber-900 dark:text-amber-300 bg-amber-100/70 dark:bg-amber-950/60 border-amber-300 dark:border-amber-800'
                                  }`}
                                >
                                  {reason}
                                </span>
                              ))}
                            </div>
                            <div className="text-[10px] text-amber-800 dark:text-amber-300 font-medium">
                              Excluded from bulk apply
                            </div>
                          </div>
                        ) : (
                          <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                            Safe · Bulk eligible
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Sticky Bottom Preview & Apply Bar */}
        <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-600 dark:text-slate-400">
            {impact.selectedCount === 0 ? (
              <span>
                All toggles start <strong>OFF</strong>. Toggle rows individually or click{' '}
                <strong>Select All Safe Changes</strong> to preview impact.
              </span>
            ) : (
              <span>
                Ready to update <strong className="text-slate-900 dark:text-slate-100">{impact.selectedCount} SKU{impact.selectedCount === 1 ? '' : 's'}</strong>{' '}
                ({impact.totalUnitsAffected} units · net shelf delta{' '}
                <strong
                  className={
                    impact.shelfValueDelta >= 0
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-red-700 dark:text-red-400'
                  }
                >
                  {formatSignedMoney(impact.shelfValueDelta)}
                </strong>
                ) using token <span className="font-mono">{shortToken}</span>.
              </span>
            )}
          </div>

          <button
            type="button"
            disabled={impact.selectedCount === 0 || applying || Boolean(staleTokenMessage)}
            onClick={() => setConfirmOpen(true)}
            className="h-10 px-5 inline-flex items-center gap-2 text-xs font-semibold rounded-md bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white transition-colors disabled:opacity-40 cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
            <span>Apply Approved Prices ({impact.selectedCount})</span>
          </button>
        </div>
      </div>

      {/* Explicit Confirmation Modal Before Writing Prices */}
      {confirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-pricing-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60"
        >
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
              <h2
                id="confirm-pricing-title"
                className="text-sm font-display font-bold text-slate-900 dark:text-slate-100"
              >
                Confirm Shelf Price Updates
              </h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Submitting <span className="font-mono">POST /api/pricing/apply</span> with preview token{' '}
                <span className="font-mono text-slate-700 dark:text-slate-300">{shortToken}</span>.
              </p>
            </div>

            <div className="p-5 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Approved SKUs</div>
                  <div className="mt-0.5 text-base font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                    {impact.selectedCount}
                  </div>
                </div>
                <div className="p-3 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Net Shelf Impact</div>
                  <div
                    className={`mt-0.5 text-base font-mono tabular-nums font-semibold ${
                      impact.shelfValueDelta >= 0
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-red-700 dark:text-red-400'
                    }`}
                  >
                    {formatSignedMoney(impact.shelfValueDelta)}
                  </div>
                </div>
              </div>

              {impact.flaggedSelectedCount > 0 && (
                <div className="p-3 rounded border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 flex items-start gap-2 text-amber-900 dark:text-amber-200">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                  <div>
                    You manually toggled ON <strong>{impact.flaggedSelectedCount} flagged row{impact.flaggedSelectedCount === 1 ? '' : 's'}</strong>{' '}
                    (price drop, &gt;20% change, or flagged SKU). Confirm you intend to apply these overrides.
                  </div>
                </div>
              )}
            </div>

            <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={applying}
                onClick={() => setConfirmOpen(false)}
                className="h-9 px-3.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={applying}
                onClick={() => void handleConfirmApply()}
                className="h-9 px-4 inline-flex items-center gap-1.5 text-xs font-semibold rounded-md bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white disabled:opacity-50 cursor-pointer"
              >
                <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{applying ? 'Applying...' : 'Confirm & Apply Prices'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
