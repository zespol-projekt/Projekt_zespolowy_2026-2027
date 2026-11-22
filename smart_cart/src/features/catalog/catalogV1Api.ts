import { authService } from '../auth/instance';
import { createDataClient, DataError } from './client';
import { parseTree, parsePage, parseGroup, parseProduct } from './catalogV1';

export class CatalogNotFound extends Error {}

const call = createDataClient({ url: process.env.EXPO_PUBLIC_SUPABASE_URL, key: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, auth: authService });
async function rpc<T>(name: string, body: object, signal: AbortSignal, parse: (value: unknown) => T): Promise<T> {
  try { return parse(await call<unknown>(`rpc/${name}`, { method: 'POST', body, signal })); }
  catch (error) {
    if (error instanceof DataError && ['PGRST202', 'PGRST205', '42P01', '42883'].includes(error.code)) {
      throw new Error('Katalog kategorii nie jest jeszcze dostępny. Spróbuj ponownie później.');
    }
    if (error instanceof DataError && ['404', 'P0002', 'PT404'].includes(error.code)) throw new CatalogNotFound('Nie znaleziono tej kategorii lub produktu. Wróć do katalogu i odśwież dane.');
    throw error;
  }
}
const validId = (id: number) => { if (!Number.isSafeInteger(id) || id < 1) throw new Error('Nieprawidłowy produkt.'); return id; };
const offsetValue = (offset: number) => { if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Nieprawidłowa strona katalogu.'); return offset; };
export const catalogV1Api = {
  tree: (signal: AbortSignal) => rpc('catalog_tree', {}, signal, parseTree),
  branch: (slug: string, offset: number, signal: AbortSignal) => rpc('catalog_branch', { p_subcategory: slug, p_limit: 30, p_offset: offsetValue(offset) }, signal, value => parsePage(value, true)),
  search: (query: string, offset: number, signal: AbortSignal) => rpc('catalog_search', { p_query: query, p_limit: 30, p_offset: offsetValue(offset) }, signal, parsePage),
  group: (id: number, signal: AbortSignal) => rpc('catalog_group', { p_group_id: validId(id) }, signal, parseGroup),
  product: (id: number, signal: AbortSignal) => rpc('catalog_product', { p_product_id: validId(id) }, signal, parseProduct),
};
