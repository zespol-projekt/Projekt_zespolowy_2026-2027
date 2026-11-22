import type { CatalogTree, CatalogItem, CatalogOffer, CatalogProduct, CatalogGroup } from '../../src/features/catalog/catalogV1.ts';

export const storeA = { id: 1, slug: 'siec-a', name: 'Sieć A' };
export const storeB = { id: 2, slug: 'siec-b', name: 'Sieć B' };
export const subcategory = { id: 9, slug: 'nabial-mleko', parent_slug: 'nabial', name: 'Mleko', order: 1,
  verification_status: 'reviewed' as const, product_count: 3, offer_count: 5, has_items: true };
export const tree: CatalogTree = { version: 1, categories: [
  { id: 3, slug: 'nabial', name: 'Nabiał', order: 3, product_count: 3, offer_count: 5, children: [subcategory] },
  { id: 4, slug: 'spizarnia', name: 'Spiżarnia', order: 4, product_count: 0, offer_count: 0, children: [
    { ...subcategory, id: 10, slug: 'spizarnia-ryz', parent_slug: 'spizarnia', name: 'Ryż', verification_status: 'preliminary', product_count: 0, offer_count: 0, has_items: false },
  ] },
] };
export const path = { category: { slug: 'nabial', name: 'Nabiał' }, subcategory: { slug: subcategory.slug, name: subcategory.name, verification_status: subcategory.verification_status } };
export const groupItem: CatalogItem = {
  kind: 'group', group_id: 53, product_id: null, name: 'Mleko UHT 3,2% bez laktozy', unit: 'ml', default_quantity: 1000,
  product_count: 2, offer_count: 3, store_count: 2, stores_with_price_today: 2, image_url: null,
  price_from: { unit_price: 3, unit_price_per: '1 l', package_price: 3, package_quantity: 1000, package_unit: 'ml', store: storeA, offer_id: 17 },
};
export const singleItem: CatalogItem = { ...groupItem, kind: 'product', group_id: 106, product_id: 93, name: 'Napój testowy 4MOVE 500 ml',
  product_count: 1, offer_count: 2, price_from: { ...groupItem.price_from!, unit_price: 6, package_price: 3, package_quantity: 500 } };
export const thirdItem: CatalogItem = { ...groupItem, group_id: 107, name: 'Mleko świeże 2% bez laktozy', product_count: 0, offer_count: 0, store_count: 0, stores_with_price_today: 0, price_from: null };
export const offerA: CatalogOffer = { offer_id: 17, product_id: 91, store: storeA, store_product_name: 'Marka A 1 l', regular_price: 3, regular_price_status: 'prawdziwa',
  price_source: 'antonka', regular_price_observed_at: '2026-11-21T01:31:48+01:00', promotion: null, price_today: 3, price_today_basis: 'regular', unit_price_today: 3, unit_price_per: '1 l' };
export const productA: CatalogProduct = { product_id: 91, name: 'Marka A 1 l', package: { quantity: 1000, unit: 'ml', label: null }, sale_mode: 'package', image_url: null,
  offers: [offerA, { ...offerA, offer_id: 18, store: storeB, regular_price: null, regular_price_status: 'brak', price_today: null, price_today_basis: null, unit_price_today: null }] };
export const productB: CatalogProduct = { ...productA, product_id: 92, name: 'Marka B 500 ml', package: { quantity: 500, unit: 'ml', label: null },
  offers: [{ ...offerA, offer_id: 19, product_id: 92, regular_price: 2, price_today: 2, unit_price_today: 4, store_product_name: 'Marka B 500 ml' }] };
export const group: CatalogGroup = { version: 1, group: { ...groupItem, path }, products: [productA, productB] };
export const single = { version: 1 as const, product: { product_id: 93, name: singleItem.name, package: { quantity: 500, unit: 'ml' as const, label: null },
  sale_mode: 'package' as const, image_url: null, group: { group_id: 106, name: singleItem.name, unit: 'ml' as const, kind: 'product' as const }, path },
  offers: productA.offers.map(offer => ({ ...offer, product_id: 93, store_product_name: singleItem.name, unit_price_today: offer.price_today === null ? null : 6 })) };
export const branch = (offset = 0) => ({ version: 1, total: 3, limit: 2, offset, subcategory: { id: 9, ...path.subcategory, category: path.category },
  items: offset === 0 ? [groupItem, singleItem] : offset === 2 ? [thirdItem] : [] });
