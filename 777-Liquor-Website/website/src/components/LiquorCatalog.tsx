import { RotateCcw, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { STORE } from "../lib/store-info";
import type { InventoryItem } from "../services/inventory.service";
import { BrandLogo } from "./brand-logo";
import { LiquorDetailModal } from "./LiquorDetailModal";

export type LiquorCatalogProps = {
  items: InventoryItem[];
  loading: boolean;
  error: string | null;
  skeletonCount?: number;
  page?: number;
  totalPages?: number;
  onPageChange?: (nextPage: number) => void;
  onRetry?: () => void;
  onResetFilters?: () => void;
  onSelectBrand?: (brand: string) => void;
  canDelete?: boolean;
  deleteDisabled?: boolean;
  onDeleteItem?: (itemId: string, itemName: string) => void;
};

const TITLE_WIDTHS = ["w-11/12", "w-4/5", "w-5/6", "w-3/4"] as const;
const SUBTITLE_WIDTHS = ["w-1/2", "w-2/3", "w-3/5", "w-2/5"] as const;

function formatPrice(price: number): string {
  return `$${price.toFixed(2)}`;
}

/**
 * High-parity Midnight Slate skeleton grid mirroring LiquorCatalog card geometry
 * to eliminate layout shift while Firestore inventory loads.
 */
export function LiquorCatalogSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div role="status" aria-busy="true" aria-label="Loading Cooler Door inventory">
      <span className="sr-only">Loading Cooler Door inventory from database…</span>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
        {Array.from({ length: count }).map((_, index) => (
          <div
            key={index}
            className="skeleton-shimmer flex items-start gap-4 rounded-2xl border border-slate-800/90 bg-[#111B2B]/85 p-5"
          >
            {/* Brand Logo Plate Placeholder (56x56) */}
            <div className="h-14 w-14 shrink-0 rounded-xl border border-slate-800 bg-slate-800/70" />

            {/* Card Content Placeholder */}
            <div className="flex min-w-0 flex-1 flex-col justify-between gap-2.5">
              <div>
                {/* Category · Brand Kicker */}
                <div className="h-3 w-28 rounded bg-slate-800/90" />
                {/* 2-Line Product Title */}
                <div
                  className={`mt-2 h-4 rounded bg-slate-700/75 ${TITLE_WIDTHS[index % TITLE_WIDTHS.length]}`}
                />
                <div
                  className={`mt-1.5 h-4 rounded bg-slate-800/80 ${SUBTITLE_WIDTHS[index % SUBTITLE_WIDTHS.length]}`}
                />
              </div>

              {/* Footer Divider: Size + Tabular Price */}
              <div className="mt-1 flex items-center justify-between gap-2 border-t border-slate-800/80 pt-2.5">
                <div className="h-3 w-16 rounded bg-slate-800/90" />
                <div className="h-5 w-16 rounded bg-cyan-400/15" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Responsive Cooler Door product grid displaying normalized inventory items,
 * brand logos, tabular pricing, interactive product detail modal, pagination,
 * and skeleton/empty/error states.
 */
export function LiquorCatalog({
  items,
  loading,
  error,
  skeletonCount = 12,
  page = 1,
  totalPages = 1,
  onPageChange,
  onRetry,
  onResetFilters,
  onSelectBrand,
  canDelete = false,
  deleteDisabled = false,
  onDeleteItem,
}: LiquorCatalogProps) {
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  if (loading) {
    return <LiquorCatalogSkeleton count={skeletonCount} />;
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-900/60 bg-red-950/20 p-8 text-center">
        <h2 className="font-display text-xl font-bold text-slate-100">Could not load inventory</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
          {error} Please try again or call us at{" "}
          <a href={`tel:${STORE.telephone}`} className="text-cyan-300 underline">
            {STORE.telephoneDisplay}
          </a>
          .
        </p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-5 inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl bg-cyan-400 px-5 text-sm font-bold text-[#06131D] transition hover:bg-cyan-300"
          >
            Retry loading
          </button>
        )}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-[#111B2B] p-10 text-center">
        <h2 className="font-display text-xl font-bold text-slate-100">No matching drinks found</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
          Try clearing your search or switching back to all categories to see every item in the
          Cooler Door.
        </p>
        {onResetFilters && (
          <button
            type="button"
            onClick={onResetFilters}
            className="mt-5 inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-cyan-400 px-5 text-sm font-bold text-[#06131D] transition hover:bg-cyan-300"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Reset filters
          </button>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <article
            key={item.id}
            className="group relative flex items-start gap-4 rounded-2xl border border-slate-800 bg-[#111B2B] p-5 transition-colors hover:border-cyan-400/50 hover:bg-[#162235]"
          >
            <button
              type="button"
              onClick={(e) => {
                openerRef.current = e.currentTarget;
                setSelectedItem(item);
              }}
              aria-label={`View details for ${item.name}`}
              className="flex min-w-0 flex-1 cursor-pointer items-start gap-4 text-left focus-visible:outline-none"
            >
              <BrandLogo brand={item.brand} size={56} showFallbackBadge className="shrink-0" />
              <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
                <div>
                  <p className="text-xs font-medium text-slate-400">
                    {item.category} · {item.brand}
                  </p>
                  <h2 className="mt-1 font-display text-base font-bold leading-snug text-slate-100 transition-colors group-hover:text-cyan-300">
                    {item.name}
                  </h2>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 border-t border-slate-800/80 pt-2">
                  <span className="font-mono text-xs text-slate-400">
                    {item.size || "In store"}
                  </span>
                  <span className="font-mono text-lg font-bold tabular-nums text-cyan-300">
                    {formatPrice(item.price)}
                  </span>
                </div>
              </div>
            </button>

            {canDelete && onDeleteItem && (
              <button
                type="button"
                disabled={deleteDisabled}
                aria-label={`Remove ${item.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteItem(item.id, item.name);
                }}
                className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-slate-700 text-slate-400 transition hover:border-red-400 hover:text-red-300 disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </article>
        ))}
      </div>

      {totalPages > 1 && onPageChange && (
        <nav aria-label="Inventory pages" className="mt-8 flex items-center justify-center gap-3">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => {
              onPageChange(Math.max(1, page - 1));
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            className="min-h-10 cursor-pointer rounded-xl border border-slate-700 bg-[#111B2B] px-4 text-sm font-semibold text-slate-200 transition hover:border-cyan-400 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ← Previous
          </button>
          <span className="font-mono text-xs tabular-nums text-slate-400">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => {
              onPageChange(Math.min(totalPages, page + 1));
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            className="min-h-10 cursor-pointer rounded-xl border border-slate-700 bg-[#111B2B] px-4 text-sm font-semibold text-slate-200 transition hover:border-cyan-400 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next →
          </button>
        </nav>
      )}

      <LiquorDetailModal
        item={selectedItem}
        onClose={() => setSelectedItem(null)}
        onSelectBrand={onSelectBrand}
        openerRef={openerRef}
      />
    </>
  );
}
