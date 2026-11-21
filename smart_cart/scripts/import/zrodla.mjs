// Odczyt plików scraperów (folder zrodla_v2) do jednolitych "obserwacji". Bez sieci i bazy.
// Zasady: cena promocyjna/gazetkowa nigdy nie staje się ceną regularną; każda cena ma datę obserwacji;
// niczego nie zgadujemy (brak ilości, EAN lub typu ceny zostaje brakiem z uwagą).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { cena, cenaPozaPromocja, cenaZaWage, ilosc, normTekst, warunkiPromocji } from './normalizacja.mjs';

export const SIECI = ['biedronka', 'lidl', 'kaufland', 'carrefour', 'dino'];

/** Parser CSV zgodny z modułem csv Pythona (separator ';', cudzysłowy, BOM, nowe linie w polach). */
export function parsujCsv(tekst, separator = ';') {
  const t = tekst.replace(/^﻿/, '');
  const wiersze = [];
  let pole = '', wiersz = [], wCudzyslowie = false;
  for (let i = 0; i < t.length; i++) {
    const z = t[i];
    if (wCudzyslowie) {
      if (z === '"') {
        if (t[i + 1] === '"') { pole += '"'; i++; } else wCudzyslowie = false;
      } else pole += z;
    } else if (z === '"' && pole === '') wCudzyslowie = true;
    else if (z === separator) { wiersz.push(pole); pole = ''; }
    else if (z === '\n' || z === '\r') {
      if (z === '\r' && t[i + 1] === '\n') i++;
      wiersz.push(pole); pole = '';
      if (wiersz.length > 1 || wiersz[0] !== '') wiersze.push(wiersz);
      wiersz = [];
    } else pole += z;
  }
  if (wCudzyslowie) throw new Error('Niezamknięty cudzysłów w CSV');
  if (pole !== '' || wiersz.length) { wiersz.push(pole); wiersze.push(wiersz); }
  if (!wiersze.length) return [];
  const [naglowek, ...dane] = wiersze;
  return dane.map((w, nr) => {
    if (w.length !== naglowek.length) throw new Error(`Wiersz ${nr + 2}: ${w.length} pól zamiast ${naglowek.length}`);
    return Object.fromEntries(naglowek.map((k, j) => [k, w[j]]));
  });
}

function wczytajPlik(sciezka, pliki) {
  const bajty = fs.readFileSync(sciezka);
  const wiersze = parsujCsv(bajty.toString('utf8'));
  pliki.push({ sciezka, sha256: crypto.createHash('sha256').update(bajty).digest('hex'), wiersze: wiersze.length });
  return wiersze;
}

const pusty = v => (v ?? '').trim() === '';
const dzien = iso => (/^\d{4}-\d{2}-\d{2}/.test(iso ?? '') ? iso.slice(0, 10) : null);

function bazowa(zrodlo, siec, klucz, w, { nazwa, marka = '', gramatura = '', ean = null, kategoria = '', zdjecie = '', link = '', jednostka = '' }) {
  // Ilość z nazwy ma pierwszeństwo: pole gramatury w źródle bywa sprzeczne z nazwą (np. nazwa 400 g, pole 500 g).
  const ilosc_ = ilosc(nazwa) ?? ilosc(gramatura);
  return {
    zrodlo, siec, klucz_zrodla: `${zrodlo}:${siec}:${klucz}`,
    ean: ean && /^\d{8,14}$/.test(ean) ? ean : null,
    nazwa, marka, gramatura_tekst: gramatura, ilosc: ilosc_,
    za_wage: ilosc_ ? null : cenaZaWage(nazwa, jednostka),
    kategoria_zrodla: kategoria, zdjecie: zdjecie || null, link: link || null,
    widoczny: w.widoczny_w_ostatnim_pobraniu !== 'nie',
    cena_regularna: null, oferta_okresowa: null, cena_nieokreslona: null, uwagi: [],
  };
}

/** antonka (bieżące lub historia). Cena bez okresu ważności jest regularna tylko dla Carrefour (sklep internetowy). */
export function obserwacjaAntonka(w, siec, historia = false) {
  const zrodlo = historia ? 'antonka_historia' : 'antonka';
  const klucz = !pusty(w.id_zewnetrzne) ? `ext:${w.id_zewnetrzne}` : `nazwa:${normTekst(w.nazwa)}|${normTekst(w.ilosc_gramatura)}`;
  const o = bazowa(zrodlo, siec, klucz, w, { nazwa: w.nazwa, gramatura: w.ilosc_gramatura, zdjecie: w.zdjecie_url });
  const kwota = cena(w.cena);
  const obserwacja = historia ? (w.data_obserwacji || null) : (dzien(w.ostatnia_aktualizacja) ?? dzien(w.cena_widziana));
  if (kwota === null) { o.uwagi.push('brak_ceny'); return o; }
  if (!obserwacja) o.uwagi.push('brak_daty_obserwacji');
  if (!pusty(w.wazne_do)) {
    o.oferta_okresowa = { kwota, wazne_od: null, wazne_do: w.wazne_do_iso || null, typ: 'gazetka', warunek: null,
      karta_lub_aplikacja: false, mieszanie_produktow: false, limit: false, szacowana: false, obserwacja };
    if (!w.wazne_do_iso) o.uwagi.push('nierozpoznana_data_waznosci');
  } else if (siec === 'carrefour') {
    o.cena_regularna = { kwota, obserwacja, podstawa: 'sklep_internetowy_bez_okresu' };
  } else {
    // Brak daty ważności nie dowodzi ceny regularnej (stary skrypt kasował wygasłe daty).
    o.cena_nieokreslona = { kwota, obserwacja };
    o.uwagi.push('typ_ceny_nieznany');
  }
  return o;
}

/** tanszykoszyk: dane z gazetek. Regularna tylko, gdy opis wprost podaje cenę "poza promocją". */
export function obserwacjaTanszykoszyk(w, siec) {
  const klucz = !pusty(w.id_zrodla) ? `id:${w.id_zrodla}` : `nazwa:${normTekst(w.nazwa)}|${normTekst(w.marka)}|${normTekst(w.gramatura)}`;
  const o = bazowa('tanszykoszyk', siec, klucz, w, { nazwa: w.nazwa, marka: w.marka, gramatura: w.gramatura,
    kategoria: w.kategoria, zdjecie: w.zdjecie_glowne || w.zdjecie_promo, link: w.link_zrodla ? `https://tanszykoszyk.pl${w.link_zrodla}` : '',
    jednostka: w.jednostka });
  const obserwacja = dzien(w.ostatnio_widziane) ?? dzien(w.cena_regularna_widziana);
  const pozaPromocja = cenaPozaPromocja(w.warunek);
  if (pozaPromocja !== null) o.cena_regularna = { kwota: pozaPromocja, obserwacja, podstawa: 'opis_promocji_poza_promocja' };
  const promo = cena(w.cena_promocyjna);
  if (promo !== null || !pusty(w.typ_promocji)) {
    const warunki = warunkiPromocji(w.warunek);
    o.oferta_okresowa = { kwota: promo, wazne_od: dzien(w.wazne_od), wazne_do: dzien(w.wazne_do), typ: w.typ_promocji || 'gazetka',
      warunek: w.warunek || null, ...warunki, szacowana: w.cena_szacowana === 'tak', obserwacja,
      cena_odniesienia: cena(w.cena_regularna) ?? cena(w.cena_regularna_promocji), etykieta_odniesienia: w.etykieta_ceny || null,
      gazetka: w.gazetka_id ? { id: w.gazetka_id, strony: w.gazetka_strony || null } : null };
    if (o.oferta_okresowa.szacowana) o.uwagi.push('cena_szacowana_przez_zrodlo');
    if (promo === null) o.uwagi.push('promocja_bez_ceny_jednostkowej');
  }
  if (!o.cena_regularna && !pusty(w.cena_regularna)) o.uwagi.push('cena_odniesienia_nie_jest_regularna');
  return o;
}

/** kodyzbiedry: katalog Biedronki po EAN. Źródło nie podaje daty ceny - datą jest nasze pobranie. */
export function obserwacjaKodyzbiedry(w) {
  const o = bazowa('kodyzbiedry', 'biedronka', `ean:${w.ean}`, w, { nazwa: w.nazwa, marka: w.marka, ean: w.ean,
    kategoria: w.kategorie_wszystkie || w.kategoria, zdjecie: w.zdjecie, link: w.link_zrodla, jednostka: '' });
  const kwota = cena(w.cena);
  if (kwota === null) { o.uwagi.push('brak_ceny'); return o; }
  o.cena_regularna = { kwota, obserwacja: dzien(w.cena_widziana), podstawa: 'katalog_bez_daty_zrodla' };
  o.uwagi.push('data_z_pobrania');
  return o;
}

/** Wczytuje wszystkie źródła z folderu danych scraperów. */
export function wczytajZrodla(katalogDanych, { sieci = SIECI } = {}) {
  const baza = path.join(katalogDanych, 'zrodla_v2');
  if (!fs.existsSync(baza)) throw new Error(`Brak folderu ${baza}`);
  const pliki = [];
  const obserwacje = [];
  for (const siec of sieci) {
    for (const [folder, historia] of [['antonka', false], ['antonka_historia', true]]) {
      const plik = path.join(baza, folder, `${siec}.csv`);
      if (fs.existsSync(plik)) for (const w of wczytajPlik(plik, pliki)) obserwacje.push(obserwacjaAntonka(w, siec, historia));
    }
    const plik = path.join(baza, 'tanszykoszyk', `${siec}.csv`);
    if (fs.existsSync(plik)) for (const w of wczytajPlik(plik, pliki)) obserwacje.push(obserwacjaTanszykoszyk(w, siec));
  }
  const kody = path.join(baza, 'kodyzbiedry', 'produkty_biedronka_all.csv');
  if (sieci.includes('biedronka') && fs.existsSync(kody)) for (const w of wczytajPlik(kody, pliki)) obserwacje.push(obserwacjaKodyzbiedry(w));
  return { obserwacje, pliki };
}
