import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { AuthShell } from '@/components/auth/AuthShell';
import { Button, Field, Notice, useUI } from '@/components/ui/Controls';
import { useAuth } from './AuthProvider';
import { authPolicy } from './service';
import type { AuthResult } from './types';

type Mode = 'signin' | 'signup' | 'confirm' | 'reset' | 'resetCode' | 'newPassword';
const titles: Record<Mode, string> = { signin: 'Zaloguj się', signup: 'Utwórz konto', confirm: 'Potwierdź email', reset: 'Reset hasła', resetCode: 'Kod odzyskiwania', newPassword: 'Nowe hasło' };

export default function AuthScreen() {
  const ui = useUI();
  const auth = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [flowEmail, setFlowEmail] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [sent, setSent] = useState<Record<string, number>>({});
  const [now, setNow] = useState(() => Date.now());
  const generation = useRef(0);
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { mounted.current = false; clearInterval(timer); };
  }, []);
  const active: Mode = auth.state.status === 'recovery'
    ? auth.state.phase === 'settingPassword' ? 'newPassword' : 'resetCode' : mode;
  const address = active === 'confirm' || active === 'resetCode' || active === 'newPassword' ? flowEmail : email;
  const mailKey = `${active === 'confirm' || active === 'signup' ? 'signup' : 'reset'}:${address.trim().toLowerCase()}`;
  const remaining = Math.max(0, Math.ceil(((sent[mailKey] ?? 0) + authPolicy.resendIntervalSeconds * 1000 - now) / 1000));
  const markSent = (kind: 'signup' | 'reset', value: string) => {
    const at = Date.now(); setNow(at);
    setSent(previous => ({ ...previous, [`${kind}:${value.trim().toLowerCase()}`]: at }));
  };
  const clearSecrets = () => { setPassword(''); setRepeat(''); setCode(''); };

  async function move(next: Mode) {
    if (cancelling) return;
    generation.current++;
    setNotice(null); auth.clearAccountNotice(); clearSecrets(); setMode(next);
    if (!busy.current && auth.state.status !== 'recovery') return;
    setCancelling(true); setPending(true);
    const current = generation.current;
    const result = await auth.cancelOperation();
    if (!mounted.current || current !== generation.current) return;
    busy.current = false; setPending(false); setCancelling(false);
    if (!result.ok) setNotice(result.error.message);
  }

  async function perform<T>(action: () => Promise<AuthResult<T>>, done: (value: T) => void) {
    if (busy.current) return;
    busy.current = true; setPending(true); setNotice(null); auth.clearAccountNotice();
    const current = ++generation.current;
    try {
      const result = await action();
      if (!mounted.current || current !== generation.current) return;
      if (result.ok) done(result.data);
      else if (result.error.code !== 'cancelled') setNotice(result.error.message);
    } catch {
      if (mounted.current && current === generation.current) setNotice('Nie udało się połączyć. Spróbuj ponownie.');
    } finally {
      if (mounted.current && current === generation.current) { busy.current = false; setPending(false); }
    }
  }

  function validatePassword() {
    if (password.length < authPolicy.minimumPasswordLength) { setNotice('Hasło musi mieć co najmniej 8 znaków.'); return false; }
    if (password !== repeat) { setNotice('Hasła nie są takie same.'); return false; }
    return true;
  }
  const submit = () => {
    if (active === 'signin') return void perform(() => auth.signIn(email, password), result => {
      if (result.status === 'confirmationRequired') { setFlowEmail(result.email); setMode('confirm'); clearSecrets(); setNotice('Wpisz kod potwierdzenia lub wyślij go ponownie.'); }
    });
    if (active === 'signup') {
      if (!validatePassword()) return;
      return void perform(() => auth.signUp(email, password), result => {
        setFlowEmail(result.email); markSent('signup', result.email); setMode('confirm'); clearSecrets(); setNotice('Wysłaliśmy kod potwierdzenia na podany adres.');
      });
    }
    if (active === 'confirm') return void perform(() => auth.verifySignupCode(flowEmail, code), result => {
      if (result.status === 'signInRequired') { setMode('signin'); setEmail(flowEmail); clearSecrets(); setNotice('Email potwierdzony. Zaloguj się hasłem.'); }
    });
    if (active === 'reset') return void perform(() => auth.sendPasswordResetCode(email), () => {
      setFlowEmail(email.trim().toLowerCase()); markSent('reset', email); setMode('resetCode'); clearSecrets(); setNotice('Jeśli konto istnieje, wysłaliśmy kod odzyskiwania hasła.');
    });
    if (active === 'resetCode') return void perform(() => auth.verifyPasswordResetCode(flowEmail, code), () => {
      setMode('newPassword'); clearSecrets(); setNotice('Kod poprawny. Ustaw nowe hasło.');
    });
    if (!validatePassword()) return;
    void perform(() => auth.setNewPassword(password), () => {
      setMode('signin'); setEmail(flowEmail); clearSecrets(); setNotice('Hasło zostało zmienione. Zaloguj się nowym hasłem.');
    });
  };
  const resend = () => {
    if (remaining > 0) return;
    void perform(() => active === 'confirm' ? auth.resendSignupCode(flowEmail) : auth.sendPasswordResetCode(flowEmail), () => {
      markSent(active === 'confirm' ? 'signup' : 'reset', flowEmail);
      setNotice(active === 'confirm' ? 'Kod wysłany ponownie. Sprawdź najnowszą wiadomość.' : 'Jeśli konto istnieje, wysłaliśmy nowy kod odzyskiwania.');
    });
  };
  const label = active === 'signin' ? 'Zaloguj się' : active === 'signup' ? 'Utwórz konto' : active === 'confirm' ? 'Potwierdź konto' : active === 'reset' ? 'Wyślij kod' : active === 'resetCode' ? 'Zweryfikuj kod' : 'Zapisz hasło';
  const showPassword = active === 'signin' || active === 'signup' || active === 'newPassword';
  const showRepeat = active === 'signup' || active === 'newPassword';

  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <AuthShell title={titles[active]} subtitle={active === 'signin' ? 'Zaloguj się, aby korzystać z SMARTCART.' : 'Dokończ operację konta.'}
      footer={<View style={{ gap: 10 }}>
        {active === 'signin' ? <><Button secondary title="Utwórz konto" disabled={cancelling} onPress={() => void move('signup')} /><Button secondary title="Zapomniałem hasła" disabled={cancelling} onPress={() => void move('reset')} /></>
          : <Button secondary title={pending ? 'Anuluj operację' : 'Powrót do logowania'} disabled={cancelling} onPress={() => void move('signin')} />}
      </View>}>
      {active !== 'newPassword' && <Field label="Email" value={address} editable={!pending && active !== 'confirm' && active !== 'resetCode'}
        onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" />}
      {showPassword && <Field label={active === 'newPassword' ? 'Nowe hasło' : 'Hasło'} value={password} onChangeText={setPassword} secureTextEntry editable={!pending} autoCapitalize="none" autoCorrect={false} />}
      {showRepeat && <><Field label="Powtórz hasło" value={repeat} onChangeText={setRepeat} secureTextEntry editable={!pending} autoCapitalize="none" autoCorrect={false} />
        <Text accessibilityLiveRegion="polite" style={ui.muted}>{password.length >= authPolicy.minimumPasswordLength ? '✓ Minimum 8 znaków.' : 'Hasło: minimum 8 znaków.'}{'\n'}{repeat && password === repeat ? '✓ Hasła są takie same.' : 'Powtórz to samo hasło.'}</Text></>}
      {(active === 'confirm' || active === 'resetCode') && <Field label="6-cyfrowy kod" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={authPolicy.codeLength} editable={!pending} autoComplete="one-time-code" />}
      {auth.accountNotice && <Notice>{auth.accountNotice}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      <Button title={cancelling ? 'Kończenie operacji…' : label} busy={pending} disabled={active === 'reset' && remaining > 0} onPress={submit} />
      {(active === 'confirm' || active === 'resetCode') && <>
        <Button secondary title={remaining ? `Wyślij kod ponownie za ${remaining} s` : 'Wyślij kod ponownie'} disabled={pending || remaining > 0} onPress={resend} />
        <Button secondary title="Zmień adres email" disabled={cancelling} onPress={() => { setEmail(flowEmail); void move(active === 'confirm' ? 'signup' : 'reset'); }} />
      </>}
      {active === 'signin' && pending && <Button secondary title="Anuluj operację" disabled={cancelling} onPress={() => void move('signin')} />}
    </AuthShell>
  </KeyboardAvoidingView>;
}
