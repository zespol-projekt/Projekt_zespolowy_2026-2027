// Gazetki: pobranie z oficjalnych stron, archiwum lokalne, wgranie do Supabase Storage i usuwanie wygasłych.
// Uruchamia administrator (Damian) na swoim komputerze. Nie jest częścią aplikacji.
//
//   node scripts/gazetki/gazetki.mjs pobierz  --archiwum <folder> [--sieci biedronka,lidl,dino]
//   node scripts/gazetki/gazetki.mjs reczna   --archiwum <folder> --siec kaufland --tytul "Gazetka" --od 2026-11-20 --do 2026-11-26
//                                             --zrodlo https://... (--obrazy <folder ze stronami> | --pdf <plik.pdf>)
//   node scripts/gazetki/gazetki.mjs wgraj    --archiwum <folder> [--proba]
//   node scripts/gazetki/gazetki.mjs sprzataj [--proba]
//   node scripts/gazetki/gazetki.mjs lista    --archiwum <folder>
//
// Zasady (19.11.2026):
// - w bazie i Storage są gazetki aktualne i przyszłe; usuwamy je dzień po dacie końca (sprzataj);
// - archiwum lokalne (poza repo) zostaje na zawsze: <archiwum>/<siec>/<id>/meta.json + 001.jpg ...;
// - strony są obrazami (JPEG/PNG/WebP, do 8 MiB, bok do 8192 px, do 30 mln pikseli), PDF jest zamieniany na obrazy;
// - weryfikacji antybotowej (403/429) nie omijamy: przerywamy daną sieć;
// - klucz service_role tylko z SUPABASE_SERVICE_ROLE_KEY albo pliku .env.admin.local (poza gitem), nigdy EXPO_PUBLIC_*.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { opiszObraz, ROZSZERZENIA } from './obrazy.mjs';
import { dzisWPolsce, dodajDni, idGazetki, ZNAJDZ } from './zrodla.mjs';

export const BUCKET = 'leaflets';
const AGENT = 'SMARTCART/1.0 (projekt studencki; pobieranie gazetek do aplikacji testowej)';
const PRZERWA_MS = 250;
const katalogRepo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

class Blokada extends Error {}
const czekaj = ms => new Promise(r => setTimeout(r, ms));

// ---------- pobieranie ----------

export function pobieracz(fetchFn = fetch, przerwa = PRZERWA_MS) {
  async function pobierz(url, akceptuj) {
    for (let proba = 1; ; proba++) {
      await czekaj(przerwa);
      let r;
      try {
        r = await fetchFn(url, { headers: { 'User-Agent': AGENT, Accept: akceptuj }, redirect: 'follow' });
      } catch (e) {
        if (proba < 2) continue;
        throw new Error(`${url}: ${e.message}`);
      }
      if (r.status === 403 || r.status === 429) throw new Blokada(`${new URL(url).host} odpowiada ${r.status} (blokada) - przerywam tę sieć`);
      if (r.status >= 500 && proba < 2) continue;
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
      return r;
    }
  }
  return {
    pobierzTekst: async url => (await pobierz(url, 'text/html,application/json;q=0.9,*/*;q=0.8')).text(),
    pobierzJson: async url => (await pobierz(url, 'application/json')).json(),
    pobierzBajty: async url => Buffer.from(await (await pobierz(url, 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5')).arrayBuffer()),
  };
}

// ---------- archiwum lokalne ----------

const katalogGazetki = (archiwum, g) => path.join(archiwum, g.siec, g.id);

export function czytajArchiwum(archiwum) {
  const wynik = [];
  if (!fs.existsSync(archiwum)) return wynik;
  for (const siec of fs.readdirSync(archiwum)) {
    const ks = path.join(archiwum, siec);
    if (!fs.statSync(ks).isDirectory()) continue;
    for (const id of fs.readdirSync(ks)) {
      const plik = path.join(ks, id, 'meta.json');
      if (fs.existsSync(plik)) wynik.push({ ...JSON.parse(fs.readFileSync(plik, 'utf8')), katalog: path.join(ks, id) });
    }
  }
  return wynik.sort((a, b) => (a.siec + a.wazne_od + a.id).localeCompare(b.siec + b.wazne_od + b.id));
}

/** Zapisuje gazetkę w archiwum. strony: [{ bufor, url_zrodla? }]. Zwraca meta. */
export function zapiszWArchiwum(archiwum, g, strony, sprawdzono = new Date().toISOString()) {
  const kat = katalogGazetki(archiwum, g);
  fs.mkdirSync(kat, { recursive: true });
  const opisy = strony.map((s, i) => {
    const o = opiszObraz(s.bufor);
    const plik = `${String(i + 1).padStart(3, '0')}.${o.rozszerzenie}`;
    fs.writeFileSync(path.join(kat, plik), s.bufor);
    return { nr: i + 1, plik, szerokosc: o.width, wysokosc: o.height, mime: o.mime, bajty: o.bajty, sha256: o.sha256, url_zrodla: s.url_zrodla ?? null };
  });
  const meta = { wersja: 1, id: g.id, siec: g.siec, tytul: g.tytul, wazne_od: g.wazne_od, wazne_do: g.wazne_do,
    koniec_szacowany: Boolean(g.koniec_szacowany), zrodlo_url: g.zrodlo_url, zrodlo_ref: g.zrodlo_ref ?? null, sprawdzono, strony: opisy };
  fs.writeFileSync(path.join(kat, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
  return meta;
}

export async function pobierzGazetki({ archiwum, sieci, http, dzis = dzisWPolsce(), log = console.log }) {
  const raport = [];
  const istniejace = new Map(czytajArchiwum(archiwum).map(m => [m.id, m]));
  for (const siec of sieci) {
    if (!ZNAJDZ[siec]) { raport.push({ siec, blad: 'brak automatycznego źródła - użyj polecenia "reczna"' }); continue; }
    try {
      const gazetki = await ZNAJDZ[siec]({ ...http, dzis });
      log(`${siec}: aktualne gazetki: ${gazetki.length}`);
      for (const g of gazetki) {
        const stara = istniejace.get(g.id);
        if (stara && stara.strony.length === g.strony.length && stara.strony.every((s, i) => s.url_zrodla === g.strony[i])
          && stara.strony.every(s => fs.existsSync(path.join(stara.katalog, s.plik)))) {
          zapiszMeta(stara, { ...g, sprawdzono: new Date().toISOString() });
          raport.push({ siec, id: g.id, strony: g.strony.length, stan: 'bez zmian' });
          continue;
        }
        const strony = [];
        for (const url of g.strony) strony.push({ bufor: await http.pobierzBajty(url), url_zrodla: url });
        zapiszWArchiwum(archiwum, g, strony);
        raport.push({ siec, id: g.id, strony: strony.length, stan: stara ? 'zaktualizowana' : 'nowa' });
        log(`  ${g.id}: ${strony.length} stron (${g.wazne_od} - ${g.wazne_do}${g.koniec_szacowany ? ', koniec szacowany' : ''})`);
      }
    } catch (e) {
      raport.push({ siec, blad: e.message });
      log(`${siec}: ${e instanceof Blokada ? 'PRZERWANO' : 'BŁĄD'}: ${e.message}`);
    }
  }
  return raport;
}

function zapiszMeta(stara, nowa) {
  const { katalog, ...meta } = stara;
  Object.assign(meta, { tytul: nowa.tytul, wazne_od: nowa.wazne_od, wazne_do: nowa.wazne_do,
    koniec_szacowany: Boolean(nowa.koniec_szacowany), sprawdzono: nowa.sprawdzono });
  fs.writeFileSync(path.join(katalog, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
}

/** Gazetka dodana ręcznie: obrazy stron z folderu albo PDF zamieniony na obrazy. */
export async function dodajRecznie({ archiwum, siec, tytul, od, doo, zrodlo, obrazy, pdf }) {
  if (!/^[a-z0-9-]{2,32}$/.test(siec ?? '')) throw new Error('Podaj --siec (np. kaufland)');
  if (!tytul) throw new Error('Podaj --tytul');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(od ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(doo ?? '') || od > doo) throw new Error('Podaj poprawne --od i --do (RRRR-MM-DD)');
  if (!/^https:\/\//.test(zrodlo ?? '')) throw new Error('Podaj --zrodlo (adres https strony gazetki)');
  let strony;
  if (obrazy) {
    const pliki = fs.readdirSync(obrazy).filter(f => /\.(jpe?g|png|webp)$/i.test(f))
      .sort((a, b) => a.localeCompare(b, 'pl', { numeric: true }));
    strony = pliki.map(f => ({ bufor: fs.readFileSync(path.join(obrazy, f)) }));
  } else if (pdf) {
    let pdfNaObrazy;
    try { ({ pdf: pdfNaObrazy } = await import('pdf-to-img')); } catch {
      throw new Error('Do PDF potrzebny jest pakiet pdf-to-img: npm.cmd install --no-save pdf-to-img');
    }
    strony = [];
    for await (const strona of await pdfNaObrazy(path.resolve(pdf), { scale: 2 })) strony.push({ bufor: Buffer.from(strona) });
  } else throw new Error('Podaj --obrazy <folder> albo --pdf <plik>');
  if (!strony.length || strony.length > 200) throw new Error(`Gazetka musi mieć 1-200 stron (jest ${strony.length})`);
  const g = { siec, id: idGazetki(siec, od, tytul), tytul, wazne_od: od, wazne_do: doo, koniec_szacowany: false, zrodlo_url: zrodlo, zrodlo_ref: null };
  return zapiszWArchiwum(archiwum, g, strony);
}

// ---------- Supabase ----------

export function wczytajDostep(env = process.env, plik = path.join(katalogRepo, '.env.admin.local')) {
  const z = {};
  if (fs.existsSync(plik)) {
    for (const linia of fs.readFileSync(plik, 'utf8').split(/\r?\n/)) {
      const m = linia.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/);
      if (m) z[m[1]] = m[2];
    }
  }
  const url = env.SUPABASE_URL ?? z.SUPABASE_URL;
  const klucz = env.SUPABASE_SERVICE_ROLE_KEY ?? z.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url)) throw new Error('Ustaw SUPABASE_URL (https://<ref>.supabase.co) w .env.admin.local');
  if (!klucz) throw new Error('Ustaw SUPABASE_SERVICE_ROLE_KEY w .env.admin.local (plik poza gitem)');
  if (!klucz.startsWith('sb_secret_')) {
    let rola = null;
    try { rola = JSON.parse(Buffer.from(klucz.split('.')[1], 'base64url').toString()).role; } catch { /* nie JWT */ }
    if (rola !== 'service_role') throw new Error('SUPABASE_SERVICE_ROLE_KEY nie jest kluczem service_role (to pewnie klucz publiczny)');
  }
  return { url: url.replace(/\/$/, ''), klucz };
}

async function klientSupabase() {
  const { createClient } = await import('@supabase/supabase-js');
  const { url, klucz } = wczytajDostep();
  return createClient(url, klucz, { auth: { persistSession: false, autoRefreshToken: false } });
}

const sciezkaStrony = (meta, s) => `${meta.siec}/${meta.id}/${String(s.nr).padStart(3, '0')}-${s.sha256.slice(0, 12)}.${ROZSZERZENIA[s.mime]}`;

function sprawdz({ error }, co) { if (error) throw new Error(`${co}: ${error.message}`); }

/** Wgrywa gazetki z archiwum (aktualne i przyszłe). Gazetka jest publikowana dopiero po wgraniu wszystkich stron. */
export async function wgraj({ archiwum, klient, proba = false, dzis = dzisWPolsce(), log = console.log }) {
  const doWgrania = czytajArchiwum(archiwum).filter(m => m.wazne_do >= dzis);
  const raport = [];
  if (proba) {
    for (const m of doWgrania) {
      raport.push({ id: m.id, siec: m.siec, strony: m.strony.length, wazne_od: m.wazne_od, wazne_do: m.wazne_do });
      log(`[próba] ${m.id}: ${m.strony.length} stron, ${m.wazne_od} - ${m.wazne_do}`);
    }
    return raport;
  }
  const { data: sklepy, error } = await klient.from('stores').select('id, slug');
  if (error) throw new Error(`stores: ${error.message}`);
  const idSieci = new Map(sklepy.map(s => [s.slug, s.id]));
  for (const m of doWgrania) {
    if (!idSieci.has(m.siec)) { raport.push({ id: m.id, blad: `brak sieci ${m.siec} w tabeli stores` }); continue; }
    const { data: stareStrony, error: e1 } = await klient.from('leaflet_pages').select('page_no, storage_path').eq('leaflet_id', m.id);
    if (e1) throw new Error(`leaflet_pages: ${e1.message}`);
    const stare = new Map((stareStrony ?? []).map(s => [s.storage_path, s]));
    sprawdz(await klient.from('leaflets').upsert({
      id: m.id, store_id: idSieci.get(m.siec), title: m.tytul, valid_from: m.wazne_od, valid_to: m.wazne_do,
      valid_to_estimated: m.koniec_szacowany, source_url: m.zrodlo_url, source_ref: m.zrodlo_ref, checked_at: m.sprawdzono,
      published: false, page_count: 0,
    }), `leaflets ${m.id}`);
    let wgrane = 0;
    const wiersze = [];
    for (const s of m.strony) {
      const sciezka = sciezkaStrony(m, s);
      if (!stare.has(sciezka)) {
        const bufor = fs.readFileSync(path.join(m.katalog, s.plik));
        const { error: e2 } = await klient.storage.from(BUCKET).upload(sciezka, bufor, { contentType: s.mime, upsert: true, cacheControl: '3600' });
        if (e2) throw new Error(`Storage ${sciezka}: ${e2.message}`);
        wgrane++;
      }
      wiersze.push({ leaflet_id: m.id, page_no: s.nr, storage_path: sciezka, width: s.szerokosc, height: s.wysokosc,
        mime_type: s.mime, bytes: s.bajty, sha256: s.sha256 });
    }
    sprawdz(await klient.from('leaflet_pages').delete().eq('leaflet_id', m.id), `leaflet_pages ${m.id}`);
    sprawdz(await klient.from('leaflet_pages').insert(wiersze), `leaflet_pages ${m.id}`);
    const nieuzywane = [...stare.keys()].filter(p => !wiersze.some(w => w.storage_path === p));
    if (nieuzywane.length) sprawdz(await klient.storage.from(BUCKET).remove(nieuzywane), `Storage usuwanie ${m.id}`);
    sprawdz(await klient.from('leaflets').update({ published: true, page_count: wiersze.length }).eq('id', m.id), `publikacja ${m.id}`);
    raport.push({ id: m.id, strony: wiersze.length, wgrane_pliki: wgrane, usuniete_pliki: nieuzywane.length });
    log(`${m.id}: opublikowana (${wiersze.length} stron, wgrano ${wgrane} plików)`);
  }
  return raport;
}

/** Usuwa z bazy i Storage gazetki, które wygasły ponad dzień temu (archiwum lokalne zostaje). */
export async function sprzataj({ klient, proba = false, dzis = dzisWPolsce(), log = console.log }) {
  const granica = dodajDni(dzis, -1);
  const { data: stare, error } = await klient.from('leaflets').select('id, valid_to, leaflet_pages(storage_path)').lt('valid_to', granica);
  if (error) throw new Error(`leaflets: ${error.message}`);
  const raport = [];
  for (const g of stare ?? []) {
    const pliki = (g.leaflet_pages ?? []).map(p => p.storage_path);
    raport.push({ id: g.id, wazne_do: g.valid_to, pliki: pliki.length });
    if (proba) { log(`[próba] usunęłabym ${g.id} (koniec ${g.valid_to}, ${pliki.length} plików)`); continue; }
    for (let i = 0; i < pliki.length; i += 500) sprawdz(await klient.storage.from(BUCKET).remove(pliki.slice(i, i + 500)), `Storage ${g.id}`);
    sprawdz(await klient.from('leaflets').delete().eq('id', g.id), `leaflets ${g.id}`);
    log(`${g.id}: usunięta z bazy i Storage (koniec ${g.valid_to})`);
  }
  return raport;
}

// ---------- CLI ----------

function argumenty(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      a[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    } else a._.push(argv[i]);
  }
  return a;
}

async function main() {
  const a = argumenty(process.argv.slice(2));
  const polecenie = a._[0];
  const archiwum = a.archiwum ? path.resolve(a.archiwum) : null;
  const wymagajArchiwum = () => { if (!archiwum) throw new Error('Podaj --archiwum <folder archiwum gazetek>'); };
  let wynik;
  if (polecenie === 'pobierz') {
    wymagajArchiwum();
    const sieci = String(a.sieci ?? 'biedronka,lidl,dino').split(',').map(s => s.trim()).filter(Boolean);
    wynik = await pobierzGazetki({ archiwum, sieci, http: pobieracz() });
  } else if (polecenie === 'reczna') {
    wymagajArchiwum();
    const m = await dodajRecznie({ archiwum, siec: a.siec, tytul: a.tytul, od: a.od, doo: a.do, zrodlo: a.zrodlo, obrazy: a.obrazy, pdf: a.pdf });
    wynik = { id: m.id, strony: m.strony.length };
  } else if (polecenie === 'wgraj') {
    wymagajArchiwum();
    wynik = await wgraj({ archiwum, klient: a.proba ? null : await klientSupabase(), proba: Boolean(a.proba) });
  } else if (polecenie === 'sprzataj') {
    wynik = await sprzataj({ klient: await klientSupabase(), proba: Boolean(a.proba) });
  } else if (polecenie === 'lista') {
    wymagajArchiwum();
    wynik = czytajArchiwum(archiwum).map(m => ({ id: m.id, siec: m.siec, od: m.wazne_od, do: m.wazne_do, strony: m.strony.length }));
  } else {
    throw new Error('Polecenia: pobierz | reczna | wgraj | sprzataj | lista (opis na początku pliku)');
  }
  console.log(JSON.stringify(wynik, null, 2));
  if (Array.isArray(wynik) && wynik.some(x => x.blad)) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(`Błąd: ${e.message}`); process.exitCode = 1; });
}
