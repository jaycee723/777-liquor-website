import test from 'node:test';
import assert from 'node:assert/strict';
import {
  autoDetectInventoryColumnMap,
  autoDetectSalesColumnMap,
  buildInventoryImportPreview,
  buildSalesImportPreview,
  computeUnitCostFromCase,
  parseDelimitedText,
  reconcileInvoiceLines,
} from './importEngine';
import { SEED_INVENTORY_ITEMS } from '../api/mockData';

test('parseDelimitedText parses quoted CSV fields and skips blank lines', () => {
  const csv = `Item Name,Price,Vendor\n"Kona Big Wave, 12oz 6pk","$13.49","Paradise Beverages"\n\n"Tito's Vodka 1l",34.99,Southern Glazer's HI`;
  const parsed = parseDelimitedText(csv);
  assert.deepEqual(parsed.headers, ['Item Name', 'Price', 'Vendor']);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0]['Item Name'], 'Kona Big Wave, 12oz 6pk');
  assert.equal(parsed.rows[0]['Price'], '$13.49');
});

test('autoDetectInventoryColumnMap recognizes Clover, Toast, and messy vendor headers', () => {
  const map = autoDetectInventoryColumnMap([
    'Item Name',
    'Product Code',
    'Base Price',
    'Wholesale Cost',
    'Distributor',
    'On Hand',
    'Notes',
  ]);
  assert.equal(map['Item Name'], 'name');
  assert.equal(map['Product Code'], 'upc');
  assert.equal(map['Base Price'], 'price');
  assert.equal(map['Wholesale Cost'], 'cost');
  assert.equal(map['Distributor'], 'vendor');
  assert.equal(map['On Hand'], 'quantity');
  assert.equal(map['Notes'], '__ignore__');
});

test('buildInventoryImportPreview normalizes Title Case (11oz, 1 L), flags duplicates, dirty rows, and missing costs', () => {
  const rawRows = [
    // New clean item with messy casing & missing cost
    { Name: 'lanikai pillbox porter 12 oz 6 pack', UPC: '085111000101', Price: '14.99', Cost: '', Category: 'Beer' },
    // Duplicate of row 1 inside same file
    { Name: 'lanikai pillbox porter 12 oz 6 pack', UPC: '085111000101', Price: '14.99', Cost: '', Category: 'Beer' },
    // Existing catalog item match by UPC
    { Name: 'kona big wave 12oz 6pk', UPC: '079603011001', Price: '13.49', Cost: '9.25', Category: 'Beer' },
    // Dirty row (missing price & not existing)
    { Name: 'mystery spirit 1 l', UPC: '099999999999', Price: '', Cost: '', Category: 'Spirits' },
  ];

  const colMap = autoDetectInventoryColumnMap(['Name', 'UPC', 'Price', 'Cost', 'Category']);
  const preview = buildInventoryImportPreview(rawRows, colMap, SEED_INVENTORY_ITEMS, 'clover_test.csv');

  assert.equal(preview[0].status, 'new');
  assert.equal(preview[0].item.normalized_name, 'Lanikai Pillbox Porter 12oz 6pk');
  assert.equal(preview[0].item.cost, null);
  assert.ok(preview[0].item.flags.includes('NO_COST'));
  assert.equal(preview[0].item.hi5_eligible, 'Yes');

  assert.equal(preview[1].status, 'duplicate_in_file');
  assert.equal(preview[1].decision, 'skip');

  assert.equal(preview[2].status, 'update_existing');
  assert.equal(preview[2].matchedCloverId, 'CLV-77701');
  assert.equal(preview[2].decision, 'update');

  assert.equal(preview[3].status, 'dirty');
  assert.equal(preview[3].decision, 'skip');
  assert.equal(preview[3].item.normalized_name, 'Mystery Spirit 1 L');
});

test('buildSalesImportPreview maps Clover sales CSV and matches SKUs cleanly', () => {
  const headers = ['Item Name', 'UPC', 'Units Sold', 'Gross Sales', 'Period'];
  const map = autoDetectSalesColumnMap(headers);
  const rows = [
    { 'Item Name': 'KONA BIG WAVE GOLDEN ALE 12OZ 6PK', UPC: '079603011001', 'Units Sold': '42', 'Gross Sales': '$566.58', Period: 'Nov 2026' },
    { 'Item Name': 'Unknown Seasonal Item', UPC: '000000111111', 'Units Sold': '5', 'Gross Sales': '$49.95', Period: 'Nov 2026' },
  ];

  const preview = buildSalesImportPreview(rows, map, SEED_INVENTORY_ITEMS);
  assert.equal(preview[0].status, 'matched');
  assert.equal(preview[0].matchedCloverId, 'CLV-77701');
  assert.equal(preview[0].units_sold, 42);
  assert.equal(preview[0].gross_sales, 566.58);
  assert.equal(preview[1].status, 'unmatched');
});

test('computeUnitCostFromCase and reconcileInvoiceLines calculate pack cost accurately and never invent missing cost', () => {
  assert.equal(computeUnitCostFromCase(41.8, 4), 10.45);
  assert.equal(computeUnitCostFromCase(null, 4), null);
  assert.equal(computeUnitCostFromCase(41.8, null), null);

  const reconciled = reconcileInvoiceLines(
    [
      {
        lineId: 'L1',
        raw_description: 'MAUI BIG SWELL IPA 12OZ 6PK',
        normalized_name: 'Maui Brewing Big Swell IPA 12oz 6pk',
        upc: '085296800113',
        case_cost: 41.8,
        sell_pack_qty: 6,
        packs_per_case: 4,
        confidence: 'high',
        include: true,
      },
    ],
    SEED_INVENTORY_ITEMS
  );

  assert.equal(reconciled[0].matchedCloverId, 'CLV-77704');
  assert.equal(reconciled[0].unit_cost, 10.45);
});
