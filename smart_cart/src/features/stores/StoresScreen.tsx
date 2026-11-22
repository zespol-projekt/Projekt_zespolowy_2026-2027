import { useTheme } from '@/features/theme/ThemeProvider';
import type { ThemeColors } from '@/features/theme/palette';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import StoreMap from './StoreMap';
import type { MapFocus } from './StoreMap.types';
import { BRANDS, CHAINS, directionsUrl, distanceMeters, filterStores, POLAND, POLAND_BOUNDS, type Chain } from './model';
import { useMyLocation } from './useMyLocation';
import { useStores } from './useStores';

export default function StoresScreen() {
  const { colors, dark } = useTheme();
  const styles = createStyles(colors);
  const compact = useWindowDimensions().height < 720;
  const { catalog, loading, error, retry } = useStores();
  const { location, requesting, message, locate, dismissMessage } = useMyLocation();
  const [chains, setChains] = useState<Chain[]>([...CHAINS]);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const [navigating, setNavigating] = useState(false);
  const filtered = useMemo(() => filterStores(catalog?.stores ?? [], chains, query), [catalog, chains, query]);
  const selected = useMemo(() => filtered.find(s => s.id === selectedId) ?? null, [filtered, selectedId]);
  const counts = useMemo(() => Object.fromEntries(CHAINS.map(chain => [chain,
    catalog?.stores.filter(s => s.chain === chain).length ?? 0])), [catalog]);
  // Remove the previous selection when filters or the session remove that store.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!selected) { setSelectedId(null); setNavigationError(null); } }, [selected]);

  const toggleChain = (chain: Chain) => setChains(current => current.includes(chain) ? current.filter(c => c !== chain) : [...current, chain]);
  const showResults = () => {
    if (!filtered.length) return;
    if (filtered.length === 1) {
      setFocus(old => ({ point: filtered[0], zoom: 15, request: (old?.request ?? 0) + 1 }));
      return;
    }
    const bounds = { north: -90, south: 90, east: -180, west: 180 };
    for (const s of filtered) {
      bounds.north = Math.max(bounds.north, s.latitude); bounds.south = Math.min(bounds.south, s.latitude);
      bounds.east = Math.max(bounds.east, s.longitude); bounds.west = Math.min(bounds.west, s.longitude);
    }
    setFocus(old => ({ point: { latitude: (bounds.north + bounds.south) / 2, longitude: (bounds.east + bounds.west) / 2 },
      bounds, request: (old?.request ?? 0) + 1 }));
  };
  const showMyLocation = async () => {
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

  return <View style={[styles.screen, compact && styles.compactScreen]}>
    <View style={styles.heading}>
      <View style={styles.headingText}>
        <Text style={[styles.title, compact && styles.compactTitle]} accessibilityRole="header">Sklepy na mapie</Text>
        <Text style={styles.subtitle} accessibilityLiveRegion="polite">
          {catalog ? `${filtered.length.toLocaleString('pl-PL')} sklepów · Polska` : 'Znajdź sklep po drodze'}
        </Text>
      </View>
      <Pressable style={[styles.locationButton, requesting && styles.disabled]} onPress={showMyLocation}
        accessibilityRole="button" accessibilityLabel="Moja lokalizacja" accessibilityState={{ disabled: requesting, busy: requesting }} disabled={requesting}>
        {requesting ? <ActivityIndicator size="small" color={colors.surface} /> : <Text style={styles.locationIcon}>◎</Text>}
        <Text style={styles.locationText}>{requesting ? 'Ustalanie…' : 'Moja lokalizacja'}</Text>
      </Pressable>
    </View>

    <View style={styles.filters} accessibilityLabel="Filtry sieci sklepów">
      {CHAINS.map(chain => {
        const active = chains.includes(chain), brand = BRANDS[chain];
        return <Pressable key={chain} onPress={() => toggleChain(chain)} accessibilityRole="checkbox"
          accessibilityLabel={`${brand.name}, ${counts[chain]} sklepów`} accessibilityState={{ checked: active }} aria-checked={active}
          style={[styles.filter, active && { borderColor: brand.color, backgroundColor: `${brand.color}12` }]}>
          <View style={[styles.filterDot, { backgroundColor: active ? brand.color : '#B0B8B1' }]} />
          <Text style={[styles.filterText, active && { color: dark ? colors.text : brand.color }]} numberOfLines={1}>{brand.name}</Text>
        </Pressable>;
      })}
    </View>

    <View style={styles.search}>
      <TextInput style={styles.searchInput} placeholder="Miasto lub adres sklepu" placeholderTextColor={colors.muted}
        accessibilityLabel="Miasto lub adres sklepu" value={query} onChangeText={setQuery} onSubmitEditing={showResults}
        autoCorrect={false} returnKeyType="search" underlineColorAndroid="transparent" />
      {!!query && <Pressable style={styles.searchAction} onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Wyczyść wyszukiwanie">
        <Text style={styles.clear}>×</Text>
      </Pressable>}
      <Pressable style={styles.searchAction} onPress={showResults} accessibilityRole="button" accessibilityLabel="Pokaż wyniki na mapie"
        disabled={!filtered.length} accessibilityState={{ disabled: !filtered.length }}>
        <Text style={styles.searchButton}>Szukaj</Text>
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
      {catalog && <View style={styles.mapControls}>
        <Pressable style={styles.mapControl} onPress={() => setFocus(old => ({ point: POLAND, bounds: POLAND_BOUNDS, request: (old?.request ?? 0) + 1 }))}
          accessibilityRole="button" accessibilityLabel="Pokaż całą Polskę"><Text style={styles.mapControlText}>Cała Polska</Text></Pressable>
      </View>}

      {catalog && !filtered.length && <View style={styles.empty}>
        <Text style={styles.emptyTitle}>{chains.length ? 'Nie znaleźliśmy sklepów' : 'Wybierz sieć sklepów'}</Text>
        <Text style={styles.emptyText}>{chains.length ? 'Spróbuj wpisać inną miejscowość lub ulicę.' : 'Włącz co najmniej jeden filtr nad mapą.'}</Text>
        <Pressable onPress={() => { setQuery(''); setChains([...CHAINS]); }} accessibilityRole="button" style={styles.emptyAction}>
          <Text style={styles.retryText}>Pokaż wszystkie sklepy</Text>
        </Pressable>
      </View>}

      {selected && <View style={styles.card} testID="store-card">
        <View style={styles.cardHeading}>
          <View style={[styles.brandBadge, { backgroundColor: BRANDS[selected.chain].color }]}><Text style={styles.brandLetter}>{BRANDS[selected.chain].letter}</Text></View>
          <View style={styles.cardTitleArea}><Text style={styles.cardTitle} accessibilityRole="header">{selected.name}</Text>
            {distance !== null && <Text style={styles.distance}>{distance < 1000 ? `${Math.round(distance / 10) * 10} m` : `${(distance / 1000).toFixed(1)} km`} w linii prostej</Text>}
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
    </View>
  </View>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  compactScreen: { gap: 6, paddingTop: 8 }, compactTitle: { fontSize: 19 },
  screen: { flex: 1, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4, gap: 10 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  headingText: { flex: 1, minWidth: 0 }, title: { fontSize: 23, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: 12, color: colors.muted, marginTop: 3 },
  locationButton: { minHeight: 42, borderRadius: 14, backgroundColor: colors.primary, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 5 },
  locationIcon: { color: colors.onPrimary, fontSize: 22 }, locationText: { color: colors.onPrimary, fontSize: 11, fontWeight: '700' },
  disabled: { opacity: 0.6 }, filters: { flexDirection: 'row', gap: 6 },
  filter: { flexGrow: 1, minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 6,
    borderWidth: 1, borderColor: colors.border, borderRadius: 13, backgroundColor: colors.surface },
  filterDot: { width: 7, height: 7, borderRadius: 4 }, filterText: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  search: { minHeight: 44, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 14, backgroundColor: colors.surface, paddingLeft: 12 },
  searchInput: { flex: 1, minWidth: 0, fontSize: 14, color: colors.text, paddingVertical: 10 },
  searchAction: { minHeight: 44, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 12 },
  searchButton: { color: colors.link, fontSize: 13, fontWeight: '700' }, clear: { fontSize: 24, color: colors.muted, lineHeight: 26 },
  notice: { padding: 10, borderRadius: 12, backgroundColor: colors.warning, flexDirection: 'row', alignItems: 'center', gap: 10 },
  noticeText: { flex: 1, color: colors.warningText, fontSize: 12, lineHeight: 17 },
  mapFrame: { flex: 1, minHeight: 220, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, position: 'relative', backgroundColor: colors.input },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  loadingText: { fontSize: 14, lineHeight: 20, color: colors.muted, textAlign: 'center' },
  errorTitle: { fontSize: 18, fontWeight: '700', color: colors.text, textAlign: 'center' },
  retryButton: { backgroundColor: colors.primary, minHeight: 44, justifyContent: 'center', paddingHorizontal: 18, borderRadius: 12 },
  retryButtonText: { color: colors.onPrimary, fontWeight: '700' }, retryText: { color: colors.link, fontWeight: '700', fontSize: 13 },
  mapControls: { position: 'absolute', top: 12, right: 12, gap: 8 },
  mapControl: { backgroundColor: colors.surface, borderRadius: 11, minHeight: 40, paddingHorizontal: 12,
    justifyContent: 'center', borderWidth: 1, borderColor: colors.border, elevation: 3 },
  mapControlText: { color: colors.text, fontSize: 12, fontWeight: '700' },
  empty: { position: 'absolute', left: 16, right: 16, bottom: 28, padding: 16, borderRadius: 16, backgroundColor: colors.surface, alignItems: 'center' },
  emptyTitle: { fontWeight: '700', color: colors.text, fontSize: 16 }, emptyText: { color: colors.muted, textAlign: 'center', fontSize: 13, marginTop: 5 },
  emptyAction: { minHeight: 44, justifyContent: 'center' },
  card: { position: 'absolute', bottom: 25, left: 10, right: 10, padding: 14, borderRadius: 18, backgroundColor: colors.surface, elevation: 5,
    shadowColor: colors.shadow, shadowOpacity: 0.15, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } },
  cardHeading: { flexDirection: 'row', gap: 10, alignItems: 'center' }, brandBadge: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  brandLetter: { color: colors.onPrimary, fontWeight: '800', fontSize: 18 }, cardTitleArea: { flex: 1 },
  cardTitle: { color: colors.text, fontSize: 18, fontWeight: '800' }, distance: { color: colors.muted, fontSize: 11, marginTop: 2 },
  closeCard: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }, address: { color: colors.text, fontSize: 13, lineHeight: 18, marginTop: 9, marginBottom: 12 },
  navigate: { minHeight: 42, borderRadius: 12, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center' },
  navigateText: { color: colors.onPrimary, fontWeight: '700', fontSize: 14 }, navigationError: { fontSize: 12, color: colors.danger, marginTop: 7 },
});
