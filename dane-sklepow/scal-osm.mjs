import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const directory = path.join(root, "weryfikacja-biedronki/pelny-przebieg");
const regions = path.join(directory, "osm-regiony");
const digest = (raw) => createHash("sha256").update(raw).digest("hex");
const relative = (file) => path.relative(root, file).replaceAll("\\", "/");
const inputs = [path.join(root, "weryfikacja-biedronki/2026-11-02T17-45-17-761Z/osm-proba-get-meta.json"),
  ...fs.readdirSync(regions).filter((name) => /^(?:region-\d+|uzupelnienie-\d+-\d+)\.meta\.json$/u.test(name)).map((name) => path.join(regions, name))];
const elements = new Map(), originByElement = {}, sources = [], times = [];
for (const metaPath of inputs) {
  const metaRaw = fs.readFileSync(metaPath), meta = JSON.parse(metaRaw.toString("utf8"));
  if (meta.status !== 200) continue;
  const input = meta.file.startsWith("weryfikacja-biedronki/") ? path.join(root, meta.file) : path.join(path.dirname(metaPath), meta.file);
  const raw = fs.readFileSync(input);
  assert.equal(digest(raw), meta.sha256, `Niezgodny plik OSM: ${input}`);
  const data = JSON.parse(raw.toString("utf8"));
  assert.ok(!data.remark && Array.isArray(data.elements), `Niepełna odpowiedź: ${input}`);
  const timestamp = data.osm3s?.timestamp_osm_base ?? meta.retrieved_at;
  times.push(timestamp);
  sources.push({ file: relative(input), sha256: meta.sha256, metadata_file: relative(metaPath),
    metadata_sha256: digest(metaRaw), url: meta.url, timestamp, bbox: meta.bbox ?? null });
  for (const element of data.elements) {
    const id = `${element.type}/${element.id}`;
    const current = elements.get(id);
    if (!current || timestamp > current.timestamp) {
      elements.set(id, { timestamp, element }); originByElement[id] = relative(input);
    }
  }
}
assert.ok(elements.size > 125, "Brak szerszego zbioru niż dotychczasowa próbka.");
const initial = JSON.parse(fs.readFileSync(path.join(regions, "manifest.json"), "utf8"));
const successfulMetadata = new Set(sources.map((source) => path.basename(source.metadata_file)));
const coverage = initial.responses.map((response, index) => ({ region: index + 1, bbox: response.bbox,
  complete: successfulMetadata.has(`region-${index + 1}.meta.json`)
    || [1, 2, 3, 4].every((part) => successfulMetadata.has(`uzupelnienie-${index + 1}-${part}.meta.json`)) }));
const complete = coverage.filter((entry) => entry.complete).length;
const scope = `Dane OSM z prostokąta obejmującego Polskę: pełne odpowiedzi dla ${complete}/9 obszarów bazowych, ${sources.length} zapisanych odpowiedzi. Nie jest to potwierdzenie kompletności placówek.`;
const data = { version: 0.6, generator: "SMARTCART: scalanie zapisanych odpowiedzi Overpass", osm3s: {
  timestamp_osm_base: [...times].sort().at(-1), copyright: "© OpenStreetMap contributors, ODbL-1.0" },
  provenance: { scope, coverage, sources, element_sources: originByElement },
  elements: [...elements.values()].map((entry) => entry.element).sort((a, b) => a.type.localeCompare(b.type) || a.id - b.id) };
const output = path.join(directory, "osm-polaczone.json"), raw = JSON.stringify(data, null, 2) + "\n";
fs.writeFileSync(output, raw);
const metaPath = path.join(directory, "osm-polaczone-meta.json");
fs.writeFileSync(metaPath, JSON.stringify({ status: 200, url: "urn:smartcart:merged-osm-cache",
  retrieved_at: new Date().toISOString(), file: "osm-polaczone.json", sha256: digest(raw),
  elements: elements.size, scope, coverage, source_files: sources }, null, 2) + "\n");
const configPath = path.join(root, "weryfikacja-biedronki/konfiguracja.json");
const backupPath = path.join(directory, "konfiguracja-przed-scaleniem.json");
if (!fs.existsSync(backupPath)) fs.copyFileSync(configPath, backupPath, fs.constants.COPYFILE_EXCL);
const oldPatch = path.join(root, "poprawki/biedronka.json"), backupPatch = path.join(directory, "poprawki-przed-scaleniem.json");
if (!fs.existsSync(backupPatch)) fs.copyFileSync(oldPatch, backupPatch, fs.constants.COPYFILE_EXCL);
fs.writeFileSync(configPath, JSON.stringify({ osm_metadata_file: relative(metaPath), scope }, null, 2) + "\n");
console.log(JSON.stringify({ elements: elements.size, sources: sources.length, complete_regions: complete,
  total_regions: 9, coverage }, null, 2));
