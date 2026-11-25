import { createFileRoute, Link } from "@tanstack/react-router";
import { Download, RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { KegModal } from "../components/KegModal";
import { LiquorCatalog } from "../components/LiquorCatalog";
import { SiteFooter } from "../components/SiteFooter";
import { SiteHeader } from "../components/SiteHeader";
import { INVENTORY_FILE_URL, type InventoryItem } from "../lib/inventory";
import { STORE } from "../lib/store-info";
import catalogData from "../data/cooler-door-items.json";
import "../home-refresh.css";

/**
 * The Cooler Door catalog is generated from the inventory spreadsheet filed
 * in this repository (public/inventory/cooler-door-inventory.xlsx) by
 * scripts/sync_cooler_door.py, which runs in GitHub Actions whenever the
 * spreadsheet changes. The page mirrors the sheet exactly — alcoholic
 * beverages and liquor only, with each item's price and brand logo.
 */
const CATALOG_ITEMS: InventoryItem[] = (catalogData.items as InventoryItem[]).map((item) => ({
  id: item.id,
  name: item.name,
  brand: item.brand,
  category: item.category,
  size: item.size,
  price: item.price,
}));
const CATALOG_UPDATED_AT: string | null = catalogData.generatedAt ?? null;
const CATEGORY_ORDER = ["Beer", "RTD", "Spirits", "Wine"];

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

function CoolerDoorPage() {
  const initialSearch = Route.useSearch();

  const items = CATALOG_ITEMS;
  const updatedAt = CATALOG_UPDATED_AT;
  const loading = false;
  const error: string | null = null;

  const categories = useMemo(() => {
    const present = Array.from(new Set(items.map((item) => item.category)));
    present.sort(
      (a, b) =>
        (CATEGORY_ORDER.indexOf(a) === -1 ? 99 : CATEGORY_ORDER.indexOf(a)) -
          (CATEGORY_ORDER.indexOf(b) === -1 ? 99 : CATEGORY_ORDER.indexOf(b)) || a.localeCompare(b),
    );
    return ["All", ...present];
  }, [items]);

  const [query, setQuery] = useState(initialSearch.q ?? "");
  const [selectedCategory, setSelectedCategory] = useState(initialSearch.category ?? "All");
  const [selectedBrand, setSelectedBrand] = useState(initialSearch.brand ?? "All");
  const [sortBy, setSortBy] = useState<SortOption>("name-asc");
  const [page, setPage] = useState(1);

  const [showKeg, setShowKeg] = useState(false);
  const openerRef = useRef<HTMLElement | null>(null);

  // Keep local filter synced when navigating here with query params
  useEffect(() => {
    if (initialSearch.category) setSelectedCategory(initialSearch.category);
    if (initialSearch.brand) setSelectedBrand(initialSearch.brand);
    if (initialSearch.q) setQuery(initialSearch.q);
    setPage(1);
  }, [initialSearch.category, initialSearch.brand, initialSearch.q]);

  const brands = useMemo(() => {
    const pool =
      selectedCategory === "All"
        ? items
        : items.filter((item) => item.category.toLowerCase() === selectedCategory.toLowerCase());
    const unique = Array.from(new Set(pool.map((item) => item.brand))).sort((a, b) =>
      a.localeCompare(b),
    );
    return ["All", ...unique];
  }, [items, selectedCategory]);

  const activeBrand =
    selectedBrand !== "All" && brands.some((b) => b.toLowerCase() === selectedBrand.toLowerCase())
      ? (brands.find((b) => b.toLowerCase() === selectedBrand.toLowerCase()) ?? "All")
      : selectedBrand === "All"
        ? "All"
        : selectedBrand;

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    const matched = items.filter((item) => {
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
  }, [items, query, selectedCategory, activeBrand, sortBy]);

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
              Cooler Door · Live Inventory &amp; Pricing
            </p>
            <h1 className="mt-2 font-display text-3xl font-extrabold tracking-tight text-slate-100 sm:text-5xl">
              Cold drinks &amp; <span className="text-cyan-400">current prices.</span>
            </h1>
            <p className="mt-3 text-base leading-relaxed text-slate-400">
              Browse cold beer, ready-to-drink cocktails, spirits, and wine paired with logos from
              our local alcohol brand folder.
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

        {/* Store Notice */}
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
          {updatedAt && (
            <span className="font-mono text-xs text-slate-400">
              Synced from the inventory sheet · {updatedAt}
            </span>
          )}
        </div>

        {/* Search & Filter Controls */}
        <section
          aria-label="Filter Cooler Door inventory"
          className="mt-6 rounded-2xl border border-slate-800 bg-[#0D1624] p-4 sm:p-5"
        >
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

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
            <span className="font-mono tabular-nums">
              {loading
                ? "Loading Cooler Door inventory…"
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

        {/* Liquor Catalog Grid (with Skeleton Loading State) */}
        <section aria-live="polite" className="mt-7">
          <LiquorCatalog
            items={pageItems}
            loading={loading}
            error={error}
            skeletonCount={12}
            page={safePage}
            totalPages={totalPages}
            onPageChange={setPage}
            onResetFilters={resetFilters}
            onSelectBrand={(brand) => {
              setSelectedCategory("All");
              setSelectedBrand(brand);
              setQuery("");
              setPage(1);
            }}
          />
        </section>
      </main>

      <KegModal open={showKeg} onClose={() => setShowKeg(false)} openerRef={openerRef} />
      <SiteFooter />
    </div>
  );
}
