import { useTheme } from '@/features/theme/ThemeProvider';
import type { ThemeColors } from '@/features/theme/palette';
import type { BottomTabBarProps } from "expo-router/js-tabs";
import { SymbolView } from "expo-symbols";
import { Pressable, StyleSheet, Text, View } from "react-native";

const items = [
  {
    name: "index",
    label: "Home",
    icon: { ios: "house", android: "home", web: "home" },
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
    label: "Szukaj",
    icon: { ios: "magnifyingglass", android: "search", web: "search" },
  },
  {
    name: "stores",
    label: "Mapa",
    icon: { ios: "map", android: "map", web: "map" },
  },
] as const;

export default function BottomBar({
  state,
  emitter,
  navigateToTab,
}: BottomTabBarProps) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  return (
    <View style={styles.bar}>
      {items.map((item) => {
        const route = state.routes.find(
          (screen) => screen.name === item.name
        );

        if (!route) return null;

        const selected = state.routes[state.index].key === route.key;
        const isCart = item.name === "cart";
        const color = selected ? colors.text : colors.muted;

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
            aria-selected={selected}
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
                tintColor={isCart ? colors.onPrimary : color}
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

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 12,
    marginBottom: 0,
    paddingTop: 5,
    paddingBottom: 4,
    paddingHorizontal: 4,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 28,
    backgroundColor: colors.background,
  },
  item: {
    flex: 1,
    alignItems: "center",
  },
  iconArea: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  cartCircle: {
    borderRadius: 22,
    backgroundColor: colors.cart,
  },
  label: {
    marginTop: 2,
    fontSize: 10,
  },
  activeLabel: {
    fontWeight: "700",
  },
});