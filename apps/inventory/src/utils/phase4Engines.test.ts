import test from 'node:test';
import assert from 'node:assert/strict';
import { AnalyticsSummaryResponse, CanonicalItem, ProductSuggestion } from '../types/inventory';
import {
  buildCategoryMarginBreakdown,
  buildCoolerDoorCatalogPayload,
  buildDraftItemFromSuggestion,
  buildFullInventoryCsvExport,
  buildToastRetailCsvExport,
  deriveToastCategory,
  TOAST_RETAIL_COLUMNS,
} from './phase4Engines';

const sampleItems: CanonicalItem[] = [
  {
    clover_id: 'CLV-1',
    name: 'KONA BIG WAVE 12OZ 6PK',
    normalized_name: 'Kona Big Wave Golden Ale 12oz 6pk',
    brand: 'Kona Brewing',
    category: 'Beer',
    subcategory: 'Craft Ale',
    upc: '079603011001',
    price: 13.49,
    cost: 9.15,
    cost_source: 'Paradise Beverages',
    vendor: 'Paradise Beverages',
    unit_size: '12oz',
    sell_pack_qty: 6,
    packs_per_case: 4,
    hi5_eligible: 'Yes',
    logo_url: '/logos/kona.png',
    image_url: null,
    quantity: 38,
    flags: [],
    suggested_price: 14.49,
  },
  {
    clover_id: 'CLV-2',
    name: 'HIGH NOON PINEAPPLE 12OZ 8PK',
    normalized_name: 'High Noon Pineapple Vodka Seltzer 12oz 8pk',
    brand: 'High Noon',
    category: 'RTD',
    subcategory: 'Spirit-Based Canned Cocktail',
    upc: '008500003198',
    price: 22.99,
    cost: 16.4,
    cost_source: 'RNDC Hawaii',
    vendor: 'RNDC Hawaii',
    unit_size: '12oz',
    sell_pack_qty: 8,
    packs_per_case: 3,
    hi5_eligible: 'Confirm',
    logo_url: null,
    image_url: null,
    quantity: 14,
    flags: ['HI5_CONFIRM'],
    suggested_price: null,
  },
  {
    clover_id: 'CLV-3',
    name: 'HAWAIIAN SUN LILIKOI 11.5OZ CAN',
    normalized_name: 'Hawaiian Sun Lilikoi Passion 11.5oz Can',
    brand: 'Hawaiian Sun',
    category: 'Non-Alcoholic',
    subcategory: 'Juice',
    upc: '007186700014',
    price: 1.99,
    cost: null,
    cost_source: null,
    vendor: 'Hawaiian Isles Distributors',
    unit_size: '11.5oz',
    sell_pack_qty: 1,
    packs_per_case: 24,
    hi5_eligible: 'Yes',
    logo_url: null,
    image_url: null,
    quantity: 96,
    flags: ['NO_COST'],
    suggested_price: null,
  },
  {
    clover_id: 'CLV-4',
    name: "TITO'S HANDMADE VODKA 1 L",
    normalized_name: "Tito's Handmade Vodka 1 L",
    brand: "Tito's",
    category: 'Spirits',
    subcategory: 'Vodka',
    upc: '061994700001',
    price: 34.99,
    cost: 24.5,
    cost_source: "Southern Glazer's HI",
    vendor: "Southern Glazer's HI",
    unit_size: '1 L',
    sell_pack_qty: 1,
    packs_per_case: 12,
    hi5_eligible: 'No',
    logo_url: '/logos/titos.png',
    image_url: '/photos/titos.jpg',
    quantity: 22,
    flags: [],
    suggested_price: null,
  },
];

test('buildToastRetailCsvExport emits exact 26 Toast template columns, $ money formatting, and derived Toast categories', () => {
  assert.equal(TOAST_RETAIL_COLUMNS.length, 26);
  assert.equal(TOAST_RETAIL_COLUMNS[0], 'Item Name');
  assert.equal(TOAST_RETAIL_COLUMNS[25], 'abv (Custom Attribute - Number)');

  assert.equal(deriveToastCategory(sampleItems[0]), 'BEER');
  assert.equal(deriveToastCategory(sampleItems[1]), 'RTD (READY TO DRINK)');
  assert.equal(deriveToastCategory(sampleItems[2]), 'DRINKS');
  assert.equal(deriveToastCategory(sampleItems[3]), 'LIQUOR/SPIRITS');

  const result = buildToastRetailCsvExport(sampleItems, '2026-11-26');
  assert.equal(result.filename, '777_Toast_Retail_Template_2026-11-26.csv');
  assert.equal(result.rowCount, 4);
  assert.equal(result.preflight.readyCount, 2);
  assert.equal(result.preflight.missingCostCount, 1);
  assert.equal(result.preflight.flaggedCount, 2);

  const lines = result.csv.split('\n');
  assert.equal(lines.length, 5); // 1 header + 4 rows
  assert.ok(lines[1].includes('Kona Big Wave Golden Ale 12oz 6pk'));
  assert.ok(lines[1].includes(',Retail,BEER,,$13.49,$9.15,'));
  assert.ok(lines[1].includes(',Case,4,'));
  // Missing cost stays blank, never $0.00
  assert.ok(lines[3].includes(',Retail,DRINKS,,$1.99,,007186700014'));
  // Image URL prefers image_url over logo_url
  assert.ok(lines[4].includes('/photos/titos.jpg'));
});

test('buildFullInventoryCsvExport exports all canonical fields without inventing null costs', () => {
  const full = buildFullInventoryCsvExport(sampleItems, '2026-11-26');
  assert.equal(full.rowCount, 4);
  assert.equal(full.filename, '777_Full_Inventory_Catalog_2026-11-26.csv');
  const lines = full.csv.split('\n');
  assert.equal(lines.length, 5);
  assert.ok(lines[0].startsWith('clover_id,normalized_name,name,brand'));
});

test('buildCoolerDoorCatalogPayload strictly publishes alcohol-only items and tracks missing brand logos', () => {
  const payload = buildCoolerDoorCatalogPayload(sampleItems, '2026-11-26T23:00:00Z');
  assert.equal(payload.pushed, 3);
  assert.equal(payload.excludedCount, 1); // Non-Alcoholic excluded
  assert.deepEqual(payload.by_category, { Beer: 1, RTD: 1, Spirits: 1, Wine: 0 });
  assert.deepEqual(payload.missing_logos, ['High Noon']);
  assert.equal(
    payload.catalog.items.some((i) => i.name.includes('Hawaiian Sun')),
    false
  );
  const kona = payload.catalog.items.find((i) => i.id === 'CLV-1');
  assert.equal(kona?.size, '12oz 6pk');
  assert.equal(kona?.price, 13.49);
});

test('buildCategoryMarginBreakdown rolls up revenue and skips missing-cost items from average margin', () => {
  const analytics: AnalyticsSummaryResponse = {
    sales_source: 'clover_export',
    last_synced_at: '2026-11-26T22:00:00Z',
    source_filename: 'clover_sales.csv',
    total_revenue: 2742.7,
    units_sold: 130,
    gross_margin_pct: 31.2,
    top_sellers: [
      { clover_id: 'CLV-4', normalized_name: "Tito's Handmade Vodka 1 L", units_sold: 46, revenue: 1609.54, margin_pct: 30.0 },
      { clover_id: 'CLV-1', normalized_name: 'Kona Big Wave Golden Ale 12oz 6pk', units_sold: 84, revenue: 1133.16, margin_pct: 32.2 },
    ],
    dead_stock: [],
  };

  const breakdown = buildCategoryMarginBreakdown(sampleItems, analytics);
  const naRow = breakdown.find((r) => r.category === 'Non-Alcoholic');
  assert.equal(naRow?.avgMarginPct, null); // Never invented when cost is null
  assert.equal(breakdown[0].category, 'Spirits');
  assert.equal(breakdown[0].revenue, 1609.54);
});

test('buildDraftItemFromSuggestion normalizes Title Case (11oz / 1 L), enforces HI-5, and sets REVIEW flag', () => {
  const suggestion: ProductSuggestion = {
    id: 'sug-1',
    name: 'surfside iced tea vodka 12 oz 8 pack',
    brand: 'Surfside',
    category: 'RTD',
    subcategory: 'Spirit-Based Canned Cocktail',
    vendor: 'RNDC Hawaii',
    unit_size: '12oz',
    sell_pack_qty: 8,
    packs_per_case: 3,
    estimated_cost: 15.6,
    estimated_retail: 22.99,
    expected_margin_pct: 32.1,
    hawaii_trend_note: 'Fastest-growing non-carbonated vodka tea RTD in Honolulu.',
  };

  const draft = buildDraftItemFromSuggestion(suggestion, new Set(['CLV-1']));
  assert.equal(draft.normalized_name, 'Surfside Iced Tea Vodka 12oz 8pk');
  assert.equal(draft.hi5_eligible, 'Confirm');
  assert.equal(draft.quantity, 0);
  assert.ok(draft.flags.includes('REVIEW'));
  assert.ok(draft.flags.includes('HI5_CONFIRM'));
});
