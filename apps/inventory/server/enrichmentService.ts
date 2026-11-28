import { GoogleGenAI } from '@google/genai';
import type {
  CanonicalItem,
  EnrichCitation,
  EnrichLookupType,
  EnrichMarketReference,
  EnrichProposal,
  EnrichResponse,
  EnrichSourceStatus,
  Hi5Status,
} from '../src/types/inventory.ts';
import {
  determineHi5Eligibility,
  normalizeItemName,
} from '../src/utils/inventoryRules.ts';
import {
  assertSafePublicUrl,
  parseAndValidateExternalUrl,
  sanitizeText,
  sanitizeUpc,
} from './security.ts';

export interface OnlineEnrichInput {
  item: Pick<
    CanonicalItem,
    | 'clover_id'
    | 'name'
    | 'normalized_name'
    | 'brand'
    | 'category'
    | 'subcategory'
    | 'upc'
    | 'price'
    | 'cost'
    | 'vendor'
    | 'unit_size'
    | 'sell_pack_qty'
    | 'packs_per_case'
    | 'hi5_eligible'
    | 'logo_url'
    | 'image_url'
  >;
  tasks: EnrichLookupType[];
  customQuery?: string;
  brandWebsite?: string;
}

const KNOWN_BRAND_DOMAINS: Array<{ match: RegExp; domain: string; label: string }> = [
  { match: /kona\s*brew/i, domain: 'konabrewingco.com', label: 'Kona Brewing Co.' },
  { match: /maui\s*brew/i, domain: 'mauibrewingco.com', label: 'Maui Brewing Co.' },
  { match: /aloha\s*beer/i, domain: 'alohabeer.com', label: 'Aloha Beer Co.' },
  { match: /lanikai/i, domain: 'lanikaibrewing.com', label: 'Lanikai Brewing Co.' },
  { match: /heineken/i, domain: 'heineken.com', label: 'Heineken' },
  { match: /asahi/i, domain: 'asahibeer.com', label: 'Asahi' },
  { match: /sapporo/i, domain: 'sapporobeer.com', label: 'Sapporo' },
  { match: /kirin/i, domain: 'kirin.com', label: 'Kirin' },
  { match: /corona/i, domain: 'coronausa.com', label: 'Corona' },
  { match: /modelo/i, domain: 'modelousa.com', label: 'Modelo' },
  { match: /stella\s*artois/i, domain: 'stellaartois.com', label: 'Stella Artois' },
  { match: /bud\s*light|budweiser/i, domain: 'budweiser.com', label: 'Budweiser' },
  { match: /michelob/i, domain: 'michelobultra.com', label: 'Michelob Ultra' },
  { match: /white\s*claw/i, domain: 'whiteclaw.com', label: 'White Claw' },
  { match: /high\s*noon/i, domain: 'highnoonspirits.com', label: 'High Noon' },
  { match: /cutwater/i, domain: 'cutwaterspirits.com', label: 'Cutwater Spirits' },
  { match: /tito/i, domain: 'titosvodka.com', label: "Tito's Handmade Vodka" },
  { match: /casamigos/i, domain: 'casamigos.com', label: 'Casamigos' },
  { match: /hennessy/i, domain: 'hennessy.com', label: 'Hennessy' },
  { match: /jameson/i, domain: 'jamesonwhiskey.com', label: 'Jameson' },
  { match: /jack\s*daniel/i, domain: 'jackdaniels.com', label: "Jack Daniel's" },
  { match: /patron|patr[oó]n/i, domain: 'patrontequila.com', label: 'Patrón' },
  { match: /don\s*julio/i, domain: 'donjulio.com', label: 'Don Julio' },
  { match: /johnnie\s*walker/i, domain: 'johnniewalker.com', label: 'Johnnie Walker' },
  { match: /maker'?s\s*mark/i, domain: 'makersmark.com', label: "Maker's Mark" },
  { match: /grey\s*goose/i, domain: 'greygoose.com', label: 'Grey Goose' },
  { match: /smirnoff/i, domain: 'smirnoff.com', label: 'Smirnoff' },
  { match: /crown\s*royal/i, domain: 'crownroyal.com', label: 'Crown Royal' },
  { match: /hendrick/i, domain: 'hendricksgin.com', label: "Hendrick's Gin" },
  { match: /josh\s*cellars/i, domain: 'joshcellars.com', label: 'Josh Cellars' },
  { match: /kim\s*crawford/i, domain: 'kimcrawfordwines.com', label: 'Kim Crawford' },
  { match: /meiomi/i, domain: 'meiomi.com', label: 'Meiomi' },
  { match: /caymus/i, domain: 'wagnerfamilyofwine.com', label: 'Caymus' },
  { match: /la\s*marca/i, domain: 'lamarcaprosecco.com', label: 'La Marca' },
  { match: /veuve\s*clicquot/i, domain: 'veuveclicquot.com', label: 'Veuve Clicquot' },
  { match: /aloha\s*maid/i, domain: 'alohamaid.com', label: 'Aloha Maid' },
  { match: /hawaiian\s*sun/i, domain: 'hawaiiansunproducts.com', label: 'Hawaiian Sun' },
  { match: /ito\s*en/i, domain: 'itoen.com', label: 'Ito En' },
  { match: /honolulu\s*cookie/i, domain: 'honolulucookie.com', label: 'Honolulu Cookie Company' },
  { match: /red\s*bull/i, domain: 'redbull.com', label: 'Red Bull' },
  { match: /coca[-\s]?cola|coke/i, domain: 'coca-cola.com', label: 'Coca-Cola' },
  { match: /monster\s*energy/i, domain: 'monsterenergy.com', label: 'Monster Energy' },
];

const USER_AGENT = '777LiquorInventoryApp/1.0 (https://inventory.777liquor.com)';

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function formatGeminiError(err: unknown): { detail: string; notice: string } {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  if (raw.includes('RESOURCE_EXHAUSTED') || raw.includes('"code":429') || raw.includes('429')) {
    return {
      detail: 'Gemini API quota limit reached (429).',
      notice:
        'Gemini web search hit its current API quota limit. Check or upgrade your API key in Settings > Secrets, or use UPC Database / Brand Logo & Photo lookups below.',
    };
  }
  if (raw.includes('PERMISSION_DENIED') || raw.includes('API_KEY_INVALID') || raw.includes('403')) {
    return {
      detail: 'Gemini API key permission error.',
      notice: 'Check your Gemini API key configuration in Settings > Secrets.',
    };
  }
  return {
    detail: 'Gemini live lookup temporarily unavailable.',
    notice: 'Gemini web search could not complete right now. Try again shortly.',
  };
}

async function fetchJsonWithTimeout<T>(url: string, timeoutMs = 6500): Promise<T | null> {
  await assertSafePublicUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text || text.trim().startsWith('<')) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function verifyExternalImageUrl(rawUrl: string, timeoutMs = 4500): Promise<string | null> {
  try {
    const safeUrl = await assertSafePublicUrl(rawUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(safeUrl.toString(), {
        method: 'GET',
        headers: {
          Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8',
          'User-Agent': USER_AGENT,
          Range: 'bytes=0-1024',
        },
        redirect: 'follow',
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const finalCheck = parseAndValidateExternalUrl(res.url || safeUrl.toString());
      if (!finalCheck.ok) return null;
      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      if (!contentType.startsWith('image/') || contentType.includes('svg')) {
        return null;
      }
      return finalCheck.url.toString();
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

export function toProxiedImageUrl(verifiedHttpsUrl: string): string {
  return `/api/enrich/image-proxy?url=${encodeURIComponent(verifiedHttpsUrl)}`;
}

function mapCategoryFromText(text: string): string | null {
  const lower = text.toLowerCase();
  if (/(vodka|whiskey|whisky|bourbon|tequila|rum|gin|cognac|scotch|liqueur|brandy|spirits|sake|soju)/i.test(lower)) {
    return 'Spirits';
  }
  if (/(cabernet|chardonnay|pinot|merlot|sauvignon|prosecco|champagne|wine|ros[eé]|malbec|riesling)/i.test(lower)) {
    return 'Wine';
  }
  if (/(seltzer|canned cocktail|rtd|ready to drink|high noon|cutwater|white claw|smirnoff ice|hard tea)/i.test(lower)) {
    return 'RTD';
  }
  if (/(beer|ipa|lager|ale|pilsner|stout|porter|hefeweizen|cider)/i.test(lower)) {
    return 'Beer';
  }
  if (/(juice|nectar|tea|water|soda|cola|energy drink|coffee|non-alcoholic|beverage)/i.test(lower)) {
    return 'Non-Alcoholic';
  }
  if (/(cookie|chocolate|macadamia|gift|souvenir)/i.test(lower)) {
    return 'Gift';
  }
  if (/(chip|snack|jerky|candy|cracker|noodle|grocery|food)/i.test(lower)) {
    return 'Grocery';
  }
  return null;
}

function extractSizeToken(text: string): string | null {
  const m = text.match(/\b(\d+(?:\.\d+)?)\s*(fl\.?\s*oz|oz|ml|mL|l|L|cl|pc\s*box)\b/i);
  if (!m) return null;
  const num = m[1];
  const unitRaw = m[2].toLowerCase().replace(/\s+/g, '');
  if (unitRaw === 'oz' || unitRaw === 'floz' || unitRaw === 'fl.oz') return `${num}oz`;
  if (unitRaw === 'ml') return `${num}mL`;
  if (unitRaw === 'l') return `${num} L`;
  if (unitRaw === 'cl') return `${Number(num) * 10}mL`;
  return m[0].trim();
}

function extractPackCount(text: string): number | null {
  const m = text.match(/\b(\d{1,2})\s*(?:pk|pack|ct|count|cans?|bottles?)\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n >= 1 && n <= 48 ? n : null;
}

function extractDomainFromWebsite(input?: string): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const checked = parseAndValidateExternalUrl(withScheme);
  if (!checked.ok) return null;
  return checked.url.hostname.replace(/^www\./i, '');
}

function findKnownBrandDomain(brand: string, name: string): { domain: string; label: string } | null {
  const hay = `${brand} ${name}`;
  for (const entry of KNOWN_BRAND_DOMAINS) {
    if (entry.match.test(hay)) {
      return { domain: entry.domain, label: entry.label };
    }
  }
  return null;
}

/**
 * Builds clean Wikimedia Commons search queries without duplicated brand words or pack tokens.
 */
function buildCleanPhotoQueries(item: OnlineEnrichInput['item'], customQuery?: string): string[] {
  if (customQuery?.trim()) {
    return [sanitizeText(customQuery, 80)];
  }
  const stripped = item.normalized_name
    .replace(/\b\d+(?:\.\d+)?\s*(?:oz|ml|l|pk|pack|pc\s*box|bottles?|cans?)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  const words = stripped.split(' ').filter(Boolean);
  const shortName = words.slice(0, 3).join(' ');
  const brandClean = item.brand.trim();
  const catHint =
    item.category === 'Beer'
      ? 'beer bottle'
      : item.category === 'Spirits'
        ? 'bottle'
        : item.category === 'Wine'
          ? 'wine bottle'
          : item.category === 'Non-Alcoholic'
            ? 'drink can'
            : '';

  const candidates = [
    catHint && brandClean ? `${brandClean} ${catHint}` : '',
    shortName,
    brandClean,
  ]
    .map((q) => q.replace(/\s+/g, ' ').trim())
    .filter((q) => q.length >= 3);

  return Array.from(new Set(candidates));
}

interface OpenFoodFactsResponse {
  status?: number;
  product?: {
    product_name?: string;
    brands?: string;
    quantity?: string;
    categories?: string;
    image_front_url?: string;
    image_url?: string;
    image_front_small_url?: string;
  };
}

interface UpcItemDbResponse {
  code?: string;
  message?: string;
  items?: Array<{
    ean?: string;
    upc?: string;
    title?: string;
    brand?: string;
    category?: string;
    size?: string;
    images?: string[];
    offers?: Array<{
      merchant?: string;
      domain?: string;
      title?: string;
      price?: number;
      currency?: string;
      link?: string;
    }>;
  }>;
}

interface WikimediaSearchResponse {
  query?: {
    pages?: Record<
      string,
      {
        title?: string;
        imageinfo?: Array<{
          url?: string;
          thumburl?: string;
          mime?: string;
          descriptionurl?: string;
        }>;
      }
    >;
  };
}

interface DuckDuckGoResponse {
  Heading?: string;
  Abstract?: string;
  AbstractURL?: string;
  Image?: string;
  Results?: Array<{ FirstURL?: string; Text?: string }>;
  Infobox?: {
    content?: Array<{ label?: string; value?: string }>;
  };
}

interface PartialEnrichOutput {
  proposals: EnrichProposal[];
  sourcesChecked: EnrichSourceStatus[];
  citations: EnrichCitation[];
  marketReferences: EnrichMarketReference[];
  notice?: string;
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw.trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractGroundingCitations(response: unknown): EnrichCitation[] {
  const citations: EnrichCitation[] = [];
  const seen = new Set<string>();
  const r = response as {
    candidates?: Array<{
      groundingMetadata?: {
        groundingChunks?: Array<{
          web?: { uri?: string; title?: string };
        }>;
      };
    }>;
  };
  const chunks = r?.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  for (const chunk of chunks) {
    const uri = chunk.web?.uri;
    if (!uri || seen.has(uri)) continue;
    const valid = parseAndValidateExternalUrl(uri);
    if (!valid.ok) continue;
    seen.add(uri);
    citations.push({
      title: sanitizeText(chunk.web?.title || valid.url.hostname, 110),
      url: valid.url.toString(),
    });
  }
  return citations.slice(0, 8);
}

async function lookupDuckDuckGoBrandInfo(
  brandQuery: string
): Promise<{ domain: string | null; abstractUrl: string | null; imageUrl: string | null; heading: string | null }> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(brandQuery)}&format=json&no_html=1&skip_disambig=1`;
  const ddg = await fetchJsonWithTimeout<DuckDuckGoResponse>(url, 5000);
  if (!ddg) {
    return { domain: null, abstractUrl: null, imageUrl: null, heading: null };
  }

  let domain: string | null = null;
  const firstResultUrl = ddg.Results?.[0]?.FirstURL;
  if (firstResultUrl) {
    domain = extractDomainFromWebsite(firstResultUrl);
  }
  if (!domain && ddg.Infobox?.content) {
    const siteEntry = ddg.Infobox.content.find((c) => /website/i.test(c.label || ''));
    if (siteEntry?.value) {
      domain = extractDomainFromWebsite(siteEntry.value);
    }
  }

  const abstractUrl =
    ddg.AbstractURL && parseAndValidateExternalUrl(ddg.AbstractURL).ok ? ddg.AbstractURL : null;

  let imageUrl: string | null = null;
  if (ddg.Image) {
    const fullImg = ddg.Image.startsWith('http')
      ? ddg.Image
      : ddg.Image.startsWith('/')
        ? `https://duckduckgo.com${ddg.Image}`
        : null;
    if (fullImg && parseAndValidateExternalUrl(fullImg).ok) {
      imageUrl = fullImg;
    }
  }

  return { domain, abstractUrl, imageUrl, heading: ddg.Heading || null };
}

/**
 * 1. Live UPC Product Database Lookup (Open Food Facts + UPCitemdb)
 */
export async function lookupUpcOnline(
  item: OnlineEnrichInput['item'],
  customQuery?: string
): Promise<PartialEnrichOutput> {
  const proposals: EnrichProposal[] = [];
  const sourcesChecked: EnrichSourceStatus[] = [];
  const citations: EnrichCitation[] = [];
  const marketReferences: EnrichMarketReference[] = [];

  const upc = sanitizeUpc(
    customQuery && /^\d{8,14}$/.test(customQuery.replace(/[\s-]+/g, '')) ? customQuery : item.upc
  );
  if (!upc || upc.length < 8) {
    sourcesChecked.push({
      source: 'UPC Databases',
      status: 'no_match',
      detail: 'No valid 8–14 digit UPC on this SKU. Scan or enter a barcode first.',
    });
    return { proposals, sourcesChecked, citations, marketReferences };
  }

  const offUrl = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(upc)}.json`;
  const upcDbUrl = `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(upc)}`;

  const [offRes, upcDbRes] = await Promise.all([
    fetchJsonWithTimeout<OpenFoodFactsResponse>(offUrl, 6000),
    fetchJsonWithTimeout<UpcItemDbResponse>(upcDbUrl, 6000),
  ]);

  // Process Open Food Facts
  if (offRes?.status === 1 && offRes.product) {
    const prod = offRes.product;
    const offPageUrl = `https://world.openfoodfacts.org/product/${encodeURIComponent(upc)}`;
    citations.push({ title: `Open Food Facts — UPC ${upc}`, url: offPageUrl });
    sourcesChecked.push({
      source: 'Open Food Facts',
      status: 'matched',
      detail: prod.product_name || `Matched UPC ${upc}`,
    });

    const prodBrand = sanitizeText(prod.brands?.split(',')[0] || '', 80);
    if (prodBrand && (!item.brand || item.brand.toLowerCase() === 'unknown')) {
      proposals.push({
        field: 'brand',
        currentValue: item.brand,
        proposedValue: prodBrand,
        source: 'Open Food Facts (Live UPC)',
        sourceUrl: offPageUrl,
        confidence: 'high',
      });
    }

    const sizeToken = extractSizeToken(prod.quantity || prod.product_name || '');
    if (sizeToken && !item.unit_size) {
      proposals.push({
        field: 'unit_size',
        currentValue: item.unit_size || null,
        proposedValue: sizeToken,
        source: 'Open Food Facts (Live UPC)',
        sourceUrl: offPageUrl,
        confidence: 'high',
      });
    }

    const rawPhoto = prod.image_front_url || prod.image_url || prod.image_front_small_url;
    if (rawPhoto && !item.image_url) {
      const verified = await verifyExternalImageUrl(rawPhoto);
      if (verified) {
        proposals.push({
          field: 'image_url',
          currentValue: item.image_url,
          proposedValue: toProxiedImageUrl(verified),
          source: 'Open Food Facts Product Photo',
          sourceUrl: offPageUrl,
          confidence: 'high',
        });
      }
    }

    const mappedCat = mapCategoryFromText(`${prod.categories || ''} ${prod.product_name || ''}`);
    if (mappedCat && (!item.category || item.category === 'Uncategorized')) {
      proposals.push({
        field: 'category',
        currentValue: item.category,
        proposedValue: mappedCat,
        source: 'Open Food Facts Category',
        sourceUrl: offPageUrl,
        confidence: 'medium',
      });
    }
  } else {
    sourcesChecked.push({
      source: 'Open Food Facts',
      status: 'no_match',
      detail: `UPC ${upc} not in Open Food Facts`,
    });
  }

  // Process UPCitemdb
  if (upcDbRes?.code === 'EXCEED_LIMIT') {
    sourcesChecked.push({
      source: 'UPCitemdb',
      status: 'unavailable',
      detail: 'Public trial rate limit reached temporarily.',
    });
  } else if (upcDbRes?.items?.[0]) {
    const dbMatch = upcDbRes.items[0];
    sourcesChecked.push({
      source: 'UPCitemdb',
      status: 'matched',
      detail: sanitizeText(dbMatch.title || `Matched UPC ${upc}`, 90),
    });

    const dbBrand = sanitizeText(dbMatch.brand || '', 80);
    if (dbBrand && (!item.brand || item.brand.toLowerCase() === 'unknown') && !proposals.some((p) => p.field === 'brand')) {
      proposals.push({
        field: 'brand',
        currentValue: item.brand,
        proposedValue: dbBrand,
        source: 'UPCitemdb (Live UPC)',
        confidence: 'high',
      });
    }

    const dbTitle = sanitizeText(dbMatch.title || '', 140);
    if (dbTitle) {
      const normalizedTitle = normalizeItemName(dbTitle);
      if (normalizedTitle && normalizedTitle !== item.normalized_name) {
        proposals.push({
          field: 'normalized_name',
          currentValue: item.normalized_name,
          proposedValue: normalizedTitle,
          source: 'UPCitemdb + Store Title Case Rule',
          confidence: 'medium',
        });
      }
      const sizeToken = extractSizeToken(`${dbMatch.size || ''} ${dbTitle}`);
      if (sizeToken && !item.unit_size && !proposals.some((p) => p.field === 'unit_size')) {
        proposals.push({
          field: 'unit_size',
          currentValue: item.unit_size || null,
          proposedValue: sizeToken,
          source: 'UPCitemdb Product Specs',
          confidence: 'high',
        });
      }
      const packQty = extractPackCount(dbTitle);
      if (packQty && item.sell_pack_qty === null) {
        proposals.push({
          field: 'sell_pack_qty',
          currentValue: null,
          proposedValue: packQty,
          source: 'UPCitemdb Title Pack Count',
          confidence: 'medium',
        });
      }
    }

    if (Array.isArray(dbMatch.images) && !item.image_url && !proposals.some((p) => p.field === 'image_url')) {
      for (const imgUrl of dbMatch.images.slice(0, 3)) {
        const verified = await verifyExternalImageUrl(imgUrl);
        if (verified) {
          proposals.push({
            field: 'image_url',
            currentValue: item.image_url,
            proposedValue: toProxiedImageUrl(verified),
            source: 'UPCitemdb Product Image',
            sourceUrl: verified,
            confidence: 'high',
          });
          break;
        }
      }
    }

    if (Array.isArray(dbMatch.offers)) {
      for (const offer of dbMatch.offers.slice(0, 4)) {
        if (typeof offer.price === 'number' && offer.price > 0) {
          const validLink = offer.link ? parseAndValidateExternalUrl(offer.link) : null;
          marketReferences.push({
            retailer: sanitizeText(offer.merchant || offer.domain || 'Online Retailer', 60),
            price: Math.round(offer.price * 100) / 100,
            url: validLink?.ok ? validLink.url.toString() : undefined,
            note: 'Retail market reference (not wholesale cost)',
          });
        }
      }
    }
  } else {
    sourcesChecked.push({
      source: 'UPCitemdb',
      status: 'no_match',
      detail: `No listing for UPC ${upc}`,
    });
  }

  return { proposals, sourcesChecked, citations, marketReferences };
}

/**
 * 2. Live Brand Logo & Product Photo Finder (Official Brand Icon + DuckDuckGo + Wikimedia Commons + UPC Photo)
 */
export async function lookupMediaOnline(
  item: OnlineEnrichInput['item'],
  options: { findLogo: boolean; findImage: boolean; customQuery?: string; brandWebsite?: string }
): Promise<PartialEnrichOutput> {
  const proposals: EnrichProposal[] = [];
  const sourcesChecked: EnrichSourceStatus[] = [];
  const citations: EnrichCitation[] = [];
  const marketReferences: EnrichMarketReference[] = [];

  const queryTerm = sanitizeText(options.customQuery || item.brand || item.normalized_name, 100);
  let resolvedDomain =
    extractDomainFromWebsite(options.brandWebsite) ||
    findKnownBrandDomain(item.brand, item.normalized_name)?.domain ||
    null;

  // Dynamic web brand discovery via DuckDuckGo Instant Answer (free, fast, no quota limits)
  let ddgInfo: Awaited<ReturnType<typeof lookupDuckDuckGoBrandInfo>> | null = null;
  if (!resolvedDomain && queryTerm) {
    ddgInfo = await lookupDuckDuckGoBrandInfo(queryTerm);
    if (ddgInfo.domain) {
      resolvedDomain = ddgInfo.domain;
    }
    if (ddgInfo.abstractUrl) {
      citations.push({
        title: ddgInfo.heading || `${queryTerm} Reference`,
        url: ddgInfo.abstractUrl,
      });
    }
  }

  // Brand Logo lookup via official domain icon
  if (options.findLogo && resolvedDomain) {
    const faviconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(resolvedDomain)}&sz=128`;
    const verifiedLogo = await verifyExternalImageUrl(faviconUrl);
    if (verifiedLogo) {
      const brandSite = `https://${resolvedDomain}`;
      citations.push({ title: `Official Brand Site (${resolvedDomain})`, url: brandSite });
      sourcesChecked.push({
        source: 'Brand Website Icon',
        status: 'matched',
        detail: `Verified brand mark from ${resolvedDomain}`,
      });
      proposals.push({
        field: 'logo_url',
        currentValue: item.logo_url,
        proposedValue: toProxiedImageUrl(verifiedLogo),
        source: `Official Brand Icon (${resolvedDomain})`,
        sourceUrl: brandSite,
        confidence: 'high',
      });
    } else {
      sourcesChecked.push({
        source: 'Brand Website Icon',
        status: 'no_match',
        detail: `Could not verify icon from ${resolvedDomain}`,
      });
    }
  } else if (options.findLogo) {
    sourcesChecked.push({
      source: 'Brand Website Icon',
      status: 'no_match',
      detail: 'Add a brand website in Refine options (e.g. konabrewingco.com) to pull its icon.',
    });
  }

  // Product Photo lookup: Open Food Facts UPC -> Wikimedia Commons (clean queries) -> DuckDuckGo image
  if (options.findImage) {
    let foundImage = false;
    const upc = sanitizeUpc(item.upc);

    if (upc.length >= 8) {
      const upcResult = await lookupUpcOnline(item);
      const photoProp = upcResult.proposals.find((p) => p.field === 'image_url');
      if (photoProp) {
        proposals.push(photoProp);
        citations.push(...upcResult.citations);
        sourcesChecked.push({
          source: 'UPC Photo Lookup',
          status: 'matched',
          detail: photoProp.source,
        });
        foundImage = true;
      }
    }

    if (!foundImage) {
      const cleanQueries = buildCleanPhotoQueries(item, options.customQuery);
      for (const q of cleanQueries) {
        if (foundImage) break;
        const wikiUrl = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(q)}&gsrlimit=6&prop=imageinfo&iiprop=url|mime&iiurlwidth=480&format=json`;
        const wikiRes = await fetchJsonWithTimeout<WikimediaSearchResponse>(wikiUrl, 6000);
        const pages = wikiRes?.query?.pages ? Object.values(wikiRes.query.pages) : [];

        for (const page of pages) {
          const info = page.imageinfo?.[0];
          if (!info) continue;
          const mime = (info.mime || '').toLowerCase();
          if (!mime.startsWith('image/') || mime.includes('svg')) continue;
          const candidateUrl = info.thumburl || info.url;
          if (!candidateUrl) continue;
          const verified = await verifyExternalImageUrl(candidateUrl);
          if (verified) {
            const descUrl =
              info.descriptionurl && parseAndValidateExternalUrl(info.descriptionurl).ok
                ? info.descriptionurl
                : verified;
            citations.push({
              title: sanitizeText(page.title?.replace(/^File:/i, '') || 'Wikimedia Commons Photo', 90),
              url: descUrl,
            });
            sourcesChecked.push({
              source: 'Wikimedia Commons',
              status: 'matched',
              detail: sanitizeText(page.title?.replace(/^File:/i, '') || 'Product photo found', 80),
            });
            proposals.push({
              field: 'image_url',
              currentValue: item.image_url,
              proposedValue: toProxiedImageUrl(verified),
              source: 'Wikimedia Commons (Live Photo)',
              sourceUrl: descUrl,
              confidence: 'medium',
            });
            foundImage = true;
            break;
          }
        }
      }

      if (!foundImage && ddgInfo?.imageUrl) {
        const verifiedDdg = await verifyExternalImageUrl(ddgInfo.imageUrl);
        if (verifiedDdg) {
          sourcesChecked.push({
            source: 'DuckDuckGo Brand Media',
            status: 'matched',
            detail: ddgInfo.heading || 'Verified brand/product image',
          });
          proposals.push({
            field: 'image_url',
            currentValue: item.image_url,
            proposedValue: toProxiedImageUrl(verifiedDdg),
            source: 'DuckDuckGo Reference Image',
            sourceUrl: ddgInfo.abstractUrl || verifiedDdg,
            confidence: 'medium',
          });
          foundImage = true;
        }
      }

      if (!foundImage) {
        sourcesChecked.push({
          source: 'Wikimedia Commons',
          status: 'no_match',
          detail: 'No public photo matched automatically. Try a shorter search term or paste an image URL.',
        });
      }
    }
  }

  return { proposals, sourcesChecked, citations, marketReferences };
}

/**
 * 3. Live Online Vendor & Market Price Reference Lookup (UPCitemdb Offers + Gemini Google Search)
 * Non-negotiable: NEVER fabricates wholesale cost from retail price.
 */
export async function lookupVendorPriceOnline(
  item: OnlineEnrichInput['item'],
  customQuery?: string
): Promise<PartialEnrichOutput> {
  const proposals: EnrichProposal[] = [];
  const sourcesChecked: EnrichSourceStatus[] = [];
  const citations: EnrichCitation[] = [];
  const marketReferences: EnrichMarketReference[] = [];
  let notice: string | undefined;

  const searchSubject = sanitizeText(
    customQuery || `${item.normalized_name} ${item.upc ? `UPC ${item.upc}` : ''}`,
    160
  );

  // Pull live retail offers from UPCitemdb when UPC is present
  const upc = sanitizeUpc(item.upc);
  if (upc.length >= 8) {
    const upcDbUrl = `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(upc)}`;
    const upcDbRes = await fetchJsonWithTimeout<UpcItemDbResponse>(upcDbUrl, 5500);
    if (upcDbRes?.code === 'EXCEED_LIMIT') {
      sourcesChecked.push({
        source: 'UPCitemdb Retail Listings',
        status: 'unavailable',
        detail: 'Public trial rate limit reached temporarily.',
      });
    } else {
      const offers = upcDbRes?.items?.[0]?.offers ?? [];
      for (const offer of offers.slice(0, 4)) {
        if (typeof offer.price === 'number' && offer.price > 0) {
          const validLink = offer.link ? parseAndValidateExternalUrl(offer.link) : null;
          marketReferences.push({
            retailer: sanitizeText(offer.merchant || offer.domain || 'Online Retailer', 60),
            price: Math.round(offer.price * 100) / 100,
            url: validLink?.ok ? validLink.url.toString() : undefined,
            note: 'Live UPC retail listing (benchmark only)',
          });
        }
      }
      if (offers.length > 0) {
        sourcesChecked.push({
          source: 'UPCitemdb Retail Listings',
          status: 'matched',
          detail: `Found ${offers.length} online retail price listing(s)`,
        });
      }
    }
  }

  const ai = getGeminiClient();
  if (!ai) {
    sourcesChecked.push({
      source: 'Gemini Web Price & Vendor Search',
      status: 'unavailable',
      detail: 'GEMINI_API_KEY is not configured on the server.',
    });
    return {
      proposals,
      sourcesChecked,
      citations,
      marketReferences,
      notice:
        'Live Gemini distributor search requires GEMINI_API_KEY in Settings > Secrets. Wholesale costs are never invented or estimated.',
    };
  }

  try {
    const prompt = `You are researching a retail liquor/grocery item for 777 Liquor Grocery & Gift Shop in Honolulu, Hawaii.
Item: "${searchSubject}"
Current category: "${item.category}", Brand: "${item.brand}", Size: "${item.unit_size || 'unknown'}", UPC: "${upc || 'unknown'}".

Use Google Search to check:
1. Who distributes this brand in Hawaii (e.g. Paradise Beverages, Southern Glazer's HI, Johnson Brothers HI, RNDC Hawaii, Anheuser-Busch Sales of Hawaii, Hawaiian Isles Distributors, Direct Local)? Only populate "hawaii_distributor" if grounded in search results; otherwise null.
2. Publicly published retail market prices in Hawaii or US stores (Total Wine, Tamura's, Foodland, Safeway, Target, BevMo) for this exact size/pack. List up to 4 in "market_prices".
3. NEVER invent or guess a wholesale cost. Only populate "verified_wholesale_cost" if an actual distributor wholesale price sheet for this exact UPC/size is explicitly found online; otherwise return null.

Return ONLY valid JSON:
{
  "hawaii_distributor": string | null,
  "distributor_source": string | null,
  "verified_wholesale_cost": number | null,
  "wholesale_source": string | null,
  "market_prices": [
    { "retailer": string, "price": number, "note": string }
  ]
}`;

    const resp = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    const webCitations = extractGroundingCitations(resp);
    citations.push(...webCitations);
    const parsed = extractJsonObject(resp.text ?? '');

    if (parsed) {
      const dist = typeof parsed.hawaii_distributor === 'string' ? sanitizeText(parsed.hawaii_distributor, 80) : '';
      if (dist && dist.toLowerCase() !== 'null' && dist !== item.vendor) {
        proposals.push({
          field: 'vendor',
          currentValue: item.vendor,
          proposedValue: dist,
          source: sanitizeText(parsed.distributor_source || 'Gemini Web Search (Hawaii Distributor)', 100),
          sourceUrl: webCitations[0]?.url,
          confidence: webCitations.length > 0 ? 'medium' : 'low',
        });
      }

      if (
        typeof parsed.verified_wholesale_cost === 'number' &&
        Number.isFinite(parsed.verified_wholesale_cost) &&
        parsed.verified_wholesale_cost > 0 &&
        parsed.verified_wholesale_cost < 5000 &&
        item.cost === null
      ) {
        proposals.push({
          field: 'cost',
          currentValue: item.cost,
          proposedValue: Math.round(parsed.verified_wholesale_cost * 100) / 100,
          source: sanitizeText(parsed.wholesale_source || 'Verified Online Wholesale Listing', 100),
          sourceUrl: webCitations[0]?.url,
          confidence: 'medium',
          note: 'Verify against your latest Honolulu distributor invoice before saving.',
        });
      }

      if (Array.isArray(parsed.market_prices)) {
        for (const mp of parsed.market_prices.slice(0, 4)) {
          const entry = mp as { retailer?: unknown; price?: unknown; note?: unknown };
          if (typeof entry.price === 'number' && Number.isFinite(entry.price) && entry.price > 0) {
            marketReferences.push({
              retailer: sanitizeText(entry.retailer || 'Online Retailer', 60),
              price: Math.round(entry.price * 100) / 100,
              url: webCitations[0]?.url,
              note: sanitizeText(entry.note || 'Public retail benchmark (not wholesale cost)', 90),
            });
          }
        }
      }

      sourcesChecked.push({
        source: 'Gemini Web Price & Vendor Search',
        status: proposals.length > 0 || marketReferences.length > 0 ? 'matched' : 'no_match',
        detail:
          marketReferences.length > 0
            ? `Found ${marketReferences.length} live market price reference${marketReferences.length === 1 ? '' : 's'}`
            : 'Checked live web listings — no public wholesale sheet found',
      });
    } else {
      sourcesChecked.push({
        source: 'Gemini Web Price & Vendor Search',
        status: 'no_match',
        detail: 'Search completed with no structured pricing match.',
      });
    }
  } catch (err) {
    const formatted = formatGeminiError(err);
    notice = formatted.notice;
    sourcesChecked.push({
      source: 'Gemini Web Price & Vendor Search',
      status: 'unavailable',
      detail: formatted.detail,
    });
  }

  return { proposals, sourcesChecked, citations, marketReferences, notice };
}

/**
 * 4. Live Gemini Product Context, Pack Size, Category & Capitalization Normalization
 */
export async function lookupGeminiContextOnline(
  item: OnlineEnrichInput['item'],
  customQuery?: string
): Promise<PartialEnrichOutput> {
  const proposals: EnrichProposal[] = [];
  const sourcesChecked: EnrichSourceStatus[] = [];
  const citations: EnrichCitation[] = [];
  const marketReferences: EnrichMarketReference[] = [];
  let notice: string | undefined;

  // Always check deterministic store rules (Title Case + 11oz / 1 L + pack/size parsing from item name)
  const rawSourceName = customQuery || item.name || item.normalized_name;
  const ruleNormalized = normalizeItemName(rawSourceName);
  if (ruleNormalized && ruleNormalized !== item.normalized_name) {
    proposals.push({
      field: 'normalized_name',
      currentValue: item.normalized_name,
      proposedValue: ruleNormalized,
      source: 'Store Capitalization Rule (Title Case · 11oz / 1 L)',
      confidence: 'high',
    });
  }

  const parsedSize = extractSizeToken(rawSourceName);
  if (parsedSize && !item.unit_size) {
    proposals.push({
      field: 'unit_size',
      currentValue: item.unit_size || null,
      proposedValue: parsedSize,
      source: 'Store Unit Size Rule',
      confidence: 'high',
    });
  }

  const parsedPack = extractPackCount(rawSourceName);
  const isSingleContainer =
    parsedPack === null &&
    /\b(can|bottle|btl|single|box|bag|pouch|500\s*mL|750\s*mL|1\s*L|1\.75\s*L|22\s*oz|24\s*oz|16\s*oz)\b/i.test(
      rawSourceName
    );
  const effectivePackQty = parsedPack ?? (isSingleContainer ? 1 : null);

  if (effectivePackQty !== null && item.sell_pack_qty === null) {
    proposals.push({
      field: 'sell_pack_qty',
      currentValue: null,
      proposedValue: effectivePackQty,
      source: parsedPack
        ? 'Store Pack Count Parser'
        : 'Store Single-Unit Container Rule',
      confidence: parsedPack ? 'high' : 'medium',
    });
  }

  if (item.packs_per_case === null) {
    const packForCase = item.sell_pack_qty ?? effectivePackQty;
    let standardCasePacks: number | null = null;
    if (packForCase === 12) standardCasePacks = 2;
    else if (packForCase === 6 || packForCase === 8) standardCasePacks = 4;
    else if (packForCase === 4) standardCasePacks = 6;
    else if (packForCase === 1) {
      if (/\b(22\s*oz|24\s*oz|25\s*oz|750\s*mL|1\s*L|box)\b/i.test(rawSourceName)) {
        standardCasePacks = 12;
      } else if (/\b(1\.75\s*L)\b/i.test(rawSourceName)) {
        standardCasePacks = 6;
      } else if (/\b(11\.5\s*oz|12\s*oz|16\s*oz|500\s*mL)\b/i.test(rawSourceName)) {
        standardCasePacks = 24;
      }
    }

    if (standardCasePacks !== null) {
      proposals.push({
        field: 'packs_per_case',
        currentValue: null,
        proposedValue: standardCasePacks,
        source: 'Standard Beverage Case Config (Verify vs. Invoice)',
        confidence: 'medium',
      });
    }
  }

  const ai = getGeminiClient();
  if (!ai) {
    sourcesChecked.push({
      source: 'Gemini AI Context (Google Search)',
      status: 'unavailable',
      detail: 'GEMINI_API_KEY is not configured on the server.',
    });
    return {
      proposals,
      sourcesChecked,
      citations,
      marketReferences,
      notice: 'Gemini AI context requires GEMINI_API_KEY in Settings > Secrets.',
    };
  }

  const subject = sanitizeText(rawSourceName, 160);
  try {
    const prompt = `You are enriching a retail inventory record for 777 Liquor Grocery & Gift Shop (Honolulu, HI).
Analyze this product using Google Search when needed:
- Raw name: "${subject}"
- Current normalized name: "${item.normalized_name}"
- Current brand: "${item.brand || ''}"
- Current category: "${item.category || ''}"
- Current subcategory: "${item.subcategory || ''}"
- Current UPC: "${item.upc || ''}"
- Current unit_size: "${item.unit_size || ''}"
- Current sell_pack_qty: ${item.sell_pack_qty ?? 'null'}
- Current packs_per_case: ${item.packs_per_case ?? 'null'}

Return ONLY valid JSON with verified retail attributes (use null if unsure — never guess):
{
  "normalized_name": string | null,
  "brand": string | null,
  "category": "Beer" | "Wine" | "Spirits" | "RTD" | "Non-Alcoholic" | "Grocery" | "Gift" | null,
  "subcategory": string | null,
  "unit_size": string | null,
  "sell_pack_qty": number | null,
  "packs_per_case": number | null,
  "hi5_eligible": "Yes" | "No" | "Confirm" | null,
  "upc": string | null
}

Formatting rules:
- normalized_name must be Title Case with compact oz (e.g. "11oz", "12oz", "750mL") and spaced liter ("1 L", "1.75 L").
- Hawaii HI-5 ($0.06/container): "Yes" for Beer, malt RTDs, Non-Alcoholic beverages; "No" for Spirits, Wine, Grocery, Gift; "Confirm" for spirit-based canned cocktails/ambiguous RTDs.`;

    const resp = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    const webCitations = extractGroundingCitations(resp);
    citations.push(...webCitations);
    const parsed = extractJsonObject(resp.text ?? '');

    if (!parsed) {
      sourcesChecked.push({
        source: 'Gemini AI Context (Google Search)',
        status: 'no_match',
        detail: 'No structured attribute changes extracted.',
      });
      return { proposals, sourcesChecked, citations, marketReferences };
    }

    const primaryUrl = webCitations[0]?.url;

    if (typeof parsed.normalized_name === 'string' && parsed.normalized_name.trim()) {
      const cleaned = normalizeItemName(parsed.normalized_name.trim());
      if (cleaned && cleaned !== item.normalized_name) {
        const idx = proposals.findIndex((p) => p.field === 'normalized_name');
        const nextProp: EnrichProposal = {
          field: 'normalized_name',
          currentValue: item.normalized_name,
          proposedValue: cleaned,
          source: 'Gemini Context + Store Title Case Rule',
          sourceUrl: primaryUrl,
          confidence: 'high',
        };
        if (idx >= 0) proposals[idx] = nextProp;
        else proposals.push(nextProp);
      }
    }

    if (typeof parsed.brand === 'string' && parsed.brand.trim()) {
      const cleanedBrand = sanitizeText(parsed.brand, 80);
      if (cleanedBrand && cleanedBrand.toLowerCase() !== item.brand.toLowerCase()) {
        proposals.push({
          field: 'brand',
          currentValue: item.brand,
          proposedValue: cleanedBrand,
          source: 'Gemini Web Context',
          sourceUrl: primaryUrl,
          confidence: 'high',
        });
      }
    }

    const allowedCategories = new Set([
      'Beer',
      'Wine',
      'Spirits',
      'RTD',
      'Non-Alcoholic',
      'Grocery',
      'Gift',
    ]);
    if (typeof parsed.category === 'string' && allowedCategories.has(parsed.category) && parsed.category !== item.category) {
      proposals.push({
        field: 'category',
        currentValue: item.category,
        proposedValue: parsed.category,
        source: 'Gemini Web Context',
        sourceUrl: primaryUrl,
        confidence: 'high',
      });
    }

    if (typeof parsed.subcategory === 'string' && parsed.subcategory.trim()) {
      const cleanSub = sanitizeText(parsed.subcategory, 60);
      if (cleanSub && cleanSub.toLowerCase() !== item.subcategory.toLowerCase()) {
        proposals.push({
          field: 'subcategory',
          currentValue: item.subcategory || null,
          proposedValue: cleanSub,
          source: 'Gemini Web Context',
          sourceUrl: primaryUrl,
          confidence: 'medium',
        });
      }
    }

    if (typeof parsed.unit_size === 'string' && parsed.unit_size.trim()) {
      const cleanSize = extractSizeToken(parsed.unit_size) || sanitizeText(parsed.unit_size, 30);
      if (cleanSize && cleanSize !== item.unit_size) {
        const idx = proposals.findIndex((p) => p.field === 'unit_size');
        const nextProp: EnrichProposal = {
          field: 'unit_size',
          currentValue: item.unit_size || null,
          proposedValue: cleanSize,
          source: 'Gemini Web Context',
          sourceUrl: primaryUrl,
          confidence: 'high',
        };
        if (idx >= 0) proposals[idx] = nextProp;
        else proposals.push(nextProp);
      }
    }

    if (
      typeof parsed.sell_pack_qty === 'number' &&
      Number.isInteger(parsed.sell_pack_qty) &&
      parsed.sell_pack_qty >= 1 &&
      parsed.sell_pack_qty <= 48 &&
      parsed.sell_pack_qty !== item.sell_pack_qty
    ) {
      const idx = proposals.findIndex((p) => p.field === 'sell_pack_qty');
      const nextProp: EnrichProposal = {
        field: 'sell_pack_qty',
        currentValue: item.sell_pack_qty,
        proposedValue: parsed.sell_pack_qty,
        source: 'Gemini Pack & Case Analysis',
        sourceUrl: primaryUrl,
        confidence: 'high',
      };
      if (idx >= 0) proposals[idx] = nextProp;
      else proposals.push(nextProp);
    }

    if (
      typeof parsed.packs_per_case === 'number' &&
      Number.isInteger(parsed.packs_per_case) &&
      parsed.packs_per_case >= 1 &&
      parsed.packs_per_case <= 48 &&
      parsed.packs_per_case !== item.packs_per_case
    ) {
      proposals.push({
        field: 'packs_per_case',
        currentValue: item.packs_per_case,
        proposedValue: parsed.packs_per_case,
        source: 'Gemini Standard Case Config',
        sourceUrl: primaryUrl,
        confidence: 'medium',
      });
    }

    const hi5Candidate =
      parsed.hi5_eligible === 'Yes' || parsed.hi5_eligible === 'No' || parsed.hi5_eligible === 'Confirm'
        ? (parsed.hi5_eligible as Hi5Status)
        : determineHi5Eligibility(
            (typeof parsed.category === 'string' ? parsed.category : item.category) || item.category,
            (typeof parsed.subcategory === 'string' ? parsed.subcategory : item.subcategory) || item.subcategory,
            item.normalized_name
          );
    if (hi5Candidate && hi5Candidate !== item.hi5_eligible) {
      proposals.push({
        field: 'hi5_eligible',
        currentValue: item.hi5_eligible,
        proposedValue: hi5Candidate,
        source: 'Hawaii HI-5 Rule + Gemini Classification',
        sourceUrl: primaryUrl,
        confidence: 'high',
      });
    }

    if (!item.upc && typeof parsed.upc === 'string') {
      const cleanUpc = sanitizeUpc(parsed.upc);
      if (cleanUpc.length === 12 || cleanUpc.length === 13) {
        proposals.push({
          field: 'upc',
          currentValue: item.upc || null,
          proposedValue: cleanUpc,
          source: 'Gemini Web UPC Verification',
          sourceUrl: primaryUrl,
          confidence: 'medium',
        });
      }
    }

    sourcesChecked.push({
      source: 'Gemini AI Context (Google Search)',
      status: proposals.length > 0 ? 'matched' : 'no_match',
      detail:
        webCitations.length > 0
          ? `Grounded across ${webCitations.length} live web source${webCitations.length === 1 ? '' : 's'}`
          : 'Analyzed product metadata',
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    notice = formatted.notice;
    sourcesChecked.push({
      source: 'Gemini AI Context (Google Search)',
      status: 'unavailable',
      detail: formatted.detail,
    });
  }

  return { proposals, sourcesChecked, citations, marketReferences, notice };
}

/**
 * Orchestrates multiple live online enrichment tasks in parallel and merges results cleanly.
 */
export async function runOnlineEnrichment(input: OnlineEnrichInput): Promise<EnrichResponse> {
  const taskSet = new Set(input.tasks);
  const runners: Array<Promise<PartialEnrichOutput>> = [];

  if (taskSet.has('upc_lookup')) {
    runners.push(lookupUpcOnline(input.item, input.customQuery));
  }
  if (taskSet.has('logo') || taskSet.has('image')) {
    runners.push(
      lookupMediaOnline(input.item, {
        findLogo: taskSet.has('logo'),
        findImage: taskSet.has('image'),
        customQuery: input.customQuery,
        brandWebsite: input.brandWebsite,
      })
    );
  }
  if (taskSet.has('vendor_cost')) {
    runners.push(lookupVendorPriceOnline(input.item, input.customQuery));
  }
  if (taskSet.has('gemini_context')) {
    runners.push(lookupGeminiContextOnline(input.item, input.customQuery));
  }

  const settled = await Promise.allSettled(runners);
  const proposalMap = new Map<string, EnrichProposal>();
  const sourcesChecked: EnrichSourceStatus[] = [];
  const citationMap = new Map<string, EnrichCitation>();
  const marketReferences: EnrichMarketReference[] = [];
  const notices: string[] = [];

  const confidenceRank: Record<EnrichProposal['confidence'], number> = {
    high: 3,
    medium: 2,
    low: 1,
  };

  for (const outcome of settled) {
    if (outcome.status !== 'fulfilled') continue;
    const part = outcome.value;
    sourcesChecked.push(...part.sourcesChecked);
    if (part.notice) notices.push(part.notice);

    for (const cit of part.citations) {
      if (!citationMap.has(cit.url)) {
        citationMap.set(cit.url, cit);
      }
    }

    for (const ref of part.marketReferences) {
      const dup = marketReferences.some(
        (existing) =>
          existing.retailer.toLowerCase() === ref.retailer.toLowerCase() &&
          existing.price === ref.price
      );
      if (!dup) marketReferences.push(ref);
    }

    for (const prop of part.proposals) {
      const existing = proposalMap.get(prop.field);
      if (!existing || confidenceRank[prop.confidence] > confidenceRank[existing.confidence]) {
        proposalMap.set(prop.field, prop);
      }
    }
  }

  return {
    clover_id: input.item.clover_id,
    proposals: Array.from(proposalMap.values()),
    sourcesChecked,
    citations: Array.from(citationMap.values()).slice(0, 8),
    marketReferences: marketReferences.slice(0, 6),
    notice: notices.length > 0 ? Array.from(new Set(notices)).join(' ') : undefined,
  };
}
