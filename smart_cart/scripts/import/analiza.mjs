// Analiza danych scraperów przed importem. Nie łączy się z bazą i nie zmienia plików źródłowych.
// Użycie (z katalogu smart_cart):
//   node scripts/import/analiza.mjs --dane C:/Users/.../Dane_sklepy_current
// Raport JSON trafia do <dane>/raporty_importu/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normTekst } from './normalizacja.mjs';
import { wczytajZrodla } from './zrodla.mjs';

const WYKLUCZENIA_MLEKA = /(kokos|soj|owsian|migdal|ryzow|czekolad|wanili|proszk|skondens|zageszcz|modyfikowan|bebi|bebilon|nan optipro|junior|kakao|baton|zelki|ser |serek|jogurt|kefir|maslank|smietan|deser|lody|krem|mus |kozie mleko zestaw|zestaw|fermentowan|napoj)/;
export const czyMleko = nazwa => {
  const n = normTekst(nazwa);
  return /\bmleko\b/.test(n) && !WYKLUCZENIA_MLEKA.test(n);
};

export function podsumuj(obserwacje) {
  const wynik = {};
  for (const o of obserwacje) {
    const s = (wynik[o.siec] ??= {});
    const z = (s[o.zrodlo] ??= { rekordy: 0, widoczne: 0, cena_regularna: 0, oferta_okresowa: 0, cena_nieokreslona: 0,
      z_iloscia: 0, za_wage: 0, z_ean: 0, mleko: 0, mleko_z_cena_regularna: 0, uwagi: {} });
    z.rekordy++;
    if (o.widoczny) z.widoczne++;
    if (o.cena_regularna) z.cena_regularna++;
    if (o.oferta_okresowa) z.oferta_okresowa++;
    if (o.cena_nieokreslona) z.cena_nieokreslona++;
    if (o.ilosc) z.z_iloscia++;
    if (o.za_wage) z.za_wage++;
    if (o.ean) z.z_ean++;
    if (czyMleko(o.nazwa)) { z.mleko++; if (o.cena_regularna) z.mleko_z_cena_regularna++; }
    for (const u of o.uwagi) z.uwagi[u] = (z.uwagi[u] ?? 0) + 1;
  }
  return wynik;
}

function main() {
  const i = process.argv.indexOf('--dane');
  if (i < 0 || !process.argv[i + 1]) throw new Error('Użycie: node scripts/import/analiza.mjs --dane <folder danych scraperów>');
  const dane = path.resolve(process.argv[i + 1]);
  const { obserwacje, pliki } = wczytajZrodla(dane);
  const raport = { utworzono: new Date().toISOString(), dane, pliki, podsumowanie: podsumuj(obserwacje),
    mleko: obserwacje.filter(o => czyMleko(o.nazwa)).map(o => ({ siec: o.siec, zrodlo: o.zrodlo, nazwa: o.nazwa, ilosc: o.ilosc,
      regularna: o.cena_regularna?.kwota ?? null, okresowa: o.oferta_okresowa?.kwota ?? null, obserwacja: o.cena_regularna?.obserwacja ?? o.oferta_okresowa?.obserwacja ?? null })) };
  const katalog = path.join(dane, 'raporty_importu');
  fs.mkdirSync(katalog, { recursive: true });
  const plik = path.join(katalog, `analiza-${raport.utworzono.replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(plik, JSON.stringify(raport, null, 2) + '\n', { flag: 'wx' });
  for (const [siec, zrodla] of Object.entries(raport.podsumowanie)) {
    console.log(`\n${siec.toUpperCase()}`);
    for (const [zrodlo, z] of Object.entries(zrodla)) {
      console.log(`  ${zrodlo.padEnd(17)} rekordy ${String(z.rekordy).padStart(6)} | regularna ${String(z.cena_regularna).padStart(6)} | okresowa ${String(z.oferta_okresowa).padStart(5)} | nieokreślona ${String(z.cena_nieokreslona).padStart(5)} | z ilością ${String(z.z_iloscia).padStart(6)} | mleko ${z.mleko} (z regularną ${z.mleko_z_cena_regularna})`);
    }
  }
  console.log(`\nRaport: ${plik}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
