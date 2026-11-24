import fs from "node:fs";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { prepareCatalogue } from "./przygotuj-dane.mjs";
import { findMatches } from "./dopasuj-biedronke.mjs";

const root = new URL("./", import.meta.url);
const audit = new URL("weryfikacja-biedronki/przeglad-586/", root);
const read = (url) => JSON.parse(fs.readFileSync(url, "utf8"));
const catalogue = prepareCatalogue(fileURLToPath(root), { auditCount: 0 });
const official = read(new URL("oficjalne.json", audit));
const osm = read(new URL("osm.json", audit));
assert.equal(catalogue.review.length, 586, "Oczekiwano katalogu wejściowego przed zastosowaniem tego przeglądu.");
assert.ok(!osm.remark && osm.elements.length && osm.osm3s.timestamp_osm_base);
const byUrl = new Map(official.map(row => [row.url, row]));
const result = findMatches(catalogue, osm.elements, {});
const possible = new Map(result.corrections.map(row => [row.id, row]));
const osmById = new Map(result.decisions.map(row => [row.id, row]));
const normalize = value => String(value ?? "").normalize("NFC").toLocaleLowerCase("pl-PL").replace(/^ul\.?\s+/u, "").replace(/\s+/gu, "");
const position = item => item?.latitude && item.longitude && { latitude: Number(item.latitude), longitude: Number(item.longitude) };
const pointKey = location => location ? [location.latitude.toFixed(5), location.longitude.toFixed(5)].join(",") : null;
const claimed = new Set(catalogue.ready.map(store => pointKey(store.location)));
const reportedPoints = new Map();
for (const row of official) for (const item of row.items ?? []) {
  const key = pointKey(position(item));
  if (key) reportedPoints.set(key, (reportedPoints.get(key) ?? 0) + 1);
}
const decisions = catalogue.review.map(store => {
  const source = byUrl.get(store.source.original_url);
  assert.ok(source, `Brak próby pobrania dla ${store.id}`);
  const matches = (source.items ?? []).filter(item => String(item.id) === store.source.store_id);
  const item = matches.length === 1 ? matches[0] : null;
  const address = store.address;
  const addressAgrees = !!(item?.street && item?.street_number && [["city","city"],["street","street"],["house_number","street_number"],["postal_code","zip_code"]]
    .every(([catalogKey, officialKey]) => normalize(address[catalogKey]) === normalize(item[officialKey])));
  const candidate = possible.get(store.id);
  const direct = position(item);
  const singleMissing = store.quality.issues.length === 1 && store.quality.issues[0].code === "missing_geometry";
  const recordedClosed = /^\d{4}-\d\d-\d\d/u.test(item?.date_closed ?? "") && !String(item.date_closed).startsWith("0000");
  let accepted;
  if (addressAgrees && singleMissing && !recordedClosed) {
    if (direct && direct.latitude >= 48.9 && direct.latitude <= 55 && direct.longitude >= 14 && direct.longitude <= 24.3
      && reportedPoints.get(pointKey(direct)) === 1 && !claimed.has(pointKey(direct))) {
      accepted = { location: direct, evidence: source.url };
    } else if (!direct && candidate?.replacement.location && !claimed.has(pointKey(candidate.replacement.location))) {
      accepted = { location: candidate.replacement.location, evidence: candidate.evidence.url };
    }
  }
  if (accepted) claimed.add(pointKey(accepted.location));
  const sourceStatus = source.status !== 200 ? "request_failed" : matches.length > 1 ? "duplicate_id"
    : !item ? "id_absent" : recordedClosed ? "date_closed_present" : !addressAgrees ? "address_incomplete_or_differs"
    : direct ? "has_coordinates" : "missing_coordinates";
  return { id: store.id, address: store.address.formatted, issues: store.quality.issues.map(issue => issue.code),
    official: { url: source.url, status: sourceStatus, item }, osm: osmById.get(store.id),
    ...(accepted ? { accepted } : {}) };
});
fs.writeFileSync(new URL("raport.json", audit), JSON.stringify({ input_fingerprint: catalogue.input_fingerprint,
  osm_observed_at: osm.osm3s.timestamp_osm_base, official_responses: official.length,
  reviewed: decisions.length, accepted: decisions.filter(row => row.accepted).length, decisions }, null, 2) + "\n");
console.log(decisions.filter(row => row.accepted).map(row => [row.id, row.accepted.evidence]));
console.log(Object.fromEntries(
  Object.entries(Object.groupBy(decisions, row => row.official.status)).map(([key, values]) => [key, values.length])));
