import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const appRoot=path.resolve(root,'..');
export function resolveDataFile(env=process.env){
  const directory=env.SMARTCART_DATA_DIR?.trim()||'../dane-sklepow';
  return path.resolve(appRoot,directory,'gotowe','sklepy.json');
}
const chains=new Set(['lidl','biedronka','dino','kaufland','carrefour']);
export function buildCatalog(input){
  assert.equal(input.schema_version,1);
  assert.equal(input.count,input.stores.length);
  const ids=new Set();
  const stores=input.stores.map(s=>{
    assert.ok(chains.has(s.chain)&&s.id.startsWith(s.chain+':'));
    assert.ok(!ids.has(s.id),'Powtórzony sklep.');ids.add(s.id);
    assert.equal(s.quality.status,'ready');assert.equal(s.quality.issues.length,0);
    assert.notEqual(s.source_review?.status,'requires_review');
    assert.equal(s.address.country,'PL');assert.ok(s.address.formatted&&typeof s.address.city==='string'&&s.address.city.trim());
    const {latitude,longitude}=s.location??{};
    assert.ok(Number.isFinite(latitude)&&Number.isFinite(longitude)&&latitude>=48.9&&latitude<=55&&longitude>=14&&longitude<=24.3);
    return{id:s.id,chain:s.chain,name:s.name,address:s.address.formatted,city:s.address.city.trim(),latitude,longitude};
  });
  return{version:1,updatedAt:input.generated_at,count:stores.length,stores,
    attribution:[{label:'All the Places',url:'https://www.alltheplaces.xyz/'},
      {label:'© OpenStreetMap contributors',url:'https://www.openstreetmap.org/copyright'},
      {label:'GUGiK',url:'https://services.gugik.gov.pl/uug/'},
      {label:'Overture Maps Foundation',url:'https://docs.overturemaps.org/attribution/'}]};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const catalog = buildCatalog(JSON.parse(fs.readFileSync(resolveDataFile(), 'utf8')));
  console.log(JSON.stringify({ count: catalog.count }));
}
