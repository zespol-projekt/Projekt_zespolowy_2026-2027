import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type PropsWithChildren } from 'react';
import { authService } from './instance';
import type { AuthContextValue, AuthState } from './types';
import { clearDestination } from './navigation';

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const initialState: AuthState = { status: 'initializing' };

export function AuthProvider({ children }: PropsWithChildren) {
  const [accountNotice, setAccountNotice] = useState<string | null>(null);
  const state = useSyncExternalStore(authService.subscribe, authService.getState, () => initialState);
  useEffect(() => authService.start(), []);

  const value = useMemo<AuthContextValue>(() => ({
    state,
    accountNotice,
    clearAccountNotice: () => setAccountNotice(null),
    signUp: authService.signUp,
    verifySignupCode: authService.verifySignupCode,
    resendSignupCode: authService.resendSignupCode,
    signIn: authService.signIn,
    sendPasswordResetCode: authService.sendPasswordResetCode,
    verifyPasswordResetCode: authService.verifyPasswordResetCode,
    setNewPassword: authService.setNewPassword,
    signOut: async () => {
      clearDestination(); setAccountNotice(null);
      const result = await authService.signOut();
      if (!result.ok) setAccountNotice(result.error.message);
      return result;
    },
    cancelOperation: authService.cancelOperation,
    retrySession: authService.retrySession,
  }), [state, accountNotice]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth wymaga nadrzędnego AuthProvider.');
  return context;
}
