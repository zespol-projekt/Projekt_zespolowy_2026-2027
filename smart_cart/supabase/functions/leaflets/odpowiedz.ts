// Budowa odpowiedzi GET /functions/v1/leaflets w formacie czytnika (leaflets-contract.md, version 1).
// Czysta logika bez Supabase i Deno: testowana w Node (tests/gazetki-funkcja.test.mjs).

export interface WierszStrony {
  page_no: number;
  storage_path: string;
  width: number;
  height: number;
  mime_type: string;
}

export interface WierszGazetki {
  id: string;
  title: string;
  valid_from: string;
  valid_to: string;
  stores: { slug: string; name: string } | null;
  leaflet_pages: WierszStrony[];
}

export interface Obraz { url: string; width: number; height: number; mimeType: string }

export interface Gazetka {
  id: string;
  chain: { id: string; name: string };
  title: string;
  validFrom: string;
  validTo: string;
  format: 'images';
  cover: Obraz;
  pages: Obraz[];
}

export interface Odpowiedz { version: 1; leaflets: Gazetka[] }

export const MAKS_GAZETEK = 200;
export const MAKS_BAJTOW = 1024 * 1024;
const MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** Dzisiejsza data w Polsce (YYYY-MM-DD); oferty obowiązują według polskiego czasu. */
export function dzisWPolsce(teraz: Date = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' }).format(teraz);
}

/** Gazetki do pokazania: opublikowane (filtr w zapytaniu), niewygasłe, z kompletem podpisanych stron. */
export function zbudujOdpowiedz(wiersze: WierszGazetki[], podpisane: Map<string, string>, dzis: string): Odpowiedz {
  const leaflets: Gazetka[] = [];
  for (const g of wiersze) {
    if (!g.stores || g.valid_to < dzis || g.valid_from > g.valid_to) continue;
    const strony = [...(g.leaflet_pages ?? [])].sort((a, b) => a.page_no - b.page_no);
    if (!strony.length || strony.length > 200) continue;
    const pages: Obraz[] = [];
    for (const s of strony) {
      const url = podpisane.get(s.storage_path);
      if (!url || !url.startsWith('https://') || !MIME.has(s.mime_type)) break;
      pages.push({ url, width: s.width, height: s.height, mimeType: s.mime_type });
    }
    // Niekompletnej gazetki nie pokazujemy (strony muszą być w kolejności czytania, bez dziur).
    if (pages.length !== strony.length) continue;
    leaflets.push({
      id: g.id,
      chain: { id: g.stores.slug, name: g.stores.name },
      title: g.title,
      validFrom: g.valid_from,
      validTo: g.valid_to,
      format: 'images',
      cover: pages[0],
      pages,
    });
  }
  leaflets.sort((a, b) => a.validFrom.localeCompare(b.validFrom) || a.chain.id.localeCompare(b.chain.id) || a.id.localeCompare(b.id));
  const wynik: Odpowiedz = { version: 1, leaflets: leaflets.slice(0, MAKS_GAZETEK) };
  // Limit 1 MiB: w razie przekroczenia odrzucamy gazetki zaczynające się najpóźniej.
  while (wynik.leaflets.length && new TextEncoder().encode(JSON.stringify(wynik)).length > MAKS_BAJTOW) wynik.leaflets.pop();
  return wynik;
}

/** Nagłówki CORS: lista dozwolonych originów z konfiguracji albo '*' (bez cookies, więc '*' jest dopuszczalne). */
export function naglowkiCors(origin: string | null, dozwolone: string | undefined): Record<string, string> {
  const lista = (dozwolone ?? '*').split(',').map(s => s.trim()).filter(Boolean);
  const pozwol = lista.includes('*') ? '*' : origin && lista.includes(origin) ? origin : lista[0] ?? 'null';
  return {
    'Access-Control-Allow-Origin': pozwol,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, accept, apikey, x-client-info, content-type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}
