import { CART_TAB_RISE } from '@/components/navigation/BottomBar';
import { SearchField } from '@/components/ui/SearchField';
import { useSessionKey } from '@/features/catalog/hooks';
import { CHAIN_LOGOS, CHAIN_TILE_COLORS, CHAIN_TILE_RADIUS } from '@/features/stores/chainLogos';
import { BRANDS, CHAINS } from '@/features/stores/model';
import { useTheme } from '@/features/theme/ThemeProvider';
import { Link, router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useRef, useState, type ComponentRef } from 'react';
import { Image, Keyboard, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

const shortcuts = [
  { title: 'Ulubione', description: 'Zapisane produkty', href: '/favorites', icon: { ios: 'heart', android: 'favorite_border', web: 'favorite_border' },
    light: ['#F8E7E3', '#A3493D'], dark: ['#422C28', '#FFB2A6'] },
  { title: 'Produkty', description: 'Przeglądaj produkty i ceny', href: '/products', icon: { ios: 'shippingbox', android: 'inventory_2', web: 'inventory_2' },
    light: ['#E4EFF6', '#265A7A'], dark: ['#263C49', '#ACD8F2'] },
] as const;
const arrow = { ios: 'arrow.right', android: 'arrow_forward', web: 'arrow_forward' } as const;

export default function Home() {
  const key = useSessionKey();
  return key ? <HomeContent key={key} /> : null;
}

function HomeContent() {
  const { colors, dark } = useTheme();
  const [query, setQuery] = useState('');
  const [{ width, height }, setSize] = useState({ width: 0, height: 0 });
  const compact = height < 510;
  const dense = height < 325;
  const wide = width >= 560 && height < 400;
  const roomy = height >= 640;
  const submit = () => { Keyboard.dismiss(); router.navigate({ pathname: '/products', params: { q: query } }); };

  return <View testID="home-grid" style={[styles.screen, compact && styles.compactScreen, dense && styles.denseScreen]}
    onLayout={({ nativeEvent: { layout } }) => setSize({ width: layout.width, height: layout.height })}>
    <SearchField containerStyle={[styles.search, { backgroundColor: colors.surface, borderColor: colors.border }]}
      placeholder="Szukaj produktów..." accessibilityLabel="Szukaj produktów" autoCapitalize="none"
      value={query} onChangeText={setQuery} onSubmitEditing={submit}
      leading={<SymbolView name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }} size={22} tintColor={colors.muted} />}>
      <Pressable accessibilityRole="button" accessibilityLabel="Szukaj produktów" onPress={submit}
        style={[styles.searchAction, { backgroundColor: colors.secondary }]}>
        <SymbolView name={arrow} size={20} tintColor={colors.link} />
      </Pressable>
    </SearchField>
    <View style={[styles.body, compact && styles.compactBody, wide && styles.wideBody, roomy && styles.roomyBody]}>
      <View style={[styles.shortcuts, compact && styles.compactBody, wide && styles.column]}>
        <Link href="/shopping-lists" asChild>
          <Pressable accessibilityRole="link" accessibilityLabel="Listy zakupów"
            style={StyleSheet.flatten([styles.hero, { backgroundColor: colors.secondary, borderColor: colors.border },
              compact && styles.compactHero, roomy && styles.roomyHero])}>
            <View style={styles.heroText}>
              <Text style={[styles.heroTitle, compact && styles.compactHeroTitle, { color: colors.text }]}>Listy zakupów</Text>
              {!compact && <Text style={{ color: colors.muted }}>Wszystkie Twoje zapisane listy</Text>}
              <View style={styles.openLists}>
                <Text style={{ color: colors.link }}>Otwórz listy</Text>
                <SymbolView name={arrow} size={17} tintColor={colors.link} />
              </View>
            </View>
            <View style={[styles.checklist, compact && styles.compactChecklist, { backgroundColor: colors.surface, borderColor: colors.border },
              !compact && { boxShadow: `0 5px 0 ${colors.border}` }]}>
              <SymbolView name={{ ios: 'checklist', android: 'checklist', web: 'checklist' }} size={compact ? 30 : 40} tintColor={colors.link} />
            </View>
          </Pressable>
        </Link>
        <View style={styles.shortcutRow}>
          {shortcuts.map(item => {
            const [backgroundColor, tintColor] = dark ? item.dark : item.light;
            return <Link key={item.href} href={item.href} asChild>
              <Pressable accessibilityRole="link" accessibilityLabel={item.title}
                style={StyleSheet.flatten([styles.tile, { borderColor: colors.border, backgroundColor: colors.surface },
                  compact && styles.compactTile, roomy && styles.roomyTile])}>
                <View style={styles.tileTop}>
                  <View style={[styles.badge, compact && styles.compactBadge, { backgroundColor }]}>
                    <SymbolView name={item.icon} size={compact ? 17 : 23} tintColor={tintColor} />
                  </View>
                  {!compact && <SymbolView name={{ ios: 'arrow.up.right', android: 'arrow_outward', web: 'arrow_outward' }} size={16} tintColor={tintColor} />}
                </View>
                <View style={[styles.tileText, compact && styles.column]}>
                  <Text style={[styles.tileTitle, compact && styles.compactTileTitle, { color: colors.text }]}>{item.title}</Text>
                  {!compact && <Text style={{ color: colors.muted, fontSize: 13 }}>{item.description}</Text>}
                </View>
              </Pressable>
            </Link>;
          })}
        </View>
      </View>
      <View style={wide && styles.column}><LeafletRail compact={compact} roomy={roomy} /></View>
    </View>
  </View>;
}

function LeafletRail({ compact, roomy }: { compact: boolean; roomy: boolean }) {
  const { colors } = useTheme();
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const [viewport, setViewport] = useState(0);
  const [offset, setOffset] = useState(0);
  const tileWidth = compact ? 72 : 98;
  const gap = 10;
  const maxOffset = Math.max(0, CHAINS.length * (tileWidth + gap) - gap - viewport);
  const move = (direction: number) => {
    scroll.current?.scrollTo({ x: Math.max(0, Math.min(maxOffset, offset + direction * (tileWidth + gap))), animated: true });
  };

  return <View style={[styles.leaflets, compact && styles.compactLeaflets]}>
    <View style={styles.leafletHeading}>
      <View style={[styles.tileText, styles.column]}>
        <Link href="/leaflets" accessibilityLabel="Gazetki" style={[styles.leafletTitle, { color: colors.text }]}>Gazetki</Link>
        {!compact && <Text style={{ color: colors.muted }}>Co nowego w sklepach?</Text>}
      </View>
      <View style={styles.railControls}>
        {([-1, 1] as const).map(direction => {
          const disabled = direction === -1 ? offset < 1 : offset >= maxOffset - 1;
          return <Pressable key={direction} style={styles.railButton} onPress={() => move(direction)} disabled={disabled}
            accessibilityRole="button" accessibilityState={{ disabled }} accessibilityLabel={direction === -1 ? 'Poprzednie sieci' : 'Następne sieci'}>
            <SymbolView name={direction === -1
              ? { ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }
              : { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
              tintColor={colors.muted} size={22} style={{ opacity: disabled ? 0.4 : 1 }} />
          </Pressable>;
        })}
      </View>
    </View>
    <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled"
      onLayout={event => setViewport(event.nativeEvent.layout.width)}
      onScroll={event => setOffset(event.nativeEvent.contentOffset.x)} scrollEventThrottle={16}
      contentContainerStyle={{ gap }}>
      {CHAINS.map(chain => <Link key={chain} href={{ pathname: '/leaflets', params: { chain } }} asChild>
        <Pressable style={{ width: tileWidth, gap: 4 }} accessibilityRole="link" accessibilityLabel={`Gazetki: ${BRANDS[chain].name}`}>
          <View testID="leaflet-chain-tile"
            style={[styles.leafletTile, compact && styles.compactLeafletTile, roomy && styles.roomyLeafletTile, CHAIN_TILE_COLORS[chain]]}>
            <Image source={{ uri: CHAIN_LOGOS[chain] }} resizeMode="contain" accessible={false} style={styles.leafletLogo} />
          </View>
          <Text style={[styles.chainName, { color: colors.text }]}>{BRANDS[chain].name}</Text>
        </Pressable>
      </Link>)}
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, minHeight: 0, paddingHorizontal: 20, paddingTop: 8, paddingBottom: CART_TAB_RISE, gap: 14 },
  compactScreen: { paddingTop: 4, gap: 6 },
  denseScreen: { paddingTop: 2, gap: 5 },
  search: { borderWidth: 1, paddingRight: 5 },
  searchAction: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  body: { gap: 18 },
  compactBody: { gap: 6 },
  roomyBody: { gap: 24 },
  wideBody: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  column: { flex: 1, minWidth: 0 },
  shortcuts: { gap: 12 },
  hero: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 132, padding: 16, borderRadius: 20, borderWidth: 1 },
  compactHero: { minHeight: 66, padding: 8, paddingHorizontal: 12 },
  roomyHero: { minHeight: 146 },
  heroText: { flex: 1, minWidth: 0, gap: 4 },
  heroTitle: { fontSize: 25, fontWeight: '800' },
  compactHeroTitle: { fontSize: 18 },
  openLists: { flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: 2 },
  checklist: { width: 60, height: 74, marginRight: 2, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '8deg' }] },
  compactChecklist: { width: 38, height: 46, borderRadius: 8 },
  shortcutRow: { flexDirection: 'row', gap: 10 },
  tile: { flex: 1, minWidth: 0, minHeight: 112, gap: 8, borderRadius: 18, borderWidth: 1, padding: 12, justifyContent: 'space-between' },
  compactTile: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 6, minHeight: 46, padding: 6 },
  roomyTile: { minHeight: 124 },
  tileTop: { flexDirection: 'row', justifyContent: 'space-between' },
  tileText: { minWidth: 0, gap: 3 },
  tileTitle: { fontSize: 18, fontWeight: '800' },
  compactTileTitle: { fontSize: 14 },
  badge: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  compactBadge: { width: 27, height: 27, borderRadius: 8 },
  leaflets: { gap: 4 },
  compactLeaflets: { gap: 2 },
  leafletHeading: { flexDirection: 'row', alignItems: 'center' },
  leafletTitle: { fontSize: 21, fontWeight: '800' },
  railControls: { flexDirection: 'row' },
  railButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  leafletTile: { height: 72, borderWidth: 1, borderRadius: CHAIN_TILE_RADIUS, padding: 10, alignItems: 'center', justifyContent: 'center' },
  compactLeafletTile: { height: 34, padding: 4 },
  roomyLeafletTile: { height: 80 },
  leafletLogo: { width: '100%', height: '100%' },
  chainName: { fontSize: 12, fontWeight: '700', textAlign: 'center' },
});
