import { useEffect, useState } from "react";
import { PLACEHOLDER_LOGO, getBrandLogoSources, getDarkBackdropLogos } from "../lib/brand-logos";

type BrandLogoProps = {
  brand: string;
  size?: number;
  className?: string;
  showFallbackBadge?: boolean;
};

function brandInitials(brand: string): string {
  const words = brand
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "777";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

/**
 * Displays a verified local alcohol brand logo from public/images/brands.
 * Automatically places dark-ink transparent logos on a crisp contrast plate
 * for Midnight Slate dark mode, while rendering light-ink (onDark) logos directly on slate.
 */
export function BrandLogo({
  brand,
  size = 64,
  className,
  showFallbackBadge = false,
}: BrandLogoProps) {
  const [sources, setSources] = useState<string[]>([PLACEHOLDER_LOGO]);
  const [i, setI] = useState(0);
  const [darkSet, setDarkSet] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let live = true;
    getDarkBackdropLogos().then((d) => {
      if (live) setDarkSet(d);
    });
    getBrandLogoSources(brand).then((s) => {
      if (live) {
        setSources(s);
        setI(0);
      }
    });
    return () => {
      live = false;
    };
  }, [brand]);

  const next = () => setI((n) => Math.min(n + 1, sources.length - 1));
  const source = sources[i] || PLACEHOLDER_LOGO;
  const isMissing = source === PLACEHOLDER_LOGO || source.endsWith("/placeholder.svg");

  if (isMissing) {
    if (!showFallbackBadge) return null;
    return (
      <div
        className={`inline-flex items-center justify-center rounded-xl border border-slate-700/80 bg-slate-900 text-xs font-semibold tracking-wider text-cyan-300 select-none ${className ?? ""}`}
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        {brandInitials(brand)}
      </div>
    );
  }

  const isLightInk = darkSet.has(source);

  return (
    <span
      className={`inline-flex items-center justify-center rounded-xl p-2 transition-colors ${
        isLightInk
          ? "bg-slate-950/90 border border-slate-800"
          : "bg-slate-100/95 border border-slate-300/60"
      } ${className ?? ""}`}
      style={{ minWidth: size, height: size }}
    >
      <img
        src={source}
        alt={`${brand} logo`}
        width={size}
        height={size}
        loading="lazy"
        referrerPolicy="no-referrer"
        className="max-h-full max-w-full object-contain"
        onError={next}
      />
    </span>
  );
}
