import { useCallback, useState } from 'react';
import { Link, useFocusEffect } from 'expo-router';
import { ActivityIndicator, Text, View } from 'react-native';
import { Button, Field, Notice, Screen, useUI } from '@/components/ui/Controls';
import { catalogApi } from './api';
import { useSessionAction, useSessionKey, useSessionQuery } from './hooks';
import { useShopping } from './ShoppingProvider';
import { OfferInfo } from './GroupDetails';
import { amount, money, quantityInput, type ComparisonItem, type ShoppingItem } from './types';

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
        {/* compare_basket does not yet document the source needed to interpret observed_at. */}
        <Text style={ui.muted}>Data ceny nieznana.</Text>
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
  return key ? <Cart key={key} /> : null;
}
function Cart() {
  const ui = useUI();
  const shopping = useShopping();
  const [name, setName] = useState('');
  const [rename, setRename] = useState<{ id: string; value: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const action = useSessionAction();
  const activeId = shopping.activeId;
  const active = shopping.lists.find(list => list.id === activeId);
  const items = useSessionQuery(signal => activeId ? catalogApi.items(activeId, signal) : Promise.resolve([]), [activeId]);
  const comparison = useSessionQuery(signal => items.data?.length
    ? catalogApi.compare(items.data, signal)
    : Promise.resolve({ version: 2 as const, calculated_at: '', stores: [] }), [items.data]);
  const editedName = active && rename?.id === active.id ? rename.value : active?.name ?? '';
  const reloadLists = shopping.reload;
  const reloadItems = items.reload;
  useFocusEffect(useCallback(() => { reloadLists(); reloadItems(); }, [reloadLists, reloadItems]));
  const complete = comparison.data?.stores.filter(store => store.complete && store.total_price != null) ?? [];
  const minimum = complete.length ? Math.min(...complete.map(store => store.total_price as number)) : null;
  return <Screen title="Listy zakupów">
    <Text style={ui.muted}>Prywatne listy na Twoim koncie. Zmiana produktów lub ilości przelicza ceny sieciowe.</Text>
    <View style={ui.card}>
      <Field label="Nazwa nowej listy" value={name} onChangeText={setName} maxLength={100} />
      <Button title="Utwórz listę" busy={action.busy} disabled={!name.trim()} onPress={() => void action.run(signal => shopping.create(name, signal), () => setName(''))} />
      {shopping.lists.length > 0 && <View style={ui.row}>{shopping.lists.map(list => <Button key={list.id} title={list.name} secondary={list.id !== activeId} onPress={() => shopping.select(list.id)} />)}</View>}
      <Button secondary title="Odśwież listy i ceny" disabled={shopping.loading || items.loading} onPress={() => { shopping.reload(); items.reload(); }} />
    </View>
    {shopping.loading && <ActivityIndicator />}
    {shopping.error && <Notice>{shopping.error}</Notice>}
    {action.message && <Notice>{action.message}</Notice>}
    {active && <View style={ui.card}>
      <Text accessibilityRole="header" style={ui.heading}>{active.name}</Text>
      <Field label="Zmień nazwę listy" value={editedName} onChangeText={value => setRename({ id: active.id, value })} maxLength={100} />
      <View style={ui.row}>
        <Button secondary title="Zapisz nazwę" disabled={action.busy || !editedName.trim()} onPress={() => void action.run(signal => catalogApi.renameList(active.id, editedName, signal), shopping.reload)} />
        <Button secondary title="Usuń listę" disabled={action.busy} onPress={() => setDeleting(active.id)} />
      </View>
      {deleting === active.id && <><Notice>Usunąć tę listę i wszystkie jej pozycje?</Notice><View style={ui.row}>
        <Button title="Potwierdź usunięcie listy" busy={action.busy} onPress={() => void action.run(signal => catalogApi.deleteList(active.id, signal), () => { setDeleting(null); shopping.reload(); items.reload(); })} />
        <Button secondary title="Anuluj usuwanie" onPress={() => setDeleting(null)} />
      </View></>}
    </View>}
    <Link href="/products" style={[ui.text, { fontWeight: '700', padding: 10 }]}>Dodaj produkty do listy →</Link>
    {items.loading && <ActivityIndicator accessibilityLabel="Wczytywanie listy" />}
    {items.error && <Notice>{items.error}</Notice>}
    {active && !items.loading && items.data?.length === 0 && <Text style={ui.text}>Lista jest pusta. Wybierz grupę na ekranie Produkty.</Text>}
    {items.data?.map(item => <ItemEditor key={item.id} item={item} reload={items.reload} />)}
    {!!items.data?.length && <>
      <Text accessibilityRole="header" style={ui.title}>Porównanie sieci</Text>
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
  </Screen>;
}
