import { Link } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useTheme } from '@/features/theme/ThemeProvider';

const shortcuts = [
  { title: 'Listy zakupów', description: 'Zaplanuj kolejne zakupy', href: '/cart' },
  { title: 'Ulubione', description: 'Twoje zapisane grupy', href: '/favorites' },
  { title: 'Gazetki', description: 'Przeglądaj strony gazetek w aplikacji', href: '/leaflets' },
  { title: 'Mapa sklepów', description: 'Znajdź sklep w okolicy', href: '/stores' },
  { title: 'Produkty', description: 'Sprawdź produkty i ceny sieci', href: '/products' },
] as const;
export default function Home() {
  const { colors } = useTheme();
  return <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 28 }}>
    <View style={{ gap: 12 }} testID="home-grid">
      {[shortcuts.slice(0, 2), shortcuts.slice(2, 3), shortcuts.slice(3)].map((row, index) => <View key={index} style={{ flexDirection: 'row', gap: 12 }}>
      {row.map(item => <Link key={item.href} href={item.href} asChild>
        <Pressable accessibilityRole="link" accessibilityLabel={item.title}
          style={{ flex: 1, minWidth: 0, minHeight: 148,
            padding: 16, borderRadius: 20, borderWidth: 1, borderColor: colors.border,
            backgroundColor: colors.surface, justifyContent: 'space-between', gap: 12 }}>
          <Text style={{ color: colors.text, fontSize: 20, fontWeight: '800' }}>{item.title}</Text>
          <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 20 }}>{item.description}</Text>
          <Text style={{ color: colors.link, fontWeight: '700' }}>Otwórz →</Text>
        </Pressable>
      </Link>)}
      </View>)}
    </View>
  </ScrollView>;
}
