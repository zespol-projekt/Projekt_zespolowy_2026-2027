import { useState } from 'react';
import { Text, View } from 'react-native';
import { Field, Notice, ui } from '@/components/ui/Controls';
import { catalogApi } from './api';
import { catalogV1Api } from './catalogV1Api';
import type { CatalogItem } from './catalogV1';
import { CatalogButton } from './CatalogControls';
import { CatalogProductCard, DetailStatus } from './CatalogProductCard';
import { useSessionAction, useSessionQuery } from './hooks';
import { useShopping } from './ShoppingProvider';
import { amount, money, quantityInput } from './types';

export function CatalogItemCard({ item, favorite, onFavoriteChanged, quantity, onQuantityChanged }: {
  item: CatalogItem; favorite: boolean | undefined; onFavoriteChanged: () => void; quantity: string; onQuantityChanged: (value: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const action = useSessionAction();
  const shopping = useShopping();
  const target = shopping.lists.find(list => list.id === shopping.activeId)?.name ?? 'Nowa lista Zakupy';
  const disabled = shopping.loading || !!shopping.error || action.busy;
  const detail = useSessionQuery(async signal => {
    if (item.product_count !== 1 && !expanded) return [];
    const result = await catalogV1Api.group(item.group_id, signal);
    if (result.group.group_id !== item.group_id) throw new Error('Nieprawidłowa grupa w odpowiedzi katalogu.');
    if (item.kind === 'product' && (result.products.length !== 1 || result.products[0].product_id !== item.product_id)) {
      throw new Error('Produkt zmienił grupę. Odśwież katalog.');
    }
    return result.products;
  }, [item.kind, item.group_id, item.product_id, item.product_count, expanded]);
  const add = (productId: number | null) => void action.run(async signal => {
    const parsed = quantityInput(quantity, item.unit);
    await shopping.add(item.group_id, parsed, item.unit, productId, signal);
    return `Dodano ${amount(parsed, item.unit)} do listy: ${target}.`;
  }, action.setMessage);

  return <View style={ui.card}>
    <Text accessibilityRole="header" style={ui.heading}>{item.name}</Text>
    <Text style={ui.muted}>{item.product_count} produktów · {item.store_count} sieci · z ceną: {item.stores_with_price_today}</Text>
    <Text style={ui.text}>{item.price_from ? `Od ${money(item.price_from.unit_price)} / ${item.price_from.unit_price_per}` : 'Brak ceny jednostkowej do porównania.'}</Text>
    {item.price_from === null && item.stores_with_price_today > 0 && <Notice>Brak ceny jednostkowej. Opakowanie lub podstawa porównania może być nieznana — sprawdź szczegóły produktu.</Notice>}
    <Field label={`Potrzebna ilość: ${item.name} (${item.unit})`} value={quantity} placeholder="Wpisz ilość"
      keyboardType={item.unit === 'szt' ? 'number-pad' : 'decimal-pad'} editable={!action.busy} onChangeText={onQuantityChanged} />
    <Text style={ui.muted}>Lista: {target}</Text>
    <CatalogButton title={`Dodaj do listy: ${item.name}`} label={item.kind === 'product' ? 'Dodaj produkt' : 'Dodaj grupę'} secondary={false}
      busy={action.busy} disabled={shopping.loading || !!shopping.error} onPress={() => add(item.kind === 'product' ? item.product_id : null)} />
    <CatalogButton title={`${favorite ? 'Usuń grupę z ulubionych' : 'Zapisz grupę w ulubionych'}: ${item.name}`}
      label={favorite ? '♥ Usuń grupę z ulubionych' : '♡ Zapisz grupę w ulubionych'} disabled={action.busy || favorite === undefined}
      onPress={() => void action.run(signal => catalogApi.favorite(item.group_id, !favorite, signal), onFavoriteChanged)} />
    {action.message && <Notice>{action.message}</Notice>}
    {item.product_count > 1 && <CatalogButton title={`${expanded ? 'Zwiń' : 'Pokaż'} produkty: ${item.name}`}
      label={expanded ? 'Zwiń produkty i ceny' : 'Pokaż produkty i ceny'} expanded={expanded} disabled={action.busy} onPress={() => setExpanded(value => !value)} />}
    {(item.product_count === 1 || expanded) && <>
      <DetailStatus loading={detail.loading} error={detail.error} retry={detail.reload} />
      {!detail.loading && !detail.error && detail.data?.map(product => <CatalogProductCard key={product.product_id} product={product}
        showAdd={item.kind === 'group'} showHeading={item.kind === 'group'} onAdd={add} disabled={disabled} />)}
    </>}
  </View>;
}
