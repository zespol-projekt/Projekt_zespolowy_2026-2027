import { Stack } from "expo-router";

export default function SectionLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "#F7F7F2" },
      }}
    />
  );
}