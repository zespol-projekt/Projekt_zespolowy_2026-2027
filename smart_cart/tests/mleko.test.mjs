import test from 'node:test';
import assert from 'node:assert/strict';
import { czytajTekst, decyzja, parsujCsv, sqlPrzegladu } from '../scripts/mleko/przeglad-mleka.mjs';

const CSV = '﻿produkt_id;sieci;nazwa;ml;ean;cena;tluszcz;laktoza;rodzaj;uwagi\n'
  + '101;biedronka;"MLEKO ŁOWICKIE 3,2% EKO KARTON 1 l";1000;590;2,75;3,2;z laktozą;UHT;"sprawdzone na stronie; karton"\n'
  + '102;carrefour;Mlekovita Wydojone mleko bez laktozy 2% tł. 1l;1000;;6,15;2;bez laktozy;świeże;\n'
  + '103;biedronka;MLEKO SMAK. MIX;1000;;4,99;;z laktozą;pomiń;smakowe\n'
  + '104;kaufland;Mleko polskie 3,2%;1000;;;3,2;z laktozą;;\n';

test('lista przeglądu: CSV ze średnikami, cudzysłowami i BOM; kodowanie Windows-1250 z Excela', () => {
  const w = parsujCsv(czytajTekst(Buffer.from(CSV, 'utf8')));
  assert.equal(w.length, 4);
  assert.equal(w[0].uwagi, 'sprawdzone na stronie; karton');
  assert.equal(w[0].nazwa, 'MLEKO ŁOWICKIE 3,2% EKO KARTON 1 l');
  const cp1250 = Buffer.from([0x72, 0x6f, 0x64, 0x7a, 0x61, 0x6a, 0x0a, 0x9c, 0x77, 0x69, 0x65, 0xbf, 0x65, 0x0a]); // "rodzaj\nświeże\n"
  assert.deepEqual(parsujCsv(czytajTekst(cp1250)), [{ rodzaj: 'świeże' }]);
});

test('decyzje: UHT/świeże/pomiń, poprawki tłuszczu i laktozy, brak decyzji, błędy', () => {
  const [a, b, c, d] = parsujCsv(czytajTekst(Buffer.from(CSV, 'utf8')));
  assert.deepEqual(decyzja(a, 2), { produkt: 101, decyzja: 'group', rodzaj: 'UHT', tluszcz: 3.2, laktoza: 'z laktozą', uwagi: 'sprawdzone na stronie; karton' });
  assert.deepEqual([decyzja(b, 3).rodzaj, decyzja(b, 3).laktoza, decyzja(b, 3).tluszcz], ['świeże', 'bez laktozy', 2]);
  assert.deepEqual(decyzja(c, 4), { produkt: 103, decyzja: 'skip', uwagi: 'smakowe' });
  assert.equal(decyzja(d, 5), null);
  assert.match(decyzja({ produkt_id: '7', rodzaj: 'pasteryzowane', tluszcz: '3,2' }, 9).blad, /nieznany rodzaj/);
  assert.match(decyzja({ produkt_id: '7', rodzaj: 'UHT', tluszcz: '' }, 9).blad, /tłuszcz/);
  assert.match(decyzja({ produkt_id: 'x', rodzaj: 'UHT' }, 9).blad, /produkt_id/);
  assert.equal(decyzja({ produkt_id: '7', rodzaj: 'pomi�' }, 9).decyzja, 'skip', 'uszkodzone „pomiń” też działa');
});

test('SQL przeglądu: próba kończy się ROLLBACK, zapis COMMIT; ta sama funkcja grupy co reguła', () => {
  const d = [{ produkt: 101, decyzja: 'group', rodzaj: 'UHT', tluszcz: 3.2, laktoza: 'z laktozą', uwagi: "O'Kej" }, { produkt: 103, decyzja: 'skip', uwagi: '' }];
  const proba = sqlPrzegladu(d);
  assert.match(proba, /ROLLBACK;\n/);
  assert.doesNotMatch(proba, /^COMMIT;/m);
  assert.match(proba, /public\.milk_group\('UHT', 3\.2, 'z laktozą', p\.canonical_name\)/);
  assert.match(proba, /O''Kej/);
  assert.match(sqlPrzegladu(d, { tryb: 'zapis' }), /^COMMIT;$/m);
});
