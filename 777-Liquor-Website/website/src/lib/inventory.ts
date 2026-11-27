import * as XLSX from "xlsx";

export type InventoryItem = {
  id: string;
  name: string;
  brand: string;
  category: string;
  size: string;
  price: number;
  description?: string;
  abv?: string;
  origin?: string;
};

export type InventoryCatalog = {
  items: InventoryItem[];
  sourceFile: string;
  sheetName: string;
  updatedAt: string | null;
};

export const INVENTORY_FOLDER = "/inventory";
export const INVENTORY_FILE_URL = `${INVENTORY_FOLDER}/cooler-door-inventory.xlsx`;

const PRESERVE_UPPERCASE = new Set([
  "IPA",
  "DIPA",
  "IIPA",
  "APA",
  "RTD",
  "ABV",
  "ULTRA",
  "PBR",
  "VMC",
  "XXL",
  "MD",
  "VS",
  "VSOP",
  "XO",
  "USA",
  "HI",
  "OG",
  "BBL",
]);

const BRAND_CASING_OVERRIDES: Record<string, string> = {
  "michelob ultra": "Michelob ULTRA",
  "kirin ichiban": "Kirin Ichiban",
  "pabst blue ribbon": "Pabst Blue Ribbon",
  titos: "Tito's",
  "tito's": "Tito's",
  "titos handmade vodka": "Tito's Handmade Vodka",
  "tito's handmade vodka": "Tito's Handmade Vodka",
  patron: "Patrón",
  patrón: "Patrón",
  "suntory -196": "Suntory -196",
  "196 suntory": "Suntory -196",
  mickeys: "Mickey's",
  "mickey's": "Mickey's",
  "makers mark": "Maker's Mark",
  "maker's mark": "Maker's Mark",
  "jack daniels": "Jack Daniel's",
  "jack daniel's": "Jack Daniel's",
  "aloha beer co.": "Aloha Beer Co.",
  "aloha beer co": "Aloha Beer Co.",
  "dos equis": "Dos Equis",
  vmc: "VMC",
  xxl: "XXL",
  "md 20/20": "MD 20/20",
};

/**
 * Normalizes inventory item names, brands, and sizes according to 777 Liquor rules:
 * - Title Case every word (including short words like Of, The, To, And)
 * - Attached lowercase fluid ounces: 11oz, 12oz, 16oz, 24oz, 25oz
 * - Spaced uppercase liters: 1 L, 1.75 L, 2 L
 * - Clean attached milliliters and packs: 750ml, 375ml, 6pk, 12pk, 24pk
 */
export function normalizeInventoryText(raw: string): string {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";

  const lowerExact = cleaned.toLowerCase();
  if (BRAND_CASING_OVERRIDES[lowerExact]) {
    return BRAND_CASING_OVERRIDES[lowerExact];
  }

  // Standardize unit formats before tokenizing
  let normalized = cleaned
    // Fluid ounces -> attached lowercase "oz" (e.g., "11 oz", "11OZ", "11 fl oz" -> "11oz")
    .replace(/(\d+(?:\.\d+)?)\s*(?:fl\.?\s*)?oz\.?\b/gi, "$1oz")
    // Liters -> spaced uppercase "L" (e.g., "1L", "1 l", "1.75L", "1 liter" -> "1 L", "1.75 L")
    .replace(/(\d+(?:\.\d+)?)\s*(?:liters?|litres?|ltrs?|l)\b/gi, "$1 L")
    // Milliliters -> attached lowercase "ml" (e.g., "750 ml", "750ML" -> "750ml")
    .replace(/(\d+(?:\.\d+)?)\s*ml\.?\b/gi, "$1ml")
    // Packs -> attached lowercase "pk" (e.g., "12 pk", "12-pack", "12 Pack" -> "12pk")
    .replace(/(\d+)\s*(?:-?\s*packs?|-?\s*pk\.?)\b/gi, "$1pk");

  // Collapse any double spaces introduced above
  normalized = normalized.replace(/\s+/g, " ").trim();

  const words = normalized.split(" ");
  const formatted = words.map((word) => {
    if (!word) return word;

    // Keep exact normalized units intact
    if (/^\d+(?:\.\d+)?(?:oz|ml|pk)$/.test(word)) return word;
    if (word === "L") return "L";
    if (/^-?\d+(?:\.\d+)?$/.test(word)) return word;

    // Preserve known uppercase acronyms (including trailing punctuation like "IPA,")
    const bare = word.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    if (PRESERVE_UPPERCASE.has(bare)) {
      return word.replace(/[a-zA-Z]+/g, (m) => m.toUpperCase());
    }

    // Handle hyphenated words (e.g. "ready-to-drink" -> "Ready-To-Drink")
    if (word.includes("-") && !word.startsWith("-")) {
      return word
        .split("-")
        .map((part) => capitalizeWord(part))
        .join("-");
    }

    // Handle slash-separated words (e.g. "20/20", "can/bottle")
    if (word.includes("/")) {
      return word
        .split("/")
        .map((part) => capitalizeWord(part))
        .join("/");
    }

    return capitalizeWord(word);
  });

  return formatted.join(" ");
}

function capitalizeWord(word: string): string {
  if (!word) return word;
  if (/^\d+(?:\.\d+)?(?:oz|ml|pk)$/.test(word)) return word;
  if (word === "L") return "L";

  const bare = word.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (PRESERVE_UPPERCASE.has(bare)) {
    return word.toUpperCase();
  }

  // Capitalize first alphabetic character, lowercase remaining letters while preserving apostrophes/punctuation
  let foundFirstLetter = false;
  let result = "";
  for (let idx = 0; idx < word.length; idx++) {
    const ch = word[idx];
    if (/[a-zA-ZÀ-ÿ]/.test(ch)) {
      if (!foundFirstLetter) {
        result += ch.toUpperCase();
        foundFirstLetter = true;
      } else {
        result += ch.toLowerCase();
      }
    } else {
      result += ch;
    }
  }
  return result;
}

export function normalizeCategory(raw: string): string {
  const cleaned = raw.trim().toLowerCase();
  if (!cleaned) return "Beverages";
  if (
    cleaned === "rtd" ||
    cleaned.includes("ready") ||
    cleaned.includes("seltzer") ||
    cleaned.includes("cocktail")
  ) {
    return "RTD";
  }
  if (
    cleaned.includes("beer") ||
    cleaned.includes("lager") ||
    cleaned.includes("ale") ||
    cleaned.includes("ipa") ||
    cleaned.includes("cider")
  ) {
    return "Beer";
  }
  if (
    cleaned.includes("spirit") ||
    cleaned.includes("liquor") ||
    cleaned.includes("vodka") ||
    cleaned.includes("tequila") ||
    cleaned.includes("whisk") ||
    cleaned.includes("rum") ||
    cleaned.includes("gin") ||
    cleaned.includes("bourbon")
  ) {
    return "Spirits";
  }
  if (
    cleaned.includes("wine") ||
    cleaned.includes("champagne") ||
    cleaned.includes("prosecco") ||
    cleaned.includes("sake")
  ) {
    return "Wine";
  }
  if (
    cleaned.includes("beverage") ||
    cleaned.includes("mixer") ||
    cleaned.includes("soda") ||
    cleaned.includes("water") ||
    cleaned.includes("non-alc")
  ) {
    return "Beverages";
  }
  return normalizeInventoryText(raw);
}

function parsePrice(raw: unknown): number | null {
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw > 0 ? Math.round(raw * 100) / 100 : null;
  }
  if (typeof raw === "string") {
    const cleaned = raw.replace(/[$,\s]/g, "");
    const value = Number.parseFloat(cleaned);
    return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null;
  }
  return null;
}

function pickField(row: Record<string, unknown>, candidates: string[]): unknown {
  const entries = Object.entries(row);
  for (const candidate of candidates) {
    const match = entries.find(([key]) => key.trim().toLowerCase() === candidate);
    if (match && match[1] !== undefined && String(match[1]).trim() !== "") {
      return match[1];
    }
  }
  // Fallback: substring match (e.g. "Retail Price ($)" matches "price")
  for (const candidate of candidates) {
    const match = entries.find(([key]) => key.trim().toLowerCase().includes(candidate));
    if (match && match[1] !== undefined && String(match[1]).trim() !== "") {
      return match[1];
    }
  }
  return undefined;
}

/**
 * Parses an Excel (.xlsx / .xls / .csv) ArrayBuffer into normalized InventoryItem rows.
 */
export function parseInventoryWorkbook(
  buffer: ArrayBuffer,
  sourceFile = "cooler-door-inventory.xlsx",
): InventoryCatalog {
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName =
    workbook.SheetNames.find((name) => {
      const sheet = workbook.Sheets[name];
      return sheet && sheet["!ref"];
    }) ?? workbook.SheetNames[0];

  if (!sheetName) {
    throw new Error("Excel workbook has no worksheets.");
  }

  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  const items: InventoryItem[] = [];
  rawRows.forEach((row, index) => {
    const rawName = String(
      pickField(row, ["product name", "item name", "name", "product", "item", "title"]) ??
        pickField(row, ["description"]) ??
        "",
    ).trim();
    const rawBrand = String(
      pickField(row, ["brand", "vendor", "manufacturer", "maker"]) ?? "",
    ).trim();
    const rawCategory = String(
      pickField(row, ["category", "department", "type", "section", "group"]) ?? "",
    ).trim();
    const rawSize = String(
      pickField(row, ["size", "pack", "unit", "volume", "package"]) ?? "",
    ).trim();
    const rawDescription = String(
      pickField(row, ["tasting notes", "product description", "notes", "details", "description"]) ??
        "",
    ).trim();
    const rawAbv = String(
      pickField(row, ["abv", "alcohol %", "alc %", "alcohol", "proof"]) ?? "",
    ).trim();
    const rawOrigin = String(pickField(row, ["origin", "country", "region"]) ?? "").trim();
    const price = parsePrice(
      pickField(row, ["price", "retail price", "retail", "unit price", "amount", "cost"]),
    );

    if (!rawName || price === null) return;

    const normalizedSize = rawSize ? normalizeInventoryText(rawSize) : "";
    let normalizedName = normalizeInventoryText(rawName);
    if (normalizedSize && !normalizedName.toLowerCase().includes(normalizedSize.toLowerCase())) {
      normalizedName = `${normalizedName} ${normalizedSize}`;
    }

    const brand = rawBrand
      ? normalizeInventoryText(rawBrand)
      : normalizedName.split(" ").slice(0, 2).join(" ");
    const category = normalizeCategory(rawCategory);
    const description =
      rawDescription && rawDescription.toLowerCase() !== rawName.toLowerCase()
        ? rawDescription
        : undefined;
    const abv = rawAbv || undefined;
    const origin = rawOrigin ? normalizeInventoryText(rawOrigin) : undefined;

    items.push({
      id: `${index}-${brand.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${normalizedName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      name: normalizedName,
      brand,
      category,
      size: normalizedSize,
      price,
      ...(description ? { description } : {}),
      ...(abv ? { abv } : {}),
      ...(origin ? { origin } : {}),
    });
  });

  const modifiedProp = workbook.Props?.ModifiedDate;
  let updatedAt: string | null = null;
  if (modifiedProp instanceof Date && !Number.isNaN(modifiedProp.getTime())) {
    updatedAt = modifiedProp.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }

  return {
    items,
    sourceFile,
    sheetName,
    updatedAt,
  };
}

let cachedCatalogPromise: Promise<InventoryCatalog> | null = null;

export function loadCoolerDoorInventory(forceReload = false): Promise<InventoryCatalog> {
  if (!cachedCatalogPromise || forceReload) {
    cachedCatalogPromise = fetch(INVENTORY_FILE_URL, { cache: "no-cache" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Inventory spreadsheet HTTP ${response.status}`);
        }
        const buffer = await response.arrayBuffer();
        const catalog = parseInventoryWorkbook(buffer, "cooler-door-inventory.xlsx");
        if (!catalog.items.length) {
          throw new Error("Inventory spreadsheet did not contain valid product rows.");
        }
        return catalog;
      })
      .catch((error) => {
        cachedCatalogPromise = null;
        throw error;
      });
  }
  return cachedCatalogPromise;
}
