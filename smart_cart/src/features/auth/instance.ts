import { AppState, Platform } from 'react-native';
import { getSupabase, sessionStorage } from '../../lib/supabase';
import { createAuthService } from './service';

export const authService = createAuthService(() => getSupabase()?.auth ?? null, {
  storage: sessionStorage,
  lifecycle: Platform.OS === 'web' ? undefined : {
    getState: () => AppState.currentState ?? null,
    subscribe(listener) {
      const subscription = AppState.addEventListener('change', listener);
      return () => subscription.remove();
    },
  },
});
