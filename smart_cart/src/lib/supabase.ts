import 'react-native-url-polyfill/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

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
        // Trwałe przechowywanie i cykl życia sesji dodaje punkt 4.
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    return client;
  } catch {
    return null;
  }
}
