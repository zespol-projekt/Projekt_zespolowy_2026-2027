import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const directory = path.join(root, "weryfikacja-biedronki/pelny-przebieg/osm-regiony");
fs.mkdirSync(directory, { recursive: true });
const digest = (value) => createHash("sha256").update(value).digest("hex");
const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const latitudes = [48.9, 51, 53, 55], longitudes = [14, 17.5, 21, 24.3];
const tiles = [];
for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) tiles.push([latitudes[i], longitudes[j], latitudes[i + 1], longitudes[j + 1]]);
const splitting = process.argv.includes("--split-failed");
const names = [];
if (splitting) {
  const previous = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
  tiles.length = 0;
  for (const [parent, response] of previous.responses.entries()) {
    if (response.status === 200) continue;
    const [south, west, north, east] = response.bbox, middleLat = (south + north) / 2, middleLon = (west + east) / 2;
    for (const [part, bbox] of [[south, west, middleLat, middleLon], [south, middleLon, middleLat, east],
      [middleLat, west, north, middleLon], [middleLat, middleLon, north, east]].entries()) {
      tiles.push(bbox); names.push(`uzupelnienie-${parent + 1}-${part + 1}`);
    }
  }
}
const endpoints = splitting ? ["https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://ovp.dresel.systems/api/interpreter"]
  : ["https://ovp.dresel.systems/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];
const responses = [];
for (const [index, bbox] of tiles.entries()) {
  const stem = names[index] ?? `region-${index + 1}`;
  const dataFile = path.join(directory, `${stem}.json`), metaFile = path.join(directory, `${stem}.meta.json`);
  let success;
  if (fs.existsSync(metaFile) && fs.existsSync(dataFile)) {
    const metadata = JSON.parse(fs.readFileSync(metaFile, "utf8")), raw = fs.readFileSync(dataFile);
    if (metadata.status === 200 && metadata.sha256 === digest(raw)) {
      const data = JSON.parse(raw.toString("utf8"));
      if (!data.remark && Array.isArray(data.elements)) success = metadata;
    }
  }
  if (!success) {
    const query = `[out:json][timeout:20];(nwr["brand:wikidata"="Q857182"](${bbox});nwr["brand"="Biedronka"](${bbox});nwr["shop"]["name"="Biedronka"](${bbox}););out center tags;`;
    fs.writeFileSync(path.join(directory, `${stem}.overpassql`), query);
    for (const [attempt, endpoint] of endpoints.entries()) {
      await pause(1200);
      const url = endpoint + "?" + new URLSearchParams({ data: query });
      try {
        const response = await fetch(url, { headers: { "User-Agent": "SmartcartStoreDataReview/1.0" }, signal: AbortSignal.timeout(28000) });
        const raw = await response.text();
        let data; try { data = JSON.parse(raw); } catch {}
        const metadata = { bbox, url, status: response.status, retrieved_at: new Date().toISOString(),
          file: path.relative(root, dataFile).replaceAll("\\", "/"), sha256: digest(raw),
          elements: data?.elements?.length ?? 0, remark: data?.remark ?? null };
        if (response.status === 200 && !data?.remark && Array.isArray(data?.elements)) {
          fs.writeFileSync(dataFile, raw); save(metaFile, metadata); success = metadata; break;
        }
        fs.writeFileSync(path.join(directory, `${stem}.failed-${attempt + 1}.txt`), raw);
        save(path.join(directory, `${stem}.failed-${attempt + 1}.meta.json`), metadata);
        if (response.status === 429 || response.status === 406) await pause(30000);
      } catch (error) { save(path.join(directory, `${stem}.failed-${attempt + 1}.meta.json`), { bbox, url, error: error.message, retrieved_at: new Date().toISOString() }); }
    }
  }
  responses.push(success ?? { bbox, usable: false });
  save(path.join(directory, splitting ? "postep-uzupelnienie.json" : "postep.json"), { processed: index + 1, total: tiles.length,
    successful: responses.filter((entry) => entry.status === 200).length, updated_at: new Date().toISOString() });
  console.log(`OSM_PROGRESS ${index + 1}/${tiles.length}, success=${responses.filter((entry) => entry.status === 200).length}, records=${success?.elements ?? 0}`);
}
save(path.join(directory, splitting ? "manifest-uzupelnienie.json" : "manifest.json"), { generated_at: new Date().toISOString(), requested_regions: tiles.length, responses });
console.log(JSON.stringify({ regions: tiles.length, successful: responses.filter((entry) => entry.status === 200).length }));
