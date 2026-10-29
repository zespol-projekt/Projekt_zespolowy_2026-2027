import type { BottomTabBarProps } from "expo-router/js-tabs";
import { SymbolView } from "expo-symbols";
import { Pressable, StyleSheet, Text, View } from "react-native";

const items = [
  {
    name: "stores",
    label: "Sklepy",
    icon: { ios: "storefront", android: "storefront", web: "storefront" },
  },
  {
    name: "favorites",
    label: "Ulubione",
    icon: { ios: "heart", android: "favorite", web: "favorite" },
  },
  {
    name: "cart",
    label: "Koszyk",
    icon: { ios: "cart", android: "shopping_cart", web: "shopping_cart" },
  },
  {
    name: "products",
    label: "Produkty",
    icon: { ios: "cube", android: "deployed_code", web: "deployed_code" },
  },
  {
    name: "profile",
    label: "Profil",
    icon: { ios: "person", android: "person", web: "person" },
  },
] as const;

export default function BottomBar({
  state,
  emitter,
  navigateToTab,
}: BottomTabBarProps) {
  return (
    <View style={styles.bar}>
      {items.map((item) => {
        const route = state.routes.find(
          (screen) => screen.name === item.name
        );

        if (!route) return null;

        const selected = state.routes[state.index].key === route.key;
        const isCart = item.name === "cart";
        const color = selected ? "#252B30" : "#606660";

        const handlePress = () => {
          const event = emitter.emit({
            type: "tabPress",
            target: route.key,
            canPreventDefault: true,
          });

          if (!selected && !event.defaultPrevented) {
            navigateToTab(route.key);
          }
        };

        return (
          <Pressable
            key={item.name}
            style={styles.item}
            accessibilityRole="tab"
            accessibilityLabel={item.label}
            accessibilityState={{ selected }}
            onPress={handlePress}
            onLongPress={() =>
              emitter.emit({
                type: "tabLongPress",
                target: route.key,
              })
            }
          >
            <View style={[styles.iconArea, isCart && styles.cartCircle]}>
              <SymbolView
                name={item.icon}
                size={isCart ? 28 : 24}
                tintColor={isCart ? "#FFFFFF" : color}
              />
            </View>

            <Text
              style={[
                styles.label,
                { color },
                selected && styles.activeLabel,
              ]}
            >
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 12,
    marginBottom: 8,
    paddingTop: 10,
    paddingBottom: 8,
    paddingHorizontal: 4,
    borderWidth: 1,
    borderColor: "#DDDFD7",
    borderRadius: 28,
    backgroundColor: "#F7F7F2",
  },
  item: {
    flex: 1,
    alignItems: "center",
  },
  iconArea: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  cartCircle: {
    borderRadius: 28,
    backgroundColor: "#252B30",
  },
  label: {
    marginTop: 5,
    fontSize: 11,
  },
  activeLabel: {
    fontWeight: "700",
  },
});