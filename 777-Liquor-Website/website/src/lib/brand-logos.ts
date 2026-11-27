/**
 * Brand logo lookup linked directly to the local /images/brands folder
 * (public/images/brands/brands.json and local verified brand logo files).
 */
export type BrandLogoEntry = {
  slug: string;
  brand: string;
  category: string;
  logo: string | null;
  status: string;
  /** Light (white-on-transparent) logo that looks best directly on dark slate surfaces. */
  onDark?: boolean;
};

type BrandIndex = { fallback: string; brands: BrandLogoEntry[] };

export const BRAND_LOGO_FOLDER = "/images/brands";
export const PLACEHOLDER_LOGO = "/images/placeholder.svg";

let indexPromise: Promise<BrandIndex> | null = null;

/**
 * Canonical slug aliases mapping homepage, keg schedule, and Cooler Door inventory
 * brand variants to verified brand slugs in public/images/brands/brands.json.
 * Keeping resolution dynamic via brands.json avoids broken links whenever logo files
 * change format (for example, PNG/SVG to WebP).
 */
const BRAND_SLUG_ALIASES: Record<string, string> = {
  "kona-brewing": "big-wave",
  "kona-big-wave": "big-wave",
  "kona-longboard": "big-wave",
  "kona-hanalei-island-ipa": "big-wave",
  "kona-castaway-ipa": "big-wave",
  "aloha-beer-co": "aloha-beer",
  "coors-banquet": "coors",
  "busch-light": "busch",
  "corona-extra": "corona",
  "corona-premier": "corona",
  "corona-light": "corona",
  "modelo-especial": "modelo",
  "modelo-negra": "modelo",
  "dos-equis-lager": "dos-equis",
  "asahi-super-dry": "asahi",
  "kirin-ichiban": "kirin",
  "sierra-nevada-pale-ale": "sierra-nevada",
  "titos-handmade-vodka": "titos",
  "suntory-196": "196-suntory",
  "monaco-cocktails": "monaco",
  "smirnoff-ice": "smirnoff",
  "white-claw-hard-seltzer": "white-claw",
  "truly-hard-seltzer": "truly",
  "high-noon-sun-sips": "high-noon",
  "twisted-tea-hard-iced-tea": "twisted-tea",
  "guinness-draught": "guinness",
  "heineken-silver": "heineken",
  "heineken-0-0": "heineken",
  "bud-light-seltzer": "bud-light",
  "sapporo-premium": "sapporo",
  "blue-moon-belgian-white": "blue-moon",
  "cutwater-spirits": "cutwater",
};

function toRawBrandSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2019']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-");
}

export function brandSlug(name: string): string {
  const slug = toRawBrandSlug(name);
  return BRAND_SLUG_ALIASES[slug] ?? slug;
}

export function loadBrandIndex(): Promise<BrandIndex> {
  if (!indexPromise) {
    indexPromise = fetch(`${BRAND_LOGO_FOLDER}/brands.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`brands.json ${r.status}`);
        return r.json() as Promise<BrandIndex>;
      })
      .catch(() => {
        indexPromise = null;
        return { fallback: PLACEHOLDER_LOGO, brands: [] };
      });
  }
  return indexPromise;
}

/** Returns all brands that have a verified local logo file in public/images/brands. */
export async function getLinkedBrandLogos(): Promise<BrandLogoEntry[]> {
  const index = await loadBrandIndex();
  return index.brands
    .filter((entry) => Boolean(entry.logo) && entry.status === "ok")
    .sort((a, b) => a.brand.localeCompare(b.brand));
}

/** Ordered list of local logo URLs in /images/brands to try for a brand. */
export async function getBrandLogoSources(brand: string): Promise<string[]> {
  const rawSlug = toRawBrandSlug(brand);
  const slug = brandSlug(brand);
  const index = await loadBrandIndex();
  const sources: string[] = [];

  const pushUnique = (url: string | null | undefined) => {
    if (url && !sources.includes(url)) sources.push(url);
  };

  // 1. Exact verified match in public/images/brands/brands.json (prefer raw slug, then aliased slug)
  const rawExact = index.brands.find(
    (b) => b.logo && (b.slug === rawSlug || b.brand.toLowerCase() === brand.toLowerCase()),
  );
  pushUnique(rawExact?.logo);

  if (slug !== rawSlug) {
    const aliasExact = index.brands.find((b) => b.logo && b.slug === slug);
    pushUnique(aliasExact?.logo);
  }

  // 2. Prefix match for multi-word brand variants (e.g. "Heineken Silver" -> "Heineken")
  if (!sources.length) {
    const prefixEntry = index.brands.find(
      (b) =>
        b.logo &&
        (rawSlug.startsWith(`${b.slug}-`) ||
          slug.startsWith(`${b.slug}-`) ||
          b.slug.startsWith(`${slug}-`)),
    );
    pushUnique(prefixEntry?.logo);
  }

  pushUnique(index.fallback || PLACEHOLDER_LOGO);
  return sources;
}

/** Returns the best local logo URL, or the placeholder when nothing is matched. */
export async function getBrandLogo(brand: string): Promise<string> {
  return (await getBrandLogoSources(brand))[0];
}

/** Local logo URLs that are light-on-transparent and designed to sit directly on dark backgrounds. */
export async function getDarkBackdropLogos(): Promise<Set<string>> {
  const index = await loadBrandIndex();
  return new Set(index.brands.filter((b) => b.onDark && b.logo).map((b) => b.logo as string));
}
