import test from 'node:test';
import assert from 'node:assert/strict';
import { applyReviewDecisions, mergeReviewDecisions } from './przeglad.mjs';
import { applyCorrections } from './poprawki.mjs';
const fixture = () => {
  const stores = ['one', 'two'].map(id => ({ id, chain: 'biedronka', address: { city: 'Miasto', street_address: 'Ulica 1' },
    location: { latitude: 52, longitude: 20 }, quality: { status: 'ready', issues: [] } }));
  return { input_fingerprint: 'corrected', baseline_input_fingerprint: 'raw', ready: stores, review: [],
    report: { selected_records: 2, sources: [{ chain: 'biedronka', ready_records: 2, review_records: 0 }] } };
};
const decisionDoc = (input) => ({ schema_version: 1, baseline_input_fingerprint: 'raw', reviewed_at: '2026-11-02T00:00:00Z',
  decisions: input.ready.map((s, index) => ({ id: s.id, status: index === 0 ? 'requires_review' : 'corroborated',
    expected: { address: structuredClone(s.address), location: structuredClone(s.location) }, reason: 'Porównanie źródeł.', report_file: 'raport.md' })) });
test('Sprzeczność źródeł przenosi tylko wskazany sklep do kontroli, zachowując dane i oryginalny wynik', () => {
  const input = fixture(), doc = decisionDoc(input), result = applyReviewDecisions(input, doc);
  assert.equal(result.ready.length, 1); assert.equal(result.review.length, 1);
  assert.equal(result.review[0].id, 'one'); assert.equal(result.ready[0].source_review.status, 'corroborated');
  assert.deepEqual(result.review[0].address, input.ready[0].address);
  assert.deepEqual(result.review[0].location, input.ready[0].location);
  assert.equal(result.report.issue_counts.cross_source_address_conflict, 1);
  assert.equal(result.report.sources[0].review_records, 1);
  assert.equal(input.ready.length, 2); assert.equal(input.ready[0].quality.issues.length, 0);
  assert.notEqual(input.input_fingerprint, result.input_fingerprint);
});
test('Decyzji ze starej migawki albo po zmianie adresu lub punktu nie można zastosować', () => {
  for (const change of [doc => doc.baseline_input_fingerprint = 'other', doc => doc.decisions[0].expected.address.city = 'Inne',
    doc => doc.decisions[0].expected.location.latitude = 53]) {
    const input = fixture(), doc = decisionDoc(input); change(doc);
    assert.throws(() => applyReviewDecisions(input, doc));
  }
});
test('Nieznany sklep, powtórzona decyzja i nieznany status są odrzucane', () => {
  for (const change of [doc => doc.decisions[0].id = 'missing', doc => doc.decisions.push(doc.decisions[0]), doc => doc.decisions[0].status = 'guessed']) {
    const input = fixture(), doc = decisionDoc(input); change(doc);
    assert.throws(() => applyReviewDecisions(input, doc));
  }
});
test('Nowa partia przeglądu zachowuje poprzednie wstrzymania i ich daty', () => {
  const first = {...decisionDoc(fixture()), evidence_files:[{file:'old.json',sha256:'old'}]};
  const second = {...first, reviewed_at:'2026-11-03T00:00:00Z', evidence_files:[{file:'new.json',sha256:'new'}],
    decisions:[{...first.decisions[1],id:'three'}]};
  const merged = mergeReviewDecisions(first,second);
  assert.equal(merged.decisions.length,3);
  assert.equal(merged.decisions.find(d => d.id==='one').status,'requires_review');
  assert.equal(merged.decisions.find(d => d.id==='one').reviewed_at,first.reviewed_at);
  assert.equal(merged.decisions.find(d => d.id==='three').reviewed_at,second.reviewed_at);
  assert.equal(merged.evidence_files.length,2);
  assert.equal(first.decisions.length,2);
});
test('Scalanie przeglądów odrzuca inną migawkę i powtórzone decyzje w nowej partii', () => {
  const first = {...decisionDoc(fixture()),evidence_files:[]};
  assert.throws(() => mergeReviewDecisions(first,{...first,baseline_input_fingerprint:'other'}));
  assert.throws(() => mergeReviewDecisions(first,{...first,decisions:[first.decisions[0],first.decisions[0]]}));
});
test('Przyjęta poprawka współrzędnych nie dopuszcza sklepu do gotowych danych przy nierozstrzygniętym kodzie pocztowym', () => {
  const input=fixture(),store=input.ready[0];
  input.input_fingerprint='raw';input.sources=[{chain:'biedronka',sha256:'source'}];
  store.location=null;store.quality={status:'needs_review',issues:[{code:'missing_geometry'}]};
  input.ready=input.ready.slice(1);input.review=[store];
  const point={latitude:52.1,longitude:20.1};
  const corrected=applyCorrections(input,{schema_version:1,baseline_input_fingerprint:'raw',scope:'test',corrections:[{
    id:store.id,status:'accepted_after_source_review',expected:{source_sha256:'source',location:null,address:structuredClone(store.address)},
    replacement:{location:point},resolves:['missing_geometry'],evidence:{provider:'openstreetmap'}
  }]});
  assert.equal(corrected.ready.length,2);
  const doc=decisionDoc(corrected);
  const final=applyReviewDecisions(corrected,doc),held=final.review.find(s=>s.id===store.id);
  assert.deepEqual(held.location,point);
  assert.equal(held.quality.status,'needs_review');
  assert.ok(!held.quality.issues.some(i=>i.code==='missing_geometry'));
  assert.ok(held.quality.issues.some(i=>i.code==='cross_source_address_conflict'));
  assert.equal(final.ready.length,1);assert.equal(input.review[0].location,null);
});
