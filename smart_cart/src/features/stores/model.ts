export const CHAINS = ['lidl', 'biedronka', 'dino', 'kaufland', 'carrefour'] as const;
export type Chain = (typeof CHAINS)[number];
export const BRANDS: Record<Chain, { name: string; color: string; letter: string }> = {
  lidl: { name: 'Lidl', color: '#0050AA', letter: 'L' },
  biedronka: { name: 'Biedronka', color: '#D62828', letter: 'B' },
  dino: { name: 'Dino', color: '#267B35', letter: 'D' },
  kaufland: { name: 'Kaufland', color: '#A11B44', letter: 'K' },
  carrefour: { name: 'Carrefour', color: '#286180', letter: 'C' },
};
export type Coordinates = { latitude: number; longitude: number };
export type Store = Coordinates & { id: string; chain: Chain; name: string; address: string; city?: string };
export type Catalog = { version: 1; updatedAt: string; count: number; stores: Store[] };
export const POLAND = { latitude: 52.1, longitude: 19.3 };
export const POLAND_BOUNDS = { north: 54.9, south: 49, east: 24.2, west: 14.1 };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
export function parseCatalog(value: unknown): Catalog {
  if (!isObject(value) || value.version !== 1 || !Array.isArray(value.stores) || value.count !== value.stores.length
    || typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) throw new Error('Nieprawidłowy katalog sklepów.');
  const ids = new Set<string>();
  const stores = value.stores.map((s: unknown): Store => {
    if (!isObject(s) || !CHAINS.includes(s.chain as Chain) || typeof s.id !== 'string' || !s.id.startsWith(`${s.chain}:`)
      || ids.has(s.id) || typeof s.name !== 'string' || !s.name.trim() || typeof s.address !== 'string' || !s.address.trim()
      || (s.city !== undefined && (typeof s.city !== 'string' || !s.city.trim()))
      || typeof s.latitude !== 'number' || !Number.isFinite(s.latitude) || s.latitude < 48.9 || s.latitude > 55
      || typeof s.longitude !== 'number' || !Number.isFinite(s.longitude) || s.longitude < 14 || s.longitude > 24.3) throw new Error('Nieprawidłowy punkt sklepu.');
    ids.add(s.id);
    return { id: s.id, chain: s.chain as Chain, name: s.name, address: s.address, city: s.city?.trim(),
      latitude: s.latitude, longitude: s.longitude };
  });
  return { version: 1, updatedAt: value.updatedAt, count: stores.length, stores };
}
export function directionsUrl(store: Coordinates, platform: string) {
  const destination = `${store.latitude},${store.longitude}`;
  return platform === 'ios'
    ? `https://maps.apple.com/?daddr=${encodeURIComponent(destination)}&dirflg=d`
    : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;
}
export function distanceMeters(a: Coordinates, b: Coordinates) {
  const rad = Math.PI / 180;
  const h = Math.sin((a.latitude - b.latitude) * rad / 2) ** 2
    + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin((a.longitude - b.longitude) * rad / 2) ** 2;
  return 12742000 * Math.asin(Math.min(1, Math.sqrt(h)));
}
function normalizeSearch(text: string) {
  return text.toLocaleLowerCase('pl-PL').normalize('NFD').replace(/\p{M}/gu, '').replace(/ł/g, 'l')
    .replace(/[\s,;]+/gu, ' ').trim();
}

export function createStoreSearch(stores: Store[]) {
  const cities = new Map<string, string>();
  const indexed = stores.map(store => {
    const city = store.city ? normalizeSearch(store.city) : '';
    if (store.city && city && !cities.has(city)) cities.set(city, store.city);
    return { store, city, text: normalizeSearch(`${store.name} ${store.address} ${store.city ?? ''}`) };
  });
  const collator = new Intl.Collator('pl');
  const sortedCities = [...cities].sort(([, a], [, b]) => collator.compare(a, b));

  return {
    findStores(chains: Chain[], query: string) {
      const term = normalizeSearch(query);
      const exactCity = cities.has(term);
      const words = term ? term.split(' ') : [];
      return indexed
        .filter(({ store, city, text }) => chains.includes(store.chain)
          && (exactCity ? city === term : words.every(word => text.includes(word))))
        .map(({ store }) => store);
    },
    suggestCities(query: string) {
      const term = normalizeSearch(query);
      if (term.length < 2) return [];
      const exact = cities.get(term);
      const suggestions = exact ? [exact] : [];
      for (const [key, label] of sortedCities) {
        if (key !== term && key.startsWith(term)) suggestions.push(label);
        if (suggestions.length === 5) break;
      }
      return suggestions;
    },
  };
}
