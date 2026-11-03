import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { prepareData } from "./przygotuj-dane.mjs";
import { findMatches } from "./dopasuj-biedronke.mjs";
import { applyCorrections, loadCorrections } from "./poprawki.mjs";

function baseline(features) {
  const chains = ["lidl", "biedronka", "dino", "auchan"];
  const manifest = { filters: { country: "PL", auchan_allowed_brands: ["Auchan Super", "Auchan Hiper"] },
    sources: chains.map((chain) => ({ chain, sha256: chain, file: `surowe/${chain}.geojson`, url: `https://example.test/${chain}` })) };
  return prepareData(manifest, Object.fromEntries(chains.map((chain) => [chain, {
    type: "FeatureCollection", features: chain === "biedronka" ? features : [],
  }])));
}

function feature(id = "1", overrides = {}, coordinates = null) {
  return { type: "Feature", id, properties: { ref: id, name: "Biedronka", brand: "Biedronka", "addr:country": "PL",
    "addr:city": "Gdynia", "addr:street": "Rdestowa", "addr:housenumber": "160A", "addr:postcode": "81-577", ...overrides },
    geometry: coordinates ? { type: "Point", coordinates } : null };
}

function osm(id = 10, tags = {}) {
  return { type: "node", id, lat: 54.4615, lon: 18.4504,
    tags: { shop: "supermarket", brand: "Biedronka", "addr:city": "Gdynia", "addr:street": "ul. Rdestowa",
      "addr:housenumber": "160a", "addr:postcode": "81-577", ...tags } };
}

function documentFor(base, elements) {
  const matched = findMatches(base, elements, { dataset_file: "osm.json", dataset_sha256: "fixture" });
  return { schema_version: 1, baseline_input_fingerprint: base.input_fingerprint, scope: "test",
    evidence_files: [], corrections: matched.corrections };
}

test("Pełny zgodny adres dopuszcza prefiks ul. i wielkość litery numeru domu", () => {
  const base = baseline([feature()]);
  const result = applyCorrections(base, documentFor(base, [osm()]));
  assert.equal(result.ready.length, 1);
  assert.deepEqual(result.ready[0].location, { latitude: 54.4615, longitude: 18.4504 });
  assert.equal(result.ready[0].corrections[0].evidence.provider, "openstreetmap");
  assert.equal(base.review[0].location, null, "Oryginalny zbiór nie może zostać zmieniony.");
});

test("Dwa obiekty OSM z tym samym adresem nie są arbitralnie rozstrzygane", () => {
  const base = baseline([feature()]);
  const matched = findMatches(base, [osm(10), osm(11)], {});
  assert.equal(matched.corrections.length, 0);
  assert.equal(matched.decisions[0].status, "ambiguous_osm_candidates");
});

test("Sprzeczny identyfikator strony oficjalnej blokuje dopasowanie", () => {
  const matched = findMatches(baseline([feature()]), [osm(10, { website: "https://www.biedronka.pl/pl/shop,id,999" })], {});
  assert.equal(matched.corrections.length, 0);
  assert.equal(matched.decisions[0].status, "conflicting_official_store_id");
});

test("Budowa, zamknięty obiekt i obca sieć nie stają się gotowymi sklepami", () => {
  for (const tags of [{ building: "construction" }, { disused: "yes" }, { brand: "Lidl", name: "Lidl" }]) {
    assert.equal(findMatches(baseline([feature()]), [osm(10, tags)], {}).corrections.length, 0);
  }
});

test("Sprzeczna miejscowość lub kod pocztowy blokują dopasowanie mimo tej samej ulicy", () => {
  for (const tags of [{ "addr:city": "Lublin" }, { "addr:postcode": "80-001" }]) {
    assert.equal(findMatches(baseline([feature()]), [osm(10, tags)], {}).corrections.length, 0);
  }
});

test("Dwie placówki katalogowe o tym samym adresie pozostają do ręcznej kontroli", () => {
  const matched = findMatches(baseline([feature("1"), feature("2")]), [osm()], {});
  assert.equal(matched.corrections.length, 0);
  assert.ok(matched.decisions.every((entry) => entry.status === "catalog_duplicate_requires_review"));
});

test("Poprawienie Gdyni nie usuwa ostrzeżenia błędnego punktu w Lublinie", () => {
  const point = [19.1011907, 51.919438];
  const base = baseline([feature("1", {}, point), feature("2", {
    "addr:city": "Lublin", "addr:street": "Okopowa", "addr:housenumber": "3", "addr:postcode": "20-400",
  }, point)]);
  const result = applyCorrections(base, documentFor(base, [osm()]));
  assert.equal(result.ready.length, 1);
  assert.equal(result.review.length, 1);
  assert.equal(result.review[0].id, "biedronka:2");
  assert.ok(result.review[0].quality.issues.some((issue) => issue.code === "shared_coordinates_different_cities"));
});

test("Poprawka po zmianie adresu lub migawki źródłowej jest odrzucana", () => {
  const base = baseline([feature()]);
  const changedAddress = documentFor(base, [osm()]);
  changedAddress.corrections[0].expected.address.city = "Inne miasto";
  assert.throws(() => applyCorrections(base, changedAddress), /adres/);
  const changedSnapshot = documentFor(base, [osm()]);
  changedSnapshot.baseline_input_fingerprint = "inna migawka";
  assert.throws(() => applyCorrections(base, changedSnapshot), /migawki/);
});

test("Warstwa poprawek nie może usuwać problemów adresowych poprawką współrzędnych", () => {
  const base = baseline([feature()]);
  const doc = documentFor(base, [osm()]);
  doc.corrections[0].resolves.push("missing_street_address");
  assert.throws(() => applyCorrections(base, doc), /usunięcie problemu/);
});

test("Zapisana poprawka musi zawierać dokładnie współrzędne z pliku dowodowego", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "smartcart-correction-test-"));
  const patchDirectory = path.join(root, "poprawki"); fs.mkdirSync(patchDirectory);
  const evidence = Buffer.from(JSON.stringify({ elements: [osm()] }));
  const digest = createHash("sha256").update(evidence).digest("hex");
  const base = baseline([feature()]); const doc = documentFor(base, [osm()]);
  doc.evidence_files = [{ file: "osm.json", sha256: digest }];
  doc.corrections[0].evidence.dataset_sha256 = digest;
  fs.writeFileSync(path.join(root, "osm.json"), evidence);
  const save = () => fs.writeFileSync(path.join(patchDirectory, "biedronka.json"), JSON.stringify(doc));
  try {
    save(); assert.equal(loadCorrections(root).corrections.length, 1);
    doc.corrections[0].replacement.location.latitude = 52;
    save(); assert.throws(() => loadCorrections(root), /Współrzędne/);
    fs.appendFileSync(path.join(root, "osm.json"), " ");
    assert.throws(() => loadCorrections(root), /suma dowodu/);
  } finally {
    fs.unlinkSync(path.join(patchDirectory, "biedronka.json"));
    fs.unlinkSync(path.join(root, "osm.json"));
    fs.rmdirSync(patchDirectory); fs.rmdirSync(root);
  }
});

test("Skrót alei można rozwinąć, zachowując zgodny pełny adres", () => {
  const base = baseline([feature("1", { "addr:street": "al. Testowa" })]);
  const doc = documentFor(base, [osm(10, { "addr:street": "Aleja Testowa" })]);
  assert.equal(doc.corrections.length, 1);
  assert.equal(doc.corrections[0].evidence.match_rule, "exact_address");
});

test("Inicjał patrona wymaga zgodnego konkretnego identyfikatora sklepu", () => {
  const base = baseline([feature("1", { "addr:street": "M. Faradaya" })]);
  const tags = { "addr:street": "Michała Faradaya", website: "https://www.biedronka.pl/pl/shop,id,1" };
  const doc = documentFor(base, [osm(10, tags)]);
  assert.equal(doc.corrections.length, 1);
  assert.equal(doc.corrections[0].evidence.match_rule, "official_store_id_and_compatible_street");
  assert.equal(documentFor(base, [osm(10, { "addr:street": "Michała Faradaya" })]).corrections.length, 0);
  assert.equal(documentFor(base, [osm(10, { ...tags, "addr:street": "Jana Faradaya" })]).corrections.length, 0);
});

test("Brak adresu można uzupełnić tylko przy zgodnym ID oraz punkcie do 75 metrów", () => {
  const base = baseline([feature("1", { "addr:street": null, "addr:housenumber": null }, [18.4504, 54.4615])]);
  const tags = { website: "https://www.biedronka.pl/pl/shop,id,1" };
  const doc = documentFor(base, [osm(10, tags)]);
  assert.equal(doc.corrections.length, 1);
  assert.deepEqual(Object.keys(doc.corrections[0].replacement), ["address"]);
  const result = applyCorrections(base, doc);
  assert.equal(result.ready.length, 1);
  assert.equal(result.ready[0].address.street, "ul. Rdestowa");
  assert.deepEqual(result.ready[0].location, base.review[0].location);
  const farAway = osm(10, tags); farAway.lat = 54.47;
  assert.equal(documentFor(base, [farAway]).corrections.length, 0);
  assert.equal(documentFor(base, [osm(10, { website: "https://www.biedronka.pl/pl/shop,id,10" })]).corrections.length, 0);
});

test("Numer drogi w polu numeru domu nie blokuje adresu potwierdzonego ID i położeniem", () => {
  const base = baseline([feature("1", { "addr:street": null, "addr:housenumber": "DW855" }, [18.4504, 54.4615])]);
  const doc = documentFor(base, [osm(10, { website: "https://www.biedronka.pl/pl/shop,id,1" })]);
  assert.equal(doc.corrections.length, 1);
  assert.equal(doc.corrections[0].replacement.address.house_number, "160a");
});

test("Niepełny adres z błędnym kodem wymaga zgodnego ID, miasta oraz istniejącego punktu", () => {
  const base = baseline([feature("1", { "addr:street": null, "addr:housenumber": null, "addr:postcode": "00-000" }, [18.4504, 54.4615])]);
  const doc = documentFor(base, [osm(10, { website: "https://www.biedronka.pl/pl/shop,id,1" })]);
  assert.equal(doc.corrections.length, 1);
  assert.equal(doc.corrections[0].replacement.address.postal_code, "81-577");
  assert.equal(documentFor(base, [osm(10, { website: "https://www.biedronka.pl/pl/shop,id,1", "addr:city": "Inne miasto" })]).corrections.length, 0);
});
test("Osobna partia przyjętych propozycji nie może nadpisywać poprawki automatycznej ani dotyczyć innej migawki", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "smartcart-reviewed-merge-"));
  const directory = path.join(root, "poprawki"); fs.mkdirSync(directory);
  const base = baseline([feature()]), doc = documentFor(base, [osm()]);
  const autoFile = path.join(directory, "biedronka.json"), manualFile = path.join(directory, "biedronka-zweryfikowane.json");
  try {
    fs.writeFileSync(autoFile, JSON.stringify(doc));
    const extra = { ...doc, corrections: doc.corrections.map(p => ({ ...p, status: "accepted_after_source_review" })) };
    fs.writeFileSync(manualFile, JSON.stringify(extra));
    assert.throws(() => loadCorrections(root), /nadpisuje/);
    fs.writeFileSync(manualFile, JSON.stringify({ ...extra, baseline_input_fingerprint: "other" }));
    assert.throws(() => loadCorrections(root), /innej migawki/);
  } finally {
    fs.unlinkSync(autoFile); fs.unlinkSync(manualFile); fs.rmdirSync(directory); fs.rmdirSync(root);
  }
});
