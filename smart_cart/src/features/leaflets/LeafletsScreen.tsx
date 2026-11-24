import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Text, View } from 'react-native';
import { Button, Notice, Screen, useUI } from '@/components/ui/Controls';
import BackButton from '@/components/navigation/BackButton';
import { useSessionKey, useSessionQuery } from '@/features/catalog/hooks';
import { loadLeaflets } from './api';
import { displayValidity } from './model';

export default function LeafletsScreen() {
  const key = useSessionKey();
  return key ? <Leaflets key={key} /> : null;
}
function Leaflets() {
  const ui = useUI();
  const result = useSessionQuery(loadLeaflets, []);
  const { chain } = useLocalSearchParams<{ chain?: string }>();
  const setChain = (value: string) => router.setParams({ chain: value });
  const chains = [...new Map(result.data?.leaflets.map(leaflet => [leaflet.chain.id, leaflet.chain])).values()];
  const leaflets = result.data?.leaflets.filter(item => !chain || item.chain.id === chain) ?? [];
  return <Screen title="Gazetki"><BackButton />
    <Text style={ui.text}>Wybierz sieć i gazetkę, aby przeglądać strony w SMARTCART.</Text>
    <Button secondary title="Odśwież gazetki" disabled={result.loading} onPress={result.reload} />
    {result.loading && <ActivityIndicator accessibilityLabel="Wczytywanie gazetek" />}
    {result.error && <Notice>{result.error}</Notice>}
    {!result.loading && !result.error && leaflets.length === 0 && <Notice>{chain
      ? 'Brak dostępnych gazetek tej sieci.' : 'Brak dostępnych gazetek. Sprawdź ponownie później.'}</Notice>}
    <View style={ui.row}>
      {chains.map(item => <Button key={item.id} title={item.name} secondary={chain !== item.id} onPress={() => setChain(item.id)} />)}
      {!!chain && <Button secondary title="Wszystkie sieci" onPress={() => setChain('')} />}
    </View>
    {leaflets.map(item => <View style={ui.card} key={item.id}>
      <Text style={ui.heading}>{item.chain.name} · {item.title}</Text>
      <Text style={ui.text}>{displayValidity(item)} · {item.pages.length} stron</Text>
      <Button title={`Czytaj: ${item.title}`} onPress={() => router.push({ pathname: '/leaflets/[id]', params: { id: item.id } })} />
    </View>)}
  </Screen>;
}
