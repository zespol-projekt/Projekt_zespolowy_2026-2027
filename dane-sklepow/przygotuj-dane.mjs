import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { applyCorrections, loadCorrections } from "./poprawki.mjs";
import { applyReviewDecisions, loadReviewDecisions } from "./przeglad.mjs";

export const SCHEMA_VERSION = 1;
const CHAINS = ["lidl", "biedronka", "dino", "auchan"];
const LABELS = { lidl: "Lidl", biedronka: "Biedronka", dino: "Dino", auchan: "Auchan" };
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
  assert.deepEqual([...manifest.filters.auchan_allowed_brands].sort(), Object.keys(AUCHAN_FORMATS).sort(),
    "Zakres Auchan musi obejmować wyłącznie Super i Hiper.");
  const stores = [], summaries = [], sources = [];
  const occurrences = new Map();
  for (const chain of CHAINS) {
    const source = manifest.sources.find((entry) => entry.chain === chain);
    const dataset = datasets[chain];
    assert.ok(source && dataset, `Brakuje źródła: ${chain}`);
    assert.equal(dataset.type, "FeatureCollection", `Nieprawidłowy GeoJSON: ${chain}`);
    assert.ok(Array.isArray(dataset.features), `Brakuje tablicy features: ${chain}`);
    const summary = { chain, input_records: dataset.features.length, excluded_country: 0,
      excluded_store_format: 0, selected_records: 0, ready_records: 0, review_records: 0 };
    summaries.push(summary);
    const collectedAt = dataset.dataset_attributes?.["spider:collection_time"] ?? null;
    sources.push({ chain, file: source.file, url: source.url, sha256: source.sha256, collected_at: collectedAt });
    for (const [index, feature] of dataset.features.entries()) {
      assert.equal(feature?.type, "Feature", `Nieprawidłowy obiekt: ${chain}, indeks ${index}`);
      const p = feature.properties ?? {};
      if (text(p["addr:country"])?.toUpperCase() !== "PL") { summary.excluded_country++; continue; }
      if (chain === "auchan" && !Object.hasOwn(AUCHAN_FORMATS, p.brand)) { summary.excluded_store_format++; continue; }
      summary.selected_records++;
      const ref = text(p.ref), featureId = text(feature.id), sourceId = ref ?? featureId;
      const identity = `${chain}:${sourceId ?? `derived-${sha256(JSON.stringify(feature)).slice(0, 24)}`}`;
      const occurrence = (occurrences.get(identity) ?? 0) + 1;
      occurrences.set(identity, occurrence);
      const store = {
        id: occurrence === 1 ? identity : `${identity}#occurrence-${occurrence}`,
        chain, name: text(p.name) ?? LABELS[chain], brand: text(p.brand) ?? LABELS[chain],
        store_format: chain === "auchan" ? AUCHAN_FORMATS[p.brand] : "supermarket",
        address: addressOf(p, chain), location: null, website: text(p.website),
        source: { provider: "alltheplaces", store_id: sourceId,
          id_kind: ref ? "ref" : featureId ? "feature_id" : "derived", feature_id: featureId,
          dataset_file: source.file, feature_index: index, dataset_url: source.url,
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
  stores.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
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

export function loadSources(baseDirectory) {
  const manifest = JSON.parse(fs.readFileSync(localPath(baseDirectory, "zrodla.json"), "utf8").replace(/^\uFEFF/u, ""));
  assert.equal(manifest.sources.length, CHAINS.length, "Oczekiwane dokładnie cztery źródła.");
  assert.deepEqual(manifest.sources.map((s) => s.chain).sort(), [...CHAINS].sort());
  const datasets = {};
  for (const source of manifest.sources) {
    assert.ok(source.file.startsWith("surowe/"), "Źródła muszą pochodzić z surowe/.");
    const raw = fs.readFileSync(localPath(baseDirectory, source.file));
    assert.equal(sha256(raw), source.sha256, `Suma kontrolna nie zgadza się: ${source.file}. Zaktualizuj świadomie manifest źródeł.`);
    datasets[source.chain] = JSON.parse(raw.toString("utf8"));
  }
  return { manifest, datasets };
}

export function buildOutputs(result, generatedAt) {
  const metadata = { schema_version: result.schema_version, generated_at: generatedAt,
    input_fingerprint: result.input_fingerprint, sources: result.sources,
    ...(result.review_metadata ? { source_review: result.review_metadata } : {}),
    ...(result.correction_metadata ? { corrections: result.correction_metadata,
      baseline_input_fingerprint: result.baseline_input_fingerprint } : {}) };
  return {
    "gotowe/sklepy.json": { ...metadata, count: result.ready.length, stores: result.ready },
    "do-weryfikacji/sklepy.json": { ...metadata, count: result.review.length, stores: result.review },
    "raport-przygotowania.json": { ...metadata, ...result.report },
  };
}

export function run(baseDirectory, checkOnly = false) {
  const { manifest, datasets } = loadSources(baseDirectory);
  const result = applyReviewDecisions(applyCorrections(prepareData(manifest, datasets), loadCorrections(baseDirectory)), loadReviewDecisions(baseDirectory));
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
