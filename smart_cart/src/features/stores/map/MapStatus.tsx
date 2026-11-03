import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

export function MapStatus({ ready, error, fatal, retry }: { ready: boolean; error: string | null; fatal: boolean; retry: () => void }) {
  if (ready && !error) return null;
  return <View style={[styles.box, fatal && styles.fatal]} accessibilityLiveRegion="polite">
    {!ready && !error && <ActivityIndicator color="#07966D" />}
    <Text style={styles.text}>{error ?? 'Uruchamianie mapy…'}</Text>
    {fatal && <Pressable onPress={retry} style={styles.button} accessibilityRole="button" accessibilityLabel="Uruchom mapę ponownie">
      <Text style={styles.buttonText}>Spróbuj ponownie</Text>
    </Pressable>}
  </View>;
}
const styles = StyleSheet.create({
  box: { position: 'absolute', top: 65, left: 12, right: 12, padding: 12, borderRadius: 12, backgroundColor: '#FFFFFF', gap: 8, alignItems: 'center' },
  fatal: { top: 70, bottom: 40, justifyContent: 'center' },
  text: { color: '#344C40', fontSize: 13, lineHeight: 19, textAlign: 'center' },
  button: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 12, backgroundColor: '#07966D' },
  buttonText: { color: '#FFFFFF', fontWeight: '700' },
});
