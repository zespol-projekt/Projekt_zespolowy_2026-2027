import { authService } from '../auth/instance';
import { createDataClient } from './client';
import type { Comparison, Offer, ProductGroup, ShoppingItem, ShoppingList, Unit } from './types';

const call = createDataClient({ url: process.env.EXPO_PUBLIC_SUPABASE_URL, key: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, auth: authService });
const uuid = (id: string) => { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('Nieprawidłowa lista.'); return id; };
const numericId = (id: number) => { if (!Number.isSafeInteger(id) || id < 1) throw new Error('Nieprawidłowy produkt.'); return id; };

export const catalogApi = {
  groups: (query: string, offset: number, signal: AbortSignal) => call<ProductGroup[]>('rpc/search_product_groups', { method: 'POST', body: { search_query: query, result_limit: 30, result_offset: offset }, signal }),
  offers: (id: number, signal: AbortSignal, offset = 0) => call<Offer[]>(`catalog_offers?group_id=eq.${numericId(id)}&order=single_price.asc.nullslast,offer_id.asc&limit=50&offset=${offset}`, { signal }),
  lists: (signal: AbortSignal) => call<ShoppingList[]>('shopping_lists?select=id,name,updated_at&order=updated_at.desc,id', { signal }),
  createList: (name: string, signal: AbortSignal) => call<ShoppingList[]>('shopping_lists', { method: 'POST', body: { name: name.trim() }, signal }),
  renameList: (id: string, name: string, signal: AbortSignal) => call<ShoppingList[]>(`shopping_lists?id=eq.${uuid(id)}`, { method: 'PATCH', body: { name: name.trim() }, signal }),
  deleteList: (id: string, signal: AbortSignal) => call<ShoppingList[]>(`shopping_lists?id=eq.${uuid(id)}`, { method: 'DELETE', signal }),
  items: (id: string, signal: AbortSignal) => call<ShoppingItem[]>(`shopping_list_items?list_id=eq.${uuid(id)}&select=*,group:comparison_groups(id,name,unit),selected_product:products(id,canonical_name)&order=created_at.asc,id`, { signal }),
  addItem: (listId: string, groupId: number, quantity: number, unit: Unit, productId: number | null, signal: AbortSignal) => call<ShoppingItem[]>('rpc/add_shopping_item', { method: 'POST', body: { p_list_id: uuid(listId), p_group_id: numericId(groupId), p_quantity: quantity, p_unit: unit, p_selected_product_id: productId }, signal }),
  updateItem: (id: string, data: Partial<Pick<ShoppingItem, 'quantity' | 'selected_product_id' | 'extra_store_ids'>>, signal: AbortSignal) => call<ShoppingItem[]>(`shopping_list_items?id=eq.${uuid(id)}`, { method: 'PATCH', body: data, signal }),
  deleteItem: (id: string, signal: AbortSignal) => call<ShoppingItem[]>(`shopping_list_items?id=eq.${uuid(id)}`, { method: 'DELETE', signal }),
  compare: (items: ShoppingItem[], signal: AbortSignal) => call<Comparison>('rpc/compare_basket', { method: 'POST', body: { p_items: items.map(({ id, group_id, quantity, unit, selected_product_id, extra_store_ids }) => ({ id, group_id, quantity, unit, selected_product_id, extra_store_ids })) }, signal }),
  favorites: (signal: AbortSignal) => call<{ group_id: number; group: ProductGroup }[]>('favorite_groups?select=group_id,group:comparison_groups(id,name,unit)&order=created_at.desc', { signal }),
  favorite: (id: number, value: boolean, signal: AbortSignal) => call(`favorite_groups${value ? '' : `?group_id=eq.${numericId(id)}`}`, { method: value ? 'POST' : 'DELETE', ...(value ? { body: { group_id: numericId(id) } } : {}), signal }),
};
