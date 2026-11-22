import { createFileRoute, Link } from "@tanstack/react-router";
import { Download, RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { BrandLogo } from "../components/brand-logo";
import { KegModal } from "../components/KegModal";
import { SiteFooter } from "../components/SiteFooter";
import { SiteHeader } from "../components/SiteHeader";
import {
  INVENTORY_FILE_URL,
  loadCoolerDoorInventory,
  type InventoryCatalog,
} from "../lib/inventory";
import { STORE } from "../lib/store-info";
import "../home-refresh.css";

type CoolerDoorSearch = {
  category?: string;
  brand?: string;
  q?: string;
};

export const Route = createFileRoute("/cooler-door")({
  validateSearch: (search: Record<string, unknown>): CoolerDoorSearch => ({
    category:
      typeof search.category === "string" && search.category.trim() ? search.category : undefined,
    brand: typeof search.brand === "string" && search.brand.trim() ? search.brand : undefined,
    q: typeof search.q === "string" && search.q.trim() ? search.q : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Cooler Door — 777 Liquor · Honolulu" },
      {
        name: "description",
        content:
          "Browse 777 Liquor's live Cooler Door selection of cold beer, ready-to-drink cocktails, spirits, wine, and beverages with current pricing.",
      },
    ],
    links: [{ rel: "canonical", href: `${STORE.url}/cooler-door` }],
  }),
  component: CoolerDoorPage,
});

type SortOption = "name-asc" | "price-asc" | "price-desc";
const ITEMS_PER_PAGE = 48;

function formatPrice(price: number): string {
  return `$${price.toFixed(2)}`;
}

function CoolerDoorPage() {
  const initialSearch = Route.useSearch();
  const [catalog, setCatalog] = useState<InventoryCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState(initialSearch.q ?? "");
  const [selectedCategory, setSelectedCategory] = useState(initialSearch.category ?? "All");
  const [selectedBrand, setSelectedBrand] = useState(initialSearch.brand ?? "All");
  const [sortBy, setSortBy] = useState<SortOption>("name-asc");
  const [page, setPage] = useState(1);

  const [showKeg, setShowKeg] = useState(false);
  const openerRef = useRef<HTMLElement | null>(null);

  const fetchInventory = (forceReload = false) => {
    setLoading(true);
    setError(null);
    loadCoolerDoorInventory(forceReload)
      .then((data) => {
        setCatalog(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(
          err instanceof Error
            ? err.message
            : "We could not load the Cooler Door Excel inventory right now.",
        );
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchInventory(false);
  }, []);

  // Keep local filter synced when navigating here with query params
  useEffect(() => {
    if (initialSearch.category) setSelectedCategory(initialSearch.category);
    if (initialSearch.brand) setSelectedBrand(initialSearch.brand);
    if (initialSearch.q) setQuery(initialSearch.q);
    setPage(1);
  }, [initialSearch.category, initialSearch.brand, initialSearch.q]);

  const categories = useMemo(() => {
    if (!catalog) return ["All"];
    const unique = Array.from(new Set(catalog.items.map((item) => item.category))).sort((a, b) =>
      a.localeCompare(b),
    );
    return ["All", ...unique];
  }, [catalog]);

  const brands = useMemo(() => {
    if (!catalog) return ["All"];
    const pool =
      selectedCategory === "All"
        ? catalog.items
        : catalog.items.filter(
            (item) => item.category.toLowerCase() === selectedCategory.toLowerCase(),
          );
    const unique = Array.from(new Set(pool.map((item) => item.brand))).sort((a, b) =>
      a.localeCompare(b),
    );
    return ["All", ...unique];
  }, [catalog, selectedCategory]);

  // If the current brand is not present in the newly selected category, reset brand cleanly
  const activeBrand =
    selectedBrand !== "All" && brands.some((b) => b.toLowerCase() === selectedBrand.toLowerCase())
      ? (brands.find((b) => b.toLowerCase() === selectedBrand.toLowerCase()) ?? "All")
      : selectedBrand === "All"
        ? "All"
        : selectedBrand;

  const filteredItems = useMemo(() => {
    if (!catalog) return [];
    const normalizedQuery = query.trim().toLowerCase();

    const matched = catalog.items.filter((item) => {
      if (
        selectedCategory !== "All" &&
        item.category.toLowerCase() !== selectedCategory.toLowerCase()
      ) {
        return false;
      }
      if (activeBrand !== "All") {
        const brandTarget = activeBrand.toLowerCase();
        const itemBrand = item.brand.toLowerCase();
        const itemName = item.name.toLowerCase();
        if (itemBrand !== brandTarget && !itemName.includes(brandTarget)) {
          return false;
        }
      }
      if (normalizedQuery) {
        const haystack = `${item.name} ${item.brand} ${item.category} ${item.size}`.toLowerCase();
        if (!haystack.includes(normalizedQuery)) {
          return false;
        }
      }
      return true;
    });

    const sorted = [...matched];
    if (sortBy === "price-asc") {
      sorted.sort((a, b) => a.price - b.price || a.name.localeCompare(b.name));
    } else if (sortBy === "price-desc") {
      sorted.sort((a, b) => b.price - a.price || a.name.localeCompare(b.name));
    } else {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    }
    return sorted;
  }, [catalog, query, selectedCategory, activeBrand, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / ITEMS_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * ITEMS_PER_PAGE;
  const pageItems = filteredItems.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  const hasActiveFilters =
    query.trim() !== "" || selectedCategory !== "All" || selectedBrand !== "All";

  const resetFilters = () => {
    setQuery("");
    setSelectedCategory("All");
    setSelectedBrand("All");
    setSortBy("name-asc");
    setPage(1);
  };

  return (
    <div className="min-h-dvh bg-[#070D14] text-slate-100 flex flex-col">
      <SiteHeader
        onOpenKegModal={(opener) => {
          openerRef.current = opener;
          setShowKeg(true);
        }}
      />

      <main className="mx-auto w-full max-w-7xl flex-1 px-5 py-10 sm:px-8 sm:py-12">
        {/* Page Heading */}
        <section className="flex flex-col justify-between gap-6 border-b border-slate-800/90 pb-8 lg:flex-row lg:items-end">
          <div className="max-w-2xl">
            <p className="font-mono text-xs font-medium tracking-[0.14em] text-cyan-400 uppercase">
              Cooler Door · Live Excel Inventory
            </p>
            <h1 className="mt-2 font-display text-3xl font-extrabold tracking-tight text-slate-100 sm:text-5xl">
              Cold drinks &amp; <span className="text-cyan-400">current prices.</span>
            </h1>
            <p className="mt-3 text-base leading-relaxed text-slate-400">
              Products and prices below are loaded directly from our Excel inventory spreadsheet and
              paired with logos from our local alcohol brand folder.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              to="/brands"
              className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-700 bg-[#111B2B] px-4 text-sm font-semibold text-slate-200 transition hover:border-cyan-400 hover:text-cyan-300"
            >
              Browse brand logos
            </Link>
            <a
              href={INVENTORY_FILE_URL}
              download="cooler-door-inventory.xlsx"
              className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-700 bg-[#0B1220] px-4 text-sm font-medium text-slate-300 transition hover:border-cyan-400 hover:text-cyan-300"
            >
              <Download className="h-4 w-4 text-cyan-400" aria-hidden="true" />
              Excel sheet (.xlsx)
            </a>
          </div>
        </section>

        {/* Clean Hairline Notice (No thick left accent border) */}
        <div className="mt-6 rounded-2xl border border-slate-800 bg-[#0B1220] px-5 py-3.5 text-sm text-slate-300 flex flex-wrap items-center justify-between gap-3">
          <p className="m-0">
            In-store pricing and cooler stock may vary. 21+ with valid ID required. Need to confirm
            an item? Call{" "}
            <a
              href={`tel:${STORE.telephone}`}
              className="font-semibold text-cyan-300 underline decoration-cyan-400/50 underline-offset-4 hover:text-cyan-200"
            >
              {STORE.telephoneDisplay}
            </a>
            .
          </p>
          {catalog?.updatedAt && (
            <span className="font-mono text-xs text-slate-400">
              Sheet updated {catalog.updatedAt}
            </span>
          )}
        </div>

        {/* Search & Filter Controls */}
        <section
          aria-label="Filter Cooler Door inventory"
          className="mt-6 rounded-2xl border border-slate-800 bg-[#0D1624] p-4 sm:p-5"
        >
          {/* Category Segmented Buttons */}
          <div className="flex flex-wrap items-center gap-2 pb-4 border-b border-slate-800/80">
            {categories.map((category) => {
              const active = selectedCategory.toLowerCase() === category.toLowerCase();
              return (
                <button
                  key={category}
                  type="button"
                  onClick={() => {
                    setSelectedCategory(category);
                    setSelectedBrand("All");
                    setPage(1);
                  }}
                  aria-pressed={active}
                  className={`min-h-10 cursor-pointer rounded-xl px-4 text-sm font-semibold transition ${
                    active
                      ? "bg-cyan-400 text-[#06131D]"
                      : "border border-slate-800 bg-[#111B2B] text-slate-300 hover:border-slate-600 hover:text-slate-100"
                  }`}
                >
                  {category}
                </button>
              );
            })}
          </div>

          {/* Search, Brand & Sort Row */}
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-12">
            <div className="relative md:col-span-6">
              <label htmlFor="cooler-search" className="sr-only">
                Search products, brands, or sizes
              </label>
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                id="cooler-search"
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
                placeholder="Search products, brands, or sizes (e.g. Heineken, 12oz, 1 L)…"
                className="min-h-11 w-full rounded-xl border border-slate-700/90 bg-[#070D14] pl-10 pr-4 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
              />
            </div>

            <div className="md:col-span-3">
              <label htmlFor="cooler-brand" className="sr-only">
                Filter by brand
              </label>
              <select
                id="cooler-brand"
                value={activeBrand}
                onChange={(e) => {
                  setSelectedBrand(e.target.value);
                  setPage(1);
                }}
                className="min-h-11 w-full rounded-xl border border-slate-700/90 bg-[#070D14] px-3.5 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
              >
                <option value="All">All Brands</option>
                {brands
                  .filter((b) => b !== "All")
                  .map((brand) => (
                    <option key={brand} value={brand}>
                      {brand}
                    </option>
                  ))}
              </select>
            </div>

            <div className="md:col-span-3">
              <label htmlFor="cooler-sort" className="sr-only">
                Sort products
              </label>
              <div className="relative">
                <SlidersHorizontal
                  className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <select
                  id="cooler-sort"
                  value={sortBy}
                  onChange={(e) => {
                    setSortBy(e.target.value as SortOption);
                    setPage(1);
                  }}
                  className="min-h-11 w-full rounded-xl border border-slate-700/90 bg-[#070D14] pl-10 pr-3.5 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
                >
                  <option value="name-asc">Sort: Product Name (A–Z)</option>
                  <option value="price-asc">Sort: Price Low to High</option>
                  <option value="price-desc">Sort: Price High to Low</option>
                </select>
              </div>
            </div>
          </div>

          {/* Results Summary Bar */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
            <span className="font-mono tabular-nums">
              {loading
                ? "Reading inventory spreadsheet…"
                : filteredItems.length === 0
                  ? "0 items matching your filters"
                  : `Showing ${startIndex + 1}–${Math.min(startIndex + ITEMS_PER_PAGE, filteredItems.length)} of ${filteredItems.length} items`}
            </span>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex cursor-pointer items-center gap-1.5 font-semibold text-cyan-300 transition hover:text-cyan-200"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                Reset filters
              </button>
            )}
          </div>
        </section>

        {/* Inventory Content States */}
        <section aria-live="polite" className="mt-7">
          {loading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 9 }).map((_, index) => (
                <div
                  key={index}
                  className="flex items-center gap-4 rounded-2xl border border-slate-800/80 bg-[#111B2B]/70 p-5 animate-pulse"
                >
                  <div className="h-14 w-14 shrink-0 rounded-xl bg-slate-800" />
                  <div className="flex-1 space-y-2.5">
                    <div className="h-3 w-24 rounded bg-slate-800" />
                    <div className="h-4 w-4/5 rounded bg-slate-700/80" />
                    <div className="h-4 w-16 rounded bg-cyan-950/80" />
                  </div>
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-red-900/60 bg-red-950/20 p-8 text-center">
              <h2 className="font-display text-xl font-bold text-slate-100">
                Could not load inventory spreadsheet
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
                {error} Please try again or call us at{" "}
                <a href={`tel:${STORE.telephone}`} className="text-cyan-300 underline">
                  {STORE.telephoneDisplay}
                </a>
                .
              </p>
              <button
                type="button"
                onClick={() => fetchInventory(true)}
                className="mt-5 inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl bg-cyan-400 px-5 text-sm font-bold text-[#06131D] transition hover:bg-cyan-300"
              >
                Retry loading
              </button>
            </div>
          ) : pageItems.length === 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-[#111B2B] p-10 text-center">
              <h2 className="font-display text-xl font-bold text-slate-100">
                No matching drinks found
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
                Try clearing your search or switching back to all categories to see every item in
                the Cooler Door.
              </p>
              <button
                type="button"
                onClick={resetFilters}
                className="mt-5 inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-cyan-400 px-5 text-sm font-bold text-[#06131D] transition hover:bg-cyan-300"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                Reset filters
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {pageItems.map((item) => (
                  <article
                    key={item.id}
                    className="flex items-start gap-4 rounded-2xl border border-slate-800 bg-[#111B2B] p-5 transition-colors hover:border-cyan-400/50 hover:bg-[#162235]"
                  >
                    <BrandLogo
                      brand={item.brand}
                      size={56}
                      showFallbackBadge
                      className="shrink-0"
                    />
                    <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
                      <div>
                        <p className="text-xs font-medium text-slate-400">
                          {item.category} · {item.brand}
                        </p>
                        <h2 className="mt-1 font-display text-base font-bold leading-snug text-slate-100">
                          {item.name}
                        </h2>
                      </div>
                      <div className="mt-1 flex items-baseline justify-between gap-2 pt-2 border-t border-slate-800/80">
                        <span className="font-mono text-xs text-slate-400">
                          {item.size || "In store"}
                        </span>
                        <span className="font-mono text-lg font-bold tabular-nums text-cyan-300">
                          {formatPrice(item.price)}
                        </span>
                      </div>
                    </div>
                  </article>
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <nav
                  aria-label="Inventory pages"
                  className="mt-8 flex items-center justify-center gap-3"
                >
                  <button
                    type="button"
                    disabled={safePage <= 1}
                    onClick={() => {
                      setPage((p) => Math.max(1, p - 1));
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                    className="min-h-10 cursor-pointer rounded-xl border border-slate-700 bg-[#111B2B] px-4 text-sm font-semibold text-slate-200 transition hover:border-cyan-400 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    ← Previous
                  </button>
                  <span className="font-mono text-xs tabular-nums text-slate-400">
                    Page {safePage} of {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={safePage >= totalPages}
                    onClick={() => {
                      setPage((p) => Math.min(totalPages, p + 1));
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                    className="min-h-10 cursor-pointer rounded-xl border border-slate-700 bg-[#111B2B] px-4 text-sm font-semibold text-slate-200 transition hover:border-cyan-400 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Next →
                  </button>
                </nav>
              )}
            </>
          )}
        </section>
      </main>

      <KegModal open={showKeg} onClose={() => setShowKeg(false)} openerRef={openerRef} />
      <SiteFooter />
    </div>
  );
}
