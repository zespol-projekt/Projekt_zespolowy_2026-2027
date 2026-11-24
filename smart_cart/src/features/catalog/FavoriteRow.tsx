import { useRef, useState, type ComponentRef } from 'react';
import { SymbolView } from 'expo-symbols';
import { ActivityIndicator, Keyboard, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Field, Notice, useUI } from '@/components/ui/Controls';
import { favoriteTileSize } from './EmptyProductGuide';
import { catalogApi } from './api';
import { CatalogProductCard } from './CatalogProductCard';
import { catalogV1Api, CatalogNotFound } from './catalogV1Api';
import { useSessionAction, useSessionQuery } from './hooks';
import { useShopping } from './ShoppingProvider';
import { amount, money, quantityHelp, quantityInput, type ProductGroup } from './types';

type FavoriteGroup = Pick<ProductGroup, 'id' | 'name' | 'unit'>;

export function FavoriteRow({ group, onRemoved, disabled }: {
  group: FavoriteGroup; onRemoved: () => void; disabled: boolean;
}) {
  const ui = useUI();
  const styles = createStyles(ui);
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
  const offers = useSessionQuery(async signal => {
    try {
      const result = await catalogV1Api.group(group.id, signal);
      if (result.group.group_id !== group.id) throw new Error('Nieprawidłowa grupa w odpowiedzi katalogu.');
      return result;
    } catch (error) {
      if (error instanceof CatalogNotFound) return null;
      throw error;
    }
  }, [group.id]);
  const summary = offers.data?.group;
  const price = summary?.price_from;
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

  return <View style={[ui.card, styles.card, !formVisible && favoriteTileSize]}>
    <View style={[styles.header, !formVisible && styles.compact]}>
      <Pressable ref={groupButton} accessibilityRole="button" accessibilityLabel={`Produkty i ceny: ${group.name}`}
        aria-expanded={expanded}
        accessibilityState={{ expanded, disabled: locked }} disabled={locked}
        onPress={() => { if (!expanded) offers.reload(); setExpanded(!expanded); }}
        style={({ pressed }) => [styles.group, !formVisible && styles.compact, pressed && ui.disabled]}>
        <View style={[styles.photo, !formVisible && styles.compact]}>
          <SymbolView name={{ ios: 'shippingbox', android: 'inventory_2', web: 'inventory_2' }}
            size={42} tintColor={ui.muted.color} style={{ opacity: 0.42 }} />
        </View>
        <Text numberOfLines={formVisible ? undefined : 1} style={ui.heading}>{group.name}</Text>
        <Text numberOfLines={formVisible ? undefined : 1} style={[ui.text, { fontWeight: '700' }]}>
          {price ? `Od ${money(price.unit_price)} / ${price.unit_price_per}` : offers.loading ? 'Wczytywanie ceny…' : 'Brak ceny'}
        </Text>
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
      <Text style={ui.muted}>{quantityHelp[group.unit]}</Text>
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
    {expanded && <FavoriteOffers offers={offers} disabled={locked || shopping.loading || !!shopping.error}
      onAdd={add} onClose={closeOffers} />}
  </View>;
}

function FavoriteOffers({ offers, disabled, onAdd, onClose }: {
  offers: ReturnType<typeof useSessionQuery<Awaited<ReturnType<typeof catalogV1Api.group>> | null>>;
  disabled: boolean; onAdd: (productId: number) => void; onClose: () => void;
}) {
  const ui = useUI();
  const styles = createStyles(ui);
  const products = offers.data?.products ?? [];
  return <View style={styles.details}>
    <Text accessibilityRole="header" style={ui.heading}>Produkty i ceny sieci</Text>
    {offers.loading && <ActivityIndicator accessibilityLabel="Wczytywanie ofert" />}
    {offers.error && <><Notice>{offers.error}</Notice><FavoriteButton secondary title="Ponów pobieranie ofert" onPress={offers.reload} disabled={disabled} /></>}
    {!offers.loading && !offers.error && products.length === 0 && <Text style={ui.text}>Brak ofert w tej chwili.</Text>}
    {!offers.loading && !offers.error && products.map(product => <CatalogProductCard key={product.product_id} product={product}
      onAdd={onAdd} disabled={disabled} />)}
    <FavoriteButton secondary title="Zwiń produkty i ceny" disabled={disabled} onPress={onClose} />
  </View>;
}

// Keep shared colors and touch targets while allowing long labels to wrap in a row.
function FavoriteButton({ title, label = title, onPress, disabled = false, busy = false, secondary = false, selected }: {
  title: string; label?: string; onPress: () => void; disabled?: boolean; busy?: boolean; secondary?: boolean; selected?: boolean;
}) {
  const ui = useUI();
  const styles = createStyles(ui);
  const webSelection = Platform.OS === 'web' && selected !== undefined ? { 'aria-pressed': selected } : {};
  return <Pressable accessibilityRole="button" accessibilityLabel={title} disabled={disabled || busy}
    aria-busy={busy}
    {...webSelection} accessibilityState={{ disabled: disabled || busy, busy, selected: Platform.OS === 'web' ? undefined : selected }} onPress={onPress}
    style={({ pressed }) => [ui.button, styles.button, secondary && ui.secondary, (disabled || busy || pressed) && ui.disabled]}>
    {busy && <ActivityIndicator color={secondary ? ui.secondaryText.color : ui.buttonText.color} />}
    <Text style={[ui.buttonText, styles.buttonText, secondary && ui.secondaryText]}>{label}</Text>
  </Pressable>;
}

const createStyles = (ui: ReturnType<typeof useUI>) => StyleSheet.create({
  card: { width: '100%', padding: 12, gap: 10 },
  compact: { flex: 1, minHeight: 0 },
  header: { position: 'relative' },
  group: { minWidth: 0, gap: 8 },
  photo: { height: 112, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: ui.input.backgroundColor },
  heart: { position: 'absolute', top: 0, right: 0, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  heartText: { fontSize: 28, color: ui.secondaryText.color },
  details: { gap: 10 },
  button: { maxWidth: '100%', flexShrink: 1 },
  buttonText: { flexShrink: 1, textAlign: 'center' },
});
