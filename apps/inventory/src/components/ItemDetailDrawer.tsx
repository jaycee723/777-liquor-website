import React, { useEffect, useState } from 'react';
import { X, Wand2, AlertTriangle, Check, ScanBarcode, CloudUpload } from 'lucide-react';
import { CanonicalItem, Hi5Status, PatchItemPayload } from '../types/inventory';
import {
  calculateMarginPercent,
  determineHi5Eligibility,
  normalizeItemName,
  validateNumericPatch,
} from '../utils/inventoryRules';
import { apiClient } from '../services/apiClient';
import { BrandThumbnail } from './BrandThumbnail';
import { BarcodeScannerModal } from './BarcodeScannerModal';

interface ItemDetailDrawerProps {
  item: CanonicalItem | null;
  vendors: string[];
  categories: string[];
  onClose: () => void;
  onSave: (cloverId: string, patch: PatchItemPayload) => Promise<void>;
}

export function ItemDetailDrawer({
  item,
  vendors,
  categories,
  onClose,
  onSave,
}: ItemDetailDrawerProps) {
  const [normalizedName, setNormalizedName] = useState('');
  const [brand, setBrand] = useState('');
  const [category, setCategory] = useState('');
  const [subcategory, setSubcategory] = useState('');
  const [upc, setUpc] = useState('');
  const [priceStr, setPriceStr] = useState('');
  const [costStr, setCostStr] = useState('');
  const [costSource, setCostSource] = useState('');
  const [vendor, setVendor] = useState('');
  const [unitSize, setUnitSize] = useState('');
  const [sellPackQtyStr, setSellPackQtyStr] = useState('');
  const [packsPerCaseStr, setPacksPerCaseStr] = useState('');
  const [quantityStr, setQuantityStr] = useState('');
  const [hi5Eligible, setHi5Eligible] = useState<Hi5Status>('No');
  const [needsReview, setNeedsReview] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [cloverNotice, setCloverNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pushingClover, setPushingClover] = useState(false);
  const [upcScannerOpen, setUpcScannerOpen] = useState(false);

  useEffect(() => {
    if (!item) return;
    setNormalizedName(item.normalized_name);
    setBrand(item.brand);
    setCategory(item.category);
    setSubcategory(item.subcategory);
    setUpc(item.upc);
    setPriceStr(item.price.toFixed(2));
    setCostStr(item.cost !== null ? item.cost.toFixed(2) : '');
    setCostSource(item.cost_source ?? '');
    setVendor(item.vendor ?? '');
    setUnitSize(item.unit_size);
    setSellPackQtyStr(item.sell_pack_qty !== null ? String(item.sell_pack_qty) : '');
    setPacksPerCaseStr(item.packs_per_case !== null ? String(item.packs_per_case) : '');
    setQuantityStr(String(item.quantity));
    setHi5Eligible(item.hi5_eligible);
    setNeedsReview(item.flags.includes('REVIEW'));
    setFormError(null);
    setCloverNotice(null);
  }, [item]);

  useEffect(() => {
    if (!item) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !upcScannerOpen) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [item, onClose, upcScannerOpen]);

  if (!item) return null;

  const parsedPrice = Number(priceStr);
  const parsedCost = costStr.trim() === '' ? null : Number(costStr);
  const liveMargin =
    Number.isFinite(parsedPrice) && (parsedCost === null || Number.isFinite(parsedCost))
      ? calculateMarginPercent(parsedPrice, parsedCost)
      : null;

  const normalizedPreview = normalizeItemName(normalizedName || item.name);
  const showNormalizeHint = normalizedPreview !== normalizedName;

  const handleApplyNormalize = () => {
    setNormalizedName(normalizeItemName(normalizedName || item.name));
  };

  const handleAutoDetectHi5 = () => {
    setHi5Eligible(determineHi5Eligibility(category, subcategory, normalizedName || item.name));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!normalizedName.trim()) {
      setFormError('Normalized item name is required.');
      return;
    }

    const priceCheck = validateNumericPatch('price', priceStr);
    if (!priceCheck.valid || priceCheck.value === null) {
      setFormError(!priceCheck.valid ? priceCheck.error : 'Price is required.');
      return;
    }

    const costCheck = validateNumericPatch('cost', costStr);
    if (!costCheck.valid) {
      setFormError(costCheck.error);
      return;
    }

    const qtyCheck = validateNumericPatch('quantity', quantityStr);
    if (!qtyCheck.valid || qtyCheck.value === null) {
      setFormError(!qtyCheck.valid ? qtyCheck.error : 'Quantity is required.');
      return;
    }

    const sellPackQty = sellPackQtyStr.trim() === '' ? null : Number(sellPackQtyStr);
    if (sellPackQty !== null && (!Number.isInteger(sellPackQty) || sellPackQty <= 0)) {
      setFormError('Sell Pack Qty must be a positive whole number or blank.');
      return;
    }

    const packsPerCase = packsPerCaseStr.trim() === '' ? null : Number(packsPerCaseStr);
    if (packsPerCase !== null && (!Number.isInteger(packsPerCase) || packsPerCase <= 0)) {
      setFormError('Packs Per Case must be a positive whole number or blank.');
      return;
    }

    const nextFlags = needsReview
      ? Array.from(new Set([...item.flags, 'REVIEW' as const]))
      : item.flags.filter((f) => f !== 'REVIEW');

    setSaving(true);
    try {
      await onSave(item.clover_id, {
        normalized_name: normalizedName.trim(),
        brand: brand.trim(),
        category: category.trim() || item.category,
        subcategory: subcategory.trim(),
        upc: upc.trim(),
        price: priceCheck.value,
        cost: costCheck.value,
        cost_source: costCheck.value === null ? null : costSource.trim() || 'Manual Counter Edit',
        vendor: vendor.trim() || null,
        unit_size: unitSize.trim(),
        sell_pack_qty: sellPackQty,
        packs_per_case: packsPerCase,
        quantity: qtyCheck.value,
        hi5_eligible: hi5Eligible,
        flags: nextFlags,
      });
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to save item.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-slate-950/40 dark:bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="drawer-item-title"
    >
      <div className="fixed inset-0" onClick={onClose} aria-hidden="true" />

      <div className="relative z-10 w-full max-w-[480px] h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <BrandThumbnail
              logoUrl={item.logo_url}
              brand={brand || item.brand}
              itemName={normalizedName || item.name}
              size="md"
            />
            <div className="min-w-0">
              <p className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                {item.clover_id} · UPC {item.upc || 'Missing'}
              </p>
              <h2
                id="drawer-item-title"
                className="text-base font-display font-bold text-slate-900 dark:text-slate-100 truncate"
              >
                {item.normalized_name}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close item detail drawer"
            className="p-2 rounded-md text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Scrollable Form */}
        <form id="item-detail-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {formError && (
            <div
              role="alert"
              className="px-3.5 py-2.5 text-xs font-medium rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/60 text-red-800 dark:text-red-200 flex items-center gap-2"
            >
              <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{formError}</span>
            </div>
          )}

          {/* Section 1: Identity & Capitalization */}
          <section className="space-y-3.5">
            <div className="space-y-0.5">
              <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 tracking-wide">
                Catalog Identity
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate" title={item.name}>
                Raw Clover: <span className="font-mono text-slate-700 dark:text-slate-300">{item.name}</span>
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label
                  htmlFor="drawer-normalized-name"
                  className="text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Normalized Item Name
                </label>
                <button
                  type="button"
                  onClick={handleApplyNormalize}
                  className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
                >
                  <Wand2 className="w-3 h-3" aria-hidden="true" />
                  <span>Normalize Title Case</span>
                </button>
              </div>
              <input
                id="drawer-normalized-name"
                type="text"
                value={normalizedName}
                onChange={(e) => setNormalizedName(e.target.value)}
                className="w-full h-10 px-3 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
              {showNormalizeHint && (
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  Store rule preview: <span className="text-slate-800 dark:text-slate-200 font-medium">{normalizedPreview}</span>
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="drawer-brand"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Brand
                </label>
                <input
                  id="drawer-brand"
                  type="text"
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                  className="w-full h-10 px-3 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label
                  htmlFor="drawer-upc"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  UPC Barcode
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    id="drawer-upc"
                    type="text"
                    value={upc}
                    onChange={(e) => setUpc(e.target.value)}
                    className="flex-1 min-w-0 h-10 px-3 text-sm font-mono tabular-nums rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  <button
                    type="button"
                    onClick={() => setUpcScannerOpen(true)}
                    aria-label="Scan UPC for this item"
                    title="Scan UPC barcode with camera"
                    className="h-10 w-10 inline-flex items-center justify-center rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shrink-0 cursor-pointer"
                  >
                    <ScanBarcode className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="drawer-category"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Category
                </label>
                <select
                  id="drawer-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full h-10 px-3 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  {Array.from(new Set([...categories, category])).map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="drawer-subcategory"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Subcategory
                </label>
                <input
                  id="drawer-subcategory"
                  type="text"
                  value={subcategory}
                  onChange={(e) => setSubcategory(e.target.value)}
                  className="w-full h-10 px-3 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            </div>
          </section>

          {/* Section 2: Pricing, Cost & Margin */}
          <section className="pt-5 border-t border-slate-200 dark:border-slate-800 space-y-3.5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 tracking-wide">
                Pricing &amp; Vendor Cost
              </h3>
              <span className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300">
                Margin: {liveMargin !== null ? `${liveMargin.toFixed(1)}%` : 'Missing cost'}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label
                  htmlFor="drawer-price"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Current Price ($)
                </label>
                <input
                  id="drawer-price"
                  type="text"
                  inputMode="decimal"
                  value={priceStr}
                  onChange={(e) => setPriceStr(e.target.value)}
                  className="w-full h-10 px-3 text-sm font-mono tabular-nums rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label
                  htmlFor="drawer-cost"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Unit Cost ($)
                </label>
                <input
                  id="drawer-cost"
                  type="text"
                  inputMode="decimal"
                  placeholder="Missing"
                  value={costStr}
                  onChange={(e) => setCostStr(e.target.value)}
                  className="w-full h-10 px-3 text-sm font-mono tabular-nums rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-amber-600 dark:placeholder:text-amber-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <span className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                  Suggested (API)
                </span>
                <div className="h-10 px-3 flex items-center text-sm font-mono tabular-nums rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-slate-600 dark:text-slate-300">
                  {item.suggested_price !== null ? `$${item.suggested_price.toFixed(2)}` : '—'}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="drawer-vendor"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Vendor
                </label>
                <input
                  id="drawer-vendor"
                  list="vendor-suggestions"
                  type="text"
                  placeholder="Unassigned"
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                  className="w-full h-10 px-3 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                <datalist id="vendor-suggestions">
                  {vendors.map((v) => (
                    <option key={v} value={v} />
                  ))}
                </datalist>
              </div>

              <div>
                <label
                  htmlFor="drawer-cost-source"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Cost Source
                </label>
                <input
                  id="drawer-cost-source"
                  type="text"
                  placeholder="Invoice # or manual"
                  value={costSource}
                  onChange={(e) => setCostSource(e.target.value)}
                  className="w-full h-10 px-3 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            </div>
          </section>

          {/* Section 3: Pack Config, Quantity & Hawaii HI-5 */}
          <section className="pt-5 border-t border-slate-200 dark:border-slate-800 space-y-3.5">
            <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 tracking-wide">
              Pack Configuration &amp; Hawaii HI-5
            </h3>

            <div className="grid grid-cols-4 gap-3">
              <div>
                <label
                  htmlFor="drawer-unit-size"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Unit Size
                </label>
                <input
                  id="drawer-unit-size"
                  type="text"
                  value={unitSize}
                  onChange={(e) => setUnitSize(e.target.value)}
                  className="w-full h-10 px-2.5 text-sm font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label
                  htmlFor="drawer-sell-pack"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Sell Pack
                </label>
                <input
                  id="drawer-sell-pack"
                  type="text"
                  inputMode="numeric"
                  placeholder="—"
                  value={sellPackQtyStr}
                  onChange={(e) => setSellPackQtyStr(e.target.value)}
                  className="w-full h-10 px-2.5 text-sm font-mono tabular-nums rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label
                  htmlFor="drawer-packs-case"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Packs/Case
                </label>
                <input
                  id="drawer-packs-case"
                  type="text"
                  inputMode="numeric"
                  placeholder="—"
                  value={packsPerCaseStr}
                  onChange={(e) => setPacksPerCaseStr(e.target.value)}
                  className="w-full h-10 px-2.5 text-sm font-mono tabular-nums rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label
                  htmlFor="drawer-qty"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  On Hand
                </label>
                <input
                  id="drawer-qty"
                  type="text"
                  inputMode="numeric"
                  value={quantityStr}
                  onChange={(e) => setQuantityStr(e.target.value)}
                  className="w-full h-10 px-2.5 text-sm font-mono tabular-nums rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            </div>

            <div className="pt-1">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Hawaii HI-5 Deposit ($0.06/container)
                </span>
                <button
                  type="button"
                  onClick={handleAutoDetectHi5}
                  className="text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
                >
                  Apply HI-5 Rule
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(['Yes', 'No', 'Confirm'] as Hi5Status[]).map((status) => {
                  const active = hi5Eligible === status;
                  return (
                    <button
                      key={status}
                      type="button"
                      onClick={() => setHi5Eligible(status)}
                      className={`h-10 px-3 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                        active
                          ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-950 dark:border-slate-100'
                          : 'bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      {status === 'Yes' ? 'Yes ($0.06)' : status === 'No' ? 'No (Exempt)' : 'Confirm'}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                Applies to beer, malt RTDs, and non-alcoholic beverages. Spirits and wine are exempt.
              </p>
            </div>
          </section>

          {/* Section 4: Flags & Review Status */}
          <section className="pt-5 border-t border-slate-200 dark:border-slate-800 space-y-3">
            <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 tracking-wide">
              Triage &amp; Flags
            </h3>

            <label className="flex items-center gap-3 p-3 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 cursor-pointer">
              <input
                type="checkbox"
                checked={needsReview}
                onChange={(e) => setNeedsReview(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
              />
              <div className="text-xs">
                <span className="font-medium text-slate-900 dark:text-slate-100">
                  Flag for manual review (REVIEW)
                </span>
                <p className="text-slate-500 dark:text-slate-400">
                  Uncheck once product details and pack count have been verified.
                </p>
              </div>
            </label>

            <div className="text-xs text-slate-500 dark:text-slate-400">
              Active flags:{' '}
              {item.flags.length === 0 ? (
                <span className="text-emerald-700 dark:text-emerald-400 font-medium">None</span>
              ) : (
                <span className="font-mono text-slate-800 dark:text-slate-200">
                  {item.flags.join(' · ')}
                </span>
              )}
            </div>
          </section>
        </form>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 space-y-2.5">
          {cloverNotice && (
            <div className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">
              {cloverNotice}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <button
              type="button"
              disabled={pushingClover || saving}
              onClick={async () => {
                setFormError(null);
                setCloverNotice(null);
                setPushingClover(true);
                try {
                  const candidate: CanonicalItem = {
                    ...item,
                    normalized_name: normalizeItemName(normalizedName || item.name),
                    price: Number.isFinite(parsedPrice) ? parsedPrice : item.price,
                    cost: parsedCost !== null && Number.isFinite(parsedCost) ? parsedCost : null,
                    upc: upc.trim(),
                    quantity: Number.isFinite(Number(quantityStr)) ? Number(quantityStr) : item.quantity,
                  };
                  const res = await apiClient.pushItemsToClover([candidate]);
                  if (res.updatedCount > 0) {
                    setCloverNotice(`Pushed "${candidate.normalized_name}" to Clover POS.`);
                  } else {
                    setFormError(res.results[0]?.error || 'Clover update could not be applied.');
                  }
                } catch (err) {
                  setFormError(
                    err instanceof Error ? err.message : 'Unable to push fix to Clover POS.'
                  );
                } finally {
                  setPushingClover(false);
                }
              }}
              className="h-10 px-3.5 inline-flex items-center gap-1.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer"
            >
              <CloudUpload className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{pushingClover ? 'Pushing…' : 'Push Fix to Clover'}</span>
            </button>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="h-10 px-4 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="item-detail-form"
                disabled={saving}
                className="h-10 px-5 inline-flex items-center gap-2 text-xs font-semibold rounded-md bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white transition-colors disabled:opacity-60 cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{saving ? 'Saving...' : 'Save Changes'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
      <BarcodeScannerModal
        open={upcScannerOpen}
        title="Scan Item UPC"
        subtitle={`Scan the barcode on ${item.normalized_name} to update its UPC field.`}
        onDetected={(code) => {
          setUpc(code);
          setUpcScannerOpen(false);
        }}
        onClose={() => setUpcScannerOpen(false)}
      />
    </div>
  );
}
