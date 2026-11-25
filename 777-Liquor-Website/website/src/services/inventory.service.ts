import {
  collection,
  getDocs,
  onSnapshot,
  query,
  where,
  type DocumentData,
  type QuerySnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../lib/firebase";
import {
  deleteCoolerItem,
  saveCoolerItem,
  syncInventoryToFirestore,
  toSafeDocumentId,
} from "../lib/firestore-inventory";
import {
  loadCoolerDoorInventory,
  normalizeCategory,
  normalizeInventoryText,
  type InventoryItem,
} from "../lib/inventory";

export const COOLER_ITEMS_PATH = "coolerItems";

export type InventorySource = "firestore" | "excel";

export type InventoryListResult = {
  items: InventoryItem[];
  source: InventorySource;
  updatedAt: string | null;
};

export type FetchInventoryOptions = {
  /** Optional category filter (e.g. "Beer", "RTD", "Spirits", "Wine", "Beverages"). */
  category?: string;
  /** Fall back to the bundled Excel sheet when Firestore has no synced items yet. Defaults to true. */
  includeExcelFallback?: boolean;
  /** Bypass client-side cache when reading the bundled Excel fallback. */
  forceExcelReload?: boolean;
};

function mapSnapshotToItems(snapshot: QuerySnapshot<DocumentData>): InventoryItem[] {
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
        price: Math.round(data.price * 100) / 100,
      });
    }
  });
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

function buildPublicInventoryQuery(category?: string) {
  const baseCollection = collection(db, COOLER_ITEMS_PATH);
  const normalizedCategory =
    category && category !== "All" ? normalizeCategory(category) : undefined;

  if (normalizedCategory) {
    return query(
      baseCollection,
      where("visibility", "==", "public"),
      where("category", "==", normalizedCategory),
    );
  }
  return query(baseCollection, where("visibility", "==", "public"));
}

/**
 * Fetches the public Cooler Door inventory list directly from Firestore.
 */
export async function fetchFirestoreInventory(category?: string): Promise<InventoryItem[]> {
  try {
    const snapshot = await getDocs(buildPublicInventoryQuery(category));
    return mapSnapshotToItems(snapshot);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, COOLER_ITEMS_PATH);
  }
}

/**
 * Fetches the Cooler Door inventory list from Firestore, optionally falling back
 * to the bundled Excel workbook when Firestore has not been populated yet.
 */
export async function fetchInventoryList(
  options: FetchInventoryOptions = {},
): Promise<InventoryListResult> {
  const { category, includeExcelFallback = true, forceExcelReload = false } = options;

  try {
    const firestoreItems = await fetchFirestoreInventory(category);
    if (firestoreItems.length > 0 || !includeExcelFallback) {
      return {
        items: firestoreItems,
        source: "firestore",
        updatedAt: null,
      };
    }
  } catch (error) {
    if (!includeExcelFallback) {
      throw error;
    }
  }

  const excelCatalog = await loadCoolerDoorInventory(forceExcelReload);
  const normalizedCategory =
    category && category !== "All" ? normalizeCategory(category).toLowerCase() : null;
  const filteredItems = normalizedCategory
    ? excelCatalog.items.filter((item) => item.category.toLowerCase() === normalizedCategory)
    : excelCatalog.items;

  return {
    items: filteredItems,
    source: "excel",
    updatedAt: excelCatalog.updatedAt,
  };
}

/**
 * Subscribes to real-time updates for public Cooler Door inventory items in Firestore.
 */
export function subscribeToInventoryList(
  onData: (items: InventoryItem[]) => void,
  onError?: (error: Error) => void,
  category?: string,
): Unsubscribe {
  const inventoryQuery = buildPublicInventoryQuery(category);

  return onSnapshot(
    inventoryQuery,
    (snapshot) => {
      onData(mapSnapshotToItems(snapshot));
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, COOLER_ITEMS_PATH);
      } catch (structuredError) {
        if (onError) {
          onError(
            structuredError instanceof Error ? structuredError : new Error(String(structuredError)),
          );
        }
      }
    },
  );
}

export { deleteCoolerItem, saveCoolerItem, syncInventoryToFirestore, toSafeDocumentId };
export type { InventoryItem };
