import { Gesture, GestureDetector, GestureHandlerRootView, LegacyScrollView, type LegacyPinchGesture } from 'react-native-gesture-handler';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Modal, PanResponder, Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/features/theme/ThemeProvider';
import { Button, Notice } from '@/components/ui/Controls';
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
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const closeButton = useRef<React.ComponentRef<typeof View>>(null);
  const focused = useIsFocused();
  const query = useSessionQuery(loadLeaflets, []);
  const [zoom, setZoom] = useState(1);
  const currentZoom = useRef(1);
  const pinchStartZoom = useRef(1);
  const didPinch = useRef(false);
  const pinchHandler = useRef<LegacyPinchGesture | undefined>(undefined);
  useEffect(() => { currentZoom.current = zoom; }, [zoom]);
  const [frame, setFrame] = useState({ width: 320, height: 480 });
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
  const canGesture = focused && !!leaflet && !query.loading && !query.error;
  const canSwipe = zoom === 1 && canGesture;
  const pinch = useMemo(() => Gesture.Pinch().withRef(pinchHandler).enabled(canGesture).runOnJS(true)
    .onStart(() => {
      didPinch.current = true;
      pinchStartZoom.current = currentZoom.current;
    })
    .onUpdate(event => setZoom(Math.max(1, Math.min(3, pinchStartZoom.current * event.scale)))), [canGesture]);
  const gestures = useMemo(() => {
    const swipe = Gesture.Pan().enabled(canSwipe).maxPointers(1).activeOffsetX([-16, 16])
      .failOffsetY([-16, 16]).runOnJS(true)
      .onBegin(() => { didPinch.current = false; })
      .onEnd(({ translationX, translationY }, success) => {
        if (success && !didPinch.current && currentZoom.current === 1
          && Math.abs(translationX) >= 60 && Math.abs(translationX) > Math.abs(translationY) * 1.5) {
          turnPage(translationX < 0 ? 1 : -1);
        }
      });
    return Gesture.Simultaneous(pinch, swipe);
  }, [canSwipe, pinch, turnPage]);
  const webSwipe = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponderCapture: (event, { dx, dy }) =>
      canSwipe && event.nativeEvent.touches.length <= 1 && Math.abs(dx) > 16 && Math.abs(dx) > Math.abs(dy) * 1.5,
    onPanResponderGrant: () => { didPinch.current = false; },
    onPanResponderRelease: (_, { dx, dy }) => {
      if (canSwipe && !didPinch.current && Math.abs(dx) >= 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        turnPage(dx < 0 ? 1 : -1);
      }
    },
  }), [canSwipe, turnPage]);
  const returnChain = typeof chain === 'string' && validLeafletId(chain) && (!leaflet || leaflet.chain.id === chain) ? chain : undefined;
  // Pop the reader instead of replacing it with a duplicate list in the stack.
  // Direct links still fall back to the list when it is not present in history.
  const close = () => router.dismissTo(returnChain ? { pathname: '/leaflets', params: { chain: returnChain } } : '/');
  return <Modal visible={focused} presentationStyle="fullScreen" animationType="none" onRequestClose={close}
    onShow={() => { if (Platform.OS === 'web') closeButton.current?.focus(); }}>
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: insets.bottom,
      paddingLeft: insets.left, paddingRight: insets.right }}>
      <Pressable ref={closeButton} accessibilityRole="button" accessibilityLabel="Zamknij gazetkę"
        onPress={close} style={{ position: 'absolute', top: insets.top + (leaflet ? 28 : 10), right: insets.right + 12, zIndex: 2,
          width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1,
          borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}>
        <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }}
          size={24} tintColor={colors.text} accessible={false} />
      </Pressable>
      {leaflet && <View style={{ position: 'absolute', top: insets.top + 28, left: insets.left + 12,
        zIndex: 2, flexDirection: 'row', gap: 8 }}>
        {([1, -1] as const).map(direction => {
          const disabled = direction > 0 ? zoom >= 3 : zoom <= 1;
          return <Pressable key={direction} accessibilityRole="button"
            accessibilityLabel={direction > 0 ? 'Powiększ' : 'Pomniejsz'}
            accessibilityState={{ disabled }} disabled={disabled}
            onPress={() => setZoom(value => Math.max(1, Math.min(3, value + direction * 0.5)))}
            style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface,
              borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
              opacity: disabled ? 0.5 : 1 }}>
            <SymbolView name={direction > 0
              ? { ios: 'plus', android: 'add', web: 'add' }
              : { ios: 'minus', android: 'remove', web: 'remove' }}
              size={24} tintColor={colors.text} accessible={false} />
          </Pressable>;
        })}
      </View>}
      {leaflet && <View pointerEvents="none" style={{ alignItems: 'center', paddingHorizontal: 12 }}>
        <Text numberOfLines={1} style={{ color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: '700' }}>
          {displayValidity(leaflet)}
        </Text>
      </View>}
      <GestureDetector gesture={Platform.OS === 'web' ? pinch : gestures}
        // CSS accepts both axes together, though the detector's type lists only individual keywords.
        touchAction={(canSwipe ? 'none' : 'pan-x pan-y') as React.ComponentProps<typeof GestureDetector>['touchAction']}>
      <View testID="leaflet-page-viewport" style={{ flex: 1 }}
        onLayout={event => setFrame({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}
        {...(Platform.OS === 'web' ? webSwipe.panHandlers : {})}>
        {!validLeafletId(id) ? <Notice>Nieprawidłowy identyfikator gazetki.</Notice> : <>
          {query.loading && <ActivityIndicator accessibilityLabel="Wczytywanie gazetki" />}
          {query.error && <View style={{ gap: 10 }}><Notice>{query.error}</Notice>
            <Button title="Odśwież dostęp do gazetki" onPress={query.reload} /></View>}
          {!query.loading && !query.error && !leaflet && <Notice>Ta gazetka nie jest już dostępna.</Notice>}
          {focused && leaflet && <PageImage key={index} page={leaflet.pages[index]} width={frame.width} height={frame.height}
            zoom={zoom} number={index + 1} catalogReady={!query.loading && !query.error} refreshCatalog={query.reload}
            pinchHandler={pinchHandler} />}
        </>}
      </View>
      </GestureDetector>
      {leaflet && <View pointerEvents="none" style={{ alignItems: 'center' }}>
        <Text testID="leaflet-page-counter" accessibilityLiveRegion="polite"
          accessibilityLabel={`Strona ${index + 1} z ${leaflet.pages.length}`}
          style={{ color: colors.text, fontSize: 14, lineHeight: 18, fontWeight: '700' }}>
          {index + 1}/{leaflet.pages.length}
        </Text>
      </View>}
      {leaflet && ([-1, 1] as const).map(direction => {
        const previous = direction < 0;
        const disabled = previous ? index === 0 : index === leaflet.pages.length - 1;
        return <Pressable key={direction} accessibilityRole="button"
          accessibilityLabel={previous ? 'Poprzednia strona' : 'Następna strona'}
          accessibilityState={{ disabled }} disabled={disabled} onPress={() => turnPage(direction)}
          style={{ position: 'absolute', top: '50%', transform: [{ translateY: -22 }], zIndex: 2,
            ...(previous ? { left: insets.left + 8 } : { right: insets.right + 8 }),
            width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1,
            borderColor: colors.border, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.5 : 1 }}>
          <SymbolView name={previous
            ? { ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }
            : { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
            size={24} tintColor={colors.text} accessible={false} />
        </Pressable>;
      })}
    </GestureHandlerRootView>
  </Modal>;
}
function PageImage({ page, width, height, zoom, number, catalogReady, refreshCatalog, pinchHandler }: {
  page: LeafletImage; width: number; height: number; zoom: number; number: number; catalogReady: boolean; refreshCatalog: () => void;
  pinchHandler: React.RefObject<LegacyPinchGesture | undefined>;
}) {
  const { current, reportError, retry } = useLeafletImage(page, catalogReady, refreshCatalog);
  const imageWidth = Math.max(1, Math.min(width, height * page.width / page.height)) * zoom;
  if (!catalogReady) return null;
  const image = current?.uri && <Image accessibilityLabel={`Strona ${number} gazetki`} accessible draggable={false}
    source={{ uri: current.uri }} contentFit="contain" cachePolicy="none"
    style={{ width: imageWidth, height: imageWidth * page.height / page.width, backgroundColor: '#FFFFFF' }}
    onError={reportError} />;
  return <View style={{ flex: 1, minHeight: 100 }}>
    {!current && <ActivityIndicator accessibilityLabel="Wczytywanie strony" />}
    {current?.error && <><Notice>{current.error}</Notice><Button title={current.expired ? 'Odśwież dostęp do gazetki' : 'Ponów pobranie strony'}
      onPress={current.expired ? refreshCatalog : retry} /></>}
    {image && (zoom === 1
      ? <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>{image}</View>
      : <LegacyScrollView key={current.uri} simultaneousHandlers={pinchHandler} nestedScrollEnabled style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}>
      <LegacyScrollView horizontal simultaneousHandlers={pinchHandler} nestedScrollEnabled contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center' }}>
        {image}
      </LegacyScrollView>
    </LegacyScrollView>)}
  </View>;
}
