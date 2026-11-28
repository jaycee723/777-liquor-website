import {
  CanonicalItem,
  Hi5Status,
  InventoryImportPreviewRow,
  InventoryTargetField,
  InvoiceOcrLineItem,
  SalesImportRow,
  SalesTargetField,
} from '../types/inventory';
import {
  determineHi5Eligibility,
  normalizeItemName,
  recomputeItemFlags,
} from './inventoryRules';

export interface ParsedSheet {
  headers: string[];
  rows: Record<string, string>[];
}

/**
 * Pure RFC-4180-compatible CSV/TSV parser that handles quoted commas, escaped quotes,
 * CRLF/LF line endings, and ignores blank trailing rows.
 */
export function parseDelimitedText(text: string): ParsedSheet {
  const cleaned = text.replace(/^\uFEFF/, '').trim();
  if (!cleaned) return { headers: [], rows: [] };

  const firstLine = cleaned.split(/\r?\n/, 1)[0] ?? '';
  const delimiter =
    (firstLine.match(/\t/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0)
      ? '\t'
      : ',';

  const matrix: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    const next = cleaned[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\r' && next === '\n') {
      row.push(cell.trim());
      matrix.push(row);
      row = [];
      cell = '';
      i += 1;
    } else if (ch === '\n' || ch === '\r') {
      row.push(cell.trim());
      matrix.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }

  row.push(cell.trim());
  matrix.push(row);

  const nonEmpty = matrix.filter((r) => r.some((val) => val !== ''));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };

  const headers = nonEmpty[0].map((h, idx) => h || `Column ${idx + 1}`);
  const rows = nonEmpty.slice(1).map((cols) => {
    const record: Record<string, string> = {};
    headers.forEach((header, idx) => {
      record[header] = (cols[idx] ?? '').trim();
    });
    return record;
  });

  return { headers, rows };
}

const INVENTORY_HEADER_PATTERNS: Array<{ field: InventoryTargetField; patterns: RegExp[] }> = [
  { field: 'clover_id', patterns: [/clover\s*id/i, /master\s*id/i, /^id$/i, /^item\s*id$/i] },
  {
    field: 'name',
    patterns: [/^item\s*name$/i, /^name$/i, /^product(\s*name)?$/i, /^description$/i, /^title$/i],
  },
  { field: 'brand', patterns: [/^brand$/i, /^manufacturer$/i, /^producer$/i] },
  { field: 'category', patterns: [/^category$/i, /^dept/i, /^department$/i, /^group$/i] },
  { field: 'subcategory', patterns: [/sub\s*cat/i, /^style$/i, /^type$/i, /^varietal$/i] },
  { field: 'upc', patterns: [/^upc/i, /barcode/i, /product\s*code/i, /^ean/i, /^sku$/i] },
  {
    field: 'price',
    patterns: [/^price$/i, /retail\s*price/i, /base\s*price/i, /shelf\s*price/i, /^sell\s*price/i],
  },
  { field: 'cost', patterns: [/^cost$/i, /unit\s*cost/i, /wholesale/i, /landed\s*cost/i] },
  { field: 'vendor', patterns: [/^vendor$/i, /distributor/i, /supplier/i] },
  { field: 'unit_size', patterns: [/unit\s*size/i, /^size$/i, /volume/i, /bottle\s*size/i] },
  { field: 'sell_pack_qty', patterns: [/sell\s*pack/i, /pack\s*qty/i, /units?\s*per\s*pack/i, /^pack$/i] },
  { field: 'packs_per_case', patterns: [/packs?\s*per\s*case/i, /case\s*pack/i, /case\s*qty/i] },
  { field: 'quantity', patterns: [/^qty$/i, /quantity/i, /on\s*hand/i, /stock/i, /count/i] },
  { field: 'hi5_eligible', patterns: [/hi-?5/i, /deposit/i] },
];

const SALES_HEADER_PATTERNS: Array<{ field: SalesTargetField; patterns: RegExp[] }> = [
  { field: 'clover_id', patterns: [/clover\s*id/i, /^item\s*id$/i, /^id$/i] },
  { field: 'upc', patterns: [/^upc/i, /barcode/i, /product\s*code/i, /^sku$/i] },
  { field: 'name', patterns: [/item\s*name/i, /^name$/i, /product/i, /description/i] },
  { field: 'units_sold', patterns: [/units?\s*sold/i, /qty\s*sold/i, /quantity/i, /^sold$/i, /^qty$/i] },
  {
    field: 'gross_sales',
    patterns: [/gross\s*sales/i, /net\s*sales/i, /revenue/i, /total\s*sales/i, /^sales$/i, /amount/i],
  },
  { field: 'period_label', patterns: [/period/i, /date/i, /range/i, /month/i, /week/i] },
];

export function autoDetectInventoryColumnMap(
  headers: string[]
): Record<string, InventoryTargetField> {
  const mapping: Record<string, InventoryTargetField> = {};
  const claimed = new Set<InventoryTargetField>();

  for (const header of headers) {
    let matched: InventoryTargetField = '__ignore__';
    for (const rule of INVENTORY_HEADER_PATTERNS) {
      if (claimed.has(rule.field)) continue;
      if (rule.patterns.some((rx) => rx.test(header.trim()))) {
        matched = rule.field;
        claimed.add(rule.field);
        break;
      }
    }
    mapping[header] = matched;
  }

  return mapping;
}

export function autoDetectSalesColumnMap(
  headers: string[]
): Record<string, SalesTargetField> {
  const mapping: Record<string, SalesTargetField> = {};
  const claimed = new Set<SalesTargetField>();

  for (const header of headers) {
    let matched: SalesTargetField = '__ignore__';
    for (const rule of SALES_HEADER_PATTERNS) {
      if (claimed.has(rule.field)) continue;
      if (rule.patterns.some((rx) => rx.test(header.trim()))) {
        matched = rule.field;
        claimed.add(rule.field);
        break;
      }
    }
    mapping[header] = matched;
  }

  return mapping;
}

function parseMoney(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[$,\s]/g, '');
  if (!cleaned) return null;
  const num = Number(cleaned);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round(num * 100) / 100;
}

function parsePositiveInt(raw: string | undefined): number | null {
  if (!raw) return null;
  const match = raw.replace(/,/g, '').match(/\d+/);
  if (!match) return null;
  const num = Number(match[0]);
  return Number.isInteger(num) && num > 0 ? num : null;
}

function parseNonNegativeInt(raw: string | undefined): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/,/g, '').trim();
  const num = Number(cleaned);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.floor(num);
}

function extractUnitSizeFromName(name: string): string {
  const normalized = normalizeItemName(name);
  const match = normalized.match(/\b(\d+(?:\.\d+)?(?:oz|mL)|\d+(?:\.\d+)?\sL)\b/);
  return match ? match[1] : '';
}

function parseHi5Override(raw: string | undefined): Hi5Status | null {
  if (!raw) return null;
  const val = raw.trim().toLowerCase();
  if (val === 'yes' || val === 'y' || val === 'true' || val === '1') return 'Yes';
  if (val === 'no' || val === 'n' || val === 'false' || val === '0' || val === 'exempt') return 'No';
  if (val === 'confirm' || val === '?' || val === 'review') return 'Confirm';
  return null;
}

function readMappedValue<T extends string>(
  row: Record<string, string>,
  columnMap: Record<string, T>,
  target: T
): string {
  for (const [sourceCol, mappedTarget] of Object.entries(columnMap)) {
    if (mappedTarget === target) {
      return (row[sourceCol] ?? '').trim();
    }
  }
  return '';
}

/**
 * Builds normalized preview rows for inventory spreadsheet imports.
 * Never invents missing price or cost; flags duplicates and dirty rows clearly.
 */
export function buildInventoryImportPreview(
  rawRows: Record<string, string>[],
  columnMap: Record<string, InventoryTargetField>,
  existingItems: CanonicalItem[],
  sourceFilename: string
): InventoryImportPreviewRow[] {
  const existingById = new Map(existingItems.map((i) => [i.clover_id.toLowerCase(), i]));
  const existingByUpc = new Map(
    existingItems.filter((i) => i.upc).map((i) => [i.upc.replace(/\D/g, ''), i])
  );
  const existingByName = new Map(
    existingItems.map((i) => [i.normalized_name.toLowerCase(), i])
  );

  const seenInFile = new Set<string>();

  return rawRows.map((rawRow, idx) => {
    const rawName = readMappedValue(rawRow, columnMap, 'name');
    const rawCloverId = readMappedValue(rawRow, columnMap, 'clover_id');
    const rawUpc = readMappedValue(rawRow, columnMap, 'upc').replace(/\s+/g, '');
    const rawBrand = readMappedValue(rawRow, columnMap, 'brand');
    const rawCategory = readMappedValue(rawRow, columnMap, 'category');
    const rawSubcategory = readMappedValue(rawRow, columnMap, 'subcategory');
    const rawVendor = readMappedValue(rawRow, columnMap, 'vendor');
    const rawUnitSize = readMappedValue(rawRow, columnMap, 'unit_size');
    const rawPriceStr = readMappedValue(rawRow, columnMap, 'price');
    const rawCostStr = readMappedValue(rawRow, columnMap, 'cost');
    const rawSellPack = readMappedValue(rawRow, columnMap, 'sell_pack_qty');
    const rawPacksCase = readMappedValue(rawRow, columnMap, 'packs_per_case');
    const rawQty = readMappedValue(rawRow, columnMap, 'quantity');
    const rawHi5 = readMappedValue(rawRow, columnMap, 'hi5_eligible');

    const normalizedName = normalizeItemName(rawName);
    const cleanUpcDigits = rawUpc.replace(/\D/g, '');
    const matchedExisting =
      (rawCloverId ? existingById.get(rawCloverId.toLowerCase()) : undefined) ??
      (cleanUpcDigits ? existingByUpc.get(cleanUpcDigits) : undefined) ??
      (normalizedName ? existingByName.get(normalizedName.toLowerCase()) : undefined) ??
      null;

    const issues: string[] = [];
    if (!normalizedName) {
      issues.push('Missing item name');
    }

    const parsedPrice = parseMoney(rawPriceStr);
    const effectivePrice =
      parsedPrice !== null && parsedPrice > 0
        ? parsedPrice
        : matchedExisting
          ? matchedExisting.price
          : 0;

    if (parsedPrice === null || parsedPrice <= 0) {
      if (!matchedExisting) {
        issues.push('Missing or invalid retail price');
      }
    }

    const parsedCost = parseMoney(rawCostStr);
    const effectiveCost =
      parsedCost !== null && parsedCost > 0
        ? parsedCost
        : matchedExisting?.cost ?? null;

    if (effectiveCost === null) {
      issues.push('Missing cost (NO_COST)');
    }

    const category = rawCategory
      ? normalizeItemName(rawCategory)
      : matchedExisting?.category || 'Uncategorized';
    const subcategory = rawSubcategory
      ? normalizeItemName(rawSubcategory)
      : matchedExisting?.subcategory || '';
    const brand = rawBrand
      ? normalizeItemName(rawBrand)
      : matchedExisting?.brand || (normalizedName.split(' ')[0] ?? '');
    const unitSize = rawUnitSize || matchedExisting?.unit_size || extractUnitSizeFromName(rawName);

    const sellPackQty = parsePositiveInt(rawSellPack) ?? matchedExisting?.sell_pack_qty ?? null;
    const packsPerCase = parsePositiveInt(rawPacksCase) ?? matchedExisting?.packs_per_case ?? null;
    if (sellPackQty === null || packsPerCase === null) {
      issues.push('Incomplete pack config');
    }

    const hi5 =
      parseHi5Override(rawHi5) ??
      matchedExisting?.hi5_eligible ??
      determineHi5Eligibility(category, subcategory, normalizedName);

    const dedupeKey = cleanUpcDigits || normalizedName.toLowerCase();
    const isFileDuplicate = Boolean(dedupeKey && seenInFile.has(dedupeKey));
    if (dedupeKey) seenInFile.add(dedupeKey);
    if (isFileDuplicate) {
      issues.push('Duplicate row inside this file');
    }

    const candidate: CanonicalItem = {
      clover_id:
        matchedExisting?.clover_id ||
        rawCloverId ||
        `IMP-${String(idx + 1).padStart(3, '0')}`,
      name: rawName || matchedExisting?.name || '',
      normalized_name: normalizedName || matchedExisting?.normalized_name || '',
      brand,
      category,
      subcategory,
      upc: rawUpc || matchedExisting?.upc || '',
      price: effectivePrice,
      cost: effectiveCost,
      cost_source:
        parsedCost !== null && parsedCost > 0
          ? `Import: ${sourceFilename}`
          : matchedExisting?.cost_source ?? null,
      vendor: rawVendor ? normalizeItemName(rawVendor) : matchedExisting?.vendor ?? null,
      unit_size: unitSize,
      sell_pack_qty: sellPackQty,
      packs_per_case: packsPerCase,
      hi5_eligible: hi5,
      logo_url: matchedExisting?.logo_url ?? null,
      image_url: matchedExisting?.image_url ?? null,
      quantity: rawQty ? parseNonNegativeInt(rawQty) : matchedExisting?.quantity ?? 0,
      flags: matchedExisting?.flags ?? [],
      suggested_price: matchedExisting?.suggested_price ?? null,
    };

    const hasBlockingDirty = !candidate.normalized_name || candidate.price <= 0;
    candidate.flags = recomputeItemFlags(candidate, {
      preserveReview: hasBlockingDirty || category === 'Uncategorized' || candidate.flags.includes('REVIEW'),
    });

    let status: InventoryImportPreviewRow['status'] = 'new';
    let decision: InventoryImportPreviewRow['decision'] = 'import';

    if (hasBlockingDirty) {
      status = 'dirty';
      decision = 'skip';
    } else if (isFileDuplicate) {
      status = 'duplicate_in_file';
      decision = 'skip';
    } else if (matchedExisting) {
      status = 'update_existing';
      decision = 'update';
    }

    return {
      rowIndex: idx + 1,
      status,
      decision,
      matchedCloverId: matchedExisting?.clover_id ?? null,
      issues,
      item: candidate,
    };
  });
}

/**
 * Builds sales CSV preview rows (import kind = "sales") for the Clover CSV-export adapter.
 */
export function buildSalesImportPreview(
  rawRows: Record<string, string>[],
  columnMap: Record<string, SalesTargetField>,
  existingItems: CanonicalItem[]
): SalesImportRow[] {
  const byId = new Map(existingItems.map((i) => [i.clover_id.toLowerCase(), i]));
  const byUpc = new Map(
    existingItems.filter((i) => i.upc).map((i) => [i.upc.replace(/\D/g, ''), i])
  );
  const byName = new Map(existingItems.map((i) => [i.normalized_name.toLowerCase(), i]));

  return rawRows.map((rawRow, idx) => {
    const cloverId = readMappedValue(rawRow, columnMap, 'clover_id');
    const upc = readMappedValue(rawRow, columnMap, 'upc').replace(/\s+/g, '');
    const rawName = readMappedValue(rawRow, columnMap, 'name');
    const normalizedName = normalizeItemName(rawName);
    const units = parseNonNegativeInt(readMappedValue(rawRow, columnMap, 'units_sold'));
    const gross = parseMoney(readMappedValue(rawRow, columnMap, 'gross_sales')) ?? 0;
    const period = readMappedValue(rawRow, columnMap, 'period_label') || 'Last 30 Days';

    const cleanUpc = upc.replace(/\D/g, '');
    const matched =
      (cloverId ? byId.get(cloverId.toLowerCase()) : undefined) ??
      (cleanUpc ? byUpc.get(cleanUpc) : undefined) ??
      (normalizedName ? byName.get(normalizedName.toLowerCase()) : undefined) ??
      null;

    const issues: string[] = [];
    if (!normalizedName && !upc && !cloverId) issues.push('Missing product identifier');
    if (units <= 0 && gross <= 0) issues.push('Zero units and zero sales');
    if (!matched) issues.push('No matching SKU in inventory');

    const isDirty = (!normalizedName && !upc && !cloverId) || (units <= 0 && gross <= 0);
    const status: SalesImportRow['status'] = isDirty
      ? 'dirty'
      : matched
        ? 'matched'
        : 'unmatched';

    return {
      rowIndex: idx + 1,
      clover_id: cloverId || matched?.clover_id || null,
      upc: upc || matched?.upc || '',
      name: normalizedName || matched?.normalized_name || rawName,
      units_sold: units,
      gross_sales: gross,
      period_label: period,
      matchedCloverId: matched?.clover_id ?? null,
      status,
      issues,
      include: !isDirty,
    };
  });
}

/**
 * Computes unit cost per sellable pack from case cost and packs_per_case.
 * Never invents cost when caseCost or packsPerCase is missing.
 */
export function computeUnitCostFromCase(
  caseCost: number | null,
  packsPerCase: number | null
): number | null {
  if (caseCost === null || caseCost <= 0 || packsPerCase === null || packsPerCase <= 0) {
    return null;
  }
  return Math.round((caseCost / packsPerCase) * 100) / 100;
}

/**
 * Matches extracted OCR invoice line items against existing catalog by UPC or normalized name.
 */
export function reconcileInvoiceLines(
  lines: Omit<InvoiceOcrLineItem, 'unit_cost' | 'matchedCloverId' | 'matchedItemName'>[],
  existingItems: CanonicalItem[]
): InvoiceOcrLineItem[] {
  const byUpc = new Map(
    existingItems.filter((i) => i.upc).map((i) => [i.upc.replace(/\D/g, ''), i])
  );
  const byName = new Map(existingItems.map((i) => [i.normalized_name.toLowerCase(), i]));

  return lines.map((line) => {
    const normalized = normalizeItemName(line.normalized_name || line.raw_description);
    const cleanUpc = line.upc.replace(/\D/g, '');
    const matched =
      (cleanUpc ? byUpc.get(cleanUpc) : undefined) ??
      byName.get(normalized.toLowerCase()) ??
      null;

    return {
      ...line,
      normalized_name: normalized,
      unit_cost: computeUnitCostFromCase(line.case_cost, line.packs_per_case),
      matchedCloverId: matched?.clover_id ?? null,
      matchedItemName: matched?.normalized_name ?? null,
    };
  });
}
