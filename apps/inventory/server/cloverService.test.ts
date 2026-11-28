import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCloverItemUpdatePayload,
  convertCloverTaxRateToPercent,
  isValidCloverItemId,
  mapCloverItemToCanonical,
  maskMerchantId,
  resolveSafeCloverBaseUrl,
  validateCloverV3ResourcePath,
} from './cloverService.ts';

test('convertCloverTaxRateToPercent converts Clover 100k-scaled integers accurately', () => {
  assert.equal(convertCloverTaxRateToPercent(471200), 4.712);
  assert.equal(convertCloverTaxRateToPercent(400000), 4);
  assert.equal(convertCloverTaxRateToPercent(0), 0);
});

test('validateCloverV3ResourcePath permits official merchant resources and blocks traversal or unknown routes', () => {
  assert.deepEqual(validateCloverV3ResourcePath('/items?limit=50'), {
    ok: true,
    path: '/items?limit=50',
  });
  assert.deepEqual(validateCloverV3ResourcePath('item_stocks/ABC123'), {
    ok: true,
    path: '/item_stocks/ABC123',
  });
  assert.equal(validateCloverV3ResourcePath('../merchants/other').ok, false);
  assert.equal(validateCloverV3ResourcePath('/employees').ok, false);
  assert.equal(validateCloverV3ResourcePath('https://evil.example.com/items').ok, false);
});

test('resolveSafeCloverBaseUrl allows only official Clover HTTPS hosts and blocks untrusted URLs', () => {
  assert.equal(resolveSafeCloverBaseUrl('https://api.clover.com'), 'https://api.clover.com');
  assert.equal(
    resolveSafeCloverBaseUrl('https://sandbox.dev.clover.com/v3'),
    'https://sandbox.dev.clover.com'
  );
  assert.equal(resolveSafeCloverBaseUrl('http://api.clover.com'), 'https://api.clover.com');
  assert.equal(resolveSafeCloverBaseUrl('https://169.254.169.254/latest'), 'https://api.clover.com');
  assert.equal(resolveSafeCloverBaseUrl('https://evil.example.com'), 'https://api.clover.com');
});

test('mapCloverItemToCanonical normalizes Title Case (11oz / 1 L), converts cents, never invents missing cost, and computes HI-5', () => {
  const beer = mapCloverItemToCanonical({
    id: 'CLV8899001',
    name: 'kona big wave 12 oz 6pk',
    code: '079603011001',
    price: 1349,
    cost: 0, // missing in Clover -> must stay null
    categories: { elements: [{ name: 'BEER' }] },
    itemStock: { quantity: 24 },
  });

  assert.equal(beer.clover_id, 'CLV8899001');
  assert.equal(beer.normalized_name, 'Kona Big Wave 12oz 6pk');
  assert.equal(beer.price, 13.49);
  assert.equal(beer.cost, null);
  assert.equal(beer.hi5_eligible, 'Yes');
  assert.equal(beer.quantity, 24);
  assert.ok(beer.flags.includes('NO_COST'));
  assert.ok(beer.flags.includes('REVIEW')); // raw name differed from normalized_name

  const vodka = mapCloverItemToCanonical({
    id: 'CLV8899002',
    name: "TITO'S HANDMADE VODKA 1L",
    code: '061994700001',
    price: 3499,
    cost: 2480,
    categories: { elements: [{ name: 'Liquor' }] },
    itemStock: { quantity: 10 },
  });

  assert.equal(vodka.normalized_name, "Tito's Handmade Vodka 1 L");
  assert.equal(vodka.category, 'Spirits');
  assert.equal(vodka.cost, 24.8);
  assert.equal(vodka.hi5_eligible, 'No');
});

test('buildCloverItemUpdatePayload formats normalized name, cents, and omits null cost', () => {
  const item = mapCloverItemToCanonical({
    id: 'CLV123456',
    name: 'asahi super dry 11 oz 6pk',
    code: '072890001234',
    price: 1399,
    cost: 950,
    categories: { elements: [{ name: 'Beer' }] },
  });

  const payload = buildCloverItemUpdatePayload(item);
  assert.equal(payload.name, 'Asahi Super Dry 11oz 6pk');
  assert.equal(payload.price, 1399);
  assert.equal(payload.cost, 950);
  assert.equal(payload.code, '072890001234');

  const noCostPayload = buildCloverItemUpdatePayload({ ...item, cost: null });
  assert.equal(noCostPayload.cost, undefined);
  assert.equal(isValidCloverItemId('CLV123456'), true);
  assert.equal(isValidCloverItemId('../bad'), false);
  assert.equal(maskMerchantId('ABCD1234EFGH'), 'AB••••EFGH');
});
