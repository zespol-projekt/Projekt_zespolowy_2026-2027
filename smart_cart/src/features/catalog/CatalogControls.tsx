import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useUI } from '@/components/ui/Controls';

export function CatalogButton({ title, label = title, onPress, disabled = false, busy = false, secondary = true, expanded }: {
  title: string; label?: string; onPress: () => void; disabled?: boolean; busy?: boolean; secondary?: boolean; expanded?: boolean;
}) {
  const ui = useUI();
  const styles = createStyles(ui);
  return <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: disabled || busy, busy, expanded }}
    aria-expanded={expanded} aria-busy={busy} disabled={disabled || busy} onPress={onPress}
    style={({ pressed }) => [ui.button, styles.button, secondary && ui.secondary, (disabled || busy || pressed) && ui.disabled]}>
    {busy && <ActivityIndicator color={secondary ? ui.secondaryText.color : ui.buttonText.color} />}
    <Text style={[ui.buttonText, styles.text, secondary && ui.secondaryText]}>{label}</Text>
  </Pressable>;
}
export function CatalogGroupIcon() {
  const ui = useUI();
  const styles = createStyles(ui);
  return <View aria-hidden style={styles.icon}>
    <Text allowFontScaling={false} style={styles.iconText}>▦</Text>
  </View>;
}

const createStyles = (ui: ReturnType<typeof useUI>) => StyleSheet.create({
  button: { maxWidth: '100%', flexShrink: 1 }, text: { flexShrink: 1, textAlign: 'center' },
  icon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: ui.secondary.backgroundColor },
  iconText: { fontSize: 26, color: ui.secondaryText.color },
});
