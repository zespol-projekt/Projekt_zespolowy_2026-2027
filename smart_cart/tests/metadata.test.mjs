import test from 'node:test';
import assert from 'node:assert/strict';
import { metadataSql } from '../scripts/catalog-metadata.mjs';
test('reviewed metadata is escaped and blocks unexpected fields/IDs', () => {
  const sql = metadataSql({ groups: [{ key: "quote'", name: "Test's", base_product_id: 1, unit: 'g', products: [{ id: 2, sale_mode: 'package' }] }] });
  assert.match(sql, /Test''s/); assert.match(sql, /BEGIN;/); assert.match(sql, /COMMIT;/);
  for (const input of [{ offers: [{ id: '1; DROP TABLE products' }] }, { offers: [{ id: 1, regular_price: 5 }] }, { offers: [{ id: 1, promo_evidence_url: 'http://invalid' }] }]) assert.throws(() => metadataSql(input));
});
