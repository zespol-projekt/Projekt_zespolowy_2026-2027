import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadSources,prepareData } from './przygotuj-dane.mjs';
import { mergeReviewDecisions } from './przeglad.mjs';
const root=path.dirname(fileURLToPath(import.meta.url)),dir='weryfikacja-biedronki/propozycje-01/';
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const raw=file=>fs.readFileSync(path.join(root,file));
const save=(file,value)=>fs.writeFileSync(path.join(root,file),JSON.stringify(value,null,2)+'\n');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const norm=s=>String(s??'').normalize('NFC').toLocaleLowerCase('pl-PL').replace(/\s+/gu,' ').trim();
const distance=(a,b)=>{
  const rad=Math.PI/180,h=Math.sin((a.latitude-b.latitude)*rad/2)**2+Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin((a.longitude-b.longitude)*rad/2)**2;
  return 12742000*Math.asin(Math.min(1,Math.sqrt(h)));
};
const plain=html=>html.replace(/<!--[\s\S]*?-->/g,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
const selection=read(dir+'wybor.json'),manifest=read(dir+'manifest.json');
assert.equal(selection.selected.length,20);assert.equal(manifest.processed,manifest.requested);
const metas=new Map(manifest.responses.map(m=>[m.key,m]));
const evidence=[{file:dir+'wybor.json',sha256:hash(raw(dir+'wybor.json'))},
  {file:dir+'manifest.json',sha256:hash(raw(dir+'manifest.json'))}];
for(const m of manifest.responses){assert.equal(m.status,200);assert.equal(hash(raw(m.file)),m.sha256);evidence.push({file:m.file,sha256:m.sha256});}
const {manifest:sources,datasets}=loadSources(root),baseline=prepareData(sources,datasets);
assert.equal(baseline.input_fingerprint,selection.baseline_input_fingerprint);
const stores=new Map([...baseline.ready,...baseline.review].map(s=>[s.id,s]));
const sourceHash=baseline.sources.find(s=>s.chain==='biedronka').sha256;
const automatic=read('poprawki/biedronka.json'),osmFile='weryfikacja-biedronki/pelny-przebieg/osm-polaczone.json';
const osmRaw=raw(osmFile),osm=JSON.parse(osmRaw.toString('utf8'));
evidence.push({file:osmFile,sha256:hash(osmRaw)});
const pdfKey='oficjalna-lista-adresow',pdfMeta=metas.get(pdfKey),textFile=dir+'oficjalna-lista-adresow.txt';
const pdfText=raw(textFile).toString('utf8');evidence.push({file:textFile,sha256:hash(raw(textFile))});
const pdfExtract={source_file:pdfMeta.file,source_sha256:pdfMeta.sha256,text_file:textFile,text_sha256:hash(raw(textFile)),
  method:'pypdf.PdfReader, extract_text, wszystkie strony; wyciąg zapisany przed decyzjami.'};
save(dir+'wyciag-dokumentu.json',pdfExtract);evidence.push({file:dir+'wyciag-dokumentu.json',sha256:hash(raw(dir+'wyciag-dokumentu.json'))});
const targeo=id=>{
  const h=raw(metas.get(`${id}-targeo`).file).toString('utf8'),match=h.match(/var _LOCATION = (\{[^}]+\})/);
  assert.ok(match);const p=JSON.parse(match[1]);return{latitude:+p.y,longitude:+p.x};
};
const addressOf=r=>({formatted:`${r.street??r.city} ${r.number}, ${r.code} ${r.city}`,
  street_address:`${r.street??r.city} ${r.number}`,street:r.street??r.city,house_number:r.number,city:r.city,postal_code:r.code,country:'PL'});
const tokens=s=>norm(s).replace(/\b(?:ulica|ul|aleja|al|marszałka|marsz|pułkownika|płk|generała|gen)\b/gu,'')
  .split(/[^\p{L}\p{N}]+/u).filter(Boolean).filter(t=>!['ii','iii','iv','9','go'].includes(t));
const compatible=(a,b)=>{
  const x=tokens(a),y=tokens(b);if(!x.length||!y.length)return false;
  const short=x.length<y.length?x:y,long=x.length<y.length?y:x;
  return short.every(t=>long.includes(t)||t.length===1&&long.some(w=>w.startsWith(t)));
};
const extraNotes={
  '1573':'Potwierdzono wariant kolejności członów Curie-Skłodowskiej / Skłodowskiej-Curie.',
  '1838':'Rejestr rozwija nazwę jednostki do 9-go Pułku Strzelców Konnych; numer domu pozostaje 8.',
  '2466':'Rozwinięto imię Jerzego w nazwie alei wyłącznie na etapie porównania.',
  '3033':'Potwierdzono pełną nazwę z imieniem Kazimierza; adres wejściowy zachowano.',
  '3454':'Rozwinięto skrót Marsz. i wielkość litery numeru 200a/200A przy porównaniu.',
  '1203':'Potwierdzono wariant z prefiksem Aleja.',
  '1216':'Potwierdzono skrót al. J. Piłsudskiego mimo brakującej miejscowości w tagach OSM.',
  '1649':'Rejestr i OSM pomijają III w nazwie Jana Sobieskiego; numer 22 jest zgodny.',
  '1666':'Potwierdzono rozwinięcie imienia Antoniego w nazwie Planty Kowalskiego.',
  '1782':'Potwierdzono wariant z prefiksem Aleja Armii Krajowej.',
  '1825':'Potwierdzono wariant Aleja 600-lecia.',
  '1968':'Potwierdzono wariant al. Armii Krajowej.',
};
const records=[],patches=[];
for(const chosen of selection.selected){
  const id=chosen.id.split(':')[1],store=stores.get(chosen.id),candidate=chosen.suggestions[0];
  assert.ok(store&&store.quality.status==='needs_review');
  assert.deepEqual(store.address,chosen.store.address);assert.deepEqual(store.location,chosen.store.location);
  assert.ok(!automatic.corrections.some(p=>p.id===store.id),'Nie nadpisujemy istniejącej poprawki automatycznej.');
  const parts=candidate.osm_url.split('/'),element=osm.elements.find(e=>e.type===parts.at(-2)&&String(e.id)===parts.at(-1));assert.ok(element);
  const fresh=read(metas.get(`${id}-osm`).file),current=fresh.elements.find(e=>e.type===element.type&&e.id===element.id);
  assert.ok(current);assert.deepEqual(current.tags,element.tags,'Zmieniły się tagi OSM — konieczna ponowna ocena.');
  const nodes=fresh.elements.filter(e=>e.type==='node');
  const freshPoint=current.type==='node'?{latitude:current.lat,longitude:current.lon}:{
    latitude:(Math.min(...nodes.map(n=>n.lat))+Math.max(...nodes.map(n=>n.lat)))/2,
    longitude:(Math.min(...nodes.map(n=>n.lon))+Math.max(...nodes.map(n=>n.lon)))/2};
  assert.ok(distance(freshPoint,candidate.location)<1,'Zmieniła się geometria propozycji.');
  const official=raw(metas.get(`${id}-oficjalna`).file).toString('utf8'),marker=official.indexOf('Pokaż na mapie');assert.ok(marker>0);
  const block=norm(plain(official.slice(Math.max(0,marker-3000),marker)));
  for(const a of [store.address.city,store.address.postal_code])assert.ok(block.includes(norm(a)),'Zmienił się oficjalny adres.');
  if(store.address.street_address)assert.ok(block.includes(norm(store.address.street_address)),'Inny oficjalny adres uliczny.');
  const website=String(element.tags.website??element.tags['contact:website']??'');
  const websiteId=website.match(/https?:\/\/(?:www\.)?biedronka\.pl\/pl\/shop,id,(\d+)/iu)?.[1];
  if(websiteId)assert.equal(websiteId,id,'Sprzeczny identyfikator strony sklepu.');
  const expected={source_sha256:sourceHash,location:store.location,address:store.address};
  const replacement={},resolves=[],notes=[],refs=[`${id}-oficjalna`,`${id}-osm`,`${id}-gugik-reverse`];
  let addressSource=null,registry=null,status='accepted',rule='reviewed_official_address_and_registry_point';
  if(id==='2220'){
    status='unresolved';rule='unresolved_conflicting_address_numbers';refs.push('2220-targeo','2220-gugik-sprawdzony');
    notes.push('Zgodne ID sklepu i punkt Targeo potwierdzają placówkę przy Plater. Targeo podaje numer 9, rejestr nie zwraca dokładnego numeru 9 i jako najbliższy wskazuje 14. Źródła dotyczące ładowarki podają także 6. Nie uzupełniamy numeru z sąsiedniego adresu ani samego katalogu.');
  }else if(['3370','3484','7026'].includes(id)){
    assert.equal(websiteId,id);rule='reviewed_official_id_and_registry_address';
    const key=`${id}-gugik-sprawdzony`,m=metas.get(key),data=read(m.file);
    const entries=Object.entries(data.results??{}).filter(([,r])=>norm(r.city)===norm(store.address.city)
      &&distance(store.location,{latitude:+r.y,longitude:+r.x})<=75);
    assert.equal(entries.length,1,'Brak jednoznacznego adresu blisko znanego punktu.');
    const [recordKey,r]=entries[0];registry=r;replacement.address=addressOf(r);resolves.push('missing_street_address');
    assert.ok(distance(candidate.location,{latitude:+r.y,longitude:+r.x})<=75);
    assert.ok(distance(candidate.location,targeo(id))<=40,'Targeo wskazuje inną placówkę.');
    const th=norm(plain(raw(metas.get(`${id}-targeo`).file).toString('utf8')));
    assert.ok(th.includes(norm(r.number))&&th.includes(norm(r.city))&&th.includes(norm(r.code)));
    notes.push(`Uzupełniono adres z GUGiK; tożsamość potwierdza dokładne ID strony sklepu w OSM, bliskość pierwotnego punktu oraz zgodny sklep w Targeo. Punkt rejestrowy jest ${Math.round(distance(store.location,{latitude:+r.y,longitude:+r.x}))} m od pierwotnej lokalizacji.`);
    addressSource={provider:'gugik',dataset_file:m.file,dataset_sha256:m.sha256,record_key:recordKey};refs.push(key,`${id}-targeo`);
  }else{
    replacement.location=candidate.location;resolves.push('missing_geometry');
    if(id==='1400'){
      assert.equal(websiteId,id);assert.ok(distance(candidate.location,targeo(id))<=30);rule='reviewed_official_id_and_second_map';refs.push('1400-targeo');
      notes.push('Oficjalna karta i Targeo podają Kolbego 58, 85-433 oraz zgodne położenie sklepu. OSM ma kod 85-435, rejestr jako najbliższy wskazuje numer 56. Uzupełniamy wyłącznie punkt; zachowujemy adres z oficjalnej karty i zapisujemy rozbieżności. Nie potwierdzono urzędowej numeracji budynku.');
    }else if(id==='3772'){
      assert.equal(websiteId,id);assert.ok(distance(candidate.location,targeo(id))<=40);rule='reviewed_official_id_and_official_postcode';
      const excerpt=pdfText.split(/\r?\n/u).find(line=>norm(line).includes('mrągowo 11-700 ul. wolności 4e'))?.trim();assert.ok(excerpt);
      replacement.address={...store.address,postal_code:'11-700',formatted:`${store.address.street_address}, 11-700 ${store.address.city}`};
      addressSource={provider:'official_pdf',dataset_file:pdfMeta.file,dataset_sha256:pdfMeta.sha256,
        text_file:textFile,text_sha256:hash(raw(textFile)),excerpt};
      notes.push('Punkt potwierdzają dokładne ID sklepu i Targeo. Kod 17-100 z API zastąpiono kodem 11-700: oficjalna lista Biedronki podaje go przy Wolności 4e, a Targeo potwierdza ten sam adres i kod. Rejestr nie zwraca numeru 4e; nie zastępujemy go sąsiednim numerem 4.');
      refs.push('3772-targeo',pdfKey,'3772-oficjalny-komunikat');
    }else{
      const key=`${id}-gugik-pierwotny`,m=metas.get(key),data=read(m.file);
      const entries=Object.values(data.results??{}).filter(r=>norm(r.city)===norm(store.address.city)
        &&norm(r.number)===norm(store.address.house_number)&&r.code===store.address.postal_code
        &&compatible(r.street,store.address.street)&&distance(candidate.location,{latitude:+r.y,longitude:+r.x})<=75);
      assert.equal(entries.length,1,`Nie znaleziono jednoznacznego punktu adresu: ${id}`);registry=entries[0];refs.push(key);
      if(['3572','3768'].includes(id)){
        assert.equal(websiteId,id);rule='reviewed_official_id_and_conflicting_osm_number';
        notes.push(`OSM opisuje budynek numerem ${element.tags['addr:housenumber']}, a oficjalna karta numerem ${store.address.house_number}. Dokładny punkt GUGiK dla numeru oficjalnego leży ${Math.round(distance(candidate.location,{latitude:+registry.y,longitude:+registry.x}))} m od środka budynku OSM. Zachowujemy numer z oficjalnej karty; przyjmujemy współrzędne po kontroli ID i źródeł.`);
        refs.push(id==='3572'?'3572-oficjalny-komunikat':pdfKey);
      }else notes.push(extraNotes[id]);
      notes.push(`Dokładny adres GUGiK: ${registry.street} ${registry.number}, ${registry.code} ${registry.city}; odległość od proponowanego punktu: ${Math.round(distance(candidate.location,{latitude:+registry.y,longitude:+registry.x}))} m. Adres wejściowy zachowano.`);
    }
  }
  const record={id:store.id,status,expected,replacement:status==='accepted'?replacement:null,resolves:status==='accepted'?resolves:[],
    reason:notes.filter(Boolean).join(' '),match_rule:rule,osm_url:candidate.osm_url,official_store_id_confirmed:websiteId===id,
    registry_record:registry,reference_keys:refs,references:refs.map(key=>metas.get(key))};
  records.push(record);
  if(status==='accepted')patches.push({id:store.id,status:'accepted_after_source_review',expected,replacement,resolves,
    evidence:{provider:'openstreetmap',url:candidate.osm_url,element_type:element.type,element_id:element.id,
      position_kind:element.type==='node'?'node':'overpass_center',match_rule:rule,matched_on:['source_review','official_store_card','saved_osm','independent_address_or_map'],
      matched_tags:element.tags,dataset_file:osmFile,dataset_sha256:hash(osmRaw),osm_timestamp:osm.osm3s.timestamp_osm_base,
      retrieved_at:metas.get(`${id}-osm`).retrieved_at,attribution:'© OpenStreetMap contributors',license:'ODbL-1.0',license_url:'https://www.openstreetmap.org/copyright',
      ...(addressSource?{address_source:addressSource}:{})}});
}
const now=new Date().toISOString(),reportFile=dir+'raport.json';
const report={schema_version:1,reviewed_at:now,baseline_input_fingerprint:baseline.input_fingerprint,
  reviewed:records.length,accepted:patches.length,unresolved:records.filter(r=>r.status!=='accepted').length,
  coordinates_added:patches.filter(p=>p.replacement.location).length,street_addresses_added:patches.filter(p=>p.resolves.includes('missing_street_address')).length,
  postal_codes_corrected:patches.filter(p=>p.replacement.address&&p.expected.address.postal_code!==p.replacement.address.postal_code).length,
  method:selection.method,records,limitation:'To porównanie zapisanych źródeł online, bez kontroli terenowej, potwierdzenia wejścia lub bieżącego otwarcia placówki. Warianty adresu zostały jawnie opisane. Reguł dopasowania automatycznego nie poszerzono.'};
save(reportFile,report);evidence.push({file:reportFile,sha256:hash(raw(reportFile))});
for(const p of patches)p.evidence.review_report={dataset_file:reportFile,dataset_sha256:hash(raw(reportFile))};
const verifiedFile='poprawki/biedronka-zweryfikowane.json';
const oldVerified=fs.existsSync(path.join(root,verifiedFile))?read(verifiedFile):null;
if(oldVerified)assert.equal(oldVerified.baseline_input_fingerprint,baseline.input_fingerprint);
const chosenIds=new Set(selection.selected.map(s=>s.id));
const mergedEvidence=new Map((oldVerified?.evidence_files??[]).map(e=>[e.file,e]));for(const e of evidence)mergedEvidence.set(e.file,e);
save(verifiedFile,{schema_version:1,generated_at:now,baseline_input_fingerprint:baseline.input_fingerprint,
  scope:'Poprawki przyjęte po osobnym przeglądzie propozycji; w pełni odtwarzalne z zapisanych dowodów.',
  evidence_files:[...mergedEvidence.values()],corrections:[...(oldVerified?.corrections??[]).filter(p=>!chosenIds.has(p.id)),...patches]});
const decisionsFile='weryfikacja-biedronki/decyzje-przegladu.json',previous=read(decisionsFile);
save(decisionsFile,mergeReviewDecisions(previous,{schema_version:1,reviewed_at:now,baseline_input_fingerprint:baseline.input_fingerprint,evidence_files:evidence,
  decisions:records.map(r=>({id:r.id,status:r.status==='accepted'?'corroborated':'requires_review',reason:r.reason,
    scope:r.status!=='accepted'?'unresolved_address':r.id==='1400'?'location_only_official_address_variant':'address_and_building',report_file:reportFile,
    expected:{address:r.replacement?.address??r.expected.address,location:r.replacement?.location??r.expected.location}}))}));
const csv=v=>'"'+String(v??'').replaceAll('"','""')+'"';
const rows=[['id','adres_przed','decyzja','adres_po','zmienione_pola','latitude_po','longitude_po','uzasadnienie','osm'],
  ...records.map(r=>[r.id,r.expected.address.formatted,r.status,(r.replacement?.address??r.expected.address).formatted,
    Object.keys(r.replacement??{}).join(', '),(r.replacement?.location??r.expected.location)?.latitude,
    (r.replacement?.location??r.expected.location)?.longitude,r.reason,r.osm_url])];
fs.writeFileSync(path.join(root,dir+'wynik.csv'),'\uFEFF'+rows.map(row=>row.map(csv).join(';')).join('\r\n')+'\r\n');
const lines=['# Pierwsza partia 20 propozycji Biedronki','',`Data UTC: ${now}`,'',
  `**Przejrzano ${report.reviewed} propozycji: przyjęto ${report.accepted}, pozostawiono ${report.unresolved} nierozstrzygniętą.**`,'',
  `Uzupełniono ${report.coordinates_added} brakujących punktów, ${report.street_addresses_added} adresy uliczne i poprawiono ${report.postal_codes_corrected} kod pocztowy. To zmiany po sprawdzeniu propozycji, osobne od wcześniejszych 188 poprawek automatycznych.`, '',
  selection.method,'','## Decyzje','','| Sklep | Wynik | Zmiany |','| --- | --- | --- |',
  ...records.map(r=>`| ${r.expected.address.formatted} | ${r.status==='accepted'?'Przyjęto':'Do dalszej kontroli'} | ${Object.keys(r.replacement??{}).join(', ')||'Zachowano oryginał'} |`),'',
  ...records.flatMap(r=>[`## ${r.id} — ${r.expected.address.formatted}`,'',r.reason,'',
    ...r.references.map(m=>`- [${m.key}](${m.url}) — plik: \`${path.basename(m.file)}\`; SHA-256: \`${m.sha256}\`.`),'']),
  '## Odtworzenie','','```powershell','node .\\dane-sklepow\\przyjmij-propozycje01.mjs','node .\\dane-sklepow\\przygotuj-dane.mjs',
  'node .\\dane-sklepow\\podsumuj-weryfikacje.mjs','```','',
  'Raport i CSV zachowują wszystkie 20 decyzji, również nierozstrzygniętą. Poprawki znajdują się w `../../poprawki/biedronka-zweryfikowane.json` i są ładowane obok poprawek automatycznych. Ponowne dopasowanie automatyczne ich nie usuwa. Dowody muszą zachować sumy SHA-256.', '',
  report.limitation,'','Dane OSM: © OpenStreetMap contributors, ODbL-1.0. Pliki źródłowe i raporty są w katalogu dane-sklepow w repozytorium.'];
fs.writeFileSync(path.join(root,dir+'README.md'),lines.join('\n')+'\n');
console.log(JSON.stringify({...report,records:undefined},null,2));
