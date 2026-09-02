import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useAuth, type AuthUser } from './hooks/useAuth';
import type { CachedAccount } from './accountStore';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  switching: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (email: string, password: string, username?: string) => Promise<{ success: boolean; error?: string }>;
  /**
   * `logout(force)` resolves `{ success:false, pushFailed:true }` and changes
   * NOTHING when the pre-logout sync push failed (offline / Firestore down).
   * The UI must then confirm with the user and retry with `logout(true)`.
   */
  logout: (force?: boolean) => Promise<{ success: boolean; pushFailed?: boolean; error?: string }>;
  switchAccount: (appName: string) => Promise<{ success: boolean; expired?: boolean } | undefined>;
  addAccount: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  forgotPassword: (identifier: string) => Promise<{ success: boolean; error?: string }>;
  getCachedAccounts: () => CachedAccount[];
}

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  switching: false,
  login: async () => ({ success: false }),
  register: async () => ({ success: false }),
  logout: async () => ({ success: false }),
  switchAccount: async () => ({ success: false }),
  addAccount: async () => ({ success: false }),
  forgotPassword: async () => ({ success: false }),
  getCachedAccounts: () => [],
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const {
    user, loading, switching, login, register, logout,
    switchAccount, addAccount, forgotPassword, getCachedAccounts,
  } = auth;
  // useAuth() returns a fresh object literal on every render, which gave the
  // context value a new identity and re-rendered every consumer. Pin the
  // identity to the actual data: it only changes when a member changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const value = useMemo(() => auth, [
    user, loading, switching, login, register, logout,
    switchAccount, addAccount, forgotPassword, getCachedAccounts,
  ]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext() {
  return useContext(AuthContext);
}
