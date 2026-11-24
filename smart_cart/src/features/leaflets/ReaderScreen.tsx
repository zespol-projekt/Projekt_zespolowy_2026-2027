import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { Button, Notice, useUI } from '@/components/ui/Controls';
import { useSessionKey, useSessionQuery } from '@/features/catalog/hooks';
import { loadLeaflets } from './api';
import { displayValidity, pageIndex, validLeafletId, type LeafletImage } from './model';
import { fetchPage, LeafletPageAccessError } from './transport';

export default function ReaderScreen() {
  const params = useLocalSearchParams<{ id: string; page?: string; chain?: string }>();
  const key = useSessionKey();
  return key ? <Reader key={`${key}:${params.id}`} id={params.id} page={params.page} chain={params.chain} /> : null;
}
function Reader({ id, page, chain }: { id: string; page?: string; chain?: string }) {
  const ui = useUI();
  const focused = useIsFocused();
  const query = useSessionQuery(loadLeaflets, []);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(320);
  const leaflet = query.data?.leaflets.find(item => item.id === id);
  const index = pageIndex(page, leaflet?.pages.length ?? 1);
  const returnChain = typeof chain === 'string' && validLeafletId(chain) && (!leaflet || leaflet.chain.id === chain) ? chain : undefined;
  const back = <Button secondary title="Wróć do gazetek"
    onPress={() => router.replace(returnChain ? { pathname: '/leaflets', params: { chain: returnChain } } : '/leaflets')} />;
  if (!validLeafletId(id)) return <View style={ui.screen}>{back}<Notice>Nieprawidłowy identyfikator gazetki.</Notice></View>;
  return <View style={{ flex: 1, padding: 14, gap: 10 }} onLayout={event => setWidth(Math.max(200, event.nativeEvent.layout.width - 28))}>
    <ScrollView style={{ maxHeight: '46%' }} contentContainerStyle={{ gap: 10 }}>
      {back}
      {query.loading && <ActivityIndicator accessibilityLabel="Wczytywanie gazetki" />}
      {query.error && <Notice>{query.error}</Notice>}
      {!query.loading && !query.error && !leaflet && <Notice>Ta gazetka nie jest już dostępna.</Notice>}
      <Button secondary title="Odśwież dostęp do gazetki" disabled={query.loading} onPress={query.reload} />
      {leaflet && <>
        <Text accessibilityRole="header" style={ui.heading}>{leaflet.chain.name} · {leaflet.title}</Text>
        <Text style={ui.muted}>{displayValidity(leaflet)}</Text>
        <Text accessibilityLiveRegion="polite" style={ui.text}>Strona {index + 1} z {leaflet.pages.length} · {Math.round(zoom * 100)}%</Text>
        <View style={ui.row}>
          <Button secondary title="Poprzednia strona" disabled={index === 0} onPress={() => { setZoom(1); router.setParams({ page: String(index) }); }} />
          <Button title="Następna strona" disabled={index === leaflet.pages.length - 1} onPress={() => { setZoom(1); router.setParams({ page: String(index + 2) }); }} />
          <Button secondary title="Powiększ" disabled={zoom >= 3} onPress={() => setZoom(Math.min(3, zoom + 0.5))} />
          <Button secondary title="Pomniejsz" disabled={zoom <= 1} onPress={() => setZoom(Math.max(1, zoom - 0.5))} />
        </View>
      </>}
    </ScrollView>
    {focused && leaflet && <PageImage key={index} page={leaflet.pages[index]} width={width} zoom={zoom} number={index + 1}
      catalogReady={!query.loading && !query.error} refreshCatalog={query.reload} />}
  </View>;
}
function PageImage({ page, width, zoom, number, catalogReady, refreshCatalog }: {
  page: LeafletImage; width: number; zoom: number; number: number; catalogReady: boolean; refreshCatalog: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ page: LeafletImage; attempt: number; uri?: string; error?: string; expired?: boolean } | null>(null);
  const refreshed = useRef(false);
  useEffect(() => {
    if (!catalogReady) return;
    const controller = new AbortController();
    void fetchPage(page, controller.signal).then(uri => {
      if (controller.signal.aborted) return;
      refreshed.current = false;
      setResult({ page, attempt, uri });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      const expired = error instanceof LeafletPageAccessError;
      if (expired && !refreshed.current) {
        refreshed.current = true;
        refreshCatalog();
        return;
      }
      setResult({ page, attempt, expired, error: error instanceof Error ? error.message : 'Nie udało się wczytać strony.' });
    });
    return () => controller.abort();
  }, [page, attempt, catalogReady, refreshCatalog]);
  if (!catalogReady) return null;
  const current = result?.page === page && result.attempt === attempt ? result : null;
  return <View style={{ flex: 1, minHeight: 100 }}>
    {!current && <ActivityIndicator accessibilityLabel="Wczytywanie strony" />}
    {current?.error && <><Notice>{current.error}</Notice>{!current.expired && <Button title="Ponów pobranie strony" onPress={() => setAttempt(n => n + 1)} />}</>}
    {current?.uri && <ScrollView key={attempt} nestedScrollEnabled style={{ flex: 1 }}>
      <ScrollView horizontal nestedScrollEnabled>
        <Image accessibilityLabel={`Strona ${number} gazetki`} accessible source={{ uri: current.uri }} contentFit="contain" cachePolicy="none"
          style={{ width: width * zoom, height: width * zoom * page.height / page.width, backgroundColor: '#FFFFFF' }}
          onError={() => setResult({ page, attempt, error: 'Plik jest uszkodzony lub nieobsługiwany. Spróbuj ponownie.' })} />
      </ScrollView>
    </ScrollView>}
  </View>;
}
