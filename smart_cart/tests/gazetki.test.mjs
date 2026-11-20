import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { opiszObraz, typObrazu } from '../scripts/gazetki/obrazy.mjs';
import {
  dataBezRoku, datyBiedronki, idGazetki, parsujGazetkeLidla, parsujGazetkiDino, parsujIdPrzegladarkiBiedronki,
  parsujListeBiedronki, parsujListeLidla, parsujTytulBiedronki, parsujStronyBiedronki, rozpakujNuxt, ZRODLA,
} from '../scripts/gazetki/zrodla.mjs';
import { czytajArchiwum, czytajNazwePobranej, dodajPobrane, dodajRecznie, pobierzGazetki, sprzataj, wczytajDostep, wgraj } from '../scripts/gazetki/gazetki.mjs';
import { naglowkiCors, zbudujOdpowiedz } from '../supabase/functions/leaflets/odpowiedz.ts';

// Minimalne nagłówki obrazów (wystarczą do rozpoznania typu i wymiarów).
const png = (w, h) => { const b = Buffer.alloc(40); Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').copy(b); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
const jpeg = (w, h) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 3, 0, 0, 0, 0]);
const webp = (w, h, ziarno = 0) => { const b = Buffer.alloc(40, ziarno); b.write('RIFF', 0); b.write('WEBP', 8); b.write('VP8X', 12); b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3); return b; };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gazetki-'));

test('obrazy: typ po bajtach, wymiary PNG/JPEG/WebP, limity', () => {
  assert.deepEqual([opiszObraz(png(1200, 1800)).width, opiszObraz(png(1200, 1800)).height], [1200, 1800]);
  assert.equal(opiszObraz(jpeg(1420, 2400)).mime, 'image/jpeg');
  assert.equal(opiszObraz(jpeg(1420, 2400)).height, 2400);
  assert.deepEqual([opiszObraz(webp(1000, 1500)).width, opiszObraz(webp(1000, 1500)).rozszerzenie], [1000, 'webp']);
  assert.equal(typObrazu(Buffer.from('%PDF-1.7')), null);
  assert.throws(() => opiszObraz(Buffer.from('%PDF-1.7 ...')), /nie jest obraz /);
  assert.throws(() => opiszObraz(png(9000, 100)), /8192/);
  assert.throws(() => opiszObraz(png(6000, 6000)), /30 mln/);
});

test('ID gazetki i daty bez roku', () => {
  assert.equal(idGazetki('dino', '367', 'Weekendowe Okazje!'), 'dino-367-weekendowe-okazje');
  assert.match(idGazetki('x', 'a'.repeat(200)), /^[a-z0-9][a-z0-9_-]{0,79}$/);
  assert.equal(dataBezRoku(19, 11, '2026-11-19'), '2026-11-19');
  assert.equal(dataBezRoku(2, 1, '2026-12-30'), '2027-01-02', 'przełom roku');
  assert.equal(dataBezRoku(29, 12, '2027-01-02'), '2026-12-29');
});

test('Biedronka: lista bez gazetek alkoholowych, daty z tytułu i szacowany koniec, strony w kolejności', () => {
  const html = `<a href="https://www.biedronka.pl/pl/press,id,j39k145ri,title,codziennie-niskie-ceny-p-oferta-od-19-11#page=1">
    <a href="https://www.biedronka.pl/pl/press,id,j35d8zcvl,title,codziennie-niskie-ceny-p-oferta-od-16-11#page=1">
    <a href="https://www.biedronka.pl/pl/pressadult,id,1wq2jo79f,title,czas-na-toast-p-oferta-od-16-11">
    <a href="https://www.biedronka.pl/pl/press,id,j38cuy1uc,title,magiczna-kraina-zabawek">`;
  const lista = parsujListeBiedronki(html);
  assert.deepEqual(lista.map(g => g.ref), ['j39k145ri', 'j35d8zcvl', 'j38cuy1uc']);
  datyBiedronki(lista, '2026-11-19');
  const [od19, od16, zabawki] = lista;
  assert.deepEqual([od16.wazne_od, od16.wazne_do], ['2026-11-16', '2026-11-18'], 'do dnia przed następną z serii');
  assert.deepEqual([od19.wazne_od, od19.wazne_do, od19.koniec_szacowany], ['2026-11-19', '2026-11-25', true]);
  assert.equal(zabawki.wazne_od, null);
  assert.equal(parsujTytulBiedronki('<title>Festiwal wędlin od 17.11 - Gazetka - Biedronka.pl</title>', 'festiwal-wdlin-od-17-11'), 'Festiwal wędlin od 17.11');
  assert.equal(parsujTytulBiedronki('', 'festiwal-wdlin-od-17-11'), 'festiwal wdlin od 17 11');
  assert.equal(parsujIdPrzegladarkiBiedronki('window.galleryLeaflet.init("86288712-6b02-4f38-920c-f91eeed3a2f4");'), '86288712-6b02-4f38-920c-f91eeed3a2f4');
  assert.deepEqual(parsujStronyBiedronki({ images_mobile: [{ page: 1, image: 'https://i/b.png' }, { page: 0, image: 'https://i/a.png' }, { page: 2, image: '' }] }),
    ['https://i/a.png', 'https://i/b.png']);
});

test('Lidl: identyfikatory z listy, daty i strony z endpointu gazetek', () => {
  assert.deepEqual(parsujListeLidla('href="/l/pl/gazetki/gazetka-19-11-czw-kw47/ar/0?_ab=1" href="https://www.lidl.pl/l/pl/gazetki/karta-win-katalog-od-05-11/ar/0"'),
    ['gazetka-19-11-czw-kw47', 'karta-win-katalog-od-05-11']);
  const g = parsujGazetkeLidla('gazetka-19-11-czw-kw47', { flyer: { id: 'f1', name: 'Gazetka', title: '19.11', offerStartDate: '2026-11-19', offerEndDate: '2026-11-21',
    pages: [{ number: 2, image: 'https://img/2.jpg' }, { number: 1, image: 'https://img/1.jpg' }] } });
  assert.deepEqual([g.id, g.tytul, g.wazne_od, g.wazne_do, g.koniec_szacowany], ['lidl-gazetka-19-11-czw-kw47', 'Gazetka 19.11', '2026-11-19', '2026-11-21', false]);
  assert.deepEqual(g.strony, ['https://img/1.jpg', 'https://img/2.jpg']);
  assert.equal(parsujGazetkeLidla('x', { flyer: { pages: [] } }), null);
});

// Dane Nuxt w formacie jak marketdino.pl/gazetki/lista/standard/_payload.json (wartości przez indeksy).
const DINO = [{ data: 1 }, ['ShallowReactive', 2], { 'leaflets-list': 3 }, { alcohol: 4, standard: 5 }, [], [6], ['Reactive', 7],
  { id: 8, name: 9, activeFrom: 10, activeTo: 11, pages: 12 }, 367, 'Weekendowe okazje', '2026-11-20 00:00:00', '2026-11-21 22:30:00',
  [13, 17], { no: 14, file: 15, isAlcohol: 16 }, 2, { url: 18 }, false, { no: 19, file: 20, isAlcohol: 16 },
  'https://api.marketdino.pl/p2.webp', 1, { url: 21 }, 'https://api.marketdino.pl/p1.webp'];

test('Dino: rozpakowanie danych Nuxt i gazetki ze stronami w kolejności', () => {
  assert.equal(rozpakujNuxt(DINO).data['leaflets-list'].standard[0].name, 'Weekendowe okazje');
  const [g] = parsujGazetkiDino(DINO);
  assert.deepEqual([g.id, g.wazne_od, g.wazne_do], ['dino-367-2026-11-20', '2026-11-20', '2026-11-21']);
  assert.deepEqual(g.strony, ['https://api.marketdino.pl/p1.webp', 'https://api.marketdino.pl/p2.webp']);
});

test('pobieranie do folderu pobranych: folder <sieć>_<od>_<do>_<tytuł> ze stronami, bez ponownego pobierania, blokada', async () => {
  const folder = tmp();
  let pobranStron = 0;
  const http = {
    pobierzJson: async url => { assert.equal(url, ZRODLA.dinoDane); return DINO; },
    pobierzTekst: async () => { throw new Error('nieużywane'); },
    pobierzBajty: async url => { pobranStron++; return webp(1000, 1500, url.endsWith('p1.webp') ? 1 : 2); },
  };
  const log = () => {};
  const r1 = await pobierzGazetki({ folder, sieci: ['dino', 'kaufland'], http, dzis: '2026-11-19', log });
  assert.deepEqual(r1.map(x => x.stan ?? 'blad'), ['pobrana', 'blad']);
  const kat = path.join(folder, 'dino', 'dino_2026-11-20_2026-11-21_weekendowe-okazje');
  assert.deepEqual(fs.readdirSync(kat).sort(), ['001.webp', '002.webp', 'zrodlo.json']);
  const z = JSON.parse(fs.readFileSync(path.join(kat, 'zrodlo.json'), 'utf8'));
  assert.deepEqual([z.tytul, z.zrodlo_ref, z.koniec_szacowany], ['Weekendowe okazje', '367', false]);
  // Po zmianie nazwy folderu (poprawione daty) gazetka nadal jest rozpoznana jako pobrana.
  fs.renameSync(kat, path.join(folder, 'dino', 'dino_2026-11-20_2026-11-22_weekendowe-okazje'));
  const r2 = await pobierzGazetki({ folder, sieci: ['dino'], http, dzis: '2026-11-19', log });
  assert.equal(r2[0].stan, 'juz_pobrana');
  assert.equal(pobranStron, 2, 'pobranej gazetki nie pobieramy drugi raz');
  assert.equal((await pobierzGazetki({ folder, sieci: ['dino'], http, dzis: '2026-11-22', log })).length, 0, 'po wygaśnięciu nic');
  const { pobieracz } = await import('../scripts/gazetki/gazetki.mjs');
  const r4 = await pobierzGazetki({ folder: tmp(), sieci: ['dino'], http: pobieracz(async () => ({ status: 403, ok: false }), 0), dzis: '2026-11-19', log });
  assert.match(r4[0].blad, /403 \(blokada\)/);
});

test('dodaj-pobrane z folderu z pobierz: tytuł i źródło z zrodlo.json, daty z nazwy, poprawiony koniec przestaje być szacowany', async () => {
  const folder = tmp(); const archiwum = tmp();
  const kat = path.join(folder, 'biedronka', 'biedronka_2026-11-19_2026-11-25_codziennie-niskie-ceny');
  fs.mkdirSync(kat, { recursive: true });
  fs.writeFileSync(path.join(kat, '001.webp'), webp(1146, 1800, 1));
  const zrodlo = { wersja: 1, siec: 'biedronka', tytul: 'Codziennie niskie ceny P - oferta od 19.11', wazne_od: '2026-11-19', wazne_do: '2026-11-25',
    koniec_szacowany: true, zrodlo_url: 'https://www.biedronka.pl/pl/press,id,j39k145ri,title,x', zrodlo_ref: '86288712' };
  fs.writeFileSync(path.join(kat, 'zrodlo.json'), JSON.stringify(zrodlo));
  const kat2 = path.join(folder, 'biedronka', 'biedronka_2026-11-17_2026-11-22_festiwal');
  fs.mkdirSync(kat2);
  fs.writeFileSync(path.join(kat2, '001.webp'), webp(1146, 1800, 2));
  fs.writeFileSync(path.join(kat2, 'zrodlo.json'), JSON.stringify({ ...zrodlo, tytul: 'Festiwal wędlin od 17.11', wazne_od: '2026-11-17', wazne_do: '2026-11-23', zrodlo_ref: 'b2' }));
  await dodajPobrane({ archiwum, folder, dzis: '2026-11-19', log: () => {} });
  const a = Object.fromEntries(czytajArchiwum(archiwum).map(m => [m.zrodlo_ref, m]));
  assert.deepEqual([a['86288712'].tytul, a['86288712'].koniec_szacowany, a['86288712'].zrodlo_url],
    ['Codziennie niskie ceny P - oferta od 19.11', true, 'https://www.biedronka.pl/pl/press,id,j39k145ri,title,x']);
  assert.deepEqual([a.b2.wazne_do, a.b2.koniec_szacowany], ['2026-11-22', false], 'data poprawiona w nazwie folderu');
});

test('gazetka ręczna z folderu obrazów (kolejność numeryczna) i walidacja parametrów', async () => {
  const archiwum = tmp(); const obrazy = tmp();
  fs.writeFileSync(path.join(obrazy, 'strona-10.png'), png(800, 1200));
  fs.writeFileSync(path.join(obrazy, 'strona-2.png'), png(801, 1200));
  fs.writeFileSync(path.join(obrazy, 'opis.txt'), 'x');
  const m = await dodajRecznie({ archiwum, siec: 'kaufland', tytul: 'Gazetka tygodniowa', od: '2026-11-20', doo: '2026-11-26', zrodlo: 'https://www.kaufland.pl/gazeta', obrazy });
  assert.equal(m.id, 'kaufland-2026-11-20-gazetka-tygodniowa');
  assert.deepEqual(m.strony.map(s => s.szerokosc), [801, 800]);
  await assert.rejects(dodajRecznie({ archiwum, siec: 'kaufland', tytul: 'x', od: '2026-11-27', doo: '2026-11-26', zrodlo: 'https://a.pl', obrazy }), /--od i --do/);
  await assert.rejects(dodajRecznie({ archiwum, siec: 'kaufland', tytul: 'x', od: '2026-11-20', doo: '2026-11-26', zrodlo: 'http://a.pl', obrazy }), /--zrodlo/);
});

// Atrapa klienta Supabase: tabele w pamięci i zapis wywołań Storage.
function atrapa(stan) {
  const storage = { wgrane: [], usuniete: [] };
  const zapytanie = (tabela) => {
    let filtry = []; let operacja = { rodzaj: 'select' };
    const wynik = () => {
      const pasuje = w => filtry.every(([k, op, v]) => (op === 'eq' ? w[k] === v : w[k] < v));
      if (operacja.rodzaj === 'select') {
        const rows = stan[tabela].filter(pasuje).map(w => ({ ...w }));
        if (operacja.kolumny.includes('leaflet_pages(')) for (const w of rows) w.leaflet_pages = stan.leaflet_pages.filter(p => p.leaflet_id === w.id);
        return { data: rows, error: null };
      }
      if (operacja.rodzaj === 'delete') stan[tabela] = stan[tabela].filter(w => !pasuje(w));
      if (operacja.rodzaj === 'update') stan[tabela].filter(pasuje).forEach(w => Object.assign(w, operacja.zmiany));
      return { data: null, error: null };
    };
    const b = {
      select: kolumny => { operacja = { rodzaj: 'select', kolumny }; return b; },
      eq: (k, v) => { filtry.push([k, 'eq', v]); return b; },
      lt: (k, v) => { filtry.push([k, 'lt', v]); return b; },
      delete: () => { operacja = { rodzaj: 'delete' }; return b; },
      update: zmiany => { operacja = { rodzaj: 'update', zmiany }; return b; },
      upsert: async w => { stan[tabela] = stan[tabela].filter(x => x.id !== w.id).concat([{ ...w }]); return { error: null }; },
      insert: async rows => { stan[tabela].push(...rows); return { error: null }; },
      then: (ok, zle) => Promise.resolve(wynik()).then(ok, zle),
    };
    return b;
  };
  return {
    from: zapytanie,
    storage: { from: () => ({
      upload: async p => { storage.wgrane.push(p); return { error: null }; },
      remove: async ps => { storage.usuniete.push(...ps); return { error: null }; },
    }) },
    pliki: storage,
  };
}

test('wgranie: strony do Storage, publikacja po komplecie, ponowne wgranie bez duplikatów; sprzątanie dzień po końcu', async () => {
  const archiwum = tmp(); const folder = tmp();
  const http = { pobierzJson: async () => DINO, pobierzBajty: async url => webp(1000, 1500, url.endsWith('p1.webp') ? 1 : 2) };
  await pobierzGazetki({ folder, sieci: ['dino'], http, dzis: '2026-11-19', log: () => {} });
  await dodajPobrane({ archiwum, folder, dzis: '2026-11-19', log: () => {} });
  const stan = { stores: [{ id: 5, slug: 'dino' }], leaflets: [], leaflet_pages: [] };
  const klient = atrapa(stan);
  const proba = await wgraj({ archiwum, klient: null, proba: true, dzis: '2026-11-19', log: () => {} });
  assert.equal(proba[0].strony, 2);
  await wgraj({ archiwum, klient, dzis: '2026-11-19', log: () => {} });
  assert.equal(stan.leaflets.length, 1);
  assert.deepEqual([stan.leaflets[0].published, stan.leaflets[0].page_count, stan.leaflets[0].store_id], [true, 2, 5]);
  assert.equal(stan.leaflet_pages.length, 2);
  assert.match(stan.leaflet_pages[0].storage_path, /^dino\/dino-2026-11-20-weekendowe-okazje\/001-[0-9a-f]{12}\.webp$/);
  assert.equal(klient.pliki.wgrane.length, 2);
  await wgraj({ archiwum, klient, dzis: '2026-11-19', log: () => {} });
  assert.equal(stan.leaflet_pages.length, 2, 'bez duplikatów stron');
  assert.equal(klient.pliki.wgrane.length, 2, 'te same pliki nie są wgrywane ponownie');
  // Koniec 21.11: 22.11 jeszcze zostaje, 23.11 jest usuwana (dzień po wygaśnięciu).
  assert.equal((await sprzataj({ klient, dzis: '2026-11-22', log: () => {} })).length, 0);
  assert.equal((await sprzataj({ klient, proba: true, dzis: '2026-11-23', log: () => {} })).length, 1);
  assert.equal(stan.leaflets.length, 1, 'próba niczego nie usuwa');
  await sprzataj({ klient, dzis: '2026-11-23', log: () => {} });
  assert.equal(stan.leaflets.length, 0);
  assert.equal(klient.pliki.usuniete.length, 2);
  assert.equal(czytajArchiwum(archiwum).length, 1, 'archiwum lokalne zostaje');
});

test('dostęp: tylko klucz service_role, nigdy klucz publiczny', () => {
  const jwt = rola => `x.${Buffer.from(JSON.stringify({ role: rola })).toString('base64url')}.y`;
  const brak = path.join(tmp(), 'brak.env');
  assert.throws(() => wczytajDostep({ SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_SERVICE_ROLE_KEY: jwt('anon') }, brak), /service_role/);
  assert.throws(() => wczytajDostep({ SUPABASE_URL: 'http://abc.supabase.co', SUPABASE_SERVICE_ROLE_KEY: jwt('service_role') }, brak), /SUPABASE_URL/);
  assert.equal(wczytajDostep({ SUPABASE_URL: 'https://abc.supabase.co/', SUPABASE_SERVICE_ROLE_KEY: jwt('service_role') }, brak).url, 'https://abc.supabase.co');
  assert.equal(wczytajDostep({ SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_abc' }, brak).klucz, 'sb_secret_abc');
});

test('Edge Function: odpowiedź w formacie czytnika, bez wygasłych i niekompletnych gazetek', () => {
  const strona = (n, p) => ({ page_no: n, storage_path: p, width: 1200, height: 1800, mime_type: 'image/jpeg' });
  const wiersze = [
    { id: 'lidl-b', title: 'Gazetka', valid_from: '2026-11-19', valid_to: '2026-11-21', stores: { slug: 'lidl', name: 'Lidl' },
      leaflet_pages: [strona(2, 'l/2.jpg'), strona(1, 'l/1.jpg')] },
    { id: 'stara', title: 'Stara', valid_from: '2026-11-10', valid_to: '2026-11-18', stores: { slug: 'lidl', name: 'Lidl' }, leaflet_pages: [strona(1, 's/1.jpg')] },
    { id: 'dziura', title: 'Bez podpisu', valid_from: '2026-11-19', valid_to: '2026-11-25', stores: { slug: 'dino', name: 'Dino' },
      leaflet_pages: [strona(1, 'd/1.jpg'), strona(2, 'd/2.jpg')] },
    { id: 'biedronka-a', title: 'CNC', valid_from: '2026-11-19', valid_to: '2026-11-25', stores: { slug: 'biedronka', name: 'Biedronka' },
      leaflet_pages: [strona(1, 'b/1.jpg')] },
  ];
  const podpisane = new Map([['l/1.jpg', 'https://s/l1?token=1'], ['l/2.jpg', 'https://s/l2?token=2'], ['s/1.jpg', 'https://s/s1'],
    ['d/1.jpg', 'https://s/d1'], ['b/1.jpg', 'https://s/b1']]);
  const o = zbudujOdpowiedz(wiersze, podpisane, '2026-11-19');
  assert.equal(o.version, 1);
  assert.deepEqual(o.leaflets.map(g => g.id), ['biedronka-a', 'lidl-b']);
  const lidl = o.leaflets[1];
  assert.deepEqual(lidl.chain, { id: 'lidl', name: 'Lidl' });
  assert.deepEqual([lidl.validFrom, lidl.validTo, lidl.format], ['2026-11-19', '2026-11-21', 'images']);
  assert.deepEqual(lidl.pages.map(p => p.url), ['https://s/l1?token=1', 'https://s/l2?token=2']);
  assert.deepEqual(lidl.cover, lidl.pages[0]);
  assert.deepEqual(Object.keys(lidl.pages[0]).sort(), ['height', 'mimeType', 'url', 'width']);
  assert.equal(zbudujOdpowiedz(wiersze, podpisane, '2026-11-22').leaflets.length, 1, 'po 21.11 Lidl znika');
  assert.equal(naglowkiCors('https://app.example', undefined)['Access-Control-Allow-Origin'], '*');
  assert.equal(naglowkiCors('https://app.example', 'https://app.example,https://b.example')['Access-Control-Allow-Origin'], 'https://app.example');
  assert.equal(naglowkiCors('https://zly.example', 'https://app.example')['Access-Control-Allow-Origin'], 'https://app.example');
});

test('nazwy pobranych gazetek: sieć, daty od-do i tytuł z nazwy pliku', () => {
  assert.deepEqual(czytajNazwePobranej('kaufland_2026-11-19_2026-11-25_gazetka-tygodnia.pdf'),
    { siec: 'kaufland', od: '2026-11-19', doo: '2026-11-25', tytul: 'Gazetka tygodnia' });
  assert.deepEqual(czytajNazwePobranej('Carrefour_2026-11-16_2026-11-21.pdf'), { siec: 'carrefour', od: '2026-11-16', doo: '2026-11-21', tytul: 'Gazetka' });
  assert.match(czytajNazwePobranej('Gazetka-tygodnia-19-11-2026-25-11-2026-00.pdf').blad, /nie pasuje do wzoru/);
  assert.match(czytajNazwePobranej('auchan_2026-11-16_2026-11-21.pdf').blad, /nieznana sieć/);
  assert.match(czytajNazwePobranej('kaufland_2026-11-31_2026-12-02.pdf').blad, /niepoprawna data/);
  assert.match(czytajNazwePobranej('kaufland_2026-11-25_2026-11-19.pdf').blad, /późniejsza/);
});

test('dodaj-pobrane: PDF i foldery obrazów z podfolderów, pominięte złe nazwy, bez ponownego dodawania', async () => {
  const archiwum = tmp(); const pobrane = tmp();
  fs.mkdirSync(path.join(pobrane, 'kaufland'));
  fs.writeFileSync(path.join(pobrane, 'kaufland', 'kaufland_2026-11-19_2026-11-25_gazetka-tygodnia.pdf'), '%PDF');
  fs.writeFileSync(path.join(pobrane, 'kaufland', 'Gazetka-tygodnia-19-11-2026-25-11-2026-00.pdf'), '%PDF');
  const strony = path.join(pobrane, 'carrefour_2026-11-16_2026-11-21_gazetka');
  fs.mkdirSync(strony);
  fs.writeFileSync(path.join(strony, '2.png'), png(900, 1400));
  fs.writeFileSync(path.join(strony, '1.png'), png(901, 1400));
  let konwersji = 0;
  const konwerterPdf = async () => { konwersji++; return [{ bufor: webp(1240, 1750, 1) }, { bufor: webp(1240, 1750, 2) }]; };
  const log = () => {};
  const r1 = await dodajPobrane({ archiwum, folder: pobrane, dzis: '2026-11-22', konwerterPdf, log });
  const wg = Object.fromEntries(r1.map(x => [x.plik, x]));
  assert.equal(wg['kaufland_2026-11-19_2026-11-25_gazetka-tygodnia.pdf'].stan, 'dodana');
  assert.equal(wg['kaufland_2026-11-19_2026-11-25_gazetka-tygodnia.pdf'].strony, 2);
  assert.equal(wg['carrefour_2026-11-16_2026-11-21_gazetka'].stan, 'dodana');
  assert.match(wg['carrefour_2026-11-16_2026-11-21_gazetka'].uwaga, /wygasła/);
  assert.equal(wg['Gazetka-tygodnia-19-11-2026-25-11-2026-00.pdf'].stan, 'pominiety');
  const arch = Object.fromEntries(czytajArchiwum(archiwum).map(m => [m.id, m]));
  const k = arch['kaufland-2026-11-19-gazetka-tygodnia'];
  assert.deepEqual([k.tytul, k.wazne_od, k.wazne_do, k.zrodlo_url], ['Gazetka tygodnia', '2026-11-19', '2026-11-25', 'https://www.kaufland.pl/gazeta-reklamowa.html']);
  assert.deepEqual(arch['carrefour-2026-11-16-gazetka'].strony.map(x => x.szerokosc), [901, 900]);
  const r2 = await dodajPobrane({ archiwum, folder: pobrane, dzis: '2026-11-22', konwerterPdf, log });
  assert.equal(r2.filter(x => x.stan === 'juz_w_archiwum').length, 2);
  assert.equal(konwersji, 1, 'raz dodany PDF nie jest przetwarzany ponownie');
});
