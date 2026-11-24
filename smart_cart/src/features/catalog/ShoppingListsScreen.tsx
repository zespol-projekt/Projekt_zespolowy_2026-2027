import { Button, Field, Notice, useUI } from '@/components/ui/Controls';
import { useTheme } from '@/features/theme/ThemeProvider';
import { Link, useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSessionAction, useSessionKey } from './hooks';
import { catalogApi } from './api';
import { useShopping } from './ShoppingProvider';
import { chevron, ShoppingPage } from './ShoppingPage';

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
  const [edit, setEdit] = useState<{ id: string; kind: 'rename' | 'delete' } | null>(null);
  const reload = shopping.reload;
  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  const closeEditor = () => { setCreating(false); setEdit(null); setName(''); action.setMessage(null); };

  return <ShoppingPage title="Twoje listy zakupów" description="Wszystkie Twoje listy. Wybierz, którą chcesz mieć w koszyku." back={null}>
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
      const openEditor = (kind: 'rename' | 'delete') => {
        closeEditor();
        setEdit({ id: list.id, kind });
        if (kind === 'rename') setName(list.name);
      };
      return <View key={list.id} style={card}>
        <View style={styles.row}>
          <Link href={{ pathname: '/cart/list', params: { listId: list.id } }} asChild>
            <Pressable accessibilityRole="link" accessibilityLabel={`Otwórz listę: ${list.name}`} style={styles.listLink}>
              <SymbolView name={icon} size={24} tintColor={colors.link} />
              {details}
              <SymbolView name={chevron} size={16} tintColor={colors.muted} />
            </Pressable>
          </Link>
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Zmień nazwę: ${list.name}`}
              disabled={action.busy} onPress={() => openEditor('rename')} style={styles.iconButton}>
              <SymbolView name={{ ios: 'pencil', android: 'edit', web: 'edit' }} size={20} tintColor={colors.link} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Usuń listę: ${list.name}`}
              disabled={action.busy} onPress={() => openEditor('delete')} style={styles.iconButton}>
              <SymbolView name={{ ios: 'trash', android: 'delete', web: 'delete' }} size={20} tintColor={colors.link} />
            </Pressable>
          </View>
        </View>
        {!active && <Pressable accessibilityRole="button" accessibilityLabel={`Ustaw jako aktualną: ${list.name}`} onPress={() => shopping.select(list.id)}
          style={[styles.activate, { borderColor: colors.border }]}>
          <Text style={{ color: colors.link }}>Ustaw jako aktualną</Text>
        </Pressable>}
        {edit?.id === list.id && <View style={styles.editor}>
          {edit.kind === 'rename' ? <>
            <Field label="Zmień nazwę listy" value={name} onChangeText={setName} maxLength={100} editable={!action.busy} />
            <Button title="Zapisz nazwę" busy={action.busy} disabled={!name.trim() || name.trim() === list.name}
              onPress={() => void action.run(signal => catalogApi.renameList(list.id, name, signal), () => { closeEditor(); reload(); })} />
          </> : <>
            <Notice>Usunąć tę listę i wszystkie jej pozycje?</Notice>
            <Button title="Potwierdź usunięcie listy" busy={action.busy}
              onPress={() => void action.run(signal => catalogApi.deleteList(list.id, signal), () => { closeEditor(); reload(); })} />
          </>}
          <Button secondary title="Anuluj" disabled={action.busy} onPress={closeEditor} />
          {action.message && <Notice>{action.message}</Notice>}
        </View>}
      </View>;
    })}
    {!shopping.loading && !shopping.error && !shopping.lists.length && <Text style={ui.text}>Nie masz jeszcze żadnej listy zakupów.</Text>}
    {creating ? <View style={ui.card}>
      <Field label="Nazwa nowej listy" value={name} onChangeText={setName} maxLength={100} editable={!action.busy} />
      <Button title="Utwórz listę" busy={action.busy} disabled={!name.trim()}
        onPress={() => void action.run(signal => shopping.create(name, signal), () => { setCreating(false); setName(''); })} />
      <Button secondary title="Anuluj" disabled={action.busy} onPress={closeEditor} />
      {action.message && <Notice>{action.message}</Notice>}
    </View> : <Pressable accessibilityRole="button" accessibilityLabel="Nowa lista" disabled={action.busy}
      onPress={() => { closeEditor(); setCreating(true); }} style={[ui.button, ui.secondary, styles.addButton]}>
      <SymbolView name={{ ios: 'plus', android: 'add', web: 'add' }} size={24} tintColor={colors.link} />
    </Pressable>}
  </ShoppingPage>;
}

const styles = StyleSheet.create({
  section: { textTransform: 'uppercase', letterSpacing: 1, fontSize: 12, marginTop: 8 },
  card: { borderWidth: 1, borderRadius: 18, padding: 15, gap: 10, minHeight: 80 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  listLink: { flex: 1, minWidth: 0, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 },
  actions: { flexDirection: 'row' },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  editor: { gap: 8 },
  addButton: { width: 44, paddingHorizontal: 0, alignSelf: 'center' },
  details: { flex: 1, minWidth: 0, gap: 4 },
  listName: { fontSize: 17, fontWeight: '800' },
  activate: { marginLeft: 36, minHeight: 44, justifyContent: 'center', borderTopWidth: StyleSheet.hairlineWidth },
});
