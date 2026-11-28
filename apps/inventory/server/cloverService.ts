import type { CanonicalItem, SalesImportRow } from '../src/types/inventory.ts';
import {
  determineHi5Eligibility,
  normalizeItemName,
  recomputeItemFlags,
} from '../src/utils/inventoryRules.ts';

const ALLOWED_CLOVER_HOSTS = new Set([
  'api.clover.com',
  'sandbox.dev.clover.com',
  'api.eu.clover.com',
]);

const CLOVER_ID_PATTERN = /^[A-Za-z0-9_-]{3,40}$/;

export interface CloverConfigStatus {
  configured: boolean;
  environment: 'production' | 'sandbox';
  baseUrl: string;
  merchantIdMasked: string | null;
}

export interface CloverCategorySummary {
  id: string;
  name: string;
  sortOrder?: number;
}

export interface CloverTaxRateSummary {
  id: string;
  name: string;
  ratePercent: number;
  isDefault: boolean;
}

export interface CloverTagSummary {
  id: string;
  name: string;
}

export interface CloverMerchantOverview {
  merchantName: string;
  merchantIdMasked: string | null;
  environment: 'production' | 'sandbox';
  address: string;
  currency: string;
  timezone: string;
  categories: CloverCategorySummary[];
  taxRates: CloverTaxRateSummary[];
  tags: CloverTagSummary[];
  permissions: {
    merchantRead: boolean;
    inventoryRead: boolean;
    ordersRead: boolean;
  };
  checkedAt: string;
}

export interface CloverRawItem {
  id: string;
  name?: string;
  alternateName?: string;
  code?: string;
  sku?: string;
  price?: number; // cents
  cost?: number; // cents
  hidden?: boolean;
  deleted?: boolean;
  categories?: { elements?: Array<{ id?: string; name?: string }> };
  itemStock?: { quantity?: number; stockCount?: number };
}

export interface CloverPushItemResult {
  clover_id: string;
  normalized_name: string;
  ok: boolean;
  created?: boolean;
  error?: string;
}

export interface CloverSalesMetrics {
  orderCount: number;
  totalGross: number;
  totalTax: number;
  totalDiscounts: number;
  avgOrderValue: number;
  windowDays: number;
}

export function resolveSafeCloverBaseUrl(raw?: string): string {
  const fallback = 'https://api.clover.com';
  if (!raw || !raw.trim()) return fallback;
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol !== 'https:') return fallback;
    if (!ALLOWED_CLOVER_HOSTS.has(parsed.hostname.toLowerCase())) return fallback;
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return fallback;
  }
}

export function maskMerchantId(merchantId: string | undefined): string | null {
  if (!merchantId) return null;
  const trimmed = merchantId.trim();
  if (trimmed.length <= 4) return '••••';
  return `${trimmed.slice(0, 2)}••••${trimmed.slice(-4)}`;
}

export function getCloverRuntimeConfig(): {
  merchantId: string;
  token: string;
  baseUrl: string;
  status: CloverConfigStatus;
} {
  const merchantId = (process.env.CLOVER_MERCHANT_ID || '').trim();
  const token = (process.env.CLOVER_API_TOKEN || '').trim();
  const baseUrl = resolveSafeCloverBaseUrl(process.env.CLOVER_API_BASE_URL);
  const configured = Boolean(merchantId && token && CLOVER_ID_PATTERN.test(merchantId));

  return {
    merchantId,
    token,
    baseUrl,
    status: {
      configured,
      environment: baseUrl.includes('sandbox') ? 'sandbox' : 'production',
      baseUrl,
      merchantIdMasked: merchantId ? maskMerchantId(merchantId) : null,
    },
  };
}

function mapRawCategory(rawCategoryName: string, normalizedName: string): {
  category: string;
  subcategory: string;
} {
  const raw = rawCategoryName.trim().toLowerCase();
  const name = normalizedName.toLowerCase();

  if (
    raw.includes('rtd') ||
    raw.includes('seltzer') ||
    raw.includes('canned cocktail') ||
    name.includes('high noon') ||
    name.includes('cutwater') ||
    name.includes('white claw') ||
    name.includes('surfside')
  ) {
    return { category: 'RTD', subcategory: rawCategoryName.trim() || 'Canned Cocktail' };
  }
  if (raw.includes('beer') || raw.includes('ale') || raw.includes('lager') || raw.includes('ipa')) {
    return { category: 'Beer', subcategory: rawCategoryName.trim() || 'Beer' };
  }
  if (
    raw.includes('spirit') ||
    raw.includes('liquor') ||
    raw.includes('vodka') ||
    raw.includes('whisky') ||
    raw.includes('whiskey') ||
    raw.includes('tequila') ||
    raw.includes('rum') ||
    raw.includes('cognac')
  ) {
    return { category: 'Spirits', subcategory: rawCategoryName.trim() || 'Spirits' };
  }
  if (raw.includes('wine') || raw.includes('champagne') || raw.includes('sake')) {
    return { category: 'Wine', subcategory: rawCategoryName.trim() || 'Wine' };
  }
  if (
    raw.includes('non-alc') ||
    raw.includes('soda') ||
    raw.includes('juice') ||
    raw.includes('water') ||
    raw.includes('drink') ||
    raw.includes('mixer')
  ) {
    return { category: 'Non-Alcoholic', subcategory: rawCategoryName.trim() || 'Beverage' };
  }
  if (raw.includes('snack') || raw.includes('grocery') || raw.includes('food')) {
    return { category: 'Grocery', subcategory: rawCategoryName.trim() || 'Snacks' };
  }
  if (raw.includes('gift') || raw.includes('merch') || raw.includes('souvenir')) {
    return { category: 'Gift', subcategory: rawCategoryName.trim() || 'Gift' };
  }

  return {
    category: rawCategoryName.trim() ? normalizeItemName(rawCategoryName) : 'Uncategorized',
    subcategory: rawCategoryName.trim() ? normalizeItemName(rawCategoryName) : 'General',
  };
}

function extractUnitSizeFromName(name: string): string {
  const match = name.match(/\b(\d+(?:\.\d+)?)\s*(oz|mL|ml|L|g|lb)\b/i);
  if (!match) return '';
  const num = match[1];
  const unit = match[2].toLowerCase();
  if (unit === 'l') return `${num} L`;
  if (unit === 'ml') return `${num}mL`;
  return `${num}${unit}`;
}

function extractSellPackQty(name: string): number | null {
  const match = name.match(/\b(\d+)\s*(?:pk|pack)\b/i);
  if (match) {
    const qty = Number(match[1]);
    return Number.isFinite(qty) && qty > 0 ? qty : null;
  }
  if (/\b(?:750mL|1 L|1\.75 L|375mL|can|bottle)\b/i.test(name)) {
    return 1;
  }
  return null;
}

/**
 * Maps a raw Clover REST v3 inventory item into our canonical 777 schema,
 * applying Title Case + compact oz / spaced L normalization, HI-5 rules, and flags.
 * Never fabricates missing cost (0 or absent in Clover -> null).
 */
export function mapCloverItemToCanonical(raw: CloverRawItem): CanonicalItem {
  const rawName = (raw.name || raw.alternateName || 'Unnamed Item').trim();
  const normalizedName = normalizeItemName(rawName);
  const rawCatName = raw.categories?.elements?.[0]?.name || '';
  const { category, subcategory } = mapRawCategory(rawCatName, normalizedName);

  const priceDollars =
    typeof raw.price === 'number' && Number.isFinite(raw.price) && raw.price > 0
      ? Math.round(raw.price) / 100
      : 0;

  const costDollars =
    typeof raw.cost === 'number' && Number.isFinite(raw.cost) && raw.cost > 0
      ? Math.round(raw.cost) / 100
      : null;

  const upc = (raw.code || raw.sku || '').replace(/\s+/g, '').slice(0, 32);
  const quantityRaw = raw.itemStock?.quantity ?? raw.itemStock?.stockCount ?? 0;
  const quantity = Number.isFinite(quantityRaw) ? Math.max(0, Math.round(quantityRaw)) : 0;

  const unitSize = extractUnitSizeFromName(normalizedName);
  const sellPackQty = extractSellPackQty(normalizedName);
  const hi5 = determineHi5Eligibility(category, subcategory, normalizedName);

  const firstTokens = normalizedName.split(/\s+/).slice(0, 2).join(' ');
  const needsReview = rawName !== normalizedName || category === 'Uncategorized';

  const item: CanonicalItem = {
    clover_id: String(raw.id || '').trim(),
    name: rawName,
    normalized_name: normalizedName,
    brand: firstTokens,
    category,
    subcategory,
    upc,
    price: priceDollars,
    cost: costDollars,
    cost_source: costDollars !== null ? 'Clover POS' : null,
    vendor: null,
    unit_size: unitSize,
    sell_pack_qty: sellPackQty,
    packs_per_case: null,
    hi5_eligible: hi5,
    logo_url: null,
    image_url: null,
    quantity,
    flags: needsReview ? ['REVIEW'] : [],
    suggested_price: null,
  };

  item.flags = recomputeItemFlags(item, {
    preserveReview: needsReview,
  });

  return item;
}

/**
 * Builds the exact Clover REST v3 update/create payload to fix item name capitalization,
 * shelf price (cents), vendor cost (cents, only when known), and barcode/code.
 */
export function buildCloverItemUpdatePayload(item: CanonicalItem): {
  name: string;
  price: number;
  cost?: number;
  code?: string;
} {
  const fixedName = normalizeItemName(item.normalized_name || item.name);
  const payload: { name: string; price: number; cost?: number; code?: string } = {
    name: fixedName.slice(0, 127),
    price: Math.max(0, Math.round(item.price * 100)),
  };

  if (item.cost !== null && Number.isFinite(item.cost) && item.cost > 0) {
    payload.cost = Math.round(item.cost * 100);
  }
  if (item.upc && item.upc.trim().length > 0) {
    payload.code = item.upc.trim().slice(0, 64);
  }

  return payload;
}

/**
 * Converts Clover's 100,000-scaled tax rate integer (e.g. 471200 -> 4.712%) into a clean percentage.
 */
export function convertCloverTaxRateToPercent(rate: number | undefined): number {
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return 0;
  return Math.round((rate / 100000) * 1000) / 1000;
}

export function isValidCloverItemId(id: string): boolean {
  return CLOVER_ID_PATTERN.test(id.trim());
}

const ALLOWED_V3_RESOURCES = new Set([
  'items',
  'categories',
  'tax_rates',
  'tags',
  'orders',
  'item_stocks',
  'properties',
  'address',
]);

/**
 * Validates that a Clover REST API v3 merchant-relative resource path stays strictly
 * within allowed inventory/order/merchant endpoints (blocks path traversal & SSRF).
 */
export function validateCloverV3ResourcePath(
  rawPath: string
): { ok: true; path: string } | { ok: false; reason: string } {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return { ok: false, reason: 'Clover resource path is required.' };
  }
  if (trimmed.length > 300 || /[\r\n\0]/.test(trimmed) || trimmed.includes('..') || trimmed.includes('://')) {
    return { ok: false, reason: 'Invalid Clover resource path.' };
  }

  const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const [pathname, query = ''] = normalized.split('?', 2);
  const segments = pathname.split('/').filter(Boolean);

  // Allow root merchant endpoint ("/") with optional expand query
  if (segments.length === 0) {
    return { ok: true, path: query ? `?${query}` : '' };
  }

  const [resource, resourceId, subResource] = segments;
  if (!ALLOWED_V3_RESOURCES.has(resource)) {
    return { ok: false, reason: `Resource "${resource}" is not allowed on the Clover bridge.` };
  }
  if (segments.length > 3) {
    return { ok: false, reason: 'Clover resource path has too many segments.' };
  }
  if (resourceId && !CLOVER_ID_PATTERN.test(resourceId)) {
    return { ok: false, reason: 'Invalid Clover resource identifier.' };
  }
  if (subResource && !ALLOWED_V3_RESOURCES.has(subResource)) {
    return { ok: false, reason: `Sub-resource "${subResource}" is not allowed.` };
  }

  const cleanPathname = `/${segments.join('/')}`;
  return { ok: true, path: query ? `${cleanPathname}?${query}` : cleanPathname };
}

export async function proxyCloverV3Request<T = unknown>(
  method: 'GET' | 'POST',
  rawResourcePath: string,
  body?: unknown
): Promise<T> {
  const check = validateCloverV3ResourcePath(rawResourcePath);
  if (!check.ok) {
    throw new Error(check.reason);
  }
  return cloverRequest<T>(check.path, {
    method,
    ...(method === 'POST' && body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function cloverRequest<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const { merchantId, token, baseUrl, status } = getCloverRuntimeConfig();
  if (!status.configured) {
    throw new Error(
      'Clover REST API is not configured on the server. Add CLOVER_MERCHANT_ID and CLOVER_API_TOKEN in Settings -> Secrets.'
    );
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = `${baseUrl}/v3/merchants/${encodeURIComponent(merchantId)}${normalizedPath}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init.headers as Record<string, string> | undefined),
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      let detail = `Clover API responded with status ${response.status}`;
      try {
        const errBody = (await response.json()) as { message?: string };
        if (errBody?.message) detail = errBody.message;
      } catch {
        // Keep generic message
      }
      throw new Error(detail);
    }

    return (await response.json()) as T;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Clover REST API request timed out. Please try again.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probes live Clover connectivity and loads merchant settings, categories, tax rates, and tags.
 */
export async function fetchCloverMerchantOverview(): Promise<CloverMerchantOverview> {
  const { status } = getCloverRuntimeConfig();

  const [merchantRes, categoriesRes, taxRatesRes, tagsRes, ordersProbe] = await Promise.allSettled([
    cloverRequest<{
      name?: string;
      address?: { address1?: string; city?: string; state?: string; zip?: string };
      properties?: { defaultCurrency?: string; timezone?: string };
    }>('?expand=address,properties'),
    cloverRequest<{ elements?: Array<{ id: string; name?: string; sortOrder?: number }> }>(
      '/categories?limit=100'
    ),
    cloverRequest<{
      elements?: Array<{ id: string; name?: string; rate?: number; isDefault?: boolean }>;
    }>('/tax_rates?limit=50'),
    cloverRequest<{ elements?: Array<{ id: string; name?: string }> }>('/tags?limit=100'),
    cloverRequest<{ elements?: unknown[] }>('/orders?limit=1'),
  ]);

  if (
    merchantRes.status === 'rejected' &&
    categoriesRes.status === 'rejected'
  ) {
    throw new Error(
      merchantRes.reason instanceof Error
        ? merchantRes.reason.message
        : 'Unable to reach Clover REST API. Verify CLOVER_MERCHANT_ID and CLOVER_API_TOKEN.'
    );
  }

  const merchant = merchantRes.status === 'fulfilled' ? merchantRes.value : {};
  const addr = merchant.address;
  const addressParts = [addr?.address1, addr?.city, addr?.state, addr?.zip].filter(Boolean);

  const categories: CloverCategorySummary[] =
    categoriesRes.status === 'fulfilled'
      ? (categoriesRes.value.elements ?? []).map((c) => ({
          id: c.id,
          name: c.name || 'Unnamed Category',
          sortOrder: c.sortOrder,
        }))
      : [];

  const taxRates: CloverTaxRateSummary[] =
    taxRatesRes.status === 'fulfilled'
      ? (taxRatesRes.value.elements ?? []).map((t) => ({
          id: t.id,
          name: t.name || 'Tax Rate',
          ratePercent: convertCloverTaxRateToPercent(t.rate),
          isDefault: Boolean(t.isDefault),
        }))
      : [];

  const tags: CloverTagSummary[] =
    tagsRes.status === 'fulfilled'
      ? (tagsRes.value.elements ?? []).map((tag) => ({
          id: tag.id,
          name: tag.name || 'Tag',
        }))
      : [];

  return {
    merchantName: merchant.name || 'Clover Merchant',
    merchantIdMasked: status.merchantIdMasked,
    environment: status.environment,
    address: addressParts.join(', ') || 'Merchant address unavailable',
    currency: merchant.properties?.defaultCurrency || 'USD',
    timezone: merchant.properties?.timezone || 'Pacific/Honolulu',
    categories,
    taxRates,
    tags,
    permissions: {
      merchantRead: merchantRes.status === 'fulfilled',
      inventoryRead: categoriesRes.status === 'fulfilled',
      ordersRead: ordersProbe.status === 'fulfilled',
    },
    checkedAt: new Date().toISOString(),
  };
}

export async function createCloverCategory(name: string): Promise<CloverCategorySummary> {
  const cleanName = name.trim().slice(0, 127);
  if (!cleanName) {
    throw new Error('Category name is required.');
  }
  const created = await cloverRequest<{ id: string; name?: string; sortOrder?: number }>(
    '/categories',
    {
      method: 'POST',
      body: JSON.stringify({ name: cleanName }),
    }
  );
  return {
    id: created.id,
    name: created.name || cleanName,
    sortOrder: created.sortOrder,
  };
}

export async function fetchCloverInventory(): Promise<{
  items: CanonicalItem[];
  needsNameFixCount: number;
  missingCostCount: number;
  fetchedAt: string;
}> {
  const allRaw: CloverRawItem[] = [];
  const pageSize = 100;
  const maxPages = 20;

  for (let page = 0; page < maxPages; page += 1) {
    const offset = page * pageSize;
    const data = await cloverRequest<{ elements?: CloverRawItem[] }>(
      `/items?expand=categories,itemStock&limit=${pageSize}&offset=${offset}`
    );
    const batch = Array.isArray(data.elements) ? data.elements : [];
    for (const raw of batch) {
      if (!raw.deleted) {
        allRaw.push(raw);
      }
    }
    if (batch.length < pageSize) break;
  }

  const items = allRaw.map(mapCloverItemToCanonical);
  const needsNameFixCount = items.filter((i) => i.name !== i.normalized_name).length;
  const missingCostCount = items.filter((i) => i.cost === null).length;

  return {
    items,
    needsNameFixCount,
    missingCostCount,
    fetchedAt: new Date().toISOString(),
  };
}

export async function createItemInClover(
  item: CanonicalItem
): Promise<CloverPushItemResult> {
  const payload = buildCloverItemUpdatePayload(item);
  try {
    const created = await cloverRequest<{ id: string; name?: string }>('/items', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (created.id && Number.isFinite(item.quantity) && item.quantity >= 0) {
      await cloverRequest(`/item_stocks/${encodeURIComponent(created.id)}`, {
        method: 'POST',
        body: JSON.stringify({ quantity: Math.round(item.quantity) }),
      }).catch(() => {});
    }

    return {
      clover_id: created.id,
      normalized_name: created.name || payload.name,
      ok: true,
      created: true,
    };
  } catch (err) {
    return {
      clover_id: item.clover_id,
      normalized_name: payload.name,
      ok: false,
      error: err instanceof Error ? err.message : 'Unable to create item in Clover POS.',
    };
  }
}

export async function pushItemsToClover(
  items: CanonicalItem[],
  options?: { syncStock?: boolean; createIfDraft?: boolean }
): Promise<{
  updatedCount: number;
  failedCount: number;
  results: CloverPushItemResult[];
}> {
  const results: CloverPushItemResult[] = [];
  let updatedCount = 0;
  let failedCount = 0;

  const bounded = items.slice(0, 50);

  for (const item of bounded) {
    const id = (item.clover_id || '').trim();
    const isLocalDraft =
      id.startsWith('DRAFT-') || id.startsWith('IMP-') || id.startsWith('CLV-');

    if (isLocalDraft && options?.createIfDraft) {
      const createdRes = await createItemInClover(item);
      if (createdRes.ok) updatedCount += 1;
      else failedCount += 1;
      results.push(createdRes);
      continue;
    }

    if (!isValidCloverItemId(id)) {
      failedCount += 1;
      results.push({
        clover_id: id || 'INVALID',
        normalized_name: item.normalized_name,
        ok: false,
        error: 'Invalid Clover item ID.',
      });
      continue;
    }

    try {
      const payload = buildCloverItemUpdatePayload(item);
      await cloverRequest(`/items/${encodeURIComponent(id)}`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (options?.syncStock && Number.isFinite(item.quantity) && item.quantity >= 0) {
        await cloverRequest(`/item_stocks/${encodeURIComponent(id)}`, {
          method: 'POST',
          body: JSON.stringify({ quantity: Math.round(item.quantity) }),
        });
      }

      updatedCount += 1;
      results.push({
        clover_id: id,
        normalized_name: payload.name,
        ok: true,
      });
    } catch (err) {
      failedCount += 1;
      results.push({
        clover_id: id,
        normalized_name: item.normalized_name,
        ok: false,
        error: err instanceof Error ? err.message : 'Clover update failed.',
      });
    }
  }

  return { updatedCount, failedCount, results };
}

export async function fetchCloverSales(days = 30): Promise<{
  salesRows: SalesImportRow[];
  orderCount: number;
  metrics: CloverSalesMetrics;
  fetchedAt: string;
}> {
  const safeDays = Math.min(90, Math.max(1, Math.round(days)));
  const sinceMs = Date.now() - safeDays * 24 * 60 * 60 * 1000;

  const data = await cloverRequest<{
    elements?: Array<{
      id: string;
      total?: number;
      state?: string;
      payments?: { elements?: Array<{ amount?: number; taxAmount?: number }> };
      discounts?: { elements?: Array<{ amount?: number }> };
      lineItems?: {
        elements?: Array<{
          item?: { id?: string };
          name?: string;
          price?: number;
          unitQty?: number;
        }>;
      };
    }>;
  }>(`/orders?expand=lineItems,payments,discounts&filter=createdTime>=${sinceMs}&limit=250`);

  const orders = Array.isArray(data.elements) ? data.elements : [];
  const agg = new Map<
    string,
    { cloverId: string | null; name: string; units: number; grossCents: number }
  >();

  let totalGrossCents = 0;
  let totalTaxCents = 0;
  let totalDiscountCents = 0;

  for (const order of orders) {
    if (typeof order.total === 'number' && order.total > 0) {
      totalGrossCents += order.total;
    }
    for (const p of order.payments?.elements ?? []) {
      if (typeof p.taxAmount === 'number' && p.taxAmount > 0) {
        totalTaxCents += p.taxAmount;
      }
    }
    for (const d of order.discounts?.elements ?? []) {
      if (typeof d.amount === 'number') {
        totalDiscountCents += Math.abs(d.amount);
      }
    }

    const lines = order.lineItems?.elements ?? [];
    for (const line of lines) {
      const itemId = line.item?.id || null;
      const rawName = (line.name || 'Unnamed Item').trim();
      const key = itemId || rawName.toLowerCase();
      const qty =
        typeof line.unitQty === 'number' && line.unitQty > 0
          ? Math.max(1, Math.round(line.unitQty / 1000))
          : 1;
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
  const totalTax = Math.round(totalTaxCents) / 100;
  const totalDiscounts = Math.round(totalDiscountCents) / 100;
  const avgOrderValue =
    orders.length > 0 ? Math.round((totalGross / orders.length) * 100) / 100 : 0;

  return {
    salesRows,
    orderCount: orders.length,
    metrics: {
      orderCount: orders.length,
      totalGross,
      totalTax,
      totalDiscounts,
      avgOrderValue,
      windowDays: safeDays,
    },
    fetchedAt: new Date().toISOString(),
  };
}
