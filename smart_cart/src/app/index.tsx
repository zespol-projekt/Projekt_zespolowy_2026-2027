import { Link } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

const CARD_GAP = 12;
const MIN_CARD_WIDTH = 144;

const shortcuts = [
  {
    title: "Listy zakupów",
    description: "Planuj zakupy w jednym miejscu",
    action: "Otwórz koszyk",
    href: "/cart",
  },
  {
    title: "Ulubione",
    description: "Produkty, które lubisz",
    action: "Zobacz ulubione",
    href: "/favorites",
  },
  {
    title: "Sklepy i mapa",
    description: "Znajdź sklep w okolicy",
    action: "Zobacz sklepy",
    href: "/stores",
  },
  {
    title: "Gazetki i promocje",
    description: "Sprawdź aktualne produkty",
    action: "Przeglądaj",
    href: "/products",
  },
] as const;

export default function Index() {
  const [gridWidth, setGridWidth] = useState(0);
  const cardWidth =
    gridWidth >= MIN_CARD_WIDTH * 2 + CARD_GAP
      ? (gridWidth - CARD_GAP) / 2
      : "100%";

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View
        style={styles.shortcutGrid}
        onLayout={(event) => setGridWidth(event.nativeEvent.layout.width)}
      >
        {shortcuts.map((shortcut) => (
          <Link
            key={shortcut.title}
            href={shortcut.href}
            style={[styles.shortcut, { width: cardWidth }]}
            asChild
          >
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`${shortcut.title}: ${shortcut.action}`}
              android_ripple={{ color: "#E5E8E2" }}
            >
              <Text style={styles.shortcutTitle}>{shortcut.title}</Text>
              <Text style={styles.shortcutDescription}>
                {shortcut.description}
              </Text>
              <View style={styles.shortcutAction}>
                <Text style={styles.shortcutActionText}>{shortcut.action}</Text>
              </View>
            </Pressable>
          </Link>
        ))}
      </View>

      <View style={styles.productsPanel} accessibilityLabel="Puste produkty">
        <Text style={styles.productsTitle}>PRODUKTY</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 4,
  },
  shortcutGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: CARD_GAP,
  },
  shortcut: {
    minHeight: 164,
    justifyContent: "space-between",
    padding: 14,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#E5E8E2",
    backgroundColor: "#FFFFFF",
    shadowColor: "#152D43",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  shortcutTitle: {
    fontSize: 21,
    fontWeight: "800",
    lineHeight: 25,
    color: "#152D43",
  },
  shortcutDescription: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 18,
    color: "#606660",
  },
  shortcutAction: {
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
    paddingHorizontal: 6,
    borderRadius: 11,
    backgroundColor: "#07966D",
  },
  shortcutActionText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FFFFFF",
    textAlign: "center",
  },
  productsPanel: {
    marginTop: 14,
    minHeight: 190,
    paddingTop: 12,
    paddingBottom: 12,
    borderRadius: 22,
    backgroundColor: "#07966D",
  },
  productsTitle: {
    marginHorizontal: 12,
    marginBottom: 8,
    fontSize: 19,
    fontWeight: "800",
    color: "#FFFFFF",
  },
});
