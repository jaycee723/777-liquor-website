import {
  AnalyticsSummaryResponse,
  AuthUser,
  BulkPatchPayload,
  CanonicalItem,
  CoolerDoorPushResponse,
  EnrichProposal,
  EnrichRequest,
  EnrichResponse,
  ImportRequest,
  ImportResponse,
  InvoiceOcrResponse,
  ItemsQueryParams,
  ItemsResponse,
  PatchItemPayload,
  PricingApplyRequest,
  PricingApplyResponse,
  PricingSuggestionsResponse,
  ProductSuggestion,
  ToastExportResponse,
} from '../types/inventory';
import {
  calculateMarginPercent,
  filterAndSortItems,
  normalizeItemName,
  recomputeItemFlags,
} from '../utils/inventoryRules';
import {
  autoDetectSalesColumnMap,
  buildSalesImportPreview,
  parseDelimitedText,
  reconcileInvoiceLines,
} from '../utils/importEngine';
import { buildPricingSuggestionRows } from '../utils/enrichmentPricingRules';
import {
  buildCoolerDoorCatalogPayload,
  buildDraftItemFromSuggestion,
  buildFullInventoryCsvExport,
  buildToastRetailCsvExport,
} from '../utils/phase4Engines';
import { ApiError } from '../services/apiError';
import { SEED_INVENTORY_ITEMS } from './mockData';
import {
  SAMPLE_CLOVER_SALES_CSV,
  SAMPLE_INVOICE_OCR_TEMPLATES,
} from './mockImportSamples';

const STORAGE_KEY = '777_inventory_mock_items_v1';
const SALES_STORAGE_KEY = '777_inventory_mock_sales_v1';
const PREVIEW_TOKEN_STORAGE_KEY = '777_inventory_mock_pricing_token_v1';
const COOLER_DOOR_STORAGE_KEY = '777_inventory_mock_cooler_door_v1';

const HAWAII_PRODUCT_SUGGESTIONS: ProductSuggestion[] = [
  {
    id: 'hi-sug-01',
    name: 'Surfside Iced Tea Vodka 12oz 8pk',
    brand: 'Surfside',
    category: 'RTD',
    subcategory: 'Spirit-Based Canned Cocktail',
    vendor: 'RNDC Hawaii',
    unit_size: '12oz',
    sell_pack_qty: 8,
    packs_per_case: 3,
    estimated_cost: 15.4,
    estimated_retail: 22.99,
    expected_margin_pct: 33.0,
    hawaii_trend_note: 'Fastest-turning non-carbonated vodka tea 8pk near UH Manoa and Moiliili.',
    upc: '085003491008',
  },
  {
    id: 'hi-sug-02',
    name: 'Ola Brew Maui Gold Cider 12oz 6pk',
    brand: 'Ola Brew',
    category: 'Beer',
    subcategory: 'Hard Cider',
    vendor: 'Paradise Beverages',
    unit_size: '12oz',
    sell_pack_qty: 6,
    packs_per_case: 4,
    estimated_cost: 10.65,
    estimated_retail: 15.99,
    expected_margin_pct: 33.4,
    hawaii_trend_note: 'Big Island employee-owned cider with strong repeat pull among local craft buyers.',
    upc: '085001122406',
  },
  {
    id: 'hi-sug-03',
    name: 'KoHana Kea Hawaiian Agricole White Rum 750mL',
    brand: 'KoHana',
    category: 'Spirits',
    subcategory: 'Hawaiian Rum',
    vendor: "Southern Glazer's HI",
    unit_size: '750mL',
    sell_pack_qty: 1,
    packs_per_case: 6,
    estimated_cost: 27.9,
    estimated_retail: 41.99,
    expected_margin_pct: 33.6,
    hawaii_trend_note: 'Kunia estate sugarcane rum favored for both local gifting and Mai Tai builds.',
    upc: '085784500501',
  },
  {
    id: 'hi-sug-04',
    name: 'Lanikai Pillbox Porter 12oz 6pk',
    brand: 'Lanikai Brewing',
    category: 'Beer',
    subcategory: 'Craft Porter',
    vendor: 'Direct Local',
    unit_size: '12oz',
    sell_pack_qty: 6,
    packs_per_case: 4,
    estimated_cost: 10.35,
    estimated_retail: 15.49,
    expected_margin_pct: 33.2,
    hawaii_trend_note: 'Oahu Kailua craft favorite; fills a dark-beer gap in the chilled 6-pack door.',
    upc: '085111000101',
  },
  {
    id: 'hi-sug-05',
    name: 'Nikka Coffey Grain Japanese Whisky 750mL',
    brand: 'Nikka',
    category: 'Spirits',
    subcategory: 'Japanese Whisky',
    vendor: "Southern Glazer's HI",
    unit_size: '750mL',
    sell_pack_qty: 1,
    packs_per_case: 6,
    estimated_cost: 54.5,
    estimated_retail: 79.99,
    expected_margin_pct: 31.9,
    hawaii_trend_note: 'High-ticket Japanese whisky step-up next to Suntory Toki with strong weekend velocity.',
    upc: '085914100405',
  },
  {
    id: 'hi-sug-06',
    name: 'Kim Crawford Sauvignon Blanc 750mL',
    brand: 'Kim Crawford',
    category: 'Wine',
    subcategory: 'White Wine',
    vendor: 'Johnson Brothers HI',
    unit_size: '750mL',
    sell_pack_qty: 1,
    packs_per_case: 12,
    estimated_cost: 11.4,
    estimated_retail: 17.99,
    expected_margin_pct: 36.6,
    hawaii_trend_note: 'Top-requested Marlborough Sauvignon Blanc for dinner-hour walk-in shoppers.',
    upc: '008210001081',
  },
  {
    id: 'hi-sug-07',
    name: 'Sun Noodle Island Saimin Crunch Mix 5oz',
    brand: 'Sun Noodle',
    category: 'Grocery',
    subcategory: 'Local Snacks',
    vendor: 'Hawaiian Isles Distributors',
    unit_size: '5oz',
    sell_pack_qty: 1,
    packs_per_case: 12,
    estimated_cost: 2.85,
    estimated_retail: 4.99,
    expected_margin_pct: 42.9,
    hawaii_trend_note: 'High-margin counter impulse snack pairing naturally with cold beer and RTDs.',
    upc: '007189000712',
  },
  {
    id: 'hi-sug-08',
    name: 'Athletic Brewing Run Wild Non-Alcoholic IPA 12oz 6pk',
    brand: 'Athletic Brewing',
    category: 'Non-Alcoholic',
    subcategory: 'NA Craft Beer',
    vendor: 'Paradise Beverages',
    unit_size: '12oz',
    sell_pack_qty: 6,
    packs_per_case: 4,
    estimated_cost: 8.6,
    estimated_retail: 12.99,
    expected_margin_pct: 33.8,
    hawaii_trend_note: 'Leading zero-proof craft IPA capturing weekday campus and designated-driver demand.',
    upc: '085000438609',
  },
];

const LOGO_KONA = '/src/assets/images/brand_kona_wave_1795751258018.jpg';
const LOGO_MAUI = '/src/assets/images/brand_maui_crest_1795751258492.jpg';
const LOGO_SPIRITS = '/src/assets/images/brand_spirits_copper_1795751259380.jpg';
const LOGO_WINE = '/src/assets/images/brand_wine_vineyard_1795751260678.jpg';

const VENDOR_COST_BOOK: Record<string, { cost: number; vendor: string; source: string }> = {
  'CLV-77704': {
    cost: 10.35,
    vendor: 'Paradise Beverages',
    source: 'Paradise Beverages Q4 Price Sheet',
  },
  'CLV-77710': {
    cost: 31.4,
    vendor: "Southern Glazer's HI",
    source: "Southern Glazer's HI Spirits Catalog",
  },
  'CLV-77720': {
    cost: 11.2,
    vendor: 'Johnson Brothers HI',
    source: 'Johnson Brothers HI Wine Price List',
  },
  'CLV-77725': {
    cost: 0.94,
    vendor: 'Hawaiian Isles Distributors',
    source: 'Hawaiian Isles Beverage Wholesale Sheet',
  },
  'CLV-77728': {
    cost: 13.2,
    vendor: 'Direct Local',
    source: 'Honolulu Cookie Co. Wholesale Sheet',
  },
};

const GEMINI_PACK_BOOK: Record<
  string,
  { sell_pack_qty: number; packs_per_case: number; unit_size?: string; vendor?: string; subcategory?: string }
> = {
  'CLV-77715': { sell_pack_qty: 1, packs_per_case: 12, unit_size: '22oz' },
  'CLV-77726': { sell_pack_qty: 1, packs_per_case: 12, unit_size: '500mL' },
  'CLV-77728': {
    sell_pack_qty: 1,
    packs_per_case: 12,
    unit_size: '16pc Box',
    vendor: 'Direct Local',
    subcategory: 'Island Gifts',
  },
};

function selectCategoryAsset(item: CanonicalItem): string {
  const cat = item.category.toLowerCase();
  const brand = item.brand.toLowerCase();
  if (brand.includes('kona') || brand.includes('aloha') || brand.includes('lanikai')) {
    return LOGO_KONA;
  }
  if (cat === 'beer' || cat === 'rtd' || cat === 'non-alcoholic') {
    return LOGO_MAUI;
  }
  if (cat === 'wine') {
    return LOGO_WINE;
  }
  return LOGO_SPIRITS;
}

function loadItems(): CanonicalItem[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(SEED_INVENTORY_ITEMS);
    const parsed = JSON.parse(raw) as CanonicalItem[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return structuredClone(SEED_INVENTORY_ITEMS);
    }
    return parsed;
  } catch {
    return structuredClone(SEED_INVENTORY_ITEMS);
  }
}

function saveItems(items: CanonicalItem[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Ignore storage quota errors in private contexts
  }
}

let memoryToken = 'prv_777_init';

function getStoredPreviewToken(): string {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(PREVIEW_TOKEN_STORAGE_KEY) || memoryToken;
    }
  } catch {
    // ignore
  }
  return memoryToken;
}

function rotatePreviewToken(): string {
  const next = `prv_777_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  memoryToken = next;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(PREVIEW_TOKEN_STORAGE_KEY, next);
    }
  } catch {
    // ignore
  }
  return next;
}

const EMPTY_ANALYTICS: AnalyticsSummaryResponse = {
  sales_source: 'none',
  last_synced_at: null,
  source_filename: null,
  total_revenue: 0,
  units_sold: 0,
  gross_margin_pct: null,
  top_sellers: [],
  dead_stock: [],
};

function loadAnalytics(): AnalyticsSummaryResponse {
  try {
    const raw = window.localStorage.getItem(SALES_STORAGE_KEY);
    if (!raw) return structuredClone(EMPTY_ANALYTICS);
    return JSON.parse(raw) as AnalyticsSummaryResponse;
  } catch {
    return structuredClone(EMPTY_ANALYTICS);
  }
}

function saveAnalytics(summary: AnalyticsSummaryResponse): void {
  try {
    window.localStorage.setItem(SALES_STORAGE_KEY, JSON.stringify(summary));
  } catch {
    // ignore storage errors
  }
}

function simulateLatency(ms = 90): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const mockEngine = {
  async login(email: string, passcode: string): Promise<AuthUser> {
    await simulateLatency(120);
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      throw new Error('Enter a valid store email address.');
    }
    if (passcode.trim().length < 4) {
      throw new Error('Passcode must be at least 4 characters.');
    }

    return {
      email: cleanEmail,
      name:
        cleanEmail.startsWith('owner') || cleanEmail.startsWith('777')
          ? 'Store Owner'
          : 'Counter Manager',
      role: 'Owner',
      storeName: '777 Liquor Grocery & Gift Shop',
      storeAddress: '931 University Ave, Honolulu, HI',
    };
  },

  async getAllItemsRaw(): Promise<CanonicalItem[]> {
    await simulateLatency(40);
    return loadItems();
  },

  async getItems(query: ItemsQueryParams = {}): Promise<ItemsResponse> {
    await simulateLatency(80);
    const allItems = loadItems();
    return filterAndSortItems(allItems, query);
  },

  async patchItem(cloverId: string, patch: PatchItemPayload): Promise<CanonicalItem> {
    await simulateLatency(70);
    const allItems = loadItems();
    const index = allItems.findIndex((i) => i.clover_id === cloverId);
    if (index === -1) {
      throw new Error(`Item ${cloverId} not found.`);
    }

    const current = allItems[index];
    const hasExplicitFlags = patch.flags !== undefined;
    const merged: CanonicalItem = {
      ...current,
      ...patch,
      cost_source:
        patch.cost_source !== undefined
          ? patch.cost_source
          : patch.cost !== undefined
            ? patch.cost === null
              ? null
              : current.cost_source ?? 'Manual Counter Edit'
            : current.cost_source,
    };

    merged.flags = recomputeItemFlags(merged, {
      preserveReview: hasExplicitFlags
        ? merged.flags.includes('REVIEW')
        : current.flags.includes('REVIEW'),
    });

    allItems[index] = merged;
    saveItems(allItems);
    rotatePreviewToken();
    return merged;
  },

  async bulkPatchItems(payload: BulkPatchPayload): Promise<{ updatedCount: number }> {
    await simulateLatency(100);
    const allItems = loadItems();
    const idSet = new Set(payload.ids);
    let updatedCount = 0;

    const nextItems = allItems.map((item) => {
      if (!idSet.has(item.clover_id)) return item;
      updatedCount += 1;

      const merged: CanonicalItem = {
        ...item,
        ...payload.patch,
      };

      const clearReview = payload.clearFlags?.includes('REVIEW') ?? false;
      const preserveReview = clearReview ? false : item.flags.includes('REVIEW');
      merged.flags = recomputeItemFlags(merged, { preserveReview });
      return merged;
    });

    saveItems(nextItems);
    rotatePreviewToken();
    return { updatedCount };
  },

  async importData(request: ImportRequest): Promise<ImportResponse> {
    await simulateLatency(140);
    const allItems = loadItems();

    if (request.kind === 'inventory') {
      const rows = request.inventoryRows ?? [];
      let importedCount = 0;
      let updatedCount = 0;
      let flaggedCount = 0;
      let duplicatesSkipped = 0;

      const byId = new Map(allItems.map((item, idx) => [item.clover_id, idx]));

      for (const entry of rows) {
        if (entry.decision === 'skip') {
          duplicatesSkipped += 1;
          continue;
        }

        const existingIdx = entry.matchedCloverId ? byId.get(entry.matchedCloverId) : undefined;
        if (entry.decision === 'update' && existingIdx !== undefined) {
          const existing = allItems[existingIdx];
          const updated: CanonicalItem = {
            ...existing,
            normalized_name: entry.item.normalized_name || existing.normalized_name,
            brand: entry.item.brand || existing.brand,
            category:
              entry.item.category && entry.item.category !== 'Uncategorized'
                ? entry.item.category
                : existing.category,
            subcategory: entry.item.subcategory || existing.subcategory,
            upc: entry.item.upc || existing.upc,
            price: entry.item.price > 0 ? entry.item.price : existing.price,
            cost: entry.item.cost !== null ? entry.item.cost : existing.cost,
            cost_source:
              entry.item.cost !== null
                ? entry.item.cost_source ?? `Import: ${request.filename}`
                : existing.cost_source,
            vendor: entry.item.vendor ?? existing.vendor,
            unit_size: entry.item.unit_size || existing.unit_size,
            sell_pack_qty: entry.item.sell_pack_qty ?? existing.sell_pack_qty,
            packs_per_case: entry.item.packs_per_case ?? existing.packs_per_case,
            hi5_eligible: entry.item.hi5_eligible,
            quantity: entry.item.quantity > 0 ? entry.item.quantity : existing.quantity,
            flags: existing.flags,
          };
          updated.flags = recomputeItemFlags(updated, {
            preserveReview: updated.flags.includes('REVIEW'),
          });
          allItems[existingIdx] = updated;
          updatedCount += 1;
          if (updated.flags.length > 0) flaggedCount += 1;
        } else {
          const newId = `CLV-${77800 + allItems.length + 1}`;
          const created: CanonicalItem = {
            ...entry.item,
            clover_id: entry.item.clover_id.startsWith('IMP-') ? newId : entry.item.clover_id,
          };
          created.flags = recomputeItemFlags(created, {
            preserveReview: created.flags.includes('REVIEW'),
          });
          allItems.push(created);
          byId.set(created.clover_id, allItems.length - 1);
          importedCount += 1;
          if (created.flags.length > 0) flaggedCount += 1;
        }
      }

      saveItems(allItems);
      rotatePreviewToken();
      return {
        kind: 'inventory',
        importedCount,
        updatedCount,
        flaggedCount,
        duplicatesSkipped,
      };
    }

    // Sales CSV import (kind === "sales")
    const salesRows = (request.salesRows ?? []).filter((r) => r.include);
    const skipped = (request.salesRows ?? []).length - salesRows.length;
    const itemMap = new Map(allItems.map((i) => [i.clover_id, i]));

    let totalRevenue = 0;
    let totalUnits = 0;
    let costedRevenue = 0;
    let costedProfit = 0;
    const soldIds = new Set<string>();

    const topSellers = salesRows
      .map((row) => {
        totalRevenue += row.gross_sales;
        totalUnits += row.units_sold;
        const matched = row.matchedCloverId ? itemMap.get(row.matchedCloverId) : undefined;
        if (matched) {
          soldIds.add(matched.clover_id);
          if (matched.cost !== null && matched.cost > 0) {
            costedRevenue += row.gross_sales;
            costedProfit += row.gross_sales - matched.cost * row.units_sold;
          }
        }
        return {
          clover_id: row.matchedCloverId || row.clover_id || `UNMATCHED-${row.rowIndex}`,
          normalized_name: matched?.normalized_name ?? row.name,
          units_sold: row.units_sold,
          revenue: Math.round(row.gross_sales * 100) / 100,
          margin_pct: matched ? calculateMarginPercent(matched.price, matched.cost) : null,
        };
      })
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    const deadStock = allItems
      .filter((item) => !soldIds.has(item.clover_id) && item.quantity > 0)
      .slice(0, 8)
      .map((item, idx) => ({
        clover_id: item.clover_id,
        normalized_name: item.normalized_name,
        quantity: item.quantity,
        days_since_sale: 45 + idx * 9,
      }));

    const summary: AnalyticsSummaryResponse = {
      sales_source: 'clover_export',
      last_synced_at: new Date().toISOString(),
      source_filename: request.filename,
      total_revenue: Math.round(totalRevenue * 100) / 100,
      units_sold: totalUnits,
      gross_margin_pct:
        costedRevenue > 0 ? Math.round((costedProfit / costedRevenue) * 1000) / 10 : null,
      top_sellers: topSellers,
      dead_stock: deadStock,
    };

    saveAnalytics(summary);

    return {
      kind: 'sales',
      importedCount: salesRows.length,
      updatedCount: 0,
      flaggedCount: salesRows.filter((r) => r.status === 'unmatched').length,
      duplicatesSkipped: skipped,
      salesSource: 'clover_export',
    };
  },

  async extractInvoiceOcr(
    input: { sampleId: string } | { file: File }
  ): Promise<InvoiceOcrResponse> {
    await simulateLatency(260);
    const allItems = loadItems();

    if ('sampleId' in input) {
      const sample =
        SAMPLE_INVOICE_OCR_TEMPLATES.find((t) => t.id === input.sampleId) ??
        SAMPLE_INVOICE_OCR_TEMPLATES[0];
      return {
        filename: sample.filename,
        vendor: sample.vendor,
        invoice_number: sample.invoice_number,
        invoice_date: sample.invoice_date,
        lines: reconcileInvoiceLines(sample.lines, allItems),
      };
    }

    const filename = input.file.name;
    const isSpirits = /glazer|sg|rndc|spirit|vodka|whisky|wine/i.test(filename);
    const template = isSpirits
      ? SAMPLE_INVOICE_OCR_TEMPLATES[1]
      : SAMPLE_INVOICE_OCR_TEMPLATES[0];

    return {
      filename,
      vendor: template.vendor,
      invoice_number: `OCR-${Math.floor(1000 + Math.random() * 8999)}`,
      invoice_date: new Date().toISOString().slice(0, 10),
      lines: reconcileInvoiceLines(template.lines, allItems),
    };
  },

  /**
   * Phase 3: Assisted Enrichment Lookup (never mutates item directly; returns reviewable proposals)
   */
  async enrichItem(request: EnrichRequest): Promise<EnrichResponse> {
    await simulateLatency(220);
    const allItems = loadItems();
    const item = allItems.find((i) => i.clover_id === request.clover_id);
    if (!item) {
      throw new ApiError(`Item ${request.clover_id} not found.`, { status: 404 });
    }

    const proposals: EnrichProposal[] = [];
    const lookupSet = new Set(request.lookupTypes);
    const asset = selectCategoryAsset(item);

    if (lookupSet.has('logo') && !item.logo_url) {
      proposals.push({
        field: 'logo_url',
        currentValue: item.logo_url,
        proposedValue: asset,
        source: `Web Brand Logo Match (${item.brand || item.category})`,
        confidence: 'high',
      });
    }

    if (lookupSet.has('image') && !item.image_url) {
      proposals.push({
        field: 'image_url',
        currentValue: item.image_url,
        proposedValue: asset,
        source: `Catalog Product Image Lookup (${item.upc || item.brand})`,
        confidence: 'medium',
      });
    }

    if (lookupSet.has('vendor_cost')) {
      const bookEntry = VENDOR_COST_BOOK[item.clover_id];
      if (item.cost === null) {
        if (bookEntry) {
          proposals.push({
            field: 'cost',
            currentValue: null,
            proposedValue: bookEntry.cost,
            source: bookEntry.source,
            confidence: 'high',
          });
          if (!item.vendor) {
            proposals.push({
              field: 'vendor',
              currentValue: null,
              proposedValue: bookEntry.vendor,
              source: bookEntry.source,
              confidence: 'high',
            });
          }
        }
      }
    }

    if (lookupSet.has('gemini_context')) {
      const packHint = GEMINI_PACK_BOOK[item.clover_id];
      const expectedNormalized = normalizeItemName(item.name || item.normalized_name);
      if (expectedNormalized && expectedNormalized !== item.normalized_name) {
        proposals.push({
          field: 'normalized_name',
          currentValue: item.normalized_name,
          proposedValue: expectedNormalized,
          source: 'Gemini Context Analysis (Title Case · 11oz / 1 L)',
          confidence: 'high',
        });
      }

      if (item.sell_pack_qty === null) {
        const packMatch = item.normalized_name.match(/(\d+)\s*pk/i);
        const proposedPack = packHint?.sell_pack_qty ?? (packMatch ? Number(packMatch[1]) : 1);
        proposals.push({
          field: 'sell_pack_qty',
          currentValue: null,
          proposedValue: proposedPack,
          source: 'Gemini Context Analysis (Name & Pack Inference)',
          confidence: packHint || packMatch ? 'high' : 'medium',
        });
      }

      if (item.packs_per_case === null) {
        const proposedCase = packHint?.packs_per_case ?? (item.category === 'Beer' ? 4 : 12);
        proposals.push({
          field: 'packs_per_case',
          currentValue: null,
          proposedValue: proposedCase,
          source: 'Gemini Context Analysis (Standard Case Config)',
          confidence: packHint ? 'high' : 'medium',
        });
      }

      if (!item.vendor && packHint?.vendor && !proposals.some((p) => p.field === 'vendor')) {
        proposals.push({
          field: 'vendor',
          currentValue: null,
          proposedValue: packHint.vendor,
          source: 'Gemini Context Analysis (Hawaii Supplier Match)',
          confidence: 'medium',
        });
      }

      if (!item.unit_size) {
        const sizeMatch = item.normalized_name.match(
          /(\d+(?:\.\d+)?\s*(?:oz|mL|L|pc\s*Box))/i
        );
        if (sizeMatch) {
          proposals.push({
            field: 'unit_size',
            currentValue: '',
            proposedValue: sizeMatch[1],
            source: 'Gemini Context Analysis (Unit Size Parser)',
            confidence: 'high',
          });
        }
      }

      if (!item.brand || item.brand === 'Unknown') {
        const firstTwo = item.normalized_name.split(' ').slice(0, 2).join(' ');
        proposals.push({
          field: 'brand',
          currentValue: item.brand,
          proposedValue: firstTwo,
          source: 'Gemini Context Analysis (Brand Extraction)',
          confidence: 'medium',
        });
      }
    }

    return {
      clover_id: item.clover_id,
      proposals,
    };
  },

  /**
   * Phase 3: Guarded Pricing Review Suggestions (server-authoritative prices + preview_token)
   */
  async getPricingSuggestions(): Promise<PricingSuggestionsResponse> {
    await simulateLatency(110);
    const allItems = loadItems();
    const token = rotatePreviewToken();
    return {
      preview_token: token,
      generated_at: new Date().toISOString(),
      rows: buildPricingSuggestionRows(allItems),
    };
  },

  /**
   * Mock-only helper to simulate a concurrent catalog edit invalidating the active preview_token.
   */
  async invalidatePricingPreviewToken(): Promise<void> {
    await simulateLatency(30);
    rotatePreviewToken();
  },

  /**
   * Phase 3: Apply explicitly approved price changes with preview_token verification.
   */
  async applyPricing(payload: PricingApplyRequest): Promise<PricingApplyResponse> {
    await simulateLatency(160);
    const activeToken = getStoredPreviewToken();

    if (!payload.preview_token || payload.preview_token !== activeToken) {
      throw new ApiError(
        'Pricing preview token is stale because catalog prices or costs changed since this preview was generated. Refresh the preview before applying.',
        {
          status: 409,
          code: 'STALE_PREVIEW_TOKEN',
        }
      );
    }

    if (!payload.clover_ids || payload.clover_ids.length === 0) {
      throw new ApiError('Select at least one item to apply.', {
        status: 400,
        code: 'EMPTY_SELECTION',
      });
    }

    const allItems = loadItems();
    const idSet = new Set(payload.clover_ids);
    let appliedCount = 0;
    let shelfValueDelta = 0;

    const updatedItems = allItems.map((item) => {
      if (!idSet.has(item.clover_id)) return item;
      if (item.suggested_price === null || item.suggested_price === item.price) return item;

      const deltaPerUnit = item.suggested_price - item.price;
      shelfValueDelta += deltaPerUnit * Math.max(0, item.quantity);
      appliedCount += 1;

      const next: CanonicalItem = {
        ...item,
        price: item.suggested_price,
        suggested_price: null,
      };
      next.flags = recomputeItemFlags(next, {
        preserveReview: item.flags.includes('REVIEW'),
      });
      return next;
    });

    saveItems(updatedItems);
    const newToken = rotatePreviewToken();

    return {
      appliedCount,
      shelfValueDelta: Math.round(shelfValueDelta * 100) / 100,
      new_preview_token: newToken,
    };
  },

  async resetDemoData(): Promise<void> {
    await simulateLatency(60);
    saveItems(structuredClone(SEED_INVENTORY_ITEMS));
    saveAnalytics(structuredClone(EMPTY_ANALYTICS));
    try {
      window.localStorage.removeItem(COOLER_DOOR_STORAGE_KEY);
    } catch {
      // ignore storage errors
    }
    rotatePreviewToken();
  },

  async getAnalyticsSummary(): Promise<AnalyticsSummaryResponse> {
    await simulateLatency(60);
    return loadAnalytics();
  },

  async loadSampleSalesExport(): Promise<AnalyticsSummaryResponse> {
    const allItems = loadItems();
    const { headers, rows } = parseDelimitedText(SAMPLE_CLOVER_SALES_CSV);
    const columnMap = autoDetectSalesColumnMap(headers);
    const salesRows = buildSalesImportPreview(rows, columnMap, allItems);
    await this.importData({
      kind: 'sales',
      filename: 'Clover_Sales_Nov_2026.csv',
      sourceLabel: 'Clover Sales Export',
      salesRows,
    });
    return loadAnalytics();
  },

  async getProductSuggestions(): Promise<ProductSuggestion[]> {
    await simulateLatency(110);
    return structuredClone(HAWAII_PRODUCT_SUGGESTIONS);
  },

  async createDraftItemFromSuggestion(suggestion: ProductSuggestion): Promise<CanonicalItem> {
    await simulateLatency(90);
    const allItems = loadItems();
    const existingIds = new Set(allItems.map((i) => i.clover_id));
    const draft = buildDraftItemFromSuggestion(suggestion, existingIds);
    saveItems([draft, ...allItems]);
    rotatePreviewToken();
    return draft;
  },

  async exportToastCatalog(options?: {
    cloverIds?: string[];
    excludeFlagged?: boolean;
  }): Promise<ToastExportResponse> {
    await simulateLatency(120);
    let items = loadItems();
    if (options?.cloverIds && options.cloverIds.length > 0) {
      const idSet = new Set(options.cloverIds);
      items = items.filter((i) => idSet.has(i.clover_id));
    }
    if (options?.excludeFlagged) {
      items = items.filter((i) => i.flags.length === 0);
    }
    return buildToastRetailCsvExport(items);
  },

  async exportFullCatalogSpreadsheet(): Promise<{
    csv: string;
    filename: string;
    rowCount: number;
  }> {
    await simulateLatency(90);
    return buildFullInventoryCsvExport(loadItems());
  },

  async previewCoolerDoorCatalog(): Promise<CoolerDoorPushResponse> {
    await simulateLatency(70);
    return buildCoolerDoorCatalogPayload(loadItems());
  },

  async pushCoolerDoor(): Promise<CoolerDoorPushResponse> {
    await simulateLatency(180);
    const payload = buildCoolerDoorCatalogPayload(loadItems(), new Date().toISOString());
    try {
      window.localStorage.setItem(COOLER_DOOR_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // ignore storage errors
    }
    return payload;
  },

  async getLastCoolerDoorPush(): Promise<CoolerDoorPushResponse | null> {
    try {
      const raw = window.localStorage.getItem(COOLER_DOOR_STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as CoolerDoorPushResponse;
    } catch {
      return null;
    }
  },
};

