import { Pencil, Phone, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useInventoryItem } from "../hooks/useInventory";
import { STORE } from "../lib/store-info";
import { saveCoolerItem, type InventoryItem } from "../services/inventory.service";
import { BrandLogo } from "./brand-logo";
import { useFirebaseAuth } from "./FirebaseProvider";

type LiquorDetailModalProps = {
  item: InventoryItem | null;
  onClose: () => void;
  onSelectBrand?: (brand: string) => void;
  openerRef?: React.RefObject<HTMLElement | null>;
};

function formatPrice(price: number): string {
  return `$${price.toFixed(2)}`;
}

/**
 * Accessible Midnight Slate & Cool Cyan product detail modal triggered when clicking
 * any item in LiquorCatalog. Fetches live additional information directly from Firestore.
 */
export function LiquorDetailModal({
  item,
  onClose,
  onSelectBrand,
  openerRef,
}: LiquorDetailModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const { user, isAdmin } = useFirebaseAuth();
  const { detail, loading, error, refresh } = useInventoryItem(item);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [priceInput, setPriceInput] = useState("");
  const [abvInput, setAbvInput] = useState("");
  const [originInput, setOriginInput] = useState("");
  const [descriptionInput, setDescriptionInput] = useState("");
  const [inStockInput, setInStockInput] = useState(true);

  const active = detail ?? (item ? { ...item, inStock: true, updatedAt: null } : null);

  useEffect(() => {
    setEditing(false);
    setSaveMessage(null);
    setSaveError(null);
  }, [item?.id]);

  useEffect(() => {
    if (!detail) return;
    setPriceInput(detail.price.toFixed(2));
    setAbvInput(detail.abv ?? "");
    setOriginInput(detail.origin ?? "");
    setDescriptionInput(detail.description ?? "");
    setInStockInput(detail.inStock);
  }, [detail]);

  useEffect(() => {
    if (!item) return;
    const opener = openerRef?.current ?? null;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !modalRef.current) return;
      const focusables = Array.from(
        modalRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first || !modalRef.current.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !modalRef.current.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, [item, onClose, openerRef]);

  if (!item || !active) return null;

  const handleSaveDetails = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || !isAdmin) return;
    setSaving(true);
    setSaveError(null);
    setSaveMessage(null);

    try {
      const parsedPrice = Number.parseFloat(priceInput);
      await saveCoolerItem(
        {
          id: active.id,
          name: active.name,
          brand: active.brand,
          category: active.category,
          size: active.size,
          price: parsedPrice,
          abv: abvInput,
          origin: originInput,
          description: descriptionInput,
          inStock: inStockInput,
        },
        user.uid,
      );
      await refresh();
      setEditing(false);
      setSaveMessage("Product details updated.");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not save product details.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[#03070E]/85 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="liquor-detail-title"
        onClick={(e) => e.stopPropagation()}
        className="relative max-h-[calc(100dvh-2rem)] w-full max-w-xl overflow-y-auto rounded-2xl border border-slate-700/80 bg-[#0D1626] p-6 text-slate-100 shadow-2xl sm:p-7"
      >
        {/* Close Button */}
        <button
          type="button"
          autoFocus
          aria-label="Close product details"
          onClick={onClose}
          className="absolute right-4 top-4 inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-slate-700/80 bg-[#111B2B] text-slate-300 transition hover:border-cyan-400 hover:text-cyan-300"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>

        {/* Top Identity Header */}
        <div className="flex items-start gap-4 pr-12">
          <BrandLogo brand={active.brand} size={72} showFallbackBadge className="shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-slate-400">
              {active.category} · {active.brand}
            </p>
            <h2
              id="liquor-detail-title"
              className="mt-1 font-display text-2xl font-extrabold leading-tight text-slate-100"
            >
              {active.name}
            </h2>
          </div>
        </div>

        {/* Contiguous Price & Availability Strip */}
        <div className="mt-6 flex flex-wrap items-baseline justify-between gap-4 rounded-xl border border-slate-800 bg-[#08101C] px-5 py-4">
          <div>
            <p className="text-xs text-slate-400">In-Store Price</p>
            <p className="mt-0.5 font-mono text-2xl font-bold tabular-nums text-cyan-300">
              {formatPrice(active.price)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-400">Size / Format</p>
            <p className="mt-0.5 font-mono text-sm font-semibold text-slate-200">
              {active.size || "Standard"}
            </p>
          </div>
        </div>

        {/* Firestore Product Details Section */}
        <div className="mt-6 border-t border-slate-800/90 pt-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-display text-sm font-bold text-slate-200">Product Information</h3>
            {isAdmin && !loading && !editing && (
              <button
                type="button"
                onClick={() => {
                  setEditing(true);
                  setSaveMessage(null);
                  setSaveError(null);
                }}
                className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 bg-[#111B2B] px-3 text-xs font-semibold text-cyan-300 transition hover:border-cyan-400"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                Edit details
              </button>
            )}
          </div>

          {loading ? (
            <div className="mt-4 space-y-3" role="status" aria-busy="true">
              <span className="sr-only">Loading product details from Firestore…</span>
              <div className="skeleton-shimmer h-4 w-11/12 rounded bg-slate-800/90" />
              <div className="skeleton-shimmer h-4 w-3/4 rounded bg-slate-800/80" />
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="skeleton-shimmer h-14 rounded-xl bg-slate-800/70" />
                <div className="skeleton-shimmer h-14 rounded-xl bg-slate-800/70" />
                <div className="skeleton-shimmer h-14 rounded-xl bg-slate-800/70" />
                <div className="skeleton-shimmer h-14 rounded-xl bg-slate-800/70" />
              </div>
            </div>
          ) : error ? (
            <div className="mt-4 rounded-xl border border-red-900/60 bg-red-950/20 p-4 text-sm text-red-200">
              <p className="m-0">{error}</p>
              <button
                type="button"
                onClick={() => void refresh()}
                className="mt-3 inline-flex cursor-pointer text-xs font-semibold text-cyan-300 underline"
              >
                Retry loading details
              </button>
            </div>
          ) : editing && isAdmin ? (
            <form onSubmit={(e) => void handleSaveDetails(e)} className="mt-4 space-y-3.5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="block text-xs font-medium text-slate-300">
                  Price ($)
                  <input
                    type="number"
                    required
                    step="0.01"
                    min="0.01"
                    max="10000"
                    value={priceInput}
                    onChange={(e) => setPriceInput(e.target.value)}
                    disabled={saving}
                    className="mt-1.5 min-h-10 w-full rounded-xl border border-slate-700 bg-[#070D14] px-3 font-mono text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
                  />
                </label>
                <label className="block text-xs font-medium text-slate-300">
                  ABV (optional)
                  <input
                    type="text"
                    maxLength={20}
                    value={abvInput}
                    onChange={(e) => setAbvInput(e.target.value)}
                    placeholder="e.g. 5.0% ABV"
                    disabled={saving}
                    className="mt-1.5 min-h-10 w-full rounded-xl border border-slate-700 bg-[#070D14] px-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
                  />
                </label>
                <label className="block text-xs font-medium text-slate-300">
                  Origin (optional)
                  <input
                    type="text"
                    maxLength={80}
                    value={originInput}
                    onChange={(e) => setOriginInput(e.target.value)}
                    placeholder="e.g. Honolulu, HI"
                    disabled={saving}
                    className="mt-1.5 min-h-10 w-full rounded-xl border border-slate-700 bg-[#070D14] px-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
                  />
                </label>
              </div>

              <label className="block text-xs font-medium text-slate-300">
                Description / Tasting Notes (optional)
                <textarea
                  rows={3}
                  maxLength={500}
                  value={descriptionInput}
                  onChange={(e) => setDescriptionInput(e.target.value)}
                  placeholder="Crisp, refreshing, available chilled in the cooler door…"
                  disabled={saving}
                  className="mt-1.5 w-full rounded-xl border border-slate-700 bg-[#070D14] p-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
                />
              </label>

              <label className="inline-flex cursor-pointer items-center gap-2.5 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={inStockInput}
                  onChange={(e) => setInStockInput(e.target.checked)}
                  disabled={saving}
                  className="h-4 w-4 accent-cyan-400"
                />
                Currently stocked in the Cooler Door
              </label>

              {saveError && (
                <p role="alert" className="text-xs text-red-300">
                  {saveError}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-xl bg-cyan-400 px-4 text-sm font-bold text-[#06131D] transition hover:bg-cyan-300 disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save details"}
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setEditing(false)}
                  className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-xl border border-slate-700 bg-[#111B2B] px-4 text-sm font-semibold text-slate-300 transition hover:border-slate-500"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div className="mt-3 space-y-4">
              {saveMessage && (
                <p role="status" className="text-xs font-medium text-cyan-300">
                  {saveMessage}
                </p>
              )}

              <p className="text-sm leading-relaxed text-slate-300">
                {detail?.description ||
                  `Available at ${STORE.name} in Honolulu. Stop by the Cooler Door or call ahead to verify current chilled stock and pricing.`}
              </p>

              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl border border-slate-800/90 bg-[#111B2B]/80 px-4 py-3">
                  <dt className="text-xs text-slate-400">Brand</dt>
                  <dd className="mt-0.5 font-semibold text-slate-100">{active.brand}</dd>
                </div>
                <div className="rounded-xl border border-slate-800/90 bg-[#111B2B]/80 px-4 py-3">
                  <dt className="text-xs text-slate-400">Category</dt>
                  <dd className="mt-0.5 font-semibold text-slate-100">{active.category}</dd>
                </div>
                <div className="rounded-xl border border-slate-800/90 bg-[#111B2B]/80 px-4 py-3">
                  <dt className="text-xs text-slate-400">Availability</dt>
                  <dd className="mt-0.5 font-semibold text-slate-100">
                    {active.inStock ? "In Cooler · 21+ ID Required" : "Call to Confirm Stock"}
                  </dd>
                </div>
                <div className="rounded-xl border border-slate-800/90 bg-[#111B2B]/80 px-4 py-3">
                  <dt className="text-xs text-slate-400">
                    {detail?.abv ? "ABV" : detail?.origin ? "Origin" : "Store Pickup"}
                  </dt>
                  <dd className="mt-0.5 font-semibold text-slate-100">
                    {detail?.abv || detail?.origin || "Honolulu · In-Store Only"}
                  </dd>
                </div>
                {detail?.abv && detail?.origin && (
                  <div className="rounded-xl border border-slate-800/90 bg-[#111B2B]/80 px-4 py-3">
                    <dt className="text-xs text-slate-400">Origin</dt>
                    <dd className="mt-0.5 font-semibold text-slate-100">{detail.origin}</dd>
                  </div>
                )}
                {detail?.updatedAt && (
                  <div className="rounded-xl border border-slate-800/90 bg-[#111B2B]/80 px-4 py-3">
                    <dt className="text-xs text-slate-400">Last Updated</dt>
                    <dd className="mt-0.5 font-mono text-xs font-medium text-slate-200">
                      {detail.updatedAt}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/90 pt-5">
          <div className="flex flex-wrap items-center gap-3">
            <a
              href={`tel:${STORE.telephone}`}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-cyan-400 px-4 text-sm font-bold text-[#06131D] transition hover:bg-cyan-300"
            >
              <Phone className="h-4 w-4" aria-hidden="true" />
              Call {STORE.telephoneDisplay}
            </a>
            {onSelectBrand && (
              <button
                type="button"
                onClick={() => {
                  onSelectBrand(active.brand);
                  onClose();
                }}
                className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-xl border border-slate-700 bg-[#111B2B] px-4 text-sm font-semibold text-slate-200 transition hover:border-cyan-400 hover:text-cyan-300"
              >
                More from {active.brand}
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-xl border border-slate-800 px-4 text-sm font-medium text-slate-300 transition hover:border-slate-600 hover:text-slate-100"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
