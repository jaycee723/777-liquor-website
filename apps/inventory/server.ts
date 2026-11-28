import 'dotenv/config';
import crypto from 'node:crypto';
import express, { Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  EnrichContractUpdate,
  EnrichJobStatusResponse,
  EnrichLookupType,
  EnrichResponse,
} from './src/types/inventory.ts';
import {
  OnlineEnrichInput,
  runOnlineEnrichment,
} from './server/enrichmentService.ts';
import {
  assertSafePublicUrl,
  parseAndValidateExternalUrl,
  sanitizeText,
  sanitizeUpc,
} from './server/security.ts';
import {
  createCloverCategory,
  createItemInClover,
  fetchCloverInventory,
  fetchCloverMerchantOverview,
  fetchCloverSales,
  getCloverRuntimeConfig,
  proxyCloverV3Request,
  pushItemsToClover,
  validateCloverV3ResourcePath,
} from './server/cloverService.ts';

const ENRICH_JOBS = new Map<string, EnrichJobStatusResponse>();
const MAX_STORED_JOBS = 100;

function toContractUpdates(result: EnrichResponse): EnrichContractUpdate[] {
  return result.proposals.map((p) => ({
    item_id: result.clover_id,
    field: p.field,
    old: p.currentValue,
    new: p.proposedValue,
    source: p.source,
    sourceUrl: p.sourceUrl,
    confidence: p.confidence,
    note: p.note,
  }));
}

function recordEnrichJob(job: EnrichJobStatusResponse): void {
  if (ENRICH_JOBS.size >= MAX_STORED_JOBS) {
    const oldestKey = ENRICH_JOBS.keys().next().value;
    if (oldestKey) ENRICH_JOBS.delete(oldestKey);
  }
  ENRICH_JOBS.set(job.job_id, job);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

const ALLOWED_TASKS = new Set<EnrichLookupType>([
  'upc_lookup',
  'logo',
  'image',
  'vendor_cost',
  'gemini_context',
]);

function parseEnrichRequestBody(
  body: unknown,
  defaultTasks: EnrichLookupType[]
): { ok: true; data: OnlineEnrichInput } | { ok: false; message: string } {
  if (!body || typeof body !== 'object') {
    return { ok: false, message: 'JSON body is required.' };
  }
  const raw = body as Record<string, unknown>;
  const rawItem = (raw.item && typeof raw.item === 'object' ? raw.item : raw) as Record<
    string,
    unknown
  >;

  const cloverId = sanitizeText(rawItem.clover_id ?? raw.clover_id ?? 'UNKNOWN', 64);
  const name = sanitizeText(rawItem.name ?? rawItem.normalized_name ?? '', 200);
  const normalizedName = sanitizeText(rawItem.normalized_name ?? name, 200);

  if (!name && !normalizedName && !sanitizeUpc(rawItem.upc)) {
    return { ok: false, message: 'Provide an item name or UPC barcode to run an online lookup.' };
  }

  const rawTasks = Array.isArray(raw.tasks)
    ? raw.tasks
    : Array.isArray(raw.lookupTypes)
      ? raw.lookupTypes
      : defaultTasks;

  const tasks = rawTasks.filter(
    (t): t is EnrichLookupType => typeof t === 'string' && ALLOWED_TASKS.has(t as EnrichLookupType)
  );

  const safeTasks = tasks.length > 0 ? tasks : defaultTasks;

  const parseOptionalNum = (val: unknown): number | null => {
    if (typeof val === 'number' && Number.isFinite(val)) return val;
    return null;
  };

  const hi5Raw = rawItem.hi5_eligible;
  const hi5Eligible =
    hi5Raw === 'Yes' || hi5Raw === 'No' || hi5Raw === 'Confirm' ? hi5Raw : 'No';

  return {
    ok: true,
    data: {
      item: {
        clover_id: cloverId || 'UNKNOWN',
        name: name || normalizedName,
        normalized_name: normalizedName || name,
        brand: sanitizeText(rawItem.brand ?? '', 100),
        category: sanitizeText(rawItem.category ?? 'Uncategorized', 60) || 'Uncategorized',
        subcategory: sanitizeText(rawItem.subcategory ?? '', 60),
        upc: sanitizeUpc(rawItem.upc),
        price: parseOptionalNum(rawItem.price) ?? 0,
        cost: parseOptionalNum(rawItem.cost),
        vendor: sanitizeText(rawItem.vendor ?? '', 100) || null,
        unit_size: sanitizeText(rawItem.unit_size ?? '', 40),
        sell_pack_qty: parseOptionalNum(rawItem.sell_pack_qty),
        packs_per_case: parseOptionalNum(rawItem.packs_per_case),
        hi5_eligible: hi5Eligible,
        logo_url: typeof rawItem.logo_url === 'string' ? rawItem.logo_url.slice(0, 1024) : null,
        image_url: typeof rawItem.image_url === 'string' ? rawItem.image_url.slice(0, 1024) : null,
      },
      tasks: safeTasks,
      customQuery: sanitizeText(raw.customQuery ?? '', 180) || undefined,
      brandWebsite: sanitizeText(raw.brandWebsite ?? '', 180) || undefined,
    },
  };
}

async function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));

  // Health & capability status
  app.get('/api/health', (_req: Request, res: Response) => {
    const hasGeminiKey = Boolean(
      process.env.GEMINI_API_KEY &&
        process.env.GEMINI_API_KEY.trim().length > 0 &&
        process.env.GEMINI_API_KEY.trim() !== 'MY_GEMINI_API_KEY'
    );
    const clover = getCloverRuntimeConfig().status;
    res.json({
      ok: true,
      service: '777-inventory',
      version: '0.3.0',
      onlineEnrichmentReady: true,
      geminiConfigured: hasGeminiKey,
      cloverConfigured: clover.configured,
    });
  });

  // Clover REST API v3 Server-Side Read/Write Bridge (uses server-only CLOVER_API_TOKEN & CLOVER_MERCHANT_ID)
  app.get('/api/clover/status', (_req: Request, res: Response) => {
    res.json(getCloverRuntimeConfig().status);
  });

  app.get('/api/clover/merchant-overview', async (_req: Request, res: Response) => {
    try {
      const overview = await fetchCloverMerchantOverview();
      res.json(overview);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to fetch Clover merchant settings.';
      const status = msg.includes('not configured') ? 400 : 502;
      res.status(status).json({ error: 'clover_overview_failed', message: msg });
    }
  });

  app.post('/api/clover/categories', async (req: Request, res: Response) => {
    const name = sanitizeText(req.body?.name ?? '', 127);
    if (!name) {
      res.status(400).json({ error: 'invalid_request', message: 'Category name is required.' });
      return;
    }
    try {
      const created = await createCloverCategory(name);
      res.status(201).json(created);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to create Clover category.';
      const status = msg.includes('not configured') ? 400 : 502;
      res.status(status).json({ error: 'clover_category_failed', message: msg });
    }
  });

  app.post('/api/clover/sync-inventory', async (_req: Request, res: Response) => {
    try {
      const result = await fetchCloverInventory();
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to fetch Clover inventory.';
      const status = msg.includes('not configured') ? 400 : 502;
      res.status(status).json({ error: 'clover_sync_failed', message: msg });
    }
  });

  app.post('/api/clover/create-item', async (req: Request, res: Response) => {
    const rawItem = req.body?.item;
    if (!rawItem || typeof rawItem !== 'object') {
      res.status(400).json({ error: 'invalid_request', message: 'Item payload is required.' });
      return;
    }
    try {
      const result = await createItemInClover(rawItem);
      if (!result.ok) {
        res.status(502).json({ error: 'clover_create_failed', message: result.error });
        return;
      }
      res.status(201).json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to create Clover item.';
      const status = msg.includes('not configured') ? 400 : 502;
      res.status(status).json({ error: 'clover_create_failed', message: msg });
    }
  });

  app.post('/api/clover/push-items', async (req: Request, res: Response) => {
    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
    if (rawItems.length === 0) {
      res.status(400).json({
        error: 'invalid_request',
        message: 'Provide at least one inventory item to push to Clover POS.',
      });
      return;
    }
    const syncStock = Boolean(req.body?.syncStock);
    const createIfDraft = Boolean(req.body?.createIfDraft);
    try {
      const result = await pushItemsToClover(rawItems, { syncStock, createIfDraft });
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to push updates to Clover POS.';
      const status = msg.includes('not configured') ? 400 : 502;
      res.status(status).json({ error: 'clover_push_failed', message: msg });
    }
  });

  app.post('/api/clover/sync-sales', async (req: Request, res: Response) => {
    const days = typeof req.body?.days === 'number' ? req.body.days : 30;
    try {
      const result = await fetchCloverSales(days);
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to fetch Clover sales orders.';
      const status = msg.includes('not configured') ? 400 : 502;
      res.status(status).json({ error: 'clover_sales_failed', message: msg });
    }
  });

  // Generic allowlisted Clover REST API v3 GET & POST bridge endpoints
  app.get('/api/clover/v3', async (req: Request, res: Response) => {
    const rawPath = typeof req.query.path === 'string' ? req.query.path : '';
    const check = validateCloverV3ResourcePath(rawPath);
    if (!check.ok) {
      res.status(400).json({ error: 'invalid_clover_path', message: check.reason });
      return;
    }
    try {
      const data = await proxyCloverV3Request('GET', check.path);
      res.json(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Clover v3 GET request failed.';
      const status = msg.includes('not configured') ? 400 : 502;
      res.status(status).json({ error: 'clover_v3_get_failed', message: msg });
    }
  });

  app.post('/api/clover/v3', async (req: Request, res: Response) => {
    const rawPath = typeof req.body?.path === 'string' ? req.body.path : '';
    const check = validateCloverV3ResourcePath(rawPath);
    if (!check.ok) {
      res.status(400).json({ error: 'invalid_clover_path', message: check.reason });
      return;
    }
    try {
      const data = await proxyCloverV3Request('POST', check.path, req.body?.body);
      res.json(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Clover v3 POST request failed.';
      const status = msg.includes('not configured') ? 400 : 502;
      res.status(status).json({ error: 'clover_v3_post_failed', message: msg });
    }
  });

  // Dedicated online enrichment endpoints
  const makeEnrichHandler =
    (defaultTasks: EnrichLookupType[]) => async (req: Request, res: Response) => {
      const parsed = parseEnrichRequestBody(req.body, defaultTasks);
      if (!parsed.ok) {
        res.status(400).json({ error: 'invalid_request', message: parsed.message });
        return;
      }

      const isAsyncJob = Boolean(req.body && typeof req.body === 'object' && req.body.async === true);
      if (isAsyncJob) {
        const jobId = `job_${crypto.randomBytes(6).toString('hex')}`;
        const initialJob: EnrichJobStatusResponse = {
          job_id: jobId,
          status: 'queued',
          progress: 0.1,
        };
        recordEnrichJob(initialJob);

        // Execute live enrichment asynchronously and update contract job record
        void (async () => {
          recordEnrichJob({ ...initialJob, status: 'running', progress: 0.4 });
          try {
            const result = await runOnlineEnrichment(parsed.data);
            const updates = toContractUpdates(result);
            const costsFound = updates.filter((u) => u.field === 'cost').length;
            const logosFound = updates.filter((u) => u.field === 'logo_url').length;
            recordEnrichJob({
              job_id: jobId,
              status: 'done',
              progress: 1,
              results: {
                costs_found: costsFound,
                logos_found: logosFound,
                still_missing: updates.length === 0 ? 1 : 0,
              },
              updates,
              proposals: result.proposals,
              sourcesChecked: result.sourcesChecked,
              citations: result.citations,
              marketReferences: result.marketReferences,
              notice: result.notice,
            });
          } catch (err) {
            recordEnrichJob({
              job_id: jobId,
              status: 'failed',
              progress: 1,
              error: err instanceof Error ? err.message : 'Online enrichment job failed.',
            });
          }
        })();

        res.status(202).json({
          job_id: jobId,
          status: 'queued',
          item_count: 1,
        });
        return;
      }

      try {
        const result = await runOnlineEnrichment(parsed.data);
        res.json({
          ...result,
          updates: toContractUpdates(result),
        });
      } catch (err) {
        res.status(502).json({
          error: 'enrichment_upstream_failed',
          message: err instanceof Error ? err.message : 'Online enrichment lookup failed.',
        });
      }
    };

  app.post('/api/enrich/upc', makeEnrichHandler(['upc_lookup']));
  app.post('/api/enrich/media', makeEnrichHandler(['logo', 'image']));
  app.post('/api/enrich/vendor-price', makeEnrichHandler(['vendor_cost']));
  app.post('/api/enrich/gemini-context', makeEnrichHandler(['gemini_context']));
  app.post(
    '/api/enrich/run-all',
    makeEnrichHandler(['upc_lookup', 'logo', 'image', 'vendor_cost', 'gemini_context'])
  );
  app.post(
    '/api/enrich',
    makeEnrichHandler(['upc_lookup', 'logo', 'image', 'vendor_cost', 'gemini_context'])
  );

  // Verify a pasted HTTPS image URL safely server-side
  app.post('/api/enrich/verify-url', async (req: Request, res: Response) => {
    const rawUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    const check = parseAndValidateExternalUrl(rawUrl);
    if (!check.ok) {
      res.status(400).json({ error: 'invalid_url', message: check.reason });
      return;
    }
    const { verifyExternalImageUrl, toProxiedImageUrl } = await import('./server/enrichmentService.ts');
    const verified = await verifyExternalImageUrl(check.url.toString());
    if (!verified) {
      res.status(422).json({
        error: 'not_an_image',
        message: 'That URL did not return a valid public PNG, JPEG, or WebP image.',
      });
      return;
    }
    res.json({ ok: true, originalUrl: verified, proxiedUrl: toProxiedImageUrl(verified) });
  });

  // SSRF-hardened raster image proxy for external product photos and brand icons
  app.get('/api/enrich/image-proxy', async (req: Request, res: Response) => {
    const rawUrl = typeof req.query.url === 'string' ? req.query.url : '';
    if (!rawUrl) {
      res.status(400).json({ error: 'missing_url', message: 'Image url query parameter is required.' });
      return;
    }

    let safeUrl: URL;
    try {
      safeUrl = await assertSafePublicUrl(rawUrl);
    } catch (err) {
      res.status(400).json({
        error: 'invalid_url',
        message: err instanceof Error ? err.message : 'External URL was rejected.',
      });
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    try {
      const upstream = await fetch(safeUrl.toString(), {
        method: 'GET',
        headers: {
          Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8',
          'User-Agent': '777LiquorInventoryApp/1.0 (https://inventory.777liquor.com)',
        },
        redirect: 'follow',
        signal: controller.signal,
      });

      if (!upstream.ok) {
        res.status(502).json({ error: 'image_fetch_failed', message: 'Upstream image could not be fetched.' });
        return;
      }

      const finalUrlCheck = parseAndValidateExternalUrl(upstream.url || safeUrl.toString());
      if (!finalUrlCheck.ok) {
        res.status(400).json({ error: 'unsafe_redirect', message: 'Redirected image URL was rejected.' });
        return;
      }

      const contentType = (upstream.headers.get('content-type') || '').toLowerCase();
      if (!contentType.startsWith('image/') || contentType.includes('svg')) {
        res.status(415).json({ error: 'unsupported_media_type', message: 'Only raster image assets are supported.' });
        return;
      }

      const contentLength = Number(upstream.headers.get('content-length') || '0');
      const MAX_BYTES = 5 * 1024 * 1024;
      if (contentLength > MAX_BYTES) {
        res.status(413).json({ error: 'image_too_large', message: 'Image exceeds 5 MB limit.' });
        return;
      }

      const arrayBuffer = await upstream.arrayBuffer();
      if (arrayBuffer.byteLength > MAX_BYTES) {
        res.status(413).json({ error: 'image_too_large', message: 'Image exceeds 5 MB limit.' });
        return;
      }

      res.setHeader('Content-Type', contentType.split(';')[0]);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'");
      res.send(Buffer.from(arrayBuffer));
    } catch {
      res.status(502).json({ error: 'image_proxy_timeout', message: 'Unable to load remote image.' });
    } finally {
      clearTimeout(timer);
    }
  });

  // Contract endpoint: GET /api/enrich/:job_id (must be registered after static /api/enrich/* routes)
  app.get('/api/enrich/:job_id', (req: Request, res: Response) => {
    const jobId = sanitizeText(req.params.job_id, 64);
    const job = ENRICH_JOBS.get(jobId);
    if (!job) {
      res.status(404).json({ error: 'job_not_found', message: `Enrichment job ${jobId} was not found.` });
      return;
    }
    res.json(job);
  });

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (req: Request, res: Response, next) => {
        if (req.path.startsWith('/api/')) {
          next();
          return;
        }
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`777 Inventory server listening on http://0.0.0.0:${PORT}`);
  });
}

void createApp();
