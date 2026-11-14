// Generate a reviewable SQL transaction; never connects to a database itself.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export function metadataSql(input) {
  const quote = value => `'${String(value).replaceAll("'", "''")}'`;
  const id = value => { if (!Number.isSafeInteger(value) || value < 1) throw new Error('Expected a positive integer ID.'); return value; };
  const text = value => { if (typeof value !== 'string' || !value.trim()) throw new Error('Expected nonempty text.'); return value; };
  const unit = value => { if (!['g', 'ml', 'szt'].includes(value)) throw new Error('Invalid unit.'); return value; };
  const mode = value => { if (!['package', 'bulk', 'unknown'].includes(value)) throw new Error('Invalid sale mode.'); return value; };
  const lines = ['BEGIN;', "SET LOCAL lock_timeout='5s';"];
  for (const group of input.groups ?? []) {
    const key = `reviewed:${text(group.key)}`;
    lines.push(`INSERT INTO public.comparison_groups(group_key,base_product_id,name,normalized_name,unit) VALUES(${quote(key)},${id(group.base_product_id)},${quote(text(group.name))},public.norm_text(${quote(group.name)}),${quote(unit(group.unit))}) ON CONFLICT(group_key) DO UPDATE SET name=excluded.name,normalized_name=excluded.normalized_name;`);
    for (const product of group.products ?? []) {
      const block = `BEGIN UPDATE public.products SET comparison_group_id=(SELECT id FROM public.comparison_groups WHERE group_key=${quote(key)} AND unit=${quote(group.unit)}),sale_mode=${quote(mode(product.sale_mode))},classification_source='reviewed' WHERE id=${id(product.id)} AND quantity_unit=${quote(group.unit)} AND EXISTS(SELECT 1 FROM public.comparison_groups WHERE group_key=${quote(key)} AND unit=${quote(group.unit)}); IF NOT FOUND THEN RAISE EXCEPTION 'Product missing or unit mismatch: ${product.id}'; END IF; END`;
      lines.push(`DO ${quote(block)};`);
    }
  }
  const fields = new Set(['regular_price_observed_at', 'promo_scope', 'promo_evidence_url', 'promo_rule', 'promo_price_status', 'valid_from', 'valid_to']);
  for (const offer of input.offers ?? []) {
    id(offer.id);
    const updates = [];
    for (const [key, value] of Object.entries(offer)) {
      if (key === 'id') continue;
      if (!fields.has(key)) throw new Error(`Unsupported offer field: ${key}`);
      if (key === 'promo_evidence_url' && value !== null && !/^https:\/\//.test(value)) throw new Error('Evidence requires HTTPS.');
      if (key === 'regular_price_observed_at' && value !== null && (!/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value)))) throw new Error('Observation requires an ISO timestamp.');
      if (['valid_from', 'valid_to'].includes(key) && value !== null && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Validity requires YYYY-MM-DD.');
      if (key === 'promo_scope' && !['nationwide', 'personalized', 'unknown'].includes(value)) throw new Error('Invalid promotion scope.');
      if (key === 'promo_price_status' && !['prawdziwa', 'estymowana', 'unknown'].includes(value)) throw new Error('Invalid promo price status.');
      updates.push(`${key}=${value === null ? 'NULL' : key === 'promo_rule' ? `${quote(JSON.stringify(value))}::jsonb` : quote(value)}`);
    }
    if (updates.length) lines.push(`DO ${quote(`BEGIN UPDATE public.store_offers SET ${updates.join(',')} WHERE id=${offer.id}; IF NOT FOUND THEN RAISE EXCEPTION 'Offer missing: ${offer.id}'; END IF; END`)};`);
  }
  return [...lines, "NOTIFY pgrst,'reload schema';", 'COMMIT;', ''].join('\n');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , source, target] = process.argv;
  if (!source || !target) throw new Error('Usage: node scripts/catalog-metadata.mjs reviewed.json output.sql');
  fs.writeFileSync(target, metadataSql(JSON.parse(fs.readFileSync(source, 'utf8').replace(/^\uFEFF/, ''))), { flag: 'wx' });
  console.log('SQL generated for review. No database was modified.');
}
