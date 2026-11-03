import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mergeReviewDecisions } from './przeglad.mjs';
const root = path.dirname(fileURLToPath(import.meta.url));
const dir = 'weryfikacja-biedronki/proba-20/';
const read = file => JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const raw = file => fs.readFileSync(path.join(root,file));
const save = (file,value) => fs.writeFileSync(path.join(root,file),JSON.stringify(value,null,2)+'\n');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const selection = read(dir+'wybor.json'), manifest = read(dir+'manifest.json');
assert.equal(selection.count,20); assert.equal(selection.population,181);
assert.equal(manifest.processed,manifest.requested);
const meta = new Map(manifest.responses.map(m => [m.key,m]));
const evidence = [{file:dir+'wybor.json',sha256:hash(raw(dir+'wybor.json'))},
  {file:dir+'manifest.json',sha256:hash(raw(dir+'manifest.json'))}];
for (const m of manifest.responses) {
  assert.equal(m.status,200,`Nieudane pobranie: ${m.key}`);
  assert.equal(hash(raw(m.file)),m.sha256,`Zmieniony dowód: ${m.file}`);
  evidence.push({file:m.file,sha256:m.sha256});
}
const patches = read('poprawki/biedronka.json');
const byId = new Map(patches.corrections.map(p => [p.id,p]));
const stores = new Map([...read('gotowe/sklepy.json').stores,...read('do-weryfikacji/sklepy.json').stores].map(s => [s.id,s]));
const norm = s => String(s??'').normalize('NFC').toLocaleLowerCase('pl-PL').replace(/\s+/gu,' ').trim();
const tokens = s => norm(s).replace(/^(?:ul\.?|ulica|al\.?|aleja|os\.?|osiedle|plac|pl\.?)\s+/u,'')
  .split(/[^\p{L}\p{N}]+/u).filter(t => t && !['gen','generała','generala','ii','iii','iv'].includes(t));
const compatibleStreet = (a,b) => {
  const x=tokens(a),y=tokens(b);
  if (!x.length || !y.length || x.at(-1)!==y.at(-1)) return false;
  const small=x.length<=y.length?x:y,large=x.length<=y.length?y:x;
  return small.every(w => large.includes(w) || w.length===1 && large.some(v => v.startsWith(w)));
};
const rad = Math.PI/180;
const distance = (a,b) => {
  const h = Math.sin((a.latitude-b.latitude)*rad/2)**2+Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin((a.longitude-b.longitude)*rad/2)**2;
  return 12742000*Math.asin(Math.min(1,Math.sqrt(h)));
};
const plain = html => html.replace(/<!--[\s\S]*?-->/g,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
const targeoPoint = key => {
  const text=raw(meta.get(key).file).toString('utf8');
  const m=text.match(/var _LOCATION = (\{[^}]+\})/); assert.ok(m,'Brak punktu Targeo.');
  const value=JSON.parse(m[1]);return {latitude:Number(value.y),longitude:Number(value.x)};
};
function mallPolygon() {
  const xml=raw(meta.get('bialystok-otoczenie-osm').file).toString('utf8');
  const attributes=text => Object.fromEntries([...text.matchAll(/([\w:]+)="([^"]*)"/g)].map(m => [m[1],m[2]]));
  const nodes=new Map([...xml.matchAll(/<node\b([^>]+)>/g)].map(m => {
    const a=attributes(m[1]);return [a.id,{latitude:Number(a.lat),longitude:Number(a.lon)}];
  }));
  const way=xml.match(/<way\b[^>]*\bid="213115430"[^>]*>([\s\S]*?)<\/way>/);
  assert.ok(way,'Brak geometrii Alfa Centrum.');
  const tags=Object.fromEntries([...way[1].matchAll(/<tag\b([^>]+)>/g)].map(m => {const a=attributes(m[1]);return [a.k,a.v];}));
  assert.equal(tags.name,'Alfa Centrum');assert.equal(tags['addr:street'],'Świętojańska');assert.equal(tags['addr:housenumber'],'15');
  const ring=[...way[1].matchAll(/<nd\b[^>]*ref="(\d+)"/g)].map(m => nodes.get(m[1]));
  assert.ok(ring.length>3&&ring.every(Boolean));assert.deepEqual(ring[0],ring.at(-1));
  return ring;
}
const contains=(ring,p) => {
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[i],b=ring[j];
    if ((a.latitude>p.latitude)!==(b.latitude>p.latitude)
      && p.longitude<(b.longitude-a.longitude)*(p.latitude-a.latitude)/(b.latitude-a.latitude)+a.longitude) inside=!inside;
  }
  return inside;
};
const records=[];
for (const chosen of selection.selected) {
  const p=byId.get(chosen.id),store=stores.get(chosen.id),id=chosen.id.split(':')[1];
  assert.ok(p&&store&&p.replacement.location&&!p.expected.location);
  assert.deepEqual(store.address,p.expected.address);assert.deepEqual(store.location,p.replacement.location);
  const data=read(meta.get(`${id}-osm`).file);
  const element=data.elements.find(e => e.type===p.evidence.element_type&&e.id===p.evidence.element_id);
  assert.ok(element);assert.deepEqual(element.tags,p.evidence.matched_tags,`Zmienione tagi OSM: ${id}`);
  const nodes=data.elements.filter(e => e.type==='node');
  const freshPoint=element.type==='node'?{latitude:element.lat,longitude:element.lon}:{
    latitude:(Math.min(...nodes.map(n=>n.lat))+Math.max(...nodes.map(n=>n.lat)))/2,
    longitude:(Math.min(...nodes.map(n=>n.lon))+Math.max(...nodes.map(n=>n.lon)))/2};
  assert.ok(distance(freshPoint,p.replacement.location)<=1,`Zmiana geometrii OSM: ${id}`);
  const official=raw(meta.get(`${id}-oficjalna`).file).toString('utf8');
  const marker=official.indexOf('Pokaż na mapie');assert.ok(marker>0,'Brak karty konkretnego sklepu.');
  const officialBlock=norm(plain(official.slice(Math.max(0,marker-3000),marker)));
  const a=p.expected.address;
  for (const field of [a.city,a.street_address,a.postal_code]) assert.ok(officialBlock.includes(norm(field)),`Inny adres oficjalny: ${id}, ${field}`);
  const registry=read(meta.get(`${id}-gugik-wgs84`).file);
  const registryMatches=Object.values(registry.results??{}).filter(r => norm(r.city)===norm(a.city)
    && norm(r.number)===norm(a.house_number)
    && (r.street?compatibleStreet(r.street,p.evidence.matched_tags['addr:street']??a.street):norm(a.street)===norm(a.city)));
  assert.equal(registryMatches.length,1,`Niejednoznaczny adres GUGiK: ${id}`);
  const address=registryMatches[0],point={latitude:Number(address.y),longitude:Number(address.x)};
  assert.ok(point.latitude>48.9&&point.latitude<55&&point.longitude>14&&point.longitude<24.3,'Odpowiedź nie jest w GPS.');
  const meters=distance(store.location,point);
  const reverse=read(meta.get(`${id}-gugik-reverse`).file);
  const nearest=Object.values(reverse.results??{})[0]??null;
  const keys=[`${id}-oficjalna`,`${id}-osm`,`${id}-gugik-wgs84`,`${id}-gugik-reverse`];
  const notes=[];
  let scope='address_and_building';
  if(id!=='6963') {
    assert.equal(address.code,a.postal_code,`Sprzeczny kod: ${id}`);
    assert.ok(meters<=75,`Dokładny punkt adresu zbyt daleko: ${id}, ${meters}`);
  } else {
    const ring=mallPolygon(),otherPoint=targeoPoint('bialystok-targeo');
    assert.ok(contains(ring,store.location),'Punkt sklepu poza Alfa Centrum.');
    assert.ok(contains(ring,otherPoint),'Punkt Targeo poza Alfa Centrum.');
    for (const key of ['bialystok-alfa-kontakt','bialystok-alfa-sklep']) assert.ok(plain(raw(meta.get(key).file).toString('utf8')).includes('Biedronka'));
    assert.ok(plain(raw(meta.get('bialystok-alfa-kontakt').file).toString('utf8')).includes('15-277'));
    scope='building_only';
    notes.push(`OSM i Targeo różnią się o ${Math.round(distance(store.location,otherPoint))} m. Oba punkty leżą wewnątrz geometrii Alfa Centrum przy Świętojańskiej 15. Właściciel centrum potwierdza najemcę Biedronka. Potwierdzono właściwą galerię; dokładny lokal i wejście nie zostały potwierdzone.`);
    notes.push(`UUG podaje kod ${address.code}, natomiast Biedronka i zarządca Alfa Centrum podają ${a.postal_code}. Zachowano kod z tych dwóch źródeł. SIMC w OSM różni się od UUG i nie został użyty jako dowód tożsamości.`);
    keys.push('bialystok-targeo','bialystok-alfa-kontakt','bialystok-alfa-sklep','bialystok-otoczenie-osm');
  }
  if(nearest&&norm(nearest.number)!==norm(a.house_number)) notes.push(`Najbliższy punkt UUG ma numer ${nearest.number}, ale oddzielne zapytanie o dokładny numer ${a.house_number} potwierdza jego istnienie. Nie podmieniono numeru na najbliższy.`);
  if(id==='1150') {
    const other=targeoPoint('gabin-targeo');assert.ok(distance(store.location,other)<30);
    notes.push(`Targeo potwierdza sklep pod tym adresem ${Math.round(distance(store.location,other))} m od punktu OSM. Punkt rejestrowy numeru 4 leży ${Math.round(meters)} m od środka budynku.`);keys.push('gabin-targeo');
  }
  if(id==='3513') {
    const zyn=plain(raw(meta.get('stary-dzikow-zyn').file).toString('utf8'));
    assert.ok(zyn.includes('Biedronka - Stary Dzików')&&zyn.includes('Kosciuszki 72A'));
    notes.push('Katalog punktów sprzedaży ZYN również podaje Biedronkę przy Kościuszki 72A. Rejestrowy punkt 72A jest blisko budynku, mimo że najbliższym adresem jest 72.');keys.push('stary-dzikow-zyn');
  }
  const reason=`Oficjalna karta potwierdza sklep i adres. Świeży odczyt OSM zachowuje tagi i położenie. GUGiK potwierdza zgodną miejscowość, ulicę lub numerację miejscowości i numer domu; punkt dokładnego adresu jest ${Math.round(meters)} m od punktu sklepu.`
    +(notes.length?' '+notes.join(' '):'');
  records.push({id:p.id,address:a,location:store.location,status:'corroborated',scope,reason,
    match_rule:p.evidence.match_rule,position_kind:p.evidence.position_kind,selection_reason:chosen.reason,
    official_address_confirmed:true,osm_tags_unchanged:true,osm_geometry_change_m:Number(distance(freshPoint,store.location).toFixed(2)),
    registry_exact_address:address,registry_distance_m:Number(meters.toFixed(2)),registry_nearest_address:nearest,
    notes,references:keys.map(key=>meta.get(key))});
}
const now=new Date().toISOString();
const report={schema_version:1,reviewed_at:now,population:selection.population,sample_size:records.length,
  selection_method:selection.method,corroborated:records.length,requires_review:0,
  ordinary_address_checks:records.filter(r=>r.scope==='address_and_building').length,
  large_building_checks:records.filter(r=>r.scope==='building_only').length,
  conclusion:'W celowej próbie nie wykazano przypisania sklepu do innej miejscowości ani innego budynku. 19 punktów jest blisko dokładnego adresu UUG, a punkt Białegostoku leży w potwierdzonej galerii. Nie potwierdzono wejść ani dokładnego położenia lokalu w galerii.',
  limitations:[selection.limitation,'To nie jest kontrola terenowa ani potwierdzenie otwarcia sklepu.',
    'Rejestr adresowy potwierdza adres, nie markę najemcy. Tożsamość sklepu sprawdzono na oficjalnej karcie i w OSM.',
    'Odległość do punktu adresowego nie jest pomiarem błędu GPS; punkt sklepu, środek budynku, lokal i punkt adresu mogą się różnić.',
    'Parametr accuracy w odpowiedzi UUG opisuje dopasowanie tekstowe, nie prawdopodobieństwo poprawności.'],records};
const reportFile=dir+'raport.json';save(reportFile,report);evidence.push({file:reportFile,sha256:hash(raw(reportFile))});
const decisionsFile='weryfikacja-biedronki/decyzje-przegladu.json';
const previous=read(decisionsFile);
const combined=mergeReviewDecisions(previous,{schema_version:1,reviewed_at:now,baseline_input_fingerprint:patches.baseline_input_fingerprint,
  evidence_files:evidence,decisions:records.map(r=>({id:r.id,status:r.status,reason:r.reason,scope:r.scope,report_file:reportFile,
    expected:{address:r.address,location:r.location}}))});
for(const old of previous.decisions) if(!records.some(r=>r.id===old.id)) assert.ok(combined.decisions.some(d=>d.id===old.id&&d.status===old.status));
save(decisionsFile,combined);
const csv=v=>'"'+String(v??'').replaceAll('"','""')+'"';
const rows=[['id','adres','wynik','zakres_potwierdzenia','regula','typ_punktu','latitude','longitude','odleglosc_do_dokladnego_adresu_m','uwagi','osm','oficjalna_karta','gugik'],
  ...records.map(r=>[r.id,r.address.formatted,r.status,r.scope,r.match_rule,r.position_kind,r.location.latitude,r.location.longitude,
    r.registry_distance_m,r.notes.join(' '),r.references[1].url,r.references[0].url,r.references[2].url])];
fs.writeFileSync(path.join(root,dir+'wynik.csv'),'\uFEFF'+rows.map(row=>row.map(csv).join(';')).join('\r\n')+'\r\n');
const lines=['# Przegląd próbki 20 uzupełnionych lokalizacji','',`Data UTC: ${now}`,'',
  '**Wynik: 20 sprawdzonych, bez nowego wstrzymania rekordu. 19 punktów potwierdzono względem dokładnego adresu UUG, a Białystok na poziomie właściwej galerii.**','',
  report.conclusion,'','## Dobór próby','',selection.method,'',selection.limitation,'',
  'Lista 20 ID jest zachowana w `wybor.json`; nie wymieniano przypadków po poznaniu wyników. Próba zawiera wszystkie 5 dopasowań wariantu ulicy, 3 prefiksy, 5 węzłów OSM i 3 adresy bez odrębnej ulicy. Kategorie mogą się nakładać.','',
  '## Zestawienie','',
  '| Sklep | Odległość do dokładnego punktu UUG | Zakres |','| --- | ---: | --- |',
  ...records.map(r=>`| ${r.address.formatted} | ${Math.round(r.registry_distance_m)} m | ${r.scope==='building_only'?'Galeria; uwagi poniżej':'Adres i budynek'} |`),'',
  '## Przypadki wymagające wyjaśnienia','',...records.filter(r=>r.notes.length).flatMap(r=>[
    `### ${r.address.formatted}`,'',...r.notes.map(n=>n+'\n'),
    ...r.references.map(m=>`- [${m.key}](${m.url}) — lokalny plik: \`${path.basename(m.file)}\`.`),'']),
  '## Dowody i odtworzenie','',
  `Archiwum zawiera ${manifest.responses.length} odpowiedzi HTTP 200 z URL, datami i SHA-256. Szczegóły każdej decyzji, odnośniki do źródeł i dokładne odległości są w \`raport.json\`, zestawienie do Excela w \`wynik.csv\`.`, '',
  '```powershell','node .\\dane-sklepow\\pobierz-probe20.mjs','node .\\dane-sklepow\\opisz-probe20.mjs',
  'node .\\dane-sklepow\\przygotuj-dane.mjs','node .\\dane-sklepow\\podsumuj-weryfikacje.mjs','```','',
  'Pobieranie korzysta z archiwum. Pozostałe komendy działają offline. Nowe decyzje dołączono do wcześniejszych siedmiu, zachowując wstrzymania Trzebini i Grąbkowa. Geometrii ani adresów sklepów nie zmieniono.','',
  '## Ograniczenia','',...report.limitations.map(l=>'- '+l),'',
  'Dane OSM: © OpenStreetMap contributors, ODbL-1.0.'];
fs.writeFileSync(path.join(root,dir+'README.md'),lines.join('\n')+'\n');
console.log(JSON.stringify({sample:records.length,corroborated:report.corroborated,new_holds:0,ordinary:report.ordinary_address_checks,
  building_only:report.large_building_checks,total_reviewed:combined.decisions.length,previous_holds_preserved:combined.decisions.filter(d=>d.status==='requires_review').map(d=>d.id)},null,2));
