import { Stack } from "expo-router";
import { CatalogDraftProvider } from '@/features/catalog/CatalogDraftProvider';

export default function SectionLayout() {
  return (
    <CatalogDraftProvider><Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "#F7F7F2" },
      }}
    /></CatalogDraftProvider>
  );
}
