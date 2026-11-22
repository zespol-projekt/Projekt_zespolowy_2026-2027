import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { useColorScheme } from 'react-native';
import { darkColors, lightColors, parsePreference, type ThemeColors, type ThemePreference } from './palette';

const STORAGE_KEY = 'smartcart.theme.v1';
type Theme = { preference: ThemePreference; dark: boolean; colors: ThemeColors; ready: boolean; error: string | null; setPreference(value: ThemePreference): void };
const Context = createContext<Theme | null>(null);
export function ThemeProvider({ children }: PropsWithChildren) {
  const system = useColorScheme();
  const [preference, setValue] = useState<ThemePreference>('system');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const writes = useRef(Promise.resolve());
  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(STORAGE_KEY).then(value => { if (active) setValue(parsePreference(value)); })
      .catch(() => { if (active) setError('Nie udało się odczytać zapisanego motywu.'); })
      .finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, []);
  const dark = preference === 'dark' || (preference === 'system' && system === 'dark');
  const value = useMemo<Theme>(() => ({ preference, dark, ready, error, colors: dark ? darkColors : lightColors,
    setPreference(next) {
      if (!ready) return;
      setValue(next); setError(null);
      writes.current = writes.current.then(() => AsyncStorage.setItem(STORAGE_KEY, next))
        .catch(() => { setError('Motyw działa, ale nie udało się zapamiętać wyboru. Wybierz go ponownie.'); });
    },
  }), [preference, dark, ready, error]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useTheme() {
  const value = useContext(Context);
  if (!value) throw new Error('Brak ThemeProvider.');
  return value;
}
