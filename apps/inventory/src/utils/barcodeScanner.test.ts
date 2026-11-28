import test from 'node:test';
import assert from 'node:assert/strict';
import { CanonicalItem } from '../types/inventory';
import {
  findItemByBarcode,
  matchesItemBarcode,
  normalizeScannedBarcode,
} from './barcodeScanner';

test('normalizeScannedBarcode validates UPC-A, EAN-13, UPC-E, pads 11-digit UPC, and rejects QR URLs', () => {
  const upca = normalizeScannedBarcode(' 079603-011001 ');
  assert.equal(upca.valid, true);
  assert.equal(upca.code, '079603011001');
  assert.equal(upca.formatHint, 'UPC-A');

  const padded = normalizeScannedBarcode('79603011001');
  assert.equal(padded.valid, true);
  assert.equal(padded.code, '079603011001');
  assert.equal(padded.formatHint, 'UPC-A');

  const ean13 = normalizeScannedBarcode('0079603011001');
  assert.equal(ean13.valid, true);
  assert.equal(ean13.formatHint, 'EAN-13');

  const qrUrl = normalizeScannedBarcode('https://777liquor.com/promo');
  assert.equal(qrUrl.valid, false);
  assert.ok(qrUrl.warning?.includes('QR URL'));
});

test('matchesItemBarcode handles UPC-A (12-digit) and EAN-13 (leading-zero 13-digit) equivalence', () => {
  assert.equal(matchesItemBarcode('079603011001', '079603011001'), true);
  assert.equal(matchesItemBarcode('079603011001', '0079603011001'), true);
  assert.equal(matchesItemBarcode('0079603011001', '079603011001'), true);
  assert.equal(matchesItemBarcode('079603011001', '085296800106'), false);
});

test('findItemByBarcode locates catalog items by UPC/EAN or Clover ID', () => {
  const items: CanonicalItem[] = [
    {
      clover_id: 'CLV-77701',
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
      logo_url: null,
      image_url: null,
      quantity: 38,
      flags: [],
      suggested_price: 13.99,
    },
  ];

  // Camera decoded EAN-13 with leading zero matches 12-digit UPC-A
  assert.equal(findItemByBarcode(items, '0079603011001')?.clover_id, 'CLV-77701');
  // Clover ID fallback
  assert.equal(findItemByBarcode(items, 'CLV-77701')?.clover_id, 'CLV-77701');
  // Unmatched code returns null
  assert.equal(findItemByBarcode(items, '999999999999'), null);
});
