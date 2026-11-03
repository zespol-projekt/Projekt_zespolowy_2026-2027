import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const appRoot=path.resolve(root,'..');
export function resolveDataFile(env=process.env){
  const directory=env.SMARTCART_DATA_DIR?.trim()||'../dane-sklepow';
  return path.resolve(appRoot,directory,'gotowe','sklepy.json');
}
const chains=new Set(['lidl','biedronka','auchan','dino']);
export function buildCatalog(input){
  assert.equal(input.schema_version,1);
  assert.equal(input.count,input.stores.length);
  const ids=new Set();
  const stores=input.stores.map(s=>{
    assert.ok(chains.has(s.chain)&&s.id.startsWith(s.chain+':'));
    assert.ok(!ids.has(s.id),'Powtórzony sklep.');ids.add(s.id);
    assert.equal(s.quality.status,'ready');assert.equal(s.quality.issues.length,0);
    assert.notEqual(s.source_review?.status,'requires_review');
    assert.equal(s.address.country,'PL');assert.ok(s.address.formatted&&s.address.city);
    const {latitude,longitude}=s.location??{};
    assert.ok(Number.isFinite(latitude)&&Number.isFinite(longitude)&&latitude>=48.9&&latitude<=55&&longitude>=14&&longitude<=24.3);
    return{id:s.id,chain:s.chain,name:s.name,address:s.address.formatted,latitude,longitude};
  });
  return{version:1,updatedAt:input.generated_at,count:stores.length,stores,
    attribution:[{label:'All the Places',url:'https://www.alltheplaces.xyz/'},
      {label:'© OpenStreetMap contributors',url:'https://www.openstreetmap.org/copyright'}]};
}

export function createStoreServer(load){
  let cached;
  function snapshot(){
    const {key,input}=load();
    if(cached?.key===key)return cached;
    const catalog=buildCatalog(input),body=Buffer.from(JSON.stringify(catalog));
    cached={key,catalog,body,gzip:gzipSync(body),etag:'"'+createHash('sha256').update(body).digest('hex')+'"'};
    return cached;
  }
  snapshot(); // Nie uruchamiamy serwera z uszkodzonym zbiorem.
  return http.createServer((req,res)=>{
    res.setHeader('Access-Control-Allow-Origin','*');
    res.setHeader('Access-Control-Allow-Methods','GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers','If-None-Match');
    res.setHeader('Access-Control-Expose-Headers','ETag');
    res.setHeader('X-Content-Type-Options','nosniff');
    if(req.method==='OPTIONS'){res.writeHead(204).end();return;}
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'Allow':'GET, HEAD, OPTIONS'}).end();return;}
    const url=new URL(req.url,'http://localhost');
    if(!['/v1/stores','/health'].includes(url.pathname)){res.writeHead(404).end();return;}
    try{
      const data=snapshot();res.setHeader('Content-Type','application/json; charset=utf-8');
      if(url.pathname==='/health'){
        res.setHeader('Cache-Control','no-store');res.end(req.method==='HEAD'?undefined:JSON.stringify({status:'ok',count:data.catalog.count,updatedAt:data.catalog.updatedAt}));return;
      }
      res.setHeader('Cache-Control','public, max-age=60');res.setHeader('ETag',data.etag);res.setHeader('Vary','Accept-Encoding');
      if(req.headers['if-none-match']===data.etag){res.writeHead(304).end();return;}
      const gzip=/\bgzip\b/u.test(req.headers['accept-encoding']??'');
      if(gzip)res.setHeader('Content-Encoding','gzip');
      const body=gzip?data.gzip:data.body;res.setHeader('Content-Length',body.length);res.end(req.method==='HEAD'?undefined:body);
    }catch(error){
      console.error('Nie można odczytać gotowych danych:',error.message);
      res.writeHead(503,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}).end(JSON.stringify({error:'Dane sklepów są chwilowo niedostępne.'}));
    }
  });
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  let file;
  try{
  // Share local configuration with Expo without loading data into the app bundle.
  try{process.loadEnvFile(path.join(appRoot,'.env.local'));}
  catch(error){if(error.code!=='ENOENT')throw error;}
  file=resolveDataFile();let previous;
  const load=()=>{
    const stat=fs.statSync(file),key=`${stat.mtimeMs}:${stat.size}`;
    if(previous?.key!==key)previous={key,input:JSON.parse(fs.readFileSync(file,'utf8'))};
    return previous;
  };
  if(process.argv.includes('--check'))console.log(JSON.stringify({status:'ok',count:buildCatalog(load().input).count}));
  else{
    const port=Number(process.env.SMARTCART_DATA_PORT??8787);assert.ok(Number.isInteger(port)&&port>0&&port<65536);
    const server=createStoreServer(load);
    server.on('error',e=>{
      console.error(e.code==='EADDRINUSE'?`Port ${port} jest zajęty. Zatrzymaj poprzedni serwer lub ustaw SMARTCART_DATA_PORT.`:e.message);
      process.exitCode=1;
    });
    server.listen(port,'0.0.0.0',()=>{
      console.log(`Dane mapy: http://localhost:${port}/v1/stores`);
      console.log(`Plik danych: ${file}`);
      for(const entries of Object.values(os.networkInterfaces()))for(const i of entries??[])
        if(i.family==='IPv4'&&!i.internal)console.log(`Adres w sieci lokalnej: http://${i.address}:${port}/v1/stores`);
    });
  }
  }catch(error){
    console.error(error.code==='ENOENT'
      ?`Nie znaleziono danych sklepów: ${file}. Sprawdź katalog dane-sklepow w repozytorium lub ustaw SMARTCART_DATA_DIR w .env.local.`
      :`Nie można uruchomić serwera sklepów: ${error.message}`);
    process.exitCode=1;
  }
}
