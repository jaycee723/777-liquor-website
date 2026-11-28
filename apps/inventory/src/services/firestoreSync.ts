import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { CanonicalItem, ItemFlag } from '../types/inventory';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';

const VALID_ID_REGEX = /^[a-zA-Z0-9_-]+$/;
const ALLOWED_FLAGS = new Set<ItemFlag>([
  'NO_COST',
  'NEED_PACK_CONFIG',
  'PRICE_DROP',
  'REVIEW',
  'HI5_CONFIRM',
]);

function toSafeDocId(raw: string): string {
  const cleaned = raw.trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  if (cleaned && VALID_ID_REGEX.test(cleaned)) return cleaned;
  return `SKU_${Date.now()}`;
}

function clampStr(value: string | null | undefined, maxLen: number, fallback = ''): string {
  const s = (value ?? fallback).trim();
  return s.slice(0, maxLen);
}

function clampOptionalStr(value: string | null | undefined, maxLen: number): string | null {
  if (!value) return null;
  const s = value.trim();
  return s ? s.slice(0, maxLen) : null;
}

function clampNonNegativeNum(value: number | null | undefined, max: number): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.min(max, Math.max(0, value));
}

function sanitizeFlags(flags: ItemFlag[]): ItemFlag[] {
  const unique: ItemFlag[] = [];
  for (const f of flags) {
    if (ALLOWED_FLAGS.has(f) && !unique.includes(f)) {
      unique.push(f);
    }
    if (unique.length >= 5) break;
  }
  return unique;
}

/**
 * Ensures the authenticated Google user has a compliant profile document in /users/{uid}.
 */
export async function syncFirebaseUserProfile(user: User): Promise<void> {
  if (!user.uid || !user.emailVerified) return;
  const userPath = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);

  try {
    const snap = await getDoc(ref);
    const safeDisplayName = clampStr(user.displayName || user.email?.split('@')[0], 120, 'Store Staff');
    const safeEmail = clampStr(user.email, 200, 'staff@777liquor.com');

    if (!snap.exists()) {
      await setDoc(ref, {
        uid: user.uid,
        email: safeEmail,
        displayName: safeDisplayName,
        role: 'staff',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        displayName: safeDisplayName,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }
}

function toFirestoreItemFields(item: CanonicalItem, ownerUid: string) {
  const safeId = toSafeDocId(item.clover_id);
  const safeName = clampStr(item.name || item.normalized_name, 200, 'Unnamed Item');
  const safeNorm = clampStr(item.normalized_name || safeName, 200, safeName);
  const safeCategory = clampStr(item.category, 64, 'Uncategorized');

  return {
    clover_id: safeId,
    ownerUid,
    name: safeName,
    normalized_name: safeNorm,
    brand: clampStr(item.brand, 120),
    category: safeCategory,
    subcategory: clampStr(item.subcategory, 64),
    upc: clampStr(item.upc, 32),
    price: clampNonNegativeNum(item.price, 100000) ?? 0,
    cost: clampNonNegativeNum(item.cost, 100000),
    cost_source: clampOptionalStr(item.cost_source, 160),
    vendor: clampOptionalStr(item.vendor, 120),
    unit_size: clampStr(item.unit_size, 40),
    sell_pack_qty: clampNonNegativeNum(item.sell_pack_qty, 100000),
    packs_per_case: clampNonNegativeNum(item.packs_per_case, 100000),
    hi5_eligible:
      item.hi5_eligible === 'Yes' || item.hi5_eligible === 'No' || item.hi5_eligible === 'Confirm'
        ? item.hi5_eligible
        : 'No',
    logo_url: clampOptionalStr(item.logo_url, 1024),
    image_url: clampOptionalStr(item.image_url, 1024),
    quantity: Math.round(clampNonNegativeNum(item.quantity, 1000000) ?? 0),
    flags: sanitizeFlags(item.flags),
    suggested_price: clampNonNegativeNum(item.suggested_price, 100000),
  };
}

export async function loadFirestoreInventoryItems(): Promise<CanonicalItem[]> {
  const user = auth.currentUser;
  if (!user) return [];

  const path = 'items';
  try {
    const q = query(collection(db, path), where('ownerUid', '==', user.uid));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => {
      const data = d.data();
      return {
        clover_id: String(data.clover_id || d.id),
        name: String(data.name || ''),
        normalized_name: String(data.normalized_name || data.name || ''),
        brand: String(data.brand || ''),
        category: String(data.category || 'Uncategorized'),
        subcategory: String(data.subcategory || ''),
        upc: String(data.upc || ''),
        price: typeof data.price === 'number' ? data.price : 0,
        cost: typeof data.cost === 'number' ? data.cost : null,
        cost_source: typeof data.cost_source === 'string' ? data.cost_source : null,
        vendor: typeof data.vendor === 'string' ? data.vendor : null,
        unit_size: String(data.unit_size || ''),
        sell_pack_qty: typeof data.sell_pack_qty === 'number' ? data.sell_pack_qty : null,
        packs_per_case: typeof data.packs_per_case === 'number' ? data.packs_per_case : null,
        hi5_eligible:
          data.hi5_eligible === 'Yes' || data.hi5_eligible === 'No' || data.hi5_eligible === 'Confirm'
            ? data.hi5_eligible
            : 'No',
        logo_url: typeof data.logo_url === 'string' ? data.logo_url : null,
        image_url: typeof data.image_url === 'string' ? data.image_url : null,
        quantity: typeof data.quantity === 'number' ? data.quantity : 0,
        flags: Array.isArray(data.flags) ? (data.flags as ItemFlag[]) : [],
        suggested_price: typeof data.suggested_price === 'number' ? data.suggested_price : null,
      };
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function upsertFirestoreInventoryItems(items: CanonicalItem[]): Promise<number> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified || items.length === 0) return 0;

  let saved = 0;
  // Firestore writeBatch limit is 500 ops; chunk safely at 200
  for (let i = 0; i < items.length; i += 200) {
    const chunk = items.slice(i, i + 200);
    const batch = writeBatch(db);

    for (const item of chunk) {
      const fields = toFirestoreItemFields(item, user.uid);
      const docRef = doc(db, 'items', fields.clover_id);
      const existingSnap = await getDoc(docRef).catch(() => null);

      if (existingSnap && existingSnap.exists()) {
        const { clover_id: _cid, ownerUid: _ouid, ...mutableFields } = fields;
        batch.update(docRef, {
          ...mutableFields,
          updatedAt: serverTimestamp(),
        });
      } else {
        batch.set(docRef, {
          ...fields,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      saved += 1;
    }

    try {
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'items');
    }
  }

  return saved;
}

export async function saveFirestoreStoreSnapshot(
  docType: 'analytics_summary' | 'cooler_door_push',
  fields: {
    sales_source?: 'clover_export' | 'clover_api' | 'none';
    source_filename?: string | null;
    total_revenue?: number;
    units_sold?: number;
    publishedCount?: number;
    publishedAt?: string;
  }
): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;

  const docId = toSafeDocId(`${docType}_${user.uid}`);
  const path = `storeState/${docId}`;
  const ref = doc(db, 'storeState', docId);

  const sanitized = {
    ...(fields.sales_source ? { sales_source: fields.sales_source } : {}),
    ...(fields.source_filename !== undefined
      ? { source_filename: clampOptionalStr(fields.source_filename, 200) }
      : {}),
    ...(fields.total_revenue !== undefined
      ? { total_revenue: clampNonNegativeNum(fields.total_revenue, 1000000) ?? 0 }
      : {}),
    ...(fields.units_sold !== undefined
      ? { units_sold: Math.round(clampNonNegativeNum(fields.units_sold, 1000000) ?? 0) }
      : {}),
    ...(fields.publishedCount !== undefined
      ? { publishedCount: Math.round(clampNonNegativeNum(fields.publishedCount, 1000000) ?? 0) }
      : {}),
    ...(fields.publishedAt !== undefined
      ? { publishedAt: clampOptionalStr(fields.publishedAt, 64) }
      : {}),
  };

  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      await updateDoc(ref, {
        ...sanitized,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        docType,
        ownerUid: user.uid,
        ...sanitized,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}
