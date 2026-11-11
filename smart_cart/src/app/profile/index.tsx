import { Pressable, StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/features/auth";

export default function ProfileScreen() {
  const { state, signOut } = useAuth();

  if (state.status !== "signedIn") {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.title}>Profil</Text>
        <Text style={styles.subtitle}>Zaloguj się, aby zobaczyć dane konta.</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Profil</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Adres e-mail</Text>
        <Text style={styles.email}>{state.user.email}</Text>
      </View>

      <Pressable
        style={styles.primaryButton}
        accessibilityRole="button"
        accessibilityLabel="Wyloguj się"
        onPress={() => void signOut()}
      >
        <Text style={styles.primaryButtonText}>Wyloguj się</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    backgroundColor: "#F7F7F2",
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#F7F7F2",
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: "#252B30",
  },
  subtitle: {
    marginTop: 8,
    color: "#606660",
    fontSize: 14,
  },
  card: {
    marginTop: 20,
    padding: 18,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5E8E2",
  },
  label: {
    fontSize: 13,
    color: "#606660",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  email: {
    marginTop: 8,
    fontSize: 17,
    color: "#252B30",
    fontWeight: "600",
  },
  primaryButton: {
    marginTop: 24,
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: "#252B30",
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
});
