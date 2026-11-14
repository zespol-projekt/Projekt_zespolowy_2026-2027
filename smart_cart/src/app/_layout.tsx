import { Link, router, usePathname } from "expo-router";
import { Tabs } from "expo-router/js-tabs";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useEffect, useRef, useState } from "react";
import BottomBar from "@/components/navigation/BottomBar";
import { AuthProvider, useAuth } from "@/features/auth";
import AuthScreen from "@/features/auth/AuthScreen";
import { destination, logoutVersion, rememberDestination } from "@/features/auth/navigation";
import { ShoppingProvider } from "@/features/catalog/ShoppingProvider";

export default function RootLayout() {
  return <AuthProvider><ShoppingProvider><AppShell /></ShoppingProvider></AuthProvider>;
}
function AppShell() {
  const { state, retrySession } = useAuth();
  const pathname = usePathname();
  const [search, setSearch] = useState("");
  const started = useRef(false);
  const previous = useRef(state.status);
  const seenLogout = useRef(logoutVersion());
  useEffect(() => {
    const loggedOut = seenLogout.current !== logoutVersion();
    if (!started.current) { rememberDestination(pathname); started.current = true; }
    if (loggedOut) {
      seenLogout.current = logoutVersion(); setSearch("");
      router.replace("/");
    } else if (state.status === "signedIn") {
      if (previous.current !== "signedIn" && pathname !== destination()) router.replace(destination());
      else rememberDestination(pathname);
    } else if (previous.current !== "signedIn" && state.status === "signedOut") {
      rememberDestination(pathname);
    }
    previous.current = state.status;
  }, [state.status, pathname]);
  const signedIn = state.status === "signedIn";
  const isStores = pathname.startsWith("/stores");
  return <SafeAreaView style={styles.screen}>
    <StatusBar style="dark" />
    <View style={[isWeb ? styles.webLayout : styles.mobileLayout, !signedIn && styles.hidden]}
      accessibilityElementsHidden={!signedIn} importantForAccessibility={signedIn ? "auto" : "no-hide-descendants"}>
      <View style={isWeb ? styles.webMain : styles.mobileMain}>
        <View style={styles.header}>
          <Link href="/" asChild><Pressable accessibilityRole="link" accessibilityLabel="SMARTCART — ekran startowy" style={styles.homeButton}>
            <Text style={styles.logo}>SMARTCART</Text>
          </Pressable></Link>
          <Pressable style={styles.settingsButton} accessibilityRole="button" accessibilityLabel="Ustawienia" onPress={() => router.navigate("/settings")}>
            <SymbolView name={{ ios: "gearshape", android: "settings", web: "settings" }} size={24} tintColor="#343A40" />
          </Pressable>
        </View>
        {!isStores && <View style={styles.searchBar}>
          <TextInput style={styles.searchInput} placeholder="Szukaj produktów..." placeholderTextColor="#777B78"
            accessibilityLabel="Szukaj produktów" autoCapitalize="none" autoCorrect={false} returnKeyType="search"
            value={search} onChangeText={setSearch}
            onSubmitEditing={() => router.navigate({ pathname: "/products", params: { q: search } })} />
        </View>}
        <View style={styles.content}>
          <Tabs backBehavior="history" tabBar={props => <BottomBar {...props} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: "#F7F7F2" } }}>
            <Tabs.Screen name="stores" options={{ title: "Sklepy" }} />
            <Tabs.Screen name="favorites" options={{ title: "Ulubione" }} />
            <Tabs.Screen name="cart" options={{ title: "Koszyk" }} />
            <Tabs.Screen name="products" options={{ title: "Produkty" }} />
            <Tabs.Screen name="profile" options={{ title: "Profil" }} />
            <Tabs.Screen name="settings" options={{ title: "Ustawienia" }} />
            <Tabs.Screen name="index" options={{ title: "Start" }} />
          </Tabs>
        </View>
      </View>
    </View>
    {!signedIn && (state.status === "initializing" ? <View style={styles.centered}><ActivityIndicator size="large" color="#07966D" /><Text style={styles.loadingText}>Sprawdzanie sesji…</Text></View>
      : state.status === "error" ? <View style={styles.centered}>
        <Text style={styles.errorTitle}>Nie udało się odtworzyć sesji</Text><Text style={styles.errorText}>{state.error.message}</Text>
        <Pressable accessibilityRole="button" style={styles.buttonPrimary} onPress={() => void retrySession()}><Text style={styles.buttonPrimaryText}>Spróbuj ponownie</Text></Pressable>
      </View> : <AuthScreen />)}
  </SafeAreaView>;
}

const isWeb = Platform.OS === "web";

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F7F7F2",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  errorTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: "#252B30",
  },
  errorText: {
    marginTop: 12,
    textAlign: "center",
    color: "#606660",
    fontSize: 15,
  },
  loadingText: {
    marginTop: 16,
    color: "#252B30",
    fontSize: 15,
  },
  hidden: {
    display: "none",
  },
  webLayout: {
    flex: 1,
    alignItems: "center",
  },
  mobileLayout: {
    flex: 1,
  },
  webMain: {
    flex: 1,
    width: "100%",
    maxWidth: 760,
    paddingVertical: 16,
  },
  mobileMain: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  logo: {
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 0.5,
    color: "#252B30",
  },
  homeButton: {
    minHeight: 44,
    justifyContent: "center",
    flexShrink: 1,
  },
  settingsButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 20,
    marginTop: 8,
    paddingHorizontal: 14,
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: "#EAEAE5",
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 14,
    fontSize: 16,
    color: "#252B30",
  },
  content: {
    flex: 1,
  },
  buttonPrimary: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: "#07966D",
    paddingHorizontal: 18,
  },
  buttonPrimaryText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFFFFF",
  },

});
