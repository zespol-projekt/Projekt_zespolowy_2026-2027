import { Redirect, router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { Image as CoverImage } from 'expo-image';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Notice, useUI } from '@/components/ui/Controls';
import { useTheme } from '@/features/theme/ThemeProvider';
import { useSessionKey, useSessionQuery } from '@/features/catalog/hooks';
import { CHAIN_LOGOS, CHAIN_TILE_COLORS, CHAIN_TILE_RADIUS } from '@/features/stores/chainLogos';
import { BRANDS, CHAINS } from '@/features/stores/model';
import { loadLeaflets } from './api';
import { displayValidity, isCurrentLeaflet, leafletToday, validLeafletId, type Leaflet, type LeafletCatalog } from './model';
import { useLeafletImage } from './useLeafletImage';

export default function LeafletsScreen() {
  const key = useSessionKey();
  const { chain } = useLocalSearchParams<{ chain?: string }>();
  if (!key) return null;
  if (typeof chain !== 'string' || !validLeafletId(chain)) return <Redirect href="/" />;
  return <Leaflets key={key} chain={chain} />;
}
function Leaflets({ chain }: { chain: string }) {
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
  const knownChain = CHAINS.find(id => id === chain);
  const today = leafletToday();
  const currentLeaflets = result.data?.leaflets.filter(item => isCurrentLeaflet(item, today)) ?? [];
  const leaflets = currentLeaflets.filter(item => item.chain.id === chain);
  const brandName = knownChain ? BRANDS[knownChain].name : leaflets[0]?.chain.name ?? chain;
  const columns = width >= 800 ? 3 : width >= 380 ? 2 : 1;
  const tileWidth = Math.max(0, (width - 36 - (columns - 1) * 14) / columns);
  return <View style={{ flex: 1 }} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
    <FlatList key={columns} data={leaflets} numColumns={columns} keyExtractor={item => item.id}
      contentContainerStyle={{ padding: 18, paddingBottom: 32, gap: 14 }}
      columnWrapperStyle={columns > 1 ? { gap: 14 } : undefined}
      initialNumToRender={6} maxToRenderPerBatch={6} windowSize={3}
      ListHeaderComponent={<View style={{ gap: 14 }}>
    <View style={styles.brandHeader}>
      <Text accessibilityRole="header" style={ui.title}>Gazetki</Text>
      {knownChain ? <View style={[styles.brandTile, CHAIN_TILE_COLORS[knownChain]]}>
        <Image source={{ uri: CHAIN_LOGOS[knownChain] }} resizeMode="contain" accessibilityRole="image"
          accessibilityLabel={brandName} style={styles.brandLogo} />
      </View> : <Text style={ui.text}>{brandName}</Text>}
    </View>
    {result.loading && <ActivityIndicator accessibilityLabel="Wczytywanie gazetek" />}
    {result.error && <Notice>{result.error}</Notice>}
    {!result.loading && !result.error && leaflets.length === 0 && <Notice>Brak aktualnych gazetek tej sieci.</Notice>}
    </View>}
      renderItem={({ item }) => <LeafletTile item={item} chain={chain} width={tileWidth}
        ready={focused && !result.loading && !result.error} refreshCatalog={result.reload} refreshImages={refreshImages} />} />
  </View>;
}

function LeafletTile({ item, chain, width, ready, refreshCatalog, refreshImages }: {
  item: Leaflet; chain: string; width: number; ready: boolean; refreshCatalog: () => void; refreshImages: () => void;
}) {
  const ui = useUI();
  const { colors } = useTheme();
  const image = item.cover ?? item.pages[0];
  const { current, reportError, retry } = useLeafletImage(image, ready, refreshImages);
  return <View style={[ui.card, { width, minWidth: 0 }]}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Czytaj: ${item.title}`}
      accessibilityHint={`${item.chain.name}. Obowiązuje: ${displayValidity(item)}. Otwiera czytnik gazetki.`}
      onPress={() => router.push({ pathname: '/leaflets/[id]', params: { id: item.id, chain } })}
      style={({ pressed }) => ({ gap: 10, opacity: pressed ? 0.7 : 1 })}>
      <View style={[styles.cover, { backgroundColor: colors.input }]}>
        {current?.uri ? <CoverImage source={{ uri: current.uri }} contentFit="contain" cachePolicy="none"
          accessible={false} style={StyleSheet.absoluteFill} onError={reportError} />
          : current?.error ? <Text style={[ui.muted, { padding: 16 }]}>Podgląd niedostępny. Możesz otworzyć gazetkę.</Text>
          : <ActivityIndicator accessibilityLabel={`Wczytywanie miniatury: ${item.title}`} color={colors.primary} />}
      </View>
      <Text style={[ui.text, { fontWeight: '700', textAlign: 'center' }]}>{displayValidity(item)}</Text>
    </Pressable>
    {current?.error && <>
      <Notice>{current.error}</Notice>
      <Button secondary title={current.expired ? 'Odśwież dostęp do miniatury' : 'Ponów pobranie miniatury'}
        onPress={current.expired ? refreshCatalog : retry} />
    </>}
  </View>;
}

const styles = StyleSheet.create({
  brandHeader: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
  brandTile: { width: 90, height: 54, borderWidth: 1, borderRadius: CHAIN_TILE_RADIUS, alignItems: 'center', justifyContent: 'center' },
  brandLogo: { width: 64, height: 36 },
  cover: { width: '100%', aspectRatio: 0.72, maxHeight: 360, borderRadius: 10, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
});
