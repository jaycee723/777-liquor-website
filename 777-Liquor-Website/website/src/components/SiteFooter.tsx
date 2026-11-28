import { Link } from "@tanstack/react-router";

export function SiteFooter() {
  return (
    <footer className="border-t border-slate-800/90 bg-[#050A10] text-slate-400">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-5 py-6 text-xs sm:flex-row sm:px-8">
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 font-mono tracking-wide text-slate-400">
          <span className="text-slate-200">© 777 LIQUOR</span>
          <span aria-hidden="true">·</span>
          <span>HONOLULU · HAWAIʻI</span>
          <span aria-hidden="true">·</span>
          <span>21+ · DRINK RESPONSIBLY</span>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-5 font-medium">
          <Link to="/" className="transition hover:text-cyan-300">
            Home
          </Link>
          <Link to="/cooler-door" className="transition hover:text-cyan-300">
            Cooler Door
          </Link>
          <Link to="/brands" className="transition hover:text-cyan-300">
            Brand Logos
          </Link>
          <a href="mailto:777liquorstorehi@gmail.com" className="transition hover:text-cyan-300">
            Contact
          </a>
          <a
            href="https://inventory.777liquor.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-500 transition hover:text-cyan-300"
          >
            Staff Inventory
          </a>
        </div>
      </div>
    </footer>
  );
}
