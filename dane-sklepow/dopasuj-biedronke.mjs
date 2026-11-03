import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadSources, prepareData } from "./przygotuj-dane.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const normalized = (value) => String(value ?? "").normalize("NFC").toLocaleLowerCase("pl-PL").replace(/\s+/gu, " ").trim();
const streetKey = (value) => normalized(value).replace(/^(?:ulica\s+|ul\.?\s+)/u, "")
  .replace(/^al\.\s*/u, "aleja ").replace(/^pl\.\s*/u, "plac ").replace(/^os\.\s*/u, "osiedle ");
const numberKey = (value) => normalized(value).replace(/\s+/gu, "").replace(/[–—]/gu, "-");
const isRoadNumber = (value) => /^(?:dw|dk)\s*\d+$/u.test(normalized(value));
const distanceMeters = (a, b) => {
  if (!a || !b) return Infinity;
  const rad = Math.PI / 180, x = (b.latitude - a.latitude) * rad, y = (b.longitude - a.longitude) * rad;
  const h = Math.sin(x / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(y / 2) ** 2;
  return 12742000 * Math.asin(Math.min(1, Math.sqrt(h)));
};
const addressKey = (address) => address.city && address.street && address.house_number
  ? `${normalized(address.city)}|${streetKey(address.street)}|${numberKey(address.house_number)}` : null;
const local = (root, name) => {
  const result = path.resolve(root, name);
  assert.ok(result.startsWith(path.resolve(root) + path.sep), "Ścieżka poza katalogiem danych.");
  return result;
};

function osmStore(element) {
  const t = element.tags ?? {};
  if (!["supermarket", "convenience"].includes(t.shop) || t.disused === "yes" || t["disused:shop"]
    || t.building === "construction" || t.construction || t["construction:shop"]) return null;
  if (!(normalized(t.brand) === "biedronka" || normalized(t.name) === "biedronka" || t["brand:wikidata"] === "Q857182")) return null;
  if (t["addr:country"] && normalized(t["addr:country"]) !== "pl") return null;
  const latitude = element.lat ?? element.center?.lat;
  const longitude = element.lon ?? element.center?.lon;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < 48.9 || latitude > 55 || longitude < 14 || longitude > 24.3) return null;
  const websiteId = String(t.website ?? t["contact:website"] ?? "").match(/https?:\/\/(?:www\.)?biedronka\.pl\/pl\/shop,id,(\d+)/iu)?.[1] ?? null;
  return { element, location: { latitude, longitude }, website_id: websiteId,
    address: { city: t["addr:city"] ?? t["addr:place"] ?? null, street: t["addr:street"] ?? t["addr:place"] ?? null,
      house_number: t["addr:housenumber"] ?? null, postal_code: t["addr:postcode"] ?? null } };
}

function exactAddress(store, candidate) {
  const a = store.address, b = candidate.address;
  if (!a.street || !a.house_number || !b.street || !b.house_number) return false;
  if (streetKey(a.street) !== streetKey(b.street) || numberKey(a.house_number) !== numberKey(b.house_number)) return false;
  if (b.city && normalized(a.city) !== normalized(b.city)) return false;
  if (a.postal_code && b.postal_code && normalized(a.postal_code) !== normalized(b.postal_code)) return false;
  return Boolean(b.city || (a.postal_code && b.postal_code && normalized(a.postal_code) === normalized(b.postal_code)));
}

function sameLocality(store, candidate) {
  const a = store.address, b = candidate.address;
  if (b.city && normalized(a.city) !== normalized(b.city)) return false;
  if (a.postal_code && b.postal_code && normalized(a.postal_code) !== normalized(b.postal_code)) return false;
  return Boolean(b.city || (a.postal_code && b.postal_code && normalized(a.postal_code) === normalized(b.postal_code)));
}

function compatibleStreetWithId(store, candidate) {
  if (candidate.website_id !== store.source.store_id || !sameLocality(store, candidate)) return false;
  if (!store.address.house_number || !candidate.address.house_number
    || numberKey(store.address.house_number) !== numberKey(candidate.address.house_number)) return false;
  const tokens = (value) => streetKey(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean)
    .filter((word) => !["gen", "generała", "generala", "dr", "doktora", "św", "świętego", "im", "imienia"].includes(word));
  const left = tokens(store.address.street), right = tokens(candidate.address.street);
  if (!left.length || !right.length || left.at(-1).length < 3 || left.at(-1) !== right.at(-1)) return false;
  return left.every((word) => right.includes(word) || (word.length === 1 && right.some((full) => full.startsWith(word))));
}

function addressFromOsm(store, candidate) {
  const street = candidate.address.street, house = candidate.address.house_number;
  const city = store.address.city ?? candidate.address.city;
  const postal = candidate.address.postal_code ?? store.address.postal_code;
  return { formatted: [`${street} ${house}`, [postal, city].filter(Boolean).join(" ")].join(", "),
    street_address: `${street} ${house}`, street, house_number: house, city, postal_code: postal, country: "PL" };
}

function suggestionsFor(store, osm) {
  return osm.flatMap((candidate) => {
    let reason, score = 0;
    if (candidate.website_id === store.source.store_id) { reason = "official_store_id"; score = 1; }
    else if (sameLocality(store, candidate) && store.address.house_number && candidate.address.house_number
      && numberKey(store.address.house_number) === numberKey(candidate.address.house_number)) {
      const left = streetKey(store.address.street), right = streetKey(candidate.address.street);
      if (!left || !right) return [];
      const lt = new Set(left.split(/[^\p{L}\p{N}]+/u)), rt = new Set(right.split(/[^\p{L}\p{N}]+/u));
      const overlap = [...lt].filter((token) => token.length > 2 && rt.has(token)).length;
      if (left === right) { score = 0.95; reason = "address_but_other_conflict"; }
      else if (overlap) { score = 0.5 + overlap / Math.max(lt.size, rt.size) * 0.35; reason = "similar_street_same_number_locality"; }
      else return [];
    } else return [];
    return [{ osm_url: `https://www.openstreetmap.org/${candidate.element.type}/${candidate.element.id}`,
      location: candidate.location, address: candidate.address, reason, score: Number(score.toFixed(3)),
      distance_from_original_m: Number.isFinite(distanceMeters(store.location, candidate.location))
        ? Math.round(distanceMeters(store.location, candidate.location)) : null }];
  }).sort((a, b) => b.score - a.score).slice(0, 3);
}

export function findMatches(baseline, elements, evidence) {
  const osm = elements.map(osmStore).filter(Boolean);
  const catalog = [...baseline.ready, ...baseline.review].filter((s) => s.chain === "biedronka");
  const addressCounts = new Map();
  for (const store of catalog) { const k = addressKey(store.address); if (k) addressCounts.set(k, (addressCounts.get(k) ?? 0) + 1); }
  const corrections = [], decisions = [];
  for (const store of baseline.review.filter((s) => s.chain === "biedronka")) {
    const decision = { id: store.id, address: store.address.formatted, status: "unmatched_in_available_osm" };
    decisions.push(decision);
    if (store.quality.issues.some((i) => ["duplicate_source_id", "possible_duplicate_address", "shared_coordinates"].includes(i.code))
      || (addressKey(store.address) && addressCounts.get(addressKey(store.address)) > 1)) {
      decision.status = "catalog_duplicate_requires_review"; continue;
    }
    const incomplete = !store.address.street || !store.address.house_number;
    let rule = incomplete ? "official_store_id_and_nearby_location" : "exact_address";
    let candidates = osm.filter((candidate) => incomplete
      ? candidate.website_id === store.source.store_id
        && (candidate.address.city ? normalized(store.address.city) === normalized(candidate.address.city) : sameLocality(store, candidate))
        && candidate.address.street && candidate.address.house_number && distanceMeters(store.location, candidate.location) <= 75
        && (!store.address.street || streetKey(store.address.street) === streetKey(candidate.address.street))
        && (!store.address.house_number || isRoadNumber(store.address.house_number)
          || numberKey(store.address.house_number) === numberKey(candidate.address.house_number))
      : exactAddress(store, candidate));
    if (!incomplete && candidates.length === 0) {
      candidates = osm.filter((candidate) => compatibleStreetWithId(store, candidate));
      if (candidates.length) rule = "official_store_id_and_compatible_street";
    }
    decision.osm_candidates = candidates.map((candidate) => `${candidate.element.type}/${candidate.element.id}`);
    if (candidates.length !== 1) {
      if (candidates.length > 1) decision.status = "ambiguous_osm_candidates";
      else if (incomplete) decision.status = "incomplete_address_requires_review";
      decision.suggestions = suggestionsFor(store, osm);
      continue;
    }
    const candidate = candidates[0];
    if (candidate.website_id && candidate.website_id !== store.source.store_id) { decision.status = "conflicting_official_store_id"; continue; }
    const coordinateIssues = store.quality.issues.map((i) => i.code).filter((code) =>
      ["missing_geometry", "invalid_geometry", "outside_poland_bounds", "shared_coordinates_different_cities"].includes(code));
    const addressIssues = incomplete ? store.quality.issues.map((i) => i.code).filter((code) =>
      ["missing_street_address", "missing_city"].includes(code)) : [];
    const resolves = [...coordinateIssues, ...addressIssues];
    if (!resolves.length) { decision.status = "no_supported_coordinate_issue"; continue; }
    decision.status = incomplete ? "matched_official_id_and_nearby_location"
      : rule === "exact_address" ? "matched_exact_address" : "matched_official_id_and_compatible_street";
    corrections.push({ id: store.id, status: "accepted_automatic", expected: {
      source_sha256: baseline.sources.find((s) => s.chain === "biedronka").sha256,
      location: structuredClone(store.location), address: structuredClone(store.address) }, replacement: {
        ...(coordinateIssues.length ? { location: candidate.location } : {}),
        ...(addressIssues.length ? { address: addressFromOsm(store, candidate) } : {}),
      }, resolves,
      evidence: { provider: "openstreetmap", url: `https://www.openstreetmap.org/${candidate.element.type}/${candidate.element.id}`,
        element_type: candidate.element.type, element_id: candidate.element.id,
        position_kind: candidate.element.type === "node" ? "node" : "overpass_center",
        match_rule: rule, matched_on: incomplete ? ["brand", "official_store_id", "nearby_original_location", "locality"]
          : rule === "exact_address" ? ["brand", "street", "house_number", candidate.address.city ? "city" : "postal_code"]
            : ["brand", "official_store_id", "compatible_street_name", "house_number", "locality"],
        matched_tags: structuredClone(candidate.element.tags), ...structuredClone(evidence) } });
  }
  // Jeden obiekt OSM nie może automatycznie poprawiać kilku placówek.
  const usage = new Map();
  for (const patch of corrections) { const k = patch.evidence.url; usage.set(k, (usage.get(k) ?? 0) + 1); }
  const accepted = corrections.filter((patch) => {
    if (usage.get(patch.evidence.url) === 1) return true;
    decisions.find((d) => d.id === patch.id).status = "osm_element_matches_multiple_stores"; return false;
  });
  return { corrections: accepted, decisions };
}

export function run(baseDirectory) {
  const { manifest, datasets } = loadSources(baseDirectory);
  const baseline = prepareData(manifest, datasets);
  const config = JSON.parse(fs.readFileSync(local(baseDirectory, "weryfikacja-biedronki/konfiguracja.json"), "utf8"));
  const metadataPath = local(baseDirectory, config.osm_metadata_file);
  const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  assert.equal(metadata.status, 200, "Odpowiedź Overpass nie jest poprawna.");
  const snapshotPath = local(baseDirectory, path.join(path.dirname(config.osm_metadata_file), metadata.file));
  const raw = fs.readFileSync(snapshotPath);
  assert.equal(hash(raw), metadata.sha256, "Suma kontrolna odpowiedzi OSM nie zgadza się.");
  const snapshot = JSON.parse(raw.toString("utf8"));
  assert.ok(!snapshot.remark && Array.isArray(snapshot.elements), "Niepełna lub nieprawidłowa odpowiedź OSM.");
  const evidenceFiles = [snapshotPath, metadataPath].map((file) => ({ file: path.relative(baseDirectory, file).replaceAll("\\", "/"), sha256: hash(fs.readFileSync(file)) }));
  for (const source of snapshot.provenance?.sources ?? []) {
    for (const entry of [{ file: source.file, sha256: source.sha256 }, { file: source.metadata_file, sha256: source.metadata_sha256 }]) {
      assert.equal(hash(fs.readFileSync(local(baseDirectory, entry.file))), entry.sha256, `Niezgodny dowód składowy: ${entry.file}`);
      evidenceFiles.push(entry);
    }
  }
  const evidence = { dataset_file: evidenceFiles[0].file, dataset_sha256: metadata.sha256,
    osm_timestamp: snapshot.osm3s?.timestamp_osm_base ?? null, retrieved_at: metadata.retrieved_at,
    attribution: "© OpenStreetMap contributors", license: "ODbL-1.0", license_url: "https://www.openstreetmap.org/copyright" };
  const matched = findMatches(baseline, snapshot.elements, evidence);
  const corrections = { schema_version: 1, generated_at: new Date().toISOString(),
    baseline_input_fingerprint: baseline.input_fingerprint, scope: config.scope, evidence_files: evidenceFiles,
    corrections: matched.corrections };
  fs.mkdirSync(local(baseDirectory, "poprawki"), { recursive: true });
  fs.writeFileSync(local(baseDirectory, "poprawki/biedronka.json"), JSON.stringify(corrections, null, 2) + "\n");
  const counts = {};
  for (const d of matched.decisions) counts[d.status] = (counts[d.status] ?? 0) + 1;
  const report = { generated_at: corrections.generated_at, scope: config.scope,
    osm_elements: snapshot.elements.length, review_records_compared: matched.decisions.length,
    accepted_corrections: matched.corrections.length, decisions_by_status: counts, decisions: matched.decisions,
    limitation: "Brak dopasowania w zapisanych odpowiedziach nie oznacza braku sklepu w OSM. Dopasowanie adresu nie potwierdza aktualnego otwarcia sklepu." };
  fs.writeFileSync(local(baseDirectory, "weryfikacja-biedronki/raport-dopasowania.json"), JSON.stringify(report, null, 2) + "\n");
  const csv = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const header = ["id", "adres_pierwotny", "decyzja", "zrodlo_osm", "regula_lub_powod", "latitude_propozycji", "longitude_propozycji",
    "adres_osm_lub_poprawiony", "ranking_nie_prawdopodobienstwo", "odleglosc_od_pierwotnego_punktu_m", "zmienione_pola"];
  const rows = [header], acceptedRows = [header], reviewRows = [header];
  for (const decision of matched.decisions) {
    const patch = matched.corrections.find((entry) => entry.id === decision.id);
    const proposals = patch ? [{ osm_url: patch.evidence.url, reason: patch.evidence.match_rule,
      location: patch.replacement.location ?? patch.expected.location, address: patch.replacement.address,
      changed_fields: Object.keys(patch.replacement).join(", ") }] : decision.suggestions?.length ? decision.suggestions : [{}];
    for (const proposal of proposals) {
      const a = proposal.address;
      const row = [decision.id, decision.address, decision.status, proposal.osm_url,
        proposal.reason, proposal.location?.latitude, proposal.location?.longitude,
        a?.formatted ?? (a ? [a.street, a.house_number, a.postal_code, a.city].filter(Boolean).join(" ") : ""),
        proposal.score, proposal.distance_from_original_m, proposal.changed_fields];
      rows.push(row); (patch ? acceptedRows : reviewRows).push(row);
    }
  }
  for (const [file, entries] of [["do-sprawdzenia.csv", rows], ["przyjete-poprawki.csv", acceptedRows], ["pozostale-do-sprawdzenia.csv", reviewRows]]) {
    fs.writeFileSync(local(baseDirectory, `weryfikacja-biedronki/${file}`), "\uFEFF" + entries.map((row) => row.map(csv).join(";")).join("\r\n") + "\r\n");
  }
  return { scope: config.scope, osm_elements: snapshot.elements.length, accepted: matched.corrections.length, counts };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { console.log(JSON.stringify(run(path.dirname(fileURLToPath(import.meta.url))), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
