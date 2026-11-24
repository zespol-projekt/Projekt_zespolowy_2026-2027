import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { Button, Notice, Screen, useUI } from '@/components/ui/Controls';
import BackButton from '@/components/navigation/BackButton';
import { useSessionKey, useSessionQuery } from '@/features/catalog/hooks';
import { CHAIN_LOGOS, CHAIN_TILE_COLORS, CHAIN_TILE_RADIUS } from '@/features/stores/chainLogos';
import { BRANDS, CHAINS } from '@/features/stores/model';
import { loadLeaflets } from './api';
import { displayValidity, validLeafletId } from './model';

export default function LeafletsScreen() {
  const key = useSessionKey();
  return key ? <Leaflets key={key} /> : null;
}
function Leaflets() {
  const ui = useUI();
  const result = useSessionQuery(loadLeaflets, []);
  const params = useLocalSearchParams<{ chain?: string }>();
  const chain = typeof params.chain === 'string' && validLeafletId(params.chain) ? params.chain : undefined;
  const knownChain = CHAINS.find(id => id === chain);
  const setChain = (value: string) => router.setParams({ chain: value });
  const chains = [...new Map(result.data?.leaflets.map(leaflet => [leaflet.chain.id, leaflet.chain])).values()];
  const leaflets = result.data?.leaflets.filter(item => !chain || item.chain.id === chain) ?? [];
  const brandName = knownChain ? BRANDS[knownChain].name : chains.find(item => item.id === chain)?.name ?? chain;
  return <Screen title={brandName ? `Gazetki – ${brandName}` : 'Gazetki'}><BackButton />
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
      ? 'Brak dostępnych gazetek tej sieci.' : 'Brak dostępnych gazetek. Sprawdź ponownie później.'}</Notice>}
    {!chain && chains.length > 0 && <View style={ui.row}>
      {chains.map(item => <Button key={item.id} title={item.name} secondary onPress={() => setChain(item.id)} />)}
    </View>}
    {leaflets.map(item => <View style={ui.card} key={item.id}>
      <Text style={ui.heading}>{chain ? item.title : `${item.chain.name} · ${item.title}`}</Text>
      <Text style={ui.text}>{displayValidity(item)} · {item.pages.length} stron</Text>
      <Button title={`Czytaj: ${item.title}`}
        onPress={() => router.push({ pathname: '/leaflets/[id]', params: chain ? { id: item.id, chain } : { id: item.id } })} />
    </View>)}
  </Screen>;
}

const styles = StyleSheet.create({
  brandTile: { width: 90, height: 54, borderWidth: 1, borderRadius: CHAIN_TILE_RADIUS, alignItems: 'center', justifyContent: 'center' },
  brandLogo: { width: 64, height: 36 },
});
