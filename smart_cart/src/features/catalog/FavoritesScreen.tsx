import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { Button, Notice, Screen } from '@/components/ui/Controls';
import { catalogApi } from './api';
import { useSessionKey, useSessionQuery } from './hooks';
import { FavoriteRow } from './FavoriteRow';
import { EmptyProductGuide } from './EmptyProductGuide';

export default function FavoritesScreen() {
  const key = useSessionKey();
  return key ? <Favorites key={key} /> : null;
}
function Favorites() {
  const query = useSessionQuery(catalogApi.favorites, []);
  const reload = query.reload;
  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  return <Screen title="Ulubione">
    {query.loading && <ActivityIndicator accessibilityLabel="Wczytywanie ulubionych" />}
    {query.error && <><Notice>{query.error}</Notice><Button secondary title="Ponów pobieranie ulubionych" onPress={query.reload} /></>}
    {!query.loading && !query.error && query.data?.length === 0 && <EmptyProductGuide message="Trochę tu pusto. Wyszukaj produkt i dodaj go do ulubionych." />}
    {!!query.data?.length && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
      {query.data.map(row => <FavoriteRow key={row.group_id} group={row.group} onRemoved={query.reload}
        disabled={query.loading || !!query.error} />)}
    </View>}
  </Screen>;
}
