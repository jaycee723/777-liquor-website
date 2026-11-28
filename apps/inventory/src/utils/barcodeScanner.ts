import { CanonicalItem } from '../types/inventory';

export interface NormalizedBarcodeResult {
  code: string;
  formatHint: 'UPC-A' | 'EAN-13' | 'UPC-E / EAN-8' | 'Code 128 / SKU' | 'Invalid';
  valid: boolean;
  warning?: string;
}

/**
 * Normalizes a raw barcode string from a mobile camera, USB/Bluetooth scanner,
 * or manual entry. Rejects QR URLs (matching core/ingest.py QR_URL_IN_UPC rule).
 */
export function normalizeScannedBarcode(raw: string): NormalizedBarcodeResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { code: '', formatHint: 'Invalid', valid: false, warning: 'Empty barcode.' };
  }

  if (/^https?:\/\//i.test(trimmed) || trimmed.includes('://')) {
    return {
      code: '',
      formatHint: 'Invalid',
      valid: false,
      warning: 'QR URL detected — scan the product UPC barcode instead.',
    };
  }

  const compact = trimmed.replace(/[\s-]+/g, '');
  const digitsOnly = /^\d+$/.test(compact);

  if (digitsOnly) {
    if (compact.length === 12) {
      return { code: compact, formatHint: 'UPC-A', valid: true };
    }
    if (compact.length === 13) {
      return { code: compact, formatHint: 'EAN-13', valid: true };
    }
    if (compact.length === 8) {
      return { code: compact, formatHint: 'UPC-E / EAN-8', valid: true };
    }
    if (compact.length === 11) {
      // Common spreadsheet-stripped leading zero on UPC-A
      return { code: `0${compact}`, formatHint: 'UPC-A', valid: true };
    }
    if (compact.length >= 6 && compact.length <= 14) {
      return {
        code: compact,
        formatHint: 'Code 128 / SKU',
        valid: true,
        warning: `Non-standard numeric length (${compact.length} digits).`,
      };
    }
    return {
      code: compact,
      formatHint: 'Invalid',
      valid: false,
      warning: 'Barcode must be a valid 8-, 12-, or 13-digit UPC/EAN.',
    };
  }

  if (/^[A-Za-z0-9._-]{4,36}$/.test(compact)) {
    return { code: compact, formatHint: 'Code 128 / SKU', valid: true };
  }

  return {
    code: '',
    formatHint: 'Invalid',
    valid: false,
    warning: 'Unrecognized barcode characters.',
  };
}

/**
 * Compares a stored catalog UPC against a scanned barcode, handling the standard
 * retail UPC-A (12-digit) <-> EAN-13 (leading-zero 13-digit) equivalence.
 */
export function matchesItemBarcode(storedUpc: string | null | undefined, scannedCode: string): boolean {
  if (!storedUpc || !scannedCode) return false;
  const a = storedUpc.replace(/\D/g, '');
  const b = scannedCode.replace(/\D/g, '');

  if (a && b) {
    if (a === b) return true;
    const normA = a.replace(/^0+/, '');
    const normB = b.replace(/^0+/, '');
    if (normA.length >= 8 && normA === normB) return true;
  }

  return storedUpc.trim().toLowerCase() === scannedCode.trim().toLowerCase();
}

/**
 * Finds the first matching canonical item by UPC/EAN barcode or Clover ID.
 */
export function findItemByBarcode(
  items: CanonicalItem[],
  scannedCode: string
): CanonicalItem | null {
  const clean = scannedCode.trim();
  if (!clean) return null;

  const byUpc = items.find((item) => matchesItemBarcode(item.upc, clean));
  if (byUpc) return byUpc;

  const lower = clean.toLowerCase();
  return items.find((item) => item.clover_id.toLowerCase() === lower) ?? null;
}
