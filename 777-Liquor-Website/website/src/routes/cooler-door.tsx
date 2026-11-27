import { createFileRoute, Link } from "@tanstack/react-router";
import { Download, RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { KegModal } from "../components/KegModal";
import { LiquorCatalog } from "../components/LiquorCatalog";
import { SiteFooter } from "../components/SiteFooter";
import { SiteHeader } from "../components/SiteHeader";
import catalogData from "../data/cooler-door-items.json";
import { INVENTORY_FILE_URL, normalizeCategory, type InventoryItem } from "../lib/inventory";
import { STORE } from "../lib/store-info";
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
  category: normalizeCategory(item.category),
  size: item.size,
  price: item.price,
  ...(item.description ? { description: item.description } : {}),
  ...(item.abv ? { abv: item.abv } : {}),
  ...(item.origin ? { origin: item.origin } : {}),
}));
const CATALOG_UPDATED_AT: string | null = catalogData.generatedAt ?? null;
const CATEGORY_ORDER = ["Beer", "RTD", "Spirits", "Wine"] as const;

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  Beer: "Cold domestic, local craft, and imported beers.",
  RTD: "Ready-to-drink hard seltzers, teas, and canned cocktails.",
  Spirits: "Vodka, tequila, whiskey, rum, and specialty bottles.",
  Wine: "Chilled white, prosecco, rosé, and red selections.",
};

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
          "Browse 777 Liquor's Cooler Door by category tab — cold beer, ready-to-drink cocktails, spirits, and wine with current pricing.",
      },
    ],
    links: [{ rel: "canonical", href: `${STORE.url}/cooler-door` }],
  }),
  component: CoolerDoorPage,
});

type SortOption = "name-asc" | "price-asc" | "price-desc";
const ITEMS_PER_PAGE = 48;

function toTabSlug(category: string): string {
  return category.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function sortItems(list: InventoryItem[], sortBy: SortOption): InventoryItem[] {
  const sorted = [...list];
  if (sortBy === "price-asc") {
    sorted.sort((a, b) => a.price - b.price || a.name.localeCompare(b.name));
  } else if (sortBy === "price-desc") {
    sorted.sort((a, b) => b.price - a.price || a.name.localeCompare(b.name));
  } else {
    sorted.sort((a, b) => a.name.localeCompare(b.name));
  }
  return sorted;
}

function CoolerDoorPage() {
  const initialSearch = Route.useSearch();
  const navigate = Route.useNavigate();

  const items = CATALOG_ITEMS;
  const updatedAt = CATALOG_UPDATED_AT;
  const loading = false;
  const error: string | null = null;

  // Ordered category tabs (Beer -> RTD -> Spirits -> Wine -> any additional categories)
  const categoryTabs = useMemo(() => {
    const present = Array.from(new Set(items.map((item) => item.category)));
    present.sort((a, b) => {
      const idxA = CATEGORY_ORDER.indexOf(a as (typeof CATEGORY_ORDER)[number]);
      const idxB = CATEGORY_ORDER.indexOf(b as (typeof CATEGORY_ORDER)[number]);
      return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB) || a.localeCompare(b);
    });
    return present.length > 0 ? present : [...CATEGORY_ORDER];
  }, [items]);

  const defaultCategory = categoryTabs[0];

  const resolveCategory = (raw?: string, brandHint?: string): string => {
    if (raw) {
      const matched = categoryTabs.find((c) => c.toLowerCase() === raw.trim().toLowerCase());
      if (matched) return matched;
    }
    if (brandHint) {
      const brandMatch = items.find(
        (item) => item.brand.toLowerCase() === brandHint.trim().toLowerCase(),
      );
      if (brandMatch) return brandMatch.category;
    }
    return defaultCategory;
  };

  const [query, setQuery] = useState(initialSearch.q ?? "");
  const [selectedCategory, setSelectedCategory] = useState(() =>
    resolveCategory(initialSearch.category, initialSearch.brand),
  );
  const [selectedBrand, setSelectedBrand] = useState(initialSearch.brand ?? "All");
  const [sortBy, setSortBy] = useState<SortOption>("name-asc");
  const [page, setPage] = useState(1);

  const [showKeg, setShowKeg] = useState(false);
  const openerRef = useRef<HTMLElement | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Sync local state when route search params change externally (e.g. nav link from home page)
  useEffect(() => {
    let nextCategory = defaultCategory;
    if (initialSearch.category) {
      const matched = categoryTabs.find(
        (c) => c.toLowerCase() === initialSearch.category!.trim().toLowerCase(),
      );
      if (matched) nextCategory = matched;
    } else if (initialSearch.brand) {
      const brandMatch = items.find(
        (item) => item.brand.toLowerCase() === initialSearch.brand!.trim().toLowerCase(),
      );
      if (brandMatch) nextCategory = brandMatch.category;
    }

    setSelectedCategory(nextCategory);
    if (initialSearch.brand !== undefined) {
      setSelectedBrand(initialSearch.brand || "All");
    }
    if (initialSearch.q !== undefined) {
      setQuery(initialSearch.q || "");
    }
    setPage(1);
  }, [
    initialSearch.category,
    initialSearch.brand,
    initialSearch.q,
    categoryTabs,
    defaultCategory,
    items,
  ]);

  const selectCategoryTab = (category: string) => {
    setSelectedCategory(category);
    setSelectedBrand("All");
    setPage(1);
    void navigate({
      search: (prev) => ({
        ...prev,
        category,
        brand: undefined,
      }),
      replace: true,
    });
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") {
      nextIndex = (index + 1) % categoryTabs.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + categoryTabs.length) % categoryTabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = categoryTabs.length - 1;
    }

    if (nextIndex !== null) {
      event.preventDefault();
      const nextCategory = categoryTabs[nextIndex];
      selectCategoryTab(nextCategory);
      tabRefs.current[nextIndex]?.focus();
    }
  };

  // Search-filtered pool used to show live matching counts on each category tab
  const searchMatchedItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return items;
    return items.filter((item) => {
      const haystack = `${item.name} ${item.brand} ${item.category} ${item.size}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [items, query]);

  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const cat of categoryTabs) {
      counts[cat] = 0;
    }
    for (const item of searchMatchedItems) {
      counts[item.category] = (counts[item.category] ?? 0) + 1;
    }
    return counts;
  }, [searchMatchedItems, categoryTabs]);

  // Brands scoped strictly to the active category tab
  const brands = useMemo(() => {
    const pool = items.filter(
      (item) => item.category.toLowerCase() === selectedCategory.toLowerCase(),
    );
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

  // Only items belonging to the currently selected category tab
  const categoryItems = useMemo(() => {
    const matched = searchMatchedItems.filter((item) => {
      if (item.category.toLowerCase() !== selectedCategory.toLowerCase()) {
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
      return true;
    });

    return sortItems(matched, sortBy);
  }, [searchMatchedItems, selectedCategory, activeBrand, sortBy]);

  const totalPages = Math.max(1, Math.ceil(categoryItems.length / ITEMS_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * ITEMS_PER_PAGE;
  const pageItems = categoryItems.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  const hasActiveFilters = query.trim() !== "" || selectedBrand !== "All";

  const resetFilters = () => {
    setQuery("");
    setSelectedBrand("All");
    setSortBy("name-asc");
    setPage(1);
    void navigate({
      search: () => ({ category: selectedCategory }),
      replace: true,
    });
  };

  const handleSelectBrandFromModal = (brand: string) => {
    const inCurrentCategory = items.some(
      (item) =>
        item.category.toLowerCase() === selectedCategory.toLowerCase() &&
        item.brand.toLowerCase() === brand.toLowerCase(),
    );
    const targetCategory = inCurrentCategory
      ? selectedCategory
      : (items.find((item) => item.brand.toLowerCase() === brand.toLowerCase())?.category ??
        selectedCategory);

    setSelectedCategory(targetCategory);
    setSelectedBrand(brand);
    setQuery("");
    setPage(1);
    void navigate({
      search: () => ({ category: targetCategory, brand }),
      replace: true,
    });
  };

  const activeTabSlug = toTabSlug(selectedCategory);
  const activeTabId = `cooler-tab-${activeTabSlug}`;
  const activePanelId = `cooler-tabpanel-${activeTabSlug}`;

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
            <h1 className="mt-2 font-display text-3xl font-extrabold tracking-tight text-slate-100 text-balance sm:text-5xl">
              Cold drinks &amp; <span className="text-cyan-400">current prices.</span>
            </h1>
            <p className="mt-3 text-base leading-relaxed text-slate-400">
              Select a category tab below to browse cold beer, ready-to-drink cocktails, spirits,
              and wine with logos and current in-store pricing.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              to="/brands"
              className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-700 bg-[#111B2B] px-4 text-sm font-semibold text-slate-200 whitespace-nowrap transition hover:border-cyan-400 hover:text-cyan-300"
            >
              Browse brand logos
            </Link>
            <a
              href={INVENTORY_FILE_URL}
              download="cooler-door-inventory.xlsx"
              className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-700 bg-[#0B1220] px-4 text-sm font-medium text-slate-300 whitespace-nowrap transition hover:border-cyan-400 hover:text-cyan-300"
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

        {/* Category Tabs + Scoped Controls */}
        <section
          aria-label="Browse Cooler Door by category"
          className="mt-7 rounded-2xl border border-slate-800 bg-[#0D1624] overflow-hidden"
        >
          {/* Category Tab Bar */}
          <div
            role="tablist"
            aria-label="Cooler Door categories"
            className="flex items-stretch gap-1 overflow-x-auto border-b border-slate-800 bg-[#09101B] px-3 pt-2 sm:px-5"
          >
            {categoryTabs.map((category, index) => {
              const active = selectedCategory.toLowerCase() === category.toLowerCase();
              const slug = toTabSlug(category);
              const count = tabCounts[category] ?? 0;

              return (
                <button
                  key={category}
                  ref={(el) => {
                    tabRefs.current[index] = el;
                  }}
                  id={`cooler-tab-${slug}`}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls={`cooler-tabpanel-${slug}`}
                  tabIndex={active ? 0 : -1}
                  onClick={() => selectCategoryTab(category)}
                  onKeyDown={(e) => handleTabKeyDown(e, index)}
                  className={`relative inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-t-xl border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 ${
                    active
                      ? "border-cyan-400 bg-[#0D1624] text-cyan-300"
                      : "border-transparent text-slate-400 hover:bg-[#111B2B]/60 hover:text-slate-100"
                  }`}
                >
                  <span>{category}</span>
                  <span
                    className={`font-mono text-xs tabular-nums ${
                      active ? "text-cyan-400/90" : "text-slate-500"
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Search, Brand Filter & Sort Controls for the Active Tab */}
          <div className="p-4 sm:p-5">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
              <div className="relative md:col-span-6">
                <label htmlFor="cooler-search" className="sr-only">
                  Search {selectedCategory} products, brands, or sizes
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
                  placeholder={`Search ${selectedCategory} by product, brand, or size…`}
                  className="min-h-11 w-full rounded-xl border border-slate-700/90 bg-[#070D14] pl-10 pr-4 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
                />
              </div>

              <div className="md:col-span-3">
                <label htmlFor="cooler-brand" className="sr-only">
                  Filter {selectedCategory} by brand
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
                  <option value="All">All {selectedCategory} Brands</option>
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
                  Sort {selectedCategory} products
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
                  : categoryItems.length === 0
                    ? `0 ${selectedCategory} items matching your filters`
                    : `Showing ${startIndex + 1}–${Math.min(startIndex + ITEMS_PER_PAGE, categoryItems.length)} of ${categoryItems.length} ${selectedCategory} ${categoryItems.length === 1 ? "item" : "items"}`}
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
          </div>
        </section>

        {/* Active Category Tab Panel (Displays Only the Selected Category's Items) */}
        <section
          id={activePanelId}
          role="tabpanel"
          aria-labelledby={activeTabId}
          aria-live="polite"
          className="mt-8"
        >
          <div className="mb-5 border-b border-slate-800/90 pb-3">
            <div className="flex items-baseline gap-2.5">
              <h2 className="font-display text-xl font-bold tracking-tight text-slate-100 sm:text-2xl">
                {selectedCategory}
              </h2>
              <span className="font-mono text-xs tabular-nums text-slate-400">
                {categoryItems.length} {categoryItems.length === 1 ? "item" : "items"}
              </span>
            </div>
            {CATEGORY_DESCRIPTIONS[selectedCategory] && (
              <p className="mt-1 text-sm text-slate-400">
                {CATEGORY_DESCRIPTIONS[selectedCategory]}
              </p>
            )}
          </div>

          <LiquorCatalog
            items={pageItems}
            loading={loading}
            error={error}
            skeletonCount={12}
            page={safePage}
            totalPages={totalPages}
            onPageChange={setPage}
            onResetFilters={resetFilters}
            onSelectBrand={handleSelectBrandFromModal}
          />
        </section>
      </main>

      <KegModal open={showKeg} onClose={() => setShowKeg(false)} openerRef={openerRef} />
      <SiteFooter />
    </div>
  );
}
