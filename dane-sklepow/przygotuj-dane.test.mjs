import assert from "node:assert/strict";
import test from "node:test";
import { prepareData } from "./przygotuj-dane.mjs";

function feature(ref, { city = "Warszawa", street = "Testowa", number = "1", country = "PL",
  brand = "Biedronka", coordinates = [21.01, 52.23], geometry, fullAddress } = {}) {
  return { type: "Feature", id: `feature-${ref}`,
    properties: { ref, name: brand, brand, "addr:country": country,
      "addr:city": city, "addr:street": street, "addr:housenumber": number,
      ...(fullAddress ? { "addr:full": fullAddress } : {}) },
    geometry: geometry === undefined ? { type: "Point", coordinates } : geometry };
}

function prepare(changes = {}) {
  const chains = ["lidl", "biedronka", "dino", "auchan"];
  const manifest = { filters: { country: "PL", auchan_allowed_brands: ["Auchan Super", "Auchan Hiper"] },
    sources: chains.map((chain) => ({ chain, file: `surowe/${chain}.geojson`, url: `https://example.test/${chain}`, sha256: chain })) };
  const datasets = Object.fromEntries(chains.map((chain) => [chain, { type: "FeatureCollection", features: changes[chain] ?? [] }]));
  return prepareData(manifest, datasets);
}

test("Filtr Polski i formatów Auchan pozostawia wyłącznie Super i Hiper", () => {
  const result = prepare({
    lidl: [feature("pl", { brand: "Lidl" }), feature("de", { brand: "Lidl", country: "DE" })],
    auchan: ["Auchan Super", "Auchan Hiper", "Auchan Easy", "Auchan Moje", "Auchan"]
      .map((brand, i) => feature(String(i), { brand, number: String(i), coordinates: [20 + i / 10, 52] })),
  });
  assert.deepEqual(result.ready.map((s) => s.id), ["auchan:0", "auchan:1", "lidl:pl"]);
  assert.equal(result.report.selected_records, 3);
  assert.equal(result.report.sources.find((s) => s.chain === "auchan").excluded_store_format, 3);
});

test("Kolejność longitude/latitude jest poprawnie przenoszona do nazwanych pól", () => {
  assert.deepEqual(prepare({ biedronka: [feature("1")] }).ready[0].location, { latitude: 52.23, longitude: 21.01 });
});

test("Brak geometrii i zamienione osie trafiają do weryfikacji bez zgadywania położenia", () => {
  const result = prepare({ biedronka: [feature("1", { geometry: null }), feature("2", { coordinates: [52.23, 21.01], number: "2" })] });
  assert.equal(result.ready.length, 0);
  assert.equal(result.review.length, 2);
  assert.equal(result.review[0].location, null);
  assert.ok(result.review[1].quality.issues.some((i) => i.code === "outside_poland_bounds"));
});

test("Punkt współdzielony przez różne miasta zatrzymuje oba sklepy, zamiast je scalać", () => {
  const result = prepare({ biedronka: [feature("1"), feature("2", { city: "Gdynia" })] });
  assert.equal(result.ready.length, 0);
  assert.equal(result.review.length, 2);
  assert.ok(result.review.every((s) => s.quality.issues.some((i) => i.code === "shared_coordinates_different_cities")));
  assert.deepEqual(result.review[0].quality.issues[0].related_ids, ["biedronka:2"]);
});

test("Ten sam adres z różnymi identyfikatorami i punktami zachowuje wszystkie rekordy do kontroli", () => {
  const result = prepare({ biedronka: [feature("1"), feature("2", { coordinates: [21.02, 52.24] })] });
  assert.equal(result.ready.length, 0);
  assert.equal(result.review.length, 2);
  assert.ok(result.review.every((s) => s.quality.issues.some((i) => i.code === "possible_duplicate_address")));
});

test("Współrzędne różnych sieci mogą być takie same", () => {
  const result = prepare({ lidl: [feature("1", { brand: "Lidl" })], biedronka: [feature("1")] });
  assert.equal(result.ready.length, 2);
  assert.equal(result.review.length, 0);
});

test("Pełny adres Dino i identyfikator Feature zachowują polskie znaki oraz źródło tożsamości", () => {
  const point = feature("1", { brand: "Dino", fullAddress: "ul. Żwirki 5, 90-001 Łódź", city: null, street: null, number: null });
  delete point.properties.ref;
  const store = prepare({ dino: [point] }).ready[0];
  assert.equal(store.id, "dino:feature-1");
  assert.equal(store.source.id_kind, "feature_id");
  assert.equal(store.address.street_address, "ul. Żwirki 5");
  assert.equal(store.address.city, "Łódź");
  assert.equal(store.address.postal_code, "90-001");
});

test("Powtórzony identyfikator nie nadpisuje rekordu, a brak ulicy jest oznaczony", () => {
  const result = prepare({ biedronka: [feature("1"), feature("1", { number: "2", street: null, coordinates: [21.1, 52.2] })] });
  assert.equal(result.report.selected_records, 2);
  assert.equal(result.review.length, 2);
  assert.equal(new Set(result.review.map((s) => s.id)).size, 2);
  assert.ok(result.review.every((s) => s.quality.issues.some((i) => i.code === "duplicate_source_id")));
  assert.ok(result.review[1].quality.issues.some((i) => i.code === "missing_street_address"));
});

test("Te same dane dają te same identyfikatory i wyniki bez mutowania źródeł", () => {
  const input = { biedronka: [feature("2", { number: "2", coordinates: [21.02, 52.24] }), feature("1")] };
  const before = structuredClone(input);
  assert.deepEqual(prepare(input), prepare(input));
  assert.deepEqual(input, before);
});
