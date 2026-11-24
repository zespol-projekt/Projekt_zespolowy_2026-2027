import { useTheme } from '@/features/theme/ThemeProvider';
import type { ThemeColors } from '@/features/theme/palette';
import type { BottomTabBarProps } from "expo-router/js-tabs";
import { SymbolView } from "expo-symbols";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

const TAB_ICON_AREA = 44;
const CART_ICON_AREA = 60;
export const CART_TAB_RISE = CART_ICON_AREA - TAB_ICON_AREA;

const items = [
  {
    name: "index",
    label: "Start",
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
  const overMap = state.routes[state.index].name === "stores";
  return (
    <View pointerEvents="box-none" style={[styles.bar, overMap && styles.overMap]}>
      <View testID="bottom-bar-background" pointerEvents="none" style={styles.barBackground} />
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
              {isCart
                ? <Image source={require("@/assets/images/cart-tab.png")} resizeMode="contain" accessible={false} style={styles.cartLogo} />
                : <SymbolView name={item.icon} size={32} tintColor={color} />}
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
    alignItems: "flex-end",
    paddingBottom: 8,
    marginTop: -CART_TAB_RISE,
    zIndex: 1,
  },
  overMap: {
    marginTop: -12,
  },
  barBackground: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    top: CART_TAB_RISE,
    backgroundColor: colors.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  item: {
    flex: 1,
    alignItems: "center",
  },
  iconArea: {
    width: TAB_ICON_AREA,
    height: TAB_ICON_AREA,
    alignItems: "center",
    justifyContent: "center",
  },
  cartCircle: {
    width: CART_ICON_AREA,
    height: CART_ICON_AREA,
    borderRadius: CART_ICON_AREA / 2,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: "#FFFFFF",
    boxShadow: "0px 2px 4px rgba(0, 0, 0, 0.16)",
  },
  cartLogo: {
    width: 50,
    height: 50,
  },
  label: {
    marginTop: 2,
    fontSize: 12,
  },
  activeLabel: {
    fontWeight: "700",
  },
});
