import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadSources, prepareData } from "./przygotuj-dane.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const directory = path.join(root, "weryfikacja-biedronki/pelny-przebieg/oficjalne");
fs.mkdirSync(directory, { recursive: true });
const digest = (raw) => createHash("sha256").update(raw).digest("hex");
const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const { manifest, datasets } = loadSources(root);
const baseline = prepareData(manifest, datasets);
const targets = baseline.review.filter((store) => store.chain === "biedronka");
const urls = [...new Set(targets.map((store) => store.source.original_url))].sort();
const observations = [];
let failures = 0, fetched = 0, cached = 0;
for (const [index, url] of urls.entries()) {
  const parsed = new URL(url);
  if (parsed.hostname !== "www.biedronka.pl" || parsed.pathname !== "/api/shop/cityshopsbyslug") throw new Error("Nieoczekiwane źródło API.");
  const stem = `${parsed.searchParams.get("slug").replace(/[^a-z0-9_-]/gi, "-")}-${digest(url).slice(0, 8)}`;
  const dataFile = path.join(directory, `${stem}.json`), metaFile = path.join(directory, `${stem}.meta.json`);
  let metadata;
  if (fs.existsSync(metaFile) && fs.existsSync(dataFile)) {
    const candidate = JSON.parse(fs.readFileSync(metaFile, "utf8"));
    const raw = fs.readFileSync(dataFile);
    if (candidate.status === 200 && candidate.sha256 === digest(raw)) {
      const data = JSON.parse(raw.toString("utf8"));
      if (Array.isArray(data.items) && !data.error) { metadata = candidate; cached++; }
    }
  }
  if (!metadata) {
    await pause(450);
    const retrievedAt = new Date().toISOString();
    try {
      const response = await fetch(url, { headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest",
        "User-Agent": "SmartcartStoreDataReview/1.0" }, signal: AbortSignal.timeout(18000) });
      const raw = await response.text();
      fs.writeFileSync(dataFile, raw);
      let data; try { data = JSON.parse(raw); } catch {}
      metadata = { url, status: response.status, retrieved_at: retrievedAt,
        file: path.relative(root, dataFile).replaceAll("\\", "/"), sha256: digest(raw),
        usable: response.status === 200 && Array.isArray(data?.items) && !data.error, items: data?.items?.length ?? null };
      save(metaFile, metadata); fetched++;
      if (!metadata.usable) { failures++; if (response.status === 429) await pause(30000); } else failures = 0;
    } catch (error) {
      metadata = { url, retrieved_at: retrievedAt, usable: false, error: error.message };
      save(metaFile, metadata); failures++;
    }
  }
  observations.push(metadata);
  if ((index + 1) % 25 === 0 || index === urls.length - 1 || failures >= 5) {
    save(path.join(directory, "postep.json"), { total: urls.length, processed: index + 1, fetched, cached,
      usable: observations.filter((entry) => entry.usable !== false).length, updated_at: new Date().toISOString() });
    console.log(`OFFICIAL_PROGRESS ${index + 1}/${urls.length}, fetched=${fetched}, cached=${cached}, failures=${failures}`);
  }
  if (failures >= 5) { console.log("Przerwano po pięciu kolejnych błędach; ponowne uruchomienie wznowi pracę z cache."); break; }
}
save(path.join(directory, "manifest.json"), { generated_at: new Date().toISOString(), requested_city_count: urls.length,
  processed_city_count: observations.length, target_store_count: targets.length, responses: observations });
console.log(JSON.stringify({ requested: urls.length, processed: observations.length, fetched, cached }));
