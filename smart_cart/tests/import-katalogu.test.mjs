import test from 'node:test';
import assert from 'node:assert/strict';
import { pozycjeZObserwacji, regulaPromocji, sqlImportu } from '../scripts/import/import-katalogu.mjs';
import { obserwacjaAntonka, obserwacjaKodyzbiedry, obserwacjaTanszykoszyk } from '../scripts/import/zrodla.mjs';

const tanszy = (pola, siec = 'lidl') => obserwacjaTanszykoszyk({ id_zrodla: pola.id ?? 'x', link_zrodla: '/produkt/x', ostatnio_widziane: '2026-11-18T18:00:00Z',
  wazne_od: '2026-11-17', wazne_do: '2026-11-21', gramatura: '1l', ...pola }, siec);

test('reguły promocji: tylko wierne odwzorowanie, inaczej brak automatycznego naliczania', () => {
  const baza = { kwota: 2.99, wazne_do: '2026-11-21', szacowana: false, mieszanie_produktow: false, karta_lub_aplikacja: false, warunek: '' };
  assert.deepEqual(regulaPromocji({ ...baza, typ: 'obniżka' }), { kind: 'unit' });
  assert.deepEqual(regulaPromocji({ ...baza, typ: 'przy zakupie 2', karta_lub_aplikacja: true, warunek: 'z kartą; limit dzienny 6 szt. na kartę' }),
    { kind: 'min_quantity', min_quantity: 2, max_discount_quantity: 6, requires_card: true });
  assert.deepEqual(regulaPromocji({ ...baza, typ: 'supercena', warunek: 'aktywuj kupon w aplikacji', karta_lub_aplikacja: true }),
    { kind: 'unit', requires_card: true, requires_activation: true });
  for (const zla of [{ typ: 'drugi 50% taniej' }, { typ: '2+1 gratis' }, { typ: 'obniżka', mieszanie_produktow: true },
    { typ: 'obniżka', szacowana: true }, { typ: 'obniżka', wazne_do: null }, { typ: 'obniżka', kwota: null }, { typ: 'przy zakupie 1' }]) {
    assert.equal(regulaPromocji({ ...baza, ...zla }), null, JSON.stringify(zla));
  }
});

test('scalanie obserwacji: ta sama pozycja z kilku źródeł, najnowsza cena regularna, gazetka nie jest regularną', () => {
  const obs = [
    obserwacjaAntonka({ nazwa: 'Mleko UHT 3,2% Łaciate 1l', cena: '3.49', ilosc_gramatura: '1l', data_obserwacji: '2026-11-01' }, 'carrefour', true),
    obserwacjaAntonka({ id_zewnetrzne: 'carrefour_1', nazwa: 'Mleko UHT 3,2% Łaciate 1l', cena: '3.69', ilosc_gramatura: '1 l',
      ostatnia_aktualizacja: '2026-11-16T10:00:00Z' }, 'carrefour'),
    tanszy({ nazwa: 'Mleko UHT 3,2% Pilos', cena_promocyjna: '2.25', typ_promocji: 'obniżka', cena_regularna: '2.99' }),
    obserwacjaKodyzbiedry({ ean: '5900000000017', nazwa: 'Mleko UHT 3,2% Łaciate 1 l', cena: '3.79', cena_widziana: '2026-11-18T18:00:00Z' }),
    obserwacjaKodyzbiedry({ ean: '5900000000024', nazwa: 'Płyn do naczyń 500 ml', cena: '5.99', cena_widziana: '2026-11-18T18:00:00Z' }),
  ];
  const { pozycje, pominiete } = pozycjeZObserwacji(obs);
  assert.equal(pominiete.brak_produktu_bazowego, 1);
  const carrefour = pozycje.find(p => p.siec === 'carrefour');
  assert.equal(pozycje.filter(p => p.siec === 'carrefour').length, 1);
  assert.equal(carrefour.cena_regularna, 3.69);
  assert.equal(carrefour.obserwacja_regularnej, '2026-11-16');
  assert.equal(carrefour.zrodla.length, 2);
  const lidl = pozycje.find(p => p.siec === 'lidl');
  assert.equal(lidl.cena_regularna, null);
  assert.equal(lidl.promocja.kwota, 2.25);
  assert.equal(lidl.promocja.zasieg, 'nationwide');
  assert.equal(lidl.promocja.dowod, 'https://tanszykoszyk.pl/produkt/x');
  assert.equal(lidl.produkt_bazowy, 'Mleko UHT 3,2%');
  const biedronka = pozycje.find(p => p.siec === 'biedronka');
  assert.equal(biedronka.ean, '5900000000017');
  assert.equal(biedronka.zrodlo_ceny, 'kodyzbiedry');
});

test('promocja nie niższa od regularnej jest odrzucana, cena szacowana nie jest naliczana', () => {
  const { pozycje, pominiete } = pozycjeZObserwacji([
    tanszy({ nazwa: 'Mleko UHT 3,2% A', cena_promocyjna: '3.99', typ_promocji: 'obniżka', warunek: 'cena poza promocją: 3,69 zł' }),
    tanszy({ id: 'y', nazwa: 'Mleko UHT 3,2% B', cena_promocyjna: '2.49', typ_promocji: 'obniżka', cena_szacowana: 'tak' }),
  ]);
  assert.equal(pominiete.promocja_nie_nizsza_od_regularnej, 1);
  assert.equal(pozycje.find(p => p.nazwa.endsWith(' A')).promocja, null);
  const b = pozycje.find(p => p.nazwa.endsWith(' B')).promocja;
  assert.equal(b.status, 'estymowana');
  assert.equal(b.zasieg, 'unknown');
});

test('SQL: tryb próbny kończy się ROLLBACK, teksty są bezpiecznie cytowane', () => {
  const { pozycje } = pozycjeZObserwacji([obserwacjaKodyzbiedry({ ean: '5900000000017', nazwa: "Mleko UHT 3,2% O'Reilly 1 l", cena: '3.79', cena_widziana: '2026-11-18T18:00:00Z' })]);
  const proba = sqlImportu(pozycje);
  assert.match(proba, /ROLLBACK;/);
  assert.doesNotMatch(proba, /COMMIT;/);
  assert.match(proba, /O''Reilly/);
  assert.match(sqlImportu(pozycje, { tryb: 'zapis' }), /COMMIT;/);
  assert.throws(() => sqlImportu(pozycje, { tryb: 'inny' }));
});

test('SQL: migrację można dołączyć tylko do próby i bez własnych transakcji', () => {
  const { pozycje } = pozycjeZObserwacji([obserwacjaKodyzbiedry({ ean: '5900000000017', nazwa: 'Mleko UHT 3,2% 1 l', cena: '3.79', cena_widziana: '2026-11-18T18:00:00Z' })]);
  const sql = sqlImportu(pozycje, { migracja: 'ALTER TABLE public.categories ADD COLUMN x text;' });
  assert.ok(sql.indexOf('ADD COLUMN x') > sql.indexOf('BEGIN;') && sql.indexOf('ADD COLUMN x') < sql.indexOf('ROLLBACK;'));
  assert.throws(() => sqlImportu(pozycje, { tryb: 'zapis', migracja: 'SELECT 1;' }), /tylko do próby/);
  assert.throws(() => sqlImportu(pozycje, { migracja: 'BEGIN;\nSELECT 1;' }), /BEGIN/);
});

test('podgląd CSV: pozycje z kategorią i pominięte z powodem', async () => {
  const { podgladCsv } = await import('../scripts/import/import-katalogu.mjs');
  const { pozycje, listaPominietych } = pozycjeZObserwacji([
    obserwacjaKodyzbiedry({ ean: '5900000000017', nazwa: 'Mleko UHT 3,2% "Łaciate" 1 l', cena: '3.79', cena_widziana: '2026-11-18T18:00:00Z', utworzono_zrodlo: '2026-03-13' }),
    obserwacjaKodyzbiedry({ ean: '5900000000024', nazwa: 'Płyn do naczyń 500 ml', cena: '5.99', cena_widziana: '2026-11-18T18:00:00Z' }),
  ]);
  const { doBazy, pominiete } = podgladCsv(pozycje, listaPominietych);
  assert.match(doBazy, /^﻿siec;kategoria;/);
  assert.match(doBazy, /biedronka;Nabiał;Mleko UHT 3,2%;"Mleko UHT 3,2% ""Łaciate"" 1 l";5900000000017;5900000000017;1000 ml;package;3,79;2026-03-13;kodyzbiedry;;/);
  assert.match(pominiete, /brak_produktu_bazowego;biedronka;kodyzbiedry;Płyn do naczyń 500 ml;5,99/);
});

test('rozszerzenie słownika: każda reguła ma produkt bazowy w migracji, alkohol jest wykluczony', async () => {
  const fs = await import('node:fs');
  const { ROZSZERZENIE, produktBazowy } = await import('../scripts/import/slownik.mjs');
  const migracja = fs.readFileSync(new URL('../supabase/migrations/20261119000100_extended_base_products.sql', import.meta.url), 'utf8');
  for (const r of ROZSZERZENIE) assert.ok(migracja.includes(`('${r.nazwa.replace(/'/g, "''")}', '${r.kategoria}',`), r.nazwa);
  for (const n of ['Piwo Tyskie 0,5 l', 'Piwo bezalkoholowe 0,0%', 'WÓDKA ŻUREK ŻYTNI 40% 0,5 l', 'BROWAR FORTUNA Komes Porter Malinowy', 'Wino czerwone 0,75 l'])
    assert.equal(produktBazowy(n), null, n);
  assert.equal(produktBazowy('OCET Z WINA 500ml')?.kategoria, 'Tłuszcze i Przetwory');
  assert.equal(produktBazowy('NAPÓJ BEZALKOHOLOWY 0,5l')?.kategoria, 'Napoje');
  assert.equal(produktBazowy('Kupiec Fasola biała drobna 400 g')?.nazwa === 'Pozostały drób', false);
});

test('piwo rozpoznane po marce nie trafia do bazy, a woda Żywiec Zdrój tak', async () => {
  const { produktBazowy } = await import('../scripts/import/slownik.mjs');
  for (const n of ['Lech Premium 0,5 l', 'Tyskie Gronie puszka 0,5l', 'Żubr 4x0,5l']) assert.equal(produktBazowy(n), null, n);
  assert.equal(produktBazowy('Żywiec Zdrój woda niegazowana 1,5 l')?.kategoria, 'Napoje');
});

test('limit 25 na sieć i produkt bazowy: priorytet ceny i daty, produkty koszykowe bez limitu', async () => {
  const { zastosujLimit, BEZ_LIMITU } = await import('../scripts/import/import-katalogu.mjs');
  const p = (siec, bazowy, i, extra = {}) => ({ siec, produkt_bazowy: bazowy, nazwa: `P${String(i).padStart(3, '0')}`, cena_regularna: 1,
    obserwacja_regularnej: '2026-11-01', ilosc: { value: 1, unit: 'szt' }, ean: null, zdjecie: null, ...extra });
  const czipsy = Array.from({ length: 30 }, (_, i) => p('biedronka', 'Chipsy ziemniaczane', i));
  czipsy[29].obserwacja_regularnej = '2026-11-18';
  czipsy[28].cena_regularna = null;
  const mleko = Array.from({ length: 40 }, (_, i) => p('biedronka', 'Mleko UHT 3,2%', i));
  const lidl = Array.from({ length: 30 }, (_, i) => p('lidl', 'Chipsy ziemniaczane', i));
  assert.ok(BEZ_LIMITU.has('Mleko UHT 3,2%'));
  assert.equal(zastosujLimit([...czipsy, ...mleko, ...lidl], 25), 10);
  assert.equal(czipsy.filter(x => !x.poza_limitem).length, 25);
  assert.equal(czipsy[29].poza_limitem, false); // najnowsza cena wygrywa
  assert.equal(czipsy[28].poza_limitem, true);  // brak ceny regularnej przegrywa
  assert.ok(mleko.every(x => !x.poza_limitem));
  assert.equal(lidl.filter(x => x.poza_limitem).length, 5);
});

test('duble: kilka EAN pod jedną nazwą, nazwa z ilością i bez, identyczna nazwa z inną gramaturą w polu', () => {
  const kody = (ean, cena) => obserwacjaKodyzbiedry({ ean, nazwa: 'ALPRO JOG. SOJOWY KOKOS 400g', cena, cena_widziana: '2026-11-18T18:00:00Z' });
  const { pozycje } = pozycjeZObserwacji([
    kody('5411188138051', '6.00'), kody('5411188099154', '6.00'), kody('5411188119098', '5.49'),
    obserwacjaAntonka({ nazwa: 'Awokado Hass', cena: '3.99', ilosc_gramatura: '1 szt', data_obserwacji: '2026-11-01' }, 'carrefour', true),
    obserwacjaAntonka({ nazwa: 'Awokado Hass 1 szt.', cena: '4.29', ilosc_gramatura: '', data_obserwacji: '2026-11-10' }, 'carrefour', true),
    obserwacjaAntonka({ nazwa: 'Barilla Makaron Spaghetti 400 g', cena: '7.99', ilosc_gramatura: '500 g', data_obserwacji: '2026-11-10' }, 'carrefour', true),
    obserwacjaAntonka({ nazwa: 'Barilla Makaron Spaghetti 400 g', cena: '8.49', ilosc_gramatura: '400 g', data_obserwacji: '2026-11-12' }, 'carrefour', true),
    obserwacjaAntonka({ nazwa: 'Mleko UHT 2% Łaciate 1 l', cena: '3.49', ilosc_gramatura: '1 l', data_obserwacji: '2026-11-12' }, 'carrefour', true),
    obserwacjaAntonka({ nazwa: 'Mleko UHT 3,2% Łaciate 1 l', cena: '3.69', ilosc_gramatura: '1 l', data_obserwacji: '2026-11-12' }, 'carrefour', true),
  ]);
  const alpro = pozycje.filter(p => p.siec === 'biedronka');
  assert.equal(alpro.length, 1);
  assert.deepEqual(alpro[0].eany, ['5411188099154', '5411188119098', '5411188138051']);
  assert.equal(alpro[0].ean, '5411188099154');
  assert.equal(alpro[0].cena_regularna, 6, 'przy tej samej dacie cena najczęstsza');
  const awokado = pozycje.filter(p => p.nazwa.startsWith('Awokado'));
  assert.equal(awokado.length, 1);
  assert.equal(awokado[0].cena_regularna, 4.29);
  assert.equal(pozycje.filter(p => p.nazwa.startsWith('Mleko')).length, 2, 'mleko 2% i 3,2% to różne produkty');
  const barilla = pozycje.filter(p => p.nazwa.startsWith('Barilla'));
  assert.equal(barilla.length, 1);
  assert.equal(barilla[0].cena_regularna, 8.49);
  assert.deepEqual(barilla[0].ilosc, { value: 400, unit: 'g' }, 'ilość z nazwy ma pierwszeństwo przed polem');
});

test('rdzeń nazwy: bez ilości opakowania, procenty i typ mąki zostają', async () => {
  const { rdzenNazwy } = await import('../scripts/import/normalizacja.mjs');
  assert.equal(rdzenNazwy('Awokado Hass 1 szt.'), rdzenNazwy('Awokado Hass'));
  assert.equal(rdzenNazwy('KASZA BULGUR PLONY NATURY 4X100 g'), rdzenNazwy('Kasza bulgur Plony Natury 400g'));
  assert.equal(rdzenNazwy('GROCH ŁUSKANY PLONY NATURY 0,5 kg'), 'groch luskany plony natury');
  assert.notEqual(rdzenNazwy('Mleko 2% 1l'), rdzenNazwy('Mleko 3,2% 1l'));
  assert.notEqual(rdzenNazwy('Mąka pszenna typ 450 1 kg'), rdzenNazwy('Mąka pszenna typ 650 1kg'));
});

test('SQL: sprzątanie tylko na żądanie, z blokadą list zakupów', () => {
  const { pozycje } = pozycjeZObserwacji([tanszy({ nazwa: 'Mleko UHT 3,2% Pilos 1l', cena_promocyjna: '2.25', typ_promocji: 'obniżka' })]);
  assert.doesNotMatch(sqlImportu(pozycje), /DELETE FROM/);
  const s = sqlImportu(pozycje, { sprzatanie: true });
  assert.match(s, /Sprzątanie przerwane/);
  assert.match(s, /DELETE FROM public\.store_offers/);
  assert.ok(s.indexOf('Sprzątanie przerwane') < s.indexOf('DELETE FROM public.store_offers'), 'blokada przed usuwaniem');
  assert.match(s, /ROLLBACK;/);
});

test('wyliczanie cen: cena regularna wyliczona z promocji tylko z opcją, z oznaczeniem źródła', async () => {
  const { podgladCsv } = await import('../scripts/import/import-katalogu.mjs');
  const tk = (nazwa, w) => obserwacjaTanszykoszyk({ nazwa, marka: '', gramatura: '', jednostka: 'szt', id_zrodla: nazwa, link_zrodla: '/produkt/x',
    wazne_od: '2026-11-20', wazne_do: '2026-11-26', ostatnio_widziane: '2026-11-21T10:00:00Z', ...w }, 'lidl');
  // 12 par do nauki współczynnika (promocja 8,00 przy cenie "przed obniżką" 10,00 -> 0,8)
  const pary = Array.from({ length: 12 }, (_, i) => tk(`Mleko UHT 3,2% Test ${i} 1 l`, { cena_promocyjna: '8.00', typ_promocji: 'obniżka', cena_regularna: '10.00', etykieta_ceny: 'przed_obnizka' }));
  const bez = tk('Mleko UHT 3,2% Bez Ceny 1 l', { cena_promocyjna: '2.40', typ_promocji: 'supercena' });
  const gratis = tk('Mleko UHT 3,2% Gratis 1 l', { cena_promocyjna: '2.00', typ_promocji: '1+1 gratis' });
  const procent = tk('Mleko UHT 3,2% Procent 1 l', { cena_promocyjna: '3.00', typ_promocji: 'przy zakupie 2 szt -25%' });
  const obs = [...pary, bez, gratis, procent];
  const domyslnie = pozycjeZObserwacji(obs).pozycje.find(p => /Bez Ceny/.test(p.nazwa));
  assert.equal(domyslnie.cena_regularna, null, 'bez opcji cen nie wyliczamy');
  const { pozycje, wyliczenia } = pozycjeZObserwacji(obs, { regularneZPromocji: true });
  const znajdz = n => pozycje.find(p => p.nazwa.includes(n));
  assert.equal(znajdz('Bez Ceny').cena_regularna, 3, 'współczynnik 0,8: 2,40 / 0,8');
  assert.equal(znajdz('Bez Ceny').zrodlo_ceny, 'wyliczona_z_promocji');
  assert.equal(znajdz('Bez Ceny').obserwacja_regularnej, '2026-11-21');
  assert.match(znajdz('Bez Ceny').wyliczenie, /^wspolczynnik lidl\|jednostkowa 0\.8$/);
  assert.equal(znajdz('Gratis').cena_regularna, 4, '1+1 gratis: 2 × 2,00');
  assert.equal(znajdz('Procent').cena_regularna, 4, '-25%: 3,00 / 0,75');
  // Cena "przed obniżką" nie jest przepisywana jako regularna; pozycja dostaje cenę wyliczoną tak samo jak inne.
  assert.equal(znajdz('Test 0').zrodlo_ceny, 'wyliczona_z_promocji');
  assert.equal(znajdz('Test 0').cena_regularna, 10);
  assert.equal(wyliczenia.wspolczynniki['lidl|jednostkowa'].par, 12);
  assert.match(podgladCsv(pozycje, []).doBazy, /3;2026-11-21;wyliczona_z_promocji;wspolczynnik lidl\|jednostkowa 0\.8;2,4/);
});

test('wyliczanie cen: wzory mechaniki promocji', async () => {
  const { zMechaniki, rodzajPromocji } = await import('../scripts/import/wyliczanie.mjs');
  assert.equal(zMechaniki(2, '2+1 gratis').kwota, 3);
  assert.equal(zMechaniki(4, 'drugi 50% taniej').kwota.toFixed(2), '5.33');
  assert.equal(zMechaniki(3, 'drugi za 1 zł').kwota, 5);
  assert.equal(zMechaniki(1.505, '1+1 za grosz').kwota, 3);
  assert.equal(zMechaniki(7.5, 'obniżka', 'rabat 25% przy kasie').kwota, 10);
  assert.equal(zMechaniki(2, 'supercena'), null);
  assert.equal(zMechaniki(2, 'drugi za 5 zł'), null, 'druga sztuka droższa od ceny promocyjnej: brak wzoru');
  assert.equal(rodzajPromocji('przy zakupie 3'), 'przy_zakupie');
  assert.equal(rodzajPromocji('Supercena'), 'jednostkowa');
});
