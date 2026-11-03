import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createMapDocument } from './document';
import type { StoreMapProps } from '../StoreMap.types';

type BridgeState = Pick<StoreMapProps, 'stores' | 'selectedId' | 'userLocation' | 'focus'> & { attributionSeen: boolean };

// Shared by native WebViews and web iframes; resets when the app session restarts.
let attributionSeen = false;
type Send = (message: object) => void;
export function useMapBridge(props: StoreMapProps, send: Send) {
  const [channel] = useState(() => `smartcart-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const html = useMemo(() => createMapDocument(channel), [channel]);
  const [ready, setReady] = useState(false);
  const [bridgeReady, setBridgeReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fatal, setFatal] = useState(false);
  const latest = useRef(props); latest.current = props;
  const lastStores = useRef<StoreMapProps['stores'] | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const receive = useCallback((raw: unknown) => {
    let data: Record<string, unknown>;
    try { data = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return; }
    if (!data || typeof data !== 'object' || data.channel !== channel) return;
    switch (data.type) {
      case 'bridge-ready': setBridgeReady(true); break;
      case 'attribution-seen': attributionSeen = true; break;
      case 'ready':
        setReady(true); setError(null); setFatal(false); clearTimeout(timeout.current); break;
      case 'select':
        if (typeof data.id === 'string' && latest.current.stores.some(s => s.id === data.id)) latest.current.onSelect(data.id);
        break;
      case 'error':
        setError(typeof data.message === 'string' ? data.message.slice(0,250) : 'Nie udało się uruchomić mapy.');
        if (data.fatal === true) { setFatal(true); clearTimeout(timeout.current); }
        break;
    }
  }, [channel]);
  useEffect(() => {
    timeout.current = setTimeout(() => { setError('Uruchamianie mapy trwa zbyt długo. Sprawdź internet i spróbuj ponownie.'); setFatal(true); }, 30000);
    return () => clearTimeout(timeout.current);
  }, []);
  useEffect(() => {
    if (!bridgeReady || fatal) return;
    const state: Partial<BridgeState> = { selectedId: props.selectedId, userLocation: props.userLocation, focus: props.focus, attributionSeen };
    if (lastStores.current !== props.stores) { state.stores = props.stores; lastStores.current = props.stores; }
    send({ channel, type: 'state', state });
  }, [bridgeReady, fatal, channel, send, props.stores, props.selectedId, props.userLocation, props.focus]);
  return { html, receive, ready, error, fatal, reportError: () => {
    setError('Nie udało się uruchomić mapy. Spróbuj ponownie.'); setFatal(true); clearTimeout(timeout.current);
  } };
}
