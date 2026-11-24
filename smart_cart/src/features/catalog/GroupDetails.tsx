import { useState } from 'react';
import { ActivityIndicator, Image, Text, View } from 'react-native';
import { Button, Field, Notice, useUI } from '@/components/ui/Controls';
import { catalogApi } from './api';
import { priceDateLabel } from './catalogPresentation';
import { useSessionAction, useSessionQuery } from './hooks';
import { useShopping } from './ShoppingProvider';
import { amount, money, quantityHelp, quantityInput, type Offer, type ProductGroup } from './types';

export function OfferInfo({ offer }: { offer: Offer & { price_source?: string | null } }) {
  const ui = useUI();
  return <View style={{ gap: 5 }}>
    <Text style={ui.heading}>{offer.product_name}</Text>
    <Text style={ui.text}>{offer.store_name} · {offer.gramatura_norm ?? 'Brak danych o ilości'}</Text>
    {offer.image_url && /^https:\/\//.test(offer.image_url) && <Image source={{ uri: offer.image_url }} accessibilityLabel={offer.product_name} style={{ width: 80, height: 80, resizeMode: 'contain' }} />}
    <Text style={ui.text}>{money(offer.single_price)}{offer.sale_mode === 'bulk' ? ` za ${amount(offer.quantity_value ?? 1000, offer.quantity_unit ?? 'g')}` : ' za opakowanie / sztukę'}</Text>
    <Text style={ui.muted}>Dane sieciowe · {priceDateLabel({ price_source: offer.price_source ?? null, regular_price_observed_at: offer.regular_price_observed_at })}</Text>
    {offer.sale_mode === 'bulk' && <Text style={ui.muted}>Końcowy koszt zależy od faktycznie zważonej ilości.</Text>}
    {offer.sale_mode === 'unknown' && <Text style={ui.muted}>Brak potwierdzonego sposobu sprzedaży — oferta nie zostanie użyta do wyceny.</Text>}
    {offer.promo_price != null && <Text style={ui.muted}>{offer.verified_promotion ? `Promocja: ${money(offer.promo_price)}. ${offer.promo_condition ?? ''}` : 'Rabat nie został uwzględniony: brak potwierdzenia ogólnodostępności, warunków lub ważności promocji.'}</Text>}
    {offer.verified_promotion && offer.promo_rule?.requires_activation && <Notice>Wymaga aktywacji w aplikacji sklepu.</Notice>}
    {offer.verified_promotion && offer.promo_rule?.requires_card && <Text style={ui.muted}>Wymaga karty lub aplikacji sieci.</Text>}
  </View>;
}
export function GroupDetails({ group, onClose, listId }: { group: ProductGroup; onClose: () => void; listId?: string }) {
  const ui = useUI();
  const [quantity, setQuantity] = useState(String(group.default_quantity ?? (group.unit === 'szt' ? 1 : 1000)));
  const [offset, setOffset] = useState(0);
  const offers = useSessionQuery(signal => catalogApi.offers(group.id, signal, offset), [group.id, offset]);
  const action = useSessionAction();
  const shopping = useShopping();
  const target = shopping.lists.find(list => list.id === (listId ?? shopping.activeId));
  const cannotAdd = shopping.loading || !!shopping.error || (listId !== undefined && !target);
  const favorites = useSessionQuery(catalogApi.favorites, []);
  const isFavorite = favorites.data?.some(row => row.group_id === group.id) ?? false;
  const add = (productId: number | null) => void action.run(async signal => {
    const parsed = quantityInput(quantity, group.unit);
    await shopping.add(group.id, parsed, group.unit, productId, signal, listId);
  }, () => action.setMessage('Dodano do listy zakupów.'));
  return <View style={ui.card}>
    <Text accessibilityRole="header" style={ui.heading}>{group.name}</Text>
    <Text style={ui.muted}>Dobierzemy najtańszy równoważny produkt. Konkretny produkt możesz wybrać poniżej.</Text>
    <Field label={`Potrzebna ilość (${group.unit})`} value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" />
    <Text style={ui.muted}>{quantityHelp[group.unit]}</Text>
    <Text style={ui.muted}>Lista: {target?.name ?? (listId === undefined ? 'Nowa lista Zakupy' : 'Wybrana lista jest niedostępna')}</Text>
    {listId === undefined && shopping.lists.length > 1 && <View style={ui.row}>{shopping.lists.map(list => <Button key={list.id} title={list.name} secondary={list.id !== shopping.activeId} onPress={() => shopping.select(list.id)} />)}</View>}
    <Button title="Dodaj do listy — najtańszy odpowiednik" busy={action.busy} disabled={cannotAdd} onPress={() => add(null)} />
    <Button title={isFavorite ? 'Usuń z ulubionych' : 'Dodaj do ulubionych'} secondary disabled={action.busy || favorites.loading} onPress={() => void action.run(signal => catalogApi.favorite(group.id, !isFavorite, signal), favorites.reload)} />
    {action.message && <Notice>{action.message}</Notice>}
    {shopping.error && <Notice>{shopping.error}</Notice>}
    <Text accessibilityRole="header" style={ui.heading}>Opakowania i oferty</Text>
    {offers.loading && <ActivityIndicator accessibilityLabel="Wczytywanie ofert" />}
    {offers.error && <><Notice>{offers.error}</Notice><Button title="Ponów pobieranie ofert" onPress={offers.reload} /></>}
    {!offers.loading && offers.data?.length === 0 && <Text style={ui.text}>Brak ofert w bazie.</Text>}
    {offers.data?.map(offer => <View key={offer.offer_id} style={ui.card}>
      <OfferInfo offer={offer} />
      <Button secondary title={`Dodaj ten produkt: ${offer.product_name}`} disabled={action.busy || cannotAdd} onPress={() => add(offer.product_id)} />
    </View>)}
    <View style={ui.row}>
      {offset > 0 && <Button secondary title="Poprzednie oferty" onPress={() => setOffset(Math.max(0, offset - 50))} />}
      {offers.data?.length === 50 && <Button secondary title="Następne oferty" onPress={() => setOffset(offset + 50)} />}
      <Button secondary title="Zwiń oferty" onPress={onClose} />
    </View>
  </View>;
}
