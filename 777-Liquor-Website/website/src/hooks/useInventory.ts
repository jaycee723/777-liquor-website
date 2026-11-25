import { useCallback, useEffect, useMemo, useState } from "react";
import { loadCoolerDoorInventory } from "../lib/inventory";
import {
  fetchInventoryList,
  subscribeToInventoryList,
  type InventoryItem,
  type InventorySource,
} from "../services/inventory.service";

export type UseInventoryOptions = {
  /** Optional category filter applied at the query level. */
  category?: string;
  /** Subscribe to live Firestore updates via onSnapshot. Defaults to true. */
  realtime?: boolean;
  /** Fall back to the bundled Excel sheet when Firestore is empty. Defaults to true. */
  includeExcelFallback?: boolean;
};

export type UseInventoryResult = {
  items: InventoryItem[];
  categories: string[];
  brands: string[];
  source: InventorySource;
  updatedAt: string | null;
  loading: boolean;
  error: string | null;
  refresh: (forceReload?: boolean) => Promise<void>;
};

/**
 * React hook providing the Cooler Door inventory list from Firestore
 * (with optional real-time updates and automatic Excel fallback).
 */
export function useInventory(options: UseInventoryOptions = {}): UseInventoryResult {
  const { category, realtime = true, includeExcelFallback = true } = options;

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [source, setSource] = useState<InventorySource>("firestore");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadExcelFallback = useCallback(
    async (forceReload = false) => {
      try {
        const excelCatalog = await loadCoolerDoorInventory(forceReload);
        const filtered =
          category && category !== "All"
            ? excelCatalog.items.filter(
                (item) => item.category.toLowerCase() === category.toLowerCase(),
              )
            : excelCatalog.items;
        setItems(filtered);
        setSource("excel");
        setUpdatedAt(excelCatalog.updatedAt);
        setError(null);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "We could not load the Cooler Door inventory right now.",
        );
      } finally {
        setLoading(false);
      }
    },
    [category],
  );

  const refresh = useCallback(
    async (forceReload = false) => {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchInventoryList({
          category,
          includeExcelFallback,
          forceExcelReload: forceReload,
        });
        setItems(result.items);
        setSource(result.source);
        setUpdatedAt(result.updatedAt);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "We could not load the Cooler Door inventory right now.",
        );
      } finally {
        setLoading(false);
      }
    },
    [category, includeExcelFallback],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (!realtime) {
      void refresh(false);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    const unsubscribe = subscribeToInventoryList(
      (firestoreItems) => {
        if (!active) return;
        if (firestoreItems.length > 0 || !includeExcelFallback) {
          setItems(firestoreItems);
          setSource("firestore");
          setUpdatedAt(null);
          setError(null);
          setLoading(false);
          return;
        }
        void loadExcelFallback(false);
      },
      (err) => {
        if (!active) return;
        if (includeExcelFallback) {
          void loadExcelFallback(false);
        } else {
          setError(err.message);
          setLoading(false);
        }
      },
      category,
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [category, realtime, includeExcelFallback, refresh, loadExcelFallback]);

  const categories = useMemo(() => {
    const unique = Array.from(new Set(items.map((item) => item.category))).sort((a, b) =>
      a.localeCompare(b),
    );
    return ["All", ...unique];
  }, [items]);

  const brands = useMemo(() => {
    const unique = Array.from(new Set(items.map((item) => item.brand))).sort((a, b) =>
      a.localeCompare(b),
    );
    return ["All", ...unique];
  }, [items]);

  return {
    items,
    categories,
    brands,
    source,
    updatedAt,
    loading,
    error,
    refresh,
  };
}
