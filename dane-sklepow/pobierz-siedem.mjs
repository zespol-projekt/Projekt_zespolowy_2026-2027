import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = path.dirname(fileURLToPath(import.meta.url));
const directory = path.join(root, 'weryfikacja-biedronki/przeglad-siedmiu');
fs.mkdirSync(directory, { recursive: true });
const patches = JSON.parse(fs.readFileSync(path.join(root, 'poprawki/biedronka.json'), 'utf8')).corrections
  .filter(p => p.replacement.address || p.replacement.location && p.expected.location);
const requests = patches.flatMap(p => [
  { key: `${p.id.split(':')[1]}-oficjalna`, url: `https://www.biedronka.pl/pl/shop,id,${p.id.split(':')[1]}`, extension: 'html' },
  { key: `${p.id.split(':')[1]}-osm`, url: `https://api.openstreetmap.org/api/0.6/${p.evidence.element_type}/${p.evidence.element_id}${p.evidence.element_type === 'way' ? '/full' : ''}.json`, extension: 'json' },
]);
const extra = [
  ['trzebinia-cityon', 'https://cityon.pl/miejsce/biedronka-trzebinia-mloszowska-47', 'html'],
  ['zaklikow-targeo', 'https://mapa.targeo.pl/biedronka-supermarket-lubelska-39-37-470-zaklikow~23072531/biedronka-supermarket/adres', 'html'],
  ['maciejowice-targeo', 'https://mapa.targeo.pl/biedronka-supermarket-lubelska-73a-08-480-maciejowice~23072534/biedronka-supermarket/adres', 'html'],
  ['drawno-gmina', 'https://drawno.pl/pliki/drawno/pliki/rozklad%20jazdy%20gmina%20drawno.pdf', 'pdf'],
  ['krolewiec-mojagazetka', 'https://mojagazetka.com/lokalizacje-sklepow/krolewiec/biedronka', 'html'],
  ['grabkow-targeo', 'https://mapa.targeo.pl/biedronka-supermarket-grabkow-57-grabkow~23164633/biedronka-supermarket/adres', 'html'],
  ['gdynia-targeo', 'https://mapa.targeo.pl/biedronka-supermarket-rdestowa-160-gdynia~23164627/biedronka-supermarket/adres', 'html'],
  ['starsza-lista-biedronka', 'https://cdn.biedronka.pl/__2024/T09A/promocja_lista/T09A_lista_promo.pdf', 'pdf'],
  ['starsza-lista-krolewiec', 'https://staticmoja.biedronka.pl/bundles/loyalty/rules/regulamin-biblioteka-biedronki-01-01-2023.pdf', 'pdf'],
  ['drawno-targeo', 'https://mapa.targeo.pl/biedronka-supermarket-kolejowa-2a-73-220-drawno~23072541/biedronka-supermarket/adres', 'html'],
  ['krolewiec-targeo', 'https://mapa.targeo.pl/biedronka-supermarket-smykow-98-26-212-smykow~23072545/biedronka-supermarket/adres', 'html'],
  ['uug-opis', 'https://services.gugik.gov.pl/uug/opis.html', 'html'],
];
requests.push(...extra.map(([key, url, extension]) => ({key, url, extension})));
for (const patch of patches) {
  const a = patch.replacement.address ?? patch.expected.address;
  const address = a.street === a.city ? `${a.city} ${a.house_number}` : `${a.city}, ${a.street} ${a.house_number}`;
  requests.push({key: `${patch.id.split(':')[1]}-gugik`, url: `https://services.gugik.gov.pl/uug/?${new URLSearchParams({ request: 'GetAddress', address, exact_number: '1' })}`, extension: 'json'});
}
for (const [key,address] of [['krolewiec-100','Królewiec 100'],['grabkow-57a','Grąbków 57A']]) {
  requests.push({key: `${key}-gugik`, url: `https://services.gugik.gov.pl/uug/?${new URLSearchParams({ request: 'GetAddress', address, exact_number: '1' })}`, extension: 'json'});
}
const savedOsm = JSON.parse(fs.readFileSync(path.join(root, 'weryfikacja-biedronki/pelny-przebieg/osm-polaczone.json'), 'utf8'));
for (const patch of patches) {
  const e = savedOsm.elements.find(e => e.type === patch.evidence.element_type && e.id === patch.evidence.element_id);
  const lon = e.lon ?? e.center.lon, lat = e.lat ?? e.center.lat;
  requests.push({key: `${patch.id.split(':')[1]}-gugik-reverse`,
    url: `https://services.gugik.gov.pl/uug/?${new URLSearchParams({ request: 'GetAddressReverse', location: `POINT(${lon} ${lat})`, srid: '4326' })}`, extension: 'json'});
}
const results = [];
for (const request of requests) {
  const metadataFile = path.join(directory, `${request.key}.meta.json`);
  if (fs.existsSync(metadataFile)) {
    const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
    const existing = path.join(root, metadata.file ?? 'absent');
    if (metadata.status === 200 && fs.existsSync(existing)
      && createHash('sha256').update(fs.readFileSync(existing)).digest('hex') === metadata.sha256) {
      results.push(metadata); console.log(`CACHED ${request.key}`); continue;
    }
  }
  await new Promise(resolve => setTimeout(resolve, 600));
  const metadata = { key: request.key, url: request.url, retrieved_at: new Date().toISOString() };
  try {
    const response = await fetch(request.url, { headers: { 'User-Agent': 'SmartcartStoreDataReview/1.0', Accept: '*/*' }, signal: AbortSignal.timeout(20000) });
    const raw = Buffer.from(await response.arrayBuffer());
    const file = path.join(directory, `${request.key}.${request.extension}`);
    fs.writeFileSync(file, raw);
    Object.assign(metadata, {status: response.status, final_url: response.url, content_type: response.headers.get('content-type'),
      file: path.relative(root, file).replaceAll('\\', '/'), sha256: createHash('sha256').update(raw).digest('hex'), bytes: raw.length});
  } catch (error) { metadata.error = error.message; }
  fs.writeFileSync(metadataFile, JSON.stringify(metadata, null, 2) + '\n'); results.push(metadata);
  console.log(`${request.key}: ${metadata.status ?? metadata.error}`);
}
fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ generated_at: new Date().toISOString(), responses: results }, null, 2) + '\n');
