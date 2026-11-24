import { Button, Field, Notice, useUI } from '@/components/ui/Controls';
import { useTheme } from '@/features/theme/ThemeProvider';
import { Link, useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSessionAction, useSessionKey } from './hooks';
import { useShopping } from './ShoppingProvider';
import { chevron, listsIcon, ShoppingPage } from './ShoppingPage';

export default function ShoppingListsScreen() {
  const key = useSessionKey();
  return key ? <ShoppingLists key={key} /> : null;
}

function ShoppingLists() {
  const { colors } = useTheme();
  const ui = useUI();
  const shopping = useShopping();
  const action = useSessionAction();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const reload = shopping.reload;
  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  return <ShoppingPage title="Listy zakupów" description="Wszystkie Twoje listy. Wybierz, którą chcesz mieć w koszyku." icon={listsIcon}>
    {shopping.loading && <ActivityIndicator accessibilityLabel="Wczytywanie list zakupów" />}
    {shopping.error && <><Notice>{shopping.error}</Notice><Button secondary title="Ponów wczytywanie" onPress={reload} /></>}
    {!!shopping.lists.length && <Text accessibilityRole="header" style={[styles.section, { color: colors.muted }]}>Zapisane listy</Text>}
    {shopping.lists.map(list => {
      const active = list.id === shopping.activeId;
      const icon = active ? { ios: 'checklist', android: 'checklist', web: 'checklist' } as const
        : { ios: 'list.bullet', android: 'list', web: 'list' } as const;
      const details = <View style={styles.details}>
        <Text style={[styles.listName, { color: colors.text }]}>{list.name}</Text>
        <Text style={{ color: active ? colors.link : colors.muted }}>{active ? 'W koszyku' : 'Zapisana lista'}</Text>
      </View>;
      const card = [styles.card, { backgroundColor: colors.surface, borderColor: colors.border }];
      return active ? <Link key={list.id} href="/cart" asChild>
        <Pressable accessibilityRole="link" accessibilityLabel={`Otwórz koszyk: ${list.name}`} style={StyleSheet.flatten([card, styles.row])}>
          <SymbolView name={icon} size={24} tintColor={colors.link} />
          {details}
          <SymbolView name={chevron} size={20} tintColor={colors.muted} />
        </Pressable>
      </Link> : <View key={list.id} style={card}>
        <View style={styles.row}><SymbolView name={icon} size={24} tintColor={colors.link} />{details}</View>
        <Pressable accessibilityRole="button" accessibilityLabel={`Ustaw jako aktualną: ${list.name}`} onPress={() => shopping.select(list.id)}
          style={[styles.activate, { borderColor: colors.border }]}>
          <Text style={{ color: colors.link }}>Ustaw jako aktualną</Text>
        </Pressable>
      </View>;
    })}
    {!shopping.loading && !shopping.error && !shopping.lists.length && <Text style={ui.text}>Nie masz jeszcze żadnej listy zakupów.</Text>}
    {creating ? <View style={ui.card}>
      <Field label="Nazwa nowej listy" value={name} onChangeText={setName} maxLength={100} editable={!action.busy} />
      <Button title="Utwórz listę" busy={action.busy} disabled={!name.trim()}
        onPress={() => void action.run(signal => shopping.create(name, signal), () => { setCreating(false); setName(''); })} />
      <Button secondary title="Anuluj" disabled={action.busy} onPress={() => { setCreating(false); action.setMessage(null); }} />
      {action.message && <Notice>{action.message}</Notice>}
    </View> : <Button secondary title="Nowa lista" onPress={() => setCreating(true)} />}
  </ShoppingPage>;
}

const styles = StyleSheet.create({
  section: { textTransform: 'uppercase', letterSpacing: 1, fontSize: 12, marginTop: 8 },
  card: { borderWidth: 1, borderRadius: 18, padding: 15, gap: 10, minHeight: 80 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  details: { flex: 1, minWidth: 0, gap: 4 },
  listName: { fontSize: 17, fontWeight: '800' },
  activate: { marginLeft: 36, minHeight: 44, justifyContent: 'center', borderTopWidth: StyleSheet.hairlineWidth },
});
