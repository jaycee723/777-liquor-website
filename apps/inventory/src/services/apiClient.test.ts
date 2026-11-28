import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ApiError,
  buildItemsQueryString,
  createApiClient,
  TokenStorage,
} from './apiClient';

function createMemoryTokenStorage(initial: string | null = null): TokenStorage {
  let value = initial;
  return {
    getToken: () => value,
    setToken: (next) => {
      value = next;
    },
  };
}

test('buildItemsQueryString serializes filters, flags, sort, and pagination cleanly', () => {
  const qs = buildItemsQueryString({
    search: 'kona',
    category: 'Beer',
    hasCost: 'no',
    hasLogo: 'all',
    flag: 'NO_COST',
    sort: 'price:desc',
    page: 2,
    pageSize: 30,
  });

  assert.equal(
    qs,
    '?search=kona&category=Beer&has_cost=no&flags=NO_COST&sort=price%3Adesc&page=2&page_size=30'
  );
  assert.equal(buildItemsQueryString({}), '');
});

test('createApiClient routes to mock repository when useMockApi is true', async () => {
  let fetchCalled = false;
  let mockCalled = false;

  const client = createApiClient({
    useMockApi: true,
    baseUrl: 'https://inventory.777liquor.com',
    fetchFn: (async () => {
      fetchCalled = true;
      throw new Error('fetch should not be called in mock mode');
    }) as typeof fetch,
    mockRepo: {
      login: async (email) => ({
        email,
        name: 'Store Owner',
        role: 'Owner',
        storeName: '777 Liquor',
        storeAddress: '931 University Ave',
      }),
      getAllItemsRaw: async () => [],
      getItems: async () => {
        mockCalled = true;
        return {
          items: [],
          total: 0,
          page: 1,
          pageSize: 15,
          totalPages: 1,
          facets: { categories: [], vendors: [], brands: [] },
          summary: {
            totalItems: 0,
            missingCostCount: 0,
            flaggedCount: 0,
            hi5ConfirmCount: 0,
            missingLogoCount: 0,
          },
        };
      },
      patchItem: async () => {
        throw new Error('unused');
      },
      bulkPatchItems: async () => ({ updatedCount: 0 }),
      importData: async () => {
        throw new Error('unused');
      },
      extractInvoiceOcr: async () => {
        throw new Error('unused');
      },
      getAnalyticsSummary: async () => {
        throw new Error('unused');
      },
      resetDemoData: async () => {},
    },
  });

  const result = await client.getItems({ search: 'maui' });
  assert.equal(mockCalled, true);
  assert.equal(fetchCalled, false);
  assert.equal(result.total, 0);
});

test('live mode sends credentials, JSON headers, and Bearer Authorization header after login', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const tokenStorage = createMemoryTokenStorage();

  const mockFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = String(url);
    calls.push({ url: urlStr, init: init ?? {} });

    if (urlStr.endsWith('/api/auth/login')) {
      return new Response(
        JSON.stringify({
          token: 'cf_worker_jwt_123',
          user: {
            email: 'owner@777liquor.com',
            name: 'Store Owner',
            role: 'Owner',
            storeName: '777 Liquor Grocery & Gift Shop',
            storeAddress: '931 University Ave, Honolulu, HI',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        items: [],
        total: 0,
        page: 1,
        pageSize: 15,
        totalPages: 1,
        facets: { categories: [], vendors: [], brands: [] },
        summary: {
          totalItems: 0,
          missingCostCount: 0,
          flaggedCount: 0,
          hi5ConfirmCount: 0,
          missingLogoCount: 0,
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  const client = createApiClient({
    useMockApi: false,
    baseUrl: 'https://inventory.777liquor.com/',
    fetchFn: mockFetch,
    tokenStorage,
  });

  const user = await client.login('owner@777liquor.com', '7777');
  assert.equal(user.email, 'owner@777liquor.com');
  assert.equal(client.getAuthToken(), 'cf_worker_jwt_123');

  await client.getItems({ category: 'Spirits', page: 1 });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, 'https://inventory.777liquor.com/api/items?category=Spirits&page=1');
  assert.equal(calls[1].init.credentials, 'include');

  const headers = calls[1].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer cf_worker_jwt_123');
  assert.equal(headers['Content-Type'], 'application/json');
  assert.equal(headers.Accept, 'application/json');
});

test('live mode handles 401 unauthorized by clearing token and firing callback, and detects 409 stale preview token', async () => {
  const tokenStorage = createMemoryTokenStorage('expired_token');
  let unauthorizedFired = false;

  const mockFetch = (async (url: string | URL | Request) => {
    const urlStr = String(url);
    if (urlStr.includes('/api/items')) {
      return new Response(
        JSON.stringify({ error: 'Session expired', code: 'UNAUTHORIZED' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(
      JSON.stringify({ error: 'Preview token is stale; refresh preview', code: 'STALE_PREVIEW_TOKEN' }),
      { status: 409, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  const client = createApiClient({
    useMockApi: false,
    baseUrl: 'https://inventory.777liquor.com',
    fetchFn: mockFetch,
    tokenStorage,
    onUnauthorized: () => {
      unauthorizedFired = true;
    },
  });

  await assert.rejects(
    () => client.getItems(),
    (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, 401);
      assert.equal(err.isUnauthorized, true);
      assert.equal(err.message, 'Session expired');
      return true;
    }
  );

  assert.equal(unauthorizedFired, true);
  assert.equal(client.getAuthToken(), null);

  await assert.rejects(
    () => client.applyPricing({ preview_token: 'old_tok', clover_ids: ['CLV-1001'] }),
    (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, 409);
      assert.equal(err.isStalePreviewToken, true);
      return true;
    }
  );
});

test('live mode wraps network errors cleanly as ApiError with status 0', async () => {
  const client = createApiClient({
    useMockApi: false,
    baseUrl: 'https://inventory.777liquor.com',
    fetchFn: (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch,
    tokenStorage: createMemoryTokenStorage(),
  });

  await assert.rejects(
    () => client.getAnalyticsSummary(),
    (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, 0);
      assert.equal(err.code, 'NETWORK_ERROR');
      return true;
    }
  );
});

test('live enrichment actions follow POST /api/enrich -> 202 job_id -> GET /api/enrich/:job_id and applyEnrichmentUpdates clears flags via PATCH', async () => {
  const requests: Array<{ method: string; url: string; body?: unknown }> = [];
  let pollCount = 0;

  const sampleItem = {
    clover_id: 'CLV-777',
    name: 'Sapporo Reserve 22oz Can',
    normalized_name: 'Sapporo Reserve 22oz Can',
    brand: 'Sapporo',
    category: 'Beer',
    subcategory: 'Lager',
    upc: '073110000105',
    price: 4.49,
    cost: null,
    cost_source: null,
    vendor: null,
    unit_size: '22oz',
    sell_pack_qty: null,
    packs_per_case: null,
    hi5_eligible: 'Yes' as const,
    logo_url: null,
    image_url: null,
    quantity: 12,
    flags: ['NO_COST', 'NEED_PACK_CONFIG', 'REVIEW'] as Array<
      'NO_COST' | 'NEED_PACK_CONFIG' | 'PRICE_DROP' | 'REVIEW' | 'HI5_CONFIRM'
    >,
    suggested_price: null,
  };

  const mockFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = String(url);
    const method = init?.method ?? 'GET';
    const parsedBody = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    requests.push({ method, url: urlStr, body: parsedBody });

    if (method === 'POST' && urlStr.endsWith('/api/enrich')) {
      return new Response(
        JSON.stringify({ job_id: 'job_test_001', status: 'queued', item_count: 1 }),
        { status: 202, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (method === 'GET' && urlStr.endsWith('/api/enrich/job_test_001')) {
      pollCount += 1;
      if (pollCount === 1) {
        return new Response(
          JSON.stringify({ job_id: 'job_test_001', status: 'running', progress: 0.5 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({
          job_id: 'job_test_001',
          status: 'done',
          progress: 1,
          results: { costs_found: 0, logos_found: 1, still_missing: 0 },
          updates: [
            {
              item_id: 'CLV-777',
              field: 'logo_url',
              old: null,
              new: '/images/brands/sapporo.png',
              source: 'Official Brand Icon (sapporobeer.com)',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (method === 'PATCH' && urlStr.endsWith('/api/items/CLV-777')) {
      const updated = {
        ...sampleItem,
        ...(parsedBody as Record<string, unknown>),
      };
      return new Response(JSON.stringify(updated), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
  }) as typeof fetch;

  const client = createApiClient({
    useMockApi: false,
    baseUrl: 'https://inventory.777liquor.com',
    fetchFn: mockFetch,
    tokenStorage: createMemoryTokenStorage('jwt_live_token'),
  });

  const progressTicks: number[] = [];
  const logoResult = await client.fetchBrandLogo(sampleItem, {
    pollIntervalMs: 0,
    onJobProgress: (job) => progressTicks.push(job.progress),
  });

  assert.equal(logoResult.job_id, 'job_test_001');
  assert.deepEqual(progressTicks, [0.5, 1]);
  assert.equal(logoResult.proposals.length, 1);
  assert.equal(logoResult.proposals[0].field, 'logo_url');
  assert.equal(logoResult.proposals[0].proposedValue, '/images/brands/sapporo.png');

  // Verify POST /api/enrich sent contract item_ids + tasks
  assert.deepEqual(requests[0].body, {
    item_ids: ['CLV-777'],
    tasks: ['logo'],
    clover_id: 'CLV-777',
    item: sampleItem,
  });

  // Apply enrichment updates (cost + pack config + clearReviewFlag) via PATCH /api/items/CLV-777
  const applied = await client.applyEnrichmentUpdates(
    sampleItem,
    { cost: 2.95, sell_pack_qty: 1, packs_per_case: 12, logo_url: '/images/brands/sapporo.png' },
    { clearReviewFlag: true }
  );

  assert.deepEqual(applied.clearedFlags, ['NO_COST', 'NEED_PACK_CONFIG', 'REVIEW']);
  assert.deepEqual(applied.remainingFlags, []);
  assert.equal(applied.item.cost, 2.95);
  assert.equal(applied.item.logo_url, '/images/brands/sapporo.png');
});

