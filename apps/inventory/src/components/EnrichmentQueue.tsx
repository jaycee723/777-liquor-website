import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Award,
  Barcode,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  DollarSign,
  ExternalLink,
  Flag,
  Globe,
  Image as ImageIcon,
  Layers,
  Loader2,
  RefreshCw,
  ScanBarcode,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import {
  CanonicalItem,
  EnrichCitation,
  EnrichLookupType,
  EnrichMarketReference,
  EnrichProposal,
  EnrichSourceStatus,
  ItemFlag,
} from '../types/inventory';
import { apiClient, EnrichActionOptions } from '../services/apiClient';
import {
  buildPatchFromAcceptedProposals,
  EnrichmentGapKey,
  EnrichmentQueueFilter,
  filterEnrichmentQueue,
  getItemMissingGaps,
  getRecommendedLookupTasks,
  ProposalDecision,
} from '../utils/enrichmentPricingRules';
import { BrandThumbnail } from './BrandThumbnail';
import { BarcodeScannerModal } from './BarcodeScannerModal';

const FLAG_LABELS: Record<ItemFlag, string> = {
  NO_COST: 'No Cost',
  NEED_PACK_CONFIG: 'Need Pack Config',
  PRICE_DROP: 'Price Drop',
  REVIEW: 'Needs Review',
  HI5_CONFIRM: 'HI-5 Confirm',
};

interface EnrichmentQueueProps {
  onToast: (tone: 'success' | 'error', text: string) => void;
}

const FIELD_LABELS: Partial<Record<keyof CanonicalItem, string>> = {
  logo_url: 'Brand Logo',
  image_url: 'Product Photo',
  cost: 'Unit Cost',
  vendor: 'Distributor / Vendor',
  normalized_name: 'Normalized Name',
  brand: 'Brand',
  category: 'Category',
  subcategory: 'Subcategory',
  unit_size: 'Unit Size',
  sell_pack_qty: 'Sell Pack Qty',
  packs_per_case: 'Packs / Case',
  hi5_eligible: 'Hawaii HI-5',
  upc: 'UPC Barcode',
};

const GAP_LABELS: Record<EnrichmentGapKey, string> = {
  logo: 'Logo',
  image: 'Photo',
  cost: 'Cost',
  pack: 'Pack Config',
  vendor: 'Vendor',
};

function formatFieldValue(field: keyof CanonicalItem, value: string | number | null): string {
  if (value === null || value === '') return 'Missing';
  if (field === 'cost' && typeof value === 'number') {
    return `$${value.toFixed(2)}`;
  }
  return String(value);
}

function ProposedImagePreview({ src, label }: { src: string; label: string }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (failed) {
    return (
      <span className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
        <span className="w-10 h-10 rounded border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
          <ImageIcon className="w-4 h-4 text-slate-400" aria-hidden="true" />
        </span>
        <span>Image preview unavailable</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2.5">
      <img
        src={src}
        alt={`Proposed ${label}`}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="w-10 h-10 rounded object-contain bg-white border border-slate-200 dark:border-slate-700 p-0.5 shrink-0"
      />
      <span className="text-xs font-medium text-emerald-800 dark:text-emerald-300">
        Online image ready
      </span>
    </span>
  );
}

export function EnrichmentQueue({ onToast }: EnrichmentQueueProps) {
  const [items, setItems] = useState<CanonicalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<EnrichmentQueueFilter>('all_gaps');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [lookupBusy, setLookupBusy] = useState(false);
  const [activeLookupKey, setActiveLookupKey] = useState<string | null>(null);
  const [jobProgressLabel, setJobProgressLabel] = useState<string | null>(null);
  const [proposals, setProposals] = useState<EnrichProposal[]>([]);
  const [decisions, setDecisions] = useState<Record<string, ProposalDecision>>({});
  const [sourcesChecked, setSourcesChecked] = useState<EnrichSourceStatus[]>([]);
  const [citations, setCitations] = useState<EnrichCitation[]>([]);
  const [marketReferences, setMarketReferences] = useState<EnrichMarketReference[]>([]);
  const [lookupNotice, setLookupNotice] = useState<string | null>(null);
  const [lastClearedFlags, setLastClearedFlags] = useState<ItemFlag[]>([]);
  const [clearReviewOnSave, setClearReviewOnSave] = useState(true);
  const [hasSearchedItem, setHasSearchedItem] = useState(false);
  const [saving, setSaving] = useState(false);

  // Optional refinement controls for messy Clover names or custom brand URLs
  const [showRefine, setShowRefine] = useState(false);
  const [customQuery, setCustomQuery] = useState('');
  const [brandWebsite, setBrandWebsite] = useState('');
  const [upcScannerOpen, setUpcScannerOpen] = useState(false);

  const resetItemLookupState = useCallback(() => {
    setProposals([]);
    setDecisions({});
    setSourcesChecked([]);
    setCitations([]);
    setMarketReferences([]);
    setLookupNotice(null);
    setJobProgressLabel(null);
    setLastClearedFlags([]);
    setClearReviewOnSave(true);
    setHasSearchedItem(false);
    setCustomQuery('');
    setBrandWebsite('');
  }, []);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    try {
      const all = await apiClient.getAllItemsForMatching();
      setItems(all);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to load enrichment queue.');
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const summary = useMemo(() => {
    let needingData = 0;
    let missingLogo = 0;
    let missingCost = 0;
    let missingPack = 0;
    let missingImage = 0;

    for (const item of items) {
      const gaps = getItemMissingGaps(item);
      if (gaps.length > 0) needingData += 1;
      if (gaps.includes('logo')) missingLogo += 1;
      if (gaps.includes('cost')) missingCost += 1;
      if (gaps.includes('pack')) missingPack += 1;
      if (gaps.includes('image')) missingImage += 1;
    }

    return { needingData, missingLogo, missingCost, missingPack, missingImage };
  }, [items]);

  const queue = useMemo(
    () => filterEnrichmentQueue(items, filter, search),
    [items, filter, search]
  );

  useEffect(() => {
    if (queue.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !queue.some((i) => i.clover_id === selectedId)) {
      setSelectedId(queue[0].clover_id);
      resetItemLookupState();
    }
  }, [queue, selectedId, resetItemLookupState]);

  const activeItem = useMemo(
    () => items.find((i) => i.clover_id === selectedId) ?? null,
    [items, selectedId]
  );

  const activeQueueIndex = useMemo(
    () => (selectedId ? queue.findIndex((i) => i.clover_id === selectedId) : -1),
    [queue, selectedId]
  );

  const handleSelectItem = (cloverId: string) => {
    if (cloverId === selectedId) return;
    setSelectedId(cloverId);
    resetItemLookupState();
  };

  const handleSelectNextItem = () => {
    if (queue.length <= 1) return;
    const nextIdx = activeQueueIndex >= 0 ? (activeQueueIndex + 1) % queue.length : 0;
    const nextItem = queue[nextIdx];
    if (nextItem) {
      setSelectedId(nextItem.clover_id);
      resetItemLookupState();
    }
  };

  const runLookup = async (
    actionKey:
      | 'auto_all'
      | 'logo'
      | 'image'
      | 'upc_lookup'
      | 'vendor_cost'
      | 'gemini_context',
    overrideTasks?: EnrichLookupType[],
    overrideItem?: CanonicalItem
  ) => {
    const target = overrideItem ?? activeItem;
    if (!target) return;
    setLookupBusy(true);
    setActiveLookupKey(actionKey);
    setLookupNotice(null);
    setJobProgressLabel(null);

    const actionOptions: EnrichActionOptions = {
      customQuery: customQuery.trim() || undefined,
      brandWebsite: brandWebsite.trim() || undefined,
      onJobProgress: (job) => {
        const pct = Math.round((job.progress ?? 0) * 100);
        setJobProgressLabel(
          job.status === 'queued'
            ? 'Queued enrichment job...'
            : `Running enrichment job (${pct}%)...`
        );
      },
    };

    try {
      let response;
      if (actionKey === 'logo') {
        response = await apiClient.fetchBrandLogo(target, actionOptions);
      } else if (actionKey === 'image') {
        response = await apiClient.fetchProductImage(target, actionOptions);
      } else if (actionKey === 'upc_lookup') {
        response = await apiClient.lookupUpcProduct(target, actionOptions);
      } else if (actionKey === 'vendor_cost') {
        response = await apiClient.searchVendorPrice(target, actionOptions);
      } else if (actionKey === 'gemini_context') {
        response = await apiClient.analyzeItemContext(target, actionOptions);
      } else {
        response = await apiClient.enrichItem(
          {
            clover_id: target.clover_id,
            lookupTypes: overrideTasks ?? getRecommendedLookupTasks(target),
            item: target,
          },
          actionOptions
        );
      }

      setProposals((prev) => {
        const merged = new Map(prev.map((p) => [p.field, p]));
        for (const nextProp of response.proposals) {
          merged.set(nextProp.field, nextProp);
        }
        return Array.from(merged.values());
      });

      setDecisions((prev) => {
        const next = { ...prev };
        for (const prop of response.proposals) {
          if (!next[prop.field]) {
            next[prop.field] = 'pending';
          }
        }
        return next;
      });

      if (response.sourcesChecked?.length) {
        setSourcesChecked((prev) => {
          const bySource = new Map(prev.map((s) => [s.source, s]));
          for (const s of response.sourcesChecked ?? []) {
            bySource.set(s.source, s);
          }
          return Array.from(bySource.values());
        });
      }

      if (response.citations?.length) {
        setCitations((prev) => {
          const byUrl = new Map(prev.map((c) => [c.url, c]));
          for (const c of response.citations ?? []) {
            byUrl.set(c.url, c);
          }
          return Array.from(byUrl.values()).slice(0, 8);
        });
      }

      if (response.marketReferences?.length) {
        setMarketReferences((prev) => {
          const next = [...prev];
          for (const ref of response.marketReferences ?? []) {
            const exists = next.some(
              (r) => r.retailer.toLowerCase() === ref.retailer.toLowerCase() && r.price === ref.price
            );
            if (!exists) next.push(ref);
          }
          return next.slice(0, 6);
        });
      }

      if (response.notice) {
        setLookupNotice(response.notice);
      }

      setHasSearchedItem(true);

      if (response.proposals.length > 0) {
        onToast(
          'success',
          `Found ${response.proposals.length} proposed update${response.proposals.length === 1 ? '' : 's'} online — review below.`
        );
      } else if ((response.marketReferences?.length ?? 0) > 0) {
        onToast('success', 'Found live retail market benchmarks online (see reference strip below).');
      } else {
        onToast('success', 'Online lookup finished — no new missing fields matched automatically.');
      }
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Online enrichment lookup failed.');
    } finally {
      setLookupBusy(false);
      setActiveLookupKey(null);
      setJobProgressLabel(null);
    }
  };

  const handleScannedUpcForActiveItem = async (scannedCode: string) => {
    setUpcScannerOpen(false);
    if (!activeItem) return;
    try {
      const result = await apiClient.applyEnrichmentUpdates(activeItem, { upc: scannedCode });
      setItems((prev) =>
        prev.map((i) => (i.clover_id === result.item.clover_id ? result.item : i))
      );
      onToast('success', `Saved UPC ${scannedCode} — querying online UPC databases...`);
      void runLookup('auto_all', ['upc_lookup', 'logo', 'image'], result.item);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Could not update item UPC.');
    }
  };

  const setFieldDecision = (field: string, decision: ProposalDecision) => {
    setDecisions((prev) => ({
      ...prev,
      [field]: prev[field] === decision ? 'pending' : decision,
    }));
  };

  const setAllDecisions = (decision: 'accepted' | 'rejected') => {
    const next: Record<string, ProposalDecision> = {};
    for (const p of proposals) {
      next[p.field] = decision;
    }
    setDecisions(next);
  };

  const acceptedCount = useMemo(
    () => proposals.filter((p) => decisions[p.field] === 'accepted').length,
    [proposals, decisions]
  );

  const handleClearReviewFlag = async () => {
    if (!activeItem || !activeItem.flags.includes('REVIEW')) return;
    setSaving(true);
    try {
      const result = await apiClient.applyEnrichmentUpdates(
        activeItem,
        {},
        { clearReviewFlag: true }
      );
      setItems((prev) =>
        prev.map((i) => (i.clover_id === result.item.clover_id ? result.item : i))
      );
      setLastClearedFlags(result.clearedFlags);
      onToast(
        'success',
        `Cleared REVIEW flag for ${result.item.normalized_name}.`
      );
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to clear REVIEW flag.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAccepted = async (advanceAfterSave = false) => {
    if (!activeItem || acceptedCount === 0) return;
    const patch = buildPatchFromAcceptedProposals(proposals, decisions);
    if (Object.keys(patch).length === 0) return;

    setSaving(true);
    try {
      const result = await apiClient.applyEnrichmentUpdates(activeItem, patch, {
        clearReviewFlag: clearReviewOnSave && activeItem.flags.includes('REVIEW'),
      });
      setItems((prev) =>
        prev.map((i) => (i.clover_id === result.item.clover_id ? result.item : i))
      );
      setLastClearedFlags(result.clearedFlags);
      setProposals((prev) => prev.filter((p) => decisions[p.field] !== 'accepted'));
      setDecisions((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(next)) {
          if (next[key] === 'accepted') delete next[key];
        }
        return next;
      });
      const clearedText =
        result.clearedFlags.length > 0
          ? ` · Cleared flags: ${result.clearedFlags.join(', ')}`
          : '';
      onToast(
        'success',
        `Saved ${acceptedCount} accepted field${acceptedCount === 1 ? '' : 's'} for ${result.item.normalized_name}${clearedText}.`
      );
      if (advanceAfterSave && queue.length > 1) {
        handleSelectNextItem();
      }
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to save accepted fields.');
    } finally {
      setSaving(false);
    }
  };

  const activeGaps = activeItem ? getItemMissingGaps(activeItem) : [];
  const recommendedTasks = activeItem ? getRecommendedLookupTasks(activeItem) : [];

  type SingleLookupTool = {
    key: 'logo' | 'image' | 'upc_lookup' | 'vendor_cost' | 'gemini_context';
    title: string;
    subtitle: string;
    needsData: boolean;
    statusText: string;
    icon: typeof Barcode;
  };

  const mediaAndCatalogTools: SingleLookupTool[] = activeItem
    ? [
        {
          key: 'logo',
          title: 'Fetch Brand Logo',
          subtitle: 'Official brand mark',
          needsData: !activeItem.logo_url,
          statusText: activeItem.logo_url ? 'Logo set' : 'Missing',
          icon: Award,
        },
        {
          key: 'image',
          title: 'Fetch Product Photo',
          subtitle: 'Open Food Facts & Wikimedia',
          needsData: !activeItem.image_url,
          statusText: activeItem.image_url ? 'Photo set' : 'Missing',
          icon: ImageIcon,
        },
        {
          key: 'upc_lookup',
          title: 'Lookup UPC',
          subtitle: 'UPC product databases',
          needsData: !activeItem.upc,
          statusText: activeItem.upc ? `UPC ${activeItem.upc}` : 'No UPC',
          icon: Barcode,
        },
      ]
    : [];

  const pricingAndContextTools: SingleLookupTool[] = activeItem
    ? [
        {
          key: 'vendor_cost',
          title: 'Search Price & Vendor',
          subtitle: 'Distributors & retail benchmarks',
          needsData: activeItem.cost === null || !activeItem.vendor,
          statusText:
            activeItem.cost === null
              ? 'Cost missing'
              : !activeItem.vendor
                ? 'Vendor missing'
                : `$${activeItem.cost.toFixed(2)} on file`,
          icon: DollarSign,
        },
        {
          key: 'gemini_context',
          title: 'Analyze AI Context',
          subtitle: 'Pack config, HI-5 & Title Case',
          needsData:
            activeItem.sell_pack_qty === null ||
            activeItem.packs_per_case === null ||
            activeItem.hi5_eligible === 'Confirm',
          statusText:
            activeItem.sell_pack_qty !== null && activeItem.packs_per_case !== null
              ? `${activeItem.sell_pack_qty}pk × ${activeItem.packs_per_case}/cs`
              : 'Pack config missing',
          icon: Layers,
        },
      ]
    : [];

  return (
    <div className="space-y-4">
      {/* Top KPI / Quick Filter Strip */}
      <div
        role="group"
        aria-label="Enrichment gap summary filters"
        className="grid grid-cols-2 sm:grid-cols-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800 overflow-hidden"
      >
        {[
          { key: 'all_gaps' as const, label: 'Items Needing Data', count: summary.needingData, accent: 'text-slate-900 dark:text-slate-100' },
          { key: 'missing_logo' as const, label: 'Missing Logo', count: summary.missingLogo, accent: 'text-blue-700 dark:text-blue-400' },
          { key: 'missing_cost' as const, label: 'Missing Cost', count: summary.missingCost, accent: 'text-amber-700 dark:text-amber-400' },
          { key: 'missing_pack' as const, label: 'Missing Pack Config', count: summary.missingPack, accent: 'text-amber-700 dark:text-amber-400' },
          { key: 'missing_image' as const, label: 'Missing Photo', count: summary.missingImage, accent: 'text-slate-700 dark:text-slate-300' },
        ].map((metric) => {
          const isActive = filter === metric.key;
          return (
            <button
              key={metric.key}
              type="button"
              onClick={() => setFilter(metric.key)}
              className={`px-4 py-3 text-left transition-colors cursor-pointer ${
                isActive
                  ? 'bg-blue-50/70 dark:bg-blue-950/40'
                  : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
              }`}
            >
              <div className="text-xs text-slate-500 dark:text-slate-400">{metric.label}</div>
              <div className={`mt-0.5 text-lg font-mono tabular-nums font-semibold ${metric.accent}`}>
                {metric.count}
              </div>
            </button>
          );
        })}
      </div>

      {/* Main Split Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Left: Queue List */}
        <section className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
          <div className="p-3.5 border-b border-slate-200 dark:border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xs font-display font-bold text-slate-900 dark:text-slate-100">
                Enrichment Queue ({queue.length})
              </h2>
              <button
                type="button"
                onClick={() => setFilter(filter === 'all_items' ? 'all_gaps' : 'all_items')}
                className="text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline cursor-pointer whitespace-nowrap"
              >
                {filter === 'all_items' ? 'Show gaps only' : 'Show all SKUs'}
              </button>
            </div>
            <div className="relative">
              <Search
                className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter by item, brand, UPC..."
                aria-label="Search enrichment queue"
                className="w-full h-9 pl-8 pr-3 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          <div className="divide-y divide-slate-200 dark:divide-slate-800 max-h-[240px] lg:max-h-[640px] overflow-y-auto">
            {loading ? (
              <div className="p-6 text-xs text-slate-500 dark:text-slate-400">
                Loading items needing enrichment...
              </div>
            ) : queue.length === 0 ? (
              <div className="p-6 text-center space-y-2">
                <CheckCircle2 className="w-6 h-6 mx-auto text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  No items match this filter
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Every SKU in this view has complete attributes, or clear your search term.
                </div>
              </div>
            ) : (
              queue.map((item) => {
                const gaps = getItemMissingGaps(item);
                const isSelected = item.clover_id === selectedId;
                return (
                  <button
                    key={item.clover_id}
                    type="button"
                    onClick={() => handleSelectItem(item.clover_id)}
                    className={`w-full px-3.5 py-3 text-left flex items-start gap-3 transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-blue-50/80 dark:bg-blue-950/40'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <BrandThumbnail
                      brand={item.brand}
                      itemName={item.normalized_name}
                      logoUrl={item.logo_url}
                      size="sm"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {item.normalized_name}
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {item.brand || 'No Brand'} · {item.category} ·{' '}
                        <span className="font-mono tabular-nums">${item.price.toFixed(2)}</span>
                      </div>
                      <div className="mt-1 text-[11px] text-amber-800 dark:text-amber-300 font-medium truncate">
                        {gaps.length > 0
                          ? `Missing: ${gaps.map((g) => GAP_LABELS[g]).join(' · ')}`
                          : 'Core fields complete'}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>

        {/* Right: Live Online Enrichment Workbench */}
        <section className="lg:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
          {!activeItem ? (
            <div className="p-10 text-center text-xs text-slate-500 dark:text-slate-400">
              Select an item from the queue to search live online databases and review updates.
            </div>
          ) : (
            <>
              {/* Step 1: Active SKU Identity & Primary Action */}
              <div className="p-5 border-b border-slate-200 dark:border-slate-800 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <BrandThumbnail
                      brand={activeItem.brand}
                      itemName={activeItem.normalized_name}
                      logoUrl={activeItem.logo_url}
                      size="md"
                    />
                    <div className="min-w-0">
                      <h2 className="text-base font-display font-bold text-slate-900 dark:text-slate-100 leading-snug">
                        {activeItem.normalized_name}
                      </h2>
                      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span>{activeItem.brand || 'Brand missing'}</span>
                        <span aria-hidden="true">·</span>
                        <span>{activeItem.category}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          Price ${activeItem.price.toFixed(2)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          UPC {activeItem.upc || 'Missing'}
                        </span>
                        <button
                          type="button"
                          onClick={() => setUpcScannerOpen(true)}
                          className="inline-flex items-center gap-1 text-blue-700 dark:text-blue-400 font-medium hover:underline cursor-pointer"
                        >
                          <ScanBarcode className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Scan UPC</span>
                        </button>
                      </div>

                      {/* Active Status Flags & Recently Cleared Confirmation */}
                      {(activeItem.flags.length > 0 || lastClearedFlags.length > 0) && (
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                          {activeItem.flags.length > 0 && (
                            <span className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400 font-medium">
                              <Flag className="w-3 h-3 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                              <span>Flags:</span>
                            </span>
                          )}
                          {activeItem.flags.map((flag) => (
                            <span
                              key={flag}
                              className="px-1.5 py-0.5 rounded border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 font-mono text-[10px] font-semibold"
                            >
                              {FLAG_LABELS[flag]}
                            </span>
                          ))}
                          {activeItem.flags.includes('REVIEW') && (
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => void handleClearReviewFlag()}
                              className="text-blue-700 dark:text-blue-400 font-medium hover:underline disabled:opacity-50 cursor-pointer"
                            >
                              Clear REVIEW
                            </button>
                          )}
                          {lastClearedFlags.length > 0 && (
                            <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-medium">
                              <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                              <span>
                                Cleared: {lastClearedFlags.map((f) => FLAG_LABELS[f]).join(', ')}
                              </span>
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={lookupBusy}
                      onClick={() => void runLookup('auto_all', recommendedTasks)}
                      className="h-10 px-4 inline-flex items-center justify-center gap-2 text-xs font-semibold rounded-md bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white transition-colors disabled:opacity-50 cursor-pointer whitespace-nowrap"
                    >
                      {lookupBusy && activeLookupKey === 'auto_all' ? (
                        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Sparkles className="w-4 h-4" aria-hidden="true" />
                      )}
                      <span>
                        {lookupBusy && activeLookupKey === 'auto_all'
                          ? jobProgressLabel || 'Searching Online...'
                          : activeGaps.length > 0
                            ? `Auto-Enrich Missing (${activeGaps.length})`
                            : 'Run Full Online Check'}
                      </span>
                    </button>

                    {queue.length > 1 && (
                      <button
                        type="button"
                        onClick={handleSelectNextItem}
                        disabled={lookupBusy}
                        aria-label="Skip to next SKU in queue"
                        className="h-10 px-3 inline-flex items-center gap-1.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50 cursor-pointer whitespace-nowrap"
                      >
                        <span>Next</span>
                        <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Step 2: Logical 2x2 Online Resource Lookup Grid */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Or run a single online lookup
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowRefine((v) => !v)}
                      aria-expanded={showRefine}
                      className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 cursor-pointer"
                    >
                      <span>{showRefine ? 'Hide search options' : 'Refine query or brand site'}</span>
                      {showRefine ? (
                        <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                      )}
                    </button>
                  </div>

                  {showRefine && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 p-3 rounded-md bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
                      <div>
                        <label
                          htmlFor="enrich-custom-query"
                          className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1"
                        >
                          Custom search query or UPC (optional)
                        </label>
                        <input
                          id="enrich-custom-query"
                          type="text"
                          value={customQuery}
                          onChange={(e) => setCustomQuery(e.target.value)}
                          placeholder={activeItem.normalized_name}
                          className="w-full h-9 px-2.5 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="enrich-brand-website"
                          className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1"
                        >
                          Brand website for logo (optional)
                        </label>
                        <input
                          id="enrich-brand-website"
                          type="text"
                          value={brandWebsite}
                          onChange={(e) => setBrandWebsite(e.target.value)}
                          placeholder="e.g. konabrewingco.com"
                          className="w-full h-9 px-2.5 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                        />
                      </div>
                    </div>
                  )}

                  {/* Row 1: Media & Barcode Lookups (3 balanced cards) */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    {mediaAndCatalogTools.map((tool) => {
                      const Icon = tool.icon;
                      const isRunning = lookupBusy && activeLookupKey === tool.key;
                      return (
                        <button
                          key={tool.key}
                          type="button"
                          disabled={lookupBusy}
                          onClick={() => void runLookup(tool.key)}
                          className="px-3 py-2.5 text-left rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/50 hover:border-blue-400 dark:hover:border-blue-600 hover:bg-slate-50/80 dark:hover:bg-slate-800/60 transition-colors disabled:opacity-50 cursor-pointer flex items-start gap-2.5"
                        >
                          <span className="w-8 h-8 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center shrink-0 mt-0.5">
                            {isRunning ? (
                              <Loader2 className="w-4 h-4 animate-spin text-blue-600 dark:text-blue-400" aria-hidden="true" />
                            ) : (
                              <Icon className="w-4 h-4" aria-hidden="true" />
                            )}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                                {isRunning ? 'Searching...' : tool.title}
                              </span>
                            </div>
                            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                              {tool.subtitle}
                            </div>
                            <div
                              className={`mt-1 text-[11px] font-medium truncate ${
                                tool.needsData
                                  ? 'text-amber-700 dark:text-amber-400'
                                  : 'text-slate-500 dark:text-slate-400 font-mono'
                              }`}
                            >
                              {tool.statusText}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Row 2: Pricing & AI Context Lookups (2 balanced cards) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {pricingAndContextTools.map((tool) => {
                      const Icon = tool.icon;
                      const isRunning = lookupBusy && activeLookupKey === tool.key;
                      return (
                        <button
                          key={tool.key}
                          type="button"
                          disabled={lookupBusy}
                          onClick={() => void runLookup(tool.key)}
                          className="px-3.5 py-2.5 text-left rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/50 hover:border-blue-400 dark:hover:border-blue-600 hover:bg-slate-50/80 dark:hover:bg-slate-800/60 transition-colors disabled:opacity-50 cursor-pointer flex items-start justify-between gap-3"
                        >
                          <div className="flex items-start gap-2.5 min-w-0">
                            <span className="w-8 h-8 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center shrink-0 mt-0.5">
                              {isRunning ? (
                                <Loader2 className="w-4 h-4 animate-spin text-blue-600 dark:text-blue-400" aria-hidden="true" />
                              ) : (
                                <Icon className="w-4 h-4" aria-hidden="true" />
                              )}
                            </span>
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                                {isRunning ? `Checking ${tool.title}...` : tool.title}
                              </div>
                              <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                {tool.subtitle}
                              </div>
                            </div>
                          </div>
                          <span
                            className={`text-[11px] font-medium whitespace-nowrap shrink-0 mt-0.5 ${
                              tool.needsData
                                ? 'text-amber-700 dark:text-amber-400'
                                : 'text-slate-500 dark:text-slate-400 font-mono'
                            }`}
                          >
                            {tool.statusText}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Live Online Sources & Market Benchmarks */}
              {(sourcesChecked.length > 0 || marketReferences.length > 0 || lookupNotice) && (
                <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 space-y-2.5">
                  {sourcesChecked.length > 0 && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600 dark:text-slate-400">
                      <span className="inline-flex items-center gap-1 font-semibold text-slate-700 dark:text-slate-300">
                        <Globe className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Live sources checked:</span>
                      </span>
                      {sourcesChecked.map((src, idx) => (
                        <span key={`${src.source}-${idx}`} className="inline-flex items-center gap-1">
                          <span className="font-medium text-slate-800 dark:text-slate-200">
                            {src.source}
                          </span>
                          <span
                            className={
                              src.status === 'matched'
                                ? 'text-emerald-700 dark:text-emerald-400 font-medium'
                                : src.status === 'error' || src.status === 'unavailable'
                                  ? 'text-amber-700 dark:text-amber-400'
                                  : 'text-slate-500 dark:text-slate-400'
                            }
                          >
                            (
                            {src.status === 'matched'
                              ? 'Match'
                              : src.status === 'unavailable'
                                ? 'Needs API key'
                                : src.status === 'error'
                                  ? 'Error'
                                  : 'No match'}
                            )
                          </span>
                          {idx < sourcesChecked.length - 1 && (
                            <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
                              ·
                            </span>
                          )}
                        </span>
                      ))}
                    </div>
                  )}

                  {lookupNotice && (
                    <div className="text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                      <span>{lookupNotice}</span>
                    </div>
                  )}

                  {marketReferences.length > 0 && (
                    <div className="pt-1 space-y-1">
                      <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                        Online Retail Price Benchmarks (Reference Only — Never Auto-Saved as Cost)
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                        {marketReferences.map((ref, i) => (
                          <span key={`${ref.retailer}-${i}`} className="inline-flex items-center gap-1.5">
                            <span className="text-slate-700 dark:text-slate-300">{ref.retailer}</span>
                            <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                              ${ref.price.toFixed(2)}
                            </span>
                            {ref.url && (
                              <a
                                href={ref.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-700 dark:text-blue-400 hover:underline inline-flex items-center"
                                aria-label={`Open ${ref.retailer} listing`}
                              >
                                <ExternalLink className="w-3 h-3" aria-hidden="true" />
                              </a>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {citations.length > 0 && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="font-medium text-slate-600 dark:text-slate-300">Web sources:</span>
                      {citations.slice(0, 4).map((cit) => (
                        <a
                          key={cit.url}
                          href={cit.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-blue-700 dark:text-blue-400 hover:underline max-w-[220px] truncate"
                        >
                          <span className="truncate">{cit.title}</span>
                          <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Step 3: Proposed Changes Diff Review */}
              <div className="p-5 space-y-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-display font-bold text-slate-900 dark:text-slate-100">
                      Review Proposed Changes
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Accept or reject each discovered field before saving. Nothing overwrites silently.
                    </p>
                  </div>
                  {proposals.length > 0 && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setAllDecisions('accepted')}
                        className="h-8 px-3 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                      >
                        Accept All
                      </button>
                      <button
                        type="button"
                        onClick={() => setAllDecisions('rejected')}
                        className="h-8 px-3 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                      >
                        Reject All
                      </button>
                    </div>
                  )}
                </div>

                {proposals.length === 0 ? (
                  <div className="border border-dashed border-slate-300 dark:border-slate-700 rounded-lg p-7 text-center space-y-2 bg-slate-50/40 dark:bg-slate-950/30">
                    {hasSearchedItem ? (
                      <>
                        <CheckCircle2 className="w-6 h-6 mx-auto text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                        <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                          No unreviewed proposals remaining
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                          Try refining the search query or brand website above, scan the UPC bottle barcode, or move to the next SKU.
                        </div>
                      </>
                    ) : (
                      <>
                        <Globe className="w-6 h-6 mx-auto text-slate-400 dark:text-slate-500" aria-hidden="true" />
                        <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                          {activeGaps.length > 0
                            ? `Ready to search online for ${activeGaps.map((g) => GAP_LABELS[g]).join(', ')}`
                            : 'This SKU has all core fields filled'}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          Click <strong>Auto-Enrich Missing</strong> above or pick a single online lookup button.
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden max-h-[360px] overflow-y-auto">
                    {proposals.map((prop) => {
                      const decision = decisions[prop.field] ?? 'pending';
                      const isImageField = prop.field === 'logo_url' || prop.field === 'image_url';
                      const label = FIELD_LABELS[prop.field] ?? prop.field;

                      return (
                        <div
                          key={prop.field}
                          className={`p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
                            decision === 'accepted'
                              ? 'bg-emerald-50/60 dark:bg-emerald-950/25'
                              : decision === 'rejected'
                                ? 'bg-slate-50 dark:bg-slate-950/60 opacity-65'
                                : 'bg-white dark:bg-slate-900'
                          }`}
                        >
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                              <span className="font-semibold text-slate-900 dark:text-slate-100">
                                {label}
                              </span>
                              <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
                                ·
                              </span>
                              <span className="text-[11px] text-slate-500 dark:text-slate-400 capitalize">
                                {prop.confidence} confidence
                              </span>
                            </div>

                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="text-slate-500 dark:text-slate-400 line-through">
                                {formatFieldValue(prop.field, prop.currentValue)}
                              </span>
                              <span className="text-slate-400" aria-hidden="true">
                                →
                              </span>
                              {isImageField && typeof prop.proposedValue === 'string' ? (
                                <ProposedImagePreview src={prop.proposedValue} label={label} />
                              ) : (
                                <span className="font-mono font-semibold text-emerald-800 dark:text-emerald-300">
                                  {formatFieldValue(prop.field, prop.proposedValue)}
                                </span>
                              )}
                            </div>

                            <div className="text-[11px] text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-x-2">
                              <span>Source: {prop.source}</span>
                              {prop.sourceUrl && (
                                <a
                                  href={prop.sourceUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-0.5 text-blue-700 dark:text-blue-400 hover:underline"
                                >
                                  <span>Verify</span>
                                  <ExternalLink className="w-3 h-3" aria-hidden="true" />
                                </a>
                              )}
                            </div>
                            {prop.note && (
                              <div className="text-[11px] text-amber-800 dark:text-amber-300">
                                {prop.note}
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              aria-pressed={decision === 'accepted'}
                              onClick={() => setFieldDecision(prop.field, 'accepted')}
                              className={`h-9 px-3 inline-flex items-center gap-1.5 text-xs font-semibold rounded-md border transition-colors cursor-pointer ${
                                decision === 'accepted'
                                  ? 'bg-emerald-700 border-emerald-700 text-white dark:bg-emerald-600 dark:border-emerald-600'
                                  : 'bg-white dark:bg-slate-950 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-emerald-600'
                              }`}
                            >
                              <Check className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>Accept</span>
                            </button>
                            <button
                              type="button"
                              aria-pressed={decision === 'rejected'}
                              onClick={() => setFieldDecision(prop.field, 'rejected')}
                              className={`h-9 px-3 inline-flex items-center gap-1.5 text-xs font-semibold rounded-md border transition-colors cursor-pointer ${
                                decision === 'rejected'
                                  ? 'bg-slate-700 border-slate-700 text-white dark:bg-slate-600 dark:border-slate-600'
                                  : 'bg-white dark:bg-slate-950 border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-red-500'
                              }`}
                            >
                              <X className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>Reject</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Footer Save Bar */}
              <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 dark:text-slate-400">
                  <span>
                    {proposals.length === 0
                      ? 'Select a lookup above to pull live online data for this item.'
                      : acceptedCount === 0
                        ? 'Accept at least one proposed field to enable saving.'
                        : `${acceptedCount} of ${proposals.length} proposed field${proposals.length === 1 ? '' : 's'} ready to save.`}
                  </span>
                  {activeItem.flags.includes('REVIEW') && acceptedCount > 0 && (
                    <label className="inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-300 font-medium cursor-pointer">
                      <input
                        type="checkbox"
                        checked={clearReviewOnSave}
                        onChange={(e) => setClearReviewOnSave(e.target.checked)}
                        className="rounded border-slate-300 dark:border-slate-700 text-blue-700 focus:ring-blue-600"
                      />
                      <span>Clear REVIEW flag on save</span>
                    </label>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void loadCatalog()}
                    className="h-9 px-3 inline-flex items-center gap-1.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap"
                  >
                    <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Refresh</span>
                  </button>

                  {queue.length > 1 && acceptedCount > 0 && (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void handleSaveAccepted(true)}
                      className="h-9 px-3.5 inline-flex items-center gap-1.5 text-xs font-semibold rounded-md border border-blue-700 dark:border-blue-500 text-blue-700 dark:text-blue-400 bg-white dark:bg-slate-900 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors disabled:opacity-40 cursor-pointer whitespace-nowrap"
                    >
                      <span>Save &amp; Next SKU</span>
                      <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={saving || acceptedCount === 0}
                    onClick={() => void handleSaveAccepted(false)}
                    className="h-9 px-4 inline-flex items-center gap-1.5 text-xs font-semibold rounded-md bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white transition-colors disabled:opacity-40 cursor-pointer whitespace-nowrap"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>
                      {saving
                        ? 'Saving...'
                        : `Save Accepted (${acceptedCount})`}
                    </span>
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      <BarcodeScannerModal
        open={upcScannerOpen}
        title="Scan Bottle UPC for Enrichment"
        subtitle={
          activeItem
            ? `Scan the UPC on ${activeItem.normalized_name} to save its barcode and immediately query online product databases.`
            : undefined
        }
        onDetected={(code) => void handleScannedUpcForActiveItem(code)}
        onClose={() => setUpcScannerOpen(false)}
      />
    </div>
  );
}
