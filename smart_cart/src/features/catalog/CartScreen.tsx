import { useCallback, useState } from 'react';
import { Link, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Field, Notice, useUI } from '@/components/ui/Controls';
import { useTheme } from '@/features/theme/ThemeProvider';
import { catalogApi } from './api';
import { useSessionAction, useSessionKey, useSessionQuery } from './hooks';
import { useShopping } from './ShoppingProvider';
import { checklistIcon } from '@/components/ui/shoppingIcons';
import { chevron, ShoppingAction, ShoppingPage } from './ShoppingPage';
import { OfferInfo } from './GroupDetails';
import { EmptyProductGuide } from './EmptyProductGuide';
import { priceDateLabel } from './catalogPresentation';
import { amount, money, quantityHelp, quantityInput, type ComparisonItem, type ShoppingItem } from './types';

function ItemEditor({ item, reload }: { item: ShoppingItem; reload: () => void }) {
  const ui = useUI();
  const [input, setInput] = useState({ saved: item.quantity, value: String(item.quantity) });
  const quantity = input.saved === item.quantity ? input.value : String(item.quantity);
  const [choosing, setChoosing] = useState(false);
  const [offset, setOffset] = useState(0);
  const action = useSessionAction();
  const offers = useSessionQuery(signal => choosing ? catalogApi.offers(item.group_id, signal, offset) : Promise.resolve([]), [choosing, item.group_id, offset]);
  const save = () => void action.run(signal => catalogApi.updateItem(item.id, { quantity: quantityInput(quantity, item.unit) }, signal), reload);
  const choose = (id: number | null) => void action.run(signal => catalogApi.updateItem(item.id, { selected_product_id: id }, signal), () => { setChoosing(false); reload(); });
  return <View style={ui.card}>
    <Text style={ui.heading}>{item.group.name}</Text>
    <Text style={ui.muted}>{item.selected_product ? `Wybrany produkt: ${item.selected_product.canonical_name}` : 'Najtańszy równoważny produkt, dowolna marka'}</Text>
    <Field label={`Ilość dla ${item.group.name} (${item.unit})`} value={quantity} onChangeText={value => setInput({ saved: item.quantity, value })} keyboardType="decimal-pad" editable={!action.busy} />
    <Text style={ui.muted}>{quantityHelp[item.unit]}</Text>
    <View style={ui.row}>
      <Button title="Zapisz ilość" busy={action.busy} onPress={save} />
      <Button secondary title="Zmień produkt" disabled={action.busy} onPress={() => setChoosing(!choosing)} />
      <Button secondary title={`Usuń: ${item.group.name}`} disabled={action.busy} onPress={() => void action.run(signal => catalogApi.deleteItem(item.id, signal), reload)} />
    </View>
    {action.message && <Notice>{action.message}</Notice>}
    {choosing && <View style={{ gap: 12 }}>
      <Button secondary title="Wybieraj najtańszy równoważny produkt" disabled={action.busy} onPress={() => choose(null)} />
      {offers.loading && <ActivityIndicator />}
      {offers.error && <Notice>{offers.error}</Notice>}
      {offers.data?.map(offer => <View key={offer.offer_id} style={ui.card}><OfferInfo offer={offer} />
        <Button secondary title={`Wybierz: ${offer.product_name}`} disabled={action.busy} onPress={() => choose(offer.product_id)} />
      </View>)}
      <View style={ui.row}>
        {offset > 0 && <Button secondary title="Poprzednie warianty" onPress={() => setOffset(Math.max(0, offset - 50))} />}
        {offers.data?.length === 50 && <Button secondary title="Następne warianty" onPress={() => setOffset(offset + 50)} />}
      </View>
    </View>}
  </View>;
}

function ComparedItem({ row, storeId, items, reload }: { row: ComparisonItem; storeId: number; items: ShoppingItem[]; reload: () => void }) {
  const ui = useUI();
  const action = useSessionAction();
  const original = items.find(item => item.id === row.item_id);
  const toggle = (value: boolean) => {
    if (!original) return;
    const ids = value ? [...new Set([...original.extra_store_ids, storeId])] : original.extra_store_ids.filter(id => id !== storeId);
    void action.run(signal => catalogApi.updateItem(original.id, { extra_store_ids: ids }, signal), reload);
  };
  return <View style={ui.card}>
    <Text style={ui.heading}>{row.name}</Text>
    <Text style={ui.muted}>Potrzebujesz: {amount(row.required_quantity, row.unit)}</Text>
    {row.status === 'missing' ? <Notice>Brak produktu/ceny w bazie danych.</Notice> : <>
      <Text style={ui.text}>{money(row.total_price)} · kupujesz {amount(row.purchased_quantity ?? row.required_quantity, row.unit)}</Text>
      {!!row.surplus && <Text style={ui.muted}>Nadwyżka: {amount(row.surplus, row.unit)}</Text>}
      {row.picks.map(pick => <View key={pick.offer_id} style={{ gap: 4 }}>
        <Text style={ui.text}>{pick.package_count == null ? amount(pick.quantity, pick.unit) : `${pick.package_count} opak. · ${amount(pick.quantity, pick.unit)}`} · {pick.name} · {money(pick.total_price)}</Text>
        <Text style={ui.muted}>{priceDateLabel({ price_source: pick.price_source ?? null, regular_price_observed_at: pick.observed_at })}</Text>
        {pick.requires_activation && <Notice>Wymaga aktywacji w aplikacji sklepu.</Notice>}
        {pick.requires_card && <Text style={ui.muted}>Wymaga karty lub aplikacji sieci.</Text>}
        {pick.promotion_applied && pick.condition && <Text style={ui.muted}>{pick.condition}</Text>}
        {pick.promotion_applied && <Text style={ui.muted}>Promocja: {pick.valid_from ?? 'od początku oferty'} – {pick.valid_to ?? 'do odwołania w źródle'}</Text>}
        {pick.sale_mode === 'bulk' && <Text style={ui.muted}>Koszt zależy od faktycznie zważonej ilości.</Text>}
      </View>)}
    </>}
    {row.alternative && !row.extra_selected && <View style={ui.card}>
      <Text style={ui.heading}>Propozycja: większy zakup</Text>
      <Text style={ui.text}>Kup {amount(row.alternative.purchased_quantity ?? 0, row.unit)} za {money(row.alternative.total_price)}.</Text>
      <Text style={ui.muted}>Nadwyżka względem potrzeb: {amount(row.alternative.surplus ?? 0, row.unit)}.
        {row.total_price != null && row.alternative.total_price != null ? ` Wydatek mniejszy o ${money(row.total_price - row.alternative.total_price)}.` : ''}</Text>
      {row.alternative.picks.map(pick => <View key={pick.offer_id}>
        <Text style={ui.text}>{pick.package_count ?? ''} opak. · {pick.name} · {money(pick.total_price)}</Text>
        <Text style={ui.muted}>{priceDateLabel({ price_source: pick.price_source ?? null, regular_price_observed_at: pick.observed_at })}</Text>
        {pick.requires_activation && <Notice>Wymaga aktywacji w aplikacji sklepu.</Notice>}
        {pick.requires_card && <Text style={ui.muted}>Wymaga karty lub aplikacji sieci.</Text>}
        {pick.promotion_applied && pick.condition && <Text style={ui.muted}>{pick.condition}</Text>}
      </View>)}
      <Button title="Wybierz propozycję dla tej sieci" busy={action.busy} onPress={() => toggle(true)} />
    </View>}
    {row.extra_selected && <><Notice>Wybrano wariant promocyjny z dodatkowymi sztukami dla tej sieci.</Notice><Button secondary title="Wróć do ilości podstawowej" disabled={action.busy} onPress={() => toggle(false)} /></>}
    {action.message && <Notice>{action.message}</Notice>}
  </View>;
}

export default function CartScreen() {
  const key = useSessionKey();
  return key ? <CartSummary key={key} /> : null;
}

function CartSummary() {
  const { colors } = useTheme();
  const ui = useUI();
  const shopping = useShopping();
  const active = shopping.lists.find(list => list.id === shopping.activeId);
  const reload = shopping.reload;
  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  return <ShoppingPage title="Twój Koszyk" back={null} description="Aktualna lista zakupów i porównanie jej kosztu w sklepach.">
    {shopping.loading && !active && <ActivityIndicator accessibilityLabel="Wczytywanie list zakupów" />}
    {shopping.error && <><Notice>{shopping.error}</Notice><Button secondary title="Ponów wczytywanie" onPress={reload} /></>}
    {active ? <>
      <Link href="/cart/list" asChild>
        <Pressable accessibilityRole="link" accessibilityLabel={`Edytuj aktualną listę: ${active.name}`}
          style={StyleSheet.flatten([cartStyles.currentList, { backgroundColor: colors.secondary }])}>
          <SymbolView name={checklistIcon} tintColor={colors.link} size={25} />
          <View style={cartStyles.listText}>
            <Text style={{ color: colors.link }}>Aktualna lista</Text>
            <Text style={[cartStyles.listName, { color: colors.text }]}>{active.name}</Text>
          </View>
          <SymbolView name={chevron} tintColor={colors.link} size={20} />
        </Pressable>
      </Link>
      <ShoppingAction href="/cart/comparison" label="Porównaj ceny w sklepach" />
    </> : !shopping.loading && !shopping.error && <>
      <Text style={ui.text}>Twój koszyk nie ma jeszcze listy zakupów.</Text>
      <ShoppingAction href="/shopping-lists" label="Otwórz listy zakupów" />
    </>}
  </ShoppingPage>;
}

export function ShoppingListEditorScreen() {
  const key = useSessionKey();
  const { listId } = useLocalSearchParams<{ listId?: string }>();
  return key ? <CartDetails key={key} mode="edit" listId={listId} /> : null;
}

export function ComparisonScreen() {
  const key = useSessionKey();
  return key ? <CartDetails key={key} mode="compare" /> : null;
}

function CartDetails({ mode, listId }: { mode: 'edit' | 'compare'; listId?: string }) {
  const ui = useUI();
  const { colors } = useTheme();
  const shopping = useShopping();
  const selectedId = listId ?? shopping.activeId;
  const active = shopping.lists.find(list => list.id === selectedId);
  const resolvedId = active?.id;
  const items = useSessionQuery(signal => resolvedId ? catalogApi.items(resolvedId, signal) : Promise.resolve([]), [resolvedId]);
  const editing = mode === 'edit';
  const comparison = useSessionQuery(signal => !editing && items.data?.length
    ? catalogApi.compare(items.data, signal)
    : Promise.resolve({ version: 2 as const, calculated_at: '', stores: [] }), [mode, items.data]);
  const reloadLists = shopping.reload;
  const reloadItems = items.reload;
  useFocusEffect(useCallback(() => { reloadLists(); reloadItems(); }, [reloadLists, reloadItems]));
  const complete = comparison.data?.stores.filter(store => store.complete && store.total_price != null) ?? [];
  const minimum = complete.length ? Math.min(...complete.map(store => store.total_price as number)) : null;
  const itemCount = items.data?.length;
  const itemCountLabel = itemCount === undefined ? undefined : `${itemCount} ${itemCount === 1 ? 'produkt'
    : itemCount % 10 >= 2 && itemCount % 10 <= 4 && (itemCount % 100 < 12 || itemCount % 100 > 14) ? 'produkty' : 'produktów'}`;
  return <ShoppingPage title={editing ? (active?.name ?? 'Aktualna lista') : 'Porównanie sieci'}
    pageTitle={editing ? 'Twój Koszyk' : undefined}
    description={editing ? (active ? itemCountLabel : undefined) : active?.name} headingCard={editing && !!active}
    icon={editing ? checklistIcon : undefined} back={null}>
    {shopping.loading && !active && <ActivityIndicator accessibilityLabel="Wczytywanie list zakupów" />}
    {shopping.error && <><Notice>{shopping.error}</Notice><Button secondary title="Ponów wczytywanie" onPress={reloadLists} /></>}
    {!active && !shopping.loading && !shopping.error && <ShoppingAction href="/shopping-lists" label="Otwórz listy zakupów" />}
    {items.loading && <ActivityIndicator accessibilityLabel="Wczytywanie listy" />}
    {items.error && <><Notice>{items.error}</Notice><Button secondary title="Ponów wczytywanie produktów" onPress={reloadItems} /></>}
    {active && !items.loading && !items.error && itemCount === 0 && (editing
      ? <EmptyProductGuide message="Wyszukaj produkty i dodaj je do listy." />
      : <>
        <Text style={ui.text}>Wyszukaj produkty i dodaj je do listy.</Text>
        <ShoppingAction href={{ pathname: '/products', params: { listId: active.id } }} label="Dodaj produkty do listy" />
      </>)}
    {editing && items.data?.map(item => <ItemEditor key={item.id} item={item} reload={reloadItems} />)}
    {editing && active && !!itemCount && <>
      <Text style={[ui.text, cartStyles.emptyListText]}>Dodaj więcej produktów</Text>
      <Link href={{ pathname: '/products', params: { listId: active.id } }} asChild>
      <Pressable accessibilityRole="link" accessibilityLabel="Dodaj produkty do listy" style={cartStyles.addProduct}>
        <SymbolView name={{ ios: 'plus', android: 'add', web: 'add' }} size={24} tintColor={colors.link} />
      </Pressable>
      </Link>
    </>}
    {!editing && !!items.data?.length && <>
      <Text style={ui.muted}>Ceny sieciowe nie potwierdzają ceny w konkretnej placówce. Zakładamy posiadanie kart sieci. Uwzględniamy wyłącznie potwierdzone ceny i promocje ogólne.</Text>
      {(comparison.loading || items.loading) && <ActivityIndicator accessibilityLabel="Przeliczanie koszyka" />}
      {comparison.error && <><Notice>{comparison.error}</Notice><Button title="Ponów porównanie" onPress={comparison.reload} /></>}
      {!comparison.loading && !items.loading && !comparison.error && comparison.data?.stores.map(store => <View key={store.store_id} style={ui.card}>
        <Text accessibilityRole="header" style={ui.title}>{store.store_name}</Text>
        {store.complete ? <Text style={ui.heading}>{money(store.total_price)}{store.total_price === minimum ? ' · Najtańszy pełny koszyk' : ''}</Text>
          : <Notice>Brak pełnej wyceny — {store.available_count}/{store.requested_count} pozycji. Ta sieć nie uczestniczy w rankingu najtańszego koszyka.</Notice>}
        {store.items.map(row => <ComparedItem key={row.item_id} row={row} storeId={store.store_id} items={items.data ?? []} reload={items.reload} />)}
      </View>)}
      {!comparison.loading && !comparison.error && minimum == null && <Notice>Żadna sieć nie ma kompletnej wyceny. Sprawdź brakujące produkty lub zmień pozycje listy.</Notice>}
    </>}
  </ShoppingPage>;
}

const cartStyles = StyleSheet.create({
  emptyListText: { textAlign: 'center' },
  addProduct: { alignSelf: 'center', width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  currentList: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18, minHeight: 86, borderRadius: 18 },
  listText: { flex: 1, minWidth: 0, gap: 4 },
  listName: { fontSize: 19, fontWeight: '800' },
});
