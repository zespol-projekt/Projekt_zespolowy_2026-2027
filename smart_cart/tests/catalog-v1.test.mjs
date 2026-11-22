import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTree, parsePage, parseGroup, parseProduct, parseItem } from '../src/features/catalog/catalogV1.ts';
import { tree, branch, group, single, groupItem } from './fixtures/catalog-v1.ts';
import { normalizeCatalogQuery, priceDateLabel } from '../src/features/catalog/catalogPresentation.ts';

test('price dates identify observations without exposing ingestion dates or inventing missing dates', () => {
  const dated = { regular_price_observed_at: '2026-11-21T01:31:48+01:00' };
  for (const price_source of ['antonka', 'antonka_historia', 'tanszykoszyk']) {
    assert.equal(priceDateLabel({ ...dated, price_source }), 'Cena widziana 21.11.2026');
    for (const regular_price_observed_at of [null, 'invalid', '2026-02-30']) assert.equal(priceDateLabel({ price_source, regular_price_observed_at }), 'Data ceny nieznana.');
  }
  for (const price_source of ['kodyzbiedry', 'new-source', null]) assert.equal(priceDateLabel({ ...dated, price_source }), 'Data ceny nieznana.');
  assert.equal(parseProduct(single).offers[0].price_source, 'antonka');
});

test('favorite search matches Polish accents, case and decimal percentages', () => {
  assert.equal(normalizeCatalogQuery(' ŁÓDŹ Mleko 3,2% '), 'lodz mleko 3.2%');
  assert.equal(normalizeCatalogQuery('ŻÓŁĆ'), normalizeCatalogQuery('zolc'));
});

test('catalog v1 validates the documented tree, pages, grouped products and direct product', () => {
  assert.equal(parseTree(tree).categories[0].children[0].slug, 'nabial-mleko');
  assert.equal(parsePage(branch(), true).total, 3);
  assert.equal(parseGroup(group).products.length, 2);
  assert.equal(parseProduct(single).offers.length, 2);
});
test('catalog v1 keeps full product counts and independent pagination metadata', () => {
  assert.equal(parsePage(branch()).items[0].product_count, 2);
  assert.equal(parsePage(branch(2)).items.length, 1);
  assert.equal(parsePage(branch(30)).total, 3);
  assert.equal(parseItem({ ...groupItem, product_count: 1 }).kind, 'group');
});
test('catalog v1 rejects missing fields, wrong versions, duplicate IDs and cross-product offers', () => {
  for (const value of [[], null, { ...tree, version: 2 }, { ...tree, categories: [tree.categories[0], tree.categories[0]] }]) assert.throws(() => parseTree(value));
  assert.throws(() => parsePage({ ...branch(), items: [{ ...groupItem, product_count: undefined }] }));
  assert.throws(() => parsePage({ ...branch(), total: 0 }));
  assert.throws(() => parseGroup({ ...group, products: [group.products[0]] }));
  assert.throws(() => parseProduct({ ...single, offers: [{ ...single.offers[0], product_id: 999 }] }));
});
test('catalog v1 does not accept estimated regular prices as current prices or unusable promotions', () => {
  assert.throws(() => parseProduct({ ...single, offers: [{ ...single.offers[0], regular_price_status: 'estymowana' }] }));
  assert.throws(() => parseProduct({ ...single, offers: [{ ...single.offers[0], price_today_basis: 'promotion' }] }));
});
test('catalog v1 accepts fractional package sizes and unknown sizes without making up a quantity', () => {
  const item = parseItem({ ...groupItem, price_from: { ...groupItem.price_from, package_quantity: 0.5, package_unit: 'g' } });
  assert.equal(item.price_from.package_quantity, 0.5);
  assert.equal(parseProduct({ ...single, product: { ...single.product, package: { quantity: null, unit: null, label: null } } }).product.package.quantity, null);
});
