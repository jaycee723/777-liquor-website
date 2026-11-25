import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Download,
  Lock,
  LogOut,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useFirebaseAuth } from "../components/FirebaseProvider";
import { KegModal } from "../components/KegModal";
import { LiquorCatalog } from "../components/LiquorCatalog";
import { SiteFooter } from "../components/SiteFooter";
import { SiteHeader } from "../components/SiteHeader";
import { useInventory } from "../hooks/useInventory";
import {
  INVENTORY_FILE_URL,
  loadCoolerDoorInventory,
  parseInventoryWorkbook,
} from "../lib/inventory";
import { STORE } from "../lib/store-info";
import {
  deleteCoolerItem,
  saveCoolerItem,
  syncInventoryToFirestore,
} from "../services/inventory.service";
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
const MANAGER_CATEGORIES = ["Beer", "RTD", "Spirits", "Wine", "Beverages"] as const;

function formatPrice(price: number): string {
  return `$${price.toFixed(2)}`;
}

function CoolerDoorPage() {
  const initialSearch = Route.useSearch();
  const { user, isAdmin, signInWithGoogle, signOutUser } = useFirebaseAuth();
  const { items, categories, source, updatedAt, loading, error, refresh } = useInventory({
    realtime: true,
    includeExcelFallback: true,
  });

  const usingDatabase = source === "firestore";

  const [query, setQuery] = useState(initialSearch.q ?? "");
  const [selectedCategory, setSelectedCategory] = useState(initialSearch.category ?? "All");
  const [selectedBrand, setSelectedBrand] = useState(initialSearch.brand ?? "All");
  const [sortBy, setSortBy] = useState<SortOption>("name-asc");
  const [page, setPage] = useState(1);

  const [showKeg, setShowKeg] = useState(false);
  const openerRef = useRef<HTMLElement | null>(null);

  // Store Manager Panel State
  const [managerOpen, setManagerOpen] = useState(false);
  const [managerBusy, setManagerBusy] = useState(false);
  const [managerMessage, setManagerMessage] = useState<string | null>(null);
  const [managerError, setManagerError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newBrand, setNewBrand] = useState("");
  const [newCategory, setNewCategory] = useState<string>("Beer");
  const [newSize, setNewSize] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  const handleSignIn = async () => {
    setManagerError(null);
    setManagerMessage(null);
    try {
      await signInWithGoogle();
    } catch {
      setManagerError("Sign-in was cancelled or blocked. Please try again.");
    }
  };

  const handleSyncDefaultExcel = async () => {
    if (!user || !isAdmin) return;
    setManagerBusy(true);
    setManagerError(null);
    setManagerMessage(null);
    try {
      const excelCatalog = await loadCoolerDoorInventory(true);
      const count = await syncInventoryToFirestore(excelCatalog.items, user.uid);
      setManagerMessage(`Synced ${count} items from cooler-door-inventory.xlsx.`);
    } catch (err) {
      setManagerError(
        err instanceof Error ? err.message : "Could not sync the Excel sheet right now.",
      );
    } finally {
      setManagerBusy(false);
    }
  };

  const handleExcelUpload = async (file: File | undefined) => {
    if (!file || !user || !isAdmin) return;
    setManagerBusy(true);
    setManagerError(null);
    setManagerMessage(null);
    try {
      const buffer = await file.arrayBuffer();
      const parsed = parseInventoryWorkbook(buffer, file.name);
      if (!parsed.items.length) {
        throw new Error("No valid product and price rows were found in that spreadsheet.");
      }
      const count = await syncInventoryToFirestore(parsed.items, user.uid);
      setManagerMessage(`Imported ${count} normalized items from ${file.name}.`);
    } catch (err) {
      setManagerError(
        err instanceof Error ? err.message : "Could not import that Excel spreadsheet.",
      );
    } finally {
      setManagerBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleAddItem = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || !isAdmin) return;
    setManagerBusy(true);
    setManagerError(null);
    setManagerMessage(null);
    try {
      const parsedPrice = Number.parseFloat(newPrice);
      const saved = await saveCoolerItem(
        {
          name: newName,
          brand: newBrand,
          category: newCategory,
          size: newSize,
          price: parsedPrice,
        },
        user.uid,
      );
      setNewName("");
      setNewBrand("");
      setNewSize("");
      setNewPrice("");
      setManagerMessage(`Saved "${saved.name}" (${formatPrice(saved.price)}).`);
    } catch (err) {
      setManagerError(err instanceof Error ? err.message : "Could not save item.");
    } finally {
      setManagerBusy(false);
    }
  };

  const handleDeleteItem = async (itemId: string, itemName: string) => {
    if (!user || !isAdmin || !usingDatabase) return;
    setManagerBusy(true);
    setManagerError(null);
    setManagerMessage(null);
    try {
      await deleteCoolerItem(itemId);
      setManagerMessage(`Removed "${itemName}".`);
    } catch (err) {
      setManagerError(err instanceof Error ? err.message : "Could not remove item.");
    } finally {
      setManagerBusy(false);
    }
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
            <button
              type="button"
              onClick={() => setManagerOpen((open) => !open)}
              aria-expanded={managerOpen}
              className={`inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border px-4 text-sm font-medium transition ${
                managerOpen
                  ? "border-cyan-400 bg-cyan-400/10 text-cyan-300"
                  : "border-slate-700 bg-[#0B1220] text-slate-300 hover:border-cyan-400 hover:text-cyan-300"
              }`}
            >
              <Lock className="h-4 w-4 text-cyan-400" aria-hidden="true" />
              Manage inventory
            </button>
          </div>
        </section>

        {/* Store Manager Panel */}
        {managerOpen && (
          <section
            aria-label="Store inventory manager"
            className="mt-6 rounded-2xl border border-slate-800 bg-[#0D1624] p-5 sm:p-6"
          >
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
              <div>
                <h2 className="font-display text-lg font-bold text-slate-100">
                  Store Inventory Manager
                </h2>
                <p className="mt-1 text-sm text-slate-400">
                  Upload an Excel (.xlsx) inventory sheet or add individual items. Product names and
                  sizes are normalized automatically (e.g. 11oz, 1 L).
                </p>
              </div>
              {user ? (
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-400">{user.email}</span>
                  <button
                    type="button"
                    onClick={() => void signOutUser()}
                    className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 bg-[#111B2B] px-3 text-xs font-semibold text-slate-200 transition hover:border-cyan-400 hover:text-cyan-300"
                  >
                    <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                    Sign out
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleSignIn()}
                  className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-xl bg-cyan-400 px-5 text-sm font-bold text-[#06131D] transition hover:bg-cyan-300"
                >
                  Sign in with Google
                </button>
              )}
            </div>

            {user && !isAdmin && (
              <p className="mt-4 text-sm text-amber-300">
                Signed in as {user.email}. Only the authorized store owner account can update Cooler
                Door inventory.
              </p>
            )}

            {user && isAdmin && (
              <div className="mt-5 space-y-6">
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="sr-only"
                    id="excel-upload-input"
                    disabled={managerBusy}
                    onChange={(e) => void handleExcelUpload(e.target.files?.[0])}
                  />
                  <label
                    htmlFor="excel-upload-input"
                    className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl bg-cyan-400 px-4 text-sm font-bold text-[#06131D] transition hover:bg-cyan-300"
                  >
                    <Upload className="h-4 w-4" aria-hidden="true" />
                    Upload Excel (.xlsx) file
                  </label>
                  <button
                    type="button"
                    disabled={managerBusy}
                    onClick={() => void handleSyncDefaultExcel()}
                    className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-slate-700 bg-[#111B2B] px-4 text-sm font-semibold text-slate-200 transition hover:border-cyan-400 hover:text-cyan-300 disabled:opacity-50"
                  >
                    Sync default inventory sheet
                  </button>
                </div>

                <form
                  onSubmit={(e) => void handleAddItem(e)}
                  className="grid grid-cols-1 gap-3 border-t border-slate-800/80 pt-5 sm:grid-cols-2 lg:grid-cols-6"
                >
                  <input
                    type="text"
                    required
                    maxLength={140}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Product Name (e.g. Heineken 12pk 12oz)"
                    disabled={managerBusy}
                    className="min-h-10 rounded-xl border border-slate-700 bg-[#070D14] px-3.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none lg:col-span-2"
                  />
                  <input
                    type="text"
                    required
                    maxLength={80}
                    value={newBrand}
                    onChange={(e) => setNewBrand(e.target.value)}
                    placeholder="Brand (e.g. Heineken)"
                    disabled={managerBusy}
                    className="min-h-10 rounded-xl border border-slate-700 bg-[#070D14] px-3.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
                  />
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    disabled={managerBusy}
                    className="min-h-10 rounded-xl border border-slate-700 bg-[#070D14] px-3 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
                  >
                    {MANAGER_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      maxLength={40}
                      value={newSize}
                      onChange={(e) => setNewSize(e.target.value)}
                      placeholder="Size (1 L)"
                      disabled={managerBusy}
                      className="min-h-10 w-1/2 rounded-xl border border-slate-700 bg-[#070D14] px-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
                    />
                    <input
                      type="number"
                      required
                      step="0.01"
                      min="0.01"
                      max="10000"
                      value={newPrice}
                      onChange={(e) => setNewPrice(e.target.value)}
                      placeholder="Price"
                      disabled={managerBusy}
                      className="min-h-10 w-1/2 rounded-xl border border-slate-700 bg-[#070D14] px-3 font-mono text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={managerBusy}
                    className="inline-flex min-h-10 cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-cyan-400 px-4 text-sm font-bold text-[#06131D] transition hover:bg-cyan-300 disabled:opacity-50"
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Add item
                  </button>
                </form>

                {managerMessage && (
                  <p role="status" className="text-sm font-medium text-cyan-300">
                    {managerMessage}
                  </p>
                )}
                {managerError && (
                  <p role="alert" className="text-sm text-red-300">
                    {managerError}
                  </p>
                )}
              </div>
            )}
          </section>
        )}

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
            <span className="font-mono text-xs text-slate-400">Sheet updated {updatedAt}</span>
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
            onRetry={() => void refresh(true)}
            onResetFilters={resetFilters}
            canDelete={managerOpen && isAdmin && usingDatabase}
            deleteDisabled={managerBusy}
            onDeleteItem={(id, name) => void handleDeleteItem(id, name)}
          />
        </section>
      </main>

      <KegModal open={showKeg} onClose={() => setShowKeg(false)} openerRef={openerRef} />
      <SiteFooter />
    </div>
  );
}
