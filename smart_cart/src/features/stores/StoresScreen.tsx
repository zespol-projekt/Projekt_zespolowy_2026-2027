import { SearchField } from '@/components/ui/SearchField';
import { useTheme } from '@/features/theme/ThemeProvider';
import type { ThemeColors } from '@/features/theme/palette';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useRef, useState, type ComponentRef, type FocusEvent as WebFocusEvent } from 'react';
import { ActivityIndicator, Image, Keyboard, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import StoreMap from './StoreMap';
import type { MapFocus } from './StoreMap.types';
import { CHAIN_LOGOS, CHAIN_TILE_COLORS, CHAIN_TILE_RADIUS } from './chainLogos';
import { BRANDS, CHAINS, createStoreSearch, directionsUrl, distanceMeters, POLAND, POLAND_BOUNDS, type Chain, type Store } from './model';
import { useMyLocation } from './useMyLocation';
import { useStores } from './useStores';

const STORE_CARD_WIDTH = 232;
const STORE_CARD_MIN_HEIGHT = 144;
const STORE_CARD_INSET = 10;
// MapLibre uses a 10 px inset and 36 px zoom buttons. Leave a 6 px gap.
const MAP_ZOOM_CLEARANCE = 52;

export default function StoresScreen() {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const { height, width } = useWindowDimensions();
  const compact = height < 720;
  const compactControls = width < 420;
  const { catalog, loading, error, retry } = useStores();
  const { location, requesting, message, locate, dismissMessage } = useMyLocation();
  const [chains, setChains] = useState<Chain[]>([...CHAINS]);
  const [query, setQuery] = useState('');
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const searchRow = useRef<ComponentRef<typeof View>>(null);
  const suggestionsList = useRef<ComponentRef<typeof ScrollView>>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const [navigating, setNavigating] = useState(false);
  const search = useMemo(() => createStoreSearch(catalog?.stores ?? []), [catalog]);
  const filtered = useMemo(() => search.findStores(chains, query), [search, chains, query]);
  const suggestions = suggestionsOpen ? search.suggestCities(query) : [];
  const selected = useMemo(() => filtered.find(s => s.id === selectedId) ?? null, [filtered, selectedId]);
  const counts = useMemo(() => Object.fromEntries(CHAINS.map(chain => [chain,
    catalog?.stores.filter(s => s.chain === chain).length ?? 0])), [catalog]);
  // Remove the previous selection when filters or the session remove that store.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!selected) { setSelectedId(null); setNavigationError(null); } }, [selected]);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const subscription = Keyboard.addListener('keyboardDidHide', () => setSuggestionsOpen(false));
    return () => subscription.remove();
  }, []);

  const toggleChain = (chain: Chain) => setChains(current => current.includes(chain) ? current.filter(c => c !== chain) : [...current, chain]);
  const focusStores = (stores: Store[]) => {
    if (!stores.length) return;
    if (stores.length === 1) {
      setFocus(old => ({ point: stores[0], zoom: 15, request: (old?.request ?? 0) + 1 }));
      return;
    }
    const bounds = { north: -90, south: 90, east: -180, west: 180 };
    for (const s of stores) {
      bounds.north = Math.max(bounds.north, s.latitude); bounds.south = Math.min(bounds.south, s.latitude);
      bounds.east = Math.max(bounds.east, s.longitude); bounds.west = Math.min(bounds.west, s.longitude);
    }
    setFocus(old => ({ point: { latitude: (bounds.north + bounds.south) / 2, longitude: (bounds.east + bounds.west) / 2 },
      bounds, request: (old?.request ?? 0) + 1 }));
  };
  const closeSuggestions = () => {
    setSuggestionsOpen(false);
    Keyboard.dismiss();
  };
  const showResults = () => {
    closeSuggestions();
    focusStores(filtered);
  };
  const chooseCity = (city: string) => {
    setQuery(city);
    closeSuggestions();
    focusStores(search.findStores(chains, city));
  };
  const showMyLocation = async () => {
    closeSuggestions();
    const point = await locate();
    if (point) setFocus(old => ({ point, zoom: 14, request: (old?.request ?? 0) + 1 }));
  };
  const navigate = async () => {
    if (!selected || navigating) return;
    setNavigating(true); setNavigationError(null);
    try { await Linking.openURL(directionsUrl(selected, Platform.OS)); }
    catch { setNavigationError('Nie udało się otworzyć nawigacji. Spróbuj ponownie.'); }
    finally { setNavigating(false); }
  };
  const distance = selected && location ? distanceMeters(selected, location) : null;

  return <View style={[styles.screen, compact && styles.compactScreen]}
    onBlur={Platform.OS === 'web' ? event => {
      const { relatedTarget } = event as unknown as WebFocusEvent<HTMLElement>;
      const searchElement = searchRow.current as unknown as HTMLElement | null;
      const suggestionsElement = suggestionsList.current?.getScrollableNode() as HTMLElement | undefined;
      if (!searchElement?.contains(relatedTarget) && !suggestionsElement?.contains(relatedTarget)) {
        setSuggestionsOpen(false);
      }
    } : undefined}>
    <View ref={searchRow} style={styles.searchRow}>
      <SearchField containerStyle={styles.search} placeholder="Miasto lub adres sklepu"
        accessibilityLabel="Miasto lub adres sklepu" value={query}
        onFocus={() => setSuggestionsOpen(true)}
        onChangeText={text => { setQuery(text); setSuggestionsOpen(true); }}
        onKeyPress={({ nativeEvent }) => { if (nativeEvent.key === 'Escape') setSuggestionsOpen(false); }}
        onSubmitEditing={showResults}>
        {!!query && <Pressable style={styles.searchAction} onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Wyczyść wyszukiwanie">
          <Text style={styles.clear}>×</Text>
        </Pressable>}
        <Pressable style={styles.searchAction} onPress={showResults} accessibilityRole="button" accessibilityLabel="Pokaż wyniki na mapie"
          disabled={!filtered.length} accessibilityState={{ disabled: !filtered.length }}>
          <Text style={styles.searchButton}>Szukaj</Text>
        </Pressable>
      </SearchField>
      <Pressable style={[styles.locationButton, requesting && styles.disabled]} onPress={showMyLocation}
        accessibilityRole="button" accessibilityLabel="Moja lokalizacja" accessibilityState={{ disabled: requesting, busy: requesting }} disabled={requesting}>
        {requesting ? <ActivityIndicator size="small" color={colors.onPrimary} />
          : <SymbolView name={{ ios: 'scope', android: 'my_location', web: 'my_location' }} size={22} tintColor={colors.onPrimary} />}
      </Pressable>
    </View>

    {message && <View style={styles.notice} accessibilityLiveRegion="polite">
      <Text style={styles.noticeText}>{message}</Text>
      <Pressable onPress={dismissMessage} hitSlop={8} accessibilityRole="button" accessibilityLabel="Zamknij komunikat"><Text style={styles.clear}>×</Text></Pressable>
    </View>}
    {error && catalog && <View style={styles.notice}><Text style={styles.noticeText}>{error}</Text><Pressable onPress={retry}><Text style={styles.retryText}>Ponów</Text></Pressable></View>}

    <View style={styles.mapFrame}>
      {catalog ? <StoreMap stores={filtered} selectedId={selectedId} onSelect={setSelectedId} userLocation={location} focus={focus} />
        : <View style={styles.loading}>
          {loading ? <><ActivityIndicator size="large" color={colors.primary} /><Text style={styles.loadingText}>Wczytywanie sklepów…</Text></>
            : <><Text style={styles.errorTitle}>Sklepy są chwilowo niedostępne</Text><Text style={styles.loadingText}>{error}</Text>
              <Pressable style={styles.retryButton} onPress={retry} accessibilityRole="button"><Text style={styles.retryButtonText}>Spróbuj ponownie</Text></Pressable></>}
        </View>}
      {catalog && <View style={styles.mapControls} pointerEvents="box-none">
        <View style={styles.filterList} accessibilityLabel="Filtry sieci sklepów">
          {CHAINS.map(chain => {
            const active = chains.includes(chain);
            return <Pressable key={chain} onPress={() => toggleChain(chain)} accessibilityRole="checkbox"
              accessibilityLabel={`${BRANDS[chain].name}, ${counts[chain]} sklepów`} accessibilityState={{ checked: active }} aria-checked={active}
              style={[styles.filter, CHAIN_TILE_COLORS[chain], !active && styles.filterInactive]}>
              <Image source={{ uri: CHAIN_LOGOS[chain] }} resizeMode="contain" accessible={false} style={styles.filterLogo} />
            </Pressable>;
          })}
        </View>
        <Pressable style={[styles.mapControl, compactControls && styles.compactMapControl]}
          onPress={() => setFocus(old => ({ point: POLAND, bounds: POLAND_BOUNDS, request: (old?.request ?? 0) + 1 }))}
          accessibilityRole="button" accessibilityLabel="Pokaż całą Polskę"><Text style={styles.mapControlText}>Cała Polska</Text></Pressable>
      </View>}

      {catalog && !filtered.length && <View style={styles.empty}>
        <Text style={styles.emptyTitle}>{chains.length ? 'Nie znaleźliśmy sklepów' : 'Wybierz sieć sklepów'}</Text>
        <Text style={styles.emptyText}>{chains.length ? 'Spróbuj wpisać inną miejscowość lub ulicę.' : 'Włącz co najmniej jedną sieć u góry mapy.'}</Text>
        <Pressable onPress={() => { setQuery(''); setChains([...CHAINS]); }} accessibilityRole="button" style={styles.emptyAction}>
          <Text style={styles.retryText}>Pokaż wszystkie sklepy</Text>
        </Pressable>
      </View>}

      {selected && <View style={styles.card} testID="store-card">
        <View style={styles.cardHeading}>
          <View style={styles.brandBadge}>
            <Image source={{ uri: CHAIN_LOGOS[selected.chain] }} resizeMode="contain" accessible={false} style={styles.brandLogo} />
          </View>
          <View style={styles.cardTitleArea}><Text style={styles.cardTitle} accessibilityRole="header" numberOfLines={1}>{selected.name}</Text>
            {distance !== null && <Text style={styles.distance} numberOfLines={1}>{distance < 1000 ? `${Math.round(distance / 10) * 10} m` : `${(distance / 1000).toFixed(1)} km`} w linii prostej</Text>}
          </View>
          <Pressable onPress={() => setSelectedId(null)} style={styles.closeCard} accessibilityRole="button" accessibilityLabel="Zamknij kartę sklepu"><Text style={styles.clear}>×</Text></Pressable>
        </View>
        <Text style={styles.address}>{selected.address}</Text>
        <Pressable onPress={navigate} style={[styles.navigate, navigating && styles.disabled]} disabled={navigating}
          accessibilityRole="button" accessibilityLabel="Wyznacz trasę" accessibilityHint="Otwiera zewnętrzną aplikację nawigacyjną">
          <Text style={styles.navigateText}>Wyznacz trasę ↗</Text>
        </Pressable>
        {navigationError && <Text style={styles.navigationError} accessibilityLiveRegion="polite">{navigationError}</Text>}
      </View>}
      {suggestions.length > 0 && <ScrollView ref={suggestionsList} testID="city-suggestions" accessibilityLabel="Podpowiedzi miejscowości"
        keyboardShouldPersistTaps="handled" style={[styles.suggestions, compact && styles.compactSuggestions]}>
        {suggestions.map(city => <Pressable key={city} onPress={() => chooseCity(city)}
          accessibilityRole="button" style={styles.suggestion}>
          <Text style={styles.suggestionText}>{city}</Text>
        </Pressable>)}
      </ScrollView>}
    </View>
  </View>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  compactScreen: { gap: 6, paddingTop: 8 },
  screen: { flex: 1, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4, gap: 10 },
  locationButton: { width: 44, minHeight: 44, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.6 },
  filterList: { flex: 1, minWidth: 0, flexDirection: 'row', gap: 4 },
  filter: { flex: 1, minWidth: 0, minHeight: 44, alignItems: 'center',
    justifyContent: 'center', paddingHorizontal: 2, borderWidth: 1, borderRadius: CHAIN_TILE_RADIUS },
  filterLogo: { width: '100%', maxWidth: 54, height: 30 },
  filterInactive: { opacity: 0.42 },
  searchRow: { flexDirection: 'row', gap: 6 },
  suggestions: { position: 'absolute', left: 0, right: 0, top: 0, maxHeight: 220, zIndex: 1,
    borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surface,
    elevation: 7, boxShadow: '0px 3px 10px rgba(0, 0, 0, 0.16)' },
  compactSuggestions: { maxHeight: 134 },
  suggestion: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 6 },
  suggestionText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  search: { flex: 1, minWidth: 0, paddingRight: 4, gap: 2 },
  searchAction: { minHeight: 44, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8 },
  searchButton: { color: colors.link, fontSize: 13, fontWeight: '700' }, clear: { fontSize: 24, color: colors.muted, lineHeight: 26 },
  notice: { padding: 10, borderRadius: 12, backgroundColor: colors.warning, flexDirection: 'row', alignItems: 'center', gap: 10 },
  noticeText: { flex: 1, color: colors.warningText, fontSize: 12, lineHeight: 17 },
  mapFrame: { flex: 1, minHeight: 220, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, position: 'relative', backgroundColor: colors.input },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  loadingText: { fontSize: 14, lineHeight: 20, color: colors.muted, textAlign: 'center' },
  errorTitle: { fontSize: 18, fontWeight: '700', color: colors.text, textAlign: 'center' },
  retryButton: { backgroundColor: colors.primary, minHeight: 44, justifyContent: 'center', paddingHorizontal: 18, borderRadius: 12 },
  retryButtonText: { color: colors.onPrimary, fontWeight: '700' }, retryText: { color: colors.link, fontWeight: '700', fontSize: 13 },
  mapControls: { position: 'absolute', top: 10, left: MAP_ZOOM_CLEARANCE, right: 10, flexDirection: 'row', gap: 4 },
  mapControl: { width: 90, backgroundColor: colors.surface, borderRadius: 9, minHeight: 44, paddingHorizontal: 6, paddingVertical: 4,
    justifyContent: 'center', borderWidth: 1, borderColor: colors.border, elevation: 3 },
  compactMapControl: { width: 64, paddingHorizontal: 3 },
  mapControlText: { color: colors.text, fontSize: 12, fontWeight: '700', textAlign: 'center' },
  empty: { position: 'absolute', left: 16, right: 16, bottom: 28, padding: 16, borderRadius: 16,
    backgroundColor: colors.surface, alignItems: 'center' },
  emptyTitle: { fontWeight: '700', color: colors.text, fontSize: 16 }, emptyText: { color: colors.muted, textAlign: 'center', fontSize: 13, marginTop: 5 },
  emptyAction: { minHeight: 44, justifyContent: 'center' },
  card: { position: 'absolute', bottom: STORE_CARD_INSET, left: STORE_CARD_INSET, width: STORE_CARD_WIDTH, maxWidth: '90%',
    minHeight: STORE_CARD_MIN_HEIGHT, padding: 10, gap: 5, justifyContent: 'space-between',
    borderRadius: 14, backgroundColor: colors.surface, elevation: 5,
    shadowColor: colors.shadow, shadowOpacity: 0.15, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } },
  cardHeading: { flexDirection: 'row', gap: 7, alignItems: 'center' },
  brandBadge: { width: 36, height: 34, borderRadius: 9, backgroundColor: '#FFFFFF',
    borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  brandLogo: { width: 30, height: 26 }, cardTitleArea: { flex: 1, minWidth: 0 },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: '800' }, distance: { color: colors.muted, fontSize: 11, marginTop: 2 },
  closeCard: { width: 32, height: 34, alignItems: 'center', justifyContent: 'center' },
  address: { color: colors.text, fontSize: 13, lineHeight: 17 },
  navigate: { minHeight: 40, paddingVertical: 6, borderRadius: 9, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center' },
  navigateText: { color: colors.onPrimary, fontWeight: '700', fontSize: 13 },
  navigationError: { fontSize: 12, color: colors.danger },
});
