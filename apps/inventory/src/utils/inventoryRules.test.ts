import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateMarginPercent,
  determineHi5Eligibility,
  filterAndSortItems,
  getBrandInitials,
  normalizeItemName,
  recomputeItemFlags,
  validateNumericPatch,
} from './inventoryRules';
import { CanonicalItem } from '../types/inventory';

function makeItem(overrides: Partial<CanonicalItem> = {}): CanonicalItem {
  return {
    clover_id: 'CLV-1001',
    name: 'kona big wave 12 oz 6 pack',
    normalized_name: 'Kona Big Wave 12oz 6pk',
    brand: 'Kona Brewing',
    category: 'Beer',
    subcategory: 'Craft Ale',
    upc: '079603011001',
    price: 12.99,
    cost: 8.75,
    cost_source: 'Paradise Beverages Invoice #4421',
    vendor: 'Paradise Beverages',
    unit_size: '12oz',
    sell_pack_qty: 6,
    packs_per_case: 4,
    hi5_eligible: 'Yes',
    logo_url: '/src/assets/images/brand_kona_wave.jpg',
    image_url: null,
    quantity: 24,
    flags: [],
    suggested_price: 13.49,
    ...overrides,
  };
}

test('normalizeItemName applies store Title Case and unit conventions (11oz, 1 L, 750mL, 6pk)', () => {
  assert.equal(
    normalizeItemName('example of the capitalization rules that i prefer to use 11oz 1 l'),
    'Example Of The Capitalization Rules That I Prefer To Use 11oz 1 L'
  );
  assert.equal(
    normalizeItemName("tito's handmade vodka 1l"),
    "Tito's Handmade Vodka 1 L"
  );
  assert.equal(
    normalizeItemName('asahi super dry 11.2 oz 6 pack'),
    'Asahi Super Dry 11.2oz 6pk'
  );
  assert.equal(
    normalizeItemName('aloha beer hop lei ipa 12 oz 6pk'),
    'Aloha Beer Hop Lei IPA 12oz 6pk'
  );
  assert.equal(
    normalizeItemName('hennessy v.s cognac 750 ml'),
    'Hennessy V.S Cognac 750mL'
  );
});

test('determineHi5Eligibility enforces Hawaii $0.06 HI-5 rules', () => {
  assert.equal(determineHi5Eligibility('Beer', 'Craft Ale', 'Kona Big Wave 12oz'), 'Yes');
  assert.equal(determineHi5Eligibility('Non-Alcoholic', 'Juice', 'Hawaiian Sun 11.5oz'), 'Yes');
  assert.equal(determineHi5Eligibility('Spirits', 'Vodka', "Tito's Handmade Vodka 1 L"), 'No');
  assert.equal(determineHi5Eligibility('Wine', 'Pinot Noir', 'Meiomi Pinot Noir 750mL'), 'No');
  assert.equal(
    determineHi5Eligibility('RTD', 'Spirit-Based Canned Cocktail', 'High Noon Pineapple 12oz 8pk'),
    'Confirm'
  );
});

test('recomputeItemFlags accurately manages NO_COST, NEED_PACK_CONFIG, HI5_CONFIRM, PRICE_DROP, and REVIEW', () => {
  const missingCostItem = makeItem({
    cost: null,
    sell_pack_qty: null,
    hi5_eligible: 'Confirm',
    price: 24.99,
    suggested_price: 21.99,
    flags: ['REVIEW'],
  });

  const flags = recomputeItemFlags(missingCostItem);
  assert.deepEqual(
    flags.sort(),
    ['HI5_CONFIRM', 'NEED_PACK_CONFIG', 'NO_COST', 'PRICE_DROP', 'REVIEW'].sort()
  );

  // Clearing cost issue and HI-5 confirmation clears those flags
  const resolved = recomputeItemFlags(
    { ...missingCostItem, cost: 14.5, sell_pack_qty: 8, hi5_eligible: 'Yes', suggested_price: null },
    { preserveReview: false }
  );
  assert.deepEqual(resolved, []);
});

test('calculateMarginPercent returns null when cost is missing and never invents a margin', () => {
  assert.equal(calculateMarginPercent(12.99, null), null);
  assert.equal(calculateMarginPercent(12.99, 0), null);
  assert.equal(calculateMarginPercent(20, 12), 40);
});

test('getBrandInitials derives clean 2-character badges', () => {
  assert.equal(getBrandInitials('Kona Brewing', 'Big Wave'), 'KB');
  assert.equal(getBrandInitials('Heineken', 'Heineken 12oz'), 'HE');
  assert.equal(getBrandInitials('', 'Aloha Maid'), 'AM');
});

test('validateNumericPatch rejects invalid/negative numbers and allows clearing cost to null', () => {
  assert.deepEqual(validateNumericPatch('price', '19.99'), { valid: true, value: 19.99 });
  assert.equal(validateNumericPatch('price', '0').valid, false);
  assert.equal(validateNumericPatch('price', '').valid, false);
  assert.deepEqual(validateNumericPatch('cost', ''), { valid: true, value: null });
  assert.equal(validateNumericPatch('cost', '-2').valid, false);
  assert.equal(validateNumericPatch('quantity', '4.5').valid, false);
  assert.deepEqual(validateNumericPatch('quantity', '0'), { valid: true, value: 0 });
});

test('filterAndSortItems filters by search, facets, missing cost/logo, flags and sorts nulls last', () => {
  const items = [
    makeItem({ clover_id: 'A', normalized_name: 'Alpha Beer 12oz', price: 10, cost: null, logo_url: null, flags: ['NO_COST'] }),
    makeItem({ clover_id: 'B', normalized_name: 'Bravo Vodka 1 L', category: 'Spirits', price: 30, cost: 19, flags: [] }),
    makeItem({ clover_id: 'C', normalized_name: 'Charlie Wine 750mL', category: 'Wine', price: 15, cost: 9, flags: ['REVIEW'] }),
  ];

  const missingCostRes = filterAndSortItems(items, { hasCost: 'no' });
  assert.equal(missingCostRes.total, 1);
  assert.equal(missingCostRes.items[0].clover_id, 'A');

  const missingLogoRes = filterAndSortItems(items, { hasLogo: 'no' });
  assert.equal(missingLogoRes.total, 1);
  assert.equal(missingLogoRes.items[0].clover_id, 'A');

  const sortedByCostAsc = filterAndSortItems(items, { sort: 'cost:asc' });
  assert.deepEqual(
    sortedByCostAsc.items.map((i) => i.clover_id),
    ['C', 'B', 'A'] // null cost always pushed last
  );
});
