import { InvoiceOcrLineItem } from '../types/inventory';

export const SAMPLE_CLOVER_INVENTORY_CSV = `Item Name,Product Code,Category,Subcategory,Base Price,Cost,On Hand,Vendor,Pack,Packs Per Case
lanikai pillbox porter 12 oz 6 pack,085111000101,Beer,Craft Porter,$14.99,$10.35,18,Direct Local,6,4
kona big wave golden ale 12oz 6pk,079603011001,Beer,Craft Ale,$13.49,$9.05,42,Paradise Beverages,6,4
surfside iced tea vodka 12oz 8pk,085003491008,RTD,Spirit-Based Canned Cocktail,$21.99,,15,RNDC Hawaii,8,3
kohana kea white rum 750 ml,085784500501,Spirits,Hawaiian Rum,$39.99,$28.50,10,Southern Glazer's HI,1,6
lanikai pillbox porter 12 oz 6 pack,085111000101,Beer,Craft Porter,$14.99,$10.35,18,Direct Local,6,4
aloha shoyu snack mix 6oz,007189000601,Grocery,Snacks,,$3.10,12,Hawaiian Isles Distributors,1,12
suntory hibiki harmony 750ml,008068695801,Spirits,Japanese Whisky,$94.99,,4,Southern Glazer's HI,1,6`;

export const SAMPLE_VENDOR_SHEET_CSV = `Description,Brand,UPC,Unit Size,Wholesale Cost,Retail Price,Distributor,Case Pack
MAUI BREWING BIG SWELL IPA 12OZ 6PK,Maui Brewing Co.,085296800113,12oz,10.45,14.99,Paradise Beverages,4
OYSTER BAY SAUVIGNON BLANC 750ML,Oyster Bay,089268400012,750mL,11.10,16.99,Johnson Brothers HI,12
KIRIN ICHIBAN LAGER 12OZ 6PK,Kirin,007199000126,12oz,9.35,13.49,Paradise Beverages,4
WAILUA WHEAT ALE 12OZ 6PK,Kona Brewing,079603011407,12oz,9.15,13.49,Paradise Beverages,4`;

export const SAMPLE_CLOVER_SALES_CSV = `Item Name,UPC,Units Sold,Gross Sales,Period
KONA BIG WAVE GOLDEN ALE 12OZ 6PK,079603011001,84,$1133.16,Nov 2026
TITO'S HANDMADE VODKA 1 L,061994700001,46,$1609.54,Nov 2026
MODELO ESPECIAL 12OZ 12PK CANS,008066095615,52,$1195.48,Nov 2026
HIGH NOON PINEAPPLE VODKA SELTZER 12OZ 8PK,008500003198,39,$896.61,Nov 2026
HENNESSY V.S COGNAC 750ML,008811015055,28,$1399.72,Nov 2026
HAWAIIAN SUN LILIKOI PASSION 11.5OZ CAN,007186700014,142,$282.58,Nov 2026
MAUI BREWING BIKINI BLONDE 12OZ 6PK,085296800106,49,$710.01,Nov 2026
ASAHI SUPER DRY 11.2OZ 6PK,008382011206,36,$503.64,Nov 2026`;

export interface SampleInvoiceSpec {
  id: string;
  label: string;
  filename: string;
  vendor: string;
  invoice_number: string;
  invoice_date: string;
  lines: Omit<InvoiceOcrLineItem, 'unit_cost' | 'matchedCloverId' | 'matchedItemName'>[];
}

export const SAMPLE_INVOICE_OCR_TEMPLATES: SampleInvoiceSpec[] = [
  {
    id: 'paradise-beverages',
    label: 'Paradise Beverages Beer Invoice (PDF)',
    filename: 'Paradise_Beverages_Inv_PB9104.pdf',
    vendor: 'Paradise Beverages',
    invoice_number: 'PB-9104',
    invoice_date: '2026-11-24',
    lines: [
      {
        lineId: 'PB-1',
        raw_description: 'MAUI BIG SWELL IPA 12OZ 4/6PK',
        normalized_name: 'Maui Brewing Big Swell IPA 12oz 6pk',
        upc: '085296800113',
        case_cost: 41.8,
        sell_pack_qty: 6,
        packs_per_case: 4,
        confidence: 'high',
        include: true,
      },
      {
        lineId: 'PB-2',
        raw_description: 'KONA BIG WAVE GLDN ALE 4/6PK 12OZ',
        normalized_name: 'Kona Big Wave Golden Ale 12oz 6pk',
        upc: '079603011001',
        case_cost: 36.2,
        sell_pack_qty: 6,
        packs_per_case: 4,
        confidence: 'high',
        include: true,
      },
      {
        lineId: 'PB-3',
        raw_description: 'MODELO ESPECIAL 2/12PK CAN 12OZ',
        normalized_name: 'Modelo Especial 12oz 12pk Cans',
        upc: '008066095615',
        case_cost: 33.4,
        sell_pack_qty: 12,
        packs_per_case: 2,
        confidence: 'high',
        include: true,
      },
      {
        lineId: 'PB-4',
        raw_description: 'OLA BREW MAUI GOLD CIDER 12OZ 6PK',
        normalized_name: 'Ola Brew Maui Gold Cider 12oz 6pk',
        upc: '085001122406',
        case_cost: 44.0,
        sell_pack_qty: 6,
        packs_per_case: null,
        confidence: 'medium',
        include: true,
      },
    ],
  },
  {
    id: 'southern-glazers',
    label: "Southern Glazer's Spirits Invoice (JPG)",
    filename: 'Southern_Glazers_HI_SG20411.jpg',
    vendor: "Southern Glazer's HI",
    invoice_number: 'SG-20411',
    invoice_date: '2026-11-25',
    lines: [
      {
        lineId: 'SG-1',
        raw_description: 'SUNTORY TOKI WHISKY 750ML 6BTL',
        normalized_name: 'Suntory Toki Japanese Whisky 750mL',
        upc: '008068695701',
        case_cost: 186.0,
        sell_pack_qty: 1,
        packs_per_case: 6,
        confidence: 'high',
        include: true,
      },
      {
        lineId: 'SG-2',
        raw_description: "TITO'S HANDMADE VODKA 1L 12BTL",
        normalized_name: "Tito's Handmade Vodka 1 L",
        upc: '061994700001',
        case_cost: 294.0,
        sell_pack_qty: 1,
        packs_per_case: 12,
        confidence: 'high',
        include: true,
      },
      {
        lineId: 'SG-3',
        raw_description: 'CASAMIGOS BLANCO TEQUILA 750ML 6BTL',
        normalized_name: 'Casamigos Blanco Tequila 750mL',
        upc: '085672400601',
        case_cost: 243.0,
        sell_pack_qty: 1,
        packs_per_case: 6,
        confidence: 'medium',
        include: true,
      },
    ],
  },
];
