// Normalizacja danych źródłowych importera katalogu. Czyste funkcje, bez sieci i bazy.

/** Tekst do porównań: małe litery, bez polskich znaków, tylko [a-z0-9%] i pojedyncze spacje (jak public.norm_text). */
export function normTekst(tekst) {
  return String(tekst ?? '')
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim();
}

/** Cena z tekstu ('3.99', '4,39 zł'). Brak, zero, wartość ujemna lub nieliczbowa -> null. */
export function cena(wartosc) {
  if (wartosc === null || wartosc === undefined) return null;
  const t = String(wartosc).trim().replace(',', '.').replace(/\s*(zł|zl|pln)\s*$/i, '');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const liczba = Number(t);
  return Number.isFinite(liczba) && liczba > 0 ? Math.round(liczba * 100) / 100 : null;
}

const JEDNOSTKI = { kg: ['g', 1000], dag: ['g', 10], g: ['g', 1], l: ['ml', 1000], cl: ['ml', 10], ml: ['ml', 1], szt: ['szt', 1] };
const LICZBA = String.raw`(\d+(?:[.,]\d+)?)`;
const JEDN = String.raw`(kg|dag|g|ml|cl|l|szt|sztuk)`;

function przelicz(wartosc, jednostka) {
  const [unit, mnoznik] = JEDNOSTKI[jednostka.startsWith('szt') ? 'szt' : jednostka];
  const value = Math.round(Number(wartosc.replace(',', '.')) * mnoznik * 100) / 100;
  return value > 0 ? { value, unit } : null;
}

/**
 * Ilość w opakowaniu z tekstu (gramatura lub nazwa).
 * Zwraca { value, unit: 'g'|'ml'|'szt', opakowania?: n } albo null, gdy nie da się jej jednoznacznie odczytać.
 * Obsługuje: '1l', '0,3 kg', '500 g', '4x100g', '(4 x 82,5 g)', '185/130g' (masa brutto), '10 szt.'.
 * '450 g (15 sztuk)' to 450 g (poza jajami, słodzikiem i bulionem w kostkach, które zostają w sztukach).
 * Liczby z '%' (tłuszcz) są ignorowane. Sam 'kg' bez liczby to cena za kg, nie opakowanie - zwraca null.
 */
export function ilosc(tekst) {
  let t = String(tekst ?? '').toLowerCase().replace(/ /g, ' ');
  if (!t.trim()) return null;
  t = t.replace(new RegExp(String.raw`\b(\d+)\s*/\s*\d+\s*${JEDN}\b`, 'g'), '$1$2');
  const wielopak = [...t.matchAll(new RegExp(String.raw`(\d+)\s*[x×*]\s*${LICZBA}\s*${JEDN}\b`, 'g'))];
  if (wielopak.length) {
    const [, ile, wartosc, jednostka] = wielopak.at(-1);
    const jedna = przelicz(wartosc, jednostka);
    if (!jedna || Number(ile) < 1) return null;
    return { value: Math.round(jedna.value * Number(ile) * 100) / 100, unit: jedna.unit, opakowania: Number(ile) };
  }
  // „450 g (15 sztuk)” (Carrefour): opakowanie to 450 g, liczba sztuk tylko je opisuje. Wyjątki liczone w sztukach:
  // jaja, słodzik w tabletkach, bulion / rosół w kostkach.
  const wagaISztuki = t.match(new RegExp(String.raw`(?<![\d,]|\d\.)${LICZBA}\s*(kg|dag|g|ml|cl|l)\.?\s*\(\s*\d+\s*(?:szt|sztuk)\.?\s*\)`));
  if (wagaISztuki && !/jaj|słodzik|slodzik|bulion|rosół|rosol/.test(t)) return przelicz(wagaISztuki[1], wagaISztuki[2]);
  const trafienia = [...t.matchAll(new RegExp(String.raw`(?<![\d,]|\d\.)${LICZBA}\s*${JEDN}\.?(?![a-ząćęłńóśźż])`, 'g'))];
  if (!trafienia.length) return null;
  const [, wartosc, jednostka] = trafienia.at(-1);
  return przelicz(wartosc, jednostka);
}

/** Czy tekst wskazuje cenę za wagę (luzem), np. 'Cytryna kg', 'za 1 kg', jednostka 'kg' lub '100g'. */
export function cenaZaWage(nazwa, jednostkaZrodla = '') {
  const j = String(jednostkaZrodla).trim().toLowerCase();
  if (j === 'kg') return { value: 1000, unit: 'g' };
  if (j === '100g') return { value: 100, unit: 'g' };
  const n = normTekst(nazwa);
  if (/(^| )(za )?(1 )?kg$/.test(n) || /\b(luzem|na wage|cena za kg)\b/.test(n)) return { value: 1000, unit: 'g' };
  return null;
}

/** Cena poza promocją podana wprost w opisie warunku, np. 'cena za 1 szt. poza promocją: 3,69 zł'. */
export function cenaPozaPromocja(warunek) {
  const m = String(warunek ?? '').match(/poza promocj[aą][^0-9]{0,20}(\d+[.,]\d{2})\s*zł/i);
  return m ? cena(m[1]) : null;
}

/** Wymagania promocji odczytane z opisu. Nie zgadujemy: tylko jednoznaczne frazy. */
export function warunkiPromocji(tekst) {
  const t = normTekst(tekst);
  return {
    karta_lub_aplikacja: /\bz karta\b|\bkarta\b|\bkarty\b|aplikacj|moja biedronka|lidl plus|kaufland card/.test(t),
    mieszanie_produktow: /mieszaj|dowoln\w* produkt|rozne rodzaje|rozne smaki|rozne warianty/.test(t),
    limit: /\blimit\w*\b/.test(t),
  };
}

/**
 * Wzorzec ilości w nazwie ('500 g', '1,5 l', '4x100 g', '340/285g', '10 szt.'). Ten sam tekst jest używany w SQL
 * (pg_temp.rdzen w imporcie), więc zawiera tylko składnię wspólną dla JavaScriptu i PostgreSQL.
 */
export const WZORZEC_ILOSCI_W_NAZWIE = String.raw`(?<![0-9,])([0-9]+\s*/\s*)?([0-9]+\s*[x×*]\s*)?[0-9]+([.,][0-9]+)?\s*(kg|dag|gr|g|ml|cl|l|szt|sztuk|op)\.?(?![a-z0-9ąćęłńóśźż])`;

/** Nazwa bez ilości opakowania, znormalizowana: 'Awokado Hass 1 szt.' i 'Awokado Hass' dają 'awokado hass'. Procenty zostają. */
export function rdzenNazwy(nazwa) {
  return normTekst(String(nazwa ?? '').toLowerCase().replace(new RegExp(WZORZEC_ILOSCI_W_NAZWIE, 'g'), ' '));
}
