import { useSessionKey } from '@/features/catalog/hooks';
import SideMenu from '@/components/navigation/SideMenu';
import { ThemeProvider, useTheme } from '@/features/theme/ThemeProvider';
import type { ThemeColors } from '@/features/theme/palette';
import { isRunningInExpoGo } from "expo";
import { Link, router, usePathname } from "expo-router";
import { Tabs } from "expo-router/js-tabs";
import { StatusBar } from "expo-status-bar";
import { NavigationBar } from "expo-navigation-bar";
import { SymbolView } from "expo-symbols";
import { ActivityIndicator, Image, Keyboard, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useEffect, useRef, useState } from "react";
import BottomBar from "@/components/navigation/BottomBar";
import { AuthProvider, useAuth } from "@/features/auth";
import AuthScreen from "@/features/auth/AuthScreen";
import { destination, logoutVersion, rememberDestination } from "@/features/auth/navigation";
import { ShoppingProvider } from "@/features/catalog/ShoppingProvider";

export default function RootLayout() {
  return <ThemeProvider><AuthProvider><ShoppingProvider><AppShell /></ShoppingProvider></AuthProvider></ThemeProvider>;
}
function AppShell() {
  const { colors, dark, ready } = useTheme();
  const styles = createStyles(colors);
  const { state, retrySession } = useAuth();
  const pathname = usePathname();
  const sessionKey = useSessionKey();
  const [menu, setMenu] = useState<{ path: string; key: string | null } | null>(null);
  const menuButton = useRef<React.ComponentRef<typeof View>>(null);
  const closeMenu = () => { setMenu(null); if (Platform.OS === "web") requestAnimationFrame(() => menuButton.current?.focus()); };
  const started = useRef(false);
  const previous = useRef(state.status);
  const seenLogout = useRef(logoutVersion());
  useEffect(() => {
    const loggedOut = seenLogout.current !== logoutVersion();
    if (!started.current) { rememberDestination(pathname); started.current = true; }
    if (loggedOut) {
      seenLogout.current = logoutVersion();
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
  const menuOpen = signedIn && menu?.path === pathname && menu?.key === sessionKey;
  const readerOpen = signedIn && /^\/leaflets\/[^/]+$/.test(pathname);
  return <SafeAreaView style={styles.screen}>
    <StatusBar style={dark ? "light" : "dark"} />
    {controlsAndroidNavigationBar && <NavigationBar style={dark ? "light" : "dark"} />}
    <View style={[isWeb ? styles.webLayout : styles.mobileLayout, (!signedIn || !ready) && styles.hidden]}
      aria-hidden={!signedIn || menuOpen || readerOpen} pointerEvents={menuOpen ? "none" : "auto"} accessibilityElementsHidden={!signedIn || menuOpen || readerOpen} importantForAccessibility={signedIn && !menuOpen && !readerOpen ? "auto" : "no-hide-descendants"}>
      <View style={isWeb ? styles.webMain : styles.mobileMain}>
        <View style={styles.header}>
          <Link href="/" asChild><Pressable accessibilityRole="link" accessibilityLabel="SMARTCART — ekran startowy" style={styles.homeButton}>
            <Image source={require("@/assets/images/header-logo.png")} resizeMode="contain" accessible={false} style={styles.logo} />
          </Pressable></Link>
          <Pressable ref={menuButton} style={styles.settingsButton} accessibilityRole="button" accessibilityLabel="Otwórz menu" aria-expanded={menuOpen} accessibilityState={{ expanded: menuOpen }} onPress={() => { Keyboard.dismiss(); setMenu({ path: pathname, key: sessionKey }); }}>
            <SymbolView name={{ ios: "line.3.horizontal", android: "menu", web: "menu" }} size={24} tintColor={colors.text} />
          </Pressable>
        </View>
        <View style={styles.content}>
          <Tabs backBehavior="history" tabBar={props => <BottomBar {...props} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.background } }}>
            <Tabs.Screen name="stores" options={{ title: "Mapa" }} />
            <Tabs.Screen name="favorites" options={{ title: "Ulubione" }} />
            <Tabs.Screen name="cart" options={{ title: "Koszyk" }} />
            <Tabs.Screen name="shopping-lists" options={{ title: "Listy zakupów" }} />
            <Tabs.Screen name="products" options={{ title: "Szukaj" }} />
            <Tabs.Screen name="profile" options={{ title: "Profil" }} />
            <Tabs.Screen name="settings" options={{ title: "Ustawienia" }} />
            <Tabs.Screen name="index" options={{ title: "Start" }} />
            <Tabs.Screen name="help" options={{ title: "Pomoc" }} />
            <Tabs.Screen name="rules" options={{ title: "Zasady porównywania" }} />
            <Tabs.Screen name="leaflets" options={{ title: "Gazetki" }} />
          </Tabs>
        </View>
      </View>
    </View>
    <SideMenu visible={menuOpen} onClose={closeMenu} />
    {!signedIn && (state.status === "initializing" ? <View style={styles.centered}><ActivityIndicator size="large" color={colors.primary} /><Text style={styles.loadingText}>Sprawdzanie sesji…</Text></View>
      : state.status === "error" ? <View style={styles.centered}>
        <Text style={styles.errorTitle}>Nie udało się odtworzyć sesji</Text><Text style={styles.errorText}>{state.error.message}</Text>
        <Pressable accessibilityRole="button" style={styles.buttonPrimary} onPress={() => void retrySession()}><Text style={styles.buttonPrimaryText}>Spróbuj ponownie</Text></Pressable>
      </View> : <AuthScreen />)}
  </SafeAreaView>;
}

const isWeb = Platform.OS === "web";
// Expo Go applies the project's contrast setting from the manifest.
// Calling setStyle there reapplies contrast from the Expo Go activity theme.
const controlsAndroidNavigationBar = Platform.OS === "android" && !isRunningInExpoGo();

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
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
    color: colors.text,
  },
  errorText: {
    marginTop: 12,
    textAlign: "center",
    color: colors.muted,
    fontSize: 15,
  },
  loadingText: {
    marginTop: 16,
    color: colors.text,
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
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  logo: {
    width: "100%",
    height: "100%",
  },
  homeButton: {
    width: 220,
    flexShrink: 1,
    aspectRatio: 540 / 166,
    minHeight: 44,
    justifyContent: "center",
  },
  settingsButton: {
    width: 44,
    height: 44,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    flex: 1,
  },
  buttonPrimary: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: colors.primary,
    paddingHorizontal: 18,
  },
  buttonPrimaryText: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.onPrimary,
  },

});
