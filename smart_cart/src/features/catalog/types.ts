export type Unit = 'g' | 'ml' | 'szt';
export type ProductGroup = { id: number; name: string; unit: Unit; default_quantity: number; offer_count: number; lowest_price: number | null };
export type Offer = {
  offer_id: number; product_id: number; group_id: number; store_id: number; store_name: string;
  product_name: string; gramatura_norm: string | null; quantity_value: number | null; quantity_unit: Unit | null;
  sale_mode: 'package' | 'bulk' | 'unknown'; image_url: string | null;
  regular_price: number | null; promo_price: number | null; single_price: number | null;
  price_status: string; regular_price_observed_at: string | null;
  promo_condition: string | null; promo_type: string | null; verified_promotion: boolean;
  promo_rule: { requires_activation?: boolean; requires_card?: boolean; kind?: string } | null;
};
export type ShoppingList = { id: string; name: string; updated_at: string };
export type ShoppingItem = {
  id: string; list_id: string; group_id: number; quantity: number; unit: Unit;
  selected_product_id: number | null; extra_store_ids: number[];
  group: { id: number; name: string; unit: Unit };
  selected_product: { id: number; canonical_name: string } | null;
};
export type Pick = {
  offer_id: number; product_id: number; name: string; package_count: number | null; quantity: number; unit: Unit;
  sale_mode: 'package' | 'bulk'; total_price: number; regular_total: number | null;
  promotion_applied: boolean; requires_activation: boolean; requires_card: boolean;
  condition: string | null; observed_at: string | null; valid_from: string | null; valid_to: string | null;
  price_source?: string | null;
};
export type Quote = {
  status: 'priced' | 'missing'; name: string; required_quantity: number; unit: Unit;
  total_price: number | null; regular_total?: number | null; purchased_quantity?: number; surplus?: number;
  picks: Pick[]; reason?: string;
};
export type ComparisonItem = Quote & { item_id: string; group_id: number; selected_product_id: number | null; extra_selected: boolean; alternative: Quote | null };
export type StoreComparison = {
  store_id: number; store_name: string; price_level: 'network'; complete: boolean;
  available_count: number; requested_count: number; total_price: number | null; regular_total: number | null; items: ComparisonItem[];
};
export type Comparison = { version: 2; calculated_at: string; stores: StoreComparison[] };

export const money = (value: number | null | undefined) => value == null ? 'Brak ceny' : `${Number(value).toFixed(2).replace('.', ',')} zł`;
export const amount = (value: number, unit: Unit) => `${Number(value).toLocaleString('pl-PL', { maximumFractionDigits: 2 })} ${unit}`;
export const quantityHelp: Record<Unit, string> = {
  g: 'Podaj masę w gramach (g), np. 500 oznacza 500 g. To nie liczba opakowań.',
  ml: 'Podaj objętość w mililitrach (ml), np. 1000 oznacza 1 litr. To nie liczba opakowań.',
  szt: 'Podaj całkowitą liczbę sztuk (szt).',
};
export function quantityInput(value: string, unit: Unit): number {
  const trimmed = value.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) throw new Error('Podaj dodatnią ilość, do dwóch miejsc po przecinku.');
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100000 || (unit === 'szt' && !Number.isInteger(parsed))) {
    throw new Error(unit === 'szt' ? 'Podaj całkowitą liczbę sztuk od 1 do 100000.' : 'Podaj ilość od 0,01 do 100000.');
  }
  return parsed;
}
