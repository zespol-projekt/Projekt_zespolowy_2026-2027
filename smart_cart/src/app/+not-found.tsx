import { Link, Redirect } from "expo-router";
import { Platform, StyleSheet, Text, View } from "react-native";

export default function NotFound() {
  if (Platform.OS === "web") {
    return <Redirect href="/" />;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Nie znaleziono strony</Text>
      <Link href="/" style={styles.link}>
        Wróć na stronę główną
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    backgroundColor: "#F7F7F2",
    padding: 24,
  },
  title: {
    color: "#252B30",
    fontSize: 22,
    fontWeight: "700",
  },
  link: {
    color: "#07966D",
    fontSize: 16,
    fontWeight: "700",
  },
});
