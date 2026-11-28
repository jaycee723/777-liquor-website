/**
 * 777 Inventory Operations — Production Cloudflare Worker for inventory.777liquor.com
 *
 * Hosts the built React SPA (dist/) under https://inventory.777liquor.com on the
 * 777liquor.com Cloudflare zone and proxies Clover REST API v3 GET/POST operations
 * strictly server-side using Worker Secrets (CLOVER_MERCHANT_ID, CLOVER_API_TOKEN).
 */

import {
  buildCloverItemUpdatePayload,
  convertCloverTaxRateToPercent,
  isValidCloverItemId,
  mapCloverItemToCanonical,
  maskMerchantId,
  resolveSafeCloverBaseUrl,
  validateCloverV3ResourcePath,
  type CloverRawItem,
} from '../server/cloverService.ts';
import type { CanonicalItem, SalesImportRow } from '../src/types/inventory.ts';
import { normalizeItemName } from '../src/utils/inventoryRules.ts';

interface StaticAssetFetcher {
  fetch(request: Request): Promise<Response>;
}

export interface WorkerEnv {
  ASSETS: StaticAssetFetcher;
  APP_ENV?: string;
  SITE_ORIGIN?: string;
  INVENTORY_ORIGIN?: string;
  CLOVER_MERCHANT_ID?: string;
  CLOVER_API_TOKEN?: string;
  CLOVER_API_BASE_URL?: string;
  GEMINI_API_KEY?: string;
}

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...SECURITY_HEADERS,
    },
  });
}

function getWorkerCloverConfig(env: WorkerEnv) {
  const merchantId = (env.CLOVER_MERCHANT_ID ?? '').trim();
  const token = (env.CLOVER_API_TOKEN ?? '').trim();
  const baseUrl = resolveSafeCloverBaseUrl(env.CLOVER_API_BASE_URL);
  const configured = Boolean(merchantId && token && isValidCloverItemId(merchantId));
  return {
    merchantId,
    token,
    baseUrl,
    status: {
      configured,
      environment: baseUrl.includes('sandbox') ? ('sandbox' as const) : ('production' as const),
      baseUrl,
      merchantIdMasked: merchantId ? maskMerchantId(merchantId) : null,
    },
  };
}

async function cloverEdgeFetch<T>(
  env: WorkerEnv,
  resourcePath: string,
  init: RequestInit = {}
): Promise<T> {
  const cfg = getWorkerCloverConfig(env);
  if (!cfg.status.configured) {
    throw new Error(
      'Clover REST API is not configured on Cloudflare Workers. Add CLOVER_MERCHANT_ID and CLOVER_API_TOKEN via `wrangler secret put`.'
    );
  }

  const normalized = resourcePath.startsWith('/') ? resourcePath : `/${resourcePath}`;
  const url = `${cfg.baseUrl}/v3/merchants/${encodeURIComponent(cfg.merchantId)}${normalized}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.token}`,
      ...(init.headers as Record<string, string> | undefined),
    },
  });

  if (!res.ok) {
    let detail = `Clover API responded with status ${res.status}`;
    try {
      const errBody = (await res.json()) as { message?: string };
      if (errBody?.message) detail = errBody.message;
    } catch {
      // Keep HTTP fallback
    }
    throw new Error(detail);
  }

  return (await res.json()) as T;
}

async function handleApiRequest(request: Request, env: WorkerEnv, url: URL): Promise<Response> {
  const path = url.pathname;
  const method = request.method.toUpperCase();
  const cfg = getWorkerCloverConfig(env);

  if (path === '/api/health' && method === 'GET') {
    return json({
      ok: true,
      service: '777-inventory',
      version: '0.4.0',
      host: env.INVENTORY_ORIGIN ?? 'https://inventory.777liquor.com',
      mainSite: env.SITE_ORIGIN ?? 'https://777liquor.com',
      cloverConfigured: cfg.status.configured,
      geminiConfigured: Boolean(env.GEMINI_API_KEY?.trim()),
    });
  }

  if (path === '/api/clover/status' && method === 'GET') {
    return json(cfg.status);
  }

  // Generic allowlisted Clover REST API v3 GET / POST bridge
  if (path === '/api/clover/v3' && method === 'GET') {
    const rawPath = url.searchParams.get('path') ?? '';
    const check = validateCloverV3ResourcePath(rawPath);
    if (!check.ok) {
      return json({ error: 'invalid_clover_path', message: check.reason }, 400);
    }
    try {
      const data = await cloverEdgeFetch(env, check.path, { method: 'GET' });
      return json(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Clover v3 GET failed.';
      return json({ error: 'clover_v3_get_failed', message: msg }, msg.includes('not configured') ? 400 : 502);
    }
  }

  if (path === '/api/clover/v3' && method === 'POST') {
    const payload = (await request.json().catch(() => ({}))) as { path?: string; body?: unknown };
    const check = validateCloverV3ResourcePath(payload.path ?? '');
    if (!check.ok) {
      return json({ error: 'invalid_clover_path', message: check.reason }, 400);
    }
    try {
      const data = await cloverEdgeFetch(env, check.path, {
        method: 'POST',
        body: payload.body !== undefined ? JSON.stringify(payload.body) : undefined,
      });
      return json(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Clover v3 POST failed.';
      return json({ error: 'clover_v3_post_failed', message: msg }, msg.includes('not configured') ? 400 : 502);
    }
  }

  if (path === '/api/clover/merchant-overview' && method === 'GET') {
    try {
      const [merchantRes, categoriesRes, taxRatesRes, tagsRes, ordersProbe] = await Promise.allSettled([
        cloverEdgeFetch<{
          name?: string;
          address?: { address1?: string; city?: string; state?: string; zip?: string };
          properties?: { defaultCurrency?: string; timezone?: string };
        }>(env, '?expand=address,properties'),
        cloverEdgeFetch<{ elements?: Array<{ id: string; name?: string; sortOrder?: number }> }>(
          env,
          '/categories?limit=100'
        ),
        cloverEdgeFetch<{
          elements?: Array<{ id: string; name?: string; rate?: number; isDefault?: boolean }>;
        }>(env, '/tax_rates?limit=50'),
        cloverEdgeFetch<{ elements?: Array<{ id: string; name?: string }> }>(env, '/tags?limit=100'),
        cloverEdgeFetch<{ elements?: unknown[] }>(env, '/orders?limit=1'),
      ]);

      if (merchantRes.status === 'rejected' && categoriesRes.status === 'rejected') {
        throw merchantRes.reason;
      }

      const merchant = merchantRes.status === 'fulfilled' ? merchantRes.value : {};
      const addr = merchant.address;
      const address = [addr?.address1, addr?.city, addr?.state, addr?.zip].filter(Boolean).join(', ');

      return json({
        merchantName: merchant.name || '777 Liquor Grocery & Gift Shop',
        merchantIdMasked: cfg.status.merchantIdMasked,
        environment: cfg.status.environment,
        address: address || '931 University Ave, Honolulu, HI',
        currency: merchant.properties?.defaultCurrency || 'USD',
        timezone: merchant.properties?.timezone || 'Pacific/Honolulu',
        categories:
          categoriesRes.status === 'fulfilled'
            ? (categoriesRes.value.elements ?? []).map((c) => ({
                id: c.id,
                name: c.name || 'Unnamed Category',
                sortOrder: c.sortOrder,
              }))
            : [],
        taxRates:
          taxRatesRes.status === 'fulfilled'
            ? (taxRatesRes.value.elements ?? []).map((t) => ({
                id: t.id,
                name: t.name || 'Tax Rate',
                ratePercent: convertCloverTaxRateToPercent(t.rate),
                isDefault: Boolean(t.isDefault),
              }))
            : [],
        tags:
          tagsRes.status === 'fulfilled'
            ? (tagsRes.value.elements ?? []).map((t) => ({ id: t.id, name: t.name || 'Tag' }))
            : [],
        permissions: {
          merchantRead: merchantRes.status === 'fulfilled',
          inventoryRead: categoriesRes.status === 'fulfilled',
          ordersRead: ordersProbe.status === 'fulfilled',
        },
        checkedAt: new Date().toISOString(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to fetch Clover merchant settings.';
      return json({ error: 'clover_overview_failed', message: msg }, msg.includes('not configured') ? 400 : 502);
    }
  }

  if (path === '/api/clover/categories' && method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as { name?: string };
    const name = String(body.name ?? '').trim().slice(0, 127);
    if (!name) return json({ error: 'invalid_request', message: 'Category name is required.' }, 400);
    try {
      const created = await cloverEdgeFetch<{ id: string; name?: string; sortOrder?: number }>(
        env,
        '/categories',
        { method: 'POST', body: JSON.stringify({ name }) }
      );
      return json({ id: created.id, name: created.name || name, sortOrder: created.sortOrder }, 201);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to create Clover category.';
      return json({ error: 'clover_category_failed', message: msg }, msg.includes('not configured') ? 400 : 502);
    }
  }

  if (path === '/api/clover/sync-inventory' && method === 'POST') {
    try {
      const allRaw: CloverRawItem[] = [];
      for (let page = 0; page < 20; page += 1) {
        const res = await cloverEdgeFetch<{ elements?: CloverRawItem[] }>(
          env,
          `/items?expand=categories,itemStock&limit=100&offset=${page * 100}`
        );
        const batch = Array.isArray(res.elements) ? res.elements : [];
        for (const raw of batch) {
          if (!raw.deleted) allRaw.push(raw);
        }
        if (batch.length < 100) break;
      }
      const items = allRaw.map(mapCloverItemToCanonical);
      return json({
        items,
        needsNameFixCount: items.filter((i) => i.name !== i.normalized_name).length,
        missingCostCount: items.filter((i) => i.cost === null).length,
        fetchedAt: new Date().toISOString(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to pull Clover inventory.';
      return json({ error: 'clover_sync_failed', message: msg }, msg.includes('not configured') ? 400 : 502);
    }
  }

  if (path === '/api/clover/push-items' && method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as {
      items?: CanonicalItem[];
      syncStock?: boolean;
      createIfDraft?: boolean;
    };
    const items = Array.isArray(body.items) ? body.items.slice(0, 50) : [];
    if (items.length === 0) {
      return json({ error: 'invalid_request', message: 'Provide at least one item to push.' }, 400);
    }

    const results = [];
    let updatedCount = 0;
    let failedCount = 0;

    for (const item of items) {
      const id = (item.clover_id || '').trim();
      const isDraft = id.startsWith('DRAFT-') || id.startsWith('IMP-') || id.startsWith('CLV-');
      const payload = buildCloverItemUpdatePayload(item);

      try {
        if (isDraft && body.createIfDraft) {
          const created = await cloverEdgeFetch<{ id: string; name?: string }>(env, '/items', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          updatedCount += 1;
          results.push({ clover_id: created.id, normalized_name: payload.name, ok: true, created: true });
          continue;
        }
        if (!isValidCloverItemId(id)) {
          failedCount += 1;
          results.push({ clover_id: id || 'INVALID', normalized_name: payload.name, ok: false, error: 'Invalid Clover item ID.' });
          continue;
        }
        await cloverEdgeFetch(env, `/items/${encodeURIComponent(id)}`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        if (body.syncStock && Number.isFinite(item.quantity) && item.quantity >= 0) {
          await cloverEdgeFetch(env, `/item_stocks/${encodeURIComponent(id)}`, {
            method: 'POST',
            body: JSON.stringify({ quantity: Math.round(item.quantity) }),
          });
        }
        updatedCount += 1;
        results.push({ clover_id: id, normalized_name: payload.name, ok: true });
      } catch (err) {
        failedCount += 1;
        results.push({
          clover_id: id,
          normalized_name: payload.name,
          ok: false,
          error: err instanceof Error ? err.message : 'Clover update failed.',
        });
      }
    }

    return json({ updatedCount, failedCount, results });
  }

  if (path === '/api/clover/sync-sales' && method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as { days?: number };
    const safeDays = Math.min(90, Math.max(1, Math.round(body.days ?? 30)));
    const sinceMs = Date.now() - safeDays * 24 * 60 * 60 * 1000;
    try {
      const data = await cloverEdgeFetch<{
        elements?: Array<{
          id: string;
          total?: number;
          payments?: { elements?: Array<{ taxAmount?: number }> };
          discounts?: { elements?: Array<{ amount?: number }> };
          lineItems?: {
            elements?: Array<{ item?: { id?: string }; name?: string; price?: number; unitQty?: number }>;
          };
        }>;
      }>(env, `/orders?expand=lineItems,payments,discounts&filter=createdTime>=${sinceMs}&limit=250`);

      const orders = Array.isArray(data.elements) ? data.elements : [];
      const agg = new Map<string, { cloverId: string | null; name: string; units: number; grossCents: number }>();
      let totalGrossCents = 0;
      let totalTaxCents = 0;
      let totalDiscountCents = 0;

      for (const order of orders) {
        if (typeof order.total === 'number' && order.total > 0) totalGrossCents += order.total;
        for (const p of order.payments?.elements ?? []) {
          if (typeof p.taxAmount === 'number' && p.taxAmount > 0) totalTaxCents += p.taxAmount;
        }
        for (const d of order.discounts?.elements ?? []) {
          if (typeof d.amount === 'number') totalDiscountCents += Math.abs(d.amount);
        }
        for (const line of order.lineItems?.elements ?? []) {
          const itemId = line.item?.id || null;
          const rawName = (line.name || 'Unnamed Item').trim();
          const key = itemId || rawName.toLowerCase();
          const qty = typeof line.unitQty === 'number' && line.unitQty > 0 ? Math.max(1, Math.round(line.unitQty / 1000)) : 1;
          const priceCents = typeof line.price === 'number' && line.price > 0 ? line.price : 0;
          const existing = agg.get(key) ?? {
            cloverId: itemId,
            name: normalizeItemName(rawName),
            units: 0,
            grossCents: 0,
          };
          existing.units += qty;
          existing.grossCents += priceCents * qty;
          agg.set(key, existing);
        }
      }

      const salesRows: SalesImportRow[] = Array.from(agg.values()).map((entry, idx) => ({
        rowIndex: idx + 1,
        clover_id: entry.cloverId,
        upc: '',
        name: entry.name,
        units_sold: entry.units,
        gross_sales: Math.round(entry.grossCents) / 100,
        period_label: `Clover API (${safeDays}d)`,
        matchedCloverId: entry.cloverId,
        status: entry.cloverId ? 'matched' : 'unmatched',
        issues: [],
        include: true,
      }));

      const totalGross = Math.round(totalGrossCents) / 100;
      return json({
        salesRows,
        orderCount: orders.length,
        metrics: {
          orderCount: orders.length,
          totalGross,
          totalTax: Math.round(totalTaxCents) / 100,
          totalDiscounts: Math.round(totalDiscountCents) / 100,
          avgOrderValue: orders.length > 0 ? Math.round((totalGross / orders.length) * 100) / 100 : 0,
          windowDays: safeDays,
        },
        fetchedAt: new Date().toISOString(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to sync Clover sales.';
      return json({ error: 'clover_sales_failed', message: msg }, msg.includes('not configured') ? 400 : 502);
    }
  }

  return json({ error: 'not_found', message: `No API route for ${method} ${path}` }, 404);
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return handleApiRequest(request, env, url);
    }

    // Serve the Vite React SPA launch page and inventory console from Cloudflare Workers Static Assets
    const assetResponse = await env.ASSETS.fetch(request);
    const headers = new Headers(assetResponse.headers);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
      headers.set(k, v);
    }
    return new Response(assetResponse.body, {
      status: assetResponse.status,
      statusText: assetResponse.statusText,
      headers,
    });
  },
};
