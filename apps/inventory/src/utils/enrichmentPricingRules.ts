import {
  CanonicalItem,
  EnrichContractUpdate,
  EnrichLookupType,
  EnrichProposal,
  Hi5Status,
  ItemFlag,
  PatchItemPayload,
  PricingSuggestionRow,
} from '../types/inventory';
import { normalizeItemName, recomputeItemFlags } from './inventoryRules';

export type EnrichmentGapKey = 'logo' | 'image' | 'cost' | 'pack' | 'vendor';
export type ProposalDecision = 'pending' | 'accepted' | 'rejected';

export function getRecommendedLookupTasks(item: CanonicalItem): EnrichLookupType[] {
  const tasks: EnrichLookupType[] = [];
  if (item.upc && item.upc.replace(/\D/g, '').length >= 8) {
    tasks.push('upc_lookup');
  }
  if (!item.logo_url) tasks.push('logo');
  if (!item.image_url) tasks.push('image');
  if (item.cost === null || !item.vendor) tasks.push('vendor_cost');
  if (
    item.sell_pack_qty === null ||
    item.packs_per_case === null ||
    !item.unit_size ||
    !item.brand ||
    normalizeItemName(item.name || item.normalized_name) !== item.normalized_name
  ) {
    tasks.push('gemini_context');
  }
  return tasks.length > 0
    ? tasks
    : ['upc_lookup', 'logo', 'image', 'vendor_cost', 'gemini_context'];
}

export interface PricingImpactSummary {
  selectedCount: number;
  safeSelectedCount: number;
  flaggedSelectedCount: number;
  totalUnitsAffected: number;
  currentShelfValue: number;
  projectedShelfValue: number;
  shelfValueDelta: number;
  avgPercentChange: number | null;
}

const SWING_THRESHOLD_PCT = 20;

export function getItemMissingGaps(item: CanonicalItem): EnrichmentGapKey[] {
  const gaps: EnrichmentGapKey[] = [];
  if (!item.logo_url) gaps.push('logo');
  if (!item.image_url) gaps.push('image');
  if (item.cost === null) gaps.push('cost');
  if (item.sell_pack_qty === null || item.packs_per_case === null) gaps.push('pack');
  if (!item.vendor) gaps.push('vendor');
  return gaps;
}

export type EnrichmentQueueFilter =
  | 'all_gaps'
  | 'missing_logo'
  | 'missing_image'
  | 'missing_cost'
  | 'missing_pack'
  | 'all_items';

export function filterEnrichmentQueue(
  items: CanonicalItem[],
  filter: EnrichmentQueueFilter,
  search = ''
): CanonicalItem[] {
  const q = search.trim().toLowerCase();

  return items
    .filter((item) => {
      const gaps = getItemMissingGaps(item);
      if (filter === 'all_gaps' && gaps.length === 0) return false;
      if (filter === 'missing_logo' && !gaps.includes('logo')) return false;
      if (filter === 'missing_image' && !gaps.includes('image')) return false;
      if (filter === 'missing_cost' && !gaps.includes('cost')) return false;
      if (filter === 'missing_pack' && !gaps.includes('pack')) return false;

      if (q) {
        const haystack = [
          item.normalized_name,
          item.name,
          item.brand,
          item.upc,
          item.vendor ?? '',
          item.clover_id,
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const gapDiff = getItemMissingGaps(b).length - getItemMissingGaps(a).length;
      if (gapDiff !== 0) return gapDiff;
      return a.normalized_name.localeCompare(b.normalized_name);
    });
}

/**
 * Builds a PATCH payload strictly from proposals explicitly accepted by the user.
 * Pending or rejected proposals are never written, guaranteeing zero silent overwrites.
 */
export function buildPatchFromAcceptedProposals(
  proposals: EnrichProposal[],
  decisions: Record<string, ProposalDecision>
): PatchItemPayload {
  const patch: PatchItemPayload = {};

  for (const proposal of proposals) {
    if (decisions[proposal.field] !== 'accepted') continue;

    switch (proposal.field) {
      case 'normalized_name':
        if (typeof proposal.proposedValue === 'string') {
          patch.normalized_name = normalizeItemName(proposal.proposedValue);
        }
        break;
      case 'brand':
      case 'category':
      case 'subcategory':
      case 'unit_size':
      case 'upc':
        if (typeof proposal.proposedValue === 'string') {
          patch[proposal.field] = proposal.proposedValue.trim();
        }
        break;
      case 'vendor':
      case 'logo_url':
      case 'image_url':
        if (typeof proposal.proposedValue === 'string' || proposal.proposedValue === null) {
          patch[proposal.field] = proposal.proposedValue;
        }
        break;
      case 'cost':
        if (typeof proposal.proposedValue === 'number' && Number.isFinite(proposal.proposedValue)) {
          patch.cost = Math.round(proposal.proposedValue * 100) / 100;
          patch.cost_source = proposal.source;
        }
        break;
      case 'sell_pack_qty':
      case 'packs_per_case':
        if (typeof proposal.proposedValue === 'number' && Number.isFinite(proposal.proposedValue)) {
          patch[proposal.field] = Math.round(proposal.proposedValue);
        }
        break;
      case 'hi5_eligible':
        if (
          proposal.proposedValue === 'Yes' ||
          proposal.proposedValue === 'No' ||
          proposal.proposedValue === 'Confirm'
        ) {
          patch.hi5_eligible = proposal.proposedValue as Hi5Status;
        }
        break;
      default:
        break;
    }
  }

  return patch;
}

/**
 * Converts API contract updates (`{ item_id, field, old, new, source }`) from
 * `GET /api/enrich/:job_id` into reviewable `EnrichProposal` entries.
 */
export function normalizeContractUpdatesToProposals(
  updates: EnrichContractUpdate[],
  targetItemId?: string
): EnrichProposal[] {
  const seen = new Map<string, EnrichProposal>();
  for (const upd of updates) {
    if (targetItemId && upd.item_id && upd.item_id !== targetItemId) {
      continue;
    }
    seen.set(String(upd.field), {
      field: upd.field,
      currentValue: upd.old ?? null,
      proposedValue: upd.new ?? null,
      source: upd.source || 'Enrichment API',
      sourceUrl: upd.sourceUrl,
      note: upd.note,
      confidence: upd.confidence ?? 'high',
    });
  }
  return Array.from(seen.values());
}

/**
 * Computes which status flags are cleared after applying an enrichment patch to an item
 * and returns a PATCH payload containing the updated flags when flag state changes.
 *
 * Rules:
 * - Saving a positive `cost` clears `NO_COST`.
 * - Saving valid `sell_pack_qty` and `packs_per_case` clears `NEED_PACK_CONFIG`.
 * - Setting `hi5_eligible` to 'Yes' or 'No' clears `HI5_CONFIRM`.
 * - Passing `clearReview: true` explicitly clears the manual `REVIEW` flag.
 */
export function computeEnrichmentFlagResolution(
  item: CanonicalItem,
  patch: PatchItemPayload,
  options?: { clearReview?: boolean }
): {
  nextFlags: ItemFlag[];
  clearedFlags: ItemFlag[];
  patchWithFlags: PatchItemPayload;
} {
  const candidate: CanonicalItem = {
    ...item,
    ...patch,
    flags: [...item.flags],
  };

  const clearReview = options?.clearReview ?? false;
  const nextFlags = recomputeItemFlags(candidate, {
    preserveReview: clearReview ? false : item.flags.includes('REVIEW'),
  });

  const clearedFlags = item.flags.filter((flag) => !nextFlags.includes(flag));
  const flagsChanged =
    nextFlags.length !== item.flags.length ||
    nextFlags.some((flag, idx) => item.flags[idx] !== flag);

  const patchWithFlags: PatchItemPayload = flagsChanged
    ? { ...patch, flags: nextFlags }
    : { ...patch };

  return { nextFlags, clearedFlags, patchWithFlags };
}

/**
 * Computes display-only pricing review rows from server-provided suggested_price values.
 * Never invents or calculates a suggested price when suggested_price is null.
 */
export function buildPricingSuggestionRows(items: CanonicalItem[]): PricingSuggestionRow[] {
  return items
    .map((item) => {
      const hasSuggestion =
        item.suggested_price !== null && Number.isFinite(item.suggested_price);
      const percentChange =
        hasSuggestion && item.price > 0
          ? Math.round((((item.suggested_price as number) - item.price) / item.price) * 1000) / 10
          : null;

      const reasons: string[] = [];

      if (!hasSuggestion) {
        reasons.push('No server suggestion');
      } else if (item.suggested_price === item.price) {
        reasons.push('No price change');
      } else {
        if ((item.suggested_price as number) < item.price || item.flags.includes('PRICE_DROP')) {
          reasons.push('Price drop');
        }
        if (percentChange !== null && Math.abs(percentChange) > SWING_THRESHOLD_PCT) {
          reasons.push(`>${SWING_THRESHOLD_PCT}% swing`);
        }
      }

      if (item.cost === null || item.flags.includes('NO_COST')) {
        reasons.push('Missing cost');
      }
      if (item.flags.includes('NEED_PACK_CONFIG')) {
        reasons.push('Missing pack config');
      }
      if (item.flags.includes('REVIEW')) {
        reasons.push('Needs review');
      }

      const excludedFromBulk = reasons.length > 0;

      return {
        clover_id: item.clover_id,
        normalized_name: item.normalized_name,
        brand: item.brand,
        category: item.category,
        vendor: item.vendor,
        logo_url: item.logo_url,
        current_price: item.price,
        suggested_price: hasSuggestion ? item.suggested_price : null,
        percent_change: percentChange,
        cost: item.cost,
        quantity: item.quantity,
        flags: [...item.flags],
        excluded_from_bulk: excludedFromBulk,
        exclusion_reasons: reasons,
      };
    })
    .sort((a, b) => {
      // Actionable safe changes first, then actionable flagged changes, then no-suggestion rows
      const rank = (row: PricingSuggestionRow): number => {
        if (row.suggested_price !== null && row.suggested_price !== row.current_price && !row.excluded_from_bulk) {
          return 0;
        }
        if (row.suggested_price !== null && row.suggested_price !== row.current_price) {
          return 1;
        }
        return 2;
      };
      const diff = rank(a) - rank(b);
      if (diff !== 0) return diff;
      return a.normalized_name.localeCompare(b.normalized_name);
    });
}

export function isRowActionable(row: PricingSuggestionRow): boolean {
  return row.suggested_price !== null && row.suggested_price !== row.current_price;
}

/**
 * Returns only safe, non-flagged SKU IDs eligible for Bulk Select Safe Changes.
 */
export function getSafeSelectableCloverIds(rows: PricingSuggestionRow[]): string[] {
  return rows
    .filter((row) => isRowActionable(row) && !row.excluded_from_bulk)
    .map((row) => row.clover_id);
}

/**
 * Aggregates shelf-value impact strictly across rows toggled ON by the user.
 */
export function computePricingImpact(
  rows: PricingSuggestionRow[],
  selectedIds: ReadonlySet<string>
): PricingImpactSummary {
  let selectedCount = 0;
  let safeSelectedCount = 0;
  let flaggedSelectedCount = 0;
  let totalUnitsAffected = 0;
  let currentShelfValue = 0;
  let projectedShelfValue = 0;
  let percentSum = 0;
  let percentCount = 0;

  for (const row of rows) {
    if (!selectedIds.has(row.clover_id)) continue;
    if (!isRowActionable(row)) continue;

    const suggested = row.suggested_price as number;
    selectedCount += 1;
    if (row.excluded_from_bulk) {
      flaggedSelectedCount += 1;
    } else {
      safeSelectedCount += 1;
    }

    const qty = Math.max(0, row.quantity);
    totalUnitsAffected += qty;
    currentShelfValue += row.current_price * qty;
    projectedShelfValue += suggested * qty;

    if (row.percent_change !== null) {
      percentSum += row.percent_change;
      percentCount += 1;
    }
  }

  const roundedCurrent = Math.round(currentShelfValue * 100) / 100;
  const roundedProjected = Math.round(projectedShelfValue * 100) / 100;

  return {
    selectedCount,
    safeSelectedCount,
    flaggedSelectedCount,
    totalUnitsAffected,
    currentShelfValue: roundedCurrent,
    projectedShelfValue: roundedProjected,
    shelfValueDelta: Math.round((roundedProjected - roundedCurrent) * 100) / 100,
    avgPercentChange:
      percentCount > 0 ? Math.round((percentSum / percentCount) * 10) / 10 : null,
  };
}
