import { useCallback, useState } from 'react';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Text, View } from 'react-native';
import { Field, Notice, Screen, ui } from '@/components/ui/Controls';
import { catalogApi } from './api';
import { catalogV1Api } from './catalogV1Api';
import type { CatalogPage, Verification } from './catalogV1';
import { CatalogButton } from './CatalogControls';
import { CatalogItemCard } from './CatalogItemCard';
import { useCatalogDrafts } from './CatalogDraftProvider';
import { useDebounced, useSessionKey, useSessionQuery } from './hooks';
import { useShopping } from './ShoppingProvider';

const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] ?? '' : value ?? '';
export default function CatalogScreen() {
  const params = useLocalSearchParams<{ category?: string; subcategory?: string; q?: string }>();
  const session = useSessionKey();
  const category = first(params.category); const subcategory = first(params.subcategory); const query = first(params.q);
  return session ? <Catalog key={`${session}:${category}:${subcategory}:${query}`} categorySlug={category} subcategorySlug={subcategory} initialQuery={query} /> : null;
}

const verificationText: Record<Verification, string> = { reviewed: 'Grupy sprawdzone', in_progress: 'Dane w trakcie porządkowania', preliminary: 'Dane wstępne' };
function Catalog({ categorySlug, subcategorySlug, initialQuery }: { categorySlug: string; subcategorySlug: string; initialQuery: string }) {
  const tree = useSessionQuery(catalogV1Api.tree, []);
  const [query, setQuery] = useState(initialQuery);
  const debounced = useDebounced(query.trim());
  const [offset, setOffset] = useState(0);
  const drafts = useCatalogDrafts();
  const shopping = useShopping();
  const favorites = useSessionQuery(catalogApi.favorites, []);
  const reloadFavorites = favorites.reload;
  useFocusEffect(useCallback(() => { reloadFavorites(); }, [reloadFavorites]));
  const category = tree.data?.categories.find(row => row.slug === categorySlug);
  const subcategory = category?.children.find(row => row.slug === subcategorySlug);
  const result = useSessionQuery<CatalogPage | null>(signal => {
    if (debounced) return catalogV1Api.search(debounced, offset, signal);
    if (subcategorySlug && subcategory) return catalogV1Api.branch(subcategorySlug, offset, signal);
    return Promise.resolve(null);
  }, [debounced, offset, subcategorySlug, subcategory?.slug]);
  const waiting = query.trim() !== debounced;
  const loading = waiting || result.loading;
  const page = waiting ? undefined : result.data;
  const inResults = !!query.trim() || !!subcategory;
  const favoriteIds = favorites.data ? new Set(favorites.data.map(row => row.group_id)) : null;
  const navigate = (category = '', subcategory = '') => router.push({ pathname: '/products', params: { catalog: '1', category, subcategory } });

  return <Screen title="Katalog kategorii">
    <Field label="Szukaj w całym katalogu" placeholder="Np. mleko 3,2% bez laktozy" value={query} autoCorrect={false} autoCapitalize="none"
      onChangeText={value => { setQuery(value); setOffset(0); }} returnKeyType="search" />
    <Text style={ui.muted}>{query.trim() ? 'Wyniki wyszukiwania w całym katalogu.' : ['Kategorie', category?.name, subcategory?.name].filter(Boolean).join(' → ')}</Text>
    <View style={ui.row}>
      {!!(categorySlug || query.trim()) && <CatalogButton title="Wszystkie kategorie" onPress={() => navigate()} />}
      {!query.trim() && subcategory && <CatalogButton title={`Wróć do: ${category?.name}`} onPress={() => navigate(categorySlug)} />}
      {!!query.trim() && category && <CatalogButton title={`Wróć do przeglądania: ${subcategory?.name ?? category.name}`} onPress={() => { setQuery(''); setOffset(0); }} />}
    </View>
    {tree.loading && <ActivityIndicator accessibilityLabel="Wczytywanie kategorii" />}
    {tree.error && <><Notice>{tree.error}</Notice><CatalogButton title="Ponów pobieranie kategorii" onPress={tree.reload} /></>}
    {!query.trim() && !tree.loading && !tree.error && ((!!categorySlug && !category) || (!!subcategorySlug && !subcategory)) &&
      <Notice>Nie znaleziono tej kategorii. Wróć do wszystkich kategorii i odśwież dane.</Notice>}
    {!query.trim() && !categorySlug && tree.data && <>
      {tree.data.categories.length === 0 && <Text style={ui.text}>Kategorie nie są jeszcze dostępne.</Text>}
      <View style={{ gap: 12 }}>{tree.data.categories.map(row => <View key={row.slug} style={ui.card}>
        <CatalogButton title={`Kategoria: ${row.name}`} label={row.name} onPress={() => navigate(row.slug)} />
        <Text style={ui.muted}>{row.product_count} produktów · {row.children.length} podkategorii</Text>
      </View>)}</View>
    </>}
    {!query.trim() && category && !subcategorySlug && <>
      {category.children.length === 0 && <Text style={ui.text}>Brak podkategorii.</Text>}
      {category.children.map(row => <View key={row.slug} style={ui.card}>
        <CatalogButton title={`Podkategoria: ${row.name}`} label={row.name} onPress={() => navigate(category.slug, row.slug)} />
        <Text style={ui.muted}>{verificationText[row.verification_status]} · {row.product_count} produktów</Text>
        {!row.has_items && <Text style={ui.muted}>Brak produktów w tej podkategorii.</Text>}
      </View>)}
    </>}
    {subcategory && !query.trim() && <Text style={ui.muted}>{verificationText[subcategory.verification_status]}</Text>}
    {inResults && <>
      {loading && <ActivityIndicator accessibilityLabel="Wyszukiwanie katalogu" />}
      {!waiting && result.error && <><Notice>{result.error}</Notice><CatalogButton title="Ponów pobieranie wyników" onPress={result.reload} /></>}
      {!loading && !result.error && page && <>
        <Text style={ui.muted}>Wyników: {page.total}{page.items.length > 0 ? ` · ${page.offset + 1}–${page.offset + page.items.length}` : ''}</Text>
        {page.total === 0 && <Text style={ui.text}>Brak wyników. Spróbuj innej frazy lub kategorii.</Text>}
        {page.total > 0 && page.items.length === 0 && <Text style={ui.text}>Ta strona nie zawiera wyników.</Text>}
        {page.items.length > 0 && <>
          {shopping.loading && <ActivityIndicator accessibilityLabel="Wczytywanie list zakupów" />}
          {shopping.error && <><Notice>{shopping.error}</Notice><CatalogButton title="Ponów pobieranie list" onPress={shopping.reload} /></>}
          {shopping.lists.length > 1 && <View style={ui.row}>{shopping.lists.map(list => <CatalogButton key={list.id} title={`Wybierz listę: ${list.name}`} label={list.name}
            secondary={list.id !== shopping.activeId} disabled={shopping.loading || !!shopping.error} onPress={() => shopping.select(list.id)} />)}</View>}
          {favorites.error && <><Notice>Nie udało się sprawdzić Ulubionych.</Notice><CatalogButton title="Ponów sprawdzanie ulubionych" onPress={favorites.reload} /></>}
          {page.items.map(item => <CatalogItemCard key={item.group_id} item={item}
            favorite={favorites.loading || favorites.error || !favoriteIds ? undefined : favoriteIds.has(item.group_id)} onFavoriteChanged={favorites.reload}
            quantity={drafts.quantities[`${item.group_id}:${item.unit}`] ?? ''} onQuantityChanged={value => drafts.change(`${item.group_id}:${item.unit}`, value)} />)}
        </>}
        <View style={ui.row}>
          {page.offset > 0 && <CatalogButton title="Poprzednia strona katalogu" onPress={() => setOffset(Math.max(0, page.offset - page.limit))} />}
          {page.offset + page.limit < page.total && <CatalogButton title="Następna strona katalogu" onPress={() => setOffset(page.offset + page.limit)} />}
        </View>
      </>}
    </>}
  </Screen>;
}
