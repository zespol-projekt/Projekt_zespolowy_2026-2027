import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyReviewedPatch } from './sprawdzone-poprawki.mjs';
function fixture(provider='gugik'){
  const files=new Map();
  const add=(name,value)=>{
    const raw=Buffer.from(typeof value==='string'?value:JSON.stringify(value)),sha256=createHash('sha256').update(raw).digest('hex');
    files.set(name,{raw,sha256});return {dataset_file:name,dataset_sha256:sha256};
  };
  const before={street:null,street_address:null,house_number:null,city:'Miasto',postal_code:'00-001',country:'PL',formatted:'00-001 Miasto'};
  const after={street:'Ulica',street_address:'Ulica 1',house_number:'1',city:'Miasto',postal_code:'00-001',country:'PL',formatted:'Ulica 1, 00-001 Miasto'};
  const p={id:'biedronka:1',expected:{address:before,location:{latitude:52,longitude:20}},replacement:{address:after},resolves:['missing_street_address'],evidence:{}};
  const registry={results:{'1':{city:'Miasto',street:'Ulica',number:'1',code:'00-001',x:'20.0001',y:'52.0001'}}};
  p.evidence.address_source={provider:'gugik',...add('gugik.json',registry),record_key:'1'};
  if(provider==='official_pdf'){
    p.expected.address={...after,postal_code:'99-999',formatted:'Ulica 1, 99-999 Miasto'};
    const text=add('text.txt','Miasto 00-001 ul. Ulica 1');
    p.evidence.address_source={provider:'official_pdf',...add('document.pdf','PDF fixture'),text_file:text.dataset_file,text_sha256:text.dataset_sha256,excerpt:'Miasto 00-001 ul. Ulica 1'};
  }
  const element={tags:{website:'https://www.biedronka.pl/pl/shop,id,1'}};
  const pinReport=(status='accepted')=>p.evidence.review_report=add('report.json',{records:[{id:p.id,status,expected:p.expected,replacement:p.replacement,resolves:p.resolves}]});
  pinReport();return{p,files,element,pinReport,add,registry};
}
test('Adres po przeglądzie wymaga przyjętej decyzji, zgodnego ID i bliskiego punktu GUGiK',()=>{
  const f=fixture();assert.doesNotThrow(()=>verifyReviewedPatch(f.p,f.files,f.element));
  f.pinReport('unresolved');assert.throws(()=>verifyReviewedPatch(f.p,f.files,f.element),/nie została przyjęta/);
});
test('Raport nie może autoryzować innej zmiany niż zapisana w poprawce',()=>{
  const f=fixture();f.p.replacement.address.house_number='2';
  assert.throws(()=>verifyReviewedPatch(f.p,f.files,f.element),/Inny zakres/);
});
test('Sprzeczny sklep, miejscowość i zbyt daleki punkt rejestrowy blokują adres',()=>{
  {const f=fixture();f.element.tags.website='https://www.biedronka.pl/pl/shop,id,10';assert.throws(()=>verifyReviewedPatch(f.p,f.files,f.element),/ID konkretnego/);}
  for(const change of [r=>r.city='Inne',r=>r.x='23']){
    const f=fixture();change(f.registry.results['1']);
    Object.assign(f.p.evidence.address_source,f.add('gugik.json',f.registry));
    assert.throws(()=>verifyReviewedPatch(f.p,f.files,f.element));
  }
});
test('Dokument może poprawić kod pocztowy, zachowując ulicę, numer i miejscowość',()=>{
  const f=fixture('official_pdf');assert.doesNotThrow(()=>verifyReviewedPatch(f.p,f.files,f.element));
  f.p.replacement.address.street='Inna';f.p.replacement.address.street_address='Inna 1';
  f.p.replacement.address.formatted='Inna 1, 00-001 Miasto';f.pinReport();
  assert.throws(()=>verifyReviewedPatch(f.p,f.files,f.element));
});
test('Nie można wpisać kodu niewystępującego w zacytowanym wierszu dokumentu',()=>{
  const f=fixture('official_pdf');f.p.replacement.address.postal_code='00-002';
  f.p.replacement.address.formatted='Ulica 1, 00-002 Miasto';f.pinReport();
  assert.throws(()=>verifyReviewedPatch(f.p,f.files,f.element),/nie potwierdza/);
});
test('Brak dowodu przeglądu albo niezgodna suma pliku jest odrzucana',()=>{
  const f=fixture();f.p.evidence.review_report.dataset_sha256='wrong';
  assert.throws(()=>verifyReviewedPatch(f.p,f.files,f.element),/suma dowodu/);
  delete f.p.evidence.review_report;assert.throws(()=>verifyReviewedPatch(f.p,f.files,f.element),/Brak wskazania/);
});
