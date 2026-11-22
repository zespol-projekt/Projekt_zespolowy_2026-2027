import { useTheme } from '@/features/theme/ThemeProvider';
import { Stack } from "expo-router";
import { CatalogDraftProvider } from '@/features/catalog/CatalogDraftProvider';

export default function SectionLayout() {
  const { colors } = useTheme();
  return (
    <CatalogDraftProvider><Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    /></CatalogDraftProvider>
  );
}
