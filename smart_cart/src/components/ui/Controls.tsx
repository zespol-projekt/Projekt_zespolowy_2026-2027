import type { PropsWithChildren } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

export function Screen({ title, children }: PropsWithChildren<{ title: string }>) {
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={ui.screen}>
    <Text accessibilityRole="header" style={ui.title}>{title}</Text>{children}
  </ScrollView>;
}
export function Button({ title, onPress, disabled = false, busy = false, secondary = false }: {
  title: string; onPress: () => void; disabled?: boolean; busy?: boolean; secondary?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} disabled={disabled || busy}
    accessibilityState={{ disabled: disabled || busy, busy }} onPress={onPress}
    style={[ui.button, secondary && ui.secondary, (disabled || busy) && ui.disabled]}>
    {busy && <ActivityIndicator color={secondary ? '#087F5D' : '#FFFFFF'} />}
    <Text style={[ui.buttonText, secondary && ui.secondaryText]}>{title}</Text>
  </Pressable>;
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return <View style={ui.field}><Text style={ui.label}>{label}</Text>
    <TextInput accessibilityLabel={label} placeholderTextColor="#767E78" style={ui.input} {...props} />
  </View>;
}
export function Notice({ children }: PropsWithChildren) {
  return <Text accessibilityLiveRegion="polite" style={ui.notice}>{children}</Text>;
}
export const ui = StyleSheet.create({
  screen: { padding: 18, gap: 14, paddingBottom: 32, flexGrow: 1 },
  title: { color: '#152D43', fontSize: 25, fontWeight: '800' },
  heading: { color: '#152D43', fontSize: 18, fontWeight: '700' },
  text: { color: '#304B43', fontSize: 14, lineHeight: 21 },
  muted: { color: '#66726B', fontSize: 12, lineHeight: 18 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#DDE3DA', padding: 15, gap: 10 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  field: { gap: 6, flexGrow: 1 }, label: { color: '#304B43', fontSize: 13, fontWeight: '600' },
  input: { backgroundColor: '#FFFFFF', color: '#152D43', borderWidth: 1, borderColor: '#CAD5CD', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, minHeight: 46 },
  button: { minHeight: 44, backgroundColor: '#07966D', borderRadius: 12, paddingHorizontal: 15, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  buttonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  secondary: { backgroundColor: '#E6F1E9', borderWidth: 1, borderColor: '#C6DACC' }, secondaryText: { color: '#087F5D' },
  disabled: { opacity: 0.5 }, notice: { color: '#715018', backgroundColor: '#FFF2D5', padding: 12, borderRadius: 12, fontSize: 13, lineHeight: 20 },
});
