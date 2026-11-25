export type KegBrand = {
  name: string;
  day: string;
};

export const KEG_BRANDS: readonly KegBrand[] = [
  { name: "Bud Light", day: "Wednesday" },
  { name: "Budweiser", day: "Wednesday" },
  { name: "Michelob ULTRA", day: "Wednesday" },
  { name: "Busch", day: "Wednesday" },
  { name: "Busch Light", day: "Wednesday" },
  { name: "Natural Light", day: "Wednesday" },
  { name: "Rolling Rock", day: "Wednesday" },
  { name: "Stella Artois", day: "Wednesday" },
  { name: "Kona Big Wave", day: "Wednesday" },
  { name: "Kona Longboard", day: "Wednesday" },
  { name: "Kona Hanalei Island IPA", day: "Wednesday" },
  { name: "Kona Castaway IPA", day: "Wednesday" },
  { name: "Aloha Beer Co.", day: "Wednesday" },
  { name: "Coors Light", day: "Friday" },
  { name: "Coors Banquet", day: "Friday" },
  { name: "Miller Lite", day: "Friday" },
  { name: "Modelo Especial", day: "Friday" },
  { name: "Corona Extra", day: "Friday" },
  { name: "Pacifico", day: "Friday" },
  { name: "Dos Equis Lager", day: "Friday" },
  { name: "Heineken", day: "Friday" },
  { name: "Guinness", day: "Friday" },
  { name: "Sapporo", day: "Friday" },
  { name: "Asahi Super Dry", day: "Friday" },
  { name: "Kirin Ichiban", day: "Friday" },
  { name: "Pabst Blue Ribbon", day: "Friday" },
  { name: "Sierra Nevada Pale Ale", day: "Friday" },
  { name: "Other import/domestic brands — ask in store", day: "" },
] as const;
