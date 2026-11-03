export const CHAINS = ['lidl', 'biedronka', 'auchan', 'dino'] as const;
export type Chain = (typeof CHAINS)[number];
export const BRANDS: Record<Chain, { name: string; color: string; letter: string }> = {
  lidl: { name: 'Lidl', color: '#0050AA', letter: 'L' },
  biedronka: { name: 'Biedronka', color: '#D62828', letter: 'B' },
  auchan: { name: 'Auchan', color: '#AA1B51', letter: 'A' },
  dino: { name: 'Dino', color: '#267B35', letter: 'D' },
};
export type Coordinates = { latitude: number; longitude: number };
export type Store = Coordinates & { id: string; chain: Chain; name: string; address: string };
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
      || typeof s.latitude !== 'number' || !Number.isFinite(s.latitude) || s.latitude < 48.9 || s.latitude > 55
      || typeof s.longitude !== 'number' || !Number.isFinite(s.longitude) || s.longitude < 14 || s.longitude > 24.3) throw new Error('Nieprawidłowy punkt sklepu.');
    ids.add(s.id);
    return { id: s.id, chain: s.chain as Chain, name: s.name, address: s.address, latitude: s.latitude, longitude: s.longitude };
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
export function filterStores(stores: Store[], chains: Chain[], query: string) {
  const normalize = (text: string) => text.toLocaleLowerCase('pl-PL').normalize('NFD').replace(/\p{M}/gu, '').replace(/ł/g, 'l');
  const words = normalize(query.trim()).split(/\s+/u).filter(Boolean);
  return stores.filter(s => chains.includes(s.chain) && words.every(w => normalize(`${s.name} ${s.address}`).includes(w)));
}
