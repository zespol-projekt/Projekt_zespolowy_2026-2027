import { useTheme } from '@/features/theme/ThemeProvider';
import type { ThemeColors } from '@/features/theme/palette';
import { Link, Redirect } from "expo-router";
import { Platform, StyleSheet, Text, View } from "react-native";

export default function NotFound() {
  const { colors } = useTheme();
  const styles = createStyles(colors);
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

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    backgroundColor: colors.background,
    padding: 24,
  },
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "700",
  },
  link: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: "700",
  },
});
