import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "./firebase";
import { normalizeCategory, normalizeInventoryText, type InventoryItem } from "./inventory";

// Blueprint volumetric boundaries & constraints (synced with firebase-blueprint.json)
const MAX_ID_LENGTH = 128;
const MAX_NAME_LENGTH = 140;
const MAX_BRAND_LENGTH = 80;
const MAX_SIZE_LENGTH = 40;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_ABV_LENGTH = 20;
const MAX_ORIGIN_LENGTH = 80;
const MAX_PRICE = 10000;
const ALLOWED_CATEGORIES = new Set(["Beer", "RTD", "Spirits", "Wine", "Beverages"]);
const VALID_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

const COOLER_ITEMS_COLLECTION = "coolerItems";

export type SaveCoolerItemInput = {
  id?: string;
  name: string;
  brand: string;
  category: string;
  size: string;
  price: number;
  description?: string;
  abv?: string;
  origin?: string;
  inStock?: boolean;
};

export function toSafeDocumentId(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_ID_LENGTH);
  if (cleaned && VALID_ID_PATTERN.test(cleaned)) {
    return cleaned;
  }
  return `item-${Date.now()}`;
}

function buildValidatedPayload(input: SaveCoolerItemInput, uid: string) {
  const name = normalizeInventoryText(input.name).slice(0, MAX_NAME_LENGTH).trim();
  const brand = normalizeInventoryText(input.brand).slice(0, MAX_BRAND_LENGTH).trim();
  const normalizedCat = normalizeCategory(input.category);
  const category = ALLOWED_CATEGORIES.has(normalizedCat) ? normalizedCat : "Beverages";
  const size = normalizeInventoryText(input.size).slice(0, MAX_SIZE_LENGTH).trim();
  const price = Math.round(Number(input.price) * 100) / 100;

  if (!name) throw new Error("Product name is required.");
  if (!brand) throw new Error("Brand name is required.");
  if (!Number.isFinite(price) || price <= 0 || price > MAX_PRICE) {
    throw new Error("Price must be a positive number up to $10,000.");
  }
  if (!VALID_ID_PATTERN.test(uid) || uid.length > MAX_ID_LENGTH) {
    throw new Error("Invalid administrator identifier.");
  }

  const description = input.description?.trim().slice(0, MAX_DESCRIPTION_LENGTH);
  const abv = input.abv?.trim().slice(0, MAX_ABV_LENGTH);
  const origin = input.origin?.trim()
    ? normalizeInventoryText(input.origin).slice(0, MAX_ORIGIN_LENGTH).trim()
    : undefined;

  return {
    name,
    brand,
    category,
    size,
    price,
    ...(description ? { description } : {}),
    ...(abv ? { abv } : {}),
    ...(origin ? { origin } : {}),
    ...(typeof input.inStock === "boolean" ? { inStock: input.inStock } : {}),
    visibility: "public" as const,
    updatedBy: uid,
    updatedAt: serverTimestamp(),
  };
}

/**
 * Loads publicly visible Cooler Door products from Firestore.
 */
export async function fetchPublicCoolerItems(): Promise<InventoryItem[]> {
  try {
    const q = query(collection(db, COOLER_ITEMS_COLLECTION), where("visibility", "==", "public"));
    const snapshot = await getDocs(q);
    const items: InventoryItem[] = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      if (typeof data.name === "string" && typeof data.price === "number" && data.price > 0) {
        items.push({
          id: docSnap.id,
          name: normalizeInventoryText(data.name),
          brand: normalizeInventoryText(typeof data.brand === "string" ? data.brand : ""),
          category: normalizeCategory(
            typeof data.category === "string" ? data.category : "Beverages",
          ),
          size: normalizeInventoryText(typeof data.size === "string" ? data.size : ""),
          price: data.price,
        });
      }
    });
    return items.sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, COOLER_ITEMS_COLLECTION);
  }
}

/**
 * Creates or updates a single Cooler Door item in Firestore (admin only).
 */
export async function saveCoolerItem(
  input: SaveCoolerItemInput,
  uid: string,
): Promise<InventoryItem> {
  const payload = buildValidatedPayload(input, uid);
  const itemId = toSafeDocumentId(input.id || `${payload.brand}-${payload.name}`);
  const path = `${COOLER_ITEMS_COLLECTION}/${itemId}`;

  try {
    await setDoc(doc(db, COOLER_ITEMS_COLLECTION, itemId), payload);
    return {
      id: itemId,
      name: payload.name,
      brand: payload.brand,
      category: payload.category,
      size: payload.size,
      price: payload.price,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * Removes a Cooler Door item from Firestore (admin only).
 */
export async function deleteCoolerItem(itemId: string): Promise<void> {
  const safeId = toSafeDocumentId(itemId);
  const path = `${COOLER_ITEMS_COLLECTION}/${safeId}`;
  try {
    await deleteDoc(doc(db, COOLER_ITEMS_COLLECTION, safeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

/**
 * Batch-syncs parsed Excel inventory rows into Firestore (admin only).
 */
export async function syncInventoryToFirestore(
  items: InventoryItem[],
  uid: string,
): Promise<number> {
  const BATCH_SIZE = 400;
  let synced = 0;

  try {
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const chunk = items.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(db);
      for (const item of chunk) {
        const payload = buildValidatedPayload(item, uid);
        const itemId = toSafeDocumentId(`${payload.brand}-${payload.name}`);
        batch.set(doc(db, COOLER_ITEMS_COLLECTION, itemId), payload);
        synced += 1;
      }
      await batch.commit();
    }
    return synced;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, COOLER_ITEMS_COLLECTION);
  }
}
