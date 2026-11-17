import { useTheme } from '@/features/theme/ThemeProvider';
import { Stack } from "expo-router";

export default function SectionLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    />
  );
}