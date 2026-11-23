// Generator SQL importu katalogu (produkty, oferty, ceny) z plików scraperów. Nie łączy się z bazą.
// Użycie (z katalogu smart_cart):
//   node scripts/import/import-katalogu.mjs --dane <folder danych scraperów>            # próba (ROLLBACK)
//   node scripts/import/import-katalogu.mjs --dane <folder danych scraperów> --zapis    # zapis (COMMIT)
//   ... --z-migracja supabase/migrations/<plik>.sql   # próba razem z niewdrożoną migracją (tylko ROLLBACK)
//   ... --podglad                                       # dodatkowo CSV: co trafi do bazy i co zostanie pominięte
//   ... --sprzatanie                                    # usuwa z bazy oferty sieci, których ten import nie odświeżył
// Wynik: <dane>/raporty_importu/import-<czas>-<tryb>.sql oraz raport JSON. SQL wykonuje administrator (psql).
//
// Zasady (uzgodnione 18.11.2026):
// - w imporcie jedna pozycja = jeden produkt w sieci: łączymy obserwacje z tym samym EAN, z identyczną nazwą
//   oraz z tą samą nazwą bez ilości i tą samą ilością (kodyzbiedry podaje kilka EAN pod jedną nazwą z półki);
// - produkt z bazy uznajemy za ten sam (w kolejności): któryś z EAN pozycji; sieć + nazwa + opakowanie; sieć + nazwa;
//   sieć + nazwa bez ilości + ta sama ilość (albo brak ilości w bazie);
//   dopasowany produkt i jego oferta dostają nowe dane, pozostałych starych rekordów nie zmieniamy;
// - cena z gazetki jest promocją z okresem ważności, nigdy ceną regularną; nie wyliczamy cen;
// - promocję dopuszczamy do naliczania tylko, gdy da się ją wiernie zapisać obecnymi regułami (unit / min_quantity),
//   ma dowód (link HTTPS do oferty), cenę i okres; złożone warunki zostają niepotwierdzone (promo_scope = unknown).
// - sprzątanie (decyzja z 19.11.2026, opcja --sprzatanie): w bazie zostają tylko dane z naszych plików. Usuwamy oferty
//   sieci obecnych w imporcie, których ten import nie odświeżył, potem ich produkty bez innych ofert i wszystkie puste grupy
//   (także opuszczone po zmianie nazwy lub ilości; bez grup z list, ulubionych, przekierowań i sprawdzonych ręcznie).
//   Produkt wybrany na liście zakupów przerywa całość.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normTekst, rdzenNazwy, WZORZEC_ILOSCI_W_NAZWIE } from './normalizacja.mjs';
import { kategoriaNiespozywcza, produktBazowy, ZRODLO_SLOWNIKA } from './slownik.mjs';
import { wczytajZrodla } from './zrodla.mjs';
import { wspolczynniki, wyliczRegularna, ZRODLO_WYLICZONEJ } from './wyliczanie.mjs';

export const NARZEDZIE = 'scripts/import/import-katalogu.mjs v3';
const PRIORYTET = { kodyzbiedry: 4, antonka: 3, tanszykoszyk: 2, antonka_historia: 1 };

// Limit nowych produktów na parę sieć × produkt bazowy (decyzja z 19.11.2026: 25).
export const LIMIT_NA_PRODUKT_BAZOWY = 25;
// Wyjątek 1: produkty bazowe, z których baza tworzy grupy porównania koszyka - bez limitu.
export const BEZ_LIMITU = new Set([
  'Mleko UHT 3,2%', 'Mleko 1,5% - 2,0%', 'Mleko bez laktozy', 'Masło ekstra 82%', 'Mąka pszenna uniwersalna',
  'Mąka ziemniaczana (Skrobia)', 'Ryż Basmati / Jaśminowy', 'Ryż biały / Parboiled', 'Cukier biały 1kg',
  'Jajka rozmiar L (10 szt.)', 'Jajka rozmiar M (10 szt.)',
]);

const potwierdzona = p => p.cena_regularna !== null && !p.wyliczenie;

/** Oznacza pozycje ponad limit (poza_limitem = true). Takie pozycje mogą tylko zaktualizować produkt już istniejący w bazie. */
export function zastosujLimit(pozycje, limit = LIMIT_NA_PRODUKT_BAZOWY) {
  const grupy = new Map();
  for (const p of pozycje) {
    p.poza_limitem = false;
    if (BEZ_LIMITU.has(p.produkt_bazowy)) continue;
    const k = `${p.siec}|${p.produkt_bazowy}`;
    if (!grupy.has(k)) grupy.set(k, []);
    grupy.get(k).push(p);
  }
  let poza = 0;
  for (const lista of grupy.values()) {
    // Kolejność liczy tylko potwierdzone ceny: tryb z wyliczonymi cenami nie zmienia, które produkty mieszczą się w limicie.
    const data = p => (potwierdzona(p) ? p.obserwacja_regularnej ?? '' : '');
    lista.sort((a, b) => potwierdzona(b) - potwierdzona(a) || data(b).localeCompare(data(a))
      || (b.ilosc !== null) - (a.ilosc !== null) || (b.ean !== null) - (a.ean !== null)
      || (b.zdjecie !== null) - (a.zdjecie !== null) || a.nazwa.localeCompare(b.nazwa, 'pl'));
    for (const p of lista.slice(limit)) { p.poza_limitem = true; poza++; }
  }
  return poza;
}

/** Najnowsza cena regularna; przy tej samej dacie źródło o wyższym priorytecie, potem cena najczęstsza, potem najniższa. */
function wybierzRegularna(zCena) {
  if (!zCena.length) return null;
  const data = o => o.cena_regularna.obserwacja ?? '';
  const najnowsza = zCena.reduce((m, o) => (data(o) > m ? data(o) : m), '');
  let kandydaci = zCena.filter(o => data(o) === najnowsza);
  const prio = Math.max(...kandydaci.map(o => PRIORYTET[o.zrodlo] ?? 0));
  kandydaci = kandydaci.filter(o => (PRIORYTET[o.zrodlo] ?? 0) === prio);
  const ile = new Map();
  for (const o of kandydaci) ile.set(o.cena_regularna.kwota, (ile.get(o.cena_regularna.kwota) ?? 0) + 1);
  return kandydaci.reduce((a, o) => {
    const ia = ile.get(a.cena_regularna.kwota); const io = ile.get(o.cena_regularna.kwota);
    return io > ia || (io === ia && o.cena_regularna.kwota < a.cena_regularna.kwota) ? o : a;
  });
}

const kluczIlosci = o => (o.ilosc ? `${o.ilosc.value}${o.ilosc.unit}` : o.za_wage ? `waga:${o.za_wage.value}${o.za_wage.unit}` : '?');
const nowsza = (a, b) => (a?.obserwacja ?? '') > (b?.obserwacja ?? '');

/** Reguła promocji, gdy da się ją wiernie zapisać (inaczej null - promocja nie jest naliczana automatycznie). */
export function regulaPromocji(oferta) {
  if (!oferta || oferta.kwota === null || !oferta.wazne_do || oferta.szacowana || oferta.mieszanie_produktow) return null;
  const typ = normTekst(oferta.typ);
  let rule = null;
  if (['', 'obnizka', 'supercena', 'gazetka', 'cena', 'promocja'].includes(typ)) rule = { kind: 'unit' };
  const m = typ.match(/^przy zakupie (\d{1,3})( szt)?$/);
  if (m && Number(m[1]) >= 2) rule = { kind: 'min_quantity', min_quantity: Number(m[1]) };
  if (!rule) return null;
  const limit = String(oferta.warunek ?? '').match(/limit[^0-9]{0,30}(\d{1,3})\s*(szt|opak)/i);
  if (limit) rule.max_discount_quantity = Number(limit[1]);
  if (oferta.karta_lub_aplikacja) rule.requires_card = true;
  if (/aktywuj|aktywacj|kupon/i.test(oferta.warunek ?? '')) rule.requires_activation = true;
  return rule;
}

/** Łączy obserwacje w pozycje "produkt w sieci". Zwraca { pozycje, pominiete, listaPominietych, wyliczenia }.
 *  regularneZPromocji: pozycja bez potwierdzonej ceny regularnej dostaje cenę wyliczoną z promocji
 *  (w imporcie z wiersza poleceń domyślnie od 23.11.2026; wyłącza opcja --bez-wyliczania). */
export function pozycjeZObserwacji(obserwacje, { regularneZPromocji = false } = {}) {
  const wsp = regularneZPromocji ? wspolczynniki(obserwacje) : null;
  const bledy = [];
  const grupy = new Map();
  const pominiete = {};
  const listaPominietych = [];
  const pomin = (powod, o) => {
    pominiete[powod] = (pominiete[powod] ?? 0) + 1;
    listaPominietych.push({ powod, siec: o.siec, zrodlo: o.zrodlo ?? o.zrodlo_ceny, nazwa: o.nazwa,
      cena: o.cena_regularna?.kwota ?? o.cena_regularna ?? o.oferta_okresowa?.kwota ?? o.cena_nieokreslona?.kwota ?? null });
    return o;
  };
  // Łączenie obserwacji w pozycje (zbiory rozłączne): wspólny EAN, identyczna nazwa albo nazwa bez ilości + ta sama ilość.
  const rodzic = [];
  const korzen = i => { while (rodzic[i] !== i) { rodzic[i] = rodzic[rodzic[i]]; i = rodzic[i]; } return i; };
  const pierwszyZKluczem = new Map();
  const przyjete = [];
  for (const o of obserwacje) {
    if (!o.cena_regularna && !(o.oferta_okresowa && o.oferta_okresowa.kwota !== null)) { pomin('brak_uzytecznej_ceny', o); continue; }
    if (kategoriaNiespozywcza(o.kategoria_zrodla)) { pomin('kategoria_niespozywcza_zrodla', o); continue; }
    const bazowy = produktBazowy(o.nazwa);
    if (!bazowy) { pomin('brak_produktu_bazowego', o); continue; }
    const i = przyjete.length;
    przyjete.push({ o, bazowy });
    rodzic.push(i);
    const ilosc = kluczIlosci(o);
    const rdzen = rdzenNazwy(o.nazwa);
    const klucze = [`nazwa:${normTekst(o.nazwa)}`];
    if (o.ean) klucze.push(`ean:${o.ean}`);
    if (rdzen && ilosc !== '?') klucze.push(`rdzen:${rdzen}|${ilosc}`);
    for (const k of klucze.map(k => `${o.siec}|${k}`)) {
      if (!pierwszyZKluczem.has(k)) { pierwszyZKluczem.set(k, i); continue; }
      const a = korzen(i); const b = korzen(pierwszyZKluczem.get(k));
      if (a !== b) rodzic[Math.max(a, b)] = Math.min(a, b);
    }
  }
  for (let i = 0; i < przyjete.length; i++) {
    const r = korzen(i);
    if (!grupy.has(r)) grupy.set(r, { siec: przyjete[r].o.siec, obserwacje: [], bazowy: przyjete[r].bazowy });
    grupy.get(r).obserwacje.push(przyjete[i].o);
  }
  const pozycje = [];
  for (const g of grupy.values()) {
    const obs = g.obserwacje;
    const regularna = wybierzRegularna(obs.filter(o => o.cena_regularna));
    const zPromo = obs.filter(o => o.oferta_okresowa && o.oferta_okresowa.kwota !== null);
    const promo = zPromo.reduce((a, o) => (!a || (o.oferta_okresowa.wazne_do ?? '') > (a.oferta_okresowa.wazne_do ?? '')
      || ((o.oferta_okresowa.wazne_do ?? '') === (a.oferta_okresowa.wazne_do ?? '') && nowsza(o.oferta_okresowa, a.oferta_okresowa)) ? o : a), null);
    const glowna = regularna ?? promo;
    const zIloscia = [regularna, promo, ...obs].find(o => o?.ilosc) ?? null;
    const zWaga = zIloscia ? null : obs.find(o => o.za_wage) ?? null;
    // Kilka EAN pod jedną nazwą: zapisujemy wszystkie; produkt w bazie dostaje EAN już tam obecny, a nowy - najmniejszy.
    const eany = [...new Set(obs.map(o => o.ean).filter(Boolean))].sort();
    const ean = eany[0] ?? null;
    const p = {
      siec: g.siec, ean, eany, nazwa: glowna.nazwa, kategoria: g.bazowy.kategoria, produkt_bazowy: g.bazowy.nazwa,
      ilosc: zIloscia?.ilosc ?? zWaga?.za_wage ?? null,
      sposob_sprzedazy: zIloscia ? 'package' : zWaga ? 'bulk' : 'unknown',
      zdjecie: [glowna, ...obs].find(o => o.zdjecie && /^https:\/\//.test(o.zdjecie))?.zdjecie ?? null,
      cena_regularna: regularna ? regularna.cena_regularna.kwota : null,
      obserwacja_regularnej: regularna?.cena_regularna.obserwacja ?? null,
      zrodlo_ceny: (regularna ?? promo).zrodlo,
      promocja: null,
      zrodla: [...new Set(obs.map(o => o.klucz_zrodla))].sort(),
    };
    if (promo) {
      const of = promo.oferta_okresowa;
      const rule = promo.zrodlo === 'tanszykoszyk' && promo.link ? regulaPromocji(of) : null;
      p.promocja = {
        kwota: of.kwota, typ: of.typ ? String(of.typ).slice(0, 64) : null, warunek: of.warunek ?? null,
        wazne_od: of.wazne_od, wazne_do: of.wazne_do,
        status: of.szacowana ? 'estymowana' : 'prawdziwa',
        zasieg: rule ? 'nationwide' : 'unknown', regula: rule, dowod: rule ? promo.link : null,
      };
      if (p.cena_regularna !== null && of.kwota >= p.cena_regularna) { p.promocja = null; pomin('promocja_nie_nizsza_od_regularnej', p); }
    }
    if (wsp && p.promocja) {
      const wyl = wyliczRegularna(promo.oferta_okresowa, g.siec, wsp);
      if (wyl && p.cena_regularna === null) {
        p.cena_regularna = wyl.kwota;
        p.obserwacja_regularnej = promo.oferta_okresowa.obserwacja ?? null;
        p.zrodlo_ceny = ZRODLO_WYLICZONEJ;
        p.wyliczenie = wyl.metoda;
      } else if (wyl && ['tanszykoszyk', 'antonka'].includes(regularna?.zrodlo)) {
        // Sprawdzenie na pozycjach z potwierdzoną, aktualną ceną regularną: jak daleko jest wyliczona.
        bledy.push({ siec: g.siec, metoda: wyl.metoda.split(' ')[0], blad: (wyl.kwota - p.cena_regularna) / p.cena_regularna });
      }
    }
    pozycje.push(p);
  }
  pozycje.sort((a, b) => (a.siec + a.nazwa).localeCompare(b.siec + b.nazwa, 'pl'));
  return { pozycje, pominiete, listaPominietych, wyliczenia: wsp ? podsumujWyliczenia(pozycje, wsp, bledy) : null };
}

/** Raport wyliczonych cen: ile cen wyliczono (sieć, metoda), współczynniki i błąd na pozycjach z ceną potwierdzoną. */
function podsumujWyliczenia(pozycje, wsp, bledy) {
  const naSiec = {}; const metody = {};
  for (const p of pozycje.filter(x => x.wyliczenie && !x.poza_limitem)) {
    naSiec[p.siec] = (naSiec[p.siec] ?? 0) + 1;
    const m = p.wyliczenie.split(' ')[0];
    metody[m] = (metody[m] ?? 0) + 1;
  }
  const sprawdzenie = {};
  for (const b of bledy) (sprawdzenie[`${b.siec}|${b.metoda}`] ??= []).push(b.blad);
  const opis = a => {
    const s = a.map(Math.abs).sort((x, y) => x - y);
    return { pozycji: a.length, mediana_bledu_proc: Math.round(s[Math.floor(s.length / 2)] * 1000) / 10,
      w_granicy_10_proc: Math.round(s.filter(x => x <= 0.1).length / s.length * 100) };
  };
  return { wyliczone_na_siec: naSiec, metody, wspolczynniki: wsp,
    sprawdzenie: Object.fromEntries(Object.entries(sprawdzenie).sort().map(([k, a]) => [k, opis(a)])) };
}

const poleCsv = v => {
  const t = v === null || v === undefined ? '' : String(v);
  return /[";\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
const csv = (naglowek, wiersze) => '\uFEFF' + [naglowek, ...wiersze].map(w => w.map(poleCsv).join(';')).join('\r\n') + '\r\n';

/** Podgląd do Excela: co trafi do bazy i co zostanie pominięte (z powodem). */
export function podgladCsv(pozycjeWszystkie, listaPominietychWejscie) {
  const pozycje = pozycjeWszystkie.filter(p => !p.poza_limitem);
  const listaPominietych = [...listaPominietychWejscie, ...pozycjeWszystkie.filter(p => p.poza_limitem).map(p => ({
    powod: 'ponad_limit_tylko_aktualizacja_istniejacego', siec: p.siec, zrodlo: p.zrodlo_ceny, nazwa: p.nazwa, cena: p.cena_regularna ?? p.promocja?.kwota ?? null }))];
  const liczba = v => (v === null || v === undefined ? '' : String(v).replace('.', ','));
  const doBazy = csv(['siec', 'kategoria', 'produkt_bazowy', 'nazwa', 'ean', 'wszystkie_ean', 'opakowanie', 'sposob_sprzedazy', 'cena_regularna',
    'data_ceny', 'zrodlo_ceny', 'wyliczenie', 'promocja', 'promocja_od', 'promocja_do', 'promocja_typ', 'promocja_naliczana', 'zrodla'],
  pozycje.map(p => [p.siec, p.kategoria, p.produkt_bazowy, p.nazwa, p.ean, (p.eany ?? []).join(' '), p.ilosc ? `${p.ilosc.value} ${p.ilosc.unit}` : '',
    p.sposob_sprzedazy, liczba(p.cena_regularna), p.obserwacja_regularnej, p.zrodlo_ceny, p.wyliczenie ?? '', liczba(p.promocja?.kwota),
    p.promocja?.wazne_od, p.promocja?.wazne_do, p.promocja?.typ, p.promocja ? (p.promocja.zasieg === 'nationwide' ? 'tak' : 'nie') : '',
    p.zrodla.join(' | ')]));
  const pominiete = csv(['powod', 'siec', 'zrodlo', 'nazwa', 'cena'],
    listaPominietych.map(x => [x.powod, x.siec, x.zrodlo, x.nazwa, liczba(x.cena)]));
  return { doBazy, pominiete };
}

// Sprzątanie po imporcie (w tej samej transakcji). Dotyczy tylko sieci, które mają pozycje w tym imporcie.
const SQL_SPRZATANIA = `
-- Sprzątanie: w bazie zostają tylko oferty odświeżone tym importem (sieci bez pozycji w imporcie nie są ruszane).
CREATE TEMP TABLE imp_usun_oferty ON COMMIT DROP AS
SELECT o.id, o.store_id, o.product_id, o.price_source FROM public.store_offers o
WHERE o.store_id IN (SELECT DISTINCT store_id FROM imp_dop WHERE store_id IS NOT NULL)
  AND o.last_import_run_id IS DISTINCT FROM (SELECT id FROM imp_przebieg);
CREATE INDEX ON imp_usun_oferty(id);
CREATE TEMP TABLE imp_usun_produkty ON COMMIT DROP AS
SELECT p.id, p.comparison_group_id, (SELECT min(u.store_id) FROM imp_usun_oferty u WHERE u.product_id = p.id) AS store_id
FROM public.products p
WHERE p.id IN (SELECT product_id FROM imp_usun_oferty)
  AND NOT EXISTS (SELECT 1 FROM public.store_offers o WHERE o.product_id = p.id
    AND NOT EXISTS (SELECT 1 FROM imp_usun_oferty u WHERE u.id = o.id));
DO $sprzatanie$ DECLARE n integer; BEGIN
  SELECT count(DISTINCT i.selected_product_id) INTO n FROM public.shopping_list_items i JOIN imp_usun_produkty p ON p.id = i.selected_product_id;
  IF n > 0 THEN
    RAISE EXCEPTION 'Sprzątanie przerwane: % produkt(ów) do usunięcia jest wybranych na listach zakupów. Nic nie zostało zapisane.', n;
  END IF;
END $sprzatanie$;
DELETE FROM public.store_offers o USING imp_usun_oferty u WHERE o.id = u.id;
DELETE FROM public.products p USING imp_usun_produkty u WHERE p.id = u.id;
CREATE TEMP TABLE imp_usun_grupy ON COMMIT DROP AS
SELECT g.id FROM public.comparison_groups g
WHERE g.group_key NOT LIKE 'reviewed:%'
  AND NOT EXISTS (SELECT 1 FROM public.products p WHERE p.comparison_group_id = g.id)
  AND NOT EXISTS (SELECT 1 FROM public.shopping_list_items i WHERE i.group_id = g.id)
  AND NOT EXISTS (SELECT 1 FROM public.favorite_groups f WHERE f.group_id = g.id)
  AND NOT EXISTS (SELECT 1 FROM public.comparison_group_redirects r WHERE g.id IN (r.old_group_id, r.new_group_id));
DELETE FROM public.comparison_groups g USING imp_usun_grupy u WHERE g.id = u.id;
SELECT s.slug AS siec, (SELECT count(*) FROM imp_usun_oferty u WHERE u.store_id = s.id) AS usuniete_oferty,
  (SELECT count(*) FROM imp_usun_produkty u WHERE u.store_id = s.id) AS usuniete_produkty
FROM public.stores s WHERE s.is_active ORDER BY s.id;
SELECT coalesce(price_source, '(brak)') AS zrodlo_usunietej_oferty, count(*) AS oferty FROM imp_usun_oferty GROUP BY 1 ORDER BY 2 DESC;
SELECT (SELECT count(*) FROM imp_usun_grupy) AS usuniete_puste_grupy, (SELECT count(*) FROM public.comparison_groups) AS grupy_po;
`;

const lit = v => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const num = v => (v === null || v === undefined ? 'NULL' : String(Number(v)));
const json = v => (v === null || v === undefined ? 'NULL' : `${lit(JSON.stringify(v))}::jsonb`);

function wiersz(p, nr) {
  const pr = p.promocja;
  const gramatura = p.ilosc ? `${p.ilosc.value}${p.ilosc.unit}`.slice(0, 24) : null;
  return `(${nr},${lit(p.siec)},${lit(p.ean)},${lit(p.nazwa)},${lit(p.produkt_bazowy)},${num(p.ilosc?.value)},${lit(p.ilosc?.unit)},${lit(gramatura)},`
    + `${lit(p.sposob_sprzedazy)},${num(p.cena_regularna)},${lit(p.obserwacja_regularnej)},${lit(p.zrodlo_ceny)},${lit(p.zdjecie)},`
    + `${num(pr?.kwota)},${lit(pr?.typ)},${lit(pr?.warunek)},${lit(pr?.wazne_od)},${lit(pr?.wazne_do)},${lit(pr?.status)},`
    + `${lit(pr?.zasieg)},${json(pr?.regula)},${lit(pr?.dowod)},${p.poza_limitem ? 'true' : 'false'},`
    + `${p.eany?.length ? `ARRAY[${p.eany.map(lit).join(',')}]::text[]` : 'NULL'})`;
}

/** Pełny skrypt SQL importu. tryb: 'proba' (ROLLBACK) albo 'zapis' (COMMIT). */
export function sqlImportu(pozycje, { tryb = 'proba', pliki = [], podsumowanie = {}, migracja = null, sprzatanie = false } = {}) {
  if (!['proba', 'zapis'].includes(tryb)) throw new Error('Nieznany tryb');
  if (migracja && tryb !== 'proba') throw new Error('Migrację można dołączyć tylko do próby (ROLLBACK).');
  if (migracja && /^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im.test(migracja)) throw new Error('Migracja nie może zawierać BEGIN/COMMIT/ROLLBACK.');
  const wiersze = pozycje.map((p, i) => wiersz(p, i + 1));
  const paczki = [];
  for (let i = 0; i < wiersze.length; i += 500) {
    paczki.push(`INSERT INTO imp VALUES\n${wiersze.slice(i, i + 500).join(',\n')};`);
  }
  return `-- Wygenerowane przez ${NARZEDZIE}, tryb: ${tryb}${sprzatanie ? ' + sprzątanie' : ''}. Pozycji: ${pozycje.length}.
-- Uruchamia administrator przez psql. Tryb "proba" kończy się ROLLBACK - baza się nie zmienia.
\\set ON_ERROR_STOP on
BEGIN;
${migracja ? `-- Próba z niewdrożoną migracją: migracja i import w tej samej transakcji, potem ROLLBACK.\n${migracja}\n` : ''}SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20min';
CREATE TEMP TABLE imp (
  nr integer PRIMARY KEY, siec text NOT NULL, ean text, nazwa text NOT NULL, produkt_bazowy text NOT NULL,
  ilosc numeric, jednostka text, gramatura text, sposob text NOT NULL, regularna numeric, obserwacja date, zrodlo text NOT NULL, zdjecie text,
  promo numeric, promo_typ text, promo_warunek text, promo_od date, promo_do date, promo_status text,
  promo_zasieg text, promo_regula jsonb, promo_dowod text, poza_limitem boolean NOT NULL DEFAULT false, eany text[]
) ON COMMIT DROP;
-- Nazwa bez ilości opakowania (ten sam wzorzec co rdzenNazwy w normalizacja.mjs).
CREATE OR REPLACE FUNCTION pg_temp.rdzen(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $rdzen$
  SELECT public.norm_text(regexp_replace(lower(coalesce(t, '')), ${lit(WZORZEC_ILOSCI_W_NAZWIE)}, ' ', 'g'))
$rdzen$;
${paczki.join('\n')}

-- Rejestr przebiegu.
CREATE TEMP TABLE imp_przebieg (id bigint) ON COMMIT DROP;
WITH r AS (INSERT INTO public.import_runs(tool, source_files, summary)
  VALUES (${lit(NARZEDZIE)}, ${json(pliki)}, ${json(podsumowanie)}) RETURNING id)
INSERT INTO imp_przebieg SELECT id FROM r;

-- Dopasowanie do sieci, produktu bazowego i istniejących produktów (migawka ofert sprzed importu).
CREATE TEMP TABLE imp_stare ON COMMIT DROP AS
SELECT DISTINCT ON (o.store_id, public.norm_text(o.store_product_name), p.quantity_value, p.quantity_unit)
  o.store_id, public.norm_text(o.store_product_name) AS nazwa_norm, pg_temp.rdzen(o.store_product_name) AS rdzen,
  p.quantity_value, p.quantity_unit, o.product_id
FROM public.store_offers o JOIN public.products p ON p.id = o.product_id
ORDER BY o.store_id, public.norm_text(o.store_product_name), p.quantity_value, p.quantity_unit, o.id;
CREATE INDEX ON imp_stare(store_id, nazwa_norm);
CREATE INDEX ON imp_stare(store_id, rdzen);
-- Możliwe duble przed importem: ta sama sieć, nazwa bez ilości i ilość, różne produkty.
CREATE TEMP TABLE imp_duble_przed ON COMMIT DROP AS
SELECT store_id, count(*) - count(DISTINCT (rdzen, quantity_value, quantity_unit)) AS duble
FROM (SELECT DISTINCT o.store_id, o.product_id, pg_temp.rdzen(o.store_product_name) AS rdzen, p.quantity_value, p.quantity_unit
      FROM public.store_offers o JOIN public.products p ON p.id = o.product_id) x GROUP BY store_id;
CREATE TEMP TABLE imp_dop ON COMMIT DROP AS
SELECT i.*, s.id AS store_id, b.id AS base_product_id, public.norm_text(i.nazwa) AS nazwa_norm,
  CASE WHEN i.eany IS NOT NULL THEN coalesce(
    (SELECT p.id FROM public.products p WHERE p.ean = ANY (i.eany) ORDER BY (p.ean = i.ean) DESC, p.id LIMIT 1),
    (SELECT p.id FROM public.products p WHERE p.product_key IN (SELECT 'ean:' || e FROM unnest(i.eany) e) ORDER BY p.id LIMIT 1)) END AS po_ean,
  (SELECT st.product_id FROM imp_stare st WHERE st.store_id = s.id AND st.nazwa_norm = public.norm_text(i.nazwa)
     AND st.quantity_value IS NOT DISTINCT FROM i.ilosc AND st.quantity_unit IS NOT DISTINCT FROM i.jednostka
     ORDER BY st.product_id LIMIT 1) AS po_nazwie,
  (SELECT st.product_id FROM imp_stare st WHERE st.store_id = s.id AND st.nazwa_norm = public.norm_text(i.nazwa)
     ORDER BY st.product_id LIMIT 1) AS po_samej_nazwie,
  (SELECT st.product_id FROM imp_stare st WHERE st.store_id = s.id AND st.rdzen = pg_temp.rdzen(i.nazwa) AND st.rdzen <> ''
     AND (st.quantity_value IS NULL OR (st.quantity_value = i.ilosc AND st.quantity_unit = i.jednostka))
     ORDER BY (st.quantity_value IS NULL), st.product_id LIMIT 1) AS po_rdzeniu
FROM imp i
LEFT JOIN public.stores s ON s.slug = i.siec AND s.is_active
LEFT JOIN public.base_products b ON b.name = i.produkt_bazowy;
ALTER TABLE imp_dop ADD COLUMN product_id bigint, ADD COLUMN dopasowanie text;
UPDATE imp_dop SET product_id = coalesce(po_ean, po_nazwie, po_samej_nazwie, po_rdzeniu),
  dopasowanie = CASE WHEN store_id IS NULL THEN 'brak_sieci' WHEN base_product_id IS NULL THEN 'brak_produktu_bazowego'
    WHEN po_ean IS NOT NULL THEN 'ean' WHEN po_nazwie IS NOT NULL THEN 'siec_nazwa_opakowanie'
    WHEN po_samej_nazwie IS NOT NULL THEN 'siec_nazwa' WHEN po_rdzeniu IS NOT NULL THEN 'siec_nazwa_bez_ilosci' ELSE 'nowy' END;
-- Jeden produkt bazy może zostać dopasowany tylko raz w danej sieci (najpierw najpewniejsze dopasowanie).
WITH dubel AS (SELECT nr, row_number() OVER (PARTITION BY store_id, product_id ORDER BY
    array_position(ARRAY['ean', 'siec_nazwa_opakowanie', 'siec_nazwa', 'siec_nazwa_bez_ilosci'], dopasowanie), nr) AS n
  FROM imp_dop WHERE product_id IS NOT NULL)
UPDATE imp_dop d SET product_id = NULL, dopasowanie = 'nowy' FROM dubel WHERE dubel.nr = d.nr AND dubel.n > 1;
-- Limit: pozycje ponad limit nie tworzą nowych produktów; istniejące produkty nadal dostają nowe dane.
UPDATE imp_dop SET dopasowanie = 'pominiete_limit' WHERE poza_limitem AND dopasowanie = 'nowy';

-- Nowe produkty (klasyfikację do grup wykonuje istniejący wyzwalacz).
INSERT INTO public.products(product_key, base_product_id, ean, canonical_name, gramatura_norm, quantity_value, quantity_unit, image_url, sale_mode)
SELECT DISTINCT ON (k.klucz) k.klucz, d.base_product_id,
  CASE WHEN d.ean IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.products p WHERE p.ean = d.ean) THEN d.ean END,
  d.nazwa, d.gramatura, d.ilosc, d.jednostka, d.zdjecie, d.sposob
FROM imp_dop d
CROSS JOIN LATERAL (SELECT CASE WHEN d.ean IS NOT NULL THEN 'ean:' || d.ean
  ELSE 'src:' || md5(d.siec || '|' || d.nazwa_norm || '|' || coalesce(d.ilosc::text, '') || coalesce(d.jednostka, '')) END AS klucz) k
WHERE d.dopasowanie = 'nowy'
ORDER BY k.klucz, d.nr
ON CONFLICT (product_key) DO NOTHING;
UPDATE imp_dop d SET product_id = p.id
FROM public.products p
WHERE d.dopasowanie = 'nowy' AND p.product_key = CASE WHEN d.ean IS NOT NULL THEN 'ean:' || d.ean
  ELSE 'src:' || md5(d.siec || '|' || d.nazwa_norm || '|' || coalesce(d.ilosc::text, '') || coalesce(d.jednostka, '')) END;

-- Dopasowane produkty dostają nowe dane (produkty sprawdzone ręcznie zachowują swoją grupę i sposób sprzedaży).
UPDATE public.products p SET
  canonical_name = CASE WHEN d.dopasowanie = 'ean' THEN d.nazwa ELSE p.canonical_name END,
  quantity_value = coalesce(d.ilosc, p.quantity_value), quantity_unit = coalesce(d.jednostka, p.quantity_unit),
  image_url = coalesce(d.zdjecie, p.image_url),
  sale_mode = CASE WHEN p.classification_source = 'reviewed' OR d.sposob = 'unknown' THEN p.sale_mode ELSE d.sposob END
FROM (SELECT DISTINCT ON (product_id) * FROM imp_dop WHERE dopasowanie IN ('ean', 'siec_nazwa_opakowanie', 'siec_nazwa', 'siec_nazwa_bez_ilosci')
      ORDER BY product_id, array_position(ARRAY['ean', 'siec_nazwa_opakowanie', 'siec_nazwa', 'siec_nazwa_bez_ilosci'], dopasowanie), nr) d
WHERE p.id = d.product_id;

-- Oferty: nowe dane zastępują dane oferty tego samego produktu w tej sieci.
CREATE TEMP TABLE imp_oferty ON COMMIT DROP AS
SELECT DISTINCT ON (d.store_id, d.product_id) d.*, o.id AS offer_id FROM imp_dop d
LEFT JOIN public.store_offers o ON o.store_id = d.store_id AND o.product_id = d.product_id
WHERE d.product_id IS NOT NULL AND d.store_id IS NOT NULL
ORDER BY d.store_id, d.product_id, (d.dopasowanie <> 'nowy') DESC, d.nr;
UPDATE public.store_offers o SET
  store_product_name = d.nazwa, regular_price = d.regularna,
  price_status = CASE WHEN d.regularna IS NULL THEN 'brak' ELSE 'prawdziwa' END, price_source = left(d.zrodlo, 32),
  regular_price_observed_at = CASE WHEN d.regularna IS NULL THEN NULL ELSE d.obserwacja::timestamp AT TIME ZONE 'Europe/Warsaw' END,
  promo_price = d.promo, promo_type = d.promo_typ, promo_condition = d.promo_warunek, valid_from = d.promo_od, valid_to = d.promo_do,
  promo_scope = coalesce(d.promo_zasieg, 'unknown'), promo_rule = d.promo_regula, promo_evidence_url = d.promo_dowod,
  promo_price_status = coalesce(d.promo_status, 'unknown'), image_url = coalesce(d.zdjecie, o.image_url),
  last_import_run_id = (SELECT id FROM imp_przebieg)
FROM imp_oferty d WHERE d.offer_id = o.id;
INSERT INTO public.store_offers(offer_key, store_id, product_id, store_product_name, regular_price, price_status, price_source,
  regular_price_observed_at, promo_price, promo_type, promo_condition, valid_from, valid_to, promo_scope, promo_rule,
  promo_evidence_url, promo_price_status, image_url, last_import_run_id)
SELECT left(d.store_id || ':' || p.product_key, 64), d.store_id, d.product_id, d.nazwa, d.regularna,
  CASE WHEN d.regularna IS NULL THEN 'brak' ELSE 'prawdziwa' END, left(d.zrodlo, 32),
  CASE WHEN d.regularna IS NULL THEN NULL ELSE d.obserwacja::timestamp AT TIME ZONE 'Europe/Warsaw' END,
  d.promo, d.promo_typ, d.promo_warunek, d.promo_od, d.promo_do, coalesce(d.promo_zasieg, 'unknown'), d.promo_regula,
  d.promo_dowod, coalesce(d.promo_status, 'unknown'), d.zdjecie, (SELECT id FROM imp_przebieg)
FROM imp_oferty d JOIN public.products p ON p.id = d.product_id
WHERE d.offer_id IS NULL;
${sprzatanie ? SQL_SPRZATANIA : ''}
-- Raport (wyniki widoczne w psql).
SELECT dopasowanie, count(*) AS pozycje FROM imp_dop GROUP BY 1 ORDER BY 1;
SELECT count(*) FILTER (WHERE offer_id IS NULL) AS nowe_oferty, count(*) FILTER (WHERE offer_id IS NOT NULL) AS zastapione_oferty FROM imp_oferty;
SELECT s.slug AS siec, coalesce(p.duble, 0) AS mozliwe_duble_przed, coalesce(n.duble, 0) AS mozliwe_duble_po
FROM public.stores s
LEFT JOIN imp_duble_przed p ON p.store_id = s.id
LEFT JOIN (SELECT store_id, count(*) - count(DISTINCT (rdzen, quantity_value, quantity_unit)) AS duble
  FROM (SELECT DISTINCT o.store_id, o.product_id, pg_temp.rdzen(o.store_product_name) AS rdzen, p.quantity_value, p.quantity_unit
        FROM public.store_offers o JOIN public.products p ON p.id = o.product_id) x GROUP BY store_id) n ON n.store_id = s.id
WHERE s.is_active ORDER BY s.id;
SELECT s.slug AS siec, count(o.id) AS oferty_po_imporcie, count(DISTINCT o.product_id) AS produkty_po_imporcie,
  count(o.id) FILTER (WHERE o.last_import_run_id = (SELECT id FROM imp_przebieg)) AS oferty_z_tego_importu,
  count(o.id) FILTER (WHERE o.last_import_run_id IS DISTINCT FROM (SELECT id FROM imp_przebieg)) AS oferty_stare_nietkniete
FROM public.stores s LEFT JOIN public.store_offers o ON o.store_id = s.id
WHERE s.is_active GROUP BY s.id, s.slug ORDER BY s.id;
SELECT s.slug AS siec, coalesce(o.price_source, '(brak)') AS zrodlo_ceny_regularnej,
  count(*) FILTER (WHERE o.price_status = 'prawdziwa') AS z_cena_regularna, count(*) FILTER (WHERE o.price_status <> 'prawdziwa') AS bez_ceny_regularnej
FROM public.store_offers o JOIN public.stores s ON s.id = o.store_id
WHERE s.is_active GROUP BY 1, 2 ORDER BY 1, 2;
SELECT g.name AS grupa_mleka, s.slug AS siec, count(DISTINCT c.product_id) AS produkty,
  count(*) FILTER (WHERE c.price_status = 'prawdziwa') AS z_cena_regularna,
  count(*) FILTER (WHERE c.verified_promotion) AS z_promocja_do_naliczenia
FROM public.catalog_offers c JOIN public.comparison_groups g ON g.id = c.group_id JOIN public.stores s ON s.id = c.store_id
WHERE g.group_key LIKE 'milk:%' GROUP BY 1, 2 ORDER BY 1, 2;
${tryb === 'zapis' ? 'COMMIT;' : 'ROLLBACK;\nSELECT \'Tryb próbny: wszystkie zmiany wycofane (ROLLBACK).\' AS wynik;'}
`;
}

/** Liczba wyliczonych cen po zastosowaniu limitu (tyle trafi do bazy). */
function podsumujPoLimicie(pozycje) {
  const w = pozycje.filter(p => p.wyliczenie && !p.poza_limitem);
  return { wyliczone_razem: w.length, wyliczone_na_siec: Object.fromEntries(['biedronka', 'lidl', 'kaufland', 'carrefour', 'dino']
    .map(s => [s, w.filter(p => p.siec === s).length])) };
}

function main() {
  const i = process.argv.indexOf('--dane');
  if (i < 0 || !process.argv[i + 1]) throw new Error('Użycie: node scripts/import/import-katalogu.mjs --dane <folder> [--zapis] [--bez-wyliczania]');
  const tryb = process.argv.includes('--zapis') ? 'zapis' : 'proba';
  const sprzatanie = process.argv.includes('--sprzatanie');
  // Od 23.11.2026 (decyzja zespołu) ceny regularne wyliczamy z promocji domyślnie; --bez-wyliczania wyłącza.
  // Dawna opcja --regularne-z-promocji jest dopuszczalna, ale nic już nie zmienia.
  const regularneZPromocji = !process.argv.includes('--bez-wyliczania');
  // --z-migracja można podać kilka razy; pliki są dołączane w podanej kolejności.
  const pliki_migracji = process.argv.flatMap((a, k) => (a === '--z-migracja' ? [process.argv[k + 1]] : []));
  const migracja = pliki_migracji.length
    ? pliki_migracji.map(f => `-- ${path.basename(f)}\n${fs.readFileSync(path.resolve(f), 'utf8')}`).join('\n') : null;
  const dane = path.resolve(process.argv[i + 1]);
  const { obserwacje, pliki } = wczytajZrodla(dane);
  const { pozycje, pominiete, listaPominietych, wyliczenia } = pozycjeZObserwacji(obserwacje, { regularneZPromocji });
  const pozaLimitem = zastosujLimit(pozycje);
  const podsumowanie = { sprzatanie, regularne_z_promocji: regularneZPromocji, obserwacje: obserwacje.length, pozycje: pozycje.length, pominiete, slownik: ZRODLO_SLOWNIKA,
    limit: { na_siec_i_produkt_bazowy: LIMIT_NA_PRODUKT_BAZOWY, poza_limitem: pozaLimitem, bez_limitu: [...BEZ_LIMITU] },
    w_limicie_na_siec: Object.fromEntries(['biedronka', 'lidl', 'kaufland', 'carrefour', 'dino'].map(s => [s, pozycje.filter(p => p.siec === s && !p.poza_limitem).length])),
    pozycje_na_siec: Object.fromEntries(['biedronka', 'lidl', 'kaufland', 'carrefour', 'dino'].map(s => [s, pozycje.filter(p => p.siec === s).length])),
    z_cena_regularna: pozycje.filter(p => p.cena_regularna !== null).length,
    pozycje_z_kilkoma_ean: pozycje.filter(p => p.eany.length > 1).length,
    z_promocja: pozycje.filter(p => p.promocja).length,
    promocje_do_naliczenia: pozycje.filter(p => p.promocja?.zasieg === 'nationwide').length,
    ...(wyliczenia ? { wyliczenia: { ...wyliczenia, ...podsumujPoLimicie(pozycje) } } : {}) };
  const katalog = path.join(dane, 'raporty_importu');
  fs.mkdirSync(katalog, { recursive: true });
  const stempel = new Date().toISOString().replace(/[:.]/g, '-');
  const plikSql = path.join(katalog, `import-${stempel}-${tryb}${sprzatanie ? '-sprzatanie' : ''}${regularneZPromocji ? '' : '-bez-wyliczania'}.sql`);
  const plikiWzgledne = pliki.map(p => ({ ...p, sciezka: path.relative(dane, p.sciezka).replace(/\\/g, '/') }));
  fs.writeFileSync(plikSql, sqlImportu(pozycje, { tryb, pliki: plikiWzgledne, podsumowanie, migracja, sprzatanie }), { flag: 'wx' });
  fs.writeFileSync(plikSql.replace(/\.sql$/, '.json'), JSON.stringify({ podsumowanie, pliki: plikiWzgledne }, null, 2) + '\n', { flag: 'wx' });
  if (process.argv.includes('--podglad')) {
    const { doBazy, pominiete: csvPominiete } = podgladCsv(pozycje, listaPominietych);
    fs.writeFileSync(plikSql.replace(/\.sql$/, '-do-bazy.csv'), doBazy, { flag: 'wx' });
    fs.writeFileSync(plikSql.replace(/\.sql$/, '-pominiete.csv'), csvPominiete, { flag: 'wx' });
    console.log(`Podgląd: ${plikSql.replace(/\.sql$/, '-do-bazy.csv')}`);
  }
  console.log(JSON.stringify(podsumowanie, null, 2));
  console.log(`\nSQL (${tryb}): ${plikSql}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
