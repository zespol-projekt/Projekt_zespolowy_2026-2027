import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const hash = (raw) => createHash('sha256').update(raw).digest('hex');
const local = (root, file) => {
  const resolved = path.resolve(root, file);
  assert.ok(resolved.startsWith(path.resolve(root) + path.sep), 'Dowód przeglądu poza katalogiem danych.');
  return resolved;
};
export function mergeReviewDecisions(previous, batch) {
  if (previous) assert.equal(previous.baseline_input_fingerprint, batch.baseline_input_fingerprint, 'Przeglądy dotyczą różnych migawek.');
  const mergeUnique = (entries, key) => {
    assert.equal(new Set(entries.map(item => item[key])).size, entries.length, 'Powtórzone wpisy w partii przeglądu.');
    return entries;
  };
  const decisions = new Map(mergeUnique(previous?.decisions ?? [], 'id').map(d => [d.id,
    {...d, reviewed_at: d.reviewed_at ?? previous.reviewed_at}]));
  for (const d of mergeUnique(batch.decisions, 'id')) decisions.set(d.id, {...d,reviewed_at:d.reviewed_at ?? batch.reviewed_at});
  const evidence = new Map((previous?.evidence_files ?? []).map(e => [e.file,e]));
  for (const e of batch.evidence_files) evidence.set(e.file,e);
  return {...batch, decisions:[...decisions.values()].sort((a,b) => a.id.localeCompare(b.id)), evidence_files:[...evidence.values()]};
}
export function loadReviewDecisions(root) {
  const file = local(root, 'weryfikacja-biedronki/decyzje-przegladu.json');
  if (!fs.existsSync(file)) return null;
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const evidence of doc.evidence_files) {
    assert.equal(hash(fs.readFileSync(local(root, evidence.file))), evidence.sha256, `Zmieniony dowód przeglądu: ${evidence.file}`);
  }
  return doc;
}
export function applyReviewDecisions(input, doc) {
  if (!doc) return input;
  assert.equal(doc.schema_version, 1);
  assert.equal(doc.baseline_input_fingerprint, input.baseline_input_fingerprint ?? input.input_fingerprint, 'Przegląd dotyczy innej migawki.');
  const result = structuredClone(input);
  const stores = [...result.ready, ...result.review].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const byId = new Map(stores.map(s => [s.id, s])), seen = new Set();
  for (const decision of doc.decisions) {
    assert.ok(!seen.has(decision.id), 'Powtórzona decyzja przeglądu.'); seen.add(decision.id);
    const store = byId.get(decision.id);
    assert.ok(store, `Brak sklepu przeglądu: ${decision.id}`);
    assert.deepEqual(store.address, decision.expected.address, `Zmienił się adres po przeglądzie: ${decision.id}`);
    assert.deepEqual(store.location, decision.expected.location, `Zmienił się punkt po przeglądzie: ${decision.id}`);
    assert.ok(['corroborated', 'requires_review'].includes(decision.status));
    assert.ok(decision.reason && decision.report_file);
    store.source_review = { status: decision.status, reviewed_at: decision.reviewed_at ?? doc.reviewed_at,
      report_file: decision.report_file, reason: decision.reason, ...(decision.scope ? {scope:decision.scope} : {}) };
    if (decision.status === 'requires_review') store.quality.issues.push({ code: 'cross_source_address_conflict', message: decision.reason });
  }
  result.ready = []; result.review = [];
  result.report.issue_counts = {};
  for (const summary of result.report.sources) { summary.ready_records = 0; summary.review_records = 0; }
  for (const store of stores) {
    const review = store.quality.issues.length > 0;
    store.quality.status = review ? 'needs_review' : 'ready';
    (review ? result.review : result.ready).push(store);
    result.report.sources.find(s => s.chain === store.chain)[review ? 'review_records' : 'ready_records']++;
    for (const issue of store.quality.issues) result.report.issue_counts[issue.code] = (result.report.issue_counts[issue.code] ?? 0) + 1;
  }
  result.report.ready_records = result.ready.length; result.report.review_records = result.review.length;
  result.review_metadata = { file: 'weryfikacja-biedronki/decyzje-przegladu.json', sha256: hash(JSON.stringify(doc)),
    reviewed: seen.size, corroborated: doc.decisions.filter(d => d.status === 'corroborated').length,
    held: doc.decisions.filter(d => d.status === 'requires_review').length };
  result.report.source_review = result.review_metadata;
  result.input_fingerprint = hash(JSON.stringify({ before_review: input.input_fingerprint, review: result.review_metadata.sha256 }));
  return result;
}
