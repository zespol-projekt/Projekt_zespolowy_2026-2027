// Przegląd mleka: wypełniona lista (CSV z mleko-do-przegladu.sql) -> plik SQL z decyzjami.
// Skrypt nie łączy się z bazą. Plik uruchamia się przez psql jak import: najpierw próba (ROLLBACK), potem --zapis (COMMIT).
//
//   node scripts/mleko/przeglad-mleka.mjs <wypelniona-lista.csv> [--zapis]
//
// Kolumny CSV: produkt_id; ...; tluszcz; laktoza; rodzaj; uwagi  (separator ; albo ,; UTF-8 albo Windows-1250 z Excela)
//   rodzaj: UHT | świeże | pomiń   (puste = jeszcze bez decyzji, wiersz pomijany)
//   tluszcz: np. 3,2 ; laktoza: z laktozą | bez laktozy
// Decyzja "UHT"/"świeże" przypisuje produkt do tej samej grupy, co reguła automatyczna (public.milk_group), z oznaczeniem
// classification_source='reviewed' i wpisem w catalog_reviews. "pomiń" zapisuje tylko decyzję (produkt zostaje osobno
// i nie wraca na listę). Pusta stara grupa używana na listach/w ulubionych jest scalana z nową (settle_regrouped).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function czytajTekst(bufor) {
  const utf8 = new TextDecoder('utf-8').decode(bufor);
  const tekst = utf8.includes('�') ? new TextDecoder('windows-1250').decode(bufor) : utf8;
  return tekst.replace(/^﻿/, '');
}

export function parsujCsv(tekst) {
  const pierwsza = tekst.split(/\r?\n/, 1)[0];
  const sep = (pierwsza.match(/;/g) ?? []).length >= (pierwsza.match(/,/g) ?? []).length ? ';' : ',';
  const wiersze = []; let pole = ''; let wiersz = []; let cudz = false;
  for (let i = 0; i < tekst.length; i++) {
    const c = tekst[i];
    if (cudz) {
      if (c === '"' && tekst[i + 1] === '"') { pole += '"'; i++; } else if (c === '"') cudz = false; else pole += c;
    } else if (c === '"') cudz = true;
    else if (c === sep) { wiersz.push(pole); pole = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && tekst[i + 1] === '\n') i++;
      wiersz.push(pole); pole = '';
      if (wiersz.some(x => x !== '')) wiersze.push(wiersz);
      wiersz = [];
    } else pole += c;
  }
  if (pole !== '' || wiersz.length) { wiersz.push(pole); if (wiersz.some(x => x !== '')) wiersze.push(wiersz); }
  const [naglowek, ...dane] = wiersze;
  const kol = naglowek.map(h => h.trim().toLowerCase());
  return dane.map(w => Object.fromEntries(kol.map((k, i) => [k, (w[i] ?? '').trim()])));
}

const bezOgonkow = s => s.toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

/** Decyzja z wiersza: { produkt, decyzja: 'group'|'skip', rodzaj, tluszcz, laktoza, uwagi } | null (bez decyzji) | { blad }. */
export function decyzja(w, nr) {
  const produkt = Number(w.produkt_id);
  if (!Number.isInteger(produkt) || produkt <= 0) return { blad: `wiersz ${nr}: brak poprawnego produkt_id` };
  const r = bezOgonkow(w.rodzaj ?? '');
  if (!r) return null;
  const uwagi = (w.uwagi ?? '').slice(0, 500);
  // Uszkodzone przez kodowanie „pomiń”/„świeże” (np. pomi�) też rozpoznajemy po początku słowa.
  if (r.startsWith('pom') || r === 'skip' || r === 'x') return { produkt, decyzja: 'skip', uwagi };
  const rodzaj = r === 'uht' || r === 'u' ? 'UHT' : r.startsWith('s') || r.includes('wie') ? 'świeże' : null;
  if (!rodzaj) return { blad: `wiersz ${nr} (produkt ${produkt}): nieznany rodzaj "${w.rodzaj}" (UHT / świeże / pomiń)` };
  const tluszcz = Number(String(w.tluszcz ?? '').replace(',', '.').replace('%', '').trim());
  if (!w.tluszcz || !Number.isFinite(tluszcz) || tluszcz < 0 || tluszcz > 10) return { blad: `wiersz ${nr} (produkt ${produkt}): podaj tłuszcz 0-10, np. 3,2` };
  const l = bezOgonkow(w.laktoza ?? '');
  const laktoza = l.startsWith('bez') ? 'bez laktozy' : l.startsWith('z') || l === '' ? 'z laktozą' : null;
  if (!laktoza) return { blad: `wiersz ${nr} (produkt ${produkt}): laktoza "z laktozą" albo "bez laktozy"` };
  return { produkt, decyzja: 'group', rodzaj, tluszcz, laktoza, uwagi };
}

const lit = v => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

export function sqlPrzegladu(decyzje, { tryb = 'proba', zrodlo = 'przeglad-mleka' } = {}) {
  const linie = [
    `-- Przegląd mleka: ${decyzje.length} decyzji, tryb: ${tryb}. Wygenerowane przez scripts/mleko/przeglad-mleka.mjs.`,
    '\\set ON_ERROR_STOP on', 'BEGIN;',
    'CREATE TEMP TABLE przeglad_przeniesienia(old_id bigint, new_id bigint) ON COMMIT DROP;',
  ];
  for (const d of decyzje) {
    const szczegoly = JSON.stringify(d.decyzja === 'group'
      ? { rodzaj: d.rodzaj, tluszcz: d.tluszcz, laktoza: d.laktoza, uwagi: d.uwagi || undefined } : { uwagi: d.uwagi || undefined });
    if (d.decyzja === 'skip') {
      linie.push(`DO $p$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = ${d.produkt}) THEN RAISE EXCEPTION 'Brak produktu ${d.produkt}'; END IF;
  INSERT INTO public.catalog_reviews(product_id, topic, decision, details, source) VALUES (${d.produkt}, 'milk', 'skip', ${lit(szczegoly)}::jsonb, ${lit(zrodlo)});
END $p$;`);
      continue;
    }
    linie.push(`DO $p$ DECLARE p record; g text[]; gid bigint; BEGIN
  SELECT id, base_product_id, canonical_name, quantity_unit, comparison_group_id INTO p FROM public.products WHERE id = ${d.produkt} FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Brak produktu ${d.produkt}'; END IF;
  IF p.quantity_unit IS DISTINCT FROM 'ml' THEN RAISE EXCEPTION 'Produkt ${d.produkt} nie jest w ml'; END IF;
  g := public.milk_group(${lit(d.rodzaj)}, ${d.tluszcz}, ${lit(d.laktoza)}, p.canonical_name);
  IF g IS NULL THEN RAISE EXCEPTION 'Nie da się ustalić grupy dla produktu ${d.produkt}'; END IF;
  INSERT INTO public.comparison_groups(group_key, base_product_id, name, normalized_name, unit)
    VALUES (g[1], p.base_product_id, g[2], public.norm_text(g[2]), 'ml') ON CONFLICT (group_key) DO NOTHING;
  SELECT id INTO gid FROM public.comparison_groups WHERE group_key = g[1] AND unit = 'ml';
  IF gid IS NULL THEN RAISE EXCEPTION 'Grupa % ma inną jednostkę', g[1]; END IF;
  UPDATE public.products SET comparison_group_id = gid, classification_source = 'reviewed' WHERE id = p.id;
  INSERT INTO public.catalog_reviews(product_id, topic, decision, group_key, details, source) VALUES (p.id, 'milk', 'group', g[1], ${lit(szczegoly)}::jsonb, ${lit(zrodlo)});
  INSERT INTO przeglad_przeniesienia VALUES (p.comparison_group_id, gid);
END $p$;`);
  }
  linie.push(
    `SELECT public.settle_regrouped(coalesce((SELECT jsonb_agg(jsonb_build_object('old', old_id, 'new', new_id)) FROM przeglad_przeniesienia), '[]'), ${lit(`Przegląd mleka (${zrodlo})`)}) AS porzadkowanie_grup;`,
    `SELECT decision AS decyzja, count(*) AS produkty FROM public.catalog_reviews WHERE topic = 'milk' AND source = ${lit(zrodlo)} GROUP BY 1 ORDER BY 1;`,
    `SELECT g.name AS grupa_mleka, s.slug AS siec, count(DISTINCT c.product_id) AS produkty, count(*) FILTER (WHERE c.single_price IS NOT NULL) AS z_cena_dzis
FROM public.catalog_offers c JOIN public.comparison_groups g ON g.id = c.group_id JOIN public.stores s ON s.id = c.store_id
WHERE g.group_key LIKE 'milk:%' GROUP BY 1, 2 ORDER BY 1, 2;`,
    tryb === 'zapis' ? 'COMMIT;' : 'ROLLBACK;',
    tryb === 'zapis' ? "SELECT 'Zapisano decyzje przeglądu mleka (COMMIT).' AS wynik;" : "SELECT 'Tryb próbny: wszystkie zmiany wycofane (ROLLBACK).' AS wynik;",
  );
  return linie.join('\n') + '\n';
}

function main() {
  const plik = process.argv[2];
  if (!plik || plik.startsWith('--')) throw new Error('Użycie: node scripts/mleko/przeglad-mleka.mjs <wypelniona-lista.csv> [--zapis]');
  const tryb = process.argv.includes('--zapis') ? 'zapis' : 'proba';
  const wiersze = parsujCsv(czytajTekst(fs.readFileSync(plik)));
  const decyzje = []; const bledy = []; let bez = 0;
  wiersze.forEach((w, i) => {
    const d = decyzja(w, i + 2);
    if (d === null) bez++; else if (d.blad) bledy.push(d.blad); else decyzje.push(d);
  });
  const powtorzone = decyzje.map(d => d.produkt).filter((p, i, a) => a.indexOf(p) !== i);
  if (powtorzone.length) bledy.push(`powtórzone produkt_id: ${[...new Set(powtorzone)].join(', ')}`);
  if (bledy.length) { console.error(`Popraw listę (nic nie wygenerowano):\n- ${bledy.join('\n- ')}`); process.exitCode = 1; return; }
  const stempel = new Date().toISOString().replace(/[:.]/g, '-');
  const wyjscie = path.join(path.dirname(path.resolve(plik)), `mleko-przeglad-${stempel}-${tryb}.sql`);
  fs.writeFileSync(wyjscie, sqlPrzegladu(decyzje, { tryb, zrodlo: `${path.basename(plik)} ${stempel}` }));
  const ile = r => decyzje.filter(d => (r === 'skip' ? d.decyzja === 'skip' : d.rodzaj === r)).length;
  console.log(`Decyzje: UHT ${ile('UHT')}, świeże ${ile('świeże')}, pomiń ${ile('skip')}; bez decyzji (pominięte): ${bez}.`);
  console.log(`SQL (${tryb}): ${wyjscie}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error(`Błąd: ${e.message}`); process.exitCode = 1; }
}
