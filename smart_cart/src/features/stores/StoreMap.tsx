import { useCallback, useMemo, useRef, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { MapStatus } from './map/MapStatus';
import { useMapBridge } from './map/useMapBridge';
import { createNativeMapSource, MAP_DOCUMENT_BASE_URL } from './map/document';
import type { StoreMapProps } from './StoreMap.types';

const attributionHosts = new Set(['maplibre.org', 'openfreemap.org', 'www.openfreemap.org', 'openmaptiles.org', 'www.openmaptiles.org', 'openstreetmap.org', 'www.openstreetmap.org']);
function openAttribution(url: string) {
  try { const parsed = new URL(url); if (parsed.protocol === 'https:' && attributionHosts.has(parsed.hostname)) void Linking.openURL(url).catch(() => {}); } catch { /* Ignore unknown links. */ }
}
function Session(props: StoreMapProps & { retry: () => void }) {
  const webview = useRef<WebView<object>>(null);
  const send = useCallback((message: object) => {
    webview.current?.injectJavaScript(`window.SmartcartMap && window.SmartcartMap.receive(${JSON.stringify(message)}); true;`);
  }, []);
  const bridge = useMapBridge(props, send);
  const source = useMemo(() => createNativeMapSource(bridge.html), [bridge.html]);
  return <View style={styles.frame}>
    <WebView<object> ref={webview} source={source} style={styles.frame} originWhitelist={['*']}
      javaScriptEnabled domStorageEnabled scrollEnabled={false} bounces={false} setSupportMultipleWindows
      geolocationEnabled={false} allowsInlineMediaPlayback={false} allowsBackForwardNavigationGestures={false}
      onMessage={event => bridge.receive(event.nativeEvent.data)} onError={bridge.reportError}
      onRenderProcessGone={bridge.reportError} onContentProcessDidTerminate={bridge.reportError}
      onShouldStartLoadWithRequest={request => {
        if (request.url === MAP_DOCUMENT_BASE_URL || request.url === 'about:blank' || request.url.startsWith('about:srcdoc')) return true;
        openAttribution(request.url); return false;
      }} onOpenWindow={event => openAttribution(event.nativeEvent.targetUrl)}
      accessibilityLabel="Wektorowa mapa sklepów" testID="stores-map" />
    <MapStatus ready={bridge.ready} error={bridge.error} fatal={bridge.fatal} retry={props.retry} />
  </View>;
}
export default function StoreMap(props: StoreMapProps) {
  const [attempt, setAttempt] = useState(0);
  return <Session key={attempt} {...props} retry={() => setAttempt(n => n + 1)} />;
}
const styles = StyleSheet.create({ frame: { flex: 1, backgroundColor: '#F7F7F2' } });
