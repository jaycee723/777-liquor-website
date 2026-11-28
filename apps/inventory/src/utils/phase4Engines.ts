import {
  AnalyticsSummaryResponse,
  CanonicalItem,
  CoolerDoorCatalogItem,
  CoolerDoorPushResponse,
  ProductSuggestion,
  ToastExportPreflight,
  ToastExportResponse,
} from '../types/inventory';
import {
  calculateMarginPercent,
  determineHi5Eligibility,
  normalizeItemName,
  recomputeItemFlags,
} from './inventoryRules';

/**
 * Exact 26-column header order copied verbatim from core/toast_export.py
 * (777_-_Retail_Template_-_POPULATED_2026-09-17.xlsx, "Template" sheet).
 * Do not rename or reorder; Toast's importer keys off them.
 */
export const TOAST_RETAIL_COLUMNS: readonly string[] = [
  'Item Name',
  'optional (variation)',
  'pos name',
  'description',
  'category group',
  'Category',
  'subcategory',
  'Price',
  'Cost',
  'Barcode',
  'plu',
  'brand',
  'supplier',
  'supplier item id',
  'selling strategy',
  'embedded amount type',
  'unit of measure',
  'prompt for quantity',
  'inventory quantity',
  'Min Qty',
  'Max Qty',
  'receiving units',
  'receiving unit quantities',
  'image url',
  'region (Custom Attribute - Select)',
  'abv (Custom Attribute - Number)',
];

const ALCOHOL_CATEGORIES = new Set<CoolerDoorCatalogItem['category']>([
  'Beer',
  'RTD',
  'Spirits',
  'Wine',
]);

export function deriveToastCategory(item: Pick<CanonicalItem, 'category' | 'subcategory' | 'normalized_name'>): string {
  const cat = (item.category || '').trim().toLowerCase();
  const sub = (item.subcategory || '').trim().toLowerCase();
  const name = (item.normalized_name || '').trim().toLowerCase();

  if (
    cat === 'rtd' ||
    sub.includes('canned cocktail') ||
    sub.includes('seltzer') ||
    name.includes('high noon') ||
    name.includes('cutwater') ||
    name.includes('surfside')
  ) {
    return 'RTD (READY TO DRINK)';
  }
  if (cat === 'beer' || cat === 'beer & seltzers') return 'BEER';
  if (cat === 'spirits' || cat === 'liquor') return 'LIQUOR/SPIRITS';
  if (cat === 'wine') return 'WINE';
  if (cat === 'non-alcoholic' || cat === 'beverages' || cat === 'drinks & mixers') return 'DRINKS';
  if (cat === 'grocery' || cat === 'snacks & grocery') return 'GROCERY';
  if (cat === 'gift') return 'GIFT';
  return item.category ? item.category.trim().toUpperCase() : '';
}

function formatToastMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  return `$${value.toFixed(2)}`;
}

export function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function itemToToastRow(item: CanonicalItem): Record<string, string | number> {
  const packs = item.packs_per_case && item.packs_per_case > 0 ? item.packs_per_case : null;
  return {
    'Item Name': item.normalized_name || item.name || '',
    'optional (variation)': '',
    'pos name': '',
    description: '',
    'category group': 'Retail',
    Category: deriveToastCategory(item),
    subcategory: '',
    Price: formatToastMoney(item.price),
    Cost: formatToastMoney(item.cost),
    Barcode: item.upc || '',
    plu: '',
    brand: item.brand || '',
    supplier: item.vendor || '',
    'supplier item id': '',
    'selling strategy': '',
    'embedded amount type': '',
    'unit of measure': '',
    'prompt for quantity': '',
    'inventory quantity': Number.isFinite(item.quantity) ? Math.max(0, item.quantity) : 0,
    'Min Qty': 0,
    'Max Qty': 0,
    'receiving units': packs ? 'Case' : '',
    'receiving unit quantities': packs ?? '',
    'image url': item.image_url || item.logo_url || '',
    'region (Custom Attribute - Select)': '',
    'abv (Custom Attribute - Number)': '',
  };
}

export function computeToastPreflight(items: CanonicalItem[]): ToastExportPreflight {
  let missingCostCount = 0;
  let missingUpcCount = 0;
  let flaggedCount = 0;
  let readyCount = 0;

  for (const item of items) {
    const hasCost = item.cost !== null && item.cost > 0;
    const hasUpc = Boolean(item.upc && item.upc.trim().length > 0);
    const hasFlags = item.flags.length > 0;

    if (!hasCost) missingCostCount += 1;
    if (!hasUpc) missingUpcCount += 1;
    if (hasFlags) flaggedCount += 1;
    if (hasCost && hasUpc && !hasFlags && item.price > 0) {
      readyCount += 1;
    }
  }

  return {
    totalItems: items.length,
    readyCount,
    missingCostCount,
    missingUpcCount,
    flaggedCount,
  };
}

export function buildToastRetailCsvExport(
  items: CanonicalItem[],
  dateStamp = new Date().toISOString().slice(0, 10)
): ToastExportResponse {
  const headerLine = TOAST_RETAIL_COLUMNS.map(escapeCsvCell).join(',');
  const dataLines = items.map((item) => {
    const row = itemToToastRow(item);
    return TOAST_RETAIL_COLUMNS.map((col) => escapeCsvCell(row[col])).join(',');
  });

  return {
    csv: [headerLine, ...dataLines].join('\n'),
    filename: `777_Toast_Retail_Template_${dateStamp}.csv`,
    rowCount: items.length,
    columns: [...TOAST_RETAIL_COLUMNS],
    preflight: computeToastPreflight(items),
  };
}

export const FULL_SPREADSHEET_COLUMNS: readonly string[] = [
  'clover_id',
  'normalized_name',
  'name',
  'brand',
  'category',
  'subcategory',
  'upc',
  'price',
  'cost',
  'cost_source',
  'suggested_price',
  'vendor',
  'unit_size',
  'sell_pack_qty',
  'packs_per_case',
  'hi5_eligible',
  'quantity',
  'flags',
  'logo_url',
  'image_url',
];

export function buildFullInventoryCsvExport(
  items: CanonicalItem[],
  dateStamp = new Date().toISOString().slice(0, 10)
): { csv: string; filename: string; rowCount: number } {
  const headerLine = FULL_SPREADSHEET_COLUMNS.join(',');
  const lines = items.map((item) =>
    [
      item.clover_id,
      item.normalized_name,
      item.name,
      item.brand,
      item.category,
      item.subcategory,
      item.upc,
      item.price.toFixed(2),
      item.cost !== null ? item.cost.toFixed(2) : '',
      item.cost_source ?? '',
      item.suggested_price !== null ? item.suggested_price.toFixed(2) : '',
      item.vendor ?? '',
      item.unit_size,
      item.sell_pack_qty ?? '',
      item.packs_per_case ?? '',
      item.hi5_eligible,
      item.quantity,
      item.flags.join('|'),
      item.logo_url ?? '',
      item.image_url ?? '',
    ]
      .map(escapeCsvCell)
      .join(',')
  );

  return {
    csv: [headerLine, ...lines].join('\n'),
    filename: `777_Full_Inventory_Catalog_${dateStamp}.csv`,
    rowCount: items.length,
  };
}

function deriveCoolerDoorSize(item: CanonicalItem): string {
  const parts: string[] = [];
  if (item.unit_size) parts.push(item.unit_size);
  if (item.sell_pack_qty && item.sell_pack_qty > 1) {
    parts.push(`${item.sell_pack_qty}pk`);
  }
  return parts.join(' ') || item.unit_size || 'Single';
}

/**
 * Builds the alcohol-only Cooler Door website catalog (Beer, RTD, Spirits, Wine).
 * Strictly excludes Non-Alcoholic, Grocery, and Gift items per docs/API_CONTRACTS.md.
 */
export function buildCoolerDoorCatalogPayload(
  items: CanonicalItem[],
  publishedAt = new Date().toISOString()
): CoolerDoorPushResponse {
  const byCategory: Record<'Beer' | 'RTD' | 'Spirits' | 'Wine', number> = {
    Beer: 0,
    RTD: 0,
    Spirits: 0,
    Wine: 0,
  };
  const missingLogosSet = new Set<string>();
  const coolerItems: CoolerDoorCatalogItem[] = [];
  let excludedCount = 0;

  for (const item of items) {
    if (!ALCOHOL_CATEGORIES.has(item.category as CoolerDoorCatalogItem['category'])) {
      excludedCount += 1;
      continue;
    }
    const category = item.category as CoolerDoorCatalogItem['category'];
    byCategory[category] += 1;

    if (!item.logo_url) {
      missingLogosSet.add(item.brand || item.normalized_name);
    }

    coolerItems.push({
      id: item.clover_id,
      name: item.normalized_name,
      brand: item.brand,
      category,
      size: deriveCoolerDoorSize(item),
      price: item.price,
      logo: item.logo_url,
    });
  }

  coolerItems.sort((a, b) => {
    const catCmp = a.category.localeCompare(b.category);
    if (catCmp !== 0) return catCmp;
    return a.name.localeCompare(b.name);
  });

  return {
    pushed: coolerItems.length,
    publishedCount: coolerItems.length,
    publishedAt,
    by_category: byCategory,
    missing_logos: Array.from(missingLogosSet).sort(),
    excludedCount,
    catalog: {
      sourceFile: '777-inventory-app',
      generatedAt: publishedAt,
      itemCount: coolerItems.length,
      items: coolerItems,
    },
  };
}

export interface CategoryMarginSummary {
  category: string;
  skuCount: number;
  costedSkuCount: number;
  avgMarginPct: number | null;
  revenue: number;
  unitsSold: number;
}

/**
 * Computes per-category gross margin and sales rollups strictly from real costs and sales.
 * Never fabricates margins when item costs are null.
 */
export function buildCategoryMarginBreakdown(
  items: CanonicalItem[],
  analytics: AnalyticsSummaryResponse
): CategoryMarginSummary[] {
  const itemById = new Map(items.map((i) => [i.clover_id, i]));
  const buckets = new Map<
    string,
    {
      skuCount: number;
      costedSkuCount: number;
      marginSum: number;
      revenue: number;
      unitsSold: number;
    }
  >();

  const ensureBucket = (category: string) => {
    const key = category || 'Uncategorized';
    let b = buckets.get(key);
    if (!b) {
      b = { skuCount: 0, costedSkuCount: 0, marginSum: 0, revenue: 0, unitsSold: 0 };
      buckets.set(key, b);
    }
    return b;
  };

  for (const item of items) {
    const b = ensureBucket(item.category);
    b.skuCount += 1;
    const margin = calculateMarginPercent(item.price, item.cost);
    if (margin !== null) {
      b.costedSkuCount += 1;
      b.marginSum += margin;
    }
  }

  for (const seller of analytics.top_sellers) {
    const matched = itemById.get(seller.clover_id);
    const b = ensureBucket(matched?.category ?? 'Uncategorized');
    b.revenue += seller.revenue;
    b.unitsSold += seller.units_sold;
  }

  return Array.from(buckets.entries())
    .map(([category, b]) => ({
      category,
      skuCount: b.skuCount,
      costedSkuCount: b.costedSkuCount,
      avgMarginPct:
        b.costedSkuCount > 0 ? Math.round((b.marginSum / b.costedSkuCount) * 10) / 10 : null,
      revenue: Math.round(b.revenue * 100) / 100,
      unitsSold: b.unitsSold,
    }))
    .sort((a, b) => {
      if (b.revenue !== a.revenue) return b.revenue - a.revenue;
      return b.skuCount - a.skuCount;
    });
}

/**
 * Converts a Honolulu product suggestion into a canonical draft inventory item
 * normalized with store Title Case (11oz / 1 L), HI-5 compliance, and REVIEW flag.
 */
export function buildDraftItemFromSuggestion(
  suggestion: ProductSuggestion,
  existingIds: ReadonlySet<string>
): CanonicalItem {
  let suffix = 1;
  let candidateId = `DRAFT-${suggestion.id.toUpperCase().replace(/[^A-Z0-9]/g, '')}`;
  while (existingIds.has(candidateId)) {
    suffix += 1;
    candidateId = `DRAFT-${suggestion.id.toUpperCase().replace(/[^A-Z0-9]/g, '')}-${suffix}`;
  }

  const normalizedName = normalizeItemName(suggestion.name);
  const subcategory = suggestion.subcategory ?? suggestion.category;
  const hi5 = determineHi5Eligibility(suggestion.category, subcategory, normalizedName);

  const draft: CanonicalItem = {
    clover_id: candidateId,
    name: normalizedName,
    normalized_name: normalizedName,
    brand: suggestion.brand,
    category: suggestion.category,
    subcategory,
    upc: suggestion.upc ?? '',
    price: Math.round(suggestion.estimated_retail * 100) / 100,
    cost: Math.round(suggestion.estimated_cost * 100) / 100,
    cost_source: `Vendor Proposal: ${suggestion.vendor}`,
    vendor: suggestion.vendor,
    unit_size: suggestion.unit_size,
    sell_pack_qty: suggestion.sell_pack_qty,
    packs_per_case: suggestion.packs_per_case,
    hi5_eligible: hi5,
    logo_url: null,
    image_url: null,
    quantity: 0,
    flags: ['REVIEW'],
    suggested_price: null,
  };

  draft.flags = recomputeItemFlags(draft, { preserveReview: true });
  return draft;
}
