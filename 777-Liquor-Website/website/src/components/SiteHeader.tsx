import { Link, useRouterState } from "@tanstack/react-router";

type SiteHeaderProps = {
  onOpenKegModal?: (opener: HTMLElement | null) => void;
};

export function SiteHeader({ onOpenKegModal }: SiteHeaderProps) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const isHome = pathname === "/";
  const isCoolerDoor = pathname.startsWith("/cooler-door");
  const isBrands = pathname.startsWith("/brands");

  const linkClass = (active: boolean) =>
    `inline-flex min-h-11 items-center whitespace-nowrap shrink-0 px-2.5 text-sm font-medium transition-colors ${
      active
        ? "text-cyan-300 underline decoration-cyan-400 decoration-2 underline-offset-8"
        : "text-slate-300 hover:text-cyan-300"
    }`;

  return (
    <header className="sticky top-0 z-30 border-b border-slate-800/90 bg-[#070D14]/95 backdrop-blur-md">
      <div className="mx-auto flex min-h-[76px] max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
        {/* Zone 1: Brand Wordmark */}
        <Link
          to="/"
          aria-label="777 Liquor home"
          className="inline-flex min-h-11 shrink-0 items-center gap-2.5 whitespace-nowrap"
        >
          <img
            src="/brands/logo.webp"
            width={72}
            height={44}
            alt=""
            decoding="async"
            className="h-10 w-auto rounded-md object-contain"
          />
          <span className="font-display text-base font-bold tracking-[0.18em] text-cyan-400">
            LIQUOR
          </span>
        </Link>

        {/* Zone 2: Primary Navigation (single row on desktop) */}
        <nav aria-label="Main navigation" className="hidden items-center gap-2 md:flex lg:gap-4">
          <a href={isHome ? "#trending" : "/#trending"} className={linkClass(false)}>
            Selection
          </a>
          <Link to="/brands" className={linkClass(isBrands)}>
            Brands
          </Link>
          <Link to="/cooler-door" className={linkClass(isCoolerDoor)}>
            Cooler Door
          </Link>
          <a href={isHome ? "#kegs" : "/#kegs"} className={linkClass(false)}>
            Kegs
          </a>
          <a href={isHome ? "#visit" : "/#visit"} className={linkClass(false)}>
            Visit
          </a>
        </nav>

        {/* Zone 3: Single Primary Action */}
        <div className="flex shrink-0 items-center">
          {onOpenKegModal ? (
            <button
              type="button"
              onClick={(e) => onOpenKegModal(e.currentTarget)}
              className="inline-flex min-h-10 cursor-pointer items-center justify-center whitespace-nowrap rounded-xl bg-cyan-400 px-4 text-sm font-bold text-[#06131D] transition hover:bg-cyan-300"
            >
              Keg inquiries
            </button>
          ) : (
            <a
              href={isHome ? "#kegs" : "/#kegs"}
              className="inline-flex min-h-10 items-center justify-center whitespace-nowrap rounded-xl bg-cyan-400 px-4 text-sm font-bold text-[#06131D] transition hover:bg-cyan-300"
            >
              Keg inquiries
            </a>
          )}
        </div>
      </div>

      {/* Compact Mobile Navigation Row */}
      <nav
        aria-label="Mobile navigation"
        className="flex items-center justify-between gap-2 overflow-x-auto border-t border-slate-800/70 px-5 py-1 md:hidden"
      >
        <a href={isHome ? "#trending" : "/#trending"} className={linkClass(false)}>
          Selection
        </a>
        <Link to="/brands" className={linkClass(isBrands)}>
          Brands
        </Link>
        <Link to="/cooler-door" className={linkClass(isCoolerDoor)}>
          Cooler Door
        </Link>
        <a href={isHome ? "#kegs" : "/#kegs"} className={linkClass(false)}>
          Kegs
        </a>
        <a href={isHome ? "#visit" : "/#visit"} className={linkClass(false)}>
          Visit
        </a>
      </nav>
    </header>
  );
}
