import { useCallback, useState } from 'react';
import { Link, useFocusEffect } from 'expo-router';
import { ActivityIndicator, Text } from 'react-native';
import { Button, Field, Notice, Screen, ui } from '@/components/ui/Controls';
import { catalogApi } from './api';
import { useSessionKey, useSessionQuery } from './hooks';
import { normalizeCatalogQuery } from './catalogPresentation';
import { FavoriteRow } from './FavoriteRow';

export default function FavoritesScreen() {
  const key = useSessionKey();
  return key ? <Favorites key={key} /> : null;
}
function Favorites() {
  const [search, setSearch] = useState('');
  const query = useSessionQuery(catalogApi.favorites, []);
  const reload = query.reload;
  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  const rows = query.data?.filter(row => normalizeCatalogQuery(row.group.name).includes(normalizeCatalogQuery(search)));
  return <Screen title="Ulubione">
    <Text style={ui.muted}>Zapisane grupy, niezależnie od sklepu. Dodaj potrzebną ilość do listy lub sprawdź produkty i ceny.</Text>
    <Field label="Szukaj w Ulubionych" value={search} onChangeText={setSearch} placeholder="Nazwa grupy" />
    <Button secondary title="Odśwież ulubione" onPress={query.reload} disabled={query.loading} />
    {query.loading && <ActivityIndicator accessibilityLabel="Wczytywanie ulubionych" />}
    {query.error && <><Notice>{query.error}</Notice><Button secondary title="Ponów pobieranie ulubionych" onPress={query.reload} /></>}
    {!query.loading && !query.error && query.data?.length === 0 && <>
      <Text style={ui.heading}>Nie masz jeszcze ulubionych grup.</Text>
      <Text style={ui.text}>Otwórz katalog i zapisz grupy, do których chcesz wracać.</Text>
      <Link href="/products" style={[ui.text, { paddingVertical: 12, fontWeight: '700' }]}>Przejdź do katalogu →</Link>
    </>}
    {!query.loading && !query.error && !!query.data?.length && rows?.length === 0 && <Text style={ui.text}>Brak ulubionych pasujących do wyszukiwania.</Text>}
    {rows?.map(row => <FavoriteRow key={row.group_id} group={row.group} onRemoved={query.reload} disabled={query.loading || !!query.error} />)}
  </Screen>;
}
