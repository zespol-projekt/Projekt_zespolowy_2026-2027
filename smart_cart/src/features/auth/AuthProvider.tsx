import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type PropsWithChildren } from 'react';
import { authService } from './instance';
import type { AuthContextValue, AuthState } from './types';

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const initialState: AuthState = { status: 'initializing' };

export function AuthProvider({ children }: PropsWithChildren) {
  const state = useSyncExternalStore(authService.subscribe, authService.getState, () => initialState);
  useEffect(() => authService.start(), []);

  const value = useMemo<AuthContextValue>(() => ({
    state,
    signUp: authService.signUp,
    verifySignupCode: authService.verifySignupCode,
    resendSignupCode: authService.resendSignupCode,
    signIn: authService.signIn,
    sendPasswordResetCode: authService.sendPasswordResetCode,
    verifyPasswordResetCode: authService.verifyPasswordResetCode,
    setNewPassword: authService.setNewPassword,
    signOut: authService.signOut,
    retrySession: authService.retrySession,
  }), [state]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth wymaga nadrzędnego AuthProvider.');
  return context;
}
