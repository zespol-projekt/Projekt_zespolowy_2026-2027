import type { Unit } from './types.ts';

export type Verification = 'reviewed' | 'in_progress' | 'preliminary';
export type CategoryNode = { id: number; slug: string; name: string; order: number; product_count: number; offer_count: number };
export type Subcategory = CategoryNode & { parent_slug: string; verification_status: Verification; has_items: boolean };
export type CatalogTree = { version: 1; categories: (CategoryNode & { children: Subcategory[] })[] };
export type CatalogStore = { id: number; slug: string; name: string };
export type PriceFrom = { unit_price: number; unit_price_per: string; package_price: number; package_quantity: number; package_unit: Unit; store: CatalogStore; offer_id: number };
export type CatalogItem = {
  kind: 'group' | 'product'; group_id: number; product_id: number | null; name: string; unit: Unit;
  default_quantity: number; product_count: number; offer_count: number; store_count: number;
  stores_with_price_today: number; price_from: PriceFrom | null; image_url: string | null;
};
export type CatalogPath = { category: { slug: string; name: string }; subcategory: { slug: string; name: string; verification_status: Verification } };
export type CatalogPage = { version: 1; total: number; limit: number; offset: number; items: CatalogItem[]; subcategory?: CatalogPath['subcategory'] & { id: number; category: CatalogPath['category'] } };
export type CatalogPromotion = {
  price: number | null; condition: string | null; valid_from: string | null; valid_to: string | null;
  applies_today: boolean; requires_card: boolean; requires_activation: boolean;
};
export type CatalogOffer = {
  offer_id: number; product_id: number; store: CatalogStore; store_product_name: string;
  regular_price: number | null; regular_price_status: 'prawdziwa' | 'brak' | 'estymowana';
  price_source: string | null; regular_price_observed_at: string | null; promotion: CatalogPromotion | null;
  price_today: number | null; price_today_basis: 'regular' | 'promotion' | null;
  unit_price_today: number | null; unit_price_per: string | null;
};
export type CatalogProduct = {
  product_id: number; name: string; package: { quantity: number | null; unit: Unit | null; label: string | null };
  sale_mode: 'package' | 'bulk' | 'unknown'; image_url: string | null; offers: CatalogOffer[];
};
export type CatalogGroup = { version: 1; group: CatalogItem & { path: CatalogPath | null }; products: CatalogProduct[] };
export type CatalogProductResponse = { version: 1; product: Omit<CatalogProduct, 'offers'> & { group: { group_id: number; name: string; unit: Unit; kind: 'group' | 'product' }; path: CatalogPath }; offers: CatalogOffer[] };

const invalid = (): never => { throw new Error('Otrzymano niepełne lub niezgodne dane katalogu. Spróbuj ponownie później.'); };
const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : invalid();
const text = (v: unknown): string => typeof v === 'string' && v.trim() ? v : invalid();
const number = (v: unknown): number => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : invalid();
const positive = (v: unknown): number => number(v) > 0 ? v as number : invalid();
const count = (v: unknown): number => Number.isSafeInteger(v) && number(v) >= 0 ? v as number : invalid();
const id = (v: unknown): number => count(v) > 0 ? v as number : invalid();
const bool = (v: unknown): boolean => typeof v === 'boolean' ? v : invalid();
const nullable = <T>(v: unknown, parse: (v: unknown) => T): T | null => v === null ? null : parse(v);
const list = <T>(v: unknown, parse: (v: unknown) => T): T[] => Array.isArray(v) ? v.map(parse) : invalid();
const choice = <T extends string>(v: unknown, values: readonly T[]): T => values.includes(v as T) ? v as T : invalid();
const unit = (v: unknown) => choice(v, ['g', 'ml', 'szt'] as const);
const verification = (v: unknown) => choice(v, ['reviewed', 'in_progress', 'preliminary'] as const);
const version = (v: unknown) => { const r = record(v); if (r.version !== 1) invalid(); return r; };
const unique = <T>(rows: T[], key: (row: T) => string | number): T[] => new Set(rows.map(key)).size === rows.length ? rows : invalid();
const store = (v: unknown): CatalogStore => { const r = record(v); return { id: id(r.id), slug: text(r.slug), name: text(r.name) }; };
const pathNode = (v: unknown) => { const r = record(v); return { slug: text(r.slug), name: text(r.name) }; };
const path = (v: unknown): CatalogPath => {
  const r = record(v); const sub = record(r.subcategory);
  return { category: pathNode(r.category), subcategory: { ...pathNode(sub), verification_status: verification(sub.verification_status) } };
};
function node(v: unknown): CategoryNode {
  const r = record(v); return { id: id(r.id), slug: text(r.slug), name: text(r.name), order: count(r.order), product_count: count(r.product_count), offer_count: count(r.offer_count) };
}
export function parseTree(v: unknown): CatalogTree {
  const r = version(v);
  const categories = unique(list(r.categories, v => {
    const r = record(v); const category = node(r);
    const children = unique(list(r.children, v => {
      const r = record(v);
      if (r.parent_slug !== category.slug) invalid();
      return { ...node(r), parent_slug: text(r.parent_slug), verification_status: verification(r.verification_status), has_items: bool(r.has_items) };
    }), row => row.slug).sort((a, b) => a.order - b.order || a.id - b.id);
    return { ...category, children };
  }), row => row.slug).sort((a, b) => a.order - b.order || a.id - b.id);
  return { version: 1, categories };
}
function priceFrom(v: unknown): PriceFrom {
  const r = record(v);
  return { unit_price: number(r.unit_price), unit_price_per: choice(r.unit_price_per, ['1 kg', '1 l', '1 szt']), package_price: number(r.package_price),
    package_quantity: positive(r.package_quantity), package_unit: unit(r.package_unit), store: store(r.store), offer_id: id(r.offer_id) };
}
export function parseItem(v: unknown): CatalogItem {
  const r = record(v);
  const item: CatalogItem = { kind: choice(r.kind, ['group', 'product']), group_id: id(r.group_id), product_id: nullable(r.product_id, id), name: text(r.name),
    unit: unit(r.unit), default_quantity: number(r.default_quantity), product_count: count(r.product_count), offer_count: count(r.offer_count),
    store_count: count(r.store_count), stores_with_price_today: count(r.stores_with_price_today), price_from: nullable(r.price_from, priceFrom), image_url: nullable(r.image_url, text) };
  if ((item.kind === 'product' && (item.product_id === null || item.product_count !== 1)) || item.stores_with_price_today > item.store_count) invalid();
  return item;
}
export function parsePage(v: unknown, branch = false): CatalogPage {
  const r = version(v);
  const result: CatalogPage = { version: 1, total: count(r.total), limit: id(r.limit), offset: count(r.offset), items: unique(list(r.items, parseItem), row => row.group_id) };
  if (result.limit > 100 || result.items.length > result.limit || result.items.length > Math.max(0, result.total - result.offset)) invalid();
  if (branch) {
    const sub = record(r.subcategory);
    result.subcategory = { ...pathNode(sub), id: id(sub.id), verification_status: verification(sub.verification_status), category: pathNode(sub.category) };
  }
  return result;
}
function offer(v: unknown): CatalogOffer {
  const r = record(v);
  const promotion = nullable(r.promotion, v => {
    const r = record(v); return { price: nullable(r.price, number), condition: nullable(r.condition, text), valid_from: nullable(r.valid_from, text), valid_to: nullable(r.valid_to, text),
      applies_today: bool(r.applies_today), requires_card: bool(r.requires_card), requires_activation: bool(r.requires_activation) };
  });
  const result: CatalogOffer = { offer_id: id(r.offer_id), product_id: id(r.product_id), store: store(r.store), store_product_name: text(r.store_product_name),
    regular_price: nullable(r.regular_price, number), regular_price_status: choice(r.regular_price_status, ['prawdziwa', 'brak', 'estymowana']),
    price_source: r.price_source === undefined ? null : nullable(r.price_source, text), regular_price_observed_at: nullable(r.regular_price_observed_at, text), promotion,
    price_today: nullable(r.price_today, number), price_today_basis: nullable(r.price_today_basis, v => choice(v, ['regular', 'promotion'])),
    unit_price_today: nullable(r.unit_price_today, number), unit_price_per: nullable(r.unit_price_per, v => choice(v, ['1 kg', '1 l', '1 szt'])) };
  if ((result.price_today === null) !== (result.price_today_basis === null) || (result.price_today_basis === 'regular' && result.regular_price_status !== 'prawdziwa') ||
    (result.price_today_basis === 'promotion' && !promotion?.applies_today)) invalid();
  return result;
}
function product(v: unknown): Omit<CatalogProduct, 'offers'> {
  const r = record(v); const p = record(r.package);
  return { product_id: id(r.product_id), name: text(r.name), package: { quantity: nullable(p.quantity, number), unit: nullable(p.unit, unit), label: nullable(p.label, text) },
    sale_mode: choice(r.sale_mode, ['package', 'bulk', 'unknown']), image_url: nullable(r.image_url, text) };
}
const offers = (v: unknown, productId: number) => unique(list(v, value => { const row = offer(value); if (row.product_id !== productId) invalid(); return row; }), row => row.offer_id);
export function parseGroup(v: unknown): CatalogGroup {
  const r = version(v); const g = record(r.group);
  const group = { ...parseItem(g), path: nullable(g.path, path) };
  const products = unique(list(r.products, v => { const r = record(v); const p = product(r); return { ...p, offers: offers(r.offers, p.product_id) }; }), row => row.product_id);
  if (products.length !== group.product_count) invalid();
  return { version: 1, group, products };
}
export function parseProduct(v: unknown): CatalogProductResponse {
  const r = version(v); const p = record(r.product); const g = record(p.group);
  const base = product(p);
  return { version: 1, product: { ...base, group: { group_id: id(g.group_id), name: text(g.name), unit: unit(g.unit), kind: choice(g.kind, ['group', 'product']) }, path: path(p.path) }, offers: offers(r.offers, base.product_id) };
}
