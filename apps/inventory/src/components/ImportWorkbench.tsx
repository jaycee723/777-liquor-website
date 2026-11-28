import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  Upload,
  FileSpreadsheet,
  FileText,
  Receipt,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  RotateCcw,
  RefreshCw,
} from 'lucide-react';
import { CloverSyncPanel } from './CloverSyncPanel';
import {
  CanonicalItem,
  ImportResponse,
  InventoryImportPreviewRow,
  InventoryTargetField,
  InvoiceOcrLineItem,
  InvoiceOcrResponse,
  SalesImportRow,
  SalesTargetField,
} from '../types/inventory';
import { inventoryApi } from '../api/client';
import {
  SAMPLE_CLOVER_INVENTORY_CSV,
  SAMPLE_CLOVER_SALES_CSV,
  SAMPLE_INVOICE_OCR_TEMPLATES,
  SAMPLE_VENDOR_SHEET_CSV,
} from '../api/mockImportSamples';
import {
  autoDetectInventoryColumnMap,
  autoDetectSalesColumnMap,
  buildInventoryImportPreview,
  buildSalesImportPreview,
  computeUnitCostFromCase,
  parseDelimitedText,
  reconcileInvoiceLines,
} from '../utils/importEngine';
import { determineHi5Eligibility, normalizeItemName } from '../utils/inventoryRules';

interface ImportWorkbenchProps {
  initialMode?: ImportMode;
  onToast: (tone: 'success' | 'error', text: string) => void;
  onNavigateInventory: () => void;
  onNavigateSettings: () => void;
}

type ImportMode = 'inventory' | 'sales' | 'invoice' | 'clover';
type SheetStep = 'upload' | 'map' | 'preview' | 'done';

const INVENTORY_TARGET_OPTIONS: Array<{ value: InventoryTargetField; label: string }> = [
  { value: '__ignore__', label: 'Ignore Column' },
  { value: 'name', label: 'Item Name (Required)' },
  { value: 'upc', label: 'UPC / Barcode' },
  { value: 'price', label: 'Current Price ($)' },
  { value: 'cost', label: 'Unit Cost ($)' },
  { value: 'brand', label: 'Brand' },
  { value: 'category', label: 'Category' },
  { value: 'subcategory', label: 'Subcategory' },
  { value: 'vendor', label: 'Vendor' },
  { value: 'unit_size', label: 'Unit Size (e.g. 12oz, 1 L)' },
  { value: 'sell_pack_qty', label: 'Sell Pack Qty' },
  { value: 'packs_per_case', label: 'Packs Per Case' },
  { value: 'quantity', label: 'Quantity On Hand' },
  { value: 'hi5_eligible', label: 'HI-5 Eligible (Yes/No/Confirm)' },
  { value: 'clover_id', label: 'Clover ID' },
];

const SALES_TARGET_OPTIONS: Array<{ value: SalesTargetField; label: string }> = [
  { value: '__ignore__', label: 'Ignore Column' },
  { value: 'name', label: 'Item Name' },
  { value: 'upc', label: 'UPC / Barcode' },
  { value: 'clover_id', label: 'Clover ID' },
  { value: 'units_sold', label: 'Units Sold (Required)' },
  { value: 'gross_sales', label: 'Gross Sales $ (Required)' },
  { value: 'period_label', label: 'Reporting Period' },
];

export function ImportWorkbench({
  initialMode = 'inventory',
  onToast,
  onNavigateInventory,
  onNavigateSettings,
}: ImportWorkbenchProps) {
  const [mode, setMode] = useState<ImportMode>(initialMode);
  const [existingItems, setExistingItems] = useState<CanonicalItem[]>([]);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  // Spreadsheet flow state
  const [step, setStep] = useState<SheetStep>('upload');
  const [filename, setFilename] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([]);
  const [invColMap, setInvColMap] = useState<Record<string, InventoryTargetField>>({});
  const [salesColMap, setSalesColMap] = useState<Record<string, SalesTargetField>>({});
  const [invPreview, setInvPreview] = useState<InventoryImportPreviewRow[]>([]);
  const [salesPreview, setSalesPreview] = useState<SalesImportRow[]>([]);
  const [importResult, setImportResult] = useState<ImportResponse | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Invoice OCR flow state
  const [ocrLoading, setOcrLoading] = useState(false);
  const [invoiceDoc, setInvoiceDoc] = useState<InvoiceOcrResponse | null>(null);
  const [invoiceVendor, setInvoiceVendor] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [invoiceLines, setInvoiceLines] = useState<InvoiceOcrLineItem[]>([]);
  const [invoiceDone, setInvoiceDone] = useState<ImportResponse | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const ocrInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void inventoryApi.getAllItemsForMatching().then(setExistingItems).catch(() => {});
  }, []);

  const resetSpreadsheetState = () => {
    setStep('upload');
    setFilename('');
    setHeaders([]);
    setRawRows([]);
    setInvColMap({});
    setSalesColMap({});
    setInvPreview([]);
    setSalesPreview([]);
    setImportResult(null);
    setParseError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const resetInvoiceState = () => {
    setInvoiceDoc(null);
    setInvoiceVendor('');
    setInvoiceNumber('');
    setInvoiceDate('');
    setInvoiceLines([]);
    setInvoiceDone(null);
    setParseError(null);
    if (ocrInputRef.current) ocrInputRef.current.value = '';
  };

  const switchMode = (nextMode: ImportMode) => {
    setMode(nextMode);
    setParseError(null);
    if (nextMode !== 'invoice') {
      resetSpreadsheetState();
    }
  };

  const ingestParsedSheet = (
    name: string,
    parsedHeaders: string[],
    parsedRows: Record<string, string>[],
    targetMode: 'inventory' | 'sales'
  ) => {
    if (parsedHeaders.length === 0 || parsedRows.length === 0) {
      setParseError('No readable header and data rows were found in that file.');
      return;
    }

    setParseError(null);
    setFilename(name);
    setHeaders(parsedHeaders);
    setRawRows(parsedRows);

    if (targetMode === 'inventory') {
      setInvColMap(autoDetectInventoryColumnMap(parsedHeaders));
    } else {
      setSalesColMap(autoDetectSalesColumnMap(parsedHeaders));
    }
    setStep('map');
  };

  const handleSpreadsheetUpload = async (file: File) => {
    setParseError(null);
    const activeKind: 'inventory' | 'sales' = mode === 'sales' ? 'sales' : 'inventory';
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';

    try {
      if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
        const text = await file.text();
        const parsed = parseDelimitedText(text);
        ingestParsedSheet(file.name, parsed.headers, parsed.rows, activeKind);
        return;
      }

      // Parse .xlsx / .xls using SheetJS
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        setParseError('Workbook contains no sheets.');
        return;
      }
      const sheet = workbook.Sheets[firstSheetName];
      const matrix = XLSX.utils.sheet_to_json<Array<string | number | null>>(sheet, {
        header: 1,
        defval: '',
      });
      const nonEmpty = matrix.filter((r) => r.some((cell) => String(cell ?? '').trim() !== ''));
      if (nonEmpty.length < 2) {
        setParseError('Spreadsheet must contain a header row and at least one data row.');
        return;
      }

      const detectedHeaders = nonEmpty[0].map((h, i) => String(h ?? '').trim() || `Column ${i + 1}`);
      const rows = nonEmpty.slice(1).map((cols) => {
        const rec: Record<string, string> = {};
        detectedHeaders.forEach((h, i) => {
          rec[h] = String(cols[i] ?? '').trim();
        });
        return rec;
      });
      ingestParsedSheet(file.name, detectedHeaders, rows, activeKind);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Unable to parse spreadsheet file.');
    }
  };

  const loadSampleCsv = (sampleType: 'clover_inv' | 'vendor_inv' | 'clover_sales') => {
    if (sampleType === 'clover_sales') {
      const parsed = parseDelimitedText(SAMPLE_CLOVER_SALES_CSV);
      ingestParsedSheet('Clover_Sales_Nov_2026.csv', parsed.headers, parsed.rows, 'sales');
      return;
    }
    const csv = sampleType === 'clover_inv' ? SAMPLE_CLOVER_INVENTORY_CSV : SAMPLE_VENDOR_SHEET_CSV;
    const name =
      sampleType === 'clover_inv'
        ? 'Clover_POS_Export_Messy.csv'
        : 'Paradise_Johnson_Vendor_List.csv';
    const parsed = parseDelimitedText(csv);
    ingestParsedSheet(name, parsed.headers, parsed.rows, 'inventory');
  };

  const mappingValidation = useMemo(() => {
    if (mode === 'inventory') {
      const targets = Object.values(invColMap);
      const hasName = targets.includes('name');
      return {
        valid: hasName,
        message: hasName ? null : 'Map at least one source column to "Item Name (Required)".',
      };
    }
    const targets = Object.values(salesColMap);
    const hasUnits = targets.includes('units_sold');
    const hasSales = targets.includes('gross_sales');
    const hasId =
      targets.includes('name') || targets.includes('upc') || targets.includes('clover_id');
    const valid = hasId && (hasUnits || hasSales);
    return {
      valid,
      message: valid
        ? null
        : 'Map an item identifier (Name, UPC, or Clover ID) plus Units Sold or Gross Sales.',
    };
  }, [mode, invColMap, salesColMap]);

  const handleBuildPreview = async () => {
    if (!mappingValidation.valid) return;
    const latestItems = await inventoryApi.getAllItemsForMatching();
    setExistingItems(latestItems);

    if (mode === 'inventory') {
      setInvPreview(buildInventoryImportPreview(rawRows, invColMap, latestItems, filename));
    } else {
      setSalesPreview(buildSalesImportPreview(rawRows, salesColMap, latestItems));
    }
    setStep('preview');
  };

  const handleConfirmSpreadsheetImport = async () => {
    setSubmitting(true);
    try {
      if (mode === 'inventory') {
        const result = await inventoryApi.importData({
          kind: 'inventory',
          filename,
          inventoryRows: invPreview.map((r) => ({
            decision: r.decision,
            matchedCloverId: r.matchedCloverId,
            item: r.item,
          })),
        });
        setImportResult(result);
        setStep('done');
        onToast(
          'success',
          `Imported ${result.importedCount} new and updated ${result.updatedCount} inventory items.`
        );
      } else {
        const result = await inventoryApi.importData({
          kind: 'sales',
          filename,
          salesRows: salesPreview,
        });
        setImportResult(result);
        setStep('done');
        onToast('success', `Loaded ${result.importedCount} Clover sales rows (source: Clover CSV Export).`);
      }
      const refreshed = await inventoryApi.getAllItemsForMatching();
      setExistingItems(refreshed);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setSubmitting(false);
    }
  };

  // Invoice OCR Handlers
  const runOcrExtraction = async (input: { sampleId: string } | { file: File }) => {
    setOcrLoading(true);
    setParseError(null);
    setInvoiceDone(null);
    try {
      const response = await inventoryApi.extractInvoiceOcr(input);
      setInvoiceDoc(response);
      setInvoiceVendor(response.vendor);
      setInvoiceNumber(response.invoice_number);
      setInvoiceDate(response.invoice_date);
      setInvoiceLines(response.lines);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'OCR extraction failed.');
    } finally {
      setOcrLoading(false);
    }
  };

  const updateInvoiceLine = (
    lineId: string,
    patch: Partial<
      Pick<
        InvoiceOcrLineItem,
        'normalized_name' | 'upc' | 'case_cost' | 'sell_pack_qty' | 'packs_per_case' | 'include'
      >
    >
  ) => {
    setInvoiceLines((prev) => {
      const updatedRaw = prev.map((line) => {
        if (line.lineId !== lineId) return line;
        const merged = { ...line, ...patch };
        return {
          ...merged,
          unit_cost: computeUnitCostFromCase(merged.case_cost, merged.packs_per_case),
        };
      });
      return reconcileInvoiceLines(updatedRaw, existingItems);
    });
  };

  const handleSaveInvoiceLines = async () => {
    const selected = invoiceLines.filter((l) => l.include);
    if (selected.length === 0) {
      onToast('error', 'Select at least one invoice line item to save.');
      return;
    }

    setSubmitting(true);
    try {
      const costSource = `${invoiceVendor.trim() || 'Invoice'} Inv #${invoiceNumber.trim() || 'OCR'}`;
      const existingById = new Map(existingItems.map((i) => [i.clover_id, i]));

      const inventoryRows = selected.map((line) => {
        const existing = line.matchedCloverId ? existingById.get(line.matchedCloverId) : undefined;
        const normalized = normalizeItemName(line.normalized_name || line.raw_description);

        if (existing) {
          return {
            decision: 'update' as const,
            matchedCloverId: existing.clover_id,
            item: {
              ...existing,
              normalized_name: existing.normalized_name,
              cost: line.unit_cost !== null ? line.unit_cost : existing.cost,
              cost_source: line.unit_cost !== null ? costSource : existing.cost_source,
              vendor: invoiceVendor.trim() || existing.vendor,
              sell_pack_qty: line.sell_pack_qty ?? existing.sell_pack_qty,
              packs_per_case: line.packs_per_case ?? existing.packs_per_case,
            },
          };
        }

        const inferredCategory = /whisky|vodka|rum|tequila|cognac|gin|bourbon/i.test(normalized)
          ? 'Spirits'
          : /wine|cabernet|pinot|sauvignon|champagne/i.test(normalized)
            ? 'Wine'
            : /cider|ipa|ale|lager|beer/i.test(normalized)
              ? 'Beer'
              : 'Uncategorized';

        return {
          decision: 'import' as const,
          matchedCloverId: null,
          item: {
            clover_id: `IMP-OCR-${line.lineId}`,
            name: line.raw_description,
            normalized_name: normalized,
            brand: normalized.split(' ').slice(0, 2).join(' '),
            category: inferredCategory,
            subcategory: '',
            upc: line.upc,
            price: 0, // Never invent a retail price; user sets shelf price in Inventory/Pricing
            cost: line.unit_cost,
            cost_source: line.unit_cost !== null ? costSource : null,
            vendor: invoiceVendor.trim() || null,
            unit_size: normalized.match(/\b(\d+(?:\.\d+)?(?:oz|mL)|\d+(?:\.\d+)?\sL)\b/)?.[1] ?? '',
            sell_pack_qty: line.sell_pack_qty,
            packs_per_case: line.packs_per_case,
            hi5_eligible: determineHi5Eligibility(inferredCategory, '', normalized),
            logo_url: null,
            image_url: null,
            quantity: 0,
            flags: ['REVIEW' as const],
            suggested_price: null,
          },
        };
      });

      const result = await inventoryApi.importData({
        kind: 'inventory',
        filename: invoiceDoc?.filename || 'invoice_ocr.pdf',
        sourceLabel: costSource,
        inventoryRows,
      });

      setInvoiceDone(result);
      const refreshed = await inventoryApi.getAllItemsForMatching();
      setExistingItems(refreshed);
      onToast(
        'success',
        `Saved invoice ${invoiceNumber}: ${result.updatedCount} costs updated, ${result.importedCount} new draft SKUs.`
      );
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Unable to save invoice items.');
    } finally {
      setSubmitting(false);
    }
  };

  // Summary counters for Preview step
  const invSummary = useMemo(() => {
    const counts = { total: invPreview.length, newCount: 0, updateCount: 0, dupCount: 0, dirtyCount: 0 };
    for (const r of invPreview) {
      if (r.status === 'new') counts.newCount += 1;
      else if (r.status === 'update_existing') counts.updateCount += 1;
      else if (r.status === 'duplicate_in_file') counts.dupCount += 1;
      else if (r.status === 'dirty') counts.dirtyCount += 1;
    }
    return counts;
  }, [invPreview]);

  const salesSummary = useMemo(() => {
    let units = 0;
    let revenue = 0;
    let matched = 0;
    let unmatched = 0;
    for (const r of salesPreview) {
      if (!r.include) continue;
      units += r.units_sold;
      revenue += r.gross_sales;
      if (r.status === 'matched') matched += 1;
      else if (r.status === 'unmatched') unmatched += 1;
    }
    return { total: salesPreview.length, matched, unmatched, units, revenue };
  }, [salesPreview]);

  return (
    <div className="space-y-4">
      {/* Mode Switcher Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-3 flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Import workflow mode"
          className="flex items-center gap-1 p-1 max-w-full overflow-x-auto bg-slate-100 dark:bg-slate-950 rounded-md border border-slate-200 dark:border-slate-800"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'inventory'}
            onClick={() => switchMode('inventory')}
            className={`h-9 px-3.5 inline-flex items-center gap-2 text-xs font-semibold rounded transition-colors whitespace-nowrap cursor-pointer ${
              mode === 'inventory'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <FileSpreadsheet className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Inventory Spreadsheet</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={mode === 'sales'}
            onClick={() => switchMode('sales')}
            className={`h-9 px-3.5 inline-flex items-center gap-2 text-xs font-semibold rounded transition-colors whitespace-nowrap cursor-pointer ${
              mode === 'sales'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <FileText className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Sales Report CSV</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={mode === 'invoice'}
            onClick={() => switchMode('invoice')}
            className={`h-9 px-3.5 inline-flex items-center gap-2 text-xs font-semibold rounded transition-colors whitespace-nowrap cursor-pointer ${
              mode === 'invoice'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Receipt className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Invoice PDF / Image OCR</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={mode === 'clover'}
            data-testid="tab-clover-sync"
            onClick={() => switchMode('clover')}
            className={`h-9 px-3.5 inline-flex items-center gap-2 text-xs font-semibold rounded transition-colors whitespace-nowrap cursor-pointer ${
              mode === 'clover'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Clover POS Live Sync</span>
          </button>
        </div>

        <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
          {mode === 'inventory' && 'POST /api/import · kind="inventory"'}
          {mode === 'sales' && 'POST /api/import · kind="sales" (Clover CSV Default)'}
          {mode === 'invoice' && 'OCR Extract -> Human Review -> POST /api/import'}
          {mode === 'clover' && 'Clover REST API v3 (Server Proxy · Pull & Push Fixes)'}
        </div>
      </div>

      {parseError && (
        <div
          role="alert"
          className="px-4 py-3 text-xs font-medium rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/60 text-red-800 dark:text-red-200 flex items-center gap-2"
        >
          <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{parseError}</span>
        </div>
      )}

      {/* ==================== CLOVER POS LIVE REST SYNC ==================== */}
      {mode === 'clover' && (
        <CloverSyncPanel
          onToast={onToast}
          onNavigateInventory={onNavigateInventory}
        />
      )}

      {/* ==================== SPREADSHEET FLOW (INVENTORY OR SALES) ==================== */}
      {mode !== 'invoice' && mode !== 'clover' && (
        <>
          {/* 3-Step Indicator */}
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 px-1">
            <span className={step === 'upload' ? 'font-semibold text-blue-700 dark:text-blue-400' : ''}>
              1. Upload Sheet
            </span>
            <span aria-hidden="true">/</span>
            <span className={step === 'map' ? 'font-semibold text-blue-700 dark:text-blue-400' : ''}>
              2. Map Columns
            </span>
            <span aria-hidden="true">/</span>
            <span className={step === 'preview' ? 'font-semibold text-blue-700 dark:text-blue-400' : ''}>
              3. Preview &amp; Confirm
            </span>
            {filename && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-slate-700 dark:text-slate-300 truncate">{filename}</span>
              </>
            )}
          </div>

          {/* STEP 1: UPLOAD */}
          {step === 'upload' && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-6">
              <div className="max-w-2xl">
                <h2 className="text-base font-display font-bold text-slate-900 dark:text-slate-100">
                  {mode === 'inventory'
                    ? 'Upload Any Inventory Spreadsheet (.xlsx, .csv, .tsv)'
                    : 'Upload Clover Sales Export CSV (.csv, .xlsx)'}
                </h2>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                  {mode === 'inventory'
                    ? 'Works with Clover exports, Toast Retail templates, distributor price lists, or messy custom spreadsheets. Nothing is saved until you review the normalized preview.'
                    : 'This is the default sales-data path—no Clover API approval required. Imported sales immediately feed Analytics and show source: Clover CSV Export.'}
                </p>
              </div>

              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files?.[0];
                  if (file) void handleSpreadsheetUpload(file);
                }}
                className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-lg p-8 text-center bg-slate-50/60 dark:bg-slate-950/40 space-y-3"
              >
                <Upload className="w-7 h-7 mx-auto text-slate-400 dark:text-slate-500" aria-hidden="true" />
                <div className="text-sm font-medium text-slate-800 dark:text-slate-200">
                  Drop your spreadsheet here, or choose a file from this device
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Supports Excel (.xlsx, .xls), CSV, and TSV · Any column order
                </div>
                <input
                  ref={fileInputRef}
                  id="sheet-file-input"
                  type="file"
                  accept=".csv,.tsv,.txt,.xlsx,.xls"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleSpreadsheetUpload(file);
                  }}
                  className="sr-only"
                />
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="h-10 px-5 text-xs font-semibold rounded-md bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white transition-colors cursor-pointer"
                  >
                    Choose Spreadsheet File
                  </button>
                </div>
              </div>

              {/* One-Click Realistic Samples */}
              <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Or load a realistic Honolulu store sample to test mapping &amp; normalization:
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  {mode === 'inventory' ? (
                    <>
                      <button
                        type="button"
                        onClick={() => loadSampleCsv('clover_inv')}
                        className="h-9 px-3.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap cursor-pointer"
                      >
                        Load Messy Clover Export Sample
                      </button>
                      <button
                        type="button"
                        onClick={() => loadSampleCsv('vendor_inv')}
                        className="h-9 px-3.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap cursor-pointer"
                      >
                        Load Vendor Price List Sample
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => loadSampleCsv('clover_sales')}
                      className="h-9 px-3.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap cursor-pointer"
                    >
                      Load Clover Sales CSV Sample
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: MAP COLUMNS */}
          {step === 'map' && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-display font-bold text-slate-900 dark:text-slate-100">
                    Match Detected Columns ({headers.length} columns · {rawRows.length} rows)
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    Verify each spreadsheet column maps to the right canonical field before previewing.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={resetSpreadsheetState}
                  className="h-9 px-3 inline-flex items-center gap-1.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Choose Different File</span>
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 font-semibold text-slate-600 dark:text-slate-400">
                      <th className="px-4 py-2.5 w-52">Detected Column</th>
                      <th className="px-4 py-2.5">Sample Values (Rows 1–2)</th>
                      <th className="px-4 py-2.5 w-64">Canonical Field</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {headers.map((header) => {
                      const sample1 = rawRows[0]?.[header] ?? '';
                      const sample2 = rawRows[1]?.[header] ?? '';
                      const currentTarget =
                        mode === 'inventory'
                          ? invColMap[header] ?? '__ignore__'
                          : salesColMap[header] ?? '__ignore__';

                      return (
                        <tr key={header} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                          <td className="px-4 py-2.5 font-mono font-semibold text-slate-900 dark:text-slate-100">
                            {header}
                          </td>
                          <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400">
                            <span className="truncate block max-w-md">
                              {[sample1, sample2].filter(Boolean).join(' · ') || 'Empty in first 2 rows'}
                            </span>
                          </td>
                          <td className="px-4 py-2">
                            <select
                              aria-label={`Map column ${header}`}
                              value={currentTarget}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (mode === 'inventory') {
                                  setInvColMap((prev) => ({
                                    ...prev,
                                    [header]: val as InventoryTargetField,
                                  }));
                                } else {
                                  setSalesColMap((prev) => ({
                                    ...prev,
                                    [header]: val as SalesTargetField,
                                  }));
                                }
                              }}
                              className={`w-full h-9 px-2.5 text-xs font-medium rounded-md border bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600 ${
                                currentTarget === '__ignore__'
                                  ? 'border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400'
                                  : 'border-blue-300 dark:border-blue-800 text-slate-900 dark:text-slate-100'
                              }`}
                            >
                              {(mode === 'inventory'
                                ? INVENTORY_TARGET_OPTIONS
                                : SALES_TARGET_OPTIONS
                              ).map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 flex flex-wrap items-center justify-between gap-3">
                <div
                  className={`text-xs ${
                    mappingValidation.valid
                      ? 'text-slate-600 dark:text-slate-400'
                      : 'text-amber-800 dark:text-amber-300 font-medium'
                  }`}
                >
                  {mappingValidation.message ?? 'Mappings look ready. Review normalized items next.'}
                </div>
                <button
                  type="button"
                  disabled={!mappingValidation.valid}
                  onClick={() => void handleBuildPreview()}
                  className="h-10 px-5 inline-flex items-center gap-2 text-xs font-semibold rounded-md bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white transition-colors disabled:opacity-40 cursor-pointer"
                >
                  <span>Preview Normalized Result</span>
                  <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: PREVIEW & CONFIRM (INVENTORY) */}
          {step === 'preview' && mode === 'inventory' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800 text-xs">
                <div className="px-4 py-3">
                  <span className="text-slate-500 dark:text-slate-400 block">Total Rows</span>
                  <span className="mt-0.5 text-lg font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100 block">
                    {invSummary.total}
                  </span>
                </div>
                <div className="px-4 py-3">
                  <span className="text-slate-500 dark:text-slate-400 block">New SKUs</span>
                  <span className="mt-0.5 text-lg font-mono tabular-nums font-semibold text-emerald-700 dark:text-emerald-400 block">
                    {invSummary.newCount}
                  </span>
                </div>
                <div className="px-4 py-3">
                  <span className="text-slate-500 dark:text-slate-400 block">Update Existing</span>
                  <span className="mt-0.5 text-lg font-mono tabular-nums font-semibold text-blue-700 dark:text-blue-400 block">
                    {invSummary.updateCount}
                  </span>
                </div>
                <div className="px-4 py-3">
                  <span className="text-slate-500 dark:text-slate-400 block">File Duplicates</span>
                  <span className="mt-0.5 text-lg font-mono tabular-nums font-semibold text-amber-700 dark:text-amber-400 block">
                    {invSummary.dupCount}
                  </span>
                </div>
                <div className="px-4 py-3 col-span-2 sm:col-span-1">
                  <span className="text-slate-500 dark:text-slate-400 block">Dirty / Blocked</span>
                  <span className="mt-0.5 text-lg font-mono tabular-nums font-semibold text-red-700 dark:text-red-400 block">
                    {invSummary.dirtyCount}
                  </span>
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs min-w-[960px]">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 font-semibold text-slate-600 dark:text-slate-400">
                        <th className="px-3 py-2.5 w-12">#</th>
                        <th className="px-3 py-2.5 w-32">Status</th>
                        <th className="px-3 py-2.5">Normalized Name (Title Case · 11oz / 1 L)</th>
                        <th className="px-3 py-2.5 w-24 text-right">Price</th>
                        <th className="px-3 py-2.5 w-24 text-right">Cost</th>
                        <th className="px-3 py-2.5 w-20">HI-5</th>
                        <th className="px-3 py-2.5 w-44">Flags &amp; Issues</th>
                        <th className="px-3 py-2.5 w-40">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {invPreview.map((row) => (
                        <tr
                          key={row.rowIndex}
                          className={
                            row.decision === 'skip'
                              ? 'bg-slate-50/80 dark:bg-slate-950/50 opacity-75'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                          }
                        >
                          <td className="px-3 py-2.5 font-mono tabular-nums text-slate-500">
                            {row.rowIndex}
                          </td>
                          <td className="px-3 py-2.5">
                            <span
                              className={`px-1.5 py-0.5 text-[10px] font-mono font-semibold rounded border whitespace-nowrap ${
                                row.status === 'new'
                                  ? 'text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-900'
                                  : row.status === 'update_existing'
                                    ? 'text-blue-800 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 border-blue-200 dark:border-blue-900'
                                    : row.status === 'duplicate_in_file'
                                      ? 'text-amber-900 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 border-amber-200 dark:border-amber-900'
                                      : 'text-red-800 dark:text-red-300 bg-red-50 dark:bg-red-950/60 border-red-200 dark:border-red-900'
                              }`}
                            >
                              {row.status === 'new'
                                ? 'NEW'
                                : row.status === 'update_existing'
                                  ? 'MATCHED'
                                  : row.status === 'duplicate_in_file'
                                    ? 'DUPLICATE'
                                    : 'DIRTY'}
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="font-semibold text-slate-900 dark:text-slate-100">
                              {row.item.normalized_name || '— Missing Name —'}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              Raw: <span className="font-mono">{row.item.name || '—'}</span> · UPC{' '}
                              <span className="font-mono tabular-nums">{row.item.upc || '—'}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                            {row.item.price > 0 ? (
                              `$${row.item.price.toFixed(2)}`
                            ) : (
                              <span className="text-red-700 dark:text-red-400 font-semibold">Missing</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                            {row.item.cost !== null ? (
                              `$${row.item.cost.toFixed(2)}`
                            ) : (
                              <span className="text-amber-700 dark:text-amber-400">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 font-medium text-slate-700 dark:text-slate-300">
                            {row.item.hi5_eligible}
                          </td>
                          <td className="px-3 py-2.5 text-[11px] text-slate-600 dark:text-slate-400">
                            {row.issues.length > 0 ? row.issues.join(' · ') : 'Clean'}
                          </td>
                          <td className="px-3 py-2">
                            <select
                              aria-label={`Import action for row ${row.rowIndex}`}
                              disabled={row.status === 'dirty'}
                              value={row.decision}
                              onChange={(e) => {
                                const nextDecision = e.target.value as InventoryImportPreviewRow['decision'];
                                setInvPreview((prev) =>
                                  prev.map((r) =>
                                    r.rowIndex === row.rowIndex ? { ...r, decision: nextDecision } : r
                                  )
                                );
                              }}
                              className="w-full h-8 px-2 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 disabled:opacity-50"
                            >
                              {row.matchedCloverId ? (
                                <option value="update">Update Existing</option>
                              ) : (
                                <option value="import">Import New</option>
                              )}
                              <option value="skip">Skip Row</option>
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setStep('map')}
                    className="h-9 px-3.5 inline-flex items-center gap-1.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Back to Column Map</span>
                  </button>

                  <button
                    type="button"
                    disabled={submitting || invPreview.every((r) => r.decision === 'skip')}
                    onClick={() => void handleConfirmSpreadsheetImport()}
                    className="h-10 px-5 inline-flex items-center gap-2 text-xs font-semibold rounded-md bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                    <span>
                      {submitting
                        ? 'Importing...'
                        : `Confirm Import (${invPreview.filter((r) => r.decision !== 'skip').length} rows)`}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: PREVIEW & CONFIRM (SALES) */}
          {step === 'preview' && mode === 'sales' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800 text-xs">
                <div className="px-4 py-3">
                  <span className="text-slate-500 dark:text-slate-400 block">Matched SKUs</span>
                  <span className="mt-0.5 text-lg font-mono tabular-nums font-semibold text-emerald-700 dark:text-emerald-400 block">
                    {salesSummary.matched}
                  </span>
                </div>
                <div className="px-4 py-3">
                  <span className="text-slate-500 dark:text-slate-400 block">Unmatched SKUs</span>
                  <span className="mt-0.5 text-lg font-mono tabular-nums font-semibold text-amber-700 dark:text-amber-400 block">
                    {salesSummary.unmatched}
                  </span>
                </div>
                <div className="px-4 py-3">
                  <span className="text-slate-500 dark:text-slate-400 block">Units Sold</span>
                  <span className="mt-0.5 text-lg font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100 block">
                    {salesSummary.units}
                  </span>
                </div>
                <div className="px-4 py-3">
                  <span className="text-slate-500 dark:text-slate-400 block">Gross Sales</span>
                  <span className="mt-0.5 text-lg font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100 block">
                    ${salesSummary.revenue.toFixed(2)}
                  </span>
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 font-semibold text-slate-600 dark:text-slate-400">
                        <th className="px-3 py-2.5 w-10">Inc</th>
                        <th className="px-3 py-2.5 w-28">Match</th>
                        <th className="px-3 py-2.5">Item &amp; UPC</th>
                        <th className="px-3 py-2.5 w-28">Period</th>
                        <th className="px-3 py-2.5 w-24 text-right">Units Sold</th>
                        <th className="px-3 py-2.5 w-28 text-right">Gross Sales</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {salesPreview.map((row) => (
                        <tr key={row.rowIndex} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="px-3 py-2.5">
                            <input
                              type="checkbox"
                              aria-label={`Include sales row ${row.rowIndex}`}
                              disabled={row.status === 'dirty'}
                              checked={row.include}
                              onChange={(e) =>
                                setSalesPreview((prev) =>
                                  prev.map((r) =>
                                    r.rowIndex === row.rowIndex
                                      ? { ...r, include: e.target.checked }
                                      : r
                                  )
                                )
                              }
                              className="w-4 h-4 rounded border-slate-300 text-blue-600 cursor-pointer"
                            />
                          </td>
                          <td className="px-3 py-2.5">
                            <span
                              className={`px-1.5 py-0.5 text-[10px] font-mono font-semibold rounded border ${
                                row.status === 'matched'
                                  ? 'text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-900'
                                  : row.status === 'unmatched'
                                    ? 'text-amber-900 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 border-amber-200 dark:border-amber-900'
                                    : 'text-red-800 dark:text-red-300 bg-red-50 dark:bg-red-950/60 border-red-200 dark:border-red-900'
                              }`}
                            >
                              {row.status.toUpperCase()}
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="font-semibold text-slate-900 dark:text-slate-100">
                              {row.name}
                            </div>
                            <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                              {row.matchedCloverId ?? 'Unmatched'} · UPC {row.upc || '—'}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-slate-600 dark:text-slate-400">
                            {row.period_label}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums font-medium">
                            {row.units_sold}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums font-medium">
                            ${row.gross_sales.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setStep('map')}
                    className="h-9 px-3.5 inline-flex items-center gap-1.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Back to Column Map</span>
                  </button>

                  <button
                    type="button"
                    disabled={submitting || salesPreview.every((r) => !r.include)}
                    onClick={() => void handleConfirmSpreadsheetImport()}
                    className="h-10 px-5 inline-flex items-center gap-2 text-xs font-semibold rounded-md bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                    <span>{submitting ? 'Saving Sales...' : 'Confirm Sales Import'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: DONE */}
          {step === 'done' && importResult && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-5 max-w-2xl">
              <div className="flex items-start gap-3">
                <CheckCircle2
                  className="w-6 h-6 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <div>
                  <h2 className="text-base font-display font-bold text-slate-900 dark:text-slate-100">
                    {importResult.kind === 'inventory'
                      ? 'Inventory Import Complete'
                      : 'Clover Sales Export Loaded'}
                  </h2>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                    File <span className="font-mono">{filename}</span> processed cleanly.
                    {importResult.kind === 'sales'
                      ? ' Sales adapter source is now set to Clover CSV Export.'
                      : ' New and updated SKUs are immediately available in the Inventory Grid.'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono tabular-nums pt-2 border-t border-slate-200 dark:border-slate-800">
                <div>
                  <span className="font-sans text-slate-500 dark:text-slate-400 block">
                    {importResult.kind === 'inventory' ? 'Created' : 'Sales Rows'}
                  </span>
                  <span className="text-base font-semibold text-emerald-700 dark:text-emerald-400">
                    {importResult.importedCount}
                  </span>
                </div>
                <div>
                  <span className="font-sans text-slate-500 dark:text-slate-400 block">Updated</span>
                  <span className="text-base font-semibold text-blue-700 dark:text-blue-400">
                    {importResult.updatedCount}
                  </span>
                </div>
                <div>
                  <span className="font-sans text-slate-500 dark:text-slate-400 block">Flagged</span>
                  <span className="text-base font-semibold text-amber-700 dark:text-amber-400">
                    {importResult.flaggedCount}
                  </span>
                </div>
                <div>
                  <span className="font-sans text-slate-500 dark:text-slate-400 block">Skipped</span>
                  <span className="text-base font-semibold text-slate-700 dark:text-slate-300">
                    {importResult.duplicatesSkipped}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={importResult.kind === 'inventory' ? onNavigateInventory : onNavigateSettings}
                  className="h-10 px-4 text-xs font-semibold rounded-md bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white cursor-pointer"
                >
                  {importResult.kind === 'inventory'
                    ? 'Open Inventory Grid'
                    : 'View Sales Adapter in Settings'}
                </button>
                <button
                  type="button"
                  onClick={resetSpreadsheetState}
                  className="h-10 px-4 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Import Another File
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ==================== INVOICE PDF / IMAGE OCR FLOW ==================== */}
      {mode === 'invoice' && (
        <div className="space-y-4">
          {!invoiceDoc && !invoiceDone && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-6">
              <div className="max-w-2xl">
                <h2 className="text-base font-display font-bold text-slate-900 dark:text-slate-100">
                  Invoice PDF &amp; Photo OCR Extraction
                </h2>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                  Upload a vendor invoice PDF or counter photo. OCR extracts product descriptions,
                  UPCs, case costs, and pack counts into an editable review table so you verify
                  every unit cost before saving.
                </p>
              </div>

              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files?.[0];
                  if (file) void runOcrExtraction({ file });
                }}
                className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-lg p-8 text-center bg-slate-50/60 dark:bg-slate-950/40 space-y-3"
              >
                <Receipt className="w-7 h-7 mx-auto text-slate-400 dark:text-slate-500" aria-hidden="true" />
                <div className="text-sm font-medium text-slate-800 dark:text-slate-200">
                  {ocrLoading
                    ? 'Running OCR line-item extraction...'
                    : 'Drop a distributor invoice PDF or photo here'}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Accepts PDF, JPG, PNG, WebP · Never saves costs without your review
                </div>
                <input
                  ref={ocrInputRef}
                  type="file"
                  accept=".pdf,image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void runOcrExtraction({ file });
                  }}
                  className="sr-only"
                />
                <div className="pt-1">
                  <button
                    type="button"
                    disabled={ocrLoading}
                    onClick={() => ocrInputRef.current?.click()}
                    className="h-10 px-5 text-xs font-semibold rounded-md bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {ocrLoading ? 'Extracting...' : 'Choose Invoice PDF or Image'}
                  </button>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Test OCR extraction with a sample Honolulu distributor invoice:
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  {SAMPLE_INVOICE_OCR_TEMPLATES.map((tpl) => (
                    <button
                      key={tpl.id}
                      type="button"
                      disabled={ocrLoading}
                      onClick={() => void runOcrExtraction({ sampleId: tpl.id })}
                      className="h-9 px-3.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap cursor-pointer"
                    >
                      {tpl.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {invoiceDoc && !invoiceDone && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
              {/* Editable Invoice Header */}
              <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-display font-bold text-slate-900 dark:text-slate-100">
                      Review Extracted Invoice Line Items
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Source file: <span className="font-mono">{invoiceDoc.filename}</span> · Unit
                      Cost = Case Cost ÷ Packs/Case
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={resetInvoiceState}
                    className="h-9 px-3 inline-flex items-center gap-1.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Scan Another Invoice</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label
                      htmlFor="ocr-vendor"
                      className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1"
                    >
                      Vendor / Distributor
                    </label>
                    <input
                      id="ocr-vendor"
                      type="text"
                      value={invoiceVendor}
                      onChange={(e) => setInvoiceVendor(e.target.value)}
                      className="w-full h-9 px-3 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="ocr-inv-num"
                      className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1"
                    >
                      Invoice Number
                    </label>
                    <input
                      id="ocr-inv-num"
                      type="text"
                      value={invoiceNumber}
                      onChange={(e) => setInvoiceNumber(e.target.value)}
                      className="w-full h-9 px-3 text-xs font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="ocr-inv-date"
                      className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1"
                    >
                      Invoice Date
                    </label>
                    <input
                      id="ocr-inv-date"
                      type="date"
                      value={invoiceDate}
                      onChange={(e) => setInvoiceDate(e.target.value)}
                      className="w-full h-9 px-3 text-xs font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                    />
                  </div>
                </div>
              </div>

              {/* Editable Line Items Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs min-w-[960px]">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 font-semibold text-slate-600 dark:text-slate-400">
                      <th className="px-3 py-2.5 w-10">Inc</th>
                      <th className="px-3 py-2.5 w-28">SKU Match</th>
                      <th className="px-3 py-2.5">Product Description (Editable)</th>
                      <th className="px-2 py-2.5 w-32">UPC</th>
                      <th className="px-2 py-2.5 w-24 text-right">Case Cost</th>
                      <th className="px-2 py-2.5 w-20 text-right">Sell Pk</th>
                      <th className="px-2 py-2.5 w-22 text-right">Pks/Case</th>
                      <th className="px-3 py-2.5 w-24 text-right">Unit Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {invoiceLines.map((line) => (
                      <tr
                        key={line.lineId}
                        className={!line.include ? 'opacity-60 bg-slate-50/70 dark:bg-slate-950/40' : ''}
                      >
                        <td className="px-3 py-2.5 align-middle">
                          <input
                            type="checkbox"
                            aria-label={`Include invoice line ${line.normalized_name}`}
                            checked={line.include}
                            onChange={(e) =>
                              updateInvoiceLine(line.lineId, { include: e.target.checked })
                            }
                            className="w-4 h-4 rounded border-slate-300 text-blue-600 cursor-pointer"
                          />
                        </td>
                        <td className="px-3 py-2.5 align-middle">
                          <span
                            className={`px-1.5 py-0.5 text-[10px] font-mono font-semibold rounded border whitespace-nowrap ${
                              line.matchedCloverId
                                ? 'text-blue-800 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 border-blue-200 dark:border-blue-900'
                                : 'text-amber-900 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 border-amber-200 dark:border-amber-900'
                            }`}
                          >
                            {line.matchedCloverId ? 'UPDATE COST' : 'NEW DRAFT'}
                          </span>
                          <div className="mt-0.5 text-[10px] font-mono text-slate-500">
                            {line.matchedCloverId ?? 'Needs shelf price'}
                          </div>
                        </td>
                        <td className="px-3 py-2 align-middle">
                          <input
                            type="text"
                            aria-label={`Product name for line ${line.lineId}`}
                            value={line.normalized_name}
                            onChange={(e) =>
                              updateInvoiceLine(line.lineId, { normalized_name: e.target.value })
                            }
                            className="w-full h-8 px-2 text-xs font-medium rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                          />
                          <div className="mt-0.5 text-[10px] font-mono text-slate-500 dark:text-slate-400">
                            OCR Raw: {line.raw_description} · Confidence: {line.confidence}
                          </div>
                        </td>
                        <td className="px-2 py-2 align-middle">
                          <input
                            type="text"
                            aria-label={`UPC for line ${line.lineId}`}
                            value={line.upc}
                            onChange={(e) => updateInvoiceLine(line.lineId, { upc: e.target.value })}
                            className="w-full h-8 px-2 text-xs font-mono tabular-nums rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                          />
                        </td>
                        <td className="px-2 py-2 align-middle">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            aria-label={`Case cost for line ${line.lineId}`}
                            value={line.case_cost ?? ''}
                            onChange={(e) =>
                              updateInvoiceLine(line.lineId, {
                                case_cost: e.target.value === '' ? null : Number(e.target.value),
                              })
                            }
                            className="w-full h-8 px-2 text-right text-xs font-mono tabular-nums rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                          />
                        </td>
                        <td className="px-2 py-2 align-middle">
                          <input
                            type="number"
                            min="1"
                            aria-label={`Sell pack qty for line ${line.lineId}`}
                            value={line.sell_pack_qty ?? ''}
                            onChange={(e) =>
                              updateInvoiceLine(line.lineId, {
                                sell_pack_qty: e.target.value === '' ? null : Number(e.target.value),
                              })
                            }
                            className="w-full h-8 px-2 text-right text-xs font-mono tabular-nums rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                          />
                        </td>
                        <td className="px-2 py-2 align-middle">
                          <input
                            type="number"
                            min="1"
                            placeholder="Req."
                            aria-label={`Packs per case for line ${line.lineId}`}
                            value={line.packs_per_case ?? ''}
                            onChange={(e) =>
                              updateInvoiceLine(line.lineId, {
                                packs_per_case: e.target.value === '' ? null : Number(e.target.value),
                              })
                            }
                            className={`w-full h-8 px-2 text-right text-xs font-mono tabular-nums rounded border bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 ${
                              line.packs_per_case === null
                                ? 'border-amber-400 dark:border-amber-600'
                                : 'border-slate-300 dark:border-slate-700'
                            }`}
                          />
                        </td>
                        <td className="px-3 py-2.5 align-middle text-right font-mono tabular-nums font-semibold">
                          {line.unit_cost !== null ? (
                            <span className="text-emerald-700 dark:text-emerald-400">
                              ${line.unit_cost.toFixed(2)}
                            </span>
                          ) : (
                            <span className="text-amber-700 dark:text-amber-400 text-[11px]">
                              Need pks/cs
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Existing SKUs update cost &amp; pack config only — authoritative shelf prices stay untouched.
                </span>
                <button
                  type="button"
                  disabled={submitting || invoiceLines.every((l) => !l.include)}
                  onClick={() => void handleSaveInvoiceLines()}
                  className="h-10 px-5 inline-flex items-center gap-2 text-xs font-semibold rounded-md bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                  <span>
                    {submitting
                      ? 'Saving Costs...'
                      : `Save Approved Line Items (${invoiceLines.filter((l) => l.include).length})`}
                  </span>
                </button>
              </div>
            </div>
          )}

          {invoiceDone && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-4 max-w-2xl">
              <div className="flex items-start gap-3">
                <CheckCircle2
                  className="w-6 h-6 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <div>
                  <h2 className="text-base font-display font-bold text-slate-900 dark:text-slate-100">
                    Invoice Costs Saved ({invoiceVendor} · #{invoiceNumber})
                  </h2>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                    Updated {invoiceDone.updatedCount} existing SKU costs and added{' '}
                    {invoiceDone.importedCount} new draft SKU
                    {invoiceDone.importedCount === 1 ? '' : 's'} for review.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={onNavigateInventory}
                  className="h-10 px-4 text-xs font-semibold rounded-md bg-blue-700 hover:bg-blue-800 text-white cursor-pointer"
                >
                  Open Inventory Grid
                </button>
                <button
                  type="button"
                  onClick={resetInvoiceState}
                  className="h-10 px-4 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 cursor-pointer"
                >
                  Scan Another Invoice
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
