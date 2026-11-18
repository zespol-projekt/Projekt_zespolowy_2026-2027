// Generator SQL importu katalogu (produkty, oferty, ceny) z plików scraperów. Nie łączy się z bazą.
// Użycie (z katalogu smart_cart):
//   node scripts/import/import-katalogu.mjs --dane <folder danych scraperów>            # próba (ROLLBACK)
//   node scripts/import/import-katalogu.mjs --dane <folder danych scraperów> --zapis    # zapis (COMMIT)
//   ... --z-migracja supabase/migrations/<plik>.sql   # próba razem z niewdrożoną migracją (tylko ROLLBACK)
//   ... --podglad                                       # dodatkowo CSV: co trafi do bazy i co zostanie pominięte
// Wynik: <dane>/raporty_importu/import-<czas>-<tryb>.sql oraz raport JSON. SQL wykonuje administrator (psql).
//
// Zasady (uzgodnione 18.11.2026):
// - produkt z bazy uznajemy za ten sam, gdy zgadza się EAN podany wprost przez źródło albo sieć + nazwa + opakowanie;
//   dopasowany produkt i jego oferta dostają nowe dane, pozostałych starych rekordów nie zmieniamy;
// - cena z gazetki jest promocją z okresem ważności, nigdy ceną regularną; nie wyliczamy cen;
// - promocję dopuszczamy do naliczania tylko, gdy da się ją wiernie zapisać obecnymi regułami (unit / min_quantity),
//   ma dowód (link HTTPS do oferty), cenę i okres; złożone warunki zostają niepotwierdzone (promo_scope = unknown).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normTekst } from './normalizacja.mjs';
import { produktBazowy, ZRODLO_SLOWNIKA } from './slownik.mjs';
import { wczytajZrodla } from './zrodla.mjs';

export const NARZEDZIE = 'scripts/import/import-katalogu.mjs v1';
const PRIORYTET = { kodyzbiedry: 4, antonka: 3, tanszykoszyk: 2, antonka_historia: 1 };

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

/** Łączy obserwacje w pozycje "produkt w sieci". Zwraca { pozycje, pominiete }. */
export function pozycjeZObserwacji(obserwacje) {
  const grupy = new Map();
  const pominiete = {};
  const listaPominietych = [];
  const pomin = (powod, o) => {
    pominiete[powod] = (pominiete[powod] ?? 0) + 1;
    listaPominietych.push({ powod, siec: o.siec, zrodlo: o.zrodlo ?? o.zrodlo_ceny, nazwa: o.nazwa,
      cena: o.cena_regularna?.kwota ?? o.cena_regularna ?? o.oferta_okresowa?.kwota ?? o.cena_nieokreslona?.kwota ?? null });
    return o;
  };
  for (const o of obserwacje) {
    if (!o.cena_regularna && !(o.oferta_okresowa && o.oferta_okresowa.kwota !== null)) { pomin('brak_uzytecznej_ceny', o); continue; }
    const bazowy = produktBazowy(o.nazwa);
    if (!bazowy) { pomin('brak_produktu_bazowego', o); continue; }
    const tozsamosc = o.ean ? `ean:${o.ean}` : `nazwa:${normTekst(o.nazwa)}|${kluczIlosci(o)}`;
    const klucz = `${o.siec}|${tozsamosc}`;
    if (!grupy.has(klucz)) grupy.set(klucz, { siec: o.siec, obserwacje: [], bazowy });
    grupy.get(klucz).obserwacje.push(o);
  }
  const pozycje = [];
  for (const g of grupy.values()) {
    const obs = g.obserwacje;
    const zCena = obs.filter(o => o.cena_regularna);
    const regularna = zCena.reduce((a, o) => (!a || nowsza(o.cena_regularna, a.cena_regularna)
      || ((o.cena_regularna.obserwacja ?? '') === (a.cena_regularna.obserwacja ?? '') && PRIORYTET[o.zrodlo] > PRIORYTET[a.zrodlo]) ? o : a), null);
    const zPromo = obs.filter(o => o.oferta_okresowa && o.oferta_okresowa.kwota !== null);
    const promo = zPromo.reduce((a, o) => (!a || (o.oferta_okresowa.wazne_do ?? '') > (a.oferta_okresowa.wazne_do ?? '')
      || ((o.oferta_okresowa.wazne_do ?? '') === (a.oferta_okresowa.wazne_do ?? '') && nowsza(o.oferta_okresowa, a.oferta_okresowa)) ? o : a), null);
    const glowna = regularna ?? promo;
    const zIloscia = [regularna, promo, ...obs].find(o => o?.ilosc) ?? null;
    const zWaga = zIloscia ? null : obs.find(o => o.za_wage) ?? null;
    const ean = obs.find(o => o.ean)?.ean ?? null;
    const p = {
      siec: g.siec, ean, nazwa: glowna.nazwa, kategoria: g.bazowy.kategoria, produkt_bazowy: g.bazowy.nazwa,
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
    pozycje.push(p);
  }
  pozycje.sort((a, b) => (a.siec + a.nazwa).localeCompare(b.siec + b.nazwa, 'pl'));
  return { pozycje, pominiete, listaPominietych };
}

const poleCsv = v => {
  const t = v === null || v === undefined ? '' : String(v);
  return /[";\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
const csv = (naglowek, wiersze) => '\uFEFF' + [naglowek, ...wiersze].map(w => w.map(poleCsv).join(';')).join('\r\n') + '\r\n';

/** Podgląd do Excela: co trafi do bazy i co zostanie pominięte (z powodem). */
export function podgladCsv(pozycje, listaPominietych) {
  const liczba = v => (v === null || v === undefined ? '' : String(v).replace('.', ','));
  const doBazy = csv(['siec', 'kategoria', 'produkt_bazowy', 'nazwa', 'ean', 'opakowanie', 'sposob_sprzedazy', 'cena_regularna',
    'data_ceny', 'zrodlo_ceny', 'promocja', 'promocja_od', 'promocja_do', 'promocja_typ', 'promocja_naliczana', 'zrodla'],
  pozycje.map(p => [p.siec, p.kategoria, p.produkt_bazowy, p.nazwa, p.ean, p.ilosc ? `${p.ilosc.value} ${p.ilosc.unit}` : '',
    p.sposob_sprzedazy, liczba(p.cena_regularna), p.obserwacja_regularnej, p.zrodlo_ceny, liczba(p.promocja?.kwota),
    p.promocja?.wazne_od, p.promocja?.wazne_do, p.promocja?.typ, p.promocja ? (p.promocja.zasieg === 'nationwide' ? 'tak' : 'nie') : '',
    p.zrodla.join(' | ')]));
  const pominiete = csv(['powod', 'siec', 'zrodlo', 'nazwa', 'cena'],
    listaPominietych.map(x => [x.powod, x.siec, x.zrodlo, x.nazwa, liczba(x.cena)]));
  return { doBazy, pominiete };
}

const lit = v => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const num = v => (v === null || v === undefined ? 'NULL' : String(Number(v)));
const json = v => (v === null || v === undefined ? 'NULL' : `${lit(JSON.stringify(v))}::jsonb`);

function wiersz(p, nr) {
  const pr = p.promocja;
  const gramatura = p.ilosc ? `${p.ilosc.value}${p.ilosc.unit}`.slice(0, 24) : null;
  return `(${nr},${lit(p.siec)},${lit(p.ean)},${lit(p.nazwa)},${lit(p.produkt_bazowy)},${num(p.ilosc?.value)},${lit(p.ilosc?.unit)},${lit(gramatura)},`
    + `${lit(p.sposob_sprzedazy)},${num(p.cena_regularna)},${lit(p.obserwacja_regularnej)},${lit(p.zrodlo_ceny)},${lit(p.zdjecie)},`
    + `${num(pr?.kwota)},${lit(pr?.typ)},${lit(pr?.warunek)},${lit(pr?.wazne_od)},${lit(pr?.wazne_do)},${lit(pr?.status)},`
    + `${lit(pr?.zasieg)},${json(pr?.regula)},${lit(pr?.dowod)})`;
}

/** Pełny skrypt SQL importu. tryb: 'proba' (ROLLBACK) albo 'zapis' (COMMIT). */
export function sqlImportu(pozycje, { tryb = 'proba', pliki = [], podsumowanie = {}, migracja = null } = {}) {
  if (!['proba', 'zapis'].includes(tryb)) throw new Error('Nieznany tryb');
  if (migracja && tryb !== 'proba') throw new Error('Migrację można dołączyć tylko do próby (ROLLBACK).');
  if (migracja && /^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im.test(migracja)) throw new Error('Migracja nie może zawierać BEGIN/COMMIT/ROLLBACK.');
  const wiersze = pozycje.map((p, i) => wiersz(p, i + 1));
  const paczki = [];
  for (let i = 0; i < wiersze.length; i += 500) {
    paczki.push(`INSERT INTO imp VALUES\n${wiersze.slice(i, i + 500).join(',\n')};`);
  }
  return `-- Wygenerowane przez ${NARZEDZIE}, tryb: ${tryb}. Pozycji: ${pozycje.length}.
-- Uruchamia administrator przez psql. Tryb "proba" kończy się ROLLBACK - baza się nie zmienia.
\\set ON_ERROR_STOP on
BEGIN;
${migracja ? `-- Próba z niewdrożoną migracją: migracja i import w tej samej transakcji, potem ROLLBACK.\n${migracja}\n` : ''}SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20min';
CREATE TEMP TABLE imp (
  nr integer PRIMARY KEY, siec text NOT NULL, ean text, nazwa text NOT NULL, produkt_bazowy text NOT NULL,
  ilosc numeric, jednostka text, gramatura text, sposob text NOT NULL, regularna numeric, obserwacja date, zrodlo text NOT NULL, zdjecie text,
  promo numeric, promo_typ text, promo_warunek text, promo_od date, promo_do date, promo_status text,
  promo_zasieg text, promo_regula jsonb, promo_dowod text
) ON COMMIT DROP;
${paczki.join('\n')}

-- Rejestr przebiegu.
CREATE TEMP TABLE imp_przebieg (id bigint) ON COMMIT DROP;
WITH r AS (INSERT INTO public.import_runs(tool, source_files, summary)
  VALUES (${lit(NARZEDZIE)}, ${json(pliki)}, ${json(podsumowanie)}) RETURNING id)
INSERT INTO imp_przebieg SELECT id FROM r;

-- Dopasowanie do sieci, produktu bazowego i istniejących produktów (migawka ofert sprzed importu).
CREATE TEMP TABLE imp_stare ON COMMIT DROP AS
SELECT DISTINCT ON (o.store_id, public.norm_text(o.store_product_name), p.quantity_value, p.quantity_unit)
  o.store_id, public.norm_text(o.store_product_name) AS nazwa_norm, p.quantity_value, p.quantity_unit, o.product_id
FROM public.store_offers o JOIN public.products p ON p.id = o.product_id
ORDER BY o.store_id, public.norm_text(o.store_product_name), p.quantity_value, p.quantity_unit, o.id;
CREATE INDEX ON imp_stare(store_id, nazwa_norm);
CREATE TEMP TABLE imp_dop ON COMMIT DROP AS
SELECT i.*, s.id AS store_id, b.id AS base_product_id, public.norm_text(i.nazwa) AS nazwa_norm,
  CASE WHEN i.ean IS NOT NULL THEN coalesce(
    (SELECT p.id FROM public.products p WHERE p.ean = i.ean ORDER BY p.id LIMIT 1),
    (SELECT p.id FROM public.products p WHERE p.product_key = 'ean:' || i.ean)) END AS po_ean,
  (SELECT st.product_id FROM imp_stare st WHERE st.store_id = s.id AND st.nazwa_norm = public.norm_text(i.nazwa)
     AND st.quantity_value IS NOT DISTINCT FROM i.ilosc AND st.quantity_unit IS NOT DISTINCT FROM i.jednostka LIMIT 1) AS po_nazwie
FROM imp i
LEFT JOIN public.stores s ON s.slug = i.siec AND s.is_active
LEFT JOIN public.base_products b ON b.name = i.produkt_bazowy;
ALTER TABLE imp_dop ADD COLUMN product_id bigint, ADD COLUMN dopasowanie text;
UPDATE imp_dop SET product_id = coalesce(po_ean, po_nazwie),
  dopasowanie = CASE WHEN store_id IS NULL THEN 'brak_sieci' WHEN base_product_id IS NULL THEN 'brak_produktu_bazowego'
    WHEN po_ean IS NOT NULL THEN 'ean' WHEN po_nazwie IS NOT NULL THEN 'siec_nazwa_opakowanie' ELSE 'nowy' END;
-- Jeden produkt bazy może zostać dopasowany tylko raz w danej sieci (najpierw po EAN).
WITH dubel AS (SELECT nr, row_number() OVER (PARTITION BY store_id, product_id ORDER BY (dopasowanie = 'ean') DESC, nr) AS n
  FROM imp_dop WHERE product_id IS NOT NULL)
UPDATE imp_dop d SET product_id = NULL, dopasowanie = 'nowy' FROM dubel WHERE dubel.nr = d.nr AND dubel.n > 1;

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
FROM (SELECT DISTINCT ON (product_id) * FROM imp_dop WHERE dopasowanie IN ('ean', 'siec_nazwa_opakowanie')
      ORDER BY product_id, (dopasowanie = 'ean') DESC, nr) d
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

-- Raport (wyniki widoczne w psql).
SELECT dopasowanie, count(*) AS pozycje FROM imp_dop GROUP BY 1 ORDER BY 1;
SELECT count(*) FILTER (WHERE offer_id IS NULL) AS nowe_oferty, count(*) FILTER (WHERE offer_id IS NOT NULL) AS zastapione_oferty FROM imp_oferty;
SELECT g.name AS grupa_mleka, s.slug AS siec, count(DISTINCT c.product_id) AS produkty,
  count(*) FILTER (WHERE c.price_status = 'prawdziwa') AS z_cena_regularna,
  count(*) FILTER (WHERE c.verified_promotion) AS z_promocja_do_naliczenia
FROM public.catalog_offers c JOIN public.comparison_groups g ON g.id = c.group_id JOIN public.stores s ON s.id = c.store_id
WHERE g.group_key LIKE 'milk:%' GROUP BY 1, 2 ORDER BY 1, 2;
${tryb === 'zapis' ? 'COMMIT;' : 'ROLLBACK;\nSELECT \'Tryb próbny: wszystkie zmiany wycofane (ROLLBACK).\' AS wynik;'}
`;
}

function main() {
  const i = process.argv.indexOf('--dane');
  if (i < 0 || !process.argv[i + 1]) throw new Error('Użycie: node scripts/import/import-katalogu.mjs --dane <folder> [--zapis]');
  const tryb = process.argv.includes('--zapis') ? 'zapis' : 'proba';
  const m = process.argv.indexOf('--z-migracja');
  const migracja = m >= 0 ? fs.readFileSync(path.resolve(process.argv[m + 1]), 'utf8') : null;
  const dane = path.resolve(process.argv[i + 1]);
  const { obserwacje, pliki } = wczytajZrodla(dane);
  const { pozycje, pominiete, listaPominietych } = pozycjeZObserwacji(obserwacje);
  const podsumowanie = { obserwacje: obserwacje.length, pozycje: pozycje.length, pominiete, slownik: ZRODLO_SLOWNIKA,
    pozycje_na_siec: Object.fromEntries(['biedronka', 'lidl', 'kaufland', 'carrefour', 'dino'].map(s => [s, pozycje.filter(p => p.siec === s).length])),
    z_cena_regularna: pozycje.filter(p => p.cena_regularna !== null).length,
    z_promocja: pozycje.filter(p => p.promocja).length,
    promocje_do_naliczenia: pozycje.filter(p => p.promocja?.zasieg === 'nationwide').length };
  const katalog = path.join(dane, 'raporty_importu');
  fs.mkdirSync(katalog, { recursive: true });
  const stempel = new Date().toISOString().replace(/[:.]/g, '-');
  const plikSql = path.join(katalog, `import-${stempel}-${tryb}.sql`);
  const plikiWzgledne = pliki.map(p => ({ ...p, sciezka: path.relative(dane, p.sciezka).replace(/\\/g, '/') }));
  fs.writeFileSync(plikSql, sqlImportu(pozycje, { tryb, pliki: plikiWzgledne, podsumowanie, migracja }), { flag: 'wx' });
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
