import { createFileRoute, Link } from "@tanstack/react-router";
import { RotateCcw, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { KegModal } from "../components/KegModal";
import { SiteFooter } from "../components/SiteFooter";
import { SiteHeader } from "../components/SiteHeader";
import { BRAND_LOGO_FOLDER, getLinkedBrandLogos, type BrandLogoEntry } from "../lib/brand-logos";
import { normalizeCategory, normalizeInventoryText } from "../lib/inventory";
import { STORE } from "../lib/store-info";
import "../home-refresh.css";

export const Route = createFileRoute("/brands")({
  head: () => ({
    meta: [
      { title: "Alcohol Brand Logos — 777 Liquor · Honolulu" },
      {
        name: "description",
        content:
          "Browse all alcohol brand logos linked directly to 777 Liquor's local brand image folder across beer, spirits, ready-to-drink, and wine.",
      },
    ],
    links: [{ rel: "canonical", href: `${STORE.url}/brands` }],
  }),
  component: BrandsDirectoryPage,
});

function BrandsDirectoryPage() {
  const [brands, setBrands] = useState<BrandLogoEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [brokenLogos, setBrokenLogos] = useState<Set<string>>(() => new Set());
  const [showKeg, setShowKeg] = useState(false);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let active = true;
    getLinkedBrandLogos()
      .then((list) => {
        if (active) {
          setBrands(list);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const visibleBrands = useMemo(
    () => brands.filter((entry) => entry.logo && !brokenLogos.has(entry.slug)),
    [brands, brokenLogos],
  );

  const categories = useMemo(() => {
    const unique = Array.from(
      new Set(visibleBrands.map((entry) => normalizeCategory(entry.category))),
    ).sort((a, b) => a.localeCompare(b));
    return ["All", ...unique];
  }, [visibleBrands]);

  const filteredBrands = useMemo(() => {
    const q = query.trim().toLowerCase();
    return visibleBrands.filter((entry) => {
      const cat = normalizeCategory(entry.category);
      if (selectedCategory !== "All" && cat !== selectedCategory) return false;
      if (q) {
        const hay = `${entry.brand} ${cat} ${entry.slug}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [visibleBrands, selectedCategory, query]);

  const hasFilters = query.trim() !== "" || selectedCategory !== "All";

  const resetFilters = () => {
    setQuery("");
    setSelectedCategory("All");
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
              Linked Logo Folder · {BRAND_LOGO_FOLDER}
            </p>
            <h1 className="mt-2 font-display text-3xl font-extrabold tracking-tight text-slate-100 sm:text-5xl">
              Alcohol <span className="text-cyan-400">brand logos.</span>
            </h1>
            <p className="mt-3 text-base leading-relaxed text-slate-400">
              Every brand image below is linked directly from our local alcohol logo folder. Select
              any brand to search matching items and prices on the Cooler Door page.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              to="/cooler-door"
              className="inline-flex min-h-10 items-center justify-center rounded-xl bg-cyan-400 px-5 text-sm font-bold text-[#06131D] transition hover:bg-cyan-300"
            >
              Open Cooler Door →
            </Link>
          </div>
        </section>

        {/* Filter Bar */}
        <section
          aria-label="Filter alcohol brand logos"
          className="mt-6 rounded-2xl border border-slate-800 bg-[#0D1624] p-4 sm:p-5"
        >
          <div className="flex flex-wrap items-center gap-2 pb-4 border-b border-slate-800/80">
            {categories.map((category) => {
              const active = selectedCategory === category;
              return (
                <button
                  key={category}
                  type="button"
                  onClick={() => setSelectedCategory(category)}
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

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full max-w-md">
              <label htmlFor="brand-search" className="sr-only">
                Search brand logos
              </label>
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                id="brand-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search brand logos (e.g. Heineken, Tito's, Kona)…"
                className="min-h-11 w-full rounded-xl border border-slate-700/90 bg-[#070D14] pl-10 pr-4 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-4 text-xs text-slate-400">
              <span className="font-mono tabular-nums">
                {loading
                  ? "Loading brand logos…"
                  : `${filteredBrands.length} of ${visibleBrands.length} linked brand logos`}
              </span>
              {hasFilters && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="inline-flex cursor-pointer items-center gap-1.5 font-semibold text-cyan-300 hover:text-cyan-200"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  Reset
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Brand Logo Grid */}
        <section aria-live="polite" className="mt-7">
          {loading ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {Array.from({ length: 15 }).map((_, i) => (
                <div
                  key={i}
                  className="flex flex-col items-center gap-3 rounded-2xl border border-slate-800/80 bg-[#111B2B]/70 p-5 animate-pulse"
                >
                  <div className="h-20 w-full rounded-xl bg-slate-800" />
                  <div className="h-4 w-2/3 rounded bg-slate-700/80" />
                  <div className="h-3 w-1/3 rounded bg-slate-800" />
                </div>
              ))}
            </div>
          ) : filteredBrands.length === 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-[#111B2B] p-10 text-center">
              <h2 className="font-display text-xl font-bold text-slate-100">
                No matching brand logos
              </h2>
              <p className="mt-2 text-sm text-slate-400">
                Try a different brand name or reset filters to view all linked logos.
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
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {filteredBrands.map((entry) => {
                const displayName = normalizeInventoryText(entry.brand);
                const category = normalizeCategory(entry.category);
                return (
                  <Link
                    key={entry.slug}
                    to="/cooler-door"
                    search={{ q: displayName }}
                    className="group flex flex-col items-center rounded-2xl border border-slate-800 bg-[#111B2B] p-4 text-center transition-colors hover:border-cyan-400/60 hover:bg-[#162235]"
                  >
                    <div
                      className={`flex h-20 w-full items-center justify-center rounded-xl p-3 ${
                        entry.onDark
                          ? "bg-slate-950/90 border border-slate-800"
                          : "bg-slate-100/95 border border-slate-300/60"
                      }`}
                    >
                      <img
                        src={entry.logo as string}
                        alt={`${displayName} logo`}
                        loading="lazy"
                        className="max-h-full max-w-full object-contain"
                        onError={() => {
                          setBrokenLogos((prev) => {
                            const next = new Set(prev);
                            next.add(entry.slug);
                            return next;
                          });
                        }}
                      />
                    </div>
                    <h2 className="mt-3 font-display text-sm font-bold text-slate-100 group-hover:text-cyan-300">
                      {displayName}
                    </h2>
                    <p className="mt-0.5 text-xs text-slate-400">{category}</p>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </main>

      <KegModal open={showKeg} onClose={() => setShowKeg(false)} openerRef={openerRef} />
      <SiteFooter />
    </div>
  );
}
