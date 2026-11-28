import test from 'node:test';
import assert from 'node:assert/strict';
import { CanonicalItem, EnrichProposal } from '../types/inventory';
import {
  buildPatchFromAcceptedProposals,
  buildPricingSuggestionRows,
  computePricingImpact,
  filterEnrichmentQueue,
  getItemMissingGaps,
  getSafeSelectableCloverIds,
} from './enrichmentPricingRules';

const baseItem: CanonicalItem = {
  clover_id: 'CLV-100',
  name: 'KONA BIG WAVE 12OZ 6PK',
  normalized_name: 'Kona Big Wave 12oz 6pk',
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
  logo_url: '/logo.jpg',
  image_url: '/img.jpg',
  quantity: 10,
  flags: [],
  suggested_price: 14.49,
};

test('getItemMissingGaps and filterEnrichmentQueue identify and prioritize incomplete SKUs', () => {
  const missingBoth: CanonicalItem = {
    ...baseItem,
    clover_id: 'CLV-101',
    normalized_name: 'Suntory Toki 750mL',
    cost: null,
    logo_url: null,
    image_url: null,
    sell_pack_qty: null,
    vendor: null,
  };
  const missingLogoOnly: CanonicalItem = {
    ...baseItem,
    clover_id: 'CLV-102',
    normalized_name: 'Aloha Beer IPA 12oz 6pk',
    logo_url: null,
  };

  assert.deepEqual(getItemMissingGaps(baseItem), []);
  assert.deepEqual(getItemMissingGaps(missingBoth), ['logo', 'image', 'cost', 'pack', 'vendor']);

  const queue = filterEnrichmentQueue([baseItem, missingLogoOnly, missingBoth], 'all_gaps');
  assert.deepEqual(
    queue.map((i) => i.clover_id),
    ['CLV-101', 'CLV-102']
  );

  const costOnly = filterEnrichmentQueue([baseItem, missingLogoOnly, missingBoth], 'missing_cost');
  assert.deepEqual(
    costOnly.map((i) => i.clover_id),
    ['CLV-101']
  );
});

test('buildPatchFromAcceptedProposals only applies explicitly accepted changes and normalizes names', () => {
  const proposals: EnrichProposal[] = [
    {
      field: 'normalized_name',
      currentValue: 'titos vodka 1 liter',
      proposedValue: 'titos handmade vodka 1 liter',
      source: 'Gemini Context Analysis',
      confidence: 'high',
    },
    {
      field: 'cost',
      currentValue: null,
      proposedValue: 24.8,
      source: "Southern Glazer's HI Price Sheet",
      confidence: 'high',
    },
    {
      field: 'logo_url',
      currentValue: null,
      proposedValue: '/src/assets/images/brand_spirits_copper.jpg',
      source: 'Web Brand Lookup',
      confidence: 'medium',
    },
    {
      field: 'sell_pack_qty',
      currentValue: null,
      proposedValue: 1,
      source: 'Gemini Context Analysis',
      confidence: 'high',
    },
  ];

  const patch = buildPatchFromAcceptedProposals(proposals, {
    normalized_name: 'accepted',
    cost: 'accepted',
    logo_url: 'rejected',
    sell_pack_qty: 'pending',
  });

  assert.equal(patch.normalized_name, 'Titos Handmade Vodka 1 L');
  assert.equal(patch.cost, 24.8);
  assert.equal(patch.cost_source, "Southern Glazer's HI Price Sheet");
  assert.equal(patch.logo_url, undefined);
  assert.equal(patch.sell_pack_qty, undefined);
});

test('buildPricingSuggestionRows excludes price drops, >20% swings, cost/pack issues, and null suggestions from bulk apply', () => {
  const items: CanonicalItem[] = [
    // Safe moderate increase (+7.4%)
    { ...baseItem, clover_id: 'SAFE-1', price: 13.49, suggested_price: 14.49, quantity: 10 },
    // Price drop (-5.6%)
    {
      ...baseItem,
      clover_id: 'DROP-1',
      price: 26.99,
      suggested_price: 25.49,
      flags: ['PRICE_DROP'],
      quantity: 5,
    },
    // >20% swing (+25.0%)
    { ...baseItem, clover_id: 'SWING-1', price: 20.0, suggested_price: 25.0, quantity: 4 },
    // Missing cost (null suggested_price)
    {
      ...baseItem,
      clover_id: 'NOCOST-1',
      price: 14.99,
      cost: null,
      suggested_price: null,
      flags: ['NO_COST'],
      quantity: 8,
    },
    // Pack config flag even with small price increase
    {
      ...baseItem,
      clover_id: 'PACK-1',
      price: 4.49,
      suggested_price: 4.79,
      flags: ['NEED_PACK_CONFIG'],
      quantity: 20,
    },
  ];

  const rows = buildPricingSuggestionRows(items);
  const byId = new Map(rows.map((r) => [r.clover_id, r]));

  assert.equal(byId.get('SAFE-1')?.excluded_from_bulk, false);
  assert.equal(byId.get('DROP-1')?.excluded_from_bulk, true);
  assert.ok(byId.get('DROP-1')?.exclusion_reasons?.includes('Price drop'));

  assert.equal(byId.get('SWING-1')?.excluded_from_bulk, true);
  assert.ok(byId.get('SWING-1')?.exclusion_reasons?.includes('>20% swing'));

  assert.equal(byId.get('NOCOST-1')?.excluded_from_bulk, true);
  assert.equal(byId.get('NOCOST-1')?.suggested_price, null);
  assert.equal(byId.get('NOCOST-1')?.percent_change, null);

  assert.equal(byId.get('PACK-1')?.excluded_from_bulk, true);

  // Bulk select safe IDs must ONLY return SAFE-1
  assert.deepEqual(getSafeSelectableCloverIds(rows), ['SAFE-1']);

  // Shelf-value impact strictly reflects toggled ON rows
  const impact = computePricingImpact(rows, new Set(['SAFE-1', 'DROP-1', 'NOCOST-1']));
  assert.equal(impact.selectedCount, 2); // NOCOST-1 ignored because suggested_price is null
  assert.equal(impact.safeSelectedCount, 1);
  assert.equal(impact.flaggedSelectedCount, 1);
  assert.equal(impact.totalUnitsAffected, 15);
  assert.equal(impact.shelfValueDelta, 2.5); // (+1.00 * 10) + (-1.50 * 5) = +2.50
});

test('normalizeContractUpdatesToProposals maps API contract updates into proposals', async () => {
  const { normalizeContractUpdatesToProposals } = await import('./enrichmentPricingRules');
  const proposals = normalizeContractUpdatesToProposals(
    [
      {
        item_id: 'CLV-100',
        field: 'logo_url',
        old: null,
        new: '/images/brands/kona.png',
        source: 'Website: konabrewingco.com',
      },
      {
        item_id: 'CLV-OTHER',
        field: 'cost',
        old: null,
        new: 10.5,
        source: 'Other Item',
      },
    ],
    'CLV-100'
  );

  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].field, 'logo_url');
  assert.equal(proposals[0].proposedValue, '/images/brands/kona.png');
  assert.equal(proposals[0].source, 'Website: konabrewingco.com');
});

test('computeEnrichmentFlagResolution clears NO_COST, NEED_PACK_CONFIG, HI5_CONFIRM, and optional REVIEW flags accurately', async () => {
  const { computeEnrichmentFlagResolution } = await import('./enrichmentPricingRules');
  const flaggedItem: CanonicalItem = {
    ...baseItem,
    cost: null,
    sell_pack_qty: null,
    packs_per_case: null,
    hi5_eligible: 'Confirm',
    flags: ['NO_COST', 'NEED_PACK_CONFIG', 'HI5_CONFIRM', 'REVIEW'],
  };

  // Saving cost + pack config clears NO_COST and NEED_PACK_CONFIG, keeping HI5_CONFIRM and REVIEW
  const step1 = computeEnrichmentFlagResolution(flaggedItem, {
    cost: 12.5,
    sell_pack_qty: 6,
    packs_per_case: 4,
  });
  assert.deepEqual(step1.clearedFlags, ['NO_COST', 'NEED_PACK_CONFIG']);
  assert.deepEqual(step1.nextFlags, ['HI5_CONFIRM', 'REVIEW']);
  assert.deepEqual(step1.patchWithFlags.flags, ['HI5_CONFIRM', 'REVIEW']);

  // Confirming HI-5 + clearing REVIEW clears all remaining flags
  const step2 = computeEnrichmentFlagResolution(
    { ...flaggedItem, cost: 12.5, sell_pack_qty: 6, packs_per_case: 4, flags: ['HI5_CONFIRM', 'REVIEW'] },
    { hi5_eligible: 'Yes' },
    { clearReview: true }
  );
  assert.deepEqual(step2.clearedFlags, ['HI5_CONFIRM', 'REVIEW']);
  assert.deepEqual(step2.nextFlags, []);
  assert.deepEqual(step2.patchWithFlags.flags, []);
});

