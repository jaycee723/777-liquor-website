import {
  AnalyticsSummaryResponse,
  AuthUser,
  BulkPatchPayload,
  CanonicalItem,
  CloverCategorySummary,
  CloverMerchantOverview,
  CloverPushItemResult,
  CloverPushResponse,
  CloverStatusResponse,
  CloverSyncInventoryResponse,
  CloverSyncSalesResponse,
  CoolerDoorPushResponse,
  EnrichJobQueuedResponse,
  EnrichJobStatusResponse,
  EnrichLookupType,
  EnrichRequest,
  EnrichResponse,
  EnrichmentApplyResult,
  ImportRequest,
  ImportResponse,
  InvoiceOcrResponse,
  ItemsQueryParams,
  ItemsResponse,
  LabelTemplate,
  PatchItemPayload,
  PricingApplyRequest,
  PricingApplyResponse,
  PricingSuggestionsResponse,
  ProductSuggestion,
  ServerHealthResponse,
  ToastExportResponse,
} from '../types/inventory';
import { mockEngine } from '../api/mockEngine';
import {
  computeEnrichmentFlagResolution,
  normalizeContractUpdatesToProposals,
} from '../utils/enrichmentPricingRules';
import { ApiError, ApiErrorOptions } from './apiError';
import { cloverService } from './cloverService';

export { ApiError };
export type { ApiErrorOptions };

export interface EnrichActionOptions {
  customQuery?: string;
  brandWebsite?: string;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
  onJobProgress?: (job: EnrichJobStatusResponse) => void;
}

export interface ApiClientConfig {
  useMockApi: boolean;
  baseUrl: string;
  timeoutMs: number;
}

export interface TokenStorage {
  getToken(): string | null;
  setToken(token: string | null): void;
}

const AUTH_TOKEN_STORAGE_KEY = '777_inventory_auth_token_v1';

function createBrowserTokenStorage(): TokenStorage {
  let memoryToken: string | null = null;

  return {
    getToken(): string | null {
      if (memoryToken) return memoryToken;
      try {
        if (typeof window !== 'undefined' && window.sessionStorage) {
          memoryToken = window.sessionStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
          return memoryToken;
        }
      } catch {
        // Ignore restricted storage environments
      }
      return memoryToken;
    },
    setToken(token: string | null): void {
      memoryToken = token && token.trim().length > 0 ? token.trim() : null;
      try {
        if (typeof window !== 'undefined' && window.sessionStorage) {
          if (memoryToken) {
            window.sessionStorage.setItem(AUTH_TOKEN_STORAGE_KEY, memoryToken);
          } else {
            window.sessionStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
          }
        }
      } catch {
        // Ignore restricted storage environments
      }
    },
  };
}

export function buildItemsQueryString(query: ItemsQueryParams): string {
  const params = new URLSearchParams();
  if (query.search) params.set('search', query.search);
  if (query.category) params.set('category', query.category);
  if (query.vendor) params.set('vendor', query.vendor);
  if (query.brand) params.set('brand', query.brand);
  if (query.hasCost && query.hasCost !== 'all') params.set('has_cost', query.hasCost);
  if (query.hasLogo && query.hasLogo !== 'all') params.set('has_logo', query.hasLogo);
  if (query.flag) params.set('flags', query.flag);
  if (query.sort) params.set('sort', query.sort);
  if (query.page) params.set('page', String(query.page));
  if (query.pageSize) params.set('page_size', String(query.pageSize));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

function readEnvFlag(): boolean {
  const raw =
    typeof import.meta !== 'undefined' && import.meta.env
      ? import.meta.env.VITE_USE_MOCK_API
      : undefined;
  return String(raw ?? 'true').toLowerCase() !== 'false';
}

function readEnvBaseUrl(): string {
  const raw =
    typeof import.meta !== 'undefined' && import.meta.env
      ? import.meta.env.VITE_API_BASE_URL
      : undefined;
  return (raw || 'https://inventory.777liquor.com').replace(/\/+$/, '');
}

type MockRepository = Pick<
  typeof mockEngine,
  | 'login'
  | 'getAllItemsRaw'
  | 'getItems'
  | 'patchItem'
  | 'bulkPatchItems'
  | 'importData'
  | 'extractInvoiceOcr'
  | 'getAnalyticsSummary'
  | 'resetDemoData'
> &
  Partial<
    Pick<
      typeof mockEngine,
      | 'enrichItem'
      | 'getPricingSuggestions'
      | 'applyPricing'
      | 'invalidatePricingPreviewToken'
      | 'loadSampleSalesExport'
      | 'getProductSuggestions'
      | 'createDraftItemFromSuggestion'
      | 'exportToastCatalog'
      | 'exportFullCatalogSpreadsheet'
      | 'previewCoolerDoorCatalog'
      | 'pushCoolerDoor'
      | 'getLastCoolerDoorPush'
    >
  >;

export interface CreateApiClientOptions {
  useMockApi?: boolean;
  baseUrl?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  tokenStorage?: TokenStorage;
  mockRepo?: MockRepository;
  onUnauthorized?: (error: ApiError) => void;
}

interface LiveLoginResponse extends AuthUser {
  token?: string;
  access_token?: string;
  user?: AuthUser;
}

function normalizeHeaders(input?: HeadersInit): Record<string, string> {
  const result: Record<string, string> = {};
  if (!input) return result;
  if (input instanceof Headers) {
    input.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }
  if (Array.isArray(input)) {
    for (const [key, value] of input) {
      result[key] = value;
    }
    return result;
  }
  return { ...input };
}

export function createApiClient(options: CreateApiClientOptions = {}) {
  const config: ApiClientConfig = {
    useMockApi: options.useMockApi ?? readEnvFlag(),
    baseUrl: (options.baseUrl ?? readEnvBaseUrl()).replace(/\/+$/, ''),
    timeoutMs: options.timeoutMs ?? 20_000,
  };

  const fetchImpl = options.fetchFn ?? globalThis.fetch.bind(globalThis);
  const tokenStorage = options.tokenStorage ?? createBrowserTokenStorage();
  const mockRepo = options.mockRepo ?? mockEngine;
  let unauthorizedHandler = options.onUnauthorized;

  function buildUrl(path: string): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return config.baseUrl ? `${config.baseUrl}${normalizedPath}` : normalizedPath;
  }

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...normalizeHeaders(init.headers),
    };

    if (!isFormData && !headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/json';
    }

    const token = tokenStorage.getToken();
    if (token && !headers.Authorization && !headers.authorization) {
      headers.Authorization = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timeoutId =
      config.timeoutMs > 0
        ? setTimeout(() => controller.abort(), config.timeoutMs)
        : null;

    let response: Response;
    try {
      response = await fetchImpl(buildUrl(path), {
        ...init,
        credentials: 'include',
        headers,
        signal: init.signal ?? controller.signal,
      });
    } catch (err) {
      if (timeoutId) clearTimeout(timeoutId);
      const isAbort = err instanceof Error && err.name === 'AbortError';
      throw new ApiError(
        isAbort
          ? 'The server took too long to respond. Please try again.'
          : 'Unable to reach the inventory server. Check your network connection or API base URL.',
        {
          status: isAbort ? 408 : 0,
          code: isAbort ? 'TIMEOUT' : 'NETWORK_ERROR',
          cause: err,
        }
      );
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }

    if (!response.ok) {
      let message = `Request failed (${response.status})`;
      let code: string | undefined;
      let details: unknown;

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        try {
          const body = (await response.json()) as {
            error?: string;
            message?: string;
            code?: string;
            details?: unknown;
          };
          message = body.error || body.message || message;
          code = body.code;
          details = body.details ?? body;
        } catch {
          // Keep status message when JSON body is malformed
        }
      } else {
        try {
          const text = (await response.text()).trim();
          if (text && !text.startsWith('<')) {
            message = text.slice(0, 200);
          }
        } catch {
          // Keep default status message
        }
      }

      const apiError = new ApiError(message, {
        status: response.status,
        code,
        details,
      });

      if (apiError.isUnauthorized) {
        tokenStorage.setToken(null);
        unauthorizedHandler?.(apiError);
      }

      throw apiError;
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return (await response.json()) as T;
    }

    const rawText = await response.text();
    if (!rawText) return undefined as T;
    try {
      return JSON.parse(rawText) as T;
    } catch {
      return rawText as unknown as T;
    }
  }

  return {
    config,

    getAuthToken(): string | null {
      return tokenStorage.getToken();
    },

    setAuthToken(token: string | null): void {
      tokenStorage.setToken(token);
    },

    setUnauthorizedHandler(handler: ((error: ApiError) => void) | undefined): void {
      unauthorizedHandler = handler;
    },

    request,

    async login(email: string, passcode: string): Promise<AuthUser> {
      if (config.useMockApi) {
        return mockRepo.login(email, passcode);
      }

      const res = await request<LiveLoginResponse>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, passcode }),
      });

      const bearer = res.token ?? res.access_token ?? null;
      if (bearer) {
        tokenStorage.setToken(bearer);
      }

      return res.user ?? {
        email: res.email,
        name: res.name,
        role: res.role,
        storeName: res.storeName,
        storeAddress: res.storeAddress,
      };
    },

    async logout(): Promise<void> {
      tokenStorage.setToken(null);
      if (config.useMockApi) {
        return;
      }
      try {
        await request<void>('/api/auth/logout', { method: 'POST' });
      } catch {
        // Best-effort server logout; client token is already cleared
      }
    },

    async getAllItemsForMatching(): Promise<CanonicalItem[]> {
      if (config.useMockApi) {
        return mockRepo.getAllItemsRaw();
      }
      const res = await request<ItemsResponse>('/api/items?page=1&page_size=2000');
      return res.items;
    },

    async getItems(query: ItemsQueryParams = {}): Promise<ItemsResponse> {
      if (config.useMockApi) {
        return mockRepo.getItems(query);
      }
      return request<ItemsResponse>(`/api/items${buildItemsQueryString(query)}`);
    },

    async patchItem(cloverId: string, patch: PatchItemPayload): Promise<CanonicalItem> {
      const updated = config.useMockApi
        ? await mockRepo.patchItem(cloverId, patch)
        : await request<CanonicalItem>(`/api/items/${encodeURIComponent(cloverId)}`, {
            method: 'PATCH',
            body: JSON.stringify(patch),
          });

      if (typeof window !== 'undefined') {
        void import('./firestoreSync')
          .then(({ upsertFirestoreInventoryItems }) => upsertFirestoreInventoryItems([updated]))
          .catch(() => {});
      }
      return updated;
    },

    async bulkPatchItems(payload: BulkPatchPayload): Promise<{ updatedCount: number }> {
      if (config.useMockApi) {
        return mockRepo.bulkPatchItems(payload);
      }
      let updatedCount = 0;
      for (const id of payload.ids) {
        await request<CanonicalItem>(`/api/items/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: JSON.stringify(payload.patch),
        });
        updatedCount += 1;
      }
      return { updatedCount };
    },

    async importData(payload: ImportRequest): Promise<ImportResponse> {
      if (config.useMockApi) {
        return mockRepo.importData(payload);
      }
      return request<ImportResponse>('/api/import', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },

    async extractInvoiceOcr(
      input: { sampleId: string } | { file: File }
    ): Promise<InvoiceOcrResponse> {
      if (config.useMockApi) {
        return mockRepo.extractInvoiceOcr(input);
      }
      if ('file' in input) {
        const formData = new FormData();
        formData.append('file', input.file);
        return request<InvoiceOcrResponse>('/api/import?mode=invoice-ocr', {
          method: 'POST',
          body: formData,
        });
      }
      throw new ApiError('Sample invoices are only available in mock mode.', {
        status: 400,
        code: 'MOCK_ONLY_ACTION',
      });
    },

    async getAnalyticsSummary(): Promise<AnalyticsSummaryResponse> {
      if (config.useMockApi) {
        return mockRepo.getAnalyticsSummary();
      }
      return request<AnalyticsSummaryResponse>('/api/analytics/summary');
    },

    async checkServerHealth(): Promise<ServerHealthResponse> {
      const targetUrl = config.useMockApi ? '/api/health' : buildUrl('/api/health');
      const res = await fetchImpl(targetUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        throw new ApiError('Health check failed.', { status: res.status });
      }
      return (await res.json()) as ServerHealthResponse;
    },

    // Phase 3: Contract-Aligned Enrichment Endpoints (POST /api/enrich + GET /api/enrich/:job_id + live Express routes)
    async startEnrichmentJob(payload: {
      item_ids: string[];
      tasks: EnrichLookupType[];
      item?: Partial<CanonicalItem>;
      customQuery?: string;
      brandWebsite?: string;
      async?: boolean;
    }): Promise<EnrichJobQueuedResponse | EnrichResponse> {
      const body: Record<string, unknown> = {
        item_ids: payload.item_ids,
        tasks: payload.tasks,
      };
      if (payload.item_ids[0]) body.clover_id = payload.item_ids[0];
      if (payload.item) body.item = payload.item;
      if (payload.customQuery) body.customQuery = payload.customQuery;
      if (payload.brandWebsite) body.brandWebsite = payload.brandWebsite;
      if (payload.async !== undefined) body.async = payload.async;

      if (config.useMockApi) {
        const res = await fetchImpl('/api/enrich', {
          method: 'POST',
          credentials: 'include',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          let message = `Online enrichment failed (${res.status})`;
          try {
            const errBody = (await res.json()) as { message?: string; error?: string };
            message = errBody.message || errBody.error || message;
          } catch {
            // keep status message
          }
          throw new ApiError(message, { status: res.status });
        }
        return (await res.json()) as EnrichJobQueuedResponse | EnrichResponse;
      }

      return request<EnrichJobQueuedResponse | EnrichResponse>('/api/enrich', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },

    async getEnrichmentJob(jobId: string): Promise<EnrichJobStatusResponse> {
      const encoded = encodeURIComponent(jobId);
      if (config.useMockApi) {
        const res = await fetchImpl(`/api/enrich/${encoded}`, {
          method: 'GET',
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) {
          throw new ApiError(`Failed to check enrichment job ${jobId}.`, { status: res.status });
        }
        return (await res.json()) as EnrichJobStatusResponse;
      }
      return request<EnrichJobStatusResponse>(`/api/enrich/${encoded}`);
    },

    async runLiveEnrichEndpoint(
      endpoint:
        | '/api/enrich/upc'
        | '/api/enrich/media'
        | '/api/enrich/vendor-price'
        | '/api/enrich/gemini-context'
        | '/api/enrich/run-all',
      payload: EnrichRequest
    ): Promise<EnrichResponse> {
      const url = config.useMockApi ? endpoint : buildUrl(endpoint);
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      };
      const token = tokenStorage.getToken();
      if (token && !config.useMockApi) {
        headers.Authorization = `Bearer ${token}`;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30_000);
      try {
        const response = await fetchImpl(url, {
          method: 'POST',
          credentials: 'include',
          headers,
          body: JSON.stringify({
            item_ids: [payload.clover_id],
            clover_id: payload.clover_id,
            tasks: payload.lookupTypes,
            item: payload.item,
            customQuery: payload.customQuery,
            brandWebsite: payload.brandWebsite,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          let message = `Online enrichment failed (${response.status})`;
          try {
            const errBody = (await response.json()) as { message?: string; error?: string };
            message = errBody.message || errBody.error || message;
          } catch {
            // keep status message
          }
          throw new ApiError(message, { status: response.status });
        }

        const data = (await response.json()) as EnrichResponse;
        if ((!data.proposals || data.proposals.length === 0) && data.updates?.length) {
          return {
            ...data,
            proposals: normalizeContractUpdatesToProposals(data.updates, payload.clover_id),
          };
        }
        return data;
      } catch (err) {
        if (err instanceof ApiError) throw err;
        const isAbort = err instanceof Error && err.name === 'AbortError';
        throw new ApiError(
          isAbort
            ? 'Online enrichment timed out. Try a more specific search query or single lookup.'
            : 'Unable to reach the online enrichment service.',
          { status: isAbort ? 408 : 0, cause: err }
        );
      } finally {
        clearTimeout(timeoutId);
      }
    },

    async enrichItem(
      payload: EnrichRequest,
      options: EnrichActionOptions = {}
    ): Promise<EnrichResponse> {
      const mergedPayload: EnrichRequest = {
        ...payload,
        customQuery: options.customQuery ?? payload.customQuery,
        brandWebsite: options.brandWebsite ?? payload.brandWebsite,
      };

      // LIVE Worker mode: strictly follow docs/API_CONTRACTS.md (POST /api/enrich -> 202 job_id -> poll GET /api/enrich/:job_id)
      if (!config.useMockApi) {
        const started = await this.startEnrichmentJob({
          item_ids: [mergedPayload.clover_id],
          tasks: mergedPayload.lookupTypes,
          item: mergedPayload.item,
          customQuery: mergedPayload.customQuery,
          brandWebsite: mergedPayload.brandWebsite,
        });

        // Direct synchronous response fallback if server returns proposals/updates immediately
        if ('proposals' in started && Array.isArray(started.proposals)) {
          return started;
        }
        if ('updates' in started && Array.isArray((started as EnrichResponse).updates)) {
          const direct = started as EnrichResponse;
          return {
            ...direct,
            clover_id: mergedPayload.clover_id,
            proposals: normalizeContractUpdatesToProposals(
              direct.updates ?? [],
              mergedPayload.clover_id
            ),
          };
        }

        const jobId = (started as EnrichJobQueuedResponse).job_id;
        if (!jobId) {
          return { clover_id: mergedPayload.clover_id, proposals: [] };
        }

        const pollIntervalMs = options.pollIntervalMs ?? 350;
        const maxPollAttempts = options.maxPollAttempts ?? 40;

        for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
          const job = await this.getEnrichmentJob(jobId);
          options.onJobProgress?.(job);

          if (job.status === 'failed') {
            throw new ApiError(job.error || 'Enrichment job failed on the server.', {
              status: 502,
              code: 'ENRICH_JOB_FAILED',
            });
          }

          if (job.status === 'done') {
            const proposals =
              job.proposals && job.proposals.length > 0
                ? job.proposals
                : normalizeContractUpdatesToProposals(job.updates ?? [], mergedPayload.clover_id);
            return {
              clover_id: mergedPayload.clover_id,
              job_id: jobId,
              proposals,
              updates: job.updates,
              sourcesChecked: job.sourcesChecked,
              citations: job.citations,
              marketReferences: job.marketReferences,
              notice: job.notice,
            };
          }

          if (pollIntervalMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
          }
        }

        throw new ApiError('Enrichment job timed out while waiting for server results.', {
          status: 408,
          code: 'ENRICH_JOB_TIMEOUT',
        });
      }

      // Mock catalog mode with item snapshot: invoke live Express server enrichment routes
      if (mergedPayload.item) {
        const types = mergedPayload.lookupTypes;
        let endpoint:
          | '/api/enrich/upc'
          | '/api/enrich/media'
          | '/api/enrich/vendor-price'
          | '/api/enrich/gemini-context'
          | '/api/enrich/run-all' = '/api/enrich/run-all';
        if (types.length === 1) {
          if (types[0] === 'upc_lookup') endpoint = '/api/enrich/upc';
          else if (types[0] === 'logo' || types[0] === 'image') endpoint = '/api/enrich/media';
          else if (types[0] === 'vendor_cost') endpoint = '/api/enrich/vendor-price';
          else if (types[0] === 'gemini_context') endpoint = '/api/enrich/gemini-context';
        } else if (types.length === 2 && types.includes('logo') && types.includes('image')) {
          endpoint = '/api/enrich/media';
        }
        return this.runLiveEnrichEndpoint(endpoint, mergedPayload);
      }

      if (!mockRepo.enrichItem) {
        throw new ApiError('Mock enrichment handler is unavailable.', { status: 501 });
      }
      return mockRepo.enrichItem(mergedPayload);
    },

    async fetchBrandLogo(
      item: CanonicalItem,
      options: EnrichActionOptions = {}
    ): Promise<EnrichResponse> {
      return this.enrichItem(
        { clover_id: item.clover_id, lookupTypes: ['logo'], item },
        options
      );
    },

    async fetchProductImage(
      item: CanonicalItem,
      options: EnrichActionOptions = {}
    ): Promise<EnrichResponse> {
      return this.enrichItem(
        { clover_id: item.clover_id, lookupTypes: ['image'], item },
        options
      );
    },

    async searchVendorPrice(
      item: CanonicalItem,
      options: EnrichActionOptions = {}
    ): Promise<EnrichResponse> {
      return this.enrichItem(
        { clover_id: item.clover_id, lookupTypes: ['vendor_cost'], item },
        options
      );
    },

    async lookupUpcProduct(
      item: CanonicalItem,
      options: EnrichActionOptions = {}
    ): Promise<EnrichResponse> {
      return this.enrichItem(
        { clover_id: item.clover_id, lookupTypes: ['upc_lookup'], item },
        options
      );
    },

    async analyzeItemContext(
      item: CanonicalItem,
      options: EnrichActionOptions = {}
    ): Promise<EnrichResponse> {
      return this.enrichItem(
        { clover_id: item.clover_id, lookupTypes: ['gemini_context'], item },
        options
      );
    },

    /**
     * Persists accepted enrichment updates via PATCH /api/items/:id and resolves
     * status flags (clearing NO_COST, NEED_PACK_CONFIG, HI5_CONFIRM, and optional REVIEW).
     */
    async applyEnrichmentUpdates(
      item: CanonicalItem,
      patch: PatchItemPayload,
      options?: { clearReviewFlag?: boolean }
    ): Promise<EnrichmentApplyResult> {
      const { patchWithFlags } = computeEnrichmentFlagResolution(item, patch, {
        clearReview: options?.clearReviewFlag,
      });
      const updated = await this.patchItem(item.clover_id, patchWithFlags);
      const clearedFlags = item.flags.filter((flag) => !updated.flags.includes(flag));
      const appliedFields = Object.keys(patch).filter(
        (key) => key !== 'flags'
      ) as Array<keyof CanonicalItem>;

      return {
        item: updated,
        appliedFields,
        clearedFlags,
        remainingFlags: updated.flags,
      };
    },

    async getPricingSuggestions(): Promise<PricingSuggestionsResponse> {
      if (config.useMockApi) {
        if (!mockRepo.getPricingSuggestions) {
          throw new ApiError('Mock pricing suggestions handler is unavailable.', { status: 501 });
        }
        return mockRepo.getPricingSuggestions();
      }
      return request<PricingSuggestionsResponse>('/api/pricing/suggestions');
    },

    async applyPricing(payload: PricingApplyRequest): Promise<PricingApplyResponse> {
      if (config.useMockApi) {
        if (!mockRepo.applyPricing) {
          throw new ApiError('Mock pricing apply handler is unavailable.', { status: 501 });
        }
        return mockRepo.applyPricing(payload);
      }
      return request<PricingApplyResponse>('/api/pricing/apply', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },

    async simulateStalePricingToken(): Promise<void> {
      if (config.useMockApi && mockRepo.invalidatePricingPreviewToken) {
        return mockRepo.invalidatePricingPreviewToken();
      }
    },

    // Phase 4: Sales Analytics, Product Suggestions, Toast Export & Cooler Door Push
    async loadSampleSalesExport(): Promise<AnalyticsSummaryResponse> {
      if (config.useMockApi) {
        if (!mockRepo.loadSampleSalesExport) {
          throw new ApiError('Sample sales import is unavailable.', { status: 501 });
        }
        return mockRepo.loadSampleSalesExport();
      }
      throw new ApiError('Sample sales export is only available in Mock mode.', {
        status: 400,
        code: 'MOCK_ONLY_ACTION',
      });
    },

    async getProductSuggestions(): Promise<ProductSuggestion[]> {
      if (config.useMockApi) {
        if (!mockRepo.getProductSuggestions) {
          throw new ApiError('Mock product suggestions handler is unavailable.', { status: 501 });
        }
        return mockRepo.getProductSuggestions();
      }
      return request<ProductSuggestion[]>('/api/suggestions/products');
    },

    async createDraftItemFromSuggestion(suggestion: ProductSuggestion): Promise<CanonicalItem> {
      if (config.useMockApi) {
        if (!mockRepo.createDraftItemFromSuggestion) {
          throw new ApiError('Mock draft creation handler is unavailable.', { status: 501 });
        }
        return mockRepo.createDraftItemFromSuggestion(suggestion);
      }
      return request<CanonicalItem>('/api/items', {
        method: 'POST',
        body: JSON.stringify({
          name: suggestion.name,
          brand: suggestion.brand,
          category: suggestion.category,
          subcategory: suggestion.subcategory ?? suggestion.category,
          vendor: suggestion.vendor,
          unit_size: suggestion.unit_size,
          sell_pack_qty: suggestion.sell_pack_qty,
          packs_per_case: suggestion.packs_per_case,
          cost: suggestion.estimated_cost,
          price: suggestion.estimated_retail,
          upc: suggestion.upc ?? '',
          quantity: 0,
          flags: ['REVIEW'],
        }),
      });
    },

    async exportToastCatalog(options?: {
      cloverIds?: string[];
      excludeFlagged?: boolean;
    }): Promise<ToastExportResponse> {
      if (config.useMockApi) {
        if (!mockRepo.exportToastCatalog) {
          throw new ApiError('Mock Toast Retail export handler is unavailable.', { status: 501 });
        }
        return mockRepo.exportToastCatalog(options);
      }
      return request<ToastExportResponse>('/api/export/toast', {
        method: 'POST',
        body: JSON.stringify({
          item_ids: options?.cloverIds ?? [],
          exclude_flagged: options?.excludeFlagged ?? false,
        }),
      });
    },

    async exportFullCatalogSpreadsheet(): Promise<{
      csv: string;
      filename: string;
      rowCount: number;
    }> {
      if (config.useMockApi) {
        if (!mockRepo.exportFullCatalogSpreadsheet) {
          throw new ApiError('Full spreadsheet export handler is unavailable.', { status: 501 });
        }
        return mockRepo.exportFullCatalogSpreadsheet();
      }
      return request<{ csv: string; filename: string; rowCount: number }>('/api/export/full', {
        method: 'POST',
      });
    },

    async previewCoolerDoorCatalog(): Promise<CoolerDoorPushResponse> {
      if (config.useMockApi) {
        if (!mockRepo.previewCoolerDoorCatalog) {
          throw new ApiError('Cooler Door preview handler is unavailable.', { status: 501 });
        }
        return mockRepo.previewCoolerDoorCatalog();
      }
      return request<CoolerDoorPushResponse>('/api/push/cooler-door?dry_run=1', {
        method: 'POST',
      });
    },

    async pushCoolerDoor(): Promise<CoolerDoorPushResponse> {
      if (config.useMockApi) {
        if (!mockRepo.pushCoolerDoor) {
          throw new ApiError('Cooler Door push handler is unavailable.', { status: 501 });
        }
        return mockRepo.pushCoolerDoor();
      }
      return request<CoolerDoorPushResponse>('/api/push/cooler-door', {
        method: 'POST',
      });
    },

    async getLastCoolerDoorPush(): Promise<CoolerDoorPushResponse | null> {
      if (config.useMockApi && mockRepo.getLastCoolerDoorPush) {
        return mockRepo.getLastCoolerDoorPush();
      }
      return null;
    },

    // Clover REST API v3 Server Proxy Endpoints (delegated to cloverService for reactive sync status)
    async getCloverStatus(): Promise<CloverStatusResponse> {
      return cloverService.getStatus();
    },

    async getCloverMerchantOverview(): Promise<CloverMerchantOverview> {
      return cloverService.getMerchantOverview();
    },

    async createCloverCategory(name: string): Promise<CloverCategorySummary> {
      return cloverService.createCategory(name);
    },

    async syncCloverInventory(): Promise<CloverSyncInventoryResponse> {
      return cloverService.pullInventory();
    },

    async createItemInClover(item: CanonicalItem): Promise<CloverPushItemResult> {
      return cloverService.createItem(item);
    },

    async pushItemsToClover(
      items: CanonicalItem[],
      options?: { syncStock?: boolean; createIfDraft?: boolean }
    ): Promise<CloverPushResponse> {
      return cloverService.pushItems(items, options);
    },

    async syncCloverSales(days = 30): Promise<CloverSyncSalesResponse> {
      return cloverService.syncSales(days);
    },

    async syncCatalogToFirestore(): Promise<number> {
      if (typeof window === 'undefined') return 0;
      const items = await this.getAllItemsForMatching();
      const { upsertFirestoreInventoryItems } = await import('./firestoreSync');
      return upsertFirestoreInventoryItems(items);
    },

    async getLabelTemplates(): Promise<LabelTemplate[]> {
      if (config.useMockApi) {
        throw new ApiError('Mock label templates are scheduled for Phase 5.', {
          status: 501,
          code: 'NOT_IMPLEMENTED',
        });
      }
      return request<LabelTemplate[]>('/api/label-templates');
    },

    async resetDemoData(): Promise<void> {
      if (config.useMockApi) {
        return mockRepo.resetDemoData();
      }
    },
  };
}

export const apiClient = createApiClient();
export const apiConfig = apiClient.config;
export const inventoryApi = apiClient;
