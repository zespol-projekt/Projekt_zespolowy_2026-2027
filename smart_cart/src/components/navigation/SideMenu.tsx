import { router, type Href } from 'expo-router';
import Constants from 'expo-constants';
import { SymbolView } from 'expo-symbols';
import { useRef } from 'react';
import { Image, Keyboard, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Button, Notice, useUI } from '@/components/ui/Controls';
import { useAuth } from '@/features/auth';
import { useTheme } from '@/features/theme/ThemeProvider';

const themes = [
  { value: 'light', label: 'Jasny', icon: { ios: 'sun.max', android: 'light_mode', web: 'light_mode' } },
  { value: 'dark', label: 'Ciemny', icon: { ios: 'moon', android: 'dark_mode', web: 'dark_mode' } },
  { value: 'system', label: 'Systemowy', icon: { ios: 'circle.lefthalf.filled', android: 'contrast', web: 'contrast' } },
] as const;

export default function SideMenu({ visible, onClose }: { visible: boolean; onClose(): void }) {
  const { colors, preference, setPreference, error, ready } = useTheme();
  const ui = useUI();
  const auth = useAuth();
  const panel = useRef<React.ComponentRef<typeof SafeAreaView>>(null);
  function navigate(href: Href) { onClose(); router.navigate(href); }
  return <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}
    onShow={() => { Keyboard.dismiss(); if (Platform.OS === 'web') panel.current?.focus(); }}>
    <SafeAreaProvider style={[styles.overlay, { backgroundColor: colors.overlay }]}>
      <SafeAreaView ref={panel} edges={['top', 'bottom']} tabIndex={-1}
        accessibilityViewIsModal accessibilityLabel="Menu SMARTCART"
        style={[styles.panel, { backgroundColor: colors.surface }]}>
        <ScrollView style={styles.middle} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.middleContent}>
          <View style={[styles.spacer, styles.logoArea]}>
            <Image source={require('@/assets/images/menu-wordmark.png')} accessibilityLabel="SmartCart" accessible
              resizeMode="contain" style={styles.logo} />
          </View>
          <View style={styles.actions}>
            <Text accessibilityRole="header" style={ui.heading}>Motyw</Text>
            <View style={styles.themeRow}>
              {themes.map(({ value, label, icon }) => {
                const checked = preference === value;
                return <Pressable key={value} accessibilityRole="radio" aria-checked={checked} accessibilityLabel={label}
                  accessibilityState={{ checked, disabled: !ready }} disabled={!ready} onPress={() => setPreference(value)}
                  style={[ui.button, !checked && ui.secondary, styles.themeButton, !ready && ui.disabled]}>
                  <SymbolView name={icon} size={22} tintColor={checked ? colors.onPrimary : colors.link} />
                </Pressable>;
              })}
            </View>
            {error && <Notice>{error}</Notice>}
            <Button secondary title="Mój profil" onPress={() => navigate('/profile')} />
            <Button secondary title="Pomoc" onPress={() => navigate('/help')} />
            <Button secondary title="Zasady porównywania" onPress={() => navigate('/rules')} />
          </View>
          <View style={styles.spacer} />
        </ScrollView>
        <View style={styles.logout}>
          <Button title="Wyloguj się" onPress={() => { onClose(); void auth.signOut(); }} />
        </View>
        <Text style={[ui.muted, styles.version]}>SMARTCART · wersja {Constants.expoConfig?.version ?? 'nieznana'}</Text>
      </SafeAreaView>
      <Pressable accessibilityRole="button" accessibilityLabel="Zamknij menu przez tło" onPress={onClose} style={{ flex: 1 }} />
    </SafeAreaProvider>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flexDirection: 'row' },
  panel: { width: '60%', maxWidth: 252, paddingHorizontal: 12 },
  logoArea: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  logo: { width: 144, maxWidth: '100%', height: 28 },
  spacer: { flex: 1 },
  middle: { flex: 1, minHeight: 0 },
  middleContent: { flexGrow: 1 },
  actions: { gap: 10 },
  themeRow: { flexDirection: 'row', gap: 6 },
  themeButton: { flex: 1, minWidth: 0, paddingHorizontal: 0, paddingVertical: 0 },
  logout: { paddingTop: 8, marginBottom: 32 },
  version: { fontSize: 10, lineHeight: 15 },
});
