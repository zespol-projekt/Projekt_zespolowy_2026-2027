import { StyleSheet, Text, View } from "react-native";

export default function SettingsScreen() {
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Ustawienia</Text>
      <Text style={styles.subtitle}>W tej sekcji będą dostępne ustawienia konta i aplikacji.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
    backgroundColor: "#F7F7F2",
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: "#252B30",
  },
  subtitle: {
    marginTop: 12,
    fontSize: 15,
    lineHeight: 22,
    color: "#606660",
  },
});
