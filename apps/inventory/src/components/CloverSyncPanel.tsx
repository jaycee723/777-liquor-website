import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  CloudDownload,
  CloudUpload,
  FolderPlus,
  Package,
  RefreshCw,
  Settings2,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import {
  CanonicalItem,
  CloverMerchantOverview,
  CloverStatusResponse,
  CloverSyncInventoryResponse,
  CloverSyncSalesResponse,
} from '../types/inventory';
import { apiClient } from '../services/apiClient';
import { cloverService } from '../services/cloverService';
import { CloverSyncStatusBadge } from './CloverSyncStatusBadge';

interface CloverSyncPanelProps {
  onToast: (tone: 'success' | 'error', text: string) => void;
  onNavigateInventory: () => void;
}

type BridgeTab = 'inventory' | 'sales' | 'settings';

const CATEGORY_PRESETS = [
  'BEER',
  'RTD (READY TO DRINK)',
  'LIQUOR/SPIRITS',
  'WINE',
  'NON-ALCOHOLIC',
];

export function CloverSyncPanel({
  onToast,
  onNavigateInventory,
}: CloverSyncPanelProps) {
  const [activeTab, setActiveTab] = useState<BridgeTab>('inventory');
  const [status, setStatus] = useState<CloverStatusResponse | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [overview, setOverview] = useState<CloverMerchantOverview | null>(null);

  // Inventory Read/Write state
  const [pulling, setPulling] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [syncStockOnPush, setSyncStockOnPush] = useState(false);
  const [createDraftsOnPush, setCreateDraftsOnPush] = useState(false);
  const [syncResult, setSyncResult] = useState<CloverSyncInventoryResponse | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Sales Reports & Metrics state
  const [salesWindowDays, setSalesWindowDays] = useState<7 | 30 | 60 | 90>(30);
  const [syncingSales, setSyncingSales] = useState(false);
  const [salesResult, setSalesResult] = useState<CloverSyncSalesResponse | null>(null);

  // Categories manager state
  const [newCategoryName, setNewCategoryName] = useState('');
  const [creatingCategory, setCreatingCategory] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const s = await cloverService.getStatus();
      setStatus(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to check Clover REST API status.');
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const handleLoadOverview = async () => {
    setLoadingOverview(true);
    setError(null);
    try {
      const data = await apiClient.getCloverMerchantOverview();
      setOverview(data);
      onToast(
        'success',
        `Connected to ${data.merchantName} (${data.categories.length} categories, ${data.taxRates.length} tax rates loaded).`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to load Clover merchant settings.';
      setError(msg);
      onToast('error', msg);
    } finally {
      setLoadingOverview(false);
    }
  };

  const handlePullCloverInventory = async () => {
    setPulling(true);
    setError(null);
    try {
      const data = await apiClient.syncCloverInventory();
      setSyncResult(data);
      // Keep push selection OFF by default so staff explicitly approve writes back to Clover
      setSelectedIds(new Set());
      onToast(
        'success',
        `Pulled ${data.items.length} items from Clover POS (${data.needsNameFixCount} need capitalization cleanup).`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch Clover inventory.';
      setError(msg);
      onToast('error', msg);
    } finally {
      setPulling(false);
    }
  };

  const handleLoadLocalCatalogForPush = async () => {
    setError(null);
    try {
      const items = await apiClient.getAllItemsForMatching();
      const needsNameFixCount = items.filter((i) => i.name !== i.normalized_name).length;
      const missingCostCount = items.filter((i) => i.cost === null).length;
      setSyncResult({
        items,
        needsNameFixCount,
        missingCostCount,
        fetchedAt: new Date().toISOString(),
      });
      setSelectedIds(new Set());
      onToast(
        'success',
        `Loaded ${items.length} items from 777 Catalog. Select specific items to push to Clover POS.`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to load local catalog.';
      setError(msg);
      onToast('error', msg);
    }
  };

  const handleImportToCatalog = async () => {
    if (!syncResult || syncResult.items.length === 0) return;
    setImporting(true);
    setError(null);
    try {
      const existing = await apiClient.getAllItemsForMatching();
      const existingIds = new Set(existing.map((i) => i.clover_id));
      const res = await apiClient.importData({
        kind: 'inventory',
        filename: `Clover_Live_Sync_${new Date().toISOString().slice(0, 10)}.json`,
        sourceLabel: 'Clover REST API',
        inventoryRows: syncResult.items.map((item) => ({
          decision: existingIds.has(item.clover_id) ? 'update' : 'import',
          matchedCloverId: existingIds.has(item.clover_id) ? item.clover_id : null,
          item,
        })),
      });
      void apiClient.syncCatalogToFirestore().catch(() => {});
      onToast(
        'success',
        `Imported ${res.importedCount} new and updated ${res.updatedCount} Clover items into 777 Inventory.`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save Clover items into catalog.';
      setError(msg);
      onToast('error', msg);
    } finally {
      setImporting(false);
    }
  };

  const handlePushFixesToClover = async () => {
    if (!syncResult || selectedIds.size === 0) return;
    setPushing(true);
    setError(null);
    try {
      const chosen: CanonicalItem[] = syncResult.items.filter((i) => selectedIds.has(i.clover_id));
      const res = await apiClient.pushItemsToClover(chosen, {
        syncStock: syncStockOnPush,
        createIfDraft: createDraftsOnPush,
      });
      if (res.failedCount > 0) {
        onToast(
          'error',
          `Updated ${res.updatedCount} Clover items; ${res.failedCount} failed. Check item IDs and token permissions.`
        );
      } else {
        const createdCount = res.results.filter((r) => r.created).length;
        onToast(
          'success',
          createdCount > 0
            ? `Pushed ${res.updatedCount} items to Clover POS (${createdCount} newly created).`
            : `Pushed ${res.updatedCount} normalized item fixes directly to Clover POS.`
        );
      }
      setSelectedIds(new Set());
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to push fixes to Clover POS.';
      setError(msg);
      onToast('error', msg);
    } finally {
      setPushing(false);
    }
  };

  const handleSyncCloverSales = async () => {
    setSyncingSales(true);
    setError(null);
    try {
      const sales = await apiClient.syncCloverSales(salesWindowDays);
      setSalesResult(sales);
      await apiClient.importData({
        kind: 'sales',
        filename: `Clover_API_Orders_${salesWindowDays}d_${new Date().toISOString().slice(0, 10)}.json`,
        sourceLabel: 'Clover REST API',
        salesRows: sales.salesRows,
      });
      onToast(
        'success',
        `Synced ${sales.orderCount} Clover orders (${sales.salesRows.length} SKUs) into Sales Analytics.`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to sync Clover sales.';
      setError(msg);
      onToast('error', msg);
    } finally {
      setSyncingSales(false);
    }
  };

  const handleCreateCategory = async (nameToCreate: string) => {
    const trimmed = nameToCreate.trim();
    if (!trimmed) return;
    setCreatingCategory(true);
    setError(null);
    try {
      const created = await apiClient.createCloverCategory(trimmed);
      setOverview((prev) =>
        prev
          ? { ...prev, categories: [...prev.categories, created] }
          : prev
      );
      setNewCategoryName('');
      onToast('success', `Created Clover category "${created.name}".`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to create Clover category.';
      setError(msg);
      onToast('error', msg);
    } finally {
      setCreatingCategory(false);
    }
  };

  const onCategoryFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    void handleCreateCategory(newCategoryName);
  };

  const itemsNeedingNameFix = useMemo(
    () => (syncResult?.items ?? []).filter((i) => i.name !== i.normalized_name),
    [syncResult]
  );

  const toggleSelectId = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllNameFixes = () => {
    setSelectedIds(new Set(itemsNeedingNameFix.slice(0, 50).map((i) => i.clover_id)));
  };

  const formatMoney = (amount: number) =>
    `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="space-y-4">
      {/* Clover Bridge Header & Server Secret Status */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div className="space-y-1.5 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-base font-display font-bold text-slate-900 dark:text-slate-100">
                Clover POS REST API Read &amp; Write Bridge
              </h2>
              <CloverSyncStatusBadge />
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Secure server-side bridge to read and update your Clover POS catalog (with Title Case &amp;{' '}
              <span className="font-mono">11oz</span> / <span className="font-mono">1 L</span>{' '}
              normalization), pull live sales metrics into Analytics, and inspect or add Clover merchant categories and tax rates.
            </p>
            <div className="pt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              {loadingStatus ? (
                <span className="text-slate-500 dark:text-slate-400">Checking server secrets…</span>
              ) : status?.configured ? (
                <span
                  data-testid="clover-status-ready"
                  className="inline-flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-400"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    Connected ({status.environment} · Merchant {status.merchantIdMasked})
                  </span>
                </span>
              ) : (
                <span
                  data-testid="clover-status-unconfigured"
                  className="inline-flex items-center gap-1.5 font-medium text-amber-800 dark:text-amber-300"
                >
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    Server secrets not set yet — follow the 3 steps below to enable live Clover access.
                  </span>
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={loadingOverview || !status?.configured}
              onClick={() => void handleLoadOverview()}
              data-testid="clover-test-connection-btn"
              className="h-10 px-4 inline-flex items-center gap-2 text-xs font-semibold rounded-md bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white disabled:opacity-50 transition-colors whitespace-nowrap cursor-pointer"
            >
              <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{loadingOverview ? 'Testing…' : 'Test Connection & Load Settings'}</span>
            </button>
            <button
              type="button"
              onClick={() => void loadStatus()}
              disabled={loadingStatus}
              aria-label="Re-check Clover server secrets"
              className="h-10 px-3 inline-flex items-center gap-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingStatus ? 'animate-spin' : ''}`} aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* 3-Step Server Secrets Setup Guide when not yet configured */}
        {!loadingStatus && !status?.configured && (
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-4 space-y-2.5">
            <h3 className="text-xs font-display font-bold text-slate-900 dark:text-slate-100">
              How to Connect Your Clover REST API Key (3 Steps)
            </h3>
            <ol className="list-decimal list-inside space-y-1.5 text-xs text-slate-700 dark:text-slate-300">
              <li>
                Open <span className="font-semibold text-slate-900 dark:text-slate-100">Settings → Secrets</span> in AI Studio (your key stays strictly on the server and is never sent to the browser).
              </li>
              <li>
                Add <span className="font-mono text-[11px] font-semibold">CLOVER_MERCHANT_ID</span> (from your Clover Dashboard URL) and{' '}
                <span className="font-mono text-[11px] font-semibold">CLOVER_API_TOKEN</span> (your Clover private API token with Inventory Read/Write, Orders Read, and Merchant Read scopes).
              </li>
              <li>
                Optional: set <span className="font-mono text-[11px] font-semibold">CLOVER_API_BASE_URL</span> to{' '}
                <span className="font-mono text-[11px]">https://sandbox.dev.clover.com</span> for Sandbox, or leave blank for live Production (<span className="font-mono text-[11px]">https://api.clover.com</span>). Then click the refresh button above.
              </li>
            </ol>
          </div>
        )}

        {/* Sub-Tabs for the 3 Bridge Workflows */}
        <div
          role="tablist"
          aria-label="Clover Bridge Sections"
          className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-800 -mx-5 px-5 overflow-x-auto"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'inventory'}
            data-testid="clover-tab-inventory"
            onClick={() => setActiveTab('inventory')}
            className={`h-10 px-3.5 inline-flex items-center gap-2 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'inventory'
                ? 'border-blue-700 dark:border-blue-500 text-blue-700 dark:text-blue-400'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Package className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Inventory Read &amp; Write</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'sales'}
            data-testid="clover-tab-sales"
            onClick={() => setActiveTab('sales')}
            className={`h-10 px-3.5 inline-flex items-center gap-2 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'sales'
                ? 'border-blue-700 dark:border-blue-500 text-blue-700 dark:text-blue-400'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Sales Reports &amp; Metrics</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'settings'}
            data-testid="clover-tab-settings"
            onClick={() => setActiveTab('settings')}
            className={`h-10 px-3.5 inline-flex items-center gap-2 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'settings'
                ? 'border-blue-700 dark:border-blue-500 text-blue-700 dark:text-blue-400'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Settings2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Merchant Settings &amp; Features</span>
          </button>
        </div>
      </section>

      {error && (
        <div
          role="alert"
          className="px-4 py-3 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50 text-xs text-red-800 dark:text-red-300"
        >
          {error}
        </div>
      )}

      {/* TAB 1: INVENTORY READ & WRITE */}
      {activeTab === 'inventory' && (
        <div className="space-y-4">
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1">
              <h3 className="text-sm font-display font-bold text-slate-900 dark:text-slate-100">
                Pull Clover Items, Normalize Names &amp; Push Fixes Back
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Every pulled item is checked against your store capitalization rules (<span className="font-mono">11oz</span>, <span className="font-mono">1 L</span>) and HI-5 eligibility. Nothing writes to Clover until you check items and click Push.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={pulling || !status?.configured}
                onClick={() => void handlePullCloverInventory()}
                data-testid="clover-pull-btn"
                className="h-10 px-4 inline-flex items-center gap-2 text-xs font-semibold rounded-md bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white disabled:opacity-50 transition-colors whitespace-nowrap cursor-pointer"
              >
                <CloudDownload className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{pulling ? 'Pulling from Clover…' : 'Pull Clover Inventory'}</span>
              </button>
              <button
                type="button"
                onClick={() => void handleLoadLocalCatalogForPush()}
                data-testid="clover-load-local-btn"
                className="h-10 px-3.5 inline-flex items-center gap-2 text-xs font-semibold rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap cursor-pointer"
              >
                <span>Load 777 Catalog for Push</span>
              </button>
            </div>
          </section>

          {syncResult && (
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-display font-bold text-slate-900 dark:text-slate-100">
                    Clover Inventory Review ({syncResult.items.length} SKUs)
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {syncResult.needsNameFixCount} names need Title Case / unit fixes ·{' '}
                    {syncResult.missingCostCount} missing vendor cost · Check rows below to write updates back to Clover POS.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {itemsNeedingNameFix.length > 0 && (
                    <button
                      type="button"
                      onClick={selectAllNameFixes}
                      className="h-9 px-3 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
                    >
                      Select Name Fixes ({Math.min(50, itemsNeedingNameFix.length)})
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={importing}
                    onClick={() => void handleImportToCatalog()}
                    className="h-9 px-3.5 inline-flex items-center gap-1.5 text-xs font-semibold rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 cursor-pointer"
                  >
                    <span>{importing ? 'Saving…' : 'Save Into 777 Catalog'}</span>
                    <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    disabled={pushing || selectedIds.size === 0 || !status?.configured}
                    onClick={() => void handlePushFixesToClover()}
                    data-testid="clover-push-selected-btn"
                    className="h-9 px-3.5 inline-flex items-center gap-1.5 text-xs font-semibold rounded-md bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white disabled:opacity-50 cursor-pointer"
                  >
                    <CloudUpload className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>
                      {pushing ? 'Pushing…' : `Push ${selectedIds.size} Fixes to Clover`}
                    </span>
                  </button>
                </div>
              </div>

              <div className="px-5 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                  <label className="inline-flex items-center gap-2 text-slate-700 dark:text-slate-300 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={syncStockOnPush}
                      onChange={(e) => setSyncStockOnPush(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-blue-700"
                    />
                    <span>Overwrite Clover stock counts on push</span>
                  </label>
                  <label className="inline-flex items-center gap-2 text-slate-700 dark:text-slate-300 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={createDraftsOnPush}
                      onChange={(e) => setCreateDraftsOnPush(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-blue-700"
                    />
                    <span>Create new Clover items for local draft SKUs</span>
                  </label>
                </div>
                <button
                  type="button"
                  onClick={onNavigateInventory}
                  className="text-blue-700 dark:text-blue-400 font-medium hover:underline cursor-pointer"
                >
                  Open Full Inventory Grid
                </button>
              </div>

              <div className="overflow-x-auto max-h-[420px]">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="sticky top-0 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                    <tr>
                      <th className="py-2.5 px-4 w-10">Push</th>
                      <th className="py-2.5 px-3 font-semibold">Current Name</th>
                      <th className="py-2.5 px-3 font-semibold">Normalized Name (11oz / 1 L)</th>
                      <th className="py-2.5 px-3 font-semibold">Category · HI-5</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Price</th>
                      <th className="py-2.5 px-4 font-semibold text-right">Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {syncResult.items.slice(0, 100).map((item) => {
                      const changed = item.name !== item.normalized_name;
                      const checked = selectedIds.has(item.clover_id);
                      return (
                        <tr
                          key={item.clover_id}
                          className="hover:bg-slate-50 dark:hover:bg-slate-800/40"
                        >
                          <td className="py-2 px-4">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleSelectId(item.clover_id)}
                              aria-label={`Select ${item.normalized_name} to push to Clover`}
                              className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-blue-700"
                            />
                          </td>
                          <td className="py-2 px-3 text-slate-500 dark:text-slate-400">
                            {item.name}
                          </td>
                          <td
                            className={`py-2 px-3 font-semibold ${
                              changed
                                ? 'text-blue-700 dark:text-blue-400'
                                : 'text-slate-900 dark:text-slate-100'
                            }`}
                          >
                            {item.normalized_name}
                          </td>
                          <td className="py-2 px-3 text-slate-600 dark:text-slate-400">
                            {item.category} · HI-5 {item.hi5_eligible}
                          </td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                            ${item.price.toFixed(2)}
                          </td>
                          <td className="py-2 px-4 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                            {item.cost !== null ? `$${item.cost.toFixed(2)}` : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      )}

      {/* TAB 2: SALES REPORTS & METRICS */}
      {activeTab === 'sales' && (
        <div className="space-y-4">
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="space-y-1">
                <h3 className="text-sm font-display font-bold text-slate-900 dark:text-slate-100">
                  Pull Live Clover Orders, Revenue &amp; Tax Metrics
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Fetches completed Clover orders with line items, payments, and discounts, calculates store metrics, and syncs SKU velocity directly into the Sales Analytics dashboard.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <label className="sr-only" htmlFor="clover-sales-window">
                  Sales date window
                </label>
                <select
                  id="clover-sales-window"
                  value={salesWindowDays}
                  onChange={(e) => setSalesWindowDays(Number(e.target.value) as 7 | 30 | 60 | 90)}
                  className="h-10 px-3 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                >
                  <option value={7}>Last 7 Days</option>
                  <option value={30}>Last 30 Days</option>
                  <option value={60}>Last 60 Days</option>
                  <option value={90}>Last 90 Days</option>
                </select>
                <button
                  type="button"
                  disabled={syncingSales || !status?.configured}
                  onClick={() => void handleSyncCloverSales()}
                  data-testid="clover-sync-sales-btn"
                  className="h-10 px-4 inline-flex items-center gap-2 text-xs font-semibold rounded-md bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white disabled:opacity-50 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <TrendingUp className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{syncingSales ? 'Syncing Orders…' : `Sync ${salesWindowDays}-Day Sales`}</span>
                </button>
              </div>
            </div>

            {salesResult?.metrics ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 pt-2">
                <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3">
                  <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Orders</div>
                  <div className="mt-1 text-lg font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
                    {salesResult.metrics.orderCount.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3">
                  <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Gross Sales</div>
                  <div className="mt-1 text-lg font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
                    {formatMoney(salesResult.metrics.totalGross)}
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3">
                  <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Tax Collected</div>
                  <div className="mt-1 text-lg font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
                    {formatMoney(salesResult.metrics.totalTax)}
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3">
                  <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Discounts</div>
                  <div className="mt-1 text-lg font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
                    {formatMoney(salesResult.metrics.totalDiscounts)}
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3">
                  <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Avg Order</div>
                  <div className="mt-1 text-lg font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
                    {formatMoney(salesResult.metrics.avgOrderValue)}
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-slate-300 dark:border-slate-700 p-5 text-xs text-slate-600 dark:text-slate-400">
                No Clover API orders synced yet in this session. Select a date window above and click{' '}
                <span className="font-semibold text-slate-900 dark:text-slate-200">Sync Sales</span>{' '}
                to populate live order metrics and update the Sales Analytics tab (or use the CSV Export upload tab as a manual fallback).
              </div>
            )}
          </section>

          {salesResult && salesResult.salesRows.length > 0 && (
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800">
                <h4 className="text-sm font-display font-bold text-slate-900 dark:text-slate-100">
                  SKU Sales Breakdown ({salesResult.salesRows.length} Items Synced)
                </h4>
              </div>
              <div className="overflow-x-auto max-h-[360px]">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="sticky top-0 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                    <tr>
                      <th className="py-2.5 px-4 font-semibold">Normalized Item</th>
                      <th className="py-2.5 px-3 font-semibold">Clover ID</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Units Sold</th>
                      <th className="py-2.5 px-4 font-semibold text-right">Gross Sales</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {salesResult.salesRows.slice(0, 100).map((row) => (
                      <tr key={`${row.clover_id ?? row.name}-${row.rowIndex}`}>
                        <td className="py-2 px-4 font-semibold text-slate-900 dark:text-slate-100">
                          {row.name}
                        </td>
                        <td className="py-2 px-3 font-mono text-slate-500 dark:text-slate-400">
                          {row.clover_id || '—'}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                          {row.units_sold}
                        </td>
                        <td className="py-2 px-4 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                          {formatMoney(row.gross_sales)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      )}

      {/* TAB 3: MERCHANT SETTINGS & FEATURES */}
      {activeTab === 'settings' && (
        <div className="space-y-4">
          {!overview ? (
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <h3 className="text-sm font-display font-bold text-slate-900 dark:text-slate-100">
                  Clover Merchant Profile, Tax Rates, Categories &amp; Token Scopes
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Load your live Clover POS merchant settings to verify API token read/write access, confirm Oahu GET tax rates, and create or organize POS categories directly from here.
                </p>
              </div>
              <button
                type="button"
                disabled={loadingOverview || !status?.configured}
                onClick={() => void handleLoadOverview()}
                className="h-10 px-4 inline-flex items-center gap-2 text-xs font-semibold rounded-md bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white disabled:opacity-50 whitespace-nowrap cursor-pointer shrink-0"
              >
                <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{loadingOverview ? 'Loading Settings…' : 'Load Clover Settings'}</span>
              </button>
            </section>
          ) : (
            <>
              {/* Merchant Profile & Token Scopes */}
              <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-display font-bold text-slate-900 dark:text-slate-100">
                      {overview.merchantName}
                    </h3>
                    <p className="text-xs text-slate-600 dark:text-slate-400">
                      {overview.address} · {overview.currency} · {overview.timezone}
                    </p>
                  </div>
                  <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                    {overview.environment.toUpperCase()} · {overview.merchantIdMasked}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { label: 'Merchant Settings Read', ok: overview.permissions.merchantRead },
                    { label: 'Inventory & Categories Read', ok: overview.permissions.inventoryRead },
                    { label: 'Orders & Sales Metrics Read', ok: overview.permissions.ordersRead },
                  ].map((perm) => (
                    <div
                      key={perm.label}
                      className="rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 px-3.5 py-2.5 flex items-center justify-between gap-2"
                    >
                      <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                        {perm.label}
                      </span>
                      <span
                        className={`text-xs font-semibold ${
                          perm.ok
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-amber-700 dark:text-amber-400'
                        }`}
                      >
                        {perm.ok ? 'Active' : 'Missing Scope'}
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              {/* Categories Manager (Read + Write) */}
              <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
                <div>
                  <h3 className="text-sm font-display font-bold text-slate-900 dark:text-slate-100">
                    Clover Categories ({overview.categories.length})
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Create new Clover POS categories directly from 777 Inventory or add standard liquor &amp; grocery groups in one click.
                  </p>
                </div>

                <form onSubmit={onCategoryFormSubmit} className="flex flex-col sm:flex-row gap-2">
                  <label htmlFor="new-clover-category" className="sr-only">
                    New Clover Category Name
                  </label>
                  <input
                    id="new-clover-category"
                    type="text"
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    placeholder="New Clover category name (e.g. RTD (READY TO DRINK))"
                    maxLength={127}
                    className="h-10 flex-1 px-3 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
                  />
                  <button
                    type="submit"
                    disabled={creatingCategory || !newCategoryName.trim()}
                    className="h-10 px-4 inline-flex items-center justify-center gap-1.5 text-xs font-semibold rounded-md bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white disabled:opacity-50 whitespace-nowrap cursor-pointer"
                  >
                    <FolderPlus className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{creatingCategory ? 'Creating…' : 'Create Category in Clover'}</span>
                  </button>
                </form>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    Quick add Toast-aligned preset:
                  </span>
                  {CATEGORY_PRESETS.map((preset) => {
                    const alreadyExists = overview.categories.some(
                      (c) => c.name.trim().toUpperCase() === preset
                    );
                    return (
                      <button
                        key={preset}
                        type="button"
                        disabled={creatingCategory || alreadyExists}
                        onClick={() => void handleCreateCategory(preset)}
                        className="h-8 px-2.5 text-[11px] font-semibold rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-45 cursor-pointer"
                      >
                        {alreadyExists ? `✓ ${preset}` : `+ ${preset}`}
                      </button>
                    );
                  })}
                </div>

                {overview.categories.length > 0 && (
                  <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-md">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                        <tr>
                          <th className="py-2 px-3 font-semibold">Category Name</th>
                          <th className="py-2 px-3 font-semibold">Clover ID</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                        {overview.categories.map((cat) => (
                          <tr key={cat.id}>
                            <td className="py-2 px-3 font-medium text-slate-900 dark:text-slate-100">
                              {cat.name}
                            </td>
                            <td className="py-2 px-3 font-mono text-slate-500 dark:text-slate-400">
                              {cat.id}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* Tax Rates & Tags */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-3">
                  <h3 className="text-sm font-display font-bold text-slate-900 dark:text-slate-100">
                    Clover Tax Rates ({overview.taxRates.length})
                  </h3>
                  {overview.taxRates.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      No tax rates returned by Clover for this merchant.
                    </p>
                  ) : (
                    <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-md">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                          <tr>
                            <th className="py-2 px-3 font-semibold">Tax Name</th>
                            <th className="py-2 px-3 font-semibold text-right">Rate</th>
                            <th className="py-2 px-3 font-semibold text-right">Default</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                          {overview.taxRates.map((tax) => (
                            <tr key={tax.id}>
                              <td className="py-2 px-3 font-medium text-slate-900 dark:text-slate-100">
                                {tax.name}
                              </td>
                              <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                                {tax.ratePercent.toFixed(3)}%
                              </td>
                              <td className="py-2 px-3 text-right text-slate-600 dark:text-slate-400">
                                {tax.isDefault ? 'Default' : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-3">
                  <h3 className="text-sm font-display font-bold text-slate-900 dark:text-slate-100">
                    Clover Item Tags &amp; Printer Labels ({overview.tags.length})
                  </h3>
                  {overview.tags.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      No Clover tags configured on this merchant account.
                    </p>
                  ) : (
                    <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-md">
                      {overview.tags.map((tag) => (
                        <div
                          key={tag.id}
                          className="px-3 py-2 flex items-center justify-between text-xs"
                        >
                          <span className="font-medium text-slate-900 dark:text-slate-100">
                            {tag.name}
                          </span>
                          <span className="font-mono text-slate-500 dark:text-slate-400">
                            {tag.id}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
