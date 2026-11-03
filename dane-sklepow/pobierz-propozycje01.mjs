import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const batch=process.argv.find(a=>a.startsWith('--batch='))?.split('=')[1]??'01';
assert.ok(/^\d{2}$/u.test(batch)&&Number(batch)>0,'Podaj numer partii w formacie --batch=02.');
const relative=`weryfikacja-biedronki/propozycje-${batch}/`;
const dir=path.join(root,relative);fs.mkdirSync(dir,{recursive:true});
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const save=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');
const selectionFile=path.join(dir,'wybor.json');
let selection;
if(fs.existsSync(selectionFile)) selection=JSON.parse(fs.readFileSync(selectionFile,'utf8'));
else {
  const review=new Map(read('do-weryfikacji/sklepy.json').stores.map(s=>[s.id,s]));
  const matches=read('weryfikacja-biedronki/raport-dopasowania.json');
  const alreadyReviewed=new Set();
  for(const folder of fs.readdirSync(path.join(root,'weryfikacja-biedronki')).filter(f=>/^propozycje-\d{2}$/u.test(f)&&f!==`propozycje-${batch}`)){
    const file=path.join(root,'weryfikacja-biedronki',folder,'raport.json');
    if(fs.existsSync(file))for(const record of JSON.parse(fs.readFileSync(file,'utf8')).records)alreadyReviewed.add(record.id);
  }
  const candidates=matches.decisions.filter(d=>review.has(d.id)&&d.suggestions?.length&&!alreadyReviewed.has(d.id));
  candidates.sort((a,b)=>Math.max(...b.suggestions.map(s=>s.score))-Math.max(...a.suggestions.map(s=>s.score))||a.id.localeCompare(b.id));
  selection={schema_version:1,selected_at:new Date().toISOString(),initial_remaining: candidates.length,
    baseline_input_fingerprint:read('poprawki/biedronka.json').baseline_input_fingerprint,
    matching_report_sha256:hash(fs.readFileSync(path.join(root,'weryfikacja-biedronki/raport-dopasowania.json'))),
    method:'Pierwsze 20 jeszcze nieprzejrzanych propozycji według rankingu, malejąco; remisy według ID. Ranking porządkuje pracę i nie jest prawdopodobieństwem.',
    selected:candidates.slice(0,20).map(d=>({id:d.id,store:review.get(d.id),suggestions:d.suggestions}))};
  save(selectionFile,selection);
}
assert.equal(selection.selected.length,20);
const requests=[];
for(const s of selection.selected){
  const id=s.id.split(':')[1],a=s.store.address,c=s.suggestions[0],parts=c.osm_url.split('/');
  const type=parts.at(-2),osmId=parts.at(-1);
  requests.push({key:`${id}-oficjalna`,url:`https://www.biedronka.pl/pl/shop,id,${id}`,extension:'html'},
    {key:`${id}-osm`,url:`https://api.openstreetmap.org/api/0.6/${type}/${osmId}${type==='way'?'/full':''}.json`,extension:'json'},
    {key:`${id}-gugik-reverse`,url:`https://services.gugik.gov.pl/uug/?${new URLSearchParams({request:'GetAddressReverse',location:`POINT(${c.location.longitude} ${c.location.latitude})`,srid:'4326'})}`,extension:'json'});
  for(const [key,address] of [['pierwotny',a],['osm',c.address]]) if(address.street&&address.house_number&&(address.city||a.city)){
    const city=address.city??a.city;
    const query=city===address.street?`${city} ${address.house_number}`:`${city}, ${address.street} ${address.house_number}`;
    requests.push({key:`${id}-gugik-${key}`,url:`https://services.gugik.gov.pl/uug/?${new URLSearchParams({request:'GetAddress',address:query,exact_number:'1',srid:'4326'})}`,extension:'json'});
  }
}
const supplements=path.join(dir,'dodatkowe-zrodla.json');
if(fs.existsSync(supplements))requests.push(...JSON.parse(fs.readFileSync(supplements,'utf8')));
let failures=0;const results=[];
for(const [index,q]of requests.entries()){
  const metaFile=path.join(dir,`${q.key}.meta.json`);
  if(fs.existsSync(metaFile)){
    const old=JSON.parse(fs.readFileSync(metaFile,'utf8'));
    if(old.status===200&&old.url===q.url&&fs.existsSync(path.join(root,old.file))&&hash(fs.readFileSync(path.join(root,old.file)))===old.sha256){results.push(old);continue;}
  }
  await new Promise(r=>setTimeout(r,650));
  const metadata={key:q.key,url:q.url,retrieved_at:new Date().toISOString()};
  try{
    const response=await fetch(q.url,{headers:{'User-Agent':'SmartcartStoreDataReview/1.0',Accept:'*/*'},signal:AbortSignal.timeout(20000)});
    const raw=Buffer.from(await response.arrayBuffer()),file=path.join(dir,`${q.key}.${q.extension}`);fs.writeFileSync(file,raw);
    Object.assign(metadata,{status:response.status,final_url:response.url,content_type:response.headers.get('content-type'),file:relative+path.basename(file),sha256:hash(raw),bytes:raw.length});
    failures=response.ok?0:failures+1;
  }catch(error){metadata.error=error.message;failures++;}
  save(metaFile,metadata);results.push(metadata);
  console.log(`${index+1}/${requests.length} ${q.key}: ${metadata.status??metadata.error}`);
  if(failures>=5)break;
}
save(path.join(dir,'manifest.json'),{generated_at:new Date().toISOString(),requested:requests.length,processed:results.length,responses:results});
