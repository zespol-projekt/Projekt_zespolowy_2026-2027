import { useCallback, useRef, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { Button, Field, Notice, Screen, useUI } from '@/components/ui/Controls';
import BackButton from '@/components/navigation/BackButton';
import { useAuth } from '@/features/auth';
import { authPolicy } from '@/features/auth/service';
import { useSessionKey } from '@/features/catalog/hooks';

export default function ProfileScreen() {
  const key = useSessionKey();
  return key ? <Profile key={key} /> : null;
}
function Profile() {
  const auth = useAuth();
  const ui = useUI();
  const [editing, setEditing] = useState(false);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const clear = useCallback(() => { setPassword(''); setRepeat(''); setCode(''); }, []);
  useFocusEffect(useCallback(() => () => {
    request.current?.abort(); request.current = null; clear(); setEditing(false); setBusy(false); setSent(false); setMessage(null);
  }, [clear]));
  async function perform(kind: 'send' | 'save') {
    if (request.current) return;
    if (kind === 'save') {
      if (password.length < authPolicy.minimumPasswordLength) { setMessage('Hasło musi mieć co najmniej 8 znaków.'); return; }
      if (password !== repeat) { setMessage('Hasła nie są takie same.'); return; }
      if (!/^\d{6}$/.test(code)) { setMessage('Wpisz 6-cyfrowy kod z wiadomości email.'); return; }
    }
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setMessage(null);
    const result = kind === 'send' ? await auth.sendPasswordChangeCode(controller.signal) : await auth.changePassword(password, code, controller.signal);
    if (controller.signal.aborted) return;
    request.current = null; setBusy(false);
    if (!result.ok) { setMessage(result.error.message); return; }
    if (kind === 'send') { setSent(true); setMessage('Kod wysłany. Sprawdź email. Ponowne wysłanie jest możliwe po 60 sekundach.'); }
    else { clear(); setSent(false); setEditing(false); setMessage('Hasło zostało zmienione. Pozostajesz zalogowany.'); }
  }
  function cancel() {
    const pending = !!request.current;
    request.current?.abort(); request.current = null; clear(); setEditing(false); setBusy(false); setSent(false);
    setMessage(pending ? 'Zamknięto formularz. Wysłanego żądania nie można cofnąć — hasło mogło już zostać zmienione.' : null);
  }
  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <Screen title="Profil"><BackButton />
      <View style={ui.card}><Text style={ui.muted}>Email</Text><Text selectable style={ui.heading}>{auth.state.status === 'signedIn' ? auth.state.user.email : ''}</Text></View>
      <Button secondary title="Ulubione" onPress={() => router.navigate('/favorites')} />
      <Button secondary title="Listy zakupów" onPress={() => router.navigate('/cart')} />
      {!editing ? <Button title="Zmień hasło" onPress={() => { setEditing(true); setMessage(null); }} /> : <View style={ui.card}>
        <Text style={ui.heading}>Zmiana hasła</Text>
        <Text style={ui.text}>Wyślij kod potwierdzenia na email konta. Po zapisaniu nowego hasła pozostaniesz zalogowany.</Text>
        <Button secondary title={sent ? 'Wyślij kod ponownie' : 'Wyślij kod potwierdzenia'} busy={busy} onPress={() => void perform('send')} />
        {sent && <>
          <Field label="Kod potwierdzenia" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" editable={!busy} />
          <Field label="Nowe hasło" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} editable={!busy} />
          <Field label="Powtórz nowe hasło" value={repeat} onChangeText={setRepeat} secureTextEntry autoCapitalize="none" autoCorrect={false} editable={!busy} />
          <Button title="Zapisz nowe hasło" busy={busy} onPress={() => void perform('save')} />
        </>}
        <Button secondary title="Anuluj zmianę hasła" onPress={cancel} />
      </View>}
      {message && <Notice>{message}</Notice>}
      <Button secondary title="Wyloguj się" onPress={() => { cancel(); void auth.signOut(); }} />
    </Screen>
  </KeyboardAvoidingView>;
}
