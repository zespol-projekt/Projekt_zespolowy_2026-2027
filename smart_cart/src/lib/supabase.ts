import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { createSessionStorage, type AuthStorage } from '../features/auth/storage';

const storageKey = `smartcart-${(process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'missing').replace(/[^a-z0-9]/gi, '-')}-auth`;
const browserStorage: AuthStorage = {
  async getItem(key) { return window.localStorage.getItem(key); },
  async setItem(key, value) { window.localStorage.setItem(key, value); },
  async removeItem(key) { window.localStorage.removeItem(key); },
};
export const sessionStorage = createSessionStorage(
  Platform.OS === 'web' ? browserStorage : AsyncStorage,
  storageKey,
);

let client: SupabaseClient | undefined;

/** Jeden klient dla modułu auth. Formularze korzystają z operacji, nie z SDK. */
export function getSupabase(): SupabaseClient | null {
  if (client) return client;

  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || !/^https?:\/\//.test(url)) return null;

  try {
    client = createClient(url, key, {
      auth: {
        storage: sessionStorage,
        storageKey,
        persistSession: true,
        // WWW: widoczność obsługuje SDK. Native: ticker uruchamia AppState po restore.
        autoRefreshToken: Platform.OS === 'web',
        detectSessionInUrl: false,
      },
    });
    return client;
  } catch {
    return null;
  }
}
