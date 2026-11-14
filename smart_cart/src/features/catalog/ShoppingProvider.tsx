import { createContext, useContext, useState, type PropsWithChildren } from 'react';
import { catalogApi } from './api';
import { useSessionKey, useSessionQuery } from './hooks';
import type { ShoppingList, Unit } from './types';

type ShoppingContextValue = {
  lists: ShoppingList[]; loading: boolean; error: string | null; reload: () => void;
  activeId: string | null; select: (id: string) => void;
  create: (name: string, signal: AbortSignal) => Promise<string>;
  add: (groupId: number, quantity: number, unit: Unit, productId: number | null, signal: AbortSignal) => Promise<void>;
};
const ShoppingContext = createContext<ShoppingContextValue | null>(null);
export function ShoppingProvider({ children }: PropsWithChildren) {
  const key = useSessionKey();
  const query = useSessionQuery(catalogApi.lists, []);
  const [selection, setSelection] = useState<{ key: string | null; id: string | null }>({ key: null, id: null });
  const lists = query.data ?? [];
  const activeId = selection.key === key && lists.some(l => l.id === selection.id) ? selection.id : lists[0]?.id ?? null;
  const select = (id: string) => setSelection({ key, id });
  const create = async (name: string, signal: AbortSignal) => {
    if (!name.trim() || name.trim().length > 100) throw new Error('Podaj nazwę listy od 1 do 100 znaków.');
    const rows = await catalogApi.createList(name, signal);
    if (!rows[0]) throw new Error('Nie udało się utworzyć listy.');
    select(rows[0].id); query.reload(); return rows[0].id;
  };
  const add = async (groupId: number, quantity: number, unit: Unit, productId: number | null, signal: AbortSignal) => {
    const id = activeId ?? await create('Zakupy', signal);
    await catalogApi.addItem(id, groupId, quantity, unit, productId, signal);
    query.reload();
  };
  return <ShoppingContext.Provider value={{ lists, loading: query.loading, error: query.error, reload: query.reload, activeId, select, create, add }}>{children}</ShoppingContext.Provider>;
}
export function useShopping() {
  const value = useContext(ShoppingContext);
  if (!value) throw new Error('Brak ShoppingProvider.');
  return value;
}
