import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Database,
  DownloadCloud,
  RefreshCw,
  Tag,
  TrendingUp,
  Upload,
} from 'lucide-react';
import {
  AnalyticsSummaryResponse,
  CanonicalItem,
} from '../types/inventory';
import { apiClient, apiConfig } from '../services/apiClient';
import { buildCategoryMarginBreakdown } from '../utils/phase4Engines';
import { BrandThumbnail } from './BrandThumbnail';

interface SalesAnalyticsProps {
  onNavigateImport: () => void;
  onNavigatePricing: () => void;
  onNavigateInventory: () => void;
  onToast: (tone: 'success' | 'error', text: string) => void;
}

function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toFixed(1)}%`;
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return 'Not synced yet';
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function SalesAnalytics({
  onNavigateImport,
  onNavigatePricing,
  onNavigateInventory,
  onToast,
}: SalesAnalyticsProps) {
  const [analytics, setAnalytics] = useState<AnalyticsSummaryResponse | null>(null);
  const [items, setItems] = useState<CanonicalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingSample, setLoadingSample] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryRes, catalogItems] = await Promise.all([
        apiClient.getAnalyticsSummary(),
        apiClient.getAllItemsForMatching(),
      ]);
      setAnalytics(summaryRes);
      setItems(catalogItems);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load sales analytics.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleLoadSampleSales = async () => {
    setLoadingSample(true);
    try {
      const updated = await apiClient.loadSampleSalesExport();
      setAnalytics(updated);
      onToast(
        'success',
        `Loaded sample Clover Sales CSV (${updated.units_sold.toLocaleString()} units · ${formatMoney(updated.total_revenue)}).`
      );
    } catch (err) {
      onToast(
        'error',
        err instanceof Error ? err.message : 'Failed to load sample Clover sales export.'
      );
    } finally {
      setLoadingSample(false);
    }
  };

  const itemById = useMemo(
    () => new Map(items.map((item) => [item.clover_id, item])),
    [items]
  );

  const categoryBreakdown = useMemo(() => {
    if (!analytics) return [];
    return buildCategoryMarginBreakdown(items, analytics);
  }, [items, analytics]);

  const maxCategoryRevenue = useMemo(
    () => Math.max(1, ...categoryBreakdown.map((row) => row.revenue)),
    [categoryBreakdown]
  );

  const hasSalesData = analytics !== null && analytics.sales_source !== 'none';

  const sourceLabel =
    analytics?.sales_source === 'clover_export'
      ? 'Clover CSV Export'
      : analytics?.sales_source === 'clover_api'
        ? 'Clover API'
        : 'No Sales Data Loaded';

  return (
    <div className="space-y-4">
      {/* Header & Sales Adapter Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-5 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-medium text-slate-700 dark:text-slate-300">Sales Source:</span>
            <span
              data-testid="analytics-sales-source"
              className={`font-semibold ${
                hasSalesData
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-slate-700 dark:text-slate-300'
              }`}
            >
              {sourceLabel}
            </span>
            {analytics?.source_filename && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-[11px] truncate max-w-[260px]">
                  {analytics.source_filename}
                </span>
              </>
            )}
            {analytics?.last_synced_at && (
              <>
                <span aria-hidden="true">·</span>
                <span>Updated {formatTimestamp(analytics.last_synced_at)}</span>
              </>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Works directly from Clover Sales CSV exports — no Clover API approval required. Margins only compute from verified vendor costs.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onNavigateImport}
            className="h-10 px-3.5 inline-flex items-center gap-2 text-xs font-semibold rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Import Sales CSV</span>
          </button>
          <button
            type="button"
            onClick={() => void loadData()}
            disabled={loading}
            aria-label="Refresh analytics"
            className="h-10 px-3 inline-flex items-center gap-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-60 transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>Refresh</span>
          </button>
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

      {/* 4-KPI Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-4 py-3.5">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Net Sales</div>
          <div
            data-testid="kpi-net-sales"
            className="mt-1 text-xl font-display font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100"
          >
            {loading ? '…' : formatMoney(analytics?.total_revenue ?? 0)}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            {hasSalesData ? 'Matched catalog revenue' : 'Awaiting sales CSV'}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-4 py-3.5">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Units Sold</div>
          <div
            data-testid="kpi-units-sold"
            className="mt-1 text-xl font-display font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100"
          >
            {loading ? '…' : (analytics?.units_sold ?? 0).toLocaleString()}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            {hasSalesData ? 'Across reported period' : '0 units imported'}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-4 py-3.5">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Gross Margin</div>
          <div
            data-testid="kpi-gross-margin"
            className="mt-1 text-xl font-display font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100"
          >
            {loading ? '…' : formatPercent(analytics?.gross_margin_pct)}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            {analytics?.gross_margin_pct !== null && analytics?.gross_margin_pct !== undefined
              ? 'Weighted by costed sales'
              : 'Requires sales + vendor cost'}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-4 py-3.5">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Active SKUs Sold
          </div>
          <div
            data-testid="kpi-active-skus"
            className="mt-1 text-xl font-display font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100"
          >
            {loading ? '…' : (analytics?.top_sellers.length ?? 0).toLocaleString()}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            of {items.length.toLocaleString()} catalog items
          </div>
        </div>
      </div>

      {/* Empty State when no sales data is loaded */}
      {!loading && !hasSalesData && (
        <div
          data-testid="analytics-empty-state"
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 flex flex-col md:flex-row md:items-center justify-between gap-5"
        >
          <div className="space-y-1.5 max-w-2xl">
            <div className="flex items-center gap-2 text-slate-900 dark:text-slate-100">
              <Database className="w-4 h-4 text-slate-500 dark:text-slate-400" aria-hidden="true" />
              <h2 className="text-base font-display font-bold">No Sales Report Loaded Yet</h2>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Export your Item Sales CSV from Clover Dashboard and drop it into the Import tab to unlock Top Sellers, Dead Stock alerts, and real gross margins. When Clover API access is enabled later, this screen switches automatically with no workflow change.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {apiConfig.useMockApi && (
              <button
                type="button"
                disabled={loadingSample}
                onClick={() => void handleLoadSampleSales()}
                data-testid="load-sample-sales-btn"
                className="h-10 px-4 inline-flex items-center gap-2 text-xs font-semibold rounded-md bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white disabled:opacity-60 transition-colors whitespace-nowrap cursor-pointer"
              >
                <DownloadCloud className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{loadingSample ? 'Loading Sample…' : 'Try Sample 30-Day Sales CSV'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onNavigateImport}
              className="h-10 px-4 inline-flex items-center gap-2 text-xs font-semibold rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap cursor-pointer"
            >
              <span>Go to Import Workbench</span>
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {/* Populated Top Sellers & Dead Stock */}
      {!loading && hasSalesData && analytics && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          {/* Top Sellers Table */}
          <section className="xl:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-display font-bold text-slate-900 dark:text-slate-100">
                  Top Sellers by Revenue
                </h2>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Ranked by matched net revenue · Blank margin indicates missing vendor cost
                </p>
              </div>
              <TrendingUp className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 text-slate-500 dark:text-slate-400">
                    <th className="py-2.5 px-4 font-semibold">Item</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Units</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Revenue</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Shelf Price</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Margin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {analytics.top_sellers.map((row) => {
                    const matched = itemById.get(row.clover_id);
                    return (
                      <tr
                        key={row.clover_id}
                        className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                      >
                        <td className="py-2.5 px-4">
                          <div className="flex items-center gap-2.5 min-w-[200px]">
                            <BrandThumbnail
                              logoUrl={matched?.logo_url ?? null}
                              brand={matched?.brand ?? ''}
                              itemName={row.normalized_name}
                              size="sm"
                            />
                            <div className="min-w-0">
                              <div className="font-semibold text-slate-900 dark:text-slate-100 truncate max-w-[260px]">
                                {row.normalized_name}
                              </div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                {matched?.category ?? 'Catalog'} · {matched?.vendor ?? 'No vendor'}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                          {row.units_sold.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                          {formatMoney(row.revenue)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                          {matched ? formatMoney(matched.price) : '—'}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                          {row.margin_pct !== null ? (
                            <span
                              className={
                                row.margin_pct >= 30
                                  ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                                  : 'text-slate-800 dark:text-slate-200'
                              }
                            >
                              {formatPercent(row.margin_pct)}
                            </span>
                          ) : (
                            <span className="text-amber-700 dark:text-amber-400" title="Vendor cost missing">
                              No cost
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Dead Stock / Zero-Sale Items */}
          <section className="xl:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden flex flex-col">
            <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-display font-bold text-slate-900 dark:text-slate-100">
                  Dead Stock &amp; Slow Movers
                </h2>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  In-stock SKUs with zero units sold in this report
                </p>
              </div>
              <button
                type="button"
                onClick={onNavigatePricing}
                className="h-8 px-2.5 inline-flex items-center gap-1.5 text-[11px] font-semibold rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap cursor-pointer"
              >
                <Tag className="w-3 h-3" aria-hidden="true" />
                <span>Review Prices</span>
              </button>
            </div>

            {analytics.dead_stock.length === 0 ? (
              <div className="p-6 text-xs text-slate-500 dark:text-slate-400">
                Every stocked catalog item recorded sales during this period.
              </div>
            ) : (
              <div className="overflow-x-auto flex-1">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 text-slate-500 dark:text-slate-400">
                      <th className="py-2.5 px-4 font-semibold">Item</th>
                      <th className="py-2.5 px-3 font-semibold text-right">On Hand</th>
                      <th className="py-2.5 px-4 font-semibold text-right">Idle Days</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {analytics.dead_stock.map((row) => {
                      const matched = itemById.get(row.clover_id);
                      return (
                        <tr
                          key={row.clover_id}
                          className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                        >
                          <td className="py-2.5 px-4">
                            <div className="font-medium text-slate-900 dark:text-slate-100 truncate max-w-[210px]">
                              {row.normalized_name}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              {matched?.category ?? 'Catalog'} · {matched ? formatMoney(matched.price) : '—'}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                            {row.quantity}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums text-amber-700 dark:text-amber-400 font-medium">
                            {row.days_since_sale}d+
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {/* Category Margin & Catalog Breakdown (always visible using real costs) */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-display font-bold text-slate-900 dark:text-slate-100">
              Category Margin &amp; Sales Breakdown
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Catalog margin averages computed strictly from SKUs with verified vendor cost
            </p>
          </div>
          <button
            type="button"
            onClick={onNavigateInventory}
            className="text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
          >
            Inspect Catalog Costs
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 text-slate-500 dark:text-slate-400">
                <th className="py-2.5 px-4 font-semibold">Category</th>
                <th className="py-2.5 px-3 font-semibold text-right">SKUs (Costed)</th>
                <th className="py-2.5 px-3 font-semibold text-right">Avg Catalog Margin</th>
                <th className="py-2.5 px-3 font-semibold text-right">Units Sold</th>
                <th className="py-2.5 px-4 font-semibold text-right">Sales Revenue</th>
                <th className="py-2.5 px-4 font-semibold w-44 hidden sm:table-cell">Revenue Share</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {categoryBreakdown.map((cat) => {
                const barWidth =
                  cat.revenue > 0 ? Math.max(4, Math.round((cat.revenue / maxCategoryRevenue) * 100)) : 0;
                return (
                  <tr
                    key={cat.category}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                  >
                    <td className="py-2.5 px-4 font-semibold text-slate-900 dark:text-slate-100">
                      {cat.category}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {cat.skuCount}{' '}
                      <span className="text-slate-400 dark:text-slate-500">
                        ({cat.costedSkuCount})
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      {cat.avgMarginPct !== null ? (
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {formatPercent(cat.avgMarginPct)}
                        </span>
                      ) : (
                        <span className="text-slate-400 dark:text-slate-500">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {cat.unitsSold.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                      {formatMoney(cat.revenue)}
                    </td>
                    <td className="py-2.5 px-4 hidden sm:table-cell">
                      <div className="h-2 w-full rounded bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div
                          className="h-full bg-blue-700 dark:bg-blue-500 transition-all"
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
