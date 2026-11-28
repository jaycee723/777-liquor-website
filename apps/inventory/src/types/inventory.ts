export type Hi5Status = 'Yes' | 'No' | 'Confirm';

export type ItemFlag =
  | 'NO_COST'
  | 'NEED_PACK_CONFIG'
  | 'PRICE_DROP'
  | 'REVIEW'
  | 'HI5_CONFIRM';

export interface CanonicalItem {
  clover_id: string;
  name: string;
  normalized_name: string;
  brand: string;
  category: string;
  subcategory: string;
  upc: string;
  price: number; // Current authoritative shelf price
  cost: number | null; // Null when missing — never invented
  cost_source: string | null;
  vendor: string | null;
  unit_size: string;
  sell_pack_qty: number | null;
  packs_per_case: number | null;
  hi5_eligible: Hi5Status;
  logo_url: string | null;
  image_url: string | null;
  quantity: number;
  flags: ItemFlag[];
  suggested_price: number | null; // Server-computed only; null means no suggestion
}

export type SortField =
  | 'normalized_name'
  | 'brand'
  | 'category'
  | 'vendor'
  | 'price'
  | 'cost'
  | 'suggested_price'
  | 'quantity';

export type SortDirection = 'asc' | 'desc';

export type TriFilter = 'all' | 'yes' | 'no';

export interface ItemsQueryParams {
  search?: string;
  category?: string;
  vendor?: string;
  brand?: string;
  hasCost?: TriFilter;
  hasLogo?: TriFilter;
  flag?: ItemFlag | 'ANY_FLAG' | '';
  sort?: `${SortField}:${SortDirection}`;
  page?: number;
  pageSize?: number;
}

export interface InventoryFacets {
  categories: string[];
  vendors: string[];
  brands: string[];
}

export interface InventorySummaryCounts {
  totalItems: number;
  missingCostCount: number;
  flaggedCount: number;
  hi5ConfirmCount: number;
  missingLogoCount: number;
}

export interface ItemsResponse {
  items: CanonicalItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  facets: InventoryFacets;
  summary: InventorySummaryCounts;
}

export type PatchItemPayload = Partial<
  Pick<
    CanonicalItem,
    | 'name'
    | 'normalized_name'
    | 'brand'
    | 'category'
    | 'subcategory'
    | 'upc'
    | 'price'
    | 'cost'
    | 'cost_source'
    | 'vendor'
    | 'unit_size'
    | 'sell_pack_qty'
    | 'packs_per_case'
    | 'hi5_eligible'
    | 'logo_url'
    | 'image_url'
    | 'quantity'
    | 'flags'
  >
>;

export interface BulkPatchPayload {
  ids: string[];
  patch: PatchItemPayload;
  clearFlags?: ItemFlag[];
}

// Phase 2: Universal Import & Invoice OCR Contracts

export type ImportKind = 'inventory' | 'sales';

export type InventoryTargetField =
  | '__ignore__'
  | 'clover_id'
  | 'name'
  | 'brand'
  | 'category'
  | 'subcategory'
  | 'upc'
  | 'price'
  | 'cost'
  | 'vendor'
  | 'unit_size'
  | 'sell_pack_qty'
  | 'packs_per_case'
  | 'quantity'
  | 'hi5_eligible';

export type SalesTargetField =
  | '__ignore__'
  | 'clover_id'
  | 'upc'
  | 'name'
  | 'units_sold'
  | 'gross_sales'
  | 'period_label';

export type ImportRowStatus = 'new' | 'update_existing' | 'duplicate_in_file' | 'dirty';

export type ImportRowDecision = 'import' | 'update' | 'skip';

export interface InventoryImportPreviewRow {
  rowIndex: number;
  status: ImportRowStatus;
  decision: ImportRowDecision;
  matchedCloverId: string | null;
  issues: string[];
  item: CanonicalItem;
}

export interface SalesImportRow {
  rowIndex: number;
  clover_id: string | null;
  upc: string;
  name: string;
  units_sold: number;
  gross_sales: number;
  period_label: string;
  matchedCloverId: string | null;
  status: 'matched' | 'unmatched' | 'dirty';
  issues: string[];
  include: boolean;
}

export interface InvoiceOcrLineItem {
  lineId: string;
  raw_description: string;
  normalized_name: string;
  upc: string;
  case_cost: number | null;
  sell_pack_qty: number | null;
  packs_per_case: number | null;
  unit_cost: number | null;
  confidence: 'high' | 'medium' | 'low';
  matchedCloverId: string | null;
  matchedItemName: string | null;
  include: boolean;
}

export interface InvoiceOcrResponse {
  filename: string;
  vendor: string;
  invoice_number: string;
  invoice_date: string;
  lines: InvoiceOcrLineItem[];
}

export interface ImportRequest {
  kind: ImportKind;
  filename: string;
  sourceLabel?: string;
  inventoryRows?: Array<{
    decision: ImportRowDecision;
    matchedCloverId: string | null;
    item: CanonicalItem;
  }>;
  salesRows?: SalesImportRow[];
}

export interface ImportResponse {
  kind: ImportKind;
  importedCount: number;
  updatedCount: number;
  flaggedCount: number;
  duplicatesSkipped: number;
  salesSource?: SalesSource;
}

// Phase 3-5 Forward Contracts

export type EnrichLookupType =
  | 'upc_lookup'
  | 'logo'
  | 'image'
  | 'vendor_cost'
  | 'gemini_context';

export interface EnrichRequest {
  clover_id: string;
  lookupTypes: EnrichLookupType[];
  item?: Partial<CanonicalItem>;
  customQuery?: string;
  brandWebsite?: string;
}

export interface EnrichProposal {
  field: keyof CanonicalItem;
  currentValue: string | number | null;
  proposedValue: string | number | null;
  source: string;
  sourceUrl?: string;
  note?: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface EnrichSourceStatus {
  source: string;
  status: 'matched' | 'no_match' | 'unavailable' | 'error';
  detail: string;
}

export interface EnrichCitation {
  title: string;
  url: string;
}

export interface EnrichMarketReference {
  retailer: string;
  price: number;
  url?: string;
  note?: string;
}

export interface EnrichContractUpdate {
  item_id: string;
  field: keyof CanonicalItem;
  old: string | number | null;
  new: string | number | null;
  source: string;
  sourceUrl?: string;
  confidence?: 'high' | 'medium' | 'low';
  note?: string;
}

export interface EnrichJobQueuedResponse {
  job_id: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  item_count: number;
}

export interface EnrichJobStatusResponse {
  job_id: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  progress: number;
  results?: {
    costs_found: number;
    logos_found: number;
    still_missing: number;
  };
  updates?: EnrichContractUpdate[];
  proposals?: EnrichProposal[];
  sourcesChecked?: EnrichSourceStatus[];
  citations?: EnrichCitation[];
  marketReferences?: EnrichMarketReference[];
  notice?: string;
  error?: string;
}

export interface EnrichResponse {
  clover_id: string;
  job_id?: string;
  proposals: EnrichProposal[];
  updates?: EnrichContractUpdate[];
  sourcesChecked?: EnrichSourceStatus[];
  citations?: EnrichCitation[];
  marketReferences?: EnrichMarketReference[];
  notice?: string;
}

export interface EnrichmentApplyResult {
  item: CanonicalItem;
  appliedFields: Array<keyof CanonicalItem>;
  clearedFlags: ItemFlag[];
  remainingFlags: ItemFlag[];
}

export interface ServerHealthResponse {
  ok: boolean;
  service: string;
  version: string;
  onlineEnrichmentReady?: boolean;
  geminiConfigured?: boolean;
}

export interface PricingSuggestionRow {
  clover_id: string;
  normalized_name: string;
  brand?: string;
  category?: string;
  vendor?: string | null;
  logo_url?: string | null;
  current_price: number;
  suggested_price: number | null;
  percent_change: number | null;
  cost: number | null;
  quantity: number;
  flags: ItemFlag[];
  excluded_from_bulk: boolean;
  exclusion_reasons?: string[];
}

export interface PricingSuggestionsResponse {
  preview_token: string;
  generated_at: string;
  rows: PricingSuggestionRow[];
}

export interface PricingApplyRequest {
  preview_token: string;
  clover_ids: string[];
}

export interface PricingApplyResponse {
  appliedCount: number;
  shelfValueDelta: number;
  new_preview_token: string;
}

export type SalesSource = 'clover_export' | 'clover_api' | 'none';

export interface AnalyticsSummaryResponse {
  sales_source: SalesSource;
  last_synced_at: string | null;
  source_filename: string | null;
  total_revenue: number;
  units_sold: number;
  gross_margin_pct: number | null;
  top_sellers: Array<{
    clover_id: string;
    normalized_name: string;
    units_sold: number;
    revenue: number;
    margin_pct: number | null;
  }>;
  dead_stock: Array<{
    clover_id: string;
    normalized_name: string;
    quantity: number;
    days_since_sale: number;
  }>;
}

export interface ProductSuggestion {
  id: string;
  name: string;
  brand: string;
  category: string;
  subcategory?: string;
  vendor: string;
  unit_size: string;
  sell_pack_qty: number;
  packs_per_case: number;
  estimated_cost: number;
  estimated_retail: number;
  expected_margin_pct: number;
  hawaii_trend_note: string;
  upc?: string;
}

export interface ToastExportPreflight {
  totalItems: number;
  readyCount: number;
  missingCostCount: number;
  missingUpcCount: number;
  flaggedCount: number;
}

export interface ToastExportResponse {
  csv: string;
  filename: string;
  rowCount: number;
  columns: string[];
  preflight: ToastExportPreflight;
}

export interface CoolerDoorCatalogItem {
  id: string;
  name: string;
  brand: string;
  category: 'Beer' | 'RTD' | 'Spirits' | 'Wine';
  size: string;
  price: number;
  logo: string | null;
}

export interface CoolerDoorPushResponse {
  pushed: number;
  publishedCount: number;
  publishedAt: string;
  by_category: Record<'Beer' | 'RTD' | 'Spirits' | 'Wine', number>;
  missing_logos: string[];
  excludedCount: number;
  catalog: {
    sourceFile: string;
    generatedAt: string;
    itemCount: number;
    items: CoolerDoorCatalogItem[];
  };
}

export type AveryPresetId = '5160' | '5161' | '5163' | '5164' | '5167';

export interface LabelTemplate {
  id: string;
  name: string;
  preset: AveryPresetId;
  updated_at: string;
}

export interface CloverStatusResponse {
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

export interface CloverSyncInventoryResponse {
  items: CanonicalItem[];
  needsNameFixCount: number;
  missingCostCount: number;
  fetchedAt: string;
}

export interface CloverPushItemResult {
  clover_id: string;
  normalized_name: string;
  ok: boolean;
  created?: boolean;
  error?: string;
}

export interface CloverPushResponse {
  updatedCount: number;
  failedCount: number;
  results: CloverPushItemResult[];
}

export interface CloverSalesMetrics {
  orderCount: number;
  totalGross: number;
  totalTax: number;
  totalDiscounts: number;
  avgOrderValue: number;
  windowDays: number;
}

export interface CloverSyncSalesResponse {
  salesRows: SalesImportRow[];
  orderCount: number;
  metrics?: CloverSalesMetrics;
  fetchedAt: string;
}

export interface AuthUser {
  uid?: string;
  email: string;
  name: string;
  role: 'Owner' | 'Manager' | 'Counter Staff';
  storeName: string;
  storeAddress: string;
  provider?: 'google' | 'local';
}

export type AppSection =
  | 'inventory'
  | 'import'
  | 'enrichment'
  | 'pricing'
  | 'analytics'
  | 'suggestions'
  | 'exports'
  | 'labels'
  | 'settings';
