import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { ActivityIndicator, Text, View } from 'react-native';
import { Button, Notice, Screen, ui } from '@/components/ui/Controls';
import { catalogApi } from './api';
import { useSessionKey, useSessionQuery } from './hooks';
import { GroupDetails } from './GroupDetails';
import type { ProductGroup } from './types';

export default function FavoritesScreen() {
  const key = useSessionKey();
  return key ? <Favorites key={key} /> : null;
}
function Favorites() {
  const query = useSessionQuery(catalogApi.favorites, []);
  const [selected, setSelected] = useState<ProductGroup | null>(null);
  const reload = query.reload;
  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  return <Screen title="Ulubione produkty">
    <Text style={ui.muted}>Twoje prywatne grupy produktów zapisane na koncie.</Text>
    <Button secondary title="Odśwież ulubione" onPress={query.reload} disabled={query.loading} />
    {query.loading && <ActivityIndicator />}
    {query.error && <Notice>{query.error}</Notice>}
    {!query.loading && query.data?.length === 0 && <Text style={ui.text}>Dodaj grupę do ulubionych na ekranie Produkty.</Text>}
    {selected && query.data?.some(row => row.group_id === selected.id) && <GroupDetails key={selected.id} group={selected} onClose={() => { setSelected(null); query.reload(); }} />}
    {query.data?.map(row => <View key={row.group_id} style={ui.card}>
      <Text style={ui.heading}>{row.group.name}</Text>
      <Button secondary title={`Oferty: ${row.group.name}`} onPress={() => setSelected({ ...row.group, default_quantity: row.group.unit === 'szt' ? 1 : 1000, offer_count: 0, lowest_price: null })} />
    </View>)}
  </Screen>;
}
