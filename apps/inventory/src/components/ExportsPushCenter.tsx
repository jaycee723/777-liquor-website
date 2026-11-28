import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Globe,
  RefreshCw,
  Search,
  Sparkles,
  UploadCloud,
} from 'lucide-react';
import { CanonicalItem, CoolerDoorPushResponse } from '../types/inventory';
import { apiClient } from '../services/apiClient';
import {
  computeToastPreflight,
  itemToToastRow,
  TOAST_RETAIL_COLUMNS,
} from '../utils/phase4Engines';
import { BrandThumbnail } from './BrandThumbnail';

interface ExportsPushCenterProps {
  onNavigateEnrichment: () => void;
  onToast: (tone: 'success' | 'error', text: string) => void;
}

type ExportTab = 'toast' | 'cooler_door';

const PREVIEW_TOAST_COLUMNS = [
  'Item Name',
  'category group',
  'Category',
  'Price',
  'Cost',
  'Barcode',
  'brand',
  'supplier',
  'inventory quantity',
  'receiving units',
  'receiving unit quantities',
] as const;

function triggerBrowserDownload(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return 'Never published';
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function ExportsPushCenter({
  onNavigateEnrichment,
  onToast,
}: ExportsPushCenterProps) {
  const [activeTab, setActiveTab] = useState<ExportTab>('toast');
  const [items, setItems] = useState<CanonicalItem[]>([]);
  const [coolerPreview, setCoolerPreview] = useState<CoolerDoorPushResponse | null>(null);
  const [lastPush, setLastPush] = useState<CoolerDoorPushResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Toast Export controls
  const [excludeFlagged, setExcludeFlagged] = useState(false);
  const [exportingToast, setExportingToast] = useState(false);
  const [exportingFull, setExportingFull] = useState(false);
  const [showAll26Cols, setShowAll26Cols] = useState(false);

  // Cooler Door controls
  const [pushingCooler, setPushingCooler] = useState(false);
  const [coolerCategoryFilter, setCoolerCategoryFilter] = useState<string>('All');
  const [coolerSearch, setCoolerSearch] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [catalogItems, preview, previousPush] = await Promise.all([
        apiClient.getAllItemsForMatching(),
        apiClient.previewCoolerDoorCatalog(),
        apiClient.getLastCoolerDoorPush(),
      ]);
      setItems(catalogItems);
      setCoolerPreview(preview);
      setLastPush(previousPush);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load export preview data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const toastEligibleItems = useMemo(
    () => (excludeFlagged ? items.filter((item) => item.flags.length === 0) : items),
    [items, excludeFlagged]
  );

  const preflight = useMemo(() => computeToastPreflight(items), [items]);

  const toastPreviewRows = useMemo(
    () => toastEligibleItems.slice(0, 10).map((item) => ({ id: item.clover_id, row: itemToToastRow(item) })),
    [toastEligibleItems]
  );

  const visibleToastColumns = showAll26Cols ? TOAST_RETAIL_COLUMNS : PREVIEW_TOAST_COLUMNS;

  const filteredCoolerItems = useMemo(() => {
    const list = coolerPreview?.catalog.items ?? [];
    const q = coolerSearch.trim().toLowerCase();
    return list.filter((item) => {
      if (coolerCategoryFilter !== 'All' && item.category !== coolerCategoryFilter) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.brand.toLowerCase().includes(q) ||
        item.size.toLowerCase().includes(q)
      );
    });
  }, [coolerPreview, coolerCategoryFilter, coolerSearch]);

  const handleDownloadToastCsv = async () => {
    setExportingToast(true);
    try {
      const result = await apiClient.exportToastCatalog({ excludeFlagged });
      triggerBrowserDownload(result.csv, result.filename, 'text/csv;charset=utf-8;');
      onToast(
        'success',
        `Downloaded ${result.filename} (${result.rowCount} items · ${result.columns.length} Toast Retail columns).`
      );
    } catch (err) {
      onToast(
        'error',
        err instanceof Error ? err.message : 'Failed to generate Toast Retail CSV.'
      );
    } finally {
      setExportingToast(false);
    }
  };

  const handleDownloadFullCsv = async () => {
    setExportingFull(true);
    try {
      const result = await apiClient.exportFullCatalogSpreadsheet();
      triggerBrowserDownload(result.csv, result.filename, 'text/csv;charset=utf-8;');
      onToast('success', `Downloaded full backup ${result.filename} (${result.rowCount} items).`);
    } catch (err) {
      onToast(
        'error',
        err instanceof Error ? err.message : 'Failed to generate full inventory CSV.'
      );
    } finally {
      setExportingFull(false);
    }
  };

  const handlePushCoolerDoor = async () => {
    setPushingCooler(true);
    try {
      const pushed = await apiClient.pushCoolerDoor();
      setLastPush(pushed);
      setCoolerPreview(pushed);
      onToast(
        'success',
        `Published ${pushed.publishedCount} alcohol SKUs to the Cooler Door catalog (non-alcohol excluded).`
      );
    } catch (err) {
      onToast(
        'error',
        err instanceof Error ? err.message : 'Failed to publish Cooler Door catalog.'
      );
    } finally {
      setPushingCooler(false);
    }
  };

  const handleDownloadCoolerJson = () => {
    if (!coolerPreview) return;
    const json = JSON.stringify(coolerPreview.catalog, null, 2);
    const filename = `777_Cooler_Door_Catalog_${new Date().toISOString().slice(0, 10)}.json`;
    triggerBrowserDownload(json, filename, 'application/json;charset=utf-8;');
    onToast(
      'success',
      `Downloaded ${filename} (${coolerPreview.publishedCount} alcohol items).`
    );
  };

  return (
    <div className="space-y-4">
      {/* Top Mode Switcher */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div
          className="inline-flex rounded-md border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-50 dark:bg-slate-950"
          role="tablist"
          aria-label="Export destination"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'toast'}
            data-testid="tab-toast-export"
            onClick={() => setActiveTab('toast')}
            className={`h-9 px-3.5 inline-flex items-center gap-2 text-xs font-semibold rounded transition-colors cursor-pointer ${
              activeTab === 'toast'
                ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            <FileSpreadsheet className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Toast Retail &amp; CSV Backups</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'cooler_door'}
            data-testid="tab-cooler-door"
            onClick={() => setActiveTab('cooler_door')}
            className={`h-9 px-3.5 inline-flex items-center gap-2 text-xs font-semibold rounded transition-colors cursor-pointer ${
              activeTab === 'cooler_door'
                ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            <Globe className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Cooler Door Push (777liquor.com)</span>
          </button>
        </div>

        <button
          type="button"
          onClick={() => void loadData()}
          disabled={loading}
          className="h-9 px-3 inline-flex items-center gap-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-60 transition-colors cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          <span>Refresh Catalog</span>
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="px-4 py-3 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50 text-xs text-red-800 dark:text-red-300"
        >
          {error}
        </div>
      )}

      {/* TAB 1: TOAST RETAIL EXPORT & FULL CSV */}
      {activeTab === 'toast' && (
        <div className="space-y-4">
          {/* Pre-flight Validation Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-4 py-3.5">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Catalog SKUs
              </div>
              <div className="mt-1 text-xl font-display font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {loading ? '…' : preflight.totalItems}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                {toastEligibleItems.length} included in export
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-4 py-3.5">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Toast Ready
              </div>
              <div className="mt-1 text-xl font-display font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                {loading ? '…' : preflight.readyCount}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                Cost + UPC + zero flags
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-4 py-3.5">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Missing Cost
              </div>
              <div className="mt-1 text-xl font-display font-bold font-mono tabular-nums text-amber-700 dark:text-amber-400">
                {loading ? '…' : preflight.missingCostCount}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                Exported blank (never $0.00)
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-4 py-3.5">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Flagged SKUs
              </div>
              <div className="mt-1 text-xl font-display font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {loading ? '…' : preflight.flaggedCount}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                {preflight.missingUpcCount} missing UPC
              </div>
            </div>
          </div>

          {/* Export Action Card */}
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="space-y-1 max-w-2xl">
                <h2 className="text-base font-display font-bold text-slate-900 dark:text-slate-100">
                  Toast Retail Template CSV (Exact 26 Columns)
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Matches Toast&apos;s official Retail import schema verbatim: <span className="font-mono">category group = Retail</span>, derived Toast categories (<span className="font-mono">BEER</span>, <span className="font-mono">RTD (READY TO DRINK)</span>, <span className="font-mono">LIQUOR/SPIRITS</span>, <span className="font-mono">WINE</span>, <span className="font-mono">DRINKS</span>), formatted <span className="font-mono">$12.99</span> prices, and <span className="font-mono">Case</span> receiving quantities.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                <button
                  type="button"
                  disabled={exportingToast || loading || toastEligibleItems.length === 0}
                  onClick={() => void handleDownloadToastCsv()}
                  data-testid="download-toast-csv-btn"
                  className="h-10 px-4 inline-flex items-center gap-2 text-xs font-semibold rounded-md bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white disabled:opacity-60 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>
                    {exportingToast
                      ? 'Generating CSV…'
                      : `Download Toast CSV (${toastEligibleItems.length})`}
                  </span>
                </button>

                <button
                  type="button"
                  disabled={exportingFull || loading || items.length === 0}
                  onClick={() => void handleDownloadFullCsv()}
                  data-testid="download-full-csv-btn"
                  className="h-10 px-3.5 inline-flex items-center gap-2 text-xs font-semibold rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-60 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{exportingFull ? 'Exporting…' : 'Full Canonical Backup CSV'}</span>
                </button>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4 text-xs">
              <label className="inline-flex items-center gap-2.5 text-slate-700 dark:text-slate-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={excludeFlagged}
                  onChange={(e) => setExcludeFlagged(e.target.checked)}
                  data-testid="exclude-flagged-checkbox"
                  className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-blue-700 focus:ring-blue-600"
                />
                <span>
                  Exclude flagged SKUs from Toast export ({preflight.flaggedCount} currently flagged)
                </span>
              </label>

              <button
                type="button"
                onClick={() => setShowAll26Cols((v) => !v)}
                className="text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
              >
                {showAll26Cols
                  ? 'Show Key 11 Columns in Preview'
                  : 'Inspect All 26 Toast Columns'}
              </button>
            </div>
          </section>

          {/* Live Toast Preview Table */}
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-display font-bold text-slate-900 dark:text-slate-100">
                  Toast Template Row Preview
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Showing first {toastPreviewRows.length} of {toastEligibleItems.length} export rows ·{' '}
                  {visibleToastColumns.length} of {TOAST_RETAIL_COLUMNS.length} columns displayed
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs whitespace-nowrap">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 text-slate-500 dark:text-slate-400">
                    {visibleToastColumns.map((col) => (
                      <th key={col} className="py-2.5 px-3 font-mono text-[11px] font-semibold">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {toastPreviewRows.map(({ id, row }) => (
                    <tr
                      key={id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      {visibleToastColumns.map((col) => {
                        const val = row[col];
                        const isMoney = col === 'Price' || col === 'Cost';
                        return (
                          <td
                            key={col}
                            className={`py-2 px-3 ${
                              col === 'Item Name'
                                ? 'font-semibold text-slate-900 dark:text-slate-100'
                                : isMoney || col === 'Barcode' || col === 'inventory quantity'
                                  ? 'font-mono tabular-nums text-slate-800 dark:text-slate-200'
                                  : 'text-slate-600 dark:text-slate-400'
                            }`}
                          >
                            {val === '' || val === undefined ? (
                              <span className="text-slate-300 dark:text-slate-700">—</span>
                            ) : (
                              String(val)
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* TAB 2: COOLER DOOR WEBSITE PUSH */}
      {activeTab === 'cooler_door' && (
        <div className="space-y-4">
          {/* Alcohol-Only Category Strip */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {(['Beer', 'RTD', 'Spirits', 'Wine'] as const).map((cat) => (
              <div
                key={cat}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-4 py-3"
              >
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{cat}</div>
                <div className="mt-1 text-xl font-display font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {loading ? '…' : coolerPreview?.by_category[cat] ?? 0}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Included</div>
              </div>
            ))}

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-4 py-3 col-span-2 md:col-span-1">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Non-Alcohol Excluded
              </div>
              <div
                data-testid="cooler-excluded-count"
                className="mt-1 text-xl font-display font-bold font-mono tabular-nums text-slate-700 dark:text-slate-300"
              >
                {loading ? '…' : coolerPreview?.excludedCount ?? 0}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                NA · Grocery · Gift
              </div>
            </div>
          </div>

          {/* Publish Action Card */}
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="space-y-1 max-w-2xl">
                <h2 className="text-base font-display font-bold text-slate-900 dark:text-slate-100">
                  Cooler Door Public Catalog (Alcohol Only)
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Publishes verified Beer, RTD, Spirits, and Wine listings (name, size, authoritative shelf price, and brand logo) to <span className="font-mono">777liquor.com</span>. Non-alcoholic drinks, grocery snacks, and gift items are automatically excluded.
                </p>
                <div
                  data-testid="cooler-last-published"
                  className="pt-1 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400"
                >
                  <CheckCircle2
                    className={`w-3.5 h-3.5 ${
                      lastPush
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-slate-400 dark:text-slate-500'
                    }`}
                    aria-hidden="true"
                  />
                  <span>
                    Last published:{' '}
                    <strong className="font-semibold text-slate-900 dark:text-slate-100">
                      {lastPush
                        ? `${formatDateTime(lastPush.publishedAt)} (${lastPush.publishedCount} SKUs)`
                        : 'Not published in this session'}
                    </strong>
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                <button
                  type="button"
                  disabled={pushingCooler || loading || !coolerPreview}
                  onClick={() => void handlePushCoolerDoor()}
                  data-testid="push-cooler-door-btn"
                  className="h-10 px-4 inline-flex items-center gap-2 text-xs font-semibold rounded-md bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white disabled:opacity-60 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <UploadCloud className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>
                    {pushingCooler
                      ? 'Publishing…'
                      : `Push to Cooler Door (${coolerPreview?.publishedCount ?? 0} SKUs)`}
                  </span>
                </button>

                <button
                  type="button"
                  disabled={!coolerPreview}
                  onClick={handleDownloadCoolerJson}
                  className="h-10 px-3.5 inline-flex items-center gap-2 text-xs font-semibold rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-60 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Download JSON</span>
                </button>
              </div>
            </div>

            {coolerPreview && coolerPreview.missing_logos.length > 0 && (
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div className="flex items-start gap-2 text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                  <div>
                    <strong>{coolerPreview.missing_logos.length} brands</strong> do not have a logo
                    loaded yet (initials fallback shown on Cooler Door):{' '}
                    <span className="text-slate-600 dark:text-slate-400">
                      {coolerPreview.missing_logos.slice(0, 6).join(', ')}
                      {coolerPreview.missing_logos.length > 6
                        ? ` +${coolerPreview.missing_logos.length - 6} more`
                        : ''}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onNavigateEnrichment}
                  className="h-8 px-3 inline-flex items-center gap-1.5 text-xs font-semibold rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-950 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Fetch Logos in Enrichment</span>
                </button>
              </div>
            )}
          </section>

          {/* Cooler Door Item Preview */}
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                {(['All', 'Beer', 'RTD', 'Spirits', 'Wine'] as const).map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCoolerCategoryFilter(cat)}
                    className={`h-8 px-3 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                      coolerCategoryFilter === cat
                        ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950 font-semibold'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              <div className="relative w-full sm:w-64">
                <Search
                  className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={coolerSearch}
                  onChange={(e) => setCoolerSearch(e.target.value)}
                  placeholder="Filter alcohol preview…"
                  aria-label="Filter Cooler Door alcohol preview"
                  className="w-full h-9 pl-8 pr-3 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 text-slate-500 dark:text-slate-400">
                    <th className="py-2.5 px-4 font-semibold">Alcohol SKU</th>
                    <th className="py-2.5 px-3 font-semibold">Category</th>
                    <th className="py-2.5 px-3 font-semibold">Size</th>
                    <th className="py-2.5 px-3 font-semibold">Logo Status</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Shelf Price</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {filteredCoolerItems.map((item) => (
                    <tr
                      key={item.id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-2.5 px-4">
                        <div className="flex items-center gap-2.5 min-w-[220px]">
                          <BrandThumbnail
                            logoUrl={item.logo}
                            brand={item.brand}
                            itemName={item.name}
                            size="sm"
                          />
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-900 dark:text-slate-100 truncate max-w-[280px]">
                              {item.name}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                              {item.brand || 'Unbranded'}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-slate-700 dark:text-slate-300">
                        {item.category}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600 dark:text-slate-400">
                        {item.size}
                      </td>
                      <td className="py-2.5 px-3">
                        {item.logo ? (
                          <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                            Logo ready
                          </span>
                        ) : (
                          <span className="text-slate-500 dark:text-slate-400">
                            Initials fallback
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                        ${item.price.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
