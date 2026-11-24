import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Modal, PanResponder, Platform, Pressable, ScrollView, Text, View, type PanResponderGestureState } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/features/theme/ThemeProvider';
import { Button, Notice, useUI } from '@/components/ui/Controls';
import { useSessionKey, useSessionQuery } from '@/features/catalog/hooks';
import { loadLeaflets } from './api';
import { displayValidity, pageIndex, validLeafletId, type LeafletImage } from './model';
import { useLeafletImage } from './useLeafletImage';

export default function ReaderScreen() {
  const params = useLocalSearchParams<{ id: string; page?: string; chain?: string }>();
  const key = useSessionKey();
  return key ? <Reader key={`${key}:${params.id}`} id={params.id} page={params.page} chain={params.chain} /> : null;
}
function Reader({ id, page, chain }: { id: string; page?: string; chain?: string }) {
  const ui = useUI();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const closeButton = useRef<React.ComponentRef<typeof View>>(null);
  const moved = useRef(false);
  const focused = useIsFocused();
  const query = useSessionQuery(loadLeaflets, []);
  const [zoom, setZoom] = useState(1);
  const [frame, setFrame] = useState({ width: 320, height: 480 });
  const [controls, setControls] = useState(false);
  const leaflet = query.data?.leaflets.find(item => item.id === id);
  const index = pageIndex(page, leaflet?.pages.length ?? 1);
  const turnPage = useCallback((direction: number) => {
    if (!leaflet) return;
    const target = index + direction;
    if (target < 0 || target >= leaflet.pages.length) return;
    setZoom(1);
    router.setParams({ page: String(target + 1) });
  }, [index, leaflet]);
  useEffect(() => {
    if (Platform.OS !== 'web' || !focused) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        turnPage(event.key === 'ArrowRight' ? 1 : -1);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [focused, turnPage]);
  const canSwipe = zoom === 1 && focused && !!leaflet && !query.loading && !query.error;
  const startSwipe = useCallback(() => { moved.current = false; return false; }, []);
  const captureSwipe = useCallback((gesture: PanResponderGestureState) => {
    if (Math.abs(gesture.dx) > 10 || Math.abs(gesture.dy) > 10) moved.current = true;
    return canSwipe && gesture.numberActiveTouches === 1
      && Math.abs(gesture.dx) > 16 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5;
  }, [canSwipe]);
  // create only registers callbacks; the ref is changed by gesture events, never during render.
  // eslint-disable-next-line react-hooks/refs
  const swipe = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponderCapture: startSwipe,
    onMoveShouldSetPanResponderCapture: (_, gesture) => captureSwipe(gesture),
    onPanResponderRelease: (_, gesture) => {
      if (canSwipe && Math.abs(gesture.dx) >= 60 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5) {
        turnPage(gesture.dx < 0 ? 1 : -1);
      }
    },
  }), [canSwipe, turnPage, startSwipe, captureSwipe]);
  const returnChain = typeof chain === 'string' && validLeafletId(chain) && (!leaflet || leaflet.chain.id === chain) ? chain : undefined;
  // Pop the reader instead of replacing it with a duplicate list in the stack.
  // Direct links still fall back to the list when it is not present in history.
  const close = () => router.dismissTo(returnChain ? { pathname: '/leaflets', params: { chain: returnChain } } : '/leaflets');
  return <Modal visible={focused} presentationStyle="fullScreen" animationType="none" onRequestClose={close}
    onShow={() => { if (Platform.OS === 'web') closeButton.current?.focus(); }}>
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: insets.bottom,
      paddingLeft: insets.left, paddingRight: insets.right }}>
      <Pressable ref={closeButton} accessibilityRole="button" accessibilityLabel="Zamknij gazetkę"
        onPress={close} style={{ position: 'absolute', top: insets.top + 10, right: insets.right + 12, zIndex: 2,
          width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1,
          borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: colors.text, fontSize: 30, lineHeight: 34 }} accessible={false}>×</Text>
      </Pressable>
      <View testID="leaflet-page-viewport" style={{ flex: 1, marginTop: 62, marginHorizontal: 12, marginBottom: 12 }}
        onLayout={event => setFrame({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}
        {...swipe.panHandlers}>
      <Pressable accessibilityRole="button"
        accessibilityLabel={controls ? 'Ukryj sterowanie gazetką' : 'Pokaż sterowanie gazetką'}
        accessibilityHint="Dotknij, aby pokazać zmianę stron i powiększanie. Przesuń w lewo lub prawo, aby zmienić stronę."
        onPress={() => { if (moved.current) { moved.current = false; return; } setControls(value => !value); }}
        style={{ flex: 1 }}>
        {!validLeafletId(id) ? <Notice>Nieprawidłowy identyfikator gazetki.</Notice> : <>
          {query.loading && <ActivityIndicator accessibilityLabel="Wczytywanie gazetki" />}
          {query.error && <View style={{ gap: 10 }}><Notice>{query.error}</Notice>
            <Button title="Odśwież dostęp do gazetki" onPress={query.reload} /></View>}
          {!query.loading && !query.error && !leaflet && <Notice>Ta gazetka nie jest już dostępna.</Notice>}
          {focused && leaflet && <PageImage key={index} page={leaflet.pages[index]} width={frame.width} height={frame.height}
            zoom={zoom} number={index + 1} catalogReady={!query.loading && !query.error} refreshCatalog={query.reload} />}
        </>}
      </Pressable>
      </View>
      {leaflet && <Text testID="leaflet-page-counter" accessibilityLiveRegion="polite"
        accessibilityLabel={`Strona ${index + 1} z ${leaflet.pages.length}`}
        style={{ alignSelf: 'center', color: colors.text, backgroundColor: colors.surface, fontSize: 14,
          fontWeight: '700', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, marginBottom: 12 }}>
        {index + 1}/{leaflet.pages.length}
      </Text>}
      {controls && <ScrollView style={{ position: 'absolute', bottom: insets.bottom + 60, left: insets.left + 12,
        right: insets.right + 12, maxHeight: '45%', backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1,
        borderColor: colors.border }} contentContainerStyle={{ padding: 14, gap: 10 }}>
        {leaflet && <>
          <Text accessibilityRole="header" style={ui.heading}>{leaflet.chain.name} · {leaflet.title}</Text>
          <Text style={ui.muted}>{displayValidity(leaflet)}</Text>
          <Text accessibilityLiveRegion="polite" style={ui.text}>Strona {index + 1} z {leaflet.pages.length} · {Math.round(zoom * 100)}%</Text>
          <View style={ui.row}>
            <Button secondary title="Poprzednia strona" disabled={index === 0} onPress={() => turnPage(-1)} />
            <Button title="Następna strona" disabled={index === leaflet.pages.length - 1} onPress={() => turnPage(1)} />
            <Button secondary title="Powiększ" disabled={zoom >= 3} onPress={() => setZoom(Math.min(3, zoom + 0.5))} />
            <Button secondary title="Pomniejsz" disabled={zoom <= 1} onPress={() => setZoom(Math.max(1, zoom - 0.5))} />
          </View>
        </>}
        <Button secondary title="Odśwież dostęp do gazetki" disabled={query.loading} onPress={query.reload} />
      </ScrollView>}
    </View>
  </Modal>;
}
function PageImage({ page, width, height, zoom, number, catalogReady, refreshCatalog }: {
  page: LeafletImage; width: number; height: number; zoom: number; number: number; catalogReady: boolean; refreshCatalog: () => void;
}) {
  const { current, reportError, retry } = useLeafletImage(page, catalogReady, refreshCatalog);
  const imageWidth = Math.max(1, Math.min(width, height * page.width / page.height)) * zoom;
  if (!catalogReady) return null;
  return <View style={{ flex: 1, minHeight: 100 }}>
    {!current && <ActivityIndicator accessibilityLabel="Wczytywanie strony" />}
    {current?.error && <><Notice>{current.error}</Notice><Button title={current.expired ? 'Odśwież dostęp do gazetki' : 'Ponów pobranie strony'}
      onPress={current.expired ? refreshCatalog : retry} /></>}
    {current?.uri && <ScrollView key={current.uri} nestedScrollEnabled style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}>
      <ScrollView horizontal scrollEnabled={zoom > 1} nestedScrollEnabled contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center' }}>
        <Image accessibilityLabel={`Strona ${number} gazetki`} accessible draggable={false} source={{ uri: current.uri }} contentFit="contain" cachePolicy="none"
          style={{ width: imageWidth, height: imageWidth * page.height / page.width, backgroundColor: '#FFFFFF' }}
          onError={reportError} />
      </ScrollView>
    </ScrollView>}
  </View>;
}
