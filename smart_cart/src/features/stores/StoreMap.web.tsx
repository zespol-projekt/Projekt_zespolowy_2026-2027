import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { MapStatus } from './map/MapStatus';
import { useMapBridge } from './map/useMapBridge';
import type { StoreMapProps } from './StoreMap.types';

function Session(props: StoreMapProps & { retry: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const send = useCallback((message: object) => frame.current?.contentWindow?.postMessage(message, '*'), []);
  const bridge = useMapBridge(props, send);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => { if (event.source === frame.current?.contentWindow) bridge.receive(event.data); };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [bridge.receive]);
  return <View style={styles.frame}>
    <iframe ref={frame} srcDoc={bridge.html} title="Wektorowa mapa sklepów" data-testid="stores-map"
      sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }} />
    <MapStatus ready={bridge.ready} error={bridge.error} fatal={bridge.fatal} retry={props.retry} />
  </View>;
}
export default function StoreMap(props: StoreMapProps) {
  const [attempt, setAttempt] = useState(0);
  return <Session key={attempt} {...props} retry={() => setAttempt(n => n + 1)} />;
}
const styles = StyleSheet.create({ frame: { flex: 1, position: 'relative', minHeight: 200, backgroundColor: '#F7F7F2' } });
