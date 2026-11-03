import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const directory = path.join(root, 'weryfikacja-biedronki/proba-20');
fs.mkdirSync(directory, {recursive: true});
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const hash = raw => createHash('sha256').update(raw).digest('hex');
const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const all = read('poprawki/biedronka.json').corrections.filter(p => p.replacement.location && !p.expected.location);
const rad = Math.PI / 180;
const distance = (a,b) => {
  const h = Math.sin((b.latitude-a.latitude)*rad/2)**2 + Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin((b.longitude-a.longitude)*rad/2)**2;
  return 12742000 * Math.asin(Math.min(1, Math.sqrt(h)));
};
const selected = all.filter(p => p.evidence.match_rule === 'official_store_id_and_compatible_street');
const reasons = Object.fromEntries(selected.map(p => [p.id, 'Wszystkie przypadki wariantu nazwy ulicy potwierdzonego ID sklepu.']));
function addMostDistant(predicate, reason) {
  const available = all.filter(p => !selected.some(s => s.id === p.id) && predicate(p));
  available.sort((a,b) => Math.min(...selected.map(s => distance(b.replacement.location,s.replacement.location)))
    - Math.min(...selected.map(s => distance(a.replacement.location,s.replacement.location))) || a.id.localeCompare(b.id));
  assert.ok(available.length, 'Brak kandydatów dla warstwy próby.');
  selected.push(available[0]); reasons[available[0].id] = reason;
}
const prefixed = p => /^(?:al\.|aleja |os\.|pl\.|plac )/iu.test(p.expected.address.street);
const village = p => p.expected.address.street.toLocaleLowerCase('pl-PL') === p.expected.address.city.toLocaleLowerCase('pl-PL');
while (selected.filter(prefixed).length < 3) addMostDistant(prefixed, 'Adres z prefiksem alei, placu lub osiedla; największy dystans od wybranych.');
while (selected.filter(p => p.evidence.position_kind === 'node').length < 5) addMostDistant(p => p.evidence.position_kind === 'node', 'Punkt OSM zamiast środka obszaru; największy dystans od wybranych.');
while (selected.filter(village).length < 3) addMostDistant(village, 'Numeracja miejscowości bez odrębnej ulicy; największy dystans od wybranych.');
while (selected.length < 20) addMostDistant(() => true, 'Uzupełnienie pokrycia geograficznego: największy dystans od już wybranych.');
assert.equal(selected.length, 20); assert.equal(new Set(selected.map(p => p.expected.address.city)).size, 20);
const selection = { generated_at: new Date().toISOString(), population: all.length,
  method: 'Próba celowa warstwowa: wszystkie 5 trudniejszych dopasowań nazw ulic, minimum 3 prefiksy, 5 węzłów OSM i 3 adresy bez ulicy; następnie maksymalizacja minimalnej odległości od wybranych punktów. Remisy według ID. Dobór nie zależy od wyników sprawdzenia.',
  limitation: 'Próba nie jest losowa i nie służy do szacowania odsetka błędów w populacji 181 sklepów.',
  count: selected.length, selected: selected.map(p => ({id:p.id,address:p.expected.address,location:p.replacement.location,
    rule:p.evidence.match_rule,kind:p.evidence.position_kind,reason:reasons[p.id],osm:p.evidence.url})) };
const selectionFile = path.join(directory, 'wybor.json');
if (fs.existsSync(selectionFile)) {
  const previous = JSON.parse(fs.readFileSync(selectionFile,'utf8'));
  assert.deepEqual({...previous,generated_at:null},{...selection,generated_at:null}, 'Zmieniła się wcześniej wybrana próba.');
} else save(selectionFile,selection);
console.log('SELECTED',JSON.stringify(selected.map(p => ({id:p.id,address:p.expected.address.formatted,rule:p.evidence.match_rule}))));
const requests = [];
for (const p of selected) {
  const id = p.id.split(':')[1], tags = p.evidence.matched_tags, a = p.expected.address;
  const city = tags['addr:city'] ?? tags['addr:place'] ?? a.city;
  const street = tags['addr:street'] ?? tags['addr:place'] ?? a.street;
  const number = tags['addr:housenumber'] ?? a.house_number;
  const address = city === street ? `${city} ${number}` : `${city}, ${street} ${number}`;
  requests.push({ key:`${id}-oficjalna`, url:`https://www.biedronka.pl/pl/shop,id,${id}`, extension:'html' },
    {key:`${id}-osm`, url:`https://api.openstreetmap.org/api/0.6/${p.evidence.element_type}/${p.evidence.element_id}${p.evidence.element_type === 'way' ? '/full' : ''}.json`,extension:'json'},
    {key:`${id}-gugik`,url:`https://services.gugik.gov.pl/uug/?${new URLSearchParams({request:'GetAddress',address,exact_number:'1'})}`,extension:'json'},
    {key:`${id}-gugik-reverse`,url:`https://services.gugik.gov.pl/uug/?${new URLSearchParams({request:'GetAddressReverse',location:`POINT(${p.replacement.location.longitude} ${p.replacement.location.latitude})`,srid:'4326'})}`,extension:'json'});
}
const results = [];
requests.push(...[
  ['gabin-targeo','https://mapa.targeo.pl/biedronka-supermarket-al-jana-pawla-ii-4-gabin~10102425/biedronka-supermarket/adres'],
  ['bialystok-targeo','https://mapa.targeo.pl/biedronka-supermarket-swietojanska-15-bialystok~22738043/biedronka-supermarket/adres'],
  ['bialystok-alfa-kontakt','https://www.alfacentrum.com.pl/kontakt'],
  ['bialystok-alfa-sklep','https://www.alfacentrum.com.pl/najemcy/sklepy/Biedronka-pl'],
  ['stary-dzikow-zyn','https://www.zyn.com/pl/pl/storedetails?path=stary-dzik%C3%B3w.html'],
].map(([key,url]) => ({key,url,extension:'html'})));
for (const p of selected) {
  const id = p.id.split(':')[1], tags = p.evidence.matched_tags, a = p.expected.address;
  const city = tags['addr:city'] ?? tags['addr:place'] ?? a.city;
  const street = tags['addr:street'] ?? tags['addr:place'] ?? a.street;
  const number = tags['addr:housenumber'] ?? a.house_number;
  const address = city === street ? `${city} ${number}` : `${city}, ${street} ${number}`;
  requests.push({key:`${id}-gugik-wgs84`,url:`https://services.gugik.gov.pl/uug/?${new URLSearchParams({request:'GetAddress',address,exact_number:'1',srid:'4326'})}`,extension:'json'});
}
requests.push({key:'bialystok-otoczenie-osm',url:'https://api.openstreetmap.org/api/0.6/map?bbox=23.166,53.1235,23.172,53.128',extension:'xml'});
let failures = 0;
for (const [index,request] of requests.entries()) {
  const metaFile = path.join(directory, `${request.key}.meta.json`);
  if (fs.existsSync(metaFile)) {
    const existing = JSON.parse(fs.readFileSync(metaFile,'utf8'));
    if (existing.status === 200 && existing.url === request.url && fs.existsSync(path.join(root,existing.file))
      && hash(fs.readFileSync(path.join(root,existing.file))) === existing.sha256) {
      results.push(existing); console.log(`CACHED ${request.key}`); continue;
    }
  }
  await new Promise(resolve => setTimeout(resolve,650));
  const metadata = {key:request.key,url:request.url,retrieved_at:new Date().toISOString()};
  try {
    const response = await fetch(request.url,{headers:{'User-Agent':'SmartcartStoreDataReview/1.0',Accept:'*/*'},signal:AbortSignal.timeout(20000)});
    const raw = Buffer.from(await response.arrayBuffer());
    const file = path.join(directory,`${request.key}.${request.extension}`);
    fs.writeFileSync(file,raw);
    Object.assign(metadata,{status:response.status,final_url:response.url,content_type:response.headers.get('content-type'),
      file:path.relative(root,file).replaceAll('\\','/'),sha256:hash(raw),bytes:raw.length});
    failures = response.ok ? 0 : failures+1;
  } catch (error) {metadata.error=error.message;failures++;}
  save(metaFile,metadata);results.push(metadata);
  save(path.join(directory,'postep.json'),{requested:requests.length,processed:index+1,updated_at:new Date().toISOString()});
  console.log(`${index+1}/${requests.length} ${request.key}: ${metadata.status ?? metadata.error}`);
  if (failures >= 5) break;
}
save(path.join(directory,'manifest.json'),{generated_at:new Date().toISOString(),requested:requests.length,processed:results.length,responses:results});
