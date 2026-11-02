import { router } from "expo-router";
import { Tabs } from "expo-router/js-tabs";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import BottomBar from "@/components/navigation/BottomBar";

export default function RootLayout() {
  const isWeb = Platform.OS === "web";

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />

      <View style={isWeb ? styles.webLayout : styles.mobileLayout}>
        {isWeb && <View style={styles.webGutter} />}

        <View style={isWeb ? styles.webMain : styles.mobileMain}>
          {/* Wspólny nagłówek */}
          <View style={styles.header}>
            <Text style={styles.logo}>SMARTCART</Text>

            <Pressable
              style={styles.settingsButton}
              accessibilityRole="button"
              accessibilityLabel="Ustawienia"
              onPress={() => router.navigate("/settings")}
            >
              <SymbolView
                name={{
                  ios: "gearshape",
                  android: "settings",
                  web: "settings",
                }}
                size={24}
                tintColor="#343A40"
              />
            </Pressable>
          </View>

          {/* Wspólne pole wyszukiwania */}
          <View style={styles.searchBar}>
            <SymbolView
              name={{
                ios: "magnifyingglass",
                android: "search",
                web: "search",
              }}
              size={22}
              tintColor="#777B78"
            />

            <TextInput
              style={styles.searchInput}
              placeholder="Szukaj produktów..."
              placeholderTextColor="#777B78"
              accessibilityLabel="Szukaj produktów"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              underlineColorAndroid="transparent"
            />
          </View>

          {/* Ekrany i ich wspólny dolny pasek */}
          <View style={styles.content}>
            <Tabs
              backBehavior="history"
              tabBar={(props) => <BottomBar {...props} />}
              screenOptions={{
                headerShown: false,
                sceneStyle: { backgroundColor: "#F7F7F2" },
              }}
            >
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

        {isWeb && <View style={styles.webGutter} />}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F7F7F2",
  },
  webLayout: {
    flex: 1,
    flexDirection: "row",
  },
  mobileLayout: {
    flex: 1,
  },
  webGutter: {
    flex: 2,
  },
  webMain: {
    flex: 4,
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
});