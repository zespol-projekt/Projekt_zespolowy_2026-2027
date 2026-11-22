// TRYB TESTOWY (22.11.2026, gałąź feat/damian-ceny-regularne): cena regularna wyliczona z ceny promocyjnej.
// Włączany tylko opcją importera --regularne-z-promocji. Domyślny import działa jak dotąd: cen nie wyliczamy.
// Uwaga: Damian.MD wyklucza ceny szacowane z porównania. Ten tryb służy do testów i do pokazania pomysłu zespołowi;
// wyliczone ceny są w bazie rozpoznawalne po price_source = 'wyliczona_z_promocji' i znikają po zwykłym imporcie.
//
// Kiedy liczymy: pozycja nie ma żadnej potwierdzonej ceny regularnej, a ma promocję z ceną.
// Jak liczymy (w tej kolejności):
//   1. mechanika promocji podana wprost w typie lub warunku (cena promocyjna to cena 1 sztuki przy spełnionym warunku):
//      "N+M gratis"            R = P·(N+M)/N
//      "N+M za grosz"          R = (P·(N+M) − 0,01·M)/N
//      "drugi X% taniej"       R = 2P / (2 − X/100)
//      "drugi za Y zł"         R = 2P − Y
//      "-X%", "X% taniej", "rabat X%"   R = P / (1 − X/100)
//   2. w pozostałych przypadkach (obniżka, supercena, "przy zakupie N", gazetka bez opisu): R = P / w, gdzie w to mediana
//      stosunku cena promocyjna / cena odniesienia z naszych danych, osobno dla sieci i rodzaju promocji.
//      Pary do nauki: cena "poza promocją" z opisu oraz cena odniesienia oznaczona jako "przed obniżką" lub "inna".
//      Ceny "najniższa z 30 dni" (Omnibus) nie uczą współczynnika: bywają ceną poprzedniej promocji.
import { normTekst } from './normalizacja.mjs';

export const ZRODLO_WYLICZONEJ = 'wyliczona_z_promocji';
const MIN_PAR = 10;

const zaokr = v => Math.round(v * 100) / 100;
const liczba = t => Number(String(t).replace(',', '.'));

/** Rodzaj promocji do współczynnika: 'jednostkowa' albo 'przy_zakupie'. */
export function rodzajPromocji(typ) {
  return /^przy zakupie \d{1,3}( szt)?$/.test(normTekst(typ ?? '')) ? 'przy_zakupie' : 'jednostkowa';
}

/** Cena regularna z mechaniki promocji opisanej wprost albo null. Zwraca { kwota, metoda }. */
export function zMechaniki(p, typ, warunek) {
  const t = `${typ ?? ''} ${warunek ?? ''}`.toLowerCase();
  let m;
  if ((m = t.match(/(\d{1,2})\s*\+\s*(\d{1,2})\s*(gratis|za\s*(1\s*)?gr(osz)?\b)/))) {
    const n = Number(m[1]); const k = Number(m[2]);
    if (n >= 1 && k >= 1) return { kwota: /gratis/.test(m[3]) ? p * (n + k) / n : (p * (n + k) - 0.01 * k) / n, metoda: `${n}+${k}` };
  }
  if ((m = t.match(/drug\w*\s+(\d{1,2})\s*%\s*tanie/))) {
    const x = Number(m[1]) / 100;
    if (x > 0 && x <= 1) return { kwota: 2 * p / (2 - x), metoda: 'drugi_procent_taniej' };
  }
  if ((m = t.match(/drug\w*\s+za\s+(\d+(?:[.,]\d{1,2})?)\s*z/))) {
    const y = liczba(m[1]);
    if (y < p) return { kwota: 2 * p - y, metoda: 'drugi_za_kwote' };
  }
  if ((m = t.match(/-\s?(\d{1,2})\s?%|(\d{1,2})\s?%\s*taniej|rabat\w*\s+(\d{1,2})\s?%/))) {
    const x = Number(m[1] ?? m[2] ?? m[3]) / 100;
    if (x > 0 && x < 0.9) return { kwota: p / (1 - x), metoda: 'rabat_procentowy' };
  }
  return null;
}

/** Cena odniesienia do nauki współczynnika (bez ceny "najniższa z 30 dni"). */
function cenaOdniesienia(o) {
  const of = o.oferta_okresowa;
  if (o.cena_regularna?.podstawa === 'opis_promocji_poza_promocja') return o.cena_regularna.kwota;
  if (of && ['przed_obnizka', 'inna'].includes(of.etykieta_odniesienia)) return of.cena_odniesienia ?? null;
  return null;
}

/** Współczynniki w[siec][rodzaj] = mediana (cena promocyjna / cena odniesienia) z obserwacji tanszykoszyk. */
export function wspolczynniki(obserwacje) {
  const pary = {};
  const dodaj = (k, r) => { (pary[k] ??= []).push(r); };
  for (const o of obserwacje) {
    const of = o.oferta_okresowa;
    if (o.zrodlo !== 'tanszykoszyk' || !of || of.kwota === null || of.szacowana) continue;
    if (zMechaniki(of.kwota, of.typ, of.warunek)) continue; // mechanika liczona wzorem, nie współczynnikiem
    const ref = cenaOdniesienia(o);
    if (!ref || ref <= of.kwota) continue;
    const r = of.kwota / ref;
    if (r < 0.2) continue;
    const rodzaj = rodzajPromocji(of.typ);
    dodaj(`${o.siec}|${rodzaj}`, r); dodaj(`*|${rodzaj}`, r); dodaj(`${o.siec}|*`, r); dodaj('*|*', r);
  }
  const mediana = a => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
  const wynik = {};
  for (const [k, a] of Object.entries(pary)) wynik[k] = { wspolczynnik: Math.round(mediana(a) * 1000) / 1000, par: a.length };
  return wynik;
}

/** Współczynnik dla sieci i rodzaju: najpierw sieć+rodzaj, potem wszystkie sieci+rodzaj, potem sieć, potem wszystko. */
export function wybierzWspolczynnik(w, siec, rodzaj) {
  for (const k of [`${siec}|${rodzaj}`, `*|${rodzaj}`, `${siec}|*`, '*|*']) {
    if (w[k] && w[k].par >= MIN_PAR) return { ...w[k], klucz: k };
  }
  return null;
}

/** Wyliczona cena regularna dla promocji (P, typ, warunek) w sieci. Zwraca { kwota, metoda } albo null. */
export function wyliczRegularna(oferta, siec, w) {
  if (!oferta || oferta.kwota === null || oferta.kwota <= 0 || oferta.szacowana) return null;
  const p = oferta.kwota;
  let wynik = zMechaniki(p, oferta.typ, oferta.warunek);
  if (!wynik) {
    const ws = wybierzWspolczynnik(w, siec, rodzajPromocji(oferta.typ));
    if (!ws) return null;
    wynik = { kwota: p / ws.wspolczynnik, metoda: `wspolczynnik ${ws.klucz} ${ws.wspolczynnik}` };
  }
  const kwota = zaokr(wynik.kwota);
  if (!(kwota > p) || kwota > 5 * p) return null;
  return { kwota, metoda: wynik.metoda };
}
