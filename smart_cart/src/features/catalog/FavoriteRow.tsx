import { useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, Keyboard, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Field, Notice, ui } from '@/components/ui/Controls';
import { catalogApi } from './api';
import { CatalogProductCard } from './CatalogProductCard';
import { catalogV1Api, CatalogNotFound } from './catalogV1Api';
import { useSessionAction, useSessionQuery } from './hooks';
import { useShopping } from './ShoppingProvider';
import { amount, quantityInput, type ProductGroup } from './types';

type FavoriteGroup = Pick<ProductGroup, 'id' | 'name' | 'unit'>;

export function FavoriteRow({ group, onRemoved, disabled }: {
  group: FavoriteGroup; onRemoved: () => void; disabled: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const groupButton = useRef<ComponentRef<typeof View>>(null);
  const addButton = useRef<ComponentRef<typeof View>>(null);
  // The backend default is technical; keep the requested quantity explicit.
  const [quantity, setQuantity] = useState('');
  const action = useSessionAction();
  const shopping = useShopping();
  const locked = disabled || action.busy;
  const formVisible = adding || expanded;
  const closeOffers = () => {
    setExpanded(false);
    Keyboard.dismiss();
    groupButton.current?.focus();
  };
  const targetName = shopping.lists.find(list => list.id === shopping.activeId)?.name ?? 'Nowa lista Zakupy';
  const add = (productId: number | null) => void action.run(async signal => {
    const parsed = quantityInput(quantity, group.unit);
    await shopping.add(group.id, parsed, group.unit, productId, signal);
    return `Dodano ${amount(parsed, group.unit)} do listy: ${targetName}.`;
  }, action.setMessage);

  return <View style={[ui.card, styles.card]}>
    <View style={styles.header}>
      <Pressable ref={groupButton} accessibilityRole="button" accessibilityLabel={`Produkty i ceny: ${group.name}`}
        aria-expanded={expanded}
        accessibilityState={{ expanded, disabled: locked }} disabled={locked}
        onPress={() => setExpanded(value => !value)} style={({ pressed }) => [styles.group, pressed && ui.disabled]}>
        <View style={styles.icon} aria-hidden><Text allowFontScaling={false} style={styles.iconText}>▦</Text></View>
        <View style={styles.name}>
          <Text style={ui.heading}>{group.name}</Text>
          <Text style={ui.muted}>{expanded ? 'Zwiń produkty i ceny' : 'Zobacz produkty i ceny'}</Text>
        </View>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Usuń z ulubionych: ${group.name}`}
        aria-busy={action.busy}
        accessibilityState={{ disabled: locked, busy: action.busy }} disabled={locked}
        onPress={() => void action.run(signal => catalogApi.favorite(group.id, false, signal), onRemoved)}
        style={({ pressed }) => [styles.heart, (locked || pressed) && ui.disabled]}>
        <Text allowFontScaling={false} style={styles.heartText}>♥</Text>
      </Pressable>
    </View>
    <Pressable ref={addButton} accessibilityRole="button" accessibilityLabel={`${formVisible ? 'Anuluj dodawanie' : 'Dodaj do listy'}: ${group.name}`}
      aria-expanded={formVisible}
      accessibilityState={{ disabled: locked, expanded: formVisible }} disabled={locked}
      onPress={() => {
        if (formVisible) {
          setAdding(false); setExpanded(false); Keyboard.dismiss(); addButton.current?.focus();
        } else setAdding(true);
      }}
      style={({ pressed }) => [ui.button, ui.secondary, (locked || pressed) && ui.disabled]}>
      <Text style={[ui.buttonText, ui.secondaryText, styles.buttonText]}>{formVisible ? 'Anuluj dodawanie' : 'Dodaj do listy'}</Text>
    </Pressable>
    {formVisible && <View style={styles.details}>
      <Field label={`Potrzebna ilość: ${group.name} (${group.unit})`} value={quantity}
        placeholder="Wpisz ilość" keyboardType={group.unit === 'szt' ? 'number-pad' : 'decimal-pad'}
        autoFocus={adding} returnKeyType="done" submitBehavior="blurAndSubmit" onSubmitEditing={Keyboard.dismiss}
        accessibilityHint={`Wpisz potrzebną ilość w jednostce ${group.unit}. Enter kończy wpisywanie; dodanie wymaga osobnego przycisku.`}
        editable={!locked} onChangeText={setQuantity} />
      <Text style={ui.muted}>Lista: {targetName}</Text>
      {shopping.lists.length > 1 && <View style={ui.row}>
        {shopping.lists.map(list => <FavoriteButton key={list.id} title={`Lista: ${list.name}`} label={list.name} selected={list.id === shopping.activeId}
          secondary={list.id !== shopping.activeId} disabled={locked || shopping.loading}
          onPress={() => shopping.select(list.id)} />)}
      </View>}
      <FavoriteButton title={`Dodaj grupę: ${group.name}`} label="Dodaj grupę" busy={action.busy}
        disabled={disabled || shopping.loading || !!shopping.error} onPress={() => add(null)} />
      <Text style={ui.muted}>Dobierzemy najtańszy zgodny produkt osobno dla każdej sieci.</Text>
      {shopping.error && <><Notice>{shopping.error}</Notice><FavoriteButton secondary title="Ponów pobieranie list" onPress={shopping.reload} disabled={locked || shopping.loading} /></>}
    </View>}
    {action.message && <Notice>{action.message}</Notice>}
    {expanded && <FavoriteOffers groupId={group.id} disabled={locked || shopping.loading || !!shopping.error}
      onAdd={add} onClose={closeOffers} />}
  </View>;
}

function FavoriteOffers({ groupId, disabled, onAdd, onClose }: {
  groupId: number; disabled: boolean; onAdd: (productId: number) => void; onClose: () => void;
}) {
  const offers = useSessionQuery(async signal => {
    try {
      const result = await catalogV1Api.group(groupId, signal);
      if (result.group.group_id !== groupId) throw new Error('Nieprawidłowa grupa w odpowiedzi katalogu.');
      return result.products;
    } catch (error) {
      if (error instanceof CatalogNotFound) return [];
      throw error;
    }
  }, [groupId]);
  return <View style={styles.details}>
    <Text accessibilityRole="header" style={ui.heading}>Produkty i ceny sieci</Text>
    {offers.loading && <ActivityIndicator accessibilityLabel="Wczytywanie ofert" />}
    {offers.error && <><Notice>{offers.error}</Notice><FavoriteButton secondary title="Ponów pobieranie ofert" onPress={offers.reload} disabled={disabled} /></>}
    {!offers.loading && !offers.error && offers.data?.length === 0 && <Text style={ui.text}>Brak ofert w tej chwili.</Text>}
    {!offers.loading && !offers.error && offers.data?.map(product => <CatalogProductCard key={product.product_id} product={product}
      onAdd={onAdd} disabled={disabled} />)}
    <FavoriteButton secondary title="Zwiń produkty i ceny" disabled={disabled} onPress={onClose} />
  </View>;
}

// Keep shared colors and touch targets while allowing long labels to wrap in a row.
function FavoriteButton({ title, label = title, onPress, disabled = false, busy = false, secondary = false, selected }: {
  title: string; label?: string; onPress: () => void; disabled?: boolean; busy?: boolean; secondary?: boolean; selected?: boolean;
}) {
  const webSelection = Platform.OS === 'web' && selected !== undefined ? { 'aria-pressed': selected } : {};
  return <Pressable accessibilityRole="button" accessibilityLabel={title} disabled={disabled || busy}
    aria-busy={busy}
    {...webSelection} accessibilityState={{ disabled: disabled || busy, busy, selected: Platform.OS === 'web' ? undefined : selected }} onPress={onPress}
    style={({ pressed }) => [ui.button, styles.button, secondary && ui.secondary, (disabled || busy || pressed) && ui.disabled]}>
    {busy && <ActivityIndicator color={secondary ? ui.secondaryText.color : ui.buttonText.color} />}
    <Text style={[ui.buttonText, styles.buttonText, secondary && ui.secondaryText]}>{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  card: { padding: 12, gap: 10 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  group: { flex: 1, minWidth: 0, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { flex: 1, minWidth: 0, gap: 4 },
  icon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: ui.secondary.backgroundColor },
  iconText: { fontSize: 26, color: ui.secondaryText.color },
  heart: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  heartText: { fontSize: 28, color: ui.secondaryText.color },
  details: { gap: 10 },
  button: { maxWidth: '100%', flexShrink: 1 },
  buttonText: { flexShrink: 1, textAlign: 'center' },
});
