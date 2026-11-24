import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { applyCorrections, loadCorrections } from "./poprawki.mjs";
import { applyReviewDecisions, loadReviewDecisions } from "./przeglad.mjs";

export const SCHEMA_VERSION = 1;
const CHAINS = ["lidl", "biedronka", "dino", "auchan"];
const LABELS = { lidl: "Lidl", biedronka: "Biedronka", dino: "Dino", auchan: "Auchan", kaufland: "Kaufland", carrefour: "Carrefour" };
const AUCHAN_FORMATS = { "Auchan Super": "supermarket", "Auchan Hiper": "hypermarket" };
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const text = (value) => typeof value === "string" || typeof value === "number"
  ? String(value).normalize("NFC").replace(/\s+/gu, " ").trim() || null : null;
const key = (value) => (text(value) ?? "").normalize("NFKC").toLocaleLowerCase("pl-PL");

function addressOf(p, chain) {
  const full = text(p["addr:full"]);
  const parsed = full?.replace(/,\s*Polska$/iu, "").match(/^(.+),\s*(\d{2}-\d{3})\s+([^,]+)$/u);
  const street = text(p["addr:street"]);
  const houseNumber = text(p["addr:housenumber"]);
  const streetAddress = text(p["addr:street_address"])
    ?? (street ? [street, houseNumber].filter(Boolean).join(" ") : null) ?? text(parsed?.[1]);
  const city = text(p["addr:city"]) ?? text(parsed?.[3]) ?? (chain === "dino" ? text(p.branch) : null);
  const postalCode = text(p["addr:postcode"]) ?? text(parsed?.[2]);
  return {
    formatted: full ?? [streetAddress, [postalCode, city].filter(Boolean).join(" ")].filter(Boolean).join(", "),
    street_address: streetAddress, street, house_number: houseNumber, city, postal_code: postalCode, country: "PL",
  };
}

function issue(store, code, message, relatedIds = []) {
  if (store.quality.issues.some((entry) => entry.code === code)) return;
  store.quality.issues.push({ code, message,
    ...(relatedIds.length ? { related_ids: [...new Set(relatedIds)].sort() } : {}) });
}

function locationOf(feature, store) {
  const geometry = feature.geometry;
  if (!geometry) { issue(store, "missing_geometry", "Brak współrzędnych w źródle."); return null; }
  const c = geometry.coordinates;
  if (geometry.type !== "Point" || !Array.isArray(c) || c.length < 2
    || !Number.isFinite(c[0]) || !Number.isFinite(c[1]) || Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90) {
    issue(store, "invalid_geometry", "Geometria nie zawiera poprawnego punktu GeoJSON."); return null;
  }
  const [longitude, latitude] = c;
  // Orientacyjny prostokąt: nie zastępuje sprawdzenia adresu ani granic kraju.
  if (longitude < 14 || longitude > 24.3 || latitude < 48.9 || latitude > 55) {
    issue(store, "outside_poland_bounds", "Punkt jest poza orientacyjnym prostokątem obejmującym Polskę.");
  }
  return { latitude, longitude };
}

const byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

function groupsOf(stores, getKey) {
  const groups = new Map();
  for (const store of stores) {
    const value = getKey(store);
    if (value === null) continue;
    const group = groups.get(value) ?? [];
    group.push(store); groups.set(value, group);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

function markGroup(group, code, message) {
  for (const store of group) issue(store, code, message, group.filter((other) => other !== store).map((other) => other.id));
}

export function prepareData(manifest, datasets) {
  assert.equal(manifest.filters?.country, "PL", "Obsługiwany kraj: PL.");
  if (manifest.sources.some(({ chain }) => chain === "auchan")) {
    assert.deepEqual([...manifest.filters.auchan_allowed_brands].sort(), Object.keys(AUCHAN_FORMATS).sort(),
      "Zakres Auchan musi obejmować wyłącznie Super i Hiper.");
  }
  const stores = [], summaries = [], sources = [];
  const occurrences = new Map();
  for (const source of manifest.sources) {
    const { chain } = source;
    const dataset = datasets[chain];
    assert.ok(source && dataset, `Brakuje źródła: ${chain}`);
    assert.equal(dataset.type, "FeatureCollection", `Nieprawidłowy GeoJSON: ${chain}`);
    assert.ok(Array.isArray(dataset.features), `Brakuje tablicy features: ${chain}`);
    const summary = { chain, input_records: dataset.features.length, excluded_country: 0,
      excluded_store_format: 0, selected_records: 0, ready_records: 0, review_records: 0 };
    summaries.push(summary);
    const collectedAt = dataset.dataset_attributes?.["spider:collection_time"] ?? null;
    sources.push({ chain, file: source.file, url: source.url, sha256: source.sha256, collected_at: collectedAt,
      ...(source.downloaded_at ? { downloaded_at: source.downloaded_at } : {}) });
    for (const [index, feature] of dataset.features.entries()) {
      assert.equal(feature?.type, "Feature", `Nieprawidłowy obiekt: ${chain}, indeks ${index}`);
      const p = feature.properties ?? {};
      if (text(p["addr:country"])?.toUpperCase() !== "PL") { summary.excluded_country++; continue; }
      if ((chain === "auchan" && !Object.hasOwn(AUCHAN_FORMATS, p.brand))
        || (chain === "carrefour" && p.brand !== "Carrefour")) {
        summary.excluded_store_format++;
        continue;
      }
      summary.selected_records++;
      const ref = text(p.ref), featureId = text(feature.id), sourceId = ref ?? featureId;
      const identity = `${chain}:${sourceId ?? `derived-${sha256(JSON.stringify(feature)).slice(0, 24)}`}`;
      const occurrence = (occurrences.get(identity) ?? 0) + 1;
      occurrences.set(identity, occurrence);
      const store = {
        id: occurrence === 1 ? identity : `${identity}#occurrence-${occurrence}`,
        chain, name: text(p.name) ?? LABELS[chain], brand: text(p.brand) ?? LABELS[chain],
        store_format: chain === "auchan" ? AUCHAN_FORMATS[p.brand] : chain === "carrefour" ? "hypermarket" : "supermarket",
        address: addressOf(p, chain), location: null, website: text(p.website),
        source: { provider: source.provider ?? "alltheplaces", store_id: sourceId,
          id_kind: ref ? "ref" : featureId ? "feature_id" : "derived", feature_id: featureId,
          dataset_file: source.file, feature_index: feature.source_index ?? index, dataset_url: source.url,
          original_url: text(p["@source_uri"]), collected_at: collectedAt },
        quality: { status: "ready", issues: [] },
      };
      if (!sourceId) issue(store, "missing_source_id", "Brak identyfikatora w źródle; identyfikator wyliczono z treści rekordu.");
      store.location = locationOf(feature, store);
      if (!store.address.city) issue(store, "missing_city", "Brak miejscowości w danych adresowych.");
      if (!store.address.street_address && !text(p["addr:full"])) {
        issue(store, "missing_street_address", "Brak ulicy lub pełnego adresu sklepu.");
      }
      stores.push(store);
    }
  }
  for (const group of groupsOf(stores, (s) => s.source.store_id ? `${s.chain}|${s.source.id_kind}|${s.source.store_id}` : null)) {
    markGroup(group, "duplicate_source_id", "Powtórzony identyfikator w tej samej sieci; zachowano wszystkie rekordy.");
  }
  for (const group of groupsOf(stores, (s) => s.location
    ? `${s.chain}|${s.location.longitude.toFixed(5)}|${s.location.latitude.toFixed(5)}` : null)) {
    const differentCities = new Set(group.map((s) => key(s.address.city))).size > 1;
    markGroup(group, differentCities ? "shared_coordinates_different_cities" : "shared_coordinates",
      differentCities ? "Sklepy tej samej sieci w różnych miejscowościach współdzielą punkt z dokładnością do 5 miejsc po przecinku."
        : "Kilka rekordów tej samej sieci współdzieli punkt; wymagana weryfikacja.");
  }
  for (const group of groupsOf(stores, (s) => s.address.city && s.address.street_address
    ? `${s.chain}|${key(s.address.city)}|${key(s.address.street_address)}` : null)) {
    markGroup(group, "possible_duplicate_address", "Powtórzony adres w tej samej sieci; nie scalono rekordów automatycznie.");
  }
  stores.sort(byId);
  const ready = [], review = [], issueCounts = {};
  for (const store of stores) {
    store.quality.issues.sort((a, b) => a.code.localeCompare(b.code));
    const requiresReview = store.quality.issues.length > 0;
    store.quality.status = requiresReview ? "needs_review" : "ready";
    (requiresReview ? review : ready).push(store);
    summaries.find((entry) => entry.chain === store.chain)[requiresReview ? "review_records" : "ready_records"]++;
    for (const entry of store.quality.issues) issueCounts[entry.code] = (issueCounts[entry.code] ?? 0) + 1;
  }
  for (const s of summaries) {
    assert.equal(s.selected_records, s.ready_records + s.review_records);
    assert.equal(s.input_records, s.selected_records + s.excluded_country + s.excluded_store_format);
  }
  assert.equal(new Set(stores.map((s) => s.id)).size, stores.length, "Nieunikalne identyfikatory wyjściowe.");
  assert.ok(ready.every((s) => s.location && s.quality.issues.length === 0));
  return { schema_version: SCHEMA_VERSION,
    input_fingerprint: sha256(JSON.stringify({ schema_version: SCHEMA_VERSION, filters: manifest.filters, sources })), sources,
    ready, review, report: {
      input_records: summaries.reduce((sum, entry) => sum + entry.input_records, 0),
      selected_records: stores.length, ready_records: ready.length, review_records: review.length,
      issue_counts: issueCounts, sources: summaries,
      limitation: "Gotowe oznacza przejście opisanych kontroli automatycznych. Nie potwierdza kompletności sieci ani zgodności każdego punktu z adresem.",
    } };
}

function localPath(baseDirectory, relativePath) {
  const root = path.resolve(baseDirectory), resolved = path.resolve(root, relativePath);
  assert.ok(resolved.startsWith(root + path.sep), `Ścieżka musi pozostać w katalogu danych: ${relativePath}`);
  return resolved;
}

function kauflandFeatures(records) {
  assert.ok(Array.isArray(records) && records.length, "Lokalizator Kauflandu nie zwrócił placówek.");
  return { type: "FeatureCollection", features: records.map((store) => {
    assert.match(store.n, /^PL[0-9]+$/u, "Oczekiwano identyfikatora placówki Kaufland w Polsce.");
    return {
      type: "Feature",
      properties: {
        ref: store.n, brand: "Kaufland", name: store.cn,
        "addr:country": "PL", "addr:city": store.t, "addr:postcode": store.pc,
        "addr:street_address": store.sn,
        website: store.friendlyUrl ? `https://sklep.kaufland.pl/uslugi/sklepy/${store.friendlyUrl}.html` : null,
      },
      geometry: text(store.lng) && text(store.lat)
        ? { type: "Point", coordinates: [Number(store.lng), Number(store.lat)] } : null,
    };
  }) };
}

export function loadSources(baseDirectory) {
  const manifest = JSON.parse(fs.readFileSync(localPath(baseDirectory, "zrodla.json"), "utf8").replace(/^\uFEFF/u, ""));
  assert.equal(manifest.sources.length, CHAINS.length, "Oczekiwane dokładnie cztery źródła.");
  assert.deepEqual(manifest.sources.map((s) => s.chain).sort(), [...CHAINS].sort());
  const datasets = {};
  for (const source of [...manifest.sources, ...(manifest.additional_sources ?? [])]) {
    assert.ok(source.file.startsWith("surowe/"), "Źródła muszą pochodzić z surowe/.");
    const raw = fs.readFileSync(localPath(baseDirectory, source.file));
    assert.equal(sha256(raw), source.sha256, `Suma kontrolna nie zgadza się: ${source.file}. Zaktualizuj świadomie manifest źródeł.`);
    const data = JSON.parse(raw.toString("utf8"));
    datasets[source.file] = source.chain === "kaufland" ? kauflandFeatures(data) : data;
  }
  return { manifest, datasets: Object.fromEntries(manifest.sources.map(source => [source.chain, datasets[source.file]])),
    additionalDatasets: Object.fromEntries((manifest.additional_sources ?? []).map(source => [source.chain, datasets[source.file]])) };
}

export function buildOutputs(result, generatedAt) {
  const metadata = { schema_version: result.schema_version, generated_at: generatedAt,
    input_fingerprint: result.input_fingerprint, sources: result.sources,
    ...(result.biedronka_lomnica_audit ? { biedronka_lomnica_audit: result.biedronka_lomnica_audit } : {}),
    ...(result.biedronka_registry_audit ? { biedronka_registry_audit: result.biedronka_registry_audit } : {}),
    ...(result.biedronka_site_audit ? { biedronka_site_audit: result.biedronka_site_audit } : {}),
    ...(result.biedronka_building_audit ? { biedronka_building_audit: result.biedronka_building_audit } : {}),
    ...(result.biedronka_location_audit ? { biedronka_location_audit: result.biedronka_location_audit } : {}),
    ...(result.biedronka_recheck_audit ? { biedronka_recheck_audit: result.biedronka_recheck_audit } : {}),
    ...(result.biedronka_remaining_audit ? { biedronka_remaining_audit: result.biedronka_remaining_audit } : {}),
    ...(result.biedronka_individual_audit ? { biedronka_individual_audit: result.biedronka_individual_audit } : {}),
    ...(result.biedronka_corrected_address_audit ? { biedronka_corrected_address_audit: result.biedronka_corrected_address_audit } : {}),
    ...(result.biedronka_overture_audit ? { biedronka_overture_audit: result.biedronka_overture_audit } : {}),
    ...(result.biedronka_osm_address_audit ? { biedronka_osm_address_audit: result.biedronka_osm_address_audit } : {}),
    ...(result.biedronka_postcode_audit ? { biedronka_postcode_audit: result.biedronka_postcode_audit } : {}),
    ...(result.biedronka_targeted_audit ? { biedronka_targeted_audit: result.biedronka_targeted_audit } : {}),
    ...(result.biedronka_followup_audit ? { biedronka_followup_audit: result.biedronka_followup_audit } : {}),
    ...(result.biedronka_address_audit ? { biedronka_address_audit: result.biedronka_address_audit } : {}),
    ...(result.biedronka_audit ? { biedronka_audit: result.biedronka_audit } : {}),
    ...(result.review_metadata ? { source_review: result.review_metadata } : {}),
    ...(result.correction_metadata ? { corrections: result.correction_metadata,
      baseline_input_fingerprint: result.baseline_input_fingerprint } : {}) };
  return {
    "gotowe/sklepy.json": { ...metadata, count: result.ready.length, stores: result.ready },
    "do-weryfikacji/sklepy.json": { ...metadata, count: result.review.length, stores: result.review,
      ...(result.duplicateRecords ? { duplicate_count: result.duplicateRecords.length, duplicate_records: result.duplicateRecords } : {}) },
    "raport-przygotowania.json": { ...metadata, ...result.report },
  };
}

export function prepareCatalogue(baseDirectory, { auditCount = Infinity } = {}) {
  const { manifest, datasets, additionalDatasets } = loadSources(baseDirectory);
  const result = applyReviewDecisions(applyCorrections(prepareData(manifest, datasets), loadCorrections(baseDirectory)), loadReviewDecisions(baseDirectory));
  // Dawna migawka pozostaje podstawą weryfikacji podpisanych poprawek Biedronki.
  // Zakres publikacji stosujemy po sprawdzeniu tych dowodów.
  const publishedChains = ["lidl", "biedronka", "dino"];
  const published = (entry) => publishedChains.includes(entry.chain);
  const previousBiedronka = [...result.ready, ...result.review].filter(store => store.chain === "biedronka");
  const knownIds = new Set(previousBiedronka.map(store => store.source.store_id));
  const changedAddresses = new Set(manifest.biedronka_address_updates);
  const update = additionalDatasets.biedronka;
  const wanted = feature => !knownIds.has(text(feature.properties.ref))
    || changedAddresses.has(text(feature.properties.ref));
  const changes = { ...additionalDatasets, biedronka: { ...update, features: update.features
    .map((feature, source_index) => ({ ...feature, source_index }))
    .filter(wanted) } };
  const additions = prepareData({ filters: { country: "PL" }, sources: manifest.additional_sources }, changes);
  for (const store of additions.ready.filter(entry => entry.chain === "biedronka")) {
    const matches = previousBiedronka.filter(previous =>
      key(previous.address.city) === key(store.address.city)
        && key(previous.address.street_address) === key(store.address.street_address));
    if (matches.length) {
      issue(store, "possible_duplicate_address", "Adres jest już w katalogu Biedronki.", matches.map(match => match.id));
      store.quality.status = "needs_review";
      additions.review.push(store);
      const summary = additions.report.sources.find(source => source.chain === "biedronka");
      summary.ready_records--;
      summary.review_records++;
    }
  }
  additions.ready = additions.ready.filter(store => store.quality.status === "ready");
  for (const ref of changedAddresses) {
    const previous = previousBiedronka.find(store => store.source.store_id === ref);
    assert.ok(previous && additions.review.some(store => store.id === previous.id && store.location === null),
      `Brakuje rekordu ze zmienionym adresem bez potwierdzonego punktu: ${ref}`);
    const summary = result.report.sources.find(source => source.chain === "biedronka");
    summary[previous.quality.status === "ready" ? "ready_records" : "review_records"]--;
    summary.selected_records--;
    summary.input_records--;
  }
  const keep = entry => published(entry)
    && !(entry.chain === "biedronka" && changedAddresses.has(entry.source.store_id));
  result.ready = [...result.ready.filter(keep), ...additions.ready];
  result.review = [...result.review.filter(keep), ...additions.review];
  result.sources = [...result.sources.filter(published), ...additions.sources];
  const report = result.report;
  report.sources = [...report.sources.filter(published), ...additions.report.sources];
  report.input_records = report.sources.reduce((total, source) => total + source.input_records, 0);
  report.ready_records = result.ready.length;
  report.review_records = result.review.length;
  report.selected_records = report.ready_records + report.review_records;
  report.issue_counts = {};
  for (const store of result.review) {
    for (const { code } of store.quality.issues) report.issue_counts[code] = (report.issue_counts[code] ?? 0) + 1;
  }
  result.input_fingerprint = sha256(JSON.stringify({ snapshot: result.input_fingerprint, publishedChains, additions: additions.input_fingerprint }));
  const auditKeys = ["biedronka_audit", "biedronka_address_audit", "biedronka_followup_audit", "biedronka_targeted_audit", "biedronka_postcode_audit", "biedronka_osm_address_audit", "biedronka_overture_audit", "biedronka_corrected_address_audit", "biedronka_individual_audit", "biedronka_remaining_audit", "biedronka_recheck_audit", "biedronka_location_audit", "biedronka_building_audit", "biedronka_site_audit", "biedronka_registry_audit", "biedronka_lomnica_audit"];
  for (const key of auditKeys.slice(0, auditCount)) {
    if (manifest[key]) result[key] = applyCatalogueAudit(result, baseDirectory, manifest[key]);
  }
  return result;
}

function applyCatalogueAudit(result, baseDirectory, auditFile) {
  const report = result.report;
  const auditRaw = fs.readFileSync(localPath(baseDirectory, auditFile));
  const audit = JSON.parse(auditRaw);
  assert.equal(audit.input_fingerprint, result.input_fingerprint, "Przegląd Biedronki dotyczy innej wersji katalogu.");
  assert.deepEqual(audit.decisions.map(row => row.id).sort(), result.review.map(store => store.id).sort(),
    "Przegląd musi obejmować aktualną listę rekordów do weryfikacji.");
  const accepted = new Map(audit.decisions.filter(row => row.accepted).map(row => [row.id, row.accepted]));
  result.review = result.review.filter(store => {
    const correction = accepted.get(store.id);
    if (!correction) return true;
    const issues = store.quality.issues.map(entry => entry.code);
    assert.deepEqual([...issues].sort(), correction.resolves ?? ["missing_geometry"]);
    if (issues.includes("missing_geometry")) assert.equal(store.location, null);
    for (const code of issues) {
      report.issue_counts[code]--;
      if (report.issue_counts[code] === 0) delete report.issue_counts[code];
    }
    store.location = locationOf({ geometry: { type: "Point", coordinates: [correction.location.longitude, correction.location.latitude] } }, store);
    assert.ok(store.location && store.quality.issues.length === issues.length, `Nieprawidłowe współrzędne: ${store.id}`);
    if (correction.address) store.address = correction.address;
    if (store.source_review?.status === "requires_review") {
      store.prior_source_review = store.source_review;
      store.source_review = {
        status: "corroborated",
        reviewed_at: audit.retrieved_on,
        report_file: auditFile,
        reason: "Weryfikacja lokalizacji zakończona na podstawie dodatkowego źródła.",
      };
    }
    store.quality = { status: "ready", issues: [] };
    if (audit.overture_release || correction.overture_release || correction.precision === "official_shop_point") {
      store.location_verification = {
        evidence: correction.evidence, official_address: correction.official_address,
        precision: correction.precision, retrieved_on: audit.retrieved_on,
        ...(correction.alias_ids ? { alias_ids: correction.alias_ids } : {}),
        ...(correction.overture_id ? { overture_id: correction.overture_id, overture_release: correction.overture_release ?? audit.overture_release } : {}),
        ...(correction.address_evidence ? { address_evidence: correction.address_evidence } : {}),
      };
    } else {
      store.location_verification = ["address_point", "building_footprint"].includes(correction.precision)
        ? { evidence: correction.evidence, official_address: correction.official_address, precision: correction.precision, retrieved_on: audit.retrieved_on,
          ...(correction.address_evidence ? { address_evidence: correction.address_evidence } : {}) }
        : { evidence: correction.evidence, osm_observed_at: correction.osm_observed_at ?? audit.osm_observed_at,
          ...(correction.address_evidence ? { official_address: correction.official_address, address_evidence: correction.address_evidence } : {}) };
    }
    result.ready.push(store);
    const index = result.sources.findIndex(source => source.file === store.source.dataset_file);
    assert.ok(index >= 0);
    report.sources[index].ready_records++;
    report.sources[index].review_records--;
    return false;
  });
  const aliases = new Map(audit.decisions.filter(row => row.alias_of).map(row => [row.id, row]));
  if (aliases.size) {
    result.duplicateRecords ??= [];
    const readyById = new Map(result.ready.map(store => [store.id, store]));
    result.review = result.review.filter(store => {
      const decision = aliases.get(store.id);
      if (!decision) return true;
      const published = readyById.get(decision.alias_of);
      assert.ok(published && published.chain === store.chain && key(published.address.formatted) === key(store.address.formatted),
        `Nie udało się powiązać rekordu ${store.id} z opublikowanym adresem.`);
      published.source_aliases ??= [];
      published.source_aliases.push({ id: store.id, evidence: decision.evidence, report_file: auditFile });
      result.duplicateRecords.push({ ...store, duplicate_of: published.id, evidence: decision.evidence, report_file: auditFile });
      const summary = report.sources[result.sources.findIndex(source => source.file === store.source.dataset_file)];
      summary.review_records--;
      summary.duplicate_records = (summary.duplicate_records ?? 0) + 1;
      for (const { code } of store.quality.issues) {
        report.issue_counts[code]--;
        if (report.issue_counts[code] === 0) delete report.issue_counts[code];
      }
      return false;
    });
    report.duplicate_records = result.duplicateRecords.length;
  }
  report.ready_records = result.ready.length;
  report.review_records = result.review.length;
  assert.equal(report.selected_records, report.ready_records + report.review_records + (report.duplicate_records ?? 0));
  const auditHash = sha256(auditRaw);
  result.input_fingerprint = sha256(JSON.stringify({ before_audit: result.input_fingerprint, audit: auditHash }));
  return { file: auditFile, sha256: auditHash, reviewed: audit.reviewed, accepted: accepted.size,
    ...(aliases.size ? { aliases: aliases.size } : {}) };
}

export function run(baseDirectory, checkOnly = false) {
  const result = prepareCatalogue(baseDirectory);
  const outputs = buildOutputs(result, new Date().toISOString());
  if (checkOnly) {
    const timestamps = new Set();
    for (const [relative, expected] of Object.entries(outputs)) {
      const actual = JSON.parse(fs.readFileSync(localPath(baseDirectory, relative), "utf8"));
      assert.ok(Number.isFinite(Date.parse(actual.generated_at)), `Brak daty wygenerowania: ${relative}`);
      timestamps.add(actual.generated_at);
      assert.deepEqual({ ...actual, generated_at: null }, { ...expected, generated_at: null }, `Niezgodny wynik: ${relative}`);
    }
    assert.equal(timestamps.size, 1, "Pliki pochodzą z różnych uruchomień; wygeneruj komplet ponownie.");
  } else {
    const pending = [];
    try {
      for (const [relative, value] of Object.entries(outputs)) {
        const target = localPath(baseDirectory, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const temporary = `${target}.tmp-${process.pid}`;
        fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
        pending.push({ target, temporary });
      }
      for (const { target, temporary } of pending) fs.renameSync(temporary, target);
    } finally {
      // Tylko pojedyncze pliki tymczasowe utworzone w tym uruchomieniu.
      for (const { temporary } of pending) if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }
  return result.report;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const options = process.argv.slice(2);
    assert.ok(options.every((option) => ["--check", "--help"].includes(option)), "Dostępne opcje: --check, --help.");
    if (options.includes("--help")) {
      console.log("node przygotuj-dane.mjs          — przygotowanie lokalnych danych\nnode przygotuj-dane.mjs --check  — kontrola wyników bez zapisywania plików");
    } else {
      const report = run(path.dirname(fileURLToPath(import.meta.url)), options.includes("--check"));
      console.log(JSON.stringify({ mode: options.includes("--check") ? "checked" : "generated", ...report }, null, 2));
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
