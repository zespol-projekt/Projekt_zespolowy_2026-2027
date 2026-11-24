import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { Image as CoverImage } from 'expo-image';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Notice, useUI } from '@/components/ui/Controls';
import { useTheme } from '@/features/theme/ThemeProvider';
import BackButton from '@/components/navigation/BackButton';
import { useSessionKey, useSessionQuery } from '@/features/catalog/hooks';
import { CHAIN_LOGOS, CHAIN_TILE_COLORS, CHAIN_TILE_RADIUS } from '@/features/stores/chainLogos';
import { BRANDS, CHAINS } from '@/features/stores/model';
import { loadLeaflets } from './api';
import { displayValidity, isCurrentLeaflet, leafletToday, validLeafletId, type Leaflet, type LeafletCatalog } from './model';
import { useLeafletImage } from './useLeafletImage';

export default function LeafletsScreen() {
  const key = useSessionKey();
  return key ? <Leaflets key={key} /> : null;
}
function Leaflets() {
  const ui = useUI();
  const focused = useIsFocused();
  const [width, setWidth] = useState(0);
  const result = useSessionQuery(loadLeaflets, []);
  const { data: catalog, reload } = result;
  const refreshedImages = useRef<LeafletCatalog | null>(null);
  const refreshImages = useCallback(() => {
    // Several covers can expire together; refresh each catalog snapshot only once.
    if (catalog && refreshedImages.current !== catalog) {
      refreshedImages.current = catalog;
      reload();
    }
  }, [catalog, reload]);
  const params = useLocalSearchParams<{ chain?: string }>();
  const chain = typeof params.chain === 'string' && validLeafletId(params.chain) ? params.chain : undefined;
  const knownChain = CHAINS.find(id => id === chain);
  const setChain = (value: string) => router.setParams({ chain: value });
  const today = leafletToday();
  const currentLeaflets = result.data?.leaflets.filter(item => isCurrentLeaflet(item, today)) ?? [];
  const chains = [...new Map(currentLeaflets.map(leaflet => [leaflet.chain.id, leaflet.chain])).values()];
  const leaflets = currentLeaflets.filter(item => !chain || item.chain.id === chain);
  const brandName = knownChain ? BRANDS[knownChain].name : chains.find(item => item.id === chain)?.name ?? chain;
  const columns = width >= 800 ? 3 : width >= 380 ? 2 : 1;
  const tileWidth = Math.max(0, (width - 36 - (columns - 1) * 14) / columns);
  return <View style={{ flex: 1 }} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
    <FlatList key={columns} data={leaflets} numColumns={columns} keyExtractor={item => item.id}
      contentContainerStyle={{ padding: 18, paddingBottom: 32, gap: 14 }}
      columnWrapperStyle={columns > 1 ? { gap: 14 } : undefined}
      initialNumToRender={6} maxToRenderPerBatch={6} windowSize={3}
      ListHeaderComponent={<View style={{ gap: 14 }}>
    <Text accessibilityRole="header" style={ui.title}>{brandName ? `Gazetki – ${brandName}` : 'Gazetki'}</Text><BackButton />
    {knownChain && <View style={[styles.brandTile, CHAIN_TILE_COLORS[knownChain]]}>
      <Image source={{ uri: CHAIN_LOGOS[knownChain] }} resizeMode="contain" accessible={false} style={styles.brandLogo} />
    </View>}
    {!chain && <Text style={ui.text}>Wybierz sieć lub gazetkę.</Text>}
    <View style={ui.row}>
      {chain && <Button secondary title="Wszystkie sieci" onPress={() => setChain('')} />}
      <Button secondary title="Odśwież gazetki" disabled={result.loading} onPress={result.reload} />
    </View>
    {result.loading && <ActivityIndicator accessibilityLabel="Wczytywanie gazetek" />}
    {result.error && <Notice>{result.error}</Notice>}
    {!result.loading && !result.error && leaflets.length === 0 && <Notice>{chain
      ? 'Brak aktualnych gazetek tej sieci.' : 'Brak aktualnych gazetek. Sprawdź ponownie później.'}</Notice>}
    {!chain && chains.length > 0 && <View style={ui.row}>
      {chains.map(item => <Button key={item.id} title={item.name} secondary onPress={() => setChain(item.id)} />)}
    </View>}
    </View>}
      renderItem={({ item }) => <LeafletTile item={item} chain={chain} width={tileWidth}
        ready={focused && !result.loading && !result.error} refreshCatalog={result.reload} refreshImages={refreshImages} />} />
  </View>;
}

function LeafletTile({ item, chain, width, ready, refreshCatalog, refreshImages }: {
  item: Leaflet; chain?: string; width: number; ready: boolean; refreshCatalog: () => void; refreshImages: () => void;
}) {
  const ui = useUI();
  const { colors } = useTheme();
  const image = item.cover ?? item.pages[0];
  const { current, reportError, retry } = useLeafletImage(image, ready, refreshImages);
  return <View style={[ui.card, { width, minWidth: 0 }]}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Czytaj: ${item.title}`}
      accessibilityHint={`${item.chain.name}. Obowiązuje: ${displayValidity(item)}. Otwiera czytnik gazetki.`}
      onPress={() => router.push({ pathname: '/leaflets/[id]', params: chain ? { id: item.id, chain } : { id: item.id } })}
      style={({ pressed }) => ({ gap: 10, opacity: pressed ? 0.7 : 1 })}>
      <View style={[styles.cover, { backgroundColor: colors.input }]}>
        {current?.uri ? <CoverImage source={{ uri: current.uri }} contentFit="contain" cachePolicy="none"
          accessible={false} style={StyleSheet.absoluteFill} onError={reportError} />
          : current?.error ? <Text style={[ui.muted, { padding: 16 }]}>Podgląd niedostępny. Możesz otworzyć gazetkę.</Text>
          : <ActivityIndicator accessibilityLabel={`Wczytywanie miniatury: ${item.title}`} color={colors.primary} />}
      </View>
      <Text style={[ui.muted, { color: colors.link, fontWeight: '700' }]}>{item.chain.name}</Text>
      <Text style={ui.heading}>{item.title}</Text>
      <Text style={ui.text}>Obowiązuje: {displayValidity(item)}</Text>
      <Text style={ui.muted}>{item.pages.length} stron · Otwórz gazetkę →</Text>
    </Pressable>
    {current?.error && <>
      <Notice>{current.error}</Notice>
      <Button secondary title={current.expired ? 'Odśwież dostęp do miniatury' : 'Ponów pobranie miniatury'}
        onPress={current.expired ? refreshCatalog : retry} />
    </>}
  </View>;
}

const styles = StyleSheet.create({
  brandTile: { width: 90, height: 54, borderWidth: 1, borderRadius: CHAIN_TILE_RADIUS, alignItems: 'center', justifyContent: 'center' },
  brandLogo: { width: 64, height: 36 },
  cover: { width: '100%', aspectRatio: 0.72, maxHeight: 360, borderRadius: 10, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
});
