import { ScrollView, StyleSheet, Text, View } from "react-native";

const shortcuts = [
  {
    title: "Listy zakupów",
    description: "Planuj zakupy w jednym miejscu",
    action: "Stwórz nową",
  },
  {
    title: "Ulubione",
    description: "Produkty, które lubisz",
    action: "Zobacz ulubione",
  },
  {
    title: "Sklepy i mapa",
    description: "Znajdź sklep w okolicy",
    action: "Zobacz sklepy",
  },
  {
    title: "Gazetki i promocje",
    description: "Sprawdź aktualne produkty",
    action: "Przeglądaj",
  },
] as const;

export default function Index() {
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.shortcutGrid}>
        {shortcuts.map((shortcut, index) => (
          <View
            key={shortcut.title}
            style={[
              styles.shortcut,
              index % 2 === 0 ? styles.leftShortcut : styles.rightShortcut,
            ]}
          >
            <Text style={styles.shortcutTitle}>{shortcut.title}</Text>
            <Text style={styles.shortcutDescription}>
              {shortcut.description}
            </Text>
            <View style={styles.shortcutAction}>
              <Text style={styles.shortcutActionText}>{shortcut.action}</Text>
            </View>
          </View>
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
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 4,
  },
  shortcutGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: 12,
  },
  shortcut: {
    flexBasis: "50%",
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
  leftShortcut: {
    paddingRight: 9,
  },
  rightShortcut: {
    paddingLeft: 9,
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
