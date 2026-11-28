import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCloverResourcePath,
  createCloverService,
} from './cloverService.ts';
import { ApiError } from './apiError.ts';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('buildCloverResourcePath normalizes leading slash and appends clean query params', () => {
  assert.equal(
    buildCloverResourcePath('items', { limit: 100, expand: 'categories,itemStock', empty: '' }),
    '/items?limit=100&expand=categories%2CitemStock'
  );
  assert.equal(buildCloverResourcePath('/tax_rates'), '/tax_rates');
});

test('cloverService supports GET operations and transitions sync status cleanly', async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const states: string[] = [];

  const service = createCloverService({
    baseUrl: 'https://inventory.777liquor.com',
    fetchFn: async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ url, method });

      if (url.endsWith('/api/clover/status')) {
        return jsonResponse({
          configured: true,
          environment: 'production',
          baseUrl: 'https://api.clover.com',
          merchantIdMasked: '77••••931A',
        });
      }
      if (url.includes('/api/clover/v3?path=')) {
        return jsonResponse({ elements: [{ id: 'ABC123', name: 'Kona Big Wave 12oz 6pk' }] });
      }
      return jsonResponse({ error: 'not_found' }, 404);
    },
  });

  service.subscribeSyncStatus(() => {
    states.push(service.getSyncStatus().state);
  });

  const status = await service.getStatus();
  assert.equal(status.configured, true);
  assert.equal(service.getSyncStatus().state, 'idle');
  assert.equal(service.getSyncStatus().merchantIdMasked, '77••••931A');

  const data = await service.get<{ elements: Array<{ id: string }> }>('/items', { limit: 50 });
  assert.equal(data.elements[0].id, 'ABC123');
  assert.equal(calls[1].method, 'GET');
  assert.ok(calls[1].url.includes('/api/clover/v3?path=%2Fitems%3Flimit%3D50'));
  assert.equal(service.getSyncStatus().state, 'synced');
  assert.equal(service.getSyncStatus().lastAction, 'GET /items');
  assert.ok(service.getSyncStatus().lastSyncedAt);
  assert.ok(states.includes('checking'));
  assert.ok(states.includes('syncing'));
  assert.ok(states.includes('synced'));
});

test('cloverService supports POST operations and surfaces HTTP errors into sync status', async () => {
  const postBodies: Array<{ url: string; body: unknown }> = [];

  const service = createCloverService({
    baseUrl: '',
    fetchFn: async (input, init) => {
      const url = String(input);
      const parsedBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      postBodies.push({ url, body: parsedBody });

      if (url === '/api/clover/v3') {
        return jsonResponse({ id: 'ITEM999', name: "Tito's Vodka 1 L", price: 3299 });
      }
      if (url === '/api/clover/categories') {
        return jsonResponse({ id: 'CAT1', name: 'RTD (READY TO DRINK)' }, 201);
      }
      return jsonResponse({ error: 'clover_error', message: 'Invalid Clover token' }, 502);
    },
  });

  const updated = await service.post<{ id: string }>('/items/ITEM999', {
    name: "Tito's Vodka 1 L",
    price: 3299,
  });
  assert.equal(updated.id, 'ITEM999');
  assert.deepEqual(postBodies[0], {
    url: '/api/clover/v3',
    body: { path: '/items/ITEM999', body: { name: "Tito's Vodka 1 L", price: 3299 } },
  });
  assert.equal(service.getSyncStatus().state, 'synced');

  const cat = await service.createCategory('RTD (READY TO DRINK)');
  assert.equal(cat.name, 'RTD (READY TO DRINK)');
  assert.equal(service.getSyncStatus().lastAction, 'Added category "RTD (READY TO DRINK)"');

  await assert.rejects(
    () => service.syncSales(30),
    (err: unknown) => err instanceof ApiError && err.status === 502 && err.message === 'Invalid Clover token'
  );
  assert.equal(service.getSyncStatus().state, 'error');
  assert.equal(service.getSyncStatus().lastError, 'Invalid Clover token');
});
