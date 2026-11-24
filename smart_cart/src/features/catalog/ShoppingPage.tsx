import { CART_TAB_RISE } from '@/components/navigation/BottomBar';
import { useTheme } from '@/features/theme/ThemeProvider';
import { Link, type Href } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import type { ComponentProps, PropsWithChildren } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

export const chevron = { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' } as const;

export function ShoppingPage({ title, description, icon, back = '/', headingCard = false, pageTitle, children }: PropsWithChildren<{
  title: string; description?: string; icon?: ComponentProps<typeof SymbolView>['name'];
  back?: '/' | '/cart' | null; headingCard?: boolean; pageTitle?: string;
}>) {
  const { colors } = useTheme();
  const backLabel = back === '/' ? 'Wróć na główną' : 'Wróć do koszyka';
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
    {back && <Link href={back} asChild>
      <Pressable accessibilityRole="link" accessibilityLabel={backLabel} style={styles.back}>
        <SymbolView name={{ ios: 'arrow.left', android: 'arrow_back', web: 'arrow_back' }} size={20} tintColor={colors.link} />
        <Text style={[styles.backLabel, { color: colors.link }]}>{backLabel}</Text>
      </Pressable>
    </Link>}
    {pageTitle && <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{pageTitle}</Text>}
    {headingCard ? <View style={[styles.headingCard, { backgroundColor: colors.secondary }]}>
      {icon && <SymbolView name={icon} size={25} tintColor={colors.link} />}
      <View style={styles.cardText}>
        <Text accessibilityRole="header" style={[styles.cardTitle, { color: colors.text }]}>{title}</Text>
        {description && <Text style={{ color: colors.muted }}>{description}</Text>}
      </View>
    </View> : <View style={styles.heading}>
      {icon && <View style={[styles.badge, { backgroundColor: colors.secondary }]}><SymbolView name={icon} size={25} tintColor={colors.link} /></View>}
      <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{title}</Text>
      {description && <Text style={[styles.description, { color: colors.muted }]}>{description}</Text>}
    </View>}
    {children}
  </ScrollView>;
}

export function ShoppingAction({ href, label }: { href: Href; label: string }) {
  const { colors } = useTheme();
  return <Link href={href} asChild>
    <Pressable accessibilityRole="link" accessibilityLabel={label}
      style={StyleSheet.flatten([styles.action, { backgroundColor: colors.primary }])}>
      <Text style={[styles.actionLabel, { color: colors.onPrimary }]}>{label}</Text>
      <SymbolView name={{ ios: 'arrow.right', android: 'arrow_forward', web: 'arrow_forward' }} size={21} tintColor={colors.onPrimary} />
    </Pressable>
  </Link>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16 + CART_TAB_RISE, gap: 14, flexGrow: 1 },
  back: { alignSelf: 'flex-start', minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 },
  backLabel: { fontSize: 14, fontWeight: '600' },
  heading: { gap: 8, paddingTop: 14, paddingBottom: 10 },
  headingCard: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18, minHeight: 86, borderRadius: 18 },
  cardText: { flex: 1, minWidth: 0, gap: 4 },
  cardTitle: { fontSize: 18, fontWeight: '800' },
  badge: { width: 48, height: 48, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  title: { fontSize: 30, fontWeight: '800' },
  description: { fontSize: 16, lineHeight: 24 },
  action: { minHeight: 50, borderRadius: 15, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  actionLabel: { flex: 1, fontSize: 15, fontWeight: '600' },
});
