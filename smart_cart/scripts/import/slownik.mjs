// Przypisanie nazwy produktu do produktu bazowego - wierne przeniesienie assign_base_product_fast
// z base_dictionary.py (reguły w slownik-produktow-bazowych.json, kolejność ma znaczenie).
import fs from 'node:fs';

const SLOWNIK = JSON.parse(fs.readFileSync(new URL('./slownik-produktow-bazowych.json', import.meta.url), 'utf8'));
// Rozszerzenie (19.11.2026): nowe produkty bazowe "pozostałe …" sprawdzane dopiero po regułach oryginalnych.
export const ROZSZERZENIE = JSON.parse(fs.readFileSync(new URL('./slownik-rozszerzenie.json', import.meta.url), 'utf8')).reguly;

// Python (re, str) traktuje polskie litery jako znaki słowa w \b; JavaScript nie. Zamieniamy \b na granicę Unicode.
// Granica jest jednostronna (szybka): przed słowem "nie poprzedza go litera", po słowie "nie następuje litera".
// Znaki słowa jak w Pythonie dla tekstów polskich: litery łacińskie z diakrytykami, cyfry i '_'.
const LITERA = 'A-Za-z0-9_\u00C0-\u024F';
const POCZATEK = `(?<![${LITERA}])`;
const KONIEC = `(?![${LITERA}])`;
export function wyrazenie(wzorzec) {
  const wynik = wzorzec.replace(/\\b/g, (_, pozycja) => {
    const nastepny = wzorzec[pozycja + 2];
    return nastepny === undefined || nastepny === '|' || nastepny === ')' ? KONIEC : POCZATEK;
  });
  return new RegExp(wynik, 'i');
}

const CZARNA_LISTA = wyrazenie(SLOWNIK.czarna_lista);
// Uzupełnienie czarnej listy po przeglądzie importu z 19.11.2026 (np. worki "Magnum" trafiały do lodów).
const DODATKOWE_WYKLUCZENIA = wyrazenie(String.raw`\b(worki|worek na|woda perfumowana|woda toaletowa|perfumy|zabawka|zestaw prezentowy|lego|zeszyt|kitten|puppy|animonda|royal canin|perfect fit|gourmet gold|gra|gry|puzzle|trefl|klocki|kredki|długopis|dlugopis|kubek|termos|ekspres do|patelnia|garnek)\b`);
// Alkohol nie jest importowany (decyzja z 19.11.2026), także piwo bezalkoholowe. Ocet winny zostaje.
const ALKOHOL = wyrazenie(String.raw`\b(piwo|piwa|wino|wina|wódka|wodka|likier|whisky|whiskey|bourbon|rum|gin|nalewka|cydr|cider|prosecco|szampan|brandy|koniak|cognac|radler|tequila|wermut|vermouth|aperol|martini|alkohol\w*|browar|porter|lager|stout|pils|koźlak|kozlak|ipa)\b`);
const OCET = wyrazenie(String.raw`\bocet\b`);
const PRZETWORZONE = wyrazenie(SLOWNIK.przetworzone_nie_swieze);
const REGULY = [...SLOWNIK.reguly, ...ROZSZERZENIE].map(r => ({
  nazwa: r.nazwa,
  kategoria: r.kategoria,
  must: wyrazenie(r.must.join('|')),
  also: r.also.length ? wyrazenie(r.also.join('|')) : null,
  exc: r.exc.map(p => p.trim()).filter(Boolean).length
    ? wyrazenie(r.exc.map(p => p.trim()).filter(Boolean).map(p => String.raw`\b` + p).join('|')) : null,
}));

/** Zwraca { nazwa, kategoria } produktu bazowego albo null, gdy nazwa nie pasuje do żadnej reguły. */
export function produktBazowy(nazwaProduktu) {
  const n = String(nazwaProduktu ?? '').trim();
  if (!n || CZARNA_LISTA.test(n) || DODATKOWE_WYKLUCZENIA.test(n) || (ALKOHOL.test(n) && !OCET.test(n))) return null;
  for (const r of REGULY) {
    if (r.kategoria === 'Warzywa i Owoce' && r.nazwa !== SLOWNIK.wyjatek_swieze && PRZETWORZONE.test(n)) continue;
    if (r.exc && r.exc.test(n)) continue;
    if (!r.must.test(n)) continue;
    if (r.also && !r.also.test(n)) continue;
    // Piwo nie jest importowane (19.11.2026) - także rozpoznane po samej marce, bez słowa "piwo".
    if (r.nazwa.startsWith('Piwo')) return null;
    return { nazwa: r.nazwa, kategoria: r.kategoria };
  }
  return null;
}

export const ZRODLO_SLOWNIKA = { plik: SLOWNIK.zrodlo, sha256: SLOWNIK.sha256, reguly: REGULY.length, rozszerzenie: ROZSZERZENIE.length };

// Kategorie źródeł, których nie importujemy niezależnie od nazwy produktu.
const NIESPOZYWCZE = /chemia|kosmetyk|higien|dla zwierz|dom i ogr|odzie|przemys|zabawk|elektron|alkohol|apteka|zdrowie/i;
export const kategoriaNiespozywcza = kategoria => NIESPOZYWCZE.test(String(kategoria ?? ''));
