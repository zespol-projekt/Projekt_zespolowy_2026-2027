// Odczyt aktualnych gazetek z oficjalnych stron sieci (sprawdzone 19.11.2026).
// Funkcje "parsuj*" są czyste (testowalne na zapisanych odpowiedziach); "znajdz*" pobierają dane przez przekazany fetch.
// Kaufland i Carrefour pokazują automatom weryfikację antybotową (Cloudflare) - jej nie omijamy;
// ich gazetki dodaje się ręcznie (polecenie "reczna" w gazetki.mjs).

export const ZRODLA = {
  biedronka: 'https://www.biedronka.pl/pl/gazetki',
  biedronkaApi: id => `https://leaflet-api.prod.biedronka.cloud/api/leaflets/${encodeURIComponent(id)}?ctx=web`,
  lidl: 'https://www.lidl.pl/c/nasze-gazetki/s10008614',
  lidlApi: id => `https://endpoints.leaflets.schwarz/v4/flyer?flyer_identifier=${encodeURIComponent(id)}&region_id=0&region_code=0`,
  lidlStrona: id => `https://www.lidl.pl/l/pl/gazetki/${encodeURIComponent(id)}/ar/0`,
  dino: 'https://marketdino.pl/gazetki/lista/standard',
  dinoDane: 'https://marketdino.pl/gazetki/lista/standard/_payload.json',
};

// Domyślnie: główne gazetki spożywcze, bez alkoholu i katalogów nieżywnościowych.
export const FILTRY = {
  biedronka: { tak: /codziennie-niskie-ceny|festiwal|oferta-od/, nie: /home|zabaw|wyprzeda|alko|toast|good-to-go|ebook|hity|katalog/ },
  lidl: { tak: /^gazetka-/, nie: /katalog|alkohol|win|zabaw/ },
  dino: { tak: /./, nie: /alko|wino|piw/i },
};

const DNI_DOMYSLNIE = 6;

/** Stabilne ID gazetki zgodne z kontraktem: [a-z0-9][a-z0-9_-]{0,79}. */
export function idGazetki(...czesci) {
  const s = czesci.join('-').toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^[-_]+|[-_]+$/g, '');
  return s.slice(0, 80).replace(/[-_]+$/, '');
}

export const dodajDni = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** Dzisiejsza data w Polsce (YYYY-MM-DD). */
export const dzisWPolsce = (teraz = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' }).format(teraz);

/** Data „DD-MM” bez roku: rok najbliższy dniu dzisiejszemu. */
export function dataBezRoku(dzien, miesiac, dzis) {
  const rok = Number(dzis.slice(0, 4));
  const kandydaci = [rok - 1, rok, rok + 1].map(r => `${r}-${String(miesiac).padStart(2, '0')}-${String(dzien).padStart(2, '0')}`);
  const t = Date.parse(`${dzis}T12:00:00Z`);
  return kandydaci.sort((a, b) => Math.abs(Date.parse(`${a}T12:00:00Z`) - t) - Math.abs(Date.parse(`${b}T12:00:00Z`) - t))[0];
}

// ---------- Biedronka ----------

/** Lista gazetek z /pl/gazetki: [{ ref, slug, url }] (bez gazetek „pressadult”, czyli alkoholowych). */
export function parsujListeBiedronki(html) {
  const wynik = new Map();
  for (const m of html.matchAll(/https:\/\/www\.biedronka\.pl\/pl\/press,id,([a-z0-9]+),title,([a-z0-9-]+)/g)) {
    if (!wynik.has(m[1])) wynik.set(m[1], { ref: m[1], slug: m[2], url: `https://www.biedronka.pl/pl/press,id,${m[1]},title,${m[2]}` });
  }
  return [...wynik.values()];
}

/** ID przeglądarki gazetki ze strony gazetki: galleryLeaflet.init("<uuid>"). */
export function parsujIdPrzegladarkiBiedronki(html) {
  return html.match(/galleryLeaflet\.init\(\s*["']([0-9a-f-]{36})["']/)?.[1] ?? null;
}

/** Tytuł gazetki z <title> strony („Codziennie niskie ceny P - oferta od 19.11 - Gazetka - Biedronka.pl”). */
export function parsujTytulBiedronki(html, slug = '') {
  const encje = { amp: '&', quot: '"', '#39': "'", apos: "'", lt: '<', gt: '>', nbsp: ' ' };
  const t = (html.match(/<title>([^<]{1,300})<\/title>/i)?.[1] ?? '')
    .replace(/&(amp|quot|#39|apos|lt|gt|nbsp);/g, (_, e) => encje[e]).replace(/\s+-\s+Gazetka\s+-\s+Biedronka\.pl\s*$/i, '').trim();
  return (t || slug.replace(/-/g, ' ')).slice(0, 200);
}

/** Strony z odpowiedzi API (images_mobile: pojedyncze strony w kolejności). */
export function parsujStronyBiedronki(json) {
  return (json.images_mobile ?? []).filter(s => s && typeof s.image === 'string' && /^https:\/\//.test(s.image))
    .sort((a, b) => a.page - b.page).map(s => s.image);
}

/**
 * Daty Biedronki: źródło podaje tylko początek w tytule („…-oferta-od-19-11”). Koniec jest przyjęty:
 * dzień przed początkiem następnej gazetki tej samej serii albo +6 dni. Zawsze oznaczony jako szacowany.
 */
export function datyBiedronki(gazetki, dzis) {
  const seria = g => g.slug.replace(/-?od-\d{1,2}-\d{1,2}$/, '');
  for (const g of gazetki) {
    const m = g.slug.match(/od-(\d{1,2})-(\d{1,2})$/);
    g.wazne_od = m ? dataBezRoku(Number(m[1]), Number(m[2]), dzis) : null;
  }
  const grupy = new Map();
  for (const g of gazetki.filter(x => x.wazne_od)) {
    if (!grupy.has(seria(g))) grupy.set(seria(g), []);
    grupy.get(seria(g)).push(g);
  }
  for (const lista of grupy.values()) {
    lista.sort((a, b) => a.wazne_od.localeCompare(b.wazne_od));
    lista.forEach((g, i) => {
      const nastepna = lista[i + 1]?.wazne_od;
      g.wazne_do = nastepna && nastepna > g.wazne_od ? dodajDni(nastepna, -1) : dodajDni(g.wazne_od, DNI_DOMYSLNIE);
      g.koniec_szacowany = true;
    });
  }
  return gazetki;
}

export async function znajdzBiedronka({ pobierzTekst, pobierzJson, dzis, filtr = FILTRY.biedronka }) {
  const lista = datyBiedronki(parsujListeBiedronki(await pobierzTekst(ZRODLA.biedronka)), dzis)
    .filter(g => g.wazne_od && filtr.tak.test(g.slug) && !filtr.nie.test(g.slug) && g.wazne_do >= dzis);
  const wynik = [];
  for (const g of lista) {
    const html = await pobierzTekst(g.url);
    const uuid = parsujIdPrzegladarkiBiedronki(html);
    if (!uuid) continue;
    const strony = parsujStronyBiedronki(await pobierzJson(ZRODLA.biedronkaApi(uuid)));
    if (!strony.length) continue;
    wynik.push({ siec: 'biedronka', id: idGazetki('biedronka', g.ref), tytul: parsujTytulBiedronki(html, g.slug),
      wazne_od: g.wazne_od, wazne_do: g.wazne_do, koniec_szacowany: true, zrodlo_url: g.url, zrodlo_ref: uuid, strony });
  }
  return wynik;
}

// ---------- Lidl ----------

export function parsujListeLidla(html) {
  return [...new Set([...html.matchAll(/\/l\/pl\/gazetki\/([a-z0-9-]+)\/ar\/0/g)].map(m => m[1]))];
}

export function parsujGazetkeLidla(identyfikator, json) {
  const f = json?.flyer;
  if (!f) return null;
  const od = f.offerStartDate ?? f.startDate; const doo = f.offerEndDate ?? f.endDate;
  const strony = (f.pages ?? []).filter(p => /^https:\/\//.test(p.image ?? '')).sort((a, b) => a.number - b.number).map(p => p.image);
  if (!od || !doo || !strony.length) return null;
  return { siec: 'lidl', id: idGazetki('lidl', identyfikator), tytul: [f.name, f.title].filter(Boolean).join(' ').slice(0, 200),
    wazne_od: od.slice(0, 10), wazne_do: doo.slice(0, 10), koniec_szacowany: false,
    zrodlo_url: ZRODLA.lidlStrona(identyfikator), zrodlo_ref: f.id ?? identyfikator, strony };
}

export async function znajdzLidl({ pobierzTekst, pobierzJson, dzis, filtr = FILTRY.lidl }) {
  const wynik = [];
  for (const ident of parsujListeLidla(await pobierzTekst(ZRODLA.lidl)).filter(i => filtr.tak.test(i) && !filtr.nie.test(i))) {
    const g = parsujGazetkeLidla(ident, await pobierzJson(ZRODLA.lidlApi(ident)));
    if (g && g.wazne_do >= dzis) wynik.push(g);
  }
  return wynik;
}

// ---------- Dino ----------

/** Rozpakowanie danych Nuxt (_payload.json, format „devalue”): tablica wartości z odwołaniami po indeksach. */
export function rozpakujNuxt(tablica) {
  const pamiec = new Map();
  const STALE = { [-1]: undefined, [-2]: null, [-3]: NaN, [-4]: Infinity, [-5]: -Infinity, [-6]: -0 };
  const wartosc = i => {
    if (i < 0) return STALE[i];
    if (pamiec.has(i)) return pamiec.get(i);
    const v = tablica[i];
    if (v === null || typeof v !== 'object') { pamiec.set(i, v); return v; }
    if (Array.isArray(v)) {
      if (typeof v[0] === 'string' && /^(Reactive|ShallowReactive|Ref|ShallowRef|EmptyRef|EmptyShallowRef|Date|Set|Map|BigInt)$/.test(v[0])) {
        const r = v[0] === 'Date' ? new Date(v[1]) : v[0].startsWith('Empty') ? undefined
          : v[0] === 'Set' ? new Set(v.slice(1).map(wartosc)) : v[0] === 'BigInt' ? BigInt(v[1]) : wartosc(v[1]);
        pamiec.set(i, r); return r;
      }
      const a = []; pamiec.set(i, a);
      for (const x of v) a.push(typeof x === 'number' ? wartosc(x) : x);
      return a;
    }
    const o = {}; pamiec.set(i, o);
    for (const [k, x] of Object.entries(v)) o[k] = typeof x === 'number' ? wartosc(x) : x;
    return o;
  };
  return wartosc(0);
}

export function parsujGazetkiDino(payload) {
  const dane = rozpakujNuxt(payload);
  const lista = dane?.data?.['leaflets-list']?.standard ?? [];
  return lista.filter(g => g && g.id && g.activeFrom && g.activeTo).map(g => ({
    siec: 'dino', id: idGazetki('dino', String(g.id), String(g.activeFrom).slice(0, 10)), tytul: String(g.name ?? 'Gazetka').slice(0, 200),
    wazne_od: String(g.activeFrom).slice(0, 10), wazne_do: String(g.activeTo).slice(0, 10), koniec_szacowany: false,
    zrodlo_url: ZRODLA.dino, zrodlo_ref: String(g.id),
    strony: (g.pages ?? []).filter(p => /^https:\/\//.test(p?.file?.url ?? '') && !p.isAlcohol)
      .sort((a, b) => a.no - b.no).map(p => p.file.url),
  })).filter(g => g.strony.length);
}

export async function znajdzDino({ pobierzJson, dzis, filtr = FILTRY.dino }) {
  return parsujGazetkiDino(await pobierzJson(ZRODLA.dinoDane))
    .filter(g => g.wazne_do >= dzis && filtr.tak.test(g.tytul) && !filtr.nie.test(g.tytul));
}

export const ZNAJDZ = { biedronka: znajdzBiedronka, lidl: znajdzLidl, dino: znajdzDino };
