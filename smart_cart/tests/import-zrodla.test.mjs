import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cena, cenaPozaPromocja, cenaZaWage, ilosc, normTekst, warunkiPromocji } from '../scripts/import/normalizacja.mjs';
import { obserwacjaAntonka, obserwacjaKodyzbiedry, obserwacjaTanszykoszyk, parsujCsv, wczytajZrodla } from '../scripts/import/zrodla.mjs';
import { czyMleko } from '../scripts/import/analiza.mjs';

test('ilość opakowania: jednostki, przecinki, wielopaki, masa brutto, procenty', () => {
  assert.deepEqual(ilosc('1l'), { value: 1000, unit: 'ml' });
  assert.deepEqual(ilosc('1 L'), { value: 1000, unit: 'ml' });
  assert.deepEqual(ilosc('0,3 kg'), { value: 300, unit: 'g' });
  assert.deepEqual(ilosc('Mleko UHT 3,2% 1 l'), { value: 1000, unit: 'ml' });
  assert.deepEqual(ilosc('4x100g'), { value: 400, unit: 'g', opakowania: 4 });
  assert.deepEqual(ilosc('(4 x 82,5 g)'), { value: 330, unit: 'g', opakowania: 4 });
  assert.deepEqual(ilosc('6x1,5l'), { value: 9000, unit: 'ml', opakowania: 6 });
  assert.deepEqual(ilosc('185/130g'), { value: 185, unit: 'g' });
  assert.deepEqual(ilosc('10 szt.'), { value: 10, unit: 'szt' });
  assert.deepEqual(ilosc('5 dag'), { value: 50, unit: 'g' });
  for (const brak of ['', 'Mleko 3.2% Pilos', '1 zestaw', 'kg', '10rolek', 'Mleko 1 laktoza']) assert.equal(ilosc(brak), null, brak);
});

test('ilość po kropce skrótu w nazwie (SPIŻ.340/285g)', () => {
  assert.deepEqual(ilosc('KUKURYDZA SŁODKA NASZA SPIŻ.340/285g'), { value: 340, unit: 'g' });
  assert.deepEqual(ilosc('Mleko 1.5l'), { value: 1500, unit: 'ml' });
});

test('cena za wagę tylko z jednoznacznych oznaczeń', () => {
  assert.deepEqual(cenaZaWage('Cytryna kg'), { value: 1000, unit: 'g' });
  assert.deepEqual(cenaZaWage('Szynka', '100g'), { value: 100, unit: 'g' });
  assert.deepEqual(cenaZaWage('Banany', 'kg'), { value: 1000, unit: 'g' });
  assert.equal(cenaZaWage('Kiełbasa krakowska'), null);
});

test('ceny i teksty', () => {
  assert.equal(cena('4,39 zł'), 4.39);
  assert.equal(cena('3.99'), 3.99);
  for (const zla of ['', null, '0', '-1', 'Brak ceny', 'abc']) assert.equal(cena(zla), null);
  assert.equal(normTekst('Mleko ŁACIATE 3,2%'), 'mleko laciate 3 2%');
  assert.equal(cenaPozaPromocja('z kartą Moja Biedronka; cena za 1 szt. poza promocją: 3,69 zł'), 3.69);
  assert.equal(cenaPozaPromocja('przy zakupie 2 szt.'), null);
  const w = warunkiPromocji('z kartą Moja Biedronka lub aplikacją; mieszaj dowolnie; limit dzienny 9 szt.');
  assert.deepEqual(w, { karta_lub_aplikacja: true, mieszanie_produktow: true, limit: true });
  assert.deepEqual(warunkiPromocji('obniżka'), { karta_lub_aplikacja: false, mieszanie_produktow: false, limit: false });
});

test('CSV z Pythona: BOM, cudzysłowy, średniki i nowe linie w polu', () => {
  const wiersze = parsujCsv('﻿a;b;c\r\n1;"x;y";"z ""q"""\r\n2;"wiele\nlinii";\r\n');
  assert.deepEqual(wiersze, [{ a: '1', b: 'x;y', c: 'z "q"' }, { a: '2', b: 'wiele\nlinii', c: '' }]);
  assert.throws(() => parsujCsv('a;b\n1;2;3\n'), /pól/);
});

test('antonka: cena z okresem to oferta okresowa, Carrefour bez okresu to cena regularna, reszta nieokreślona', () => {
  const lidl = obserwacjaAntonka({ id_zewnetrzne: 'lidl_1', nazwa: 'Mleko UHT 3,2%', cena: '2.25', ilosc_gramatura: '1l',
    wazne_do: '18.11.', wazne_do_iso: '2026-11-18', ostatnia_aktualizacja: '2026-11-15T07:00:00Z' }, 'lidl');
  assert.equal(lidl.cena_regularna, null);
  assert.equal(lidl.oferta_okresowa.kwota, 2.25);
  assert.equal(lidl.oferta_okresowa.wazne_do, '2026-11-18');
  assert.equal(lidl.klucz_zrodla, 'antonka:lidl:ext:lidl_1');
  const carrefour = obserwacjaAntonka({ nazwa: 'Mleko 2% 1 l', cena: '3.49', ilosc_gramatura: '1 l', wazne_do: '', data_obserwacji: '2026-11-16' }, 'carrefour', true);
  assert.deepEqual(carrefour.cena_regularna, { kwota: 3.49, obserwacja: '2026-11-16', podstawa: 'sklep_internetowy_bez_okresu' });
  assert.equal(carrefour.zrodlo, 'antonka_historia');
  const dino = obserwacjaAntonka({ nazwa: 'Masło', cena: '6.99', wazne_do: '', data_obserwacji: '2026-11-01' }, 'dino', true);
  assert.equal(dino.cena_regularna, null);
  assert.deepEqual(dino.cena_nieokreslona, { kwota: 6.99, obserwacja: '2026-11-01' });
  assert.ok(dino.uwagi.includes('typ_ceny_nieznany'));
});

test('tanszykoszyk: pole regular_price nie jest ceną regularną; regularna tylko z opisu "poza promocją"', () => {
  const mleko = obserwacjaTanszykoszyk({ id_zrodla: 'u1', nazwa: 'Mleko UHT 3,2%', marka: 'Mlekovita', gramatura: '1l',
    cena_regularna: '1.99', cena_promocyjna: '1.98', typ_promocji: 'przy zakupie 6',
    warunek: 'z kartą Moja Biedronka lub aplikacją; cena za 1 szt. poza promocją: 3,69 zł',
    wazne_od: '2026-11-17', wazne_do: '2026-11-21', etykieta_ceny: 'przed_obnizka', ostatnio_widziane: '2026-11-18T18:15:13Z' }, 'biedronka');
  assert.deepEqual(mleko.cena_regularna, { kwota: 3.69, obserwacja: '2026-11-18', podstawa: 'opis_promocji_poza_promocja' });
  assert.equal(mleko.oferta_okresowa.kwota, 1.98);
  assert.equal(mleko.oferta_okresowa.karta_lub_aplikacja, true);
  assert.equal(mleko.oferta_okresowa.cena_odniesienia, 1.99);
  assert.deepEqual(mleko.ilosc, { value: 1000, unit: 'ml' });
  const supercena = obserwacjaTanszykoszyk({ nazwa: 'Mleko w proszku', gramatura: '500g', cena_promocyjna: '14.99', typ_promocji: 'supercena', cena_regularna: '' }, 'biedronka');
  assert.equal(supercena.cena_regularna, null);
  const odniesienie = obserwacjaTanszykoszyk({ nazwa: 'Ser', gramatura: '100g', cena_regularna: '5.99', cena_promocyjna: '3.99', typ_promocji: 'obniżka' }, 'lidl');
  assert.equal(odniesienie.cena_regularna, null);
  assert.ok(odniesienie.uwagi.includes('cena_odniesienia_nie_jest_regularna'));
});

test('kodyzbiedry: EAN jest kluczem, datą ceny jest data wpisu w źródle, nie nasze pobranie', () => {
  const w = { ean: '5900820000011', nazwa: 'Mleko Łaciate 2% 1 l', cena: '3.79', cena_widziana: '2026-11-18T18:15:40Z', utworzono_zrodlo: '2026-02-10' };
  const o = obserwacjaKodyzbiedry(w);
  assert.equal(o.klucz_zrodla, 'kodyzbiedry:biedronka:ean:5900820000011');
  assert.equal(o.ean, '5900820000011');
  assert.deepEqual(o.cena_regularna, { kwota: 3.79, obserwacja: '2026-02-10', podstawa: 'katalog_dodanie_wpisu' });
  assert.deepEqual(obserwacjaKodyzbiedry({ ...w, aktualizacja_zrodla: '2026-05-04' }).cena_regularna,
    { kwota: 3.79, obserwacja: '2026-05-04', podstawa: 'katalog_aktualizacja_wpisu' });
  const bezDaty = obserwacjaKodyzbiedry({ ...w, utworzono_zrodlo: '' });
  assert.equal(bezDaty.cena_regularna.obserwacja, null, 'bez daty w źródle nie wstawiamy dnia pobrania');
  assert.ok(bezDaty.uwagi.includes('brak_daty_obserwacji'));
  assert.equal(obserwacjaKodyzbiedry({ ean: 'abc', nazwa: 'X', cena: '1' }).ean, null);
});

test('rozpoznawanie mleka do raportu etapu', () => {
  for (const tak of ['Mleko UHT 3,2% Łaciate 1l', 'Mleko spożywcze 2% Pilos', 'MLEKO BEZ LAKT. 1,5%MLECZNA DOLINA 1 l']) assert.ok(czyMleko(tak), tak);
  for (const nie of ['Mleko w proszku pełne', 'Bebilon 2 Mleko następne', 'Mleko kokosowe', 'Śmietana 12% Mlekovita', 'Mleko zagęszczone']) assert.ok(!czyMleko(nie), nie);
});

test('wczytanie folderu danych: pomija pliki starszych wersji i liczy sumy kontrolne', () => {
  const dane = fs.mkdtempSync(path.join(os.tmpdir(), 'import-'));
  const zapisz = (p, t) => { fs.mkdirSync(path.dirname(path.join(dane, p)), { recursive: true }); fs.writeFileSync(path.join(dane, p), '﻿' + t); };
  zapisz('zrodla_v2/antonka/lidl.csv', 'id_zewnetrzne;nazwa;cena;ilosc_gramatura;wazne_do;wazne_do_iso;ostatnia_aktualizacja;widoczny_w_ostatnim_pobraniu\nlidl_1;Mleko;2.25;1l;18.11.;2026-11-18;2026-11-15T07:00:00Z;tak\n');
  zapisz('zrodla_v2/antonka/lidl.stara-wersja-2026.csv', 'nazwa;cena\nStare;1\n');
  zapisz('zrodla_v2/kodyzbiedry/produkty_biedronka_all.csv', 'ean;nazwa;cena;cena_widziana\n5900000000001;Ser;5.99;2026-11-18T18:00:00Z\n');
  const { obserwacje, pliki } = wczytajZrodla(dane);
  assert.equal(obserwacje.length, 2);
  assert.equal(pliki.length, 2);
  assert.match(pliki[0].sha256, /^[0-9a-f]{64}$/);
  fs.rmSync(dane, { recursive: true, force: true });
});

test('słownik produktów bazowych: spożywcze przechodzą, niespożywcze nie', async () => {
  const { produktBazowy } = await import('../scripts/import/slownik.mjs');
  assert.equal(produktBazowy('Mleko UHT 3,2% Łaciate 1l')?.nazwa, 'Mleko UHT 3,2%');
  assert.equal(produktBazowy('KREM DO SMAROWANIA NUTELLA 350g')?.kategoria, 'Tłuszcze i Przetwory');
  for (const nie of ['WORKI MAGNUM FLEX JAN NIEZB. 35L 12 szt.', 'Płyn do naczyń 500 ml', 'Woda perfumowana damska Elissé',
    'MUS DAWTONA HALLOWEN MIX 4x100G+ZABAWKA', 'Proszek do prania 1 kg', 'Karma dla kota 85 g']) assert.equal(produktBazowy(nie), null, nie);
});
