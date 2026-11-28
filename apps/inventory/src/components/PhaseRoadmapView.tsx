import { useEffect, useState } from 'react';
import { ArrowLeft, CloudUpload, RotateCcw } from 'lucide-react';
import {
  AnalyticsSummaryResponse,
  AppSection,
  CloverStatusResponse,
  CoolerDoorPushResponse,
} from '../types/inventory';
import { apiConfig, inventoryApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { firebaseProjectConfig } from '../lib/firebase';

interface PhaseRoadmapViewProps {
  section: Exclude<AppSection, 'inventory' | 'import'>;
  onReturnToInventory: () => void;
  onNavigateImport: () => void;
  onNavigateExports?: () => void;
  onToast: (tone: 'success' | 'error', text: string) => void;
}

const SECTION_SPECS: Record<
  Exclude<AppSection, 'inventory' | 'import'>,
  {
    title: string;
    phase: string;
    summary: string;
    endpoints: string[];
    capabilities: string[];
  }
> = {
  enrichment: {
    title: 'Assisted Catalog Enrichment',
    phase: 'Phase 3',
    summary:
      'One-click lookups for missing brand logos, product photos, vendor costs, and Gemini context extraction with explicit accept/reject review.',
    endpoints: ['POST /api/enrich'],
    capabilities: [
      'Side-by-side current vs. proposed field diffs — never overwrites silently',
      'Brand logo and product image finder with immediate preview',
      'Gemini extraction for brand, unit size, pack count, and category',
    ],
  },
  pricing: {
    title: 'Guarded Pricing Review',
    phase: 'Phase 3',
    summary:
      'Compare authoritative shelf prices against server-calculated suggestions with master shelf-value impact preview and preview-token verification.',
    endpoints: ['GET /api/pricing/suggestions', 'POST /api/pricing/apply'],
    capabilities: [
      'Per-row Apply toggle defaults OFF; original prices never change automatically',
      'Flagged rows (PRICE_DROP, >20% change, NO_COST) visually distinct and excluded from bulk apply',
      'Stale preview-token rejection handled with one-click refresh',
    ],
  },
  analytics: {
    title: 'Sales Analytics (Adapter-Agnostic)',
    phase: 'Phase 4',
    summary:
      'Top sellers, dead stock, category margins, and Honolulu market pricing insights working identically from Clover CSV exports or Clover API.',
    endpoints: ['GET /api/analytics/summary'],
    capabilities: [
      'Displays exact sales_source (Clover CSV Export, Clover API, or None Loaded)',
      'Zeroed empty state when no sales data has been imported yet',
      'Zero hard dependency on Clover API approval',
    ],
  },
  suggestions: {
    title: 'Hawaii Market Product Suggestions',
    phase: 'Phase 4',
    summary:
      'Vendor catalog recommendations ranked by Honolulu demand and expected margin with one-click Draft creation into Inventory.',
    endpoints: ['GET /api/suggestions/products'],
    capabilities: [
      'Expected retail, vendor cost, and gross margin preview per SKU',
      'One-click Add to Inventory (Draft) flagged for counter verification',
    ],
  },
  exports: {
    title: 'Toast Retail Export & Cooler Door Push',
    phase: 'Phase 4',
    summary:
      'Generate Toast Retail template CSVs, export full spreadsheets, and publish the verified alcohol catalog to the Cooler Door page.',
    endpoints: ['POST /api/export/toast', 'POST /api/push/cooler-door'],
    capabilities: [
      'Official Toast Retail column export with pre-flight validation counts',
      'Cooler Door alcohol-only publish preview (name, price, brand logo)',
    ],
  },
  labels: {
    title: 'Label Studio & Avery Print Engine',
    phase: 'Phase 5',
    summary:
      'Drag-and-drop shelf tag designer and true-size US Letter sheet renderer for Avery 5160/8160, 5161, 5163, 5164, and 5167.',
    endpoints: ['CRUD /api/label-templates', 'POST /api/labels/render'],
    capabilities: [
      'Draggable fields: name, price, size, brand, logo, and UPC barcode',
      'Exact published Avery sheet margins and pitch with print-only output',
    ],
  },
  settings: {
    title: 'Integration Status & Store Settings',
    phase: 'Active',
    summary:
      'Verify API transport configuration, sales-data adapter status, and Hawaii HI-5 compliance rules for 777 Liquor Grocery & Gift Shop.',
    endpoints: ['GET /api/analytics/summary'],
    capabilities: [],
  },
};

export function PhaseRoadmapView({
  section,
  onReturnToInventory,
  onNavigateImport,
  onNavigateExports,
  onToast,
}: PhaseRoadmapViewProps) {
  const { firebaseConnected } = useAuth();
  const spec = SECTION_SPECS[section];
  const [analytics, setAnalytics] = useState<AnalyticsSummaryResponse | null>(null);
  const [lastCoolerPush, setLastCoolerPush] = useState<CoolerDoorPushResponse | null>(null);
  const [cloverStatus, setCloverStatus] = useState<CloverStatusResponse | null>(null);
  const [syncingFirebase, setSyncingFirebase] = useState(false);

  useEffect(() => {
    if (section !== 'settings') return;
    void inventoryApi.getAnalyticsSummary().then(setAnalytics).catch(() => {});
    void inventoryApi.getLastCoolerDoorPush().then(setLastCoolerPush).catch(() => {});
    void inventoryApi.getCloverStatus().then(setCloverStatus).catch(() => {});
  }, [section]);

  const handleSyncToFirebase = async () => {
    setSyncingFirebase(true);
    try {
      const count = await inventoryApi.syncCatalogToFirestore();
      onToast('success', `Synced ${count} inventory items to Firebase Firestore.`);
    } catch (err) {
      onToast(
        'error',
        err instanceof Error ? err.message : 'Sign in with Google first to sync to Firebase.'
      );
    } finally {
      setSyncingFirebase(false);
    }
  };

  const handleResetDemo = async () => {
    await inventoryApi.resetDemoData();
    const [fresh, freshPush] = await Promise.all([
      inventoryApi.getAnalyticsSummary(),
      inventoryApi.getLastCoolerDoorPush(),
    ]);
    setAnalytics(fresh);
    setLastCoolerPush(freshPush);
    onToast('success', 'Local mock inventory, sales, and publish state restored to initial seed data.');
  };

  if (section === 'settings') {
    const salesLabel =
      analytics?.sales_source === 'clover_export'
        ? `Clover CSV Export (${analytics.units_sold} units · $${analytics.total_revenue.toFixed(2)})`
        : analytics?.sales_source === 'clover_api'
          ? 'Clover API (Connected)'
          : 'None Loaded (Clover CSV Export Default)';

    return (
      <div className="max-w-4xl space-y-5">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-200 dark:divide-slate-800">
          <div className="px-6 py-4">
            <h2 className="text-base font-display font-bold text-slate-900 dark:text-slate-100">
              Integration &amp; Adapter Status
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Single environment-switched API client configured via VITE_USE_MOCK_API and VITE_API_BASE_URL.
            </p>
          </div>

          <div className="px-6 py-4 grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
            <div className="space-y-1">
              <div className="text-slate-500 dark:text-slate-400 font-medium">API Transport Mode</div>
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {apiConfig.useMockApi ? 'Local Mock Engine (Active)' : 'Live Cloudflare Worker'}
              </div>
              <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                Target base: {apiConfig.baseUrl}
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-slate-500 dark:text-slate-400 font-medium">Sales Data Adapter</div>
              <div
                className={`text-sm font-semibold ${
                  analytics?.sales_source === 'clover_export'
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-slate-900 dark:text-slate-100'
                }`}
              >
                {salesLabel}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                {analytics?.source_filename ? (
                  <span>
                    Source file: <span className="font-mono">{analytics.source_filename}</span>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={onNavigateImport}
                    className="text-blue-700 dark:text-blue-400 font-medium hover:underline cursor-pointer"
                  >
                    Import a Clover Sales CSV to populate analytics
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-slate-500 dark:text-slate-400 font-medium">Hawaii HI-5 Deposit Rule</div>
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                $0.06 / container (Beer, RTD, Non-Alcoholic)
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Spirits and wine exempt; ambiguous canned cocktails flagged Confirm.
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-slate-500 dark:text-slate-400 font-medium">Name Normalization Rule</div>
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Title Case · Compact oz / Spaced L
              </div>
              <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                Example: Kona Big Wave 12oz 6pk · Tito&apos;s Vodka 1 L
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-slate-500 dark:text-slate-400 font-medium">Toast Retail Export Profile</div>
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                26-Column Official Retail Template
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Matches core/toast_export.py · Missing cost stays blank, never $0.00.
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-slate-500 dark:text-slate-400 font-medium">Cooler Door Website Push</div>
              <div
                className={`text-sm font-semibold ${
                  lastCoolerPush
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-slate-900 dark:text-slate-100'
                }`}
              >
                {lastCoolerPush
                  ? `Published ${lastCoolerPush.publishedCount} alcohol SKUs`
                  : 'Ready to Publish (Alcohol Only)'}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                {lastCoolerPush ? (
                  <span>Last sync: {new Date(lastCoolerPush.publishedAt).toLocaleString()}</span>
                ) : onNavigateExports ? (
                  <button
                    type="button"
                    onClick={onNavigateExports}
                    className="text-blue-700 dark:text-blue-400 font-medium hover:underline cursor-pointer"
                  >
                    Open Exports &amp; Cooler Door Push Center
                  </button>
                ) : (
                  <span>Excludes Non-Alcoholic, Grocery, and Gift items.</span>
                )}
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-slate-500 dark:text-slate-400 font-medium">Firebase Cloud Persistence</div>
              <div
                className={`text-sm font-semibold ${
                  firebaseConnected
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-slate-900 dark:text-slate-100'
                }`}
              >
                {firebaseConnected
                  ? 'Connected (Google Account Signed In)'
                  : 'Provisioned (Sign in with Google to Sync)'}
              </div>
              <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                Project: {firebaseProjectConfig.projectId}
              </div>
              {firebaseConnected && (
                <button
                  type="button"
                  disabled={syncingFirebase}
                  onClick={() => void handleSyncToFirebase()}
                  className="mt-1.5 h-8 px-3 inline-flex items-center gap-1.5 text-[11px] font-semibold rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 cursor-pointer"
                >
                  <CloudUpload className="w-3 h-3" aria-hidden="true" />
                  <span>{syncingFirebase ? 'Syncing…' : 'Sync Catalog to Firebase'}</span>
                </button>
              )}
            </div>

            <div className="space-y-1">
              <div className="text-slate-500 dark:text-slate-400 font-medium">Clover POS REST API</div>
              <div
                className={`text-sm font-semibold ${
                  cloverStatus?.configured
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-amber-700 dark:text-amber-400'
                }`}
              >
                {cloverStatus?.configured
                  ? `Ready (${cloverStatus.environment} · ${cloverStatus.merchantIdMasked})`
                  : 'Awaiting Server Secrets'}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                {cloverStatus?.configured ? (
                  <button
                    type="button"
                    onClick={onNavigateImport}
                    className="text-blue-700 dark:text-blue-400 font-medium hover:underline cursor-pointer"
                  >
                    Open Import → Clover POS Live Sync
                  </button>
                ) : (
                  <span>
                    Set <span className="font-mono">CLOVER_MERCHANT_ID</span> &amp;{' '}
                    <span className="font-mono">CLOVER_API_TOKEN</span> in Settings → Secrets.
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-slate-500 dark:text-slate-400 font-medium">
                Cloudflare Workers Hosting
              </div>
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                inventory.777liquor.com (under 777liquor.com)
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Configured in <span className="font-mono">wrangler.jsonc</span> &amp;{' '}
                <span className="font-mono">cloudflare/inventory-worker.ts</span> with custom domain routing and Clover v3 edge proxy.
              </div>
            </div>
          </div>

          {apiConfig.useMockApi && (
            <div className="px-6 py-4 flex flex-wrap items-center justify-between gap-4 bg-slate-50/70 dark:bg-slate-950/40">
              <div className="text-xs text-slate-600 dark:text-slate-400">
                Reset local browser changes back to the original 28-item Honolulu seed catalog and empty sales state.
              </div>
              <button
                type="button"
                onClick={() => void handleResetDemo()}
                className="h-9 px-3.5 inline-flex items-center gap-2 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Reset Mock Catalog</span>
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onReturnToInventory}
          className="h-10 px-4 inline-flex items-center gap-2 text-xs font-semibold rounded-md bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Back to Inventory Grid</span>
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-5">
      <div>
        <p className="text-xs font-mono text-slate-500 dark:text-slate-400">
          Scheduled for {spec.phase} · Awaiting Gate Approval
        </p>
        <h2 className="mt-1.5 text-xl font-display font-bold text-slate-900 dark:text-slate-100">
          {spec.title}
        </h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{spec.summary}</p>
      </div>

      <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
        <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400">
          Planned Capabilities
        </h3>
        <ul className="space-y-1.5 text-sm text-slate-700 dark:text-slate-300 list-disc pl-5">
          {spec.capabilities.map((cap) => (
            <li key={cap}>{cap}</li>
          ))}
        </ul>
      </div>

      <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
        <div className="text-xs text-slate-500 dark:text-slate-400">
          Contract:{' '}
          <span className="font-mono text-slate-800 dark:text-slate-200">
            {spec.endpoints.join(' · ')}
          </span>
        </div>
        <button
          type="button"
          onClick={onReturnToInventory}
          className="h-10 px-4 inline-flex items-center gap-2 text-xs font-semibold rounded-md bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Return to Inventory Grid</span>
        </button>
      </div>
    </div>
  );
}
