import { useSyncExternalStore } from 'react';
import {
  CanonicalItem,
  CloverCategorySummary,
  CloverMerchantOverview,
  CloverPushItemResult,
  CloverPushResponse,
  CloverStatusResponse,
  CloverSyncInventoryResponse,
  CloverSyncSalesResponse,
} from '../types/inventory';
import { ApiError } from './apiError';

export type CloverSyncLifecycleState =
  | 'idle'
  | 'checking'
  | 'syncing'
  | 'synced'
  | 'unconfigured'
  | 'error';

export interface CloverSyncStatusSnapshot {
  state: CloverSyncLifecycleState;
  configured: boolean;
  environment: 'production' | 'sandbox';
  merchantIdMasked: string | null;
  lastAction: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  inFlightCount: number;
}

export interface CreateCloverServiceOptions {
  /** Base URL for live deployments (e.g. https://inventory.777liquor.com). Leave empty for same-origin proxy. */
  baseUrl?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export type CloverQueryParams = Record<string, string | number | boolean | undefined | null>;

const INITIAL_SYNC_STATUS: CloverSyncStatusSnapshot = {
  state: 'idle',
  configured: false,
  environment: 'production',
  merchantIdMasked: null,
  lastAction: null,
  lastSyncedAt: null,
  lastError: null,
  inFlightCount: 0,
};

function readCloverProxyBaseUrl(): string {
  const useMock =
    typeof import.meta !== 'undefined' && import.meta.env
      ? String(import.meta.env.VITE_USE_MOCK_API ?? 'true').toLowerCase() !== 'false'
      : true;

  // In AI Studio preview / local Express server mode, always call same-origin /api/clover/* proxy
  if (useMock) return '';

  const raw =
    typeof import.meta !== 'undefined' && import.meta.env
      ? import.meta.env.VITE_API_BASE_URL
      : undefined;
  return (raw || '').replace(/\/+$/, '');
}

export function buildCloverResourcePath(
  resourcePath: string,
  query?: CloverQueryParams
): string {
  const trimmed = resourcePath.trim();
  const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  if (!query) return normalized;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && String(value).length > 0) {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  if (!qs) return normalized;
  return normalized.includes('?') ? `${normalized}&${qs}` : `${normalized}?${qs}`;
}

/**
 * Clover REST API v3 client bridge service layer.
 *
 * All credentials (CLOVER_MERCHANT_ID, CLOVER_API_TOKEN) remain strictly on the
 * server / Cloudflare Worker proxy and are never exposed in browser bundles.
 * Supports both GET and POST operations and broadcasts reactive sync state
 * for UI sync status indicators.
 */
export function createCloverService(options: CreateCloverServiceOptions = {}) {
  const baseUrl = (options.baseUrl ?? readCloverProxyBaseUrl()).replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? 20_000;
  const fetchImpl = options.fetchFn ?? globalThis.fetch.bind(globalThis);

  let syncStatus: CloverSyncStatusSnapshot = { ...INITIAL_SYNC_STATUS };
  const listeners = new Set<() => void>();

  function emitStatus(patch: Partial<CloverSyncStatusSnapshot>) {
    syncStatus = { ...syncStatus, ...patch };
    for (const listener of listeners) {
      listener();
    }
  }

  function buildUrl(apiPath: string): string {
    const clean = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
    return baseUrl ? `${baseUrl}${clean}` : clean;
  }

  async function requestBridge<T>(
    method: 'GET' | 'POST',
    apiPath: string,
    body?: unknown
  ): Promise<T> {
    const controller = new AbortController();
    const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (method === 'POST') {
      headers['Content-Type'] = 'application/json';
    }

    let response: Response;
    try {
      response = await fetchImpl(buildUrl(apiPath), {
        method,
        credentials: 'include',
        headers,
        body: method === 'POST' && body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      if (timer) clearTimeout(timer);
      const isAbort = err instanceof Error && err.name === 'AbortError';
      throw new ApiError(
        isAbort
          ? 'Clover REST API request timed out. Please try again.'
          : 'Unable to reach the Clover bridge proxy.',
        { status: isAbort ? 408 : 0, code: isAbort ? 'TIMEOUT' : 'NETWORK_ERROR', cause: err }
      );
    } finally {
      if (timer) clearTimeout(timer);
    }

    if (!response.ok) {
      let message = `Clover bridge request failed (${response.status})`;
      let code: string | undefined;
      try {
        const errBody = (await response.json()) as {
          message?: string;
          error?: string;
          code?: string;
        };
        message = errBody.message || errBody.error || message;
        code = errBody.code || errBody.error;
      } catch {
        // Keep HTTP status fallback
      }
      throw new ApiError(message, { status: response.status, code });
    }

    return (await response.json()) as T;
  }

  async function runTrackedOperation<T>(
    mode: 'checking' | 'syncing',
    fn: () => Promise<T>,
    onSuccess: (result: T) => Partial<CloverSyncStatusSnapshot>
  ): Promise<T> {
    const nextInFlight = syncStatus.inFlightCount + 1;
    emitStatus({
      state: mode,
      inFlightCount: nextInFlight,
      lastError: null,
    });

    try {
      const result = await fn();
      const remaining = Math.max(0, syncStatus.inFlightCount - 1);
      emitStatus({
        inFlightCount: remaining,
        lastError: null,
        ...onSuccess(result),
      });
      return result;
    } catch (err) {
      const remaining = Math.max(0, syncStatus.inFlightCount - 1);
      const msg = err instanceof Error ? err.message : 'Clover sync operation failed.';
      emitStatus({
        state: 'error',
        inFlightCount: remaining,
        lastError: msg,
      });
      throw err;
    }
  }

  return {
    /** Returns the current Clover bridge sync status snapshot. */
    getSyncStatus(): CloverSyncStatusSnapshot {
      return syncStatus;
    },

    /** Subscribes to live sync status updates (compatible with React useSyncExternalStore). */
    subscribeSyncStatus(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    /** Generic allowlisted Clover REST API v3 GET operation (e.g. "/items", { limit: 100 }). */
    async get<T = unknown>(resourcePath: string, query?: CloverQueryParams): Promise<T> {
      const fullResourcePath = buildCloverResourcePath(resourcePath, query);
      return runTrackedOperation(
        'syncing',
        () =>
          requestBridge<T>(
            'GET',
            `/api/clover/v3?path=${encodeURIComponent(fullResourcePath)}`
          ),
        () => ({
          state: 'synced',
          configured: true,
          lastAction: `GET ${resourcePath}`,
          lastSyncedAt: new Date().toISOString(),
        })
      );
    },

    /** Generic allowlisted Clover REST API v3 POST operation (e.g. "/items/{id}", payload). */
    async post<T = unknown>(resourcePath: string, body?: unknown): Promise<T> {
      const fullResourcePath = buildCloverResourcePath(resourcePath);
      return runTrackedOperation(
        'syncing',
        () =>
          requestBridge<T>('POST', '/api/clover/v3', {
            path: fullResourcePath,
            body,
          }),
        () => ({
          state: 'synced',
          configured: true,
          lastAction: `POST ${resourcePath}`,
          lastSyncedAt: new Date().toISOString(),
        })
      );
    },

    /** Checks whether server-side Clover REST API v3 credentials are configured. */
    async getStatus(): Promise<CloverStatusResponse> {
      return runTrackedOperation(
        'checking',
        () => requestBridge<CloverStatusResponse>('GET', '/api/clover/status'),
        (res) => ({
          configured: res.configured,
          environment: res.environment,
          merchantIdMasked: res.merchantIdMasked,
          state: res.configured
            ? syncStatus.lastSyncedAt
              ? 'synced'
              : 'idle'
            : 'unconfigured',
        })
      );
    },

    /** GET merchant profile, permissions, categories, tax rates, and tags from Clover v3. */
    async getMerchantOverview(): Promise<CloverMerchantOverview> {
      return runTrackedOperation(
        'syncing',
        () => requestBridge<CloverMerchantOverview>('GET', '/api/clover/merchant-overview'),
        (res) => ({
          state: 'synced',
          configured: true,
          environment: res.environment,
          merchantIdMasked: res.merchantIdMasked,
          lastAction: `Connected to ${res.merchantName}`,
          lastSyncedAt: res.checkedAt || new Date().toISOString(),
        })
      );
    },

    /** POST pull live inventory from Clover v3 and apply store normalization + HI-5 rules. */
    async pullInventory(): Promise<CloverSyncInventoryResponse> {
      return runTrackedOperation(
        'syncing',
        () => requestBridge<CloverSyncInventoryResponse>('POST', '/api/clover/sync-inventory'),
        (res) => ({
          state: 'synced',
          configured: true,
          lastAction: `Pulled ${res.items.length} Clover SKUs`,
          lastSyncedAt: res.fetchedAt || new Date().toISOString(),
        })
      );
    },

    /** POST normalized item updates (and optional stock/draft creates) to Clover v3. */
    async pushItems(
      items: CanonicalItem[],
      pushOptions?: { syncStock?: boolean; createIfDraft?: boolean }
    ): Promise<CloverPushResponse> {
      return runTrackedOperation(
        'syncing',
        () =>
          requestBridge<CloverPushResponse>('POST', '/api/clover/push-items', {
            items,
            syncStock: Boolean(pushOptions?.syncStock),
            createIfDraft: Boolean(pushOptions?.createIfDraft),
          }),
        (res) => ({
          state: res.failedCount > 0 && res.updatedCount === 0 ? 'error' : 'synced',
          configured: true,
          lastAction: `Pushed ${res.updatedCount} SKU fix${res.updatedCount === 1 ? '' : 'es'}`,
          lastSyncedAt: new Date().toISOString(),
          lastError:
            res.failedCount > 0
              ? `${res.failedCount} item(s) could not be updated in Clover.`
              : null,
        })
      );
    },

    /** POST create a new item directly in Clover POS v3. */
    async createItem(item: CanonicalItem): Promise<CloverPushItemResult> {
      return runTrackedOperation(
        'syncing',
        () => requestBridge<CloverPushItemResult>('POST', '/api/clover/create-item', { item }),
        (res) => ({
          state: res.ok ? 'synced' : 'error',
          configured: true,
          lastAction: `Created ${res.normalized_name}`,
          lastSyncedAt: new Date().toISOString(),
          lastError: res.ok ? null : res.error || 'Failed to create item in Clover.',
        })
      );
    },

    /** POST sync recent Clover orders & sales metrics into Sales Analytics. */
    async syncSales(days = 30): Promise<CloverSyncSalesResponse> {
      return runTrackedOperation(
        'syncing',
        () => requestBridge<CloverSyncSalesResponse>('POST', '/api/clover/sync-sales', { days }),
        (res) => ({
          state: 'synced',
          configured: true,
          lastAction: `Synced ${res.orderCount} orders (${days}d)`,
          lastSyncedAt: res.fetchedAt || new Date().toISOString(),
        })
      );
    },

    /** POST create a new category directly in Clover POS v3. */
    async createCategory(name: string): Promise<CloverCategorySummary> {
      return runTrackedOperation(
        'syncing',
        () => requestBridge<CloverCategorySummary>('POST', '/api/clover/categories', { name }),
        (res) => ({
          state: 'synced',
          configured: true,
          lastAction: `Added category "${res.name}"`,
          lastSyncedAt: new Date().toISOString(),
        })
      );
    },
  };
}

export const cloverService = createCloverService();

/**
 * React hook returning the live Clover REST API v3 bridge sync status.
 */
export function useCloverSyncStatus(): CloverSyncStatusSnapshot {
  return useSyncExternalStore(
    cloverService.subscribeSyncStatus,
    cloverService.getSyncStatus,
    cloverService.getSyncStatus
  );
}
