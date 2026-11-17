import { router, type Href } from 'expo-router';
import Constants from 'expo-constants';
import { useRef } from 'react';
import { Keyboard, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Notice, useUI } from '@/components/ui/Controls';
import { useAuth } from '@/features/auth';
import { useTheme } from '@/features/theme/ThemeProvider';

export default function SideMenu({ visible, onClose }: { visible: boolean; onClose(): void }) {
  const { colors, preference, setPreference, error, ready } = useTheme();
  const ui = useUI();
  const auth = useAuth();
  const insets = useSafeAreaInsets();
  const close = useRef<React.ComponentRef<typeof View>>(null);
  function navigate(href: Href) { onClose(); router.navigate(href); }
  return <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}
    onShow={() => { Keyboard.dismiss(); if (Platform.OS === 'web') close.current?.focus(); }}>
    <View style={{ flex: 1, backgroundColor: colors.overlay, flexDirection: 'row' }}>
      <View accessibilityViewIsModal accessibilityLabel="Menu SMARTCART"
        style={{ width: '86%', maxWidth: 360, backgroundColor: colors.surface, paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 16, flexGrow: 1 }}>
          <View style={{ ...ui.row, justifyContent: 'space-between' }}>
            <Text style={ui.title}>Menu</Text>
            <Pressable ref={close} accessibilityRole="button" accessibilityLabel="Zamknij menu" onPress={onClose}
              style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}><Text style={ui.heading}>×</Text></Pressable>
          </View>
          <Text style={ui.heading}>Motyw</Text>
          <View style={ui.row}>
            {([['light', 'Jasny'], ['dark', 'Ciemny'], ['system', 'Systemowy']] as const).map(([value, label]) =>
              <Pressable key={value} accessibilityRole="radio" aria-checked={preference === value} accessibilityLabel={label} accessibilityState={{ checked: preference === value, disabled: !ready }}
                disabled={!ready} onPress={() => setPreference(value)} style={[ui.button, preference !== value && ui.secondary]}>
                <Text style={[ui.buttonText, preference !== value && ui.secondaryText]}>{label}</Text>
              </Pressable>)}
          </View>
          {error && <Notice>{error}</Notice>}
          <Button secondary title="Profil" onPress={() => navigate('/profile')} />
          <Button secondary title="Pomoc" onPress={() => navigate('/help')} />
          <Button secondary title="Zasady porównywania" onPress={() => navigate('/rules')} />
          <Button title="Wyloguj się" onPress={() => { onClose(); void auth.signOut(); }} />
          <View style={{ flex: 1 }} />
          <Text style={ui.muted}>SMARTCART · wersja {Constants.expoConfig?.version ?? 'nieznana'}</Text>
        </ScrollView>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Zamknij menu przez tło" onPress={onClose} style={{ flex: 1 }} />
    </View>
  </Modal>;
}
