export type LeafletImage = { url: string; width: number; height: number; mimeType: 'image/png' | 'image/jpeg' | 'image/webp' };
export type Leaflet = { id: string; chain: { id: string; name: string }; title: string; validFrom: string; validTo: string; validToEstimated: boolean; cover: LeafletImage | null; pages: LeafletImage[] };
export type LeafletCatalog = { version: 1; leaflets: Leaflet[] };
export const validLeafletId = (id: string) => /^[a-z0-9][a-z0-9_-]{0,79}$/.test(id);
export class LeafletError extends Error {}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new LeafletError('Nieprawidłowy format danych gazetek.');
  return value as Record<string, unknown>;
}
function label(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new LeafletError('Nieprawidłowy opis gazetki.');
  return value;
}
export function resourceUrl(value: unknown): string {
  if (typeof value !== 'string') throw new LeafletError('Brak pliku gazetki.');
  let url: URL;
  try { url = new URL(value); } catch { throw new LeafletError('Nieprawidłowy adres pliku gazetki.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new LeafletError('Pliki gazetki wymagają bezpiecznego adresu HTTPS.');
  return url.href;
}
function image(value: unknown): LeafletImage {
  const data = object(value);
  const { width, height, mimeType } = data;
  if (typeof width !== 'number' || typeof height !== 'number' || !Number.isInteger(width) || !Number.isInteger(height)
    || width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > 30000000
    || !['image/png', 'image/jpeg', 'image/webp'].includes(String(mimeType))) throw new LeafletError('Nieobsługiwany format strony. Potrzebne są obrazy PNG, JPEG lub WebP.');
  return { url: resourceUrl(data.url), width, height, mimeType: mimeType as LeafletImage['mimeType'] };
}
function date(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new LeafletError('Nieprawidłowe daty gazetki.');
  return value;
}
export function parseLeaflets(value: unknown): LeafletCatalog {
  const data = object(value);
  if (data.version !== 1 || !Array.isArray(data.leaflets) || data.leaflets.length > 200) throw new LeafletError('Nieobsługiwany katalog gazetek.');
  const ids = new Set<string>();
  const leaflets = data.leaflets.map(raw => {
    const item = object(raw); const chain = object(item.chain);
    const id = label(item.id); const chainId = label(chain.id);
    if (!validLeafletId(id) || !validLeafletId(chainId) || ids.has(id)) throw new LeafletError('Nieprawidłowy identyfikator gazetki lub sieci.');
    ids.add(id);
    if (item.format !== 'images' || !Array.isArray(item.pages) || !item.pages.length || item.pages.length > 200) throw new LeafletError('Brak obsługiwanych stron gazetki. Potrzebne są uporządkowane obrazy.');
    const validFrom = date(item.validFrom); const validTo = date(item.validTo);
    if (validTo < validFrom) throw new LeafletError('Nieprawidłowy okres gazetki.');
    return { id, chain: { id: chainId, name: label(chain.name) }, title: label(item.title), validFrom, validTo, validToEstimated: item.validToEstimated === true,
      cover: item.cover == null ? null : image(item.cover), pages: item.pages.map(image) };
  });
  return { version: 1, leaflets };
}
export function pageIndex(value: unknown, count: number): number {
  const n = typeof value === 'string' && /^\d{1,3}$/.test(value) ? Number(value) : 1;
  return Math.max(0, Math.min(count - 1, n - 1));
}
const displayDate = (value: string) => value.split('-').reverse().join('.');
export function displayValidity({ validFrom, validTo, validToEstimated }: Leaflet): string {
  return `${displayDate(validFrom)} – ${displayDate(validTo)}${validToEstimated ? ' (koniec szacowany)' : ''}`;
}
