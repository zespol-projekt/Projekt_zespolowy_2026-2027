import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadSources, prepareData, run } from "./przygotuj-dane.mjs";
import { loadCorrections } from "./poprawki.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const verification = "weryfikacja-biedronki/";
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const write = (file, data) => fs.writeFileSync(path.join(root, file), JSON.stringify(data, null, 2) + "\n");
const hash = (raw) => createHash("sha256").update(raw).digest("hex");
const text = (value) => String(value ?? "").normalize("NFC").replace(/\s+/gu, " ").trim();
const number = (value) => value === null || value === undefined || text(value) === "" ? null
  : Number.isFinite(Number(value)) ? Number(value) : null;
const locationOf = (item) => {
  const latitude = number(item.latitude), longitude = number(item.longitude);
  return latitude !== null && longitude !== null && latitude >= 48.9 && latitude <= 55
    && longitude >= 14 && longitude <= 24.3 ? { latitude, longitude } : null;
};
const { manifest, datasets } = loadSources(root);
const baseline = prepareData(manifest, datasets);
const baselineTargets = baseline.review.filter((s) => s.chain === "biedronka");
const apiManifest = read(verification + "pelny-przebieg/oficjalne/manifest.json");
const responses = new Map();
for (const metadata of apiManifest.responses) {
  assert.equal(metadata.status, 200);
  assert.equal(metadata.usable, true);
  const raw = fs.readFileSync(path.join(root, metadata.file));
  assert.equal(hash(raw), metadata.sha256, `Niezgodna odpowiedź oficjalna: ${metadata.file}`);
  const data = JSON.parse(raw.toString("utf8"));
  assert.ok(!data.error && Array.isArray(data.items));
  assert.ok(!responses.has(metadata.url));
  responses.set(metadata.url, { data, metadata });
}
assert.equal(responses.size, new Set(baselineTargets.map((s) => s.source.original_url)).size);
const observations = baselineTargets.map((store) => {
  const { data, metadata } = responses.get(store.source.original_url);
  const matches = data.items.filter((item) => String(item.id) === store.source.store_id);
  assert.equal(matches.length, 1, `Nie znaleziono jednoznacznego ID w API: ${store.id}`);
  const item = matches[0], location = locationOf(item);
  const before = store.address;
  const address = { street: text(item.street) || null, house_number: text(item.street_number) || null,
    city: text(item.city) || null, postal_code: text(item.zip_code) || null };
  const addressChanges = Object.keys(address).filter((key) => text(before[key]) !== text(address[key]));
  const coordinateChanged = JSON.stringify(location) !== JSON.stringify(store.location);
  return { id: store.id, source: metadata, location, coordinate_changed: coordinateChanged,
    coordinate_candidate: coordinateChanged && Boolean(location), original_normalized_address: before,
    address, address_changed_fields: addressChanges,
    missing_street_can_be_completed: store.quality.issues.some((i) => i.code === "missing_street_address")
      && Boolean(address.street && address.house_number),
    complete_street_address: Boolean(address.street && address.house_number),
    closed_date: item.date_closed ?? null };
});
const officialReport = { generated_at: new Date().toISOString(), baseline_input_fingerprint: baseline.input_fingerprint,
  city_responses: responses.size, compared_records: observations.length,
  matched_by_exact_id: observations.length,
  still_without_coordinates: observations.filter((o) => !o.location).length,
  different_coordinates: observations.filter((o) => o.coordinate_changed).length,
  coordinate_candidates: observations.filter((o) => o.coordinate_candidate).length,
  any_address_change: observations.filter((o) => o.address_changed_fields.length).length,
  missing_street_can_be_completed: observations.filter((o) => o.missing_street_can_be_completed).length,
  address_comparison_note: "Różnice są liczone względem znormalizowanej migawki. Cztery różniące się rekordy: Żagań 2220 (E.), Opatów 7026 (1), Obra 7796 (15 zamiast 15B), Łomnica 7906 (końcowy przecinek). Nie przyjęto tych różnic jako poprawek.",
  records_with_closed_date: observations.filter((o) => o.closed_date).length,
  observations,
  limitation: "Porównanie dotyczy 803 rekordów wymagających kontroli w pierwotnej migawce, nie całej sieci. Niezmieniony punkt w API nie oznacza poprawnego położenia." };
write(verification + "raport-oficjalnego-api.json", officialReport);

const duplicateStores = baselineTargets.filter((s) => s.quality.issues.some((i) => i.code === "possible_duplicate_address"));
const duplicates = duplicateStores.map((store) => {
  const { data, metadata } = responses.get(store.source.original_url);
  const item = data.items.find((i) => String(i.id) === store.source.store_id);
  return { id: store.id, address: store.address, location: store.location, website: store.website,
    official_store_number: item.shop_number, official_location_id: item.location_id,
    official_hours: Object.fromEntries(Object.entries(item).filter(([key]) => key.startsWith("hours_"))),
    official_closed_date: item.date_closed, source: metadata };
});
write(verification + "mozliwe-duplikaty.json", { generated_at: new Date().toISOString(),
  status: "requires_human_review", applied_merge: false, records: duplicates,
  evidence_summary: "W Łazach oba wpisy Targowa 8 mają ten sam adres, punkt i location_id oficjalnego API. Numery sklepów i godziny są różne; brak podstaw do arbitralnego wyboru aktywnego wpisu.",
  proposal: "Sprawdzić, czy oba identyfikatory opisują tę samą fizyczną placówkę. Po potwierdzeniu użyć jednej tożsamości sklepu na mapie, zachowując oba identyfikatory jako aliasy i historię. Do tego czasu oba rekordy pozostają poza zbiorem gotowym." });

// Odtworzenie i kontrola obejmuje również dowody OSM oraz wszystkie surowe źródła.
const checked = run(root, true);
const ready = read("gotowe/sklepy.json"), review = read("do-weryfikacji/sklepy.json");
const all = [...ready.stores, ...review.stores];
assert.equal(new Set(all.map((s) => s.id)).size, baseline.ready.length + baseline.review.length);
assert.deepEqual(all.map((s) => s.id).sort(), [...baseline.ready, ...baseline.review].map((s) => s.id).sort());
const patches = loadCorrections(root);
const matching = read(verification + "raport-dopasowania.json");
const osm = read(verification + "pelny-przebieg/osm-polaczone.json");
const previous = read(verification + "pelny-przebieg/poprawki-przed-scaleniem.json");
const previousIds = new Set(previous.corrections.map((p) => p.id));
const oldPatchCount = patches.corrections.filter((p) => previousIds.has(p.id)).length;
assert.equal(oldPatchCount, previousIds.size, "Utracono poprzednią poprawkę.");
const baselineById = new Map([...baseline.ready, ...baseline.review].map((s) => [s.id, s]));
const patchesById = new Map(patches.corrections.map((p) => [p.id, p]));
for (const store of all) {
  const original = baselineById.get(store.id), patch = patchesById.get(store.id);
  if (!patch) {
    assert.deepEqual(store.address, original.address);
    assert.deepEqual(store.location, original.location);
  } else {
    assert.deepEqual(store.address, patch.replacement.address ?? original.address);
    assert.deepEqual(store.location, patch.replacement.location ?? original.location);
    assert.equal(store.quality.status, store.source_review?.status === "requires_review" ? "needs_review" : "ready");
  }
}
const byRule = {};
for (const p of patches.corrections) byRule[p.evidence.match_rule] = (byRule[p.evidence.match_rule] ?? 0) + 1;
const csv = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';
const saveCsv = (file, rows) => fs.writeFileSync(path.join(root, verification + file), '\uFEFF'
  + rows.map(row => row.map(csv).join(';')).join('\r\n') + '\r\n');
const allById = new Map(all.map(s => [s.id, s]));
const decisionsById = new Map(matching.decisions.map(d => [d.id, d]));
saveCsv('przyjete-poprawki.csv', [['id', 'adres_pierwotny', 'adres_po_poprawce', 'zmienione_pola', 'status_biezacy',
  'wynik_przegladu_zrodel', 'uwagi_przegladu', 'latitude', 'longitude', 'osm', 'regula'],
  ...patches.corrections.map(p => { const s = allById.get(p.id); return [p.id, p.expected.address.formatted, s.address.formatted,
    Object.keys(p.replacement).join(', '), s.quality.status, s.source_review?.status, s.source_review?.reason,
    s.location?.latitude, s.location?.longitude, p.evidence.url, p.evidence.match_rule]; })]);
const reviewRows = [['id', 'adres', 'problemy', 'wynik_przegladu_zrodel', 'uwagi_przegladu', 'osm_propozycja',
  'powod_propozycji', 'latitude_propozycji', 'longitude_propozycji', 'adres_propozycji', 'ranking_nie_prawdopodobienstwo']];
for (const s of review.stores) {
  const p = patchesById.get(s.id), d = decisionsById.get(s.id);
  const proposals = p ? [{osm_url: p.evidence.url, reason: 'cross_source_address_conflict',
    location: p.replacement.location ?? p.expected.location, address: p.replacement.address ?? p.expected.address}]
    : d?.suggestions?.length ? d.suggestions : [{}];
  for (const proposal of proposals) { const a = proposal.address;
    reviewRows.push([s.id, s.address.formatted, s.quality.issues.map(i => i.code).join(', '), s.source_review?.status,
      s.source_review?.reason, proposal.osm_url, proposal.reason, proposal.location?.latitude, proposal.location?.longitude,
      a?.formatted ?? (a ? [a.street, a.house_number, a.postal_code, a.city].filter(Boolean).join(' ') : ''), proposal.score]);
  }
}
saveCsv('pozostale-do-sprawdzenia.csv', reviewRows);
const summary = { generated_at: new Date().toISOString(), verified_outputs_generated_at: ready.generated_at,
  input_fingerprint: ready.input_fingerprint, baseline_review_records: baselineTargets.length,
  previously_review_records: baselineTargets.length - previous.corrections.length,
  accepted_total: patches.corrections.length, accepted_in_previous_sample: oldPatchCount,
  accepted_automatic: patches.corrections.filter(p => p.status === "accepted_automatic").length,
  accepted_after_source_review: patches.corrections.filter(p => p.status === "accepted_after_source_review").length,
  newly_accepted: patches.corrections.length - oldPatchCount,
  source_review: checked.source_review ?? null,
  corrected_records_in_ready: ready.stores.filter(s => patchesById.has(s.id)).length,
  corrected_records_held_for_review: review.stores.filter(s => patchesById.has(s.id)).length,
  coordinate_updates: checked.corrections.coordinates, address_updates: checked.corrections.addresses,
  missing_coordinates_filled: patches.corrections.filter((p) => p.replacement.location && !p.expected.location).length,
  suspect_existing_points_replaced: patches.corrections.filter((p) => p.replacement.location && p.expected.location).length,
  by_matching_rule: byRule,
  official_api: { city_responses: responses.size, compared_records: observations.length,
    coordinate_candidates: officialReport.coordinate_candidates, any_address_change: officialReport.any_address_change,
    missing_street_can_be_completed: officialReport.missing_street_can_be_completed,
    report: verification + "raport-oficjalnego-api.json" },
  osm: { unique_elements: osm.elements.length, saved_responses: osm.provenance.sources.length,
    covered_regions: osm.provenance.coverage.filter((r) => r.complete).length,
    total_regions: osm.provenance.coverage.length, scope: osm.provenance.scope },
  dataset: { total: all.length, ready: ready.count, review: review.count, chains: checked.sources,
    remaining_issue_counts: checked.issue_counts },
  unresolved_with_suggestions: matching.decisions.filter((d) => !patchesById.has(d.id) && d.suggestions?.length).length,
  checks: { source_hashes_and_evidence: "passed", output_reproduction: "passed",
    all_scoped_ids_preserved_once: "passed", changes_match_only_recorded_patches: "passed",
    previous_corrections_preserved: "passed" },
  files: { accepted_csv: verification + "przyjete-poprawki.csv", remaining_csv: verification + "pozostale-do-sprawdzenia.csv",
    all_decisions_csv: verification + "do-sprawdzenia.csv", possible_duplicates: verification + "mozliwe-duplikaty.json",
    seven_record_source_review: verification + "przeglad-siedmiu/raport.json",
    twenty_record_sample_review: verification + "proba-20/raport.json",
    first_suggestion_batch: verification + "propozycje-01/raport.json",
    second_suggestion_batch: verification + "propozycje-02/raport.json" },
  limitation: "Przyjęto dopasowania spełniające reguły automatyczne. Wymagają późniejszego przeglądu; nie potwierdzają otwarcia ani kompletności sieci. Ranking propozycji nie jest prawdopodobieństwem. Żadnego rekordu nie scalono." };
const proposalReports = fs.readdirSync(path.join(root,verification)).filter(name => /^propozycje-\d{2}$/u.test(name))
  .map(name => verification + name + '/raport.json').filter(file => fs.existsSync(path.join(root,file)))
  .sort().map(file => ({file,report:read(file)}));
if (proposalReports.length) {
  const reviewedIds = new Set();
  for (const {report} of proposalReports) for (const record of report.records) {
    assert.ok(!reviewedIds.has(record.id),'Powtórzony sklep w przeglądzie partii propozycji.'); reviewedIds.add(record.id);
  }
  summary.suggestion_batches = { reviewed: reviewedIds.size, accepted: proposalReports.reduce((sum,b) => sum + b.report.accepted,0),
    reviewed_unresolved: proposalReports.reduce((sum,b) => sum + b.report.unresolved,0),
    address_follow_up: proposalReports.reduce((sum,b) => sum + (b.report.address_follow_up??0),0),
    reports: proposalReports.map(({file,report}) => ({file,reviewed:report.reviewed,accepted:report.accepted,unresolved:report.unresolved,address_follow_up:report.address_follow_up??0})),
    unreviewed_with_suggestions: matching.decisions.filter(d => !patchesById.has(d.id) && d.suggestions?.length && !reviewedIds.has(d.id)).length };
  saveCsv('kolejne-propozycje.csv', [['id', 'adres', 'najwyzszy_ranking_nie_prawdopodobienstwo', 'osm'],
    ...matching.decisions.filter(d => !patchesById.has(d.id) && d.suggestions?.length && !reviewedIds.has(d.id))
      .sort((a,b) => Math.max(...b.suggestions.map(s => s.score)) - Math.max(...a.suggestions.map(s => s.score)) || a.id.localeCompare(b.id))
      .map(d => [d.id, d.address, Math.max(...d.suggestions.map(s => s.score)), d.suggestions[0].osm_url])]);
}
write(verification + "podsumowanie.json", summary);
console.log(JSON.stringify({ ...summary, dataset: { total: all.length, ready: ready.count, review: review.count } }, null, 2));
