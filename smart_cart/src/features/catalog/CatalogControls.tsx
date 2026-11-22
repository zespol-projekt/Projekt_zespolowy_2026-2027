import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { ui } from '@/components/ui/Controls';

export function CatalogButton({ title, label = title, onPress, disabled = false, busy = false, secondary = true, expanded }: {
  title: string; label?: string; onPress: () => void; disabled?: boolean; busy?: boolean; secondary?: boolean; expanded?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: disabled || busy, busy, expanded }}
    aria-expanded={expanded} aria-busy={busy} disabled={disabled || busy} onPress={onPress}
    style={({ pressed }) => [ui.button, styles.button, secondary && ui.secondary, (disabled || busy || pressed) && ui.disabled]}>
    {busy && <ActivityIndicator color={secondary ? ui.secondaryText.color : ui.buttonText.color} />}
    <Text style={[ui.buttonText, styles.text, secondary && ui.secondaryText]}>{label}</Text>
  </Pressable>;
}
const styles = StyleSheet.create({ button: { maxWidth: '100%', flexShrink: 1 }, text: { flexShrink: 1, textAlign: 'center' } });
