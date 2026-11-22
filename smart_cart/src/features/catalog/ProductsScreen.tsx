import { useState } from 'react';
import { Link, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Text, View } from 'react-native';
import { Button, Field, Notice, Screen, ui } from '@/components/ui/Controls';
import { catalogApi } from './api';
import { useDebounced, useSessionKey, useSessionQuery } from './hooks';
import { GroupDetails } from './GroupDetails';
import type { ProductGroup } from './types';
import CatalogScreen from './CatalogScreen';

export default function ProductsScreen() {
  const params = useLocalSearchParams<{ q?: string; catalog?: string }>();
  const key = useSessionKey();
  if (params.catalog === '1') return <CatalogScreen />;
  return key ? <ProductSearch key={`${key}:${params.q ?? ''}`} initialQuery={params.q ?? ''} /> : null;
}
function ProductSearch({ initialQuery }: { initialQuery: string }) {
  const [query, setQuery] = useState(initialQuery);
  const debounced = useDebounced(query.trim());
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<ProductGroup | null>(null);
  const result = useSessionQuery(signal => catalogApi.groups(debounced, offset, signal), [debounced, offset]);
  // Do not allow actions on results for the previous phrase during the debounce.
  const waitingForQuery = query.trim() !== debounced;
  const loading = waitingForQuery || result.loading;
  const groups = waitingForQuery ? undefined : result.data;
  return <Screen title="Produkty i ceny">
    <Link href={{ pathname: '/products', params: { catalog: '1' } }} style={[ui.text, { paddingVertical: 12, fontWeight: '700' }]}>Otwórz katalog kategorii →</Link>
    <Field label="Szukaj grupy produktów" placeholder="Np. mleko 3,2%, ryż, masło" value={query} onChangeText={value => { setQuery(value); setOffset(0); setSelected(null); }} autoCorrect={false} autoCapitalize="none" />
    <Text style={ui.muted}>Najpierw wybierz grupę, następnie sprawdź opakowania i oferty. Porównujemy dane sieciowe.</Text>
    {loading && <ActivityIndicator accessibilityLabel="Wyszukiwanie produktów" />}
    {!waitingForQuery && result.error && <><Notice>{result.error}</Notice><Button title="Ponów wyszukiwanie" onPress={result.reload} /></>}
    {!loading && !result.error && groups?.length === 0 && <Text style={ui.text}>Nie znaleziono grup produktów. Spróbuj innej nazwy.</Text>}
    {groups?.map(group => <View key={group.id} style={ui.card}>
      <Text style={ui.heading}>{group.name}</Text>
      <Text style={ui.muted}>{group.offer_count} ofert · jednostka zapotrzebowania: {group.unit}</Text>
      <Button title={`Rozwiń oferty: ${group.name}`} secondary={selected?.id !== group.id} onPress={() => setSelected(group)} />
      {selected?.id === group.id && <GroupDetails key={group.id} group={group} onClose={() => setSelected(null)} />}
    </View>)}
    <View style={ui.row}>
      {offset > 0 && <Button secondary title="Poprzednie grupy" disabled={loading} onPress={() => setOffset(Math.max(0, offset - 30))} />}
      {groups?.length === 30 && <Button secondary title="Następne grupy" disabled={loading} onPress={() => setOffset(offset + 30)} />}
    </View>
  </Screen>;
}
