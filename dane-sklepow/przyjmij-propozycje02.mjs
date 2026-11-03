import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadSources,prepareData } from './przygotuj-dane.mjs';
import { mergeReviewDecisions } from './przeglad.mjs';
const root=path.dirname(fileURLToPath(import.meta.url)),dir='weryfikacja-biedronki/propozycje-02/';
const raw=file=>fs.readFileSync(path.join(root,file));
const read=file=>JSON.parse(raw(file).toString('utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const save=(file,value)=>fs.writeFileSync(path.join(root,file),JSON.stringify(value,null,2)+'\n');
const norm=s=>String(s??'').normalize('NFC').toLocaleLowerCase('pl-PL').replace(/\s+/gu,' ').trim();
const distance=(a,b)=>{
  const rad=Math.PI/180,h=Math.sin((a.latitude-b.latitude)*rad/2)**2+Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin((a.longitude-b.longitude)*rad/2)**2;
  return 12742000*Math.asin(Math.min(1,Math.sqrt(h)));
};
const plain=h=>h.replace(/<!--[\s\S]*?-->/g,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
const tokens=s=>norm(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  .filter(t=>!['ul','ulica','al','aleja','aleje','os','osiedle','gen','generała','prezydenta','ks','księdza','św','świętego','ii','iii'].includes(t));
const compatible=(a,b)=>{
  const x=tokens(a),y=tokens(b);if(!x.length||!y.length)return false;
  const short=x.length<y.length?x:y,long=x.length<y.length?y:x;
  return short.every(t=>long.includes(t)||t.length===1&&long.some(w=>w.startsWith(t)));
};
const selection=read(dir+'wybor.json'),manifest=read(dir+'manifest.json');
assert.equal(selection.selected.length,20);assert.equal(manifest.processed,manifest.requested);
const first=read('weryfikacja-biedronki/propozycje-01/raport.json');
assert.ok(selection.selected.every(s=>!first.records.some(r=>r.id===s.id)),'Powtórzono sklep z pierwszej partii.');
const meta=new Map(manifest.responses.map(m=>[m.key,m]));
const evidence=[{file:dir+'wybor.json',sha256:hash(raw(dir+'wybor.json'))},{file:dir+'manifest.json',sha256:hash(raw(dir+'manifest.json'))}];
const unusableJson=[];
for(const m of manifest.responses){
  assert.equal(m.status,200);assert.equal(hash(raw(m.file)),m.sha256);evidence.push({file:m.file,sha256:m.sha256});
  if(m.file.endsWith('.json'))try{read(m.file);}catch{unusableJson.push({file:m.file,url:m.url,reason:'HTTP 200 z treścią niebędącą JSON; odpowiedź nie służy jako dowód dopasowania.'});}
}
const {manifest:sources,datasets}=loadSources(root),baseline=prepareData(sources,datasets);
assert.equal(baseline.input_fingerprint,selection.baseline_input_fingerprint);
const stores=new Map([...baseline.ready,...baseline.review].map(s=>[s.id,s]));
const sourceHash=baseline.sources.find(s=>s.chain==='biedronka').sha256;
const automatic=read('poprawki/biedronka.json'),osmFile='weryfikacja-biedronki/pelny-przebieg/osm-polaczone.json';
const osmRaw=raw(osmFile),osm=JSON.parse(osmRaw.toString('utf8'));evidence.push({file:osmFile,sha256:hash(osmRaw)});
const targeo=id=>{
  const text=raw(meta.get(`${id}-targeo`).file).toString('utf8'),match=text.match(/var _LOCATION = (\{[^}]+\})/);assert.ok(match);
  const p=JSON.parse(match[1]);return{point:{latitude:+p.y,longitude:+p.x},text:norm(plain(text))};
};
const notesById={
  '2276':'Rozwinięto Gen. do Generała na potrzeby porównania.',
  '2782':'Różnica obejmuje prefiks alei i cudzysłów wokół Solidarności. Zapytanie rejestru z typograficznym cudzysłowem zwróciło błąd; poprawne dane uzyskano z zapytania o adres pierwotny.',
  '2869':'Potwierdzono wariant Armii Krajowej / Aleje Armii Krajowej / Al. Armii Krajowej.',
  '3601':'Potwierdzono prefiks aleja przy nazwie Ludwika Piechoczka.',
  '3647':'Potwierdzono rozwinięcie imienia Stanisława w nazwie ulicy księdza Gajeckiego.',
  '7333':'Potwierdzono skrót ks. / Księdza; brak kodu w OSM nie zastępuje niezależnej kontroli adresu.',
  '1872':'Potwierdzono wariant ze słowem Świętego w nazwie alei Jana Pawła II.',
  '1164':'Porównano pisownię Marcellego / Marcelego. Nazwa i numer z oficjalnej karty mają zgodny punkt w rejestrze; adres wejściowy zachowano.',
  '1192':'Potwierdzono rozwinięcie imienia Stefana przy ulicy Batorego.',
  '1226':'Potwierdzono rozwinięcie imienia Władysława przy ulicy Korotyńskiego. Dokładny adres 23 sprawdzono osobno od najbliższego numeru 21.',
  '1328':'Potwierdzono rozwinięcie imienia Karola przy ulicy Szymanowskiego i wariant 27a/27A.',
  '1344':'Potwierdzono rozwinięcie imienia Kazimierza przy ulicy Porębskiego; odrzucono zwrócone przez geokoder inne ulice.',
  '1371':'Potwierdzono rozwinięcie imienia Tytusa przy ulicy Chałubińskiego. Nie podmieniono numeru 27 na najbliższy 25C.',
  '1387':'Potwierdzono rozwinięcie imienia Władysława przy ulicy Jagiełły.',
  '1459':'Potwierdzono pełny wariant Generała Stefana Grota Roweckiego i numer 18A.',
  '1503':'Potwierdzono rozwinięcie imienia Marii przy ulicy Konopnickiej.',
  '1520':'Potwierdzono pełną nazwę Osiedle gen. Józefa Wybickiego; numer 3b pozostaje bez zmiany.',
};
const records=[],patches=[];
for(const chosen of selection.selected){
  const id=chosen.id.split(':')[1],store=stores.get(chosen.id),candidate=chosen.suggestions[0];
  assert.ok(store&&!store.location&&store.quality.issues.some(i=>i.code==='missing_geometry'));
  assert.deepEqual(store.address,chosen.store.address);assert.equal(chosen.store.location,null);
  assert.ok(!automatic.corrections.some(p=>p.id===store.id),'Nadpisanie poprawki automatycznej.');
  assert.equal(chosen.suggestions.length,1,'Wymagana osobna ocena kilku kandydatur.');
  const parts=candidate.osm_url.split('/'),element=osm.elements.find(e=>e.type===parts.at(-2)&&String(e.id)===parts.at(-1));assert.ok(element);
  const fresh=read(meta.get(`${id}-osm`).file),current=fresh.elements.find(e=>e.type===element.type&&e.id===element.id);assert.ok(current);
  assert.deepEqual(current.tags,element.tags,'Zmieniły się tagi OSM.');
  const nodes=fresh.elements.filter(e=>e.type==='node');
  const freshPoint=current.type==='node'?{latitude:current.lat,longitude:current.lon}:{
    latitude:(Math.min(...nodes.map(n=>n.lat))+Math.max(...nodes.map(n=>n.lat)))/2,
    longitude:(Math.min(...nodes.map(n=>n.lon))+Math.max(...nodes.map(n=>n.lon)))/2};
  assert.ok(distance(freshPoint,candidate.location)<1,'Zmieniła się geometria.');
  const html=raw(meta.get(`${id}-oficjalna`).file).toString('utf8'),marker=html.indexOf('Pokaż na mapie');assert.ok(marker>0);
  const official=norm(plain(html.slice(Math.max(0,marker-3000),marker)));
  for(const part of [store.address.city,store.address.street_address,store.address.postal_code])assert.ok(official.includes(norm(part)),`Inna karta sklepu: ${id}`);
  const website=String(element.tags.website??element.tags['contact:website']??''),websiteId=website.match(/https?:\/\/(?:www\.)?biedronka\.pl\/pl\/shop,id,(\d+)/iu)?.[1];
  if(websiteId)assert.equal(websiteId,id,'Sprzeczny identyfikator strony sklepu.');
  const refs=[`${id}-oficjalna`,`${id}-osm`,`${id}-gugik-reverse`],notes=[];
  let registry=null,registryDistance=null,reviewStatus='corroborated',scope='address_and_building',rule='reviewed_official_address_and_registry_point';
  if(id==='2390'){
    const other=targeo(id),meters=distance(candidate.location,other.point);assert.ok(meters<=30);
    for(const part of [store.address.city,store.address.street_address,store.address.postal_code])assert.ok(other.text.includes(norm(part)));
    scope='location_only_official_address_variant';rule='reviewed_official_address_and_second_map';refs.push(`${id}-targeo`);
    notes.push(`Oficjalna karta i Targeo wskazują Biedronkę przy Lecha Kaczyńskiego 5, 80-374 Gdańsk. Punkty OSM i Targeo różnią się o ${Math.round(meters)} m. UUG nie zwraca dokładnego numeru 5, a jako najbliższy wskazuje 3. Potwierdzono lokalizację sklepu względem drugiej mapy; nie zmieniono adresu i nie uznano numeru 3 za adres sklepu.`);
  }else{
    const key=`${id}-gugik-pierwotny`,data=read(meta.get(key).file);
    const candidates=Object.entries(data.results??{}).filter(([,r])=>norm(r.city)===norm(store.address.city)
      &&norm(r.number)===norm(store.address.house_number)&&compatible(r.street,store.address.street)
      &&distance(candidate.location,{latitude:+r.y,longitude:+r.x})<=75);
    assert.equal(candidates.length,1,`Nie ma jednoznacznego punktu adresu: ${id}`);
    registry=candidates[0][1];registryDistance=distance(candidate.location,{latitude:+registry.y,longitude:+registry.x});refs.push(key);
    if(['1444','1449'].includes(id)){
      const other=targeo(id),meters=distance(candidate.location,other.point);assert.ok(meters<=30);
      reviewStatus='requires_review';scope='location_confirmed_postcode_unresolved';refs.push(`${id}-targeo`);
      for(const part of [store.address.city,store.address.street_address])assert.ok(other.text.includes(norm(part)),'Inny adres na mapie pomocniczej.');
      const targeoCode=id==='1444'?'44-196':'07-409';assert.ok(other.text.includes(targeoCode));
      notes.push(`Położenie sklepu potwierdzają adres uliczny z oficjalnej karty, punkt UUG (${Math.round(registryDistance)} m) oraz Targeo (${Math.round(meters)} m). Kod pocztowy pozostaje nierozstrzygnięty: Biedronka ${store.address.postal_code}, GUGiK ${registry.code}, Targeo ${targeoCode}. Przyjęto współrzędne, zachowano pierwotny adres i pozostawiono rekord poza zbiorem gotowym do wyjaśnienia kodu.`);
    }else{
      assert.equal(registry.code,store.address.postal_code,'Nieoczekiwana różnica kodu pocztowego.');
      notes.push(notesById[id]);
      notes.push(`Dokładny adres UUG: ${registry.street} ${registry.number}, ${registry.code} ${registry.city}; odległość od proponowanego punktu ${Math.round(registryDistance)} m.`);
    }
  }
  const expected={source_sha256:sourceHash,location:null,address:store.address},replacement={location:candidate.location},resolves=['missing_geometry'];
  const record={id:store.id,status:'accepted',review_status:reviewStatus,scope,expected,replacement,resolves,reason:notes.join(' '),
    match_rule:rule,osm_url:candidate.osm_url,registry_record:registry,registry_distance_m:registryDistance===null?null:Number(registryDistance.toFixed(2)),
    references:refs.map(key=>meta.get(key))};records.push(record);
  patches.push({id:store.id,status:'accepted_after_source_review',expected,replacement,resolves,evidence:{provider:'openstreetmap',url:candidate.osm_url,
    element_type:element.type,element_id:element.id,position_kind:element.type==='node'?'node':'overpass_center',match_rule:rule,
    matched_on:['source_review','official_store_card','saved_osm','independent_address_or_map'],matched_tags:element.tags,
    dataset_file:osmFile,dataset_sha256:hash(osmRaw),osm_timestamp:osm.osm3s.timestamp_osm_base,retrieved_at:meta.get(`${id}-osm`).retrieved_at,
    attribution:'© OpenStreetMap contributors',license:'ODbL-1.0',license_url:'https://www.openstreetmap.org/copyright'}});
}
const now=new Date().toISOString(),reportFile=dir+'raport.json';
const report={schema_version:1,reviewed_at:now,baseline_input_fingerprint:baseline.input_fingerprint,reviewed:records.length,
  accepted:patches.length,unresolved:0,address_follow_up:records.filter(r=>r.review_status==='requires_review').length,
  eligible_for_ready:records.filter(r=>r.review_status==='corroborated').length,coordinates_added:patches.length,
  street_addresses_added:0,postal_codes_corrected:0,method:selection.method,unusable_json_responses:unusableJson,records,
  limitation:'Przyjęcie współrzędnych nie rozstrzyga wszystkich pól adresu. Knurów i Ostrołęka zachowują status wymagający kontroli kodu pocztowego. Nie sprawdzono wejść ani bieżącego otwarcia. Reguł dopasowania automatycznego nie poszerzono.'};
save(reportFile,report);evidence.push({file:reportFile,sha256:hash(raw(reportFile))});
for(const p of patches)p.evidence.review_report={dataset_file:reportFile,dataset_sha256:hash(raw(reportFile))};
const file='poprawki/biedronka-zweryfikowane.json',previous=read(file);
assert.equal(previous.baseline_input_fingerprint,baseline.input_fingerprint);
const ids=new Set(records.map(r=>r.id)),entries=new Map(previous.evidence_files.map(e=>[e.file,e]));for(const e of evidence)entries.set(e.file,e);
const combined=[...previous.corrections.filter(p=>!ids.has(p.id)),...patches];
for(const old of previous.corrections.filter(p=>!ids.has(p.id)))assert.deepEqual(combined.find(p=>p.id===old.id),old,'Utracono wcześniejszą poprawkę.');
save(file,{...previous,generated_at:now,evidence_files:[...entries.values()],corrections:combined});
const decisionsFile='weryfikacja-biedronki/decyzje-przegladu.json';
save(decisionsFile,mergeReviewDecisions(read(decisionsFile),{schema_version:1,reviewed_at:now,baseline_input_fingerprint:baseline.input_fingerprint,evidence_files:evidence,
  decisions:records.map(r=>({id:r.id,status:r.review_status,scope:r.scope,reason:r.reason,report_file:reportFile,
    expected:{address:r.expected.address,location:r.replacement.location}}))}));
const csv=v=>'"'+String(v??'').replaceAll('"','""')+'"';
const rows=[['id','adres_zachowany','decyzja_o_punkcie','status_rekordu','latitude','longitude','odleglosc_do_dokladnego_adresu_m','uzasadnienie','osm'],
  ...records.map(r=>[r.id,r.expected.address.formatted,r.status,r.review_status,r.replacement.location.latitude,r.replacement.location.longitude,r.registry_distance_m,r.reason,r.osm_url])];
fs.writeFileSync(path.join(root,dir+'wynik.csv'),'\uFEFF'+rows.map(row=>row.map(csv).join(';')).join('\r\n')+'\r\n');
const lines=['# Druga partia 20 propozycji Biedronki','',`Data UTC: ${now}`,'',
  '**Przyjęto 20 poprawek współrzędnych: 18 rekordów może trafić do zbioru gotowego, 2 pozostają do kontroli kodu pocztowego.**','',
  'W tej partii nie zmieniono żadnego adresu ani kodu pocztowego. Knurów 1444 i Ostrołęka 1449 zachowują oryginalne adresy i otrzymują poprawione punkty, ale są w zbiorze do weryfikacji.', '',
  selection.method,'','## Decyzje','','| Sklep | Punkt | Status po przeglądzie |','| --- | --- | --- |',
  ...records.map(r=>`| ${r.expected.address.formatted} | Przyjęty | ${r.review_status==='corroborated'?'Gotowy według kontroli':'Do kontroli kodu pocztowego'} |`),'',
  ...records.flatMap(r=>[`## ${r.id} — ${r.expected.address.formatted}`,'',r.reason,'',
    ...r.references.map(m=>`- [${m.key}](${m.url}) — lokalny plik: \`${path.basename(m.file)}\`, SHA-256: \`${m.sha256}\`.`),'']),
  '## Ograniczenia i odtworzenie','',report.limitation,'',
  'UUG dla jednego zapytania z typograficznym cudzysłowem zwróciło tekst błędu przy HTTP 200. Odpowiedź zachowano w archiwum i wykluczono z dowodów dopasowania; właściwy adres potwierdzono oddzielnym zapytaniem. Szczegóły: `unusable_json_responses` w raporcie JSON.', '',
  '```powershell','node .\\dane-sklepow\\pobierz-propozycje01.mjs --batch=02','node .\\dane-sklepow\\przyjmij-propozycje02.mjs',
  'node .\\dane-sklepow\\przygotuj-dane.mjs','node .\\dane-sklepow\\podsumuj-weryfikacje.mjs','```','',
  'Pobieranie używa lokalnego archiwum. Dalsze komendy działają offline. Zachowano wcześniejsze poprawki i decyzje. Dane OSM: © OpenStreetMap contributors, ODbL-1.0.'];
fs.writeFileSync(path.join(root,dir+'README.md'),lines.join('\n')+'\n');
console.log(JSON.stringify({...report,records:undefined},null,2));
