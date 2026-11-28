import {
  CanonicalItem,
  Hi5Status,
  InventoryFacets,
  InventorySummaryCounts,
  ItemFlag,
  ItemsQueryParams,
  ItemsResponse,
  SortDirection,
  SortField,
} from '../types/inventory';

const PRESERVED_ACRONYMS = new Set([
  'IPA',
  'RTD',
  'UPC',
  'SKU',
  'V.S',
  'V.S.O.P',
  'XO',
  'NA',
  'N/A',
  'HI-5',
  'ABV',
  'CBD',
  'THC',
  'USA',
  'HI',
  'NO.',
  'VS',
  'VSOP',
]);

/**
 * Normalizes inventory item names to the store's preferred Title Case and unit conventions:
 * e.g. "example of the capitalization rules that i prefer to use 11oz 1 l"
 *   -> "Example Of The Capitalization Rules That I Prefer To Use 11oz 1 L"
 */
export function normalizeItemName(raw: string): string {
  const collapsed = raw.trim().replace(/\s+/g, ' ');
  if (!collapsed) return '';

  // Normalize unit spacing first so units are parsed consistently:
  // - oz: "11 oz" / "11OZ" -> "11oz"
  // - mL: "750 ml" / "750ML" -> "750mL"
  // - L:  "1l" / "1.75 l" / "1 liter" -> "1 L" / "1.75 L"
  // - pk: "6 pk" / "12 pack" -> "6pk" / "12pk"
  const preNormalized = collapsed
    .replace(/\b(\d+(?:\.\d+)?)\s*oz\b/gi, '$1oz')
    .replace(/\b(\d+(?:\.\d+)?)\s*ml\b/gi, '$1mL')
    .replace(/\b(\d+(?:\.\d+)?)\s*(?:liters?|ltr|l)\b/gi, '$1 L')
    .replace(/\b(\d+)\s*(?:packs?|pk)\b/gi, '$1pk');

  const tokens = preNormalized.split(' ');
  const normalizedTokens = tokens.map((token, idx) => {
    if (!token) return token;

    // Keep normalized measurement tokens exact
    if (/^\d+(?:\.\d+)?oz$/.test(token)) return token;
    if (/^\d+(?:\.\d+)?mL$/.test(token)) return token;
    if (/^\d+pk$/.test(token)) return token;
    if (token === 'L' && idx > 0 && /^\d+(?:\.\d+)?$/.test(tokens[idx - 1])) {
      return 'L';
    }
    if (/^\d+(?:\.\d+)?$/.test(token)) return token;

    const upper = token.toUpperCase();
    if (PRESERVED_ACRONYMS.has(upper)) {
      return upper;
    }

    // Handle hyphenated words cleanly (e.g. "alcohol-free" -> "Alcohol-Free")
    return token
      .split('-')
      .map((segment) => {
        if (!segment) return segment;
        const segUpper = segment.toUpperCase();
        if (PRESERVED_ACRONYMS.has(segUpper)) return segUpper;

        // Preserve apostrophe casing like "Tito's" or "Young's"
        const lower = segment.toLowerCase();
        return lower.charAt(0).toUpperCase() + lower.slice(1);
      })
      .join('-');
  });

  return normalizedTokens.join(' ');
}

/**
 * Hawaii HI-5 deposit ($0.06/container) rules:
 * - Applies to Beer, Non-Alcohol Beverages, and malt-based RTDs ("Yes")
 * - Spirits and Wine are exempt ("No")
 * - Ambiguous RTDs / spirit-based canned cocktails / mixers require verification ("Confirm")
 */
export function determineHi5Eligibility(
  category: string,
  subcategory: string,
  name: string
): Hi5Status {
  const cat = category.trim().toLowerCase();
  const sub = subcategory.trim().toLowerCase();
  const title = name.trim().toLowerCase();

  if (cat === 'spirits' || cat === 'wine' || cat === 'grocery' || cat === 'gift') {
    return 'No';
  }

  if (
    cat === 'rtd' ||
    sub.includes('canned cocktail') ||
    sub.includes('spirit-based') ||
    title.includes('high noon') ||
    title.includes('cutwater') ||
    title.includes('surfside')
  ) {
    return 'Confirm';
  }

  if (
    cat === 'beer' ||
    cat === 'non-alcoholic' ||
    cat === 'beverages' ||
    sub.includes('lager') ||
    sub.includes('ipa') ||
    sub.includes('ale') ||
    sub.includes('seltzer') ||
    sub.includes('juice') ||
    sub.includes('tea') ||
    sub.includes('soda')
  ) {
    return 'Yes';
  }

  return 'Confirm';
}

/**
 * Recomputes deterministic operational flags from the item's canonical fields.
 * Preserves manual REVIEW flag unless explicitly cleared.
 */
export function recomputeItemFlags(
  item: CanonicalItem,
  options?: { preserveReview?: boolean }
): ItemFlag[] {
  const preserveReview = options?.preserveReview ?? true;
  const nextFlags = new Set<ItemFlag>();

  if (item.cost === null || item.cost <= 0) {
    nextFlags.add('NO_COST');
  }

  if (
    item.sell_pack_qty === null ||
    item.sell_pack_qty <= 0 ||
    item.packs_per_case === null ||
    item.packs_per_case <= 0
  ) {
    nextFlags.add('NEED_PACK_CONFIG');
  }

  if (item.suggested_price !== null && item.suggested_price < item.price) {
    nextFlags.add('PRICE_DROP');
  }

  if (item.hi5_eligible === 'Confirm') {
    nextFlags.add('HI5_CONFIRM');
  }

  if (preserveReview && item.flags.includes('REVIEW')) {
    nextFlags.add('REVIEW');
  }

  return Array.from(nextFlags);
}

/**
 * Returns gross margin percentage (0-100), or null if cost is missing/invalid.
 * Never invents a margin when cost is missing.
 */
export function calculateMarginPercent(
  price: number,
  cost: number | null
): number | null {
  if (cost === null || cost <= 0 || price <= 0) {
    return null;
  }
  return Math.round(((price - cost) / price) * 1000) / 10;
}

/**
 * Deterministic 2-letter initials fallback when logo_url is null or fails to load.
 */
export function getBrandInitials(brand: string, fallbackName: string): string {
  const source = (brand || fallbackName || '77').trim();
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

export function validateNumericPatch(
  field: 'price' | 'cost' | 'quantity',
  rawValue: string
): { valid: true; value: number | null } | { valid: false; error: string } {
  const trimmed = rawValue.trim();

  if (trimmed === '') {
    if (field === 'cost') {
      return { valid: true, value: null };
    }
    return {
      valid: false,
      error: field === 'price' ? 'Price is required.' : 'Quantity is required.',
    };
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return { valid: false, error: 'Enter a valid number.' };
  }

  if (field === 'quantity') {
    if (!Number.isInteger(parsed) || parsed < 0) {
      return { valid: false, error: 'Quantity must be a whole number 0 or higher.' };
    }
    return { valid: true, value: parsed };
  }

  if (field === 'price' && parsed <= 0) {
    return { valid: false, error: 'Price must be greater than $0.00.' };
  }

  if (field === 'cost' && parsed < 0) {
    return { valid: false, error: 'Cost cannot be negative.' };
  }

  return { valid: true, value: Math.round(parsed * 100) / 100 };
}

export function computeFacetsAndSummary(allItems: CanonicalItem[]): {
  facets: InventoryFacets;
  summary: InventorySummaryCounts;
} {
  const categories = Array.from(new Set(allItems.map((i) => i.category).filter(Boolean))).sort();
  const vendors = Array.from(
    new Set(allItems.map((i) => i.vendor).filter((v): v is string => Boolean(v)))
  ).sort();
  const brands = Array.from(new Set(allItems.map((i) => i.brand).filter(Boolean))).sort();

  const summary: InventorySummaryCounts = {
    totalItems: allItems.length,
    missingCostCount: allItems.filter((i) => i.cost === null).length,
    flaggedCount: allItems.filter((i) => i.flags.length > 0).length,
    hi5ConfirmCount: allItems.filter((i) => i.hi5_eligible === 'Confirm').length,
    missingLogoCount: allItems.filter((i) => !i.logo_url).length,
  };

  return {
    facets: { categories, vendors, brands },
    summary,
  };
}

export function filterAndSortItems(
  allItems: CanonicalItem[],
  query: ItemsQueryParams
): ItemsResponse {
  const { facets, summary } = computeFacetsAndSummary(allItems);

  const searchLower = (query.search ?? '').trim().toLowerCase();
  const filtered = allItems.filter((item) => {
    if (searchLower) {
      const haystack = [
        item.name,
        item.normalized_name,
        item.brand,
        item.upc,
        item.clover_id,
        item.vendor ?? '',
        item.category,
        item.subcategory,
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(searchLower)) return false;
    }

    if (query.category && item.category !== query.category) return false;
    if (query.vendor) {
      if (query.vendor === '__MISSING__') {
        if (item.vendor !== null && item.vendor !== '') return false;
      } else if (item.vendor !== query.vendor) {
        return false;
      }
    }
    if (query.brand && item.brand !== query.brand) return false;

    if (query.hasCost === 'yes' && item.cost === null) return false;
    if (query.hasCost === 'no' && item.cost !== null) return false;

    if (query.hasLogo === 'yes' && !item.logo_url) return false;
    if (query.hasLogo === 'no' && Boolean(item.logo_url)) return false;

    if (query.flag === 'ANY_FLAG') {
      if (item.flags.length === 0) return false;
    } else if (query.flag) {
      if (!item.flags.includes(query.flag)) return false;
    }

    return true;
  });

  const [sortField, sortDir] = (query.sort ?? 'normalized_name:asc').split(':') as [
    SortField,
    SortDirection,
  ];
  const dirMultiplier = sortDir === 'desc' ? -1 : 1;

  const sorted = [...filtered].sort((a, b) => {
    const valA = a[sortField];
    const valB = b[sortField];

    // Push nulls to the bottom regardless of sort direction
    if (valA === null && valB === null) return a.clover_id.localeCompare(b.clover_id);
    if (valA === null) return 1;
    if (valB === null) return -1;

    if (typeof valA === 'number' && typeof valB === 'number') {
      if (valA !== valB) return (valA - valB) * dirMultiplier;
      return a.normalized_name.localeCompare(b.normalized_name);
    }

    const cmp = String(valA).localeCompare(String(valB), undefined, { sensitivity: 'base' });
    if (cmp !== 0) return cmp * dirMultiplier;
    return a.clover_id.localeCompare(b.clover_id);
  });

  const pageSize = Math.max(1, query.pageSize ?? 15);
  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, query.page ?? 1), totalPages);
  const startIndex = (page - 1) * pageSize;

  return {
    items: sorted.slice(startIndex, startIndex + pageSize),
    total,
    page,
    pageSize,
    totalPages,
    facets,
    summary,
  };
}
