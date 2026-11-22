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
 * Direct mappings from normalized brand slugs (from the homepage, keg schedule,
 * or Cooler Door Excel inventory) to local files in public/images/brands.
 */
const LOCAL_LOGO_OVERRIDES: Record<string, string> = {
  "kona-brewing": `${BRAND_LOGO_FOLDER}/big-wave.png`,
  "kona-big-wave": `${BRAND_LOGO_FOLDER}/big-wave.png`,
  "kona-longboard": `${BRAND_LOGO_FOLDER}/big-wave.png`,
  "kona-hanalei-island-ipa": `${BRAND_LOGO_FOLDER}/big-wave.png`,
  "kona-castaway-ipa": `${BRAND_LOGO_FOLDER}/big-wave.png`,
  "aloha-beer-co": `${BRAND_LOGO_FOLDER}/aloha-beer.png`,
  "coors-banquet": `${BRAND_LOGO_FOLDER}/coors.svg`,
  "busch-light": `${BRAND_LOGO_FOLDER}/busch.png`,
  "corona-extra": `${BRAND_LOGO_FOLDER}/corona.svg`,
  "corona-premier": `${BRAND_LOGO_FOLDER}/corona.svg`,
  "corona-light": `${BRAND_LOGO_FOLDER}/corona.svg`,
  "modelo-especial": `${BRAND_LOGO_FOLDER}/modelo.png`,
  "modelo-negra": `${BRAND_LOGO_FOLDER}/modelo.png`,
  "dos-equis-lager": `${BRAND_LOGO_FOLDER}/dos-equis.png`,
  "asahi-super-dry": `${BRAND_LOGO_FOLDER}/asahi.svg`,
  "kirin-ichiban": `${BRAND_LOGO_FOLDER}/kirin.svg`,
  "sierra-nevada-pale-ale": `${BRAND_LOGO_FOLDER}/sierra-nevada.svg`,
  "titos-handmade-vodka": `${BRAND_LOGO_FOLDER}/titos.svg`,
  titos: `${BRAND_LOGO_FOLDER}/titos.svg`,
  "suntory-196": `${BRAND_LOGO_FOLDER}/196-suntory.svg`,
  "monaco-cocktails": `${BRAND_LOGO_FOLDER}/monaco.png`,
  "smirnoff-ice": `${BRAND_LOGO_FOLDER}/smirnoff.png`,
  "white-claw-hard-seltzer": `${BRAND_LOGO_FOLDER}/white-claw.png`,
  "truly-hard-seltzer": `${BRAND_LOGO_FOLDER}/truly.png`,
  "high-noon-sun-sips": `${BRAND_LOGO_FOLDER}/high-noon.png`,
  "twisted-tea-hard-iced-tea": `${BRAND_LOGO_FOLDER}/twisted-tea.png`,
  "guinness-draught": `${BRAND_LOGO_FOLDER}/guinness.png`,
  "heineken-silver": `${BRAND_LOGO_FOLDER}/heineken.svg`,
  "heineken-0-0": `${BRAND_LOGO_FOLDER}/heineken.svg`,
  "bud-light-seltzer": `${BRAND_LOGO_FOLDER}/bud-light.png`,
  "pabst-blue-ribbon": `${BRAND_LOGO_FOLDER}/pabst-blue-ribbon.png`,
  "sapporo-premium": `${BRAND_LOGO_FOLDER}/sapporo.svg`,
  "blue-moon-belgian-white": `${BRAND_LOGO_FOLDER}/blue-moon.png`,
  "mikes-hard-lemonade": `${BRAND_LOGO_FOLDER}/mikes-hard-lemonade.png`,
  "cutwater-spirits": `${BRAND_LOGO_FOLDER}/cutwater.png`,
  "honolulu-beerworks": `${BRAND_LOGO_FOLDER}/honolulu-beerworks.png`,
  "voodoo-ranger": `${BRAND_LOGO_FOLDER}/voodoo-ranger.png`,
  "topo-chico": `${BRAND_LOGO_FOLDER}/topo-chico.png`,
  "topo-chico-hard-seltzer": `${BRAND_LOGO_FOLDER}/topo-chico-hard-seltzer.png`,
  "johnnie-walker": `${BRAND_LOGO_FOLDER}/johnnie-walker.svg`,
  "makers-mark": `${BRAND_LOGO_FOLDER}/makers-mark.svg`,
  "grey-goose": `${BRAND_LOGO_FOLDER}/grey-goose.png`,
  "captain-morgan": `${BRAND_LOGO_FOLDER}/captain-morgan.png`,
  "bombay-sapphire": `${BRAND_LOGO_FOLDER}/bombay-sapphire.png`,
  "ketel-one": `${BRAND_LOGO_FOLDER}/ketel-one.svg`,
  "don-julio": `${BRAND_LOGO_FOLDER}/don-julio.svg`,
  "jose-cuervo": `${BRAND_LOGO_FOLDER}/jose-cuervo.jpg`,
  "1800-tequila": `${BRAND_LOGO_FOLDER}/1800-tequila.svg`,
};

const BRAND_SLUG_ALIASES: Record<string, string> = {
  "corona-extra": "corona",
  "modelo-especial": "modelo",
  "titos-handmade-vodka": "titos",
  "suntory-196": "196-suntory",
  "monaco-cocktails": "monaco",
  "aloha-beer-co": "aloha-beer",
  "coors-banquet": "coors",
  "kirin-ichiban": "kirin",
  "asahi-super-dry": "asahi",
  "dos-equis-lager": "dos-equis",
  "sierra-nevada-pale-ale": "sierra-nevada",
  "smirnoff-ice": "smirnoff",
  "kona-brewing": "big-wave",
};

export function brandSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2019']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-");
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
  const rawSlug = brand
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2019']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-");
  const slug = brandSlug(brand);
  const index = await loadBrandIndex();
  const sources: string[] = [];

  const pushUnique = (url: string | null | undefined) => {
    if (url && !sources.includes(url)) sources.push(url);
  };

  // 1. Direct local override in public/images/brands
  pushUnique(LOCAL_LOGO_OVERRIDES[rawSlug]);
  pushUnique(LOCAL_LOGO_OVERRIDES[slug]);

  // 2. Exact match in public/images/brands/brands.json
  const exactEntry = index.brands.find(
    (b) => b.slug === slug || b.slug === rawSlug || b.brand.toLowerCase() === brand.toLowerCase(),
  );
  pushUnique(exactEntry?.logo);

  // 3. Prefix match for multi-word brand variants (e.g. "Heineken Silver" -> "Heineken")
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
