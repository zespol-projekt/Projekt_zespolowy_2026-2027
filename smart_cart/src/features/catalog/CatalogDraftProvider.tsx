import { createContext, useContext, useState, type PropsWithChildren } from 'react';
import { useSessionKey } from './hooks';

type Drafts = { quantities: Record<string, string>; change: (key: string, value: string) => void };
const Context = createContext<Drafts | null>(null);
export function CatalogDraftProvider({ children }: PropsWithChildren) {
  const session = useSessionKey();
  const [draft, setDraft] = useState<{ session: string | null; quantities: Record<string, string> }>({ session, quantities: {} });
  // Hide the previous session's drafts synchronously, without remounting the navigator.
  if (draft.session !== session) setDraft({ session, quantities: {} });
  const quantities = draft.session === session ? draft.quantities : {};
  return <Context.Provider value={{ quantities, change: (key, value) => setDraft(previous => ({ session,
    quantities: { ...(previous.session === session ? previous.quantities : {}), [key]: value } })) }}>{children}</Context.Provider>;
}
export function useCatalogDrafts() {
  const value = useContext(Context);
  if (!value) throw new Error('Brak stanu formularzy katalogu.');
  return value;
}
