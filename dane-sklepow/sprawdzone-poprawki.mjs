import assert from 'node:assert/strict';
const norm=s=>String(s??'').normalize('NFC').toLocaleLowerCase('pl-PL').replace(/\s+/gu,' ').trim();
const distance=(a,b)=>{
  assert.ok(a&&b&&[a.latitude,a.longitude,b.latitude,b.longitude].every(Number.isFinite),'Brak punktu dowodowego.');
  const rad=Math.PI/180,h=Math.sin((a.latitude-b.latitude)*rad/2)**2+Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin((a.longitude-b.longitude)*rad/2)**2;
  return 12742000*Math.asin(Math.min(1,Math.sqrt(h)));
};
export function verifyReviewedPatch(patch,files,element){
  const read=(entry,json=true)=>{
    assert.ok(entry?.dataset_file&&entry.dataset_sha256,'Brak wskazania dowodu przeglądu.');
    const source=files.get(entry.dataset_file);assert.ok(source,'Brak pliku dowodowego.');
    assert.equal(source.sha256,entry.dataset_sha256,'Sprzeczna suma dowodu przeglądu.');
    return json?JSON.parse(source.raw.toString('utf8')):source.raw.toString('utf8');
  };
  const report=read(patch.evidence.review_report);
  const record=report.records.find(r=>r.id===patch.id);
  assert.equal(record?.status,'accepted','Poprawka nie została przyjęta w raporcie przeglądu.');
  assert.deepEqual(record.expected,patch.expected,'Inne wartości pierwotne w raporcie przeglądu.');
  assert.deepEqual(record.replacement,patch.replacement,'Inny zakres poprawki w raporcie przeglądu.');
  assert.deepEqual(record.resolves,patch.resolves,'Inne rozstrzygnięcie problemów w raporcie.');
  if(!patch.replacement.address)return;
  const a=patch.replacement.address,b=patch.expected.address;
  const website=String(element.tags.website??element.tags['contact:website']??'');
  assert.equal(website.match(/https?:\/\/(?:www\.)?biedronka\.pl\/pl\/shop,id,(\d+)/iu)?.[1],patch.id.split(':')[1],
    'Zmiana adresu wymaga zgodnego ID konkretnego sklepu.');
  assert.equal(norm(a.city),norm(b.city),'Zmiana miejscowości niedozwolona.');
  assert.equal(a.country,'PL');assert.ok(a.street&&a.house_number&&a.postal_code);
  assert.equal(a.street_address,`${a.street} ${a.house_number}`);
  assert.equal(a.formatted,`${a.street_address}, ${a.postal_code} ${a.city}`);
  const source=patch.evidence.address_source;
  if(source?.provider==='gugik'){
    const registry=read(source),r=registry.results?.[source.record_key];assert.ok(r,'Brak rekordu adresowego w GUGiK.');
    assert.equal(a.street,r.street??r.city);assert.equal(a.house_number,r.number);
    assert.equal(norm(a.city),norm(r.city));assert.equal(a.postal_code,r.code);
    const point={latitude:Number(r.y),longitude:Number(r.x)};
    assert.ok(point.latitude>48.9&&point.latitude<55&&point.longitude>14&&point.longitude<24.3,'Punkt GUGiK nie jest w GPS.');
    const reference=patch.replacement.location??patch.expected.location;
    assert.ok(distance(reference,point)<=75,'Adres rejestrowy jest zbyt daleko od sklepu.');
    if(patch.expected.location)assert.ok(distance(patch.expected.location,point)<=75,'Adres zbyt daleko od pierwotnego punktu.');
  }else{
    assert.equal(source?.provider,'official_pdf','Nieobsługiwane źródło adresu.');
    read(source,false);
    const text=read({dataset_file:source.text_file,dataset_sha256:source.text_sha256},false);
    assert.ok(source.excerpt&&norm(text).includes(norm(source.excerpt)),'Brak cytowanego wiersza w wyciągu dokumentu.');
    for(const value of [a.city,a.street,a.house_number,a.postal_code])assert.ok(norm(source.excerpt).includes(norm(value)),
      'Dokument nie potwierdza danego pola adresu.');
    for(const key of ['street','street_address','house_number','city','country'])assert.equal(a[key],b[key],
      'Ta poprawka dokumentowa może zmieniać tylko kod pocztowy.');
  }
}
