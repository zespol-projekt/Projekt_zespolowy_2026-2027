import { useTheme } from '@/features/theme/ThemeProvider';
import type { ThemeColors } from '@/features/theme/palette';
import { useMemo, type PropsWithChildren, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

export function Screen({ title, children }: PropsWithChildren<{ title: string }>) {
  const ui = useUI();
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={ui.screen}>
    <Text accessibilityRole="header" style={ui.title}>{title}</Text>{children}
  </ScrollView>;
}
export function Button({ title, onPress, disabled = false, busy = false, secondary = false, icon }: {
  title: string; onPress?: () => void; disabled?: boolean; busy?: boolean; secondary?: boolean; icon?: ReactNode;
}) {
  const ui = useUI();
  const { colors } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={title} disabled={disabled || busy}
    accessibilityState={{ disabled: disabled || busy, busy }} onPress={onPress}
    style={[ui.button, secondary && ui.secondary, (disabled || busy) && ui.disabled]}>
    {busy ? <ActivityIndicator color={secondary ? colors.link : colors.onPrimary} /> : icon}
    <Text style={[ui.buttonText, secondary && ui.secondaryText]}>{title}</Text>
  </Pressable>;
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const ui = useUI();
  const { colors } = useTheme();
  return <View style={ui.field}><Text style={ui.label}>{label}</Text>
    <TextInput accessibilityLabel={label} placeholderTextColor={colors.muted} style={ui.input} {...props} />
  </View>;
}
export function Notice({ children }: PropsWithChildren) {
  const ui = useUI();
  return <Text accessibilityLiveRegion="polite" style={ui.notice}>{children}</Text>;
}
export function useUI() {
  const { colors } = useTheme();
  return useMemo(() => createStyles(colors), [colors]);
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  screen: { padding: 18, gap: 14, paddingBottom: 32, flexGrow: 1 },
  title: { color: colors.text, fontSize: 25, fontWeight: '800' },
  heading: { color: colors.text, fontSize: 18, fontWeight: '700' },
  text: { color: colors.text, fontSize: 14, lineHeight: 21 },
  muted: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  card: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 15, gap: 10 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  field: { gap: 6, flexGrow: 1 }, label: { color: colors.text, fontSize: 13, fontWeight: '600' },
  input: { backgroundColor: colors.surface, color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, minHeight: 46 },
  button: { minHeight: 44, backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 15, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  buttonText: { color: colors.onPrimary, fontWeight: '700', fontSize: 14 },
  secondary: { backgroundColor: colors.secondary, borderWidth: 1, borderColor: colors.border }, secondaryText: { color: colors.link },
  disabled: { opacity: 0.5 }, notice: { color: colors.warningText, backgroundColor: colors.warning, padding: 12, borderRadius: 12, fontSize: 13, lineHeight: 20 },
});
