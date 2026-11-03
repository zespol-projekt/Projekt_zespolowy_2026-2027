import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { verifyReviewedPatch } from "./sprawdzone-poprawki.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const ALLOWED = new Set(["missing_geometry", "invalid_geometry", "outside_poland_bounds", "shared_coordinates_different_cities"]);
const local = (root, file) => {
  const target = path.resolve(root, file);
  assert.ok(target.startsWith(path.resolve(root) + path.sep), "Dowód musi pozostać w katalogu danych.");
  return target;
};

export function loadCorrections(root) {
  const file = local(root, "poprawki/biedronka.json");
  if (!fs.existsSync(file)) return null;
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  const extraFile = local(root, "poprawki/biedronka-zweryfikowane.json");
  if (fs.existsSync(extraFile)) {
    const raw = fs.readFileSync(extraFile), extra = JSON.parse(raw.toString("utf8"));
    assert.equal(extra.schema_version, doc.schema_version);
    assert.equal(extra.baseline_input_fingerprint, doc.baseline_input_fingerprint, "Przyjęte propozycje dotyczą innej migawki.");
    assert.ok(extra.corrections.every(p => p.status === "accepted_after_source_review"));
    const ids = new Set(doc.corrections.map(p => p.id));
    for (const p of extra.corrections) { assert.ok(!ids.has(p.id), "Poprawka ręczna nadpisuje istniejącą zmianę."); ids.add(p.id); }
    doc.corrections.push(...extra.corrections);
    doc.evidence_files.push(...extra.evidence_files);
    doc.supplemental_documents = [{ file: "poprawki/biedronka-zweryfikowane.json", sha256: hash(raw) }];
  }
  const verifiedFiles = new Map();
  for (const entry of doc.evidence_files) {
    const raw = fs.readFileSync(local(root, entry.file));
    assert.equal(hash(raw), entry.sha256, `Niezgodna suma dowodu: ${entry.file}`);
    verifiedFiles.set(entry.file, { raw, sha256: entry.sha256 });
  }
  for (const patch of doc.corrections) {
    const source = verifiedFiles.get(patch.evidence.dataset_file);
    assert.ok(source, `Brak dowodu dla poprawki: ${patch.id}`);
    assert.equal(source.sha256, patch.evidence.dataset_sha256);
    const data = JSON.parse(source.raw.toString("utf8"));
    assert.ok(!data.remark && Array.isArray(data.elements), "Niepełny zbiór OSM.");
    const element = data.elements.find((entry) => entry.id === patch.evidence.element_id && entry.type === patch.evidence.element_type);
    assert.ok(element, `Brak obiektu OSM: ${patch.id}`);
    assert.deepEqual(element.tags, patch.evidence.matched_tags, `Zmienione tagi dowodu: ${patch.id}`);
    const reviewed = patch.status === "accepted_after_source_review";
    if (reviewed) verifyReviewedPatch(patch, verifiedFiles, element);
    if (patch.replacement.location) assert.deepEqual(patch.replacement.location, {
      latitude: element.lat ?? element.center?.lat, longitude: element.lon ?? element.center?.lon,
    }, `Współrzędne nie pochodzą ze wskazanego obiektu OSM: ${patch.id}`);
    if (patch.replacement.address && !reviewed) {
      const address = patch.replacement.address;
      assert.equal(address.street, element.tags["addr:street"] ?? element.tags["addr:place"], "Adres uliczny nie pochodzi z OSM.");
      assert.equal(address.house_number, element.tags["addr:housenumber"], "Numer domu nie pochodzi z OSM.");
      assert.equal(address.street_address, `${address.street} ${address.house_number}`);
      const locality = element.tags["addr:city"] ?? element.tags["addr:place"];
      if (locality) assert.equal(locality.toLocaleLowerCase("pl-PL"), patch.expected.address.city.toLocaleLowerCase("pl-PL"), "Sprzeczna miejscowość źródła adresu.");
      else assert.ok(element.tags["addr:postcode"] && element.tags["addr:postcode"] === patch.expected.address.postal_code,
        "Brak potwierdzenia miejscowości lub kodu pocztowego.");
      assert.equal(address.postal_code, element.tags["addr:postcode"] ?? patch.expected.address.postal_code);
      assert.equal(patch.evidence.match_rule, "official_store_id_and_nearby_location");
      const website = String(element.tags.website ?? element.tags["contact:website"] ?? "");
      const websiteId = website.match(/https?:\/\/(?:www\.)?biedronka\.pl\/pl\/shop,id,(\d+)/iu)?.[1];
      assert.equal(websiteId, patch.id.split(":")[1], "Brak identyfikatora konkretnego sklepu w źródle adresu.");
      const old = patch.expected.location;
      const point = { latitude: element.lat ?? element.center?.lat, longitude: element.lon ?? element.center?.lon };
      assert.ok(old && Number.isFinite(old.latitude) && Number.isFinite(old.longitude), "Adres wymaga znanego pierwotnego punktu.");
      const rad = Math.PI / 180, dx = (old.latitude - point.latitude) * rad, dy = (old.longitude - point.longitude) * rad;
      const h = Math.sin(dx / 2) ** 2 + Math.cos(old.latitude * rad) * Math.cos(point.latitude * rad) * Math.sin(dy / 2) ** 2;
      assert.ok(12742000 * Math.asin(Math.min(1, Math.sqrt(h))) <= 75, "Źródło adresu jest zbyt daleko od pierwotnego punktu.");
      assert.equal(address.formatted, [`${address.street} ${address.house_number}`,
        [address.postal_code, address.city].filter(Boolean).join(" ")].join(", "));
    }
  }
  return doc;
}

export function applyCorrections(baseline, document) {
  if (!document) return baseline;
  assert.equal(document.schema_version, 1);
  assert.equal(document.baseline_input_fingerprint, baseline.input_fingerprint,
    "Poprawki dotyczą innej migawki źródeł; wymagane ponowne dopasowanie.");
  const result = structuredClone(baseline);
  const stores = [...result.ready, ...result.review].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const byId = new Map(stores.map((store) => [store.id, store]));
  const appliedIds = new Set();
  const correctedIds = new Set();
  const addressCorrectedIds = new Set();
  let coordinateCorrections = 0, addressCorrections = 0;
  for (const patch of document.corrections) {
    assert.ok(["accepted_automatic", "accepted_after_source_review"].includes(patch.status));
    assert.ok(!appliedIds.has(patch.id), `Powtórzona poprawka: ${patch.id}`);
    appliedIds.add(patch.id);
    const store = byId.get(patch.id);
    assert.ok(store && store.chain === "biedronka" && store.quality.status === "needs_review", `Niedozwolony cel poprawki: ${patch.id}`);
    assert.equal(patch.expected.source_sha256, baseline.sources.find((source) => source.chain === store.chain).sha256);
    assert.deepEqual(store.location, patch.expected.location, `Zmieniła się pierwotna lokalizacja: ${patch.id}`);
    assert.deepEqual(store.address, patch.expected.address, `Zmienił się adres: ${patch.id}`);
    const fields = Object.keys(patch.replacement).sort();
    assert.ok(fields.length && fields.every((field) => ["location", "address"].includes(field)), "Niedozwolone pola poprawki.");
    assert.equal(patch.evidence.provider, "openstreetmap");
    const location = patch.replacement.location;
    if (fields.includes("location")) assert.ok(Number.isFinite(location?.latitude) && Number.isFinite(location?.longitude)
      && location.latitude >= 48.9 && location.latitude <= 55 && location.longitude >= 14 && location.longitude <= 24.3,
      `Nieprawidłowy punkt poprawki: ${patch.id}`);
    const allowed = new Set([...(fields.includes("location") ? ALLOWED : []),
      ...(fields.includes("address") ? ["missing_street_address", "missing_city"] : [])]);
    assert.ok(patch.resolves.length > 0 && patch.resolves.every((code) => allowed.has(code)
      && store.quality.issues.some((issue) => issue.code === code)), `Niedozwolone usunięcie problemu: ${patch.id}`);
    if (fields.includes("location")) { store.location = structuredClone(location); coordinateCorrections++; }
    if (fields.includes("address")) {
      const address = patch.replacement.address;
      assert.ok(address.street && address.house_number && address.city && address.country === "PL");
      assert.equal(address.city.toLocaleLowerCase("pl-PL"), store.address.city.toLocaleLowerCase("pl-PL"), "Zmiana miejscowości wymaga osobnej weryfikacji.");
      store.address = structuredClone(address);
      addressCorrectedIds.add(store.id); addressCorrections++;
    }
    store.corrections = [{ fields, status: patch.status, original_location: patch.expected.location,
      ...(fields.includes("address") ? { original_address: patch.expected.address } : {}),
      resolves: patch.resolves, evidence: structuredClone(patch.evidence) }];
    // Zachowujemy alarmy innych rekordów: zniknięcie pary błędnych punktów
    // po poprawieniu jednej placówki nie dowodzi poprawności drugiej.
    store.quality.issues = store.quality.issues.filter((issue) => !patch.resolves.includes(issue.code));
    if (fields.includes("location")) correctedIds.add(store.id);
  }
  const points = new Map();
  for (const store of stores.filter((s) => s.chain === "biedronka" && s.location)) {
    const point = `${store.location.longitude.toFixed(5)}|${store.location.latitude.toFixed(5)}`;
    const group = points.get(point) ?? []; group.push(store); points.set(point, group);
  }
  for (const group of points.values()) {
    if (group.length < 2 || !group.some((s) => correctedIds.has(s.id))) continue;
    for (const store of group) store.quality.issues.push({ code: "correction_coordinate_conflict",
      message: "Poprawiony punkt współdzielony z inną placówką; wymagana weryfikacja.",
      related_ids: group.filter((s) => s !== store).map((s) => s.id).sort() });
  }
  const addresses = new Map();
  for (const store of stores.filter((s) => s.chain === "biedronka" && s.address.city && s.address.street_address)) {
    const k = `${store.address.city}|${store.address.street_address}`.toLocaleLowerCase("pl-PL").replace(/\bul\.?\s+/gu, "");
    const group = addresses.get(k) ?? []; group.push(store); addresses.set(k, group);
  }
  for (const group of addresses.values()) {
    if (group.length < 2 || !group.some((s) => addressCorrectedIds.has(s.id))) continue;
    for (const store of group) store.quality.issues.push({ code: "correction_address_conflict",
      message: "Uzupełniony adres współdzielony z inną placówką; wymagana weryfikacja.",
      related_ids: group.filter((s) => s !== store).map((s) => s.id).sort() });
  }
  result.ready = []; result.review = [];
  result.report.issue_counts = {};
  for (const summary of result.report.sources) { summary.ready_records = 0; summary.review_records = 0; }
  for (const store of stores) {
    const needsReview = store.quality.issues.length > 0;
    store.quality.status = needsReview ? "needs_review" : "ready";
    (needsReview ? result.review : result.ready).push(store);
    result.report.sources.find((s) => s.chain === store.chain)[needsReview ? "review_records" : "ready_records"]++;
    for (const issue of store.quality.issues) result.report.issue_counts[issue.code] = (result.report.issue_counts[issue.code] ?? 0) + 1;
  }
  result.report.ready_records = result.ready.length;
  result.report.review_records = result.review.length;
  assert.equal(result.ready.length + result.review.length, baseline.report.selected_records);
  result.correction_metadata = { file: "poprawki/biedronka.json", sha256: hash(JSON.stringify(document)),
    applied: appliedIds.size, coordinates: coordinateCorrections, addresses: addressCorrections,
    automatic: document.corrections.filter(p => p.status === "accepted_automatic").length,
    after_source_review: document.corrections.filter(p => p.status === "accepted_after_source_review").length,
    ...(document.supplemental_documents ? { supplemental_documents: document.supplemental_documents } : {}),
    scope: document.scope, attribution: "© OpenStreetMap contributors",
    license: "ODbL-1.0", license_url: "https://www.openstreetmap.org/copyright" };
  result.report.corrections = result.correction_metadata;
  result.baseline_input_fingerprint = baseline.input_fingerprint;
  result.input_fingerprint = hash(JSON.stringify({ baseline: baseline.input_fingerprint, corrections: result.correction_metadata.sha256 }));
  return result;
}
