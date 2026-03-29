import { createContext, useContext, type ReactNode } from 'react';
import { useAuth, type AuthUser } from './hooks/useAuth';
import type { CachedAccount } from './accountStore';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  switching: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  switchAccount: (appName: string) => Promise<{ success: boolean; expired?: boolean } | undefined>;
  addAccount: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  getCachedAccounts: () => CachedAccount[];
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  switching: false,
  login: async () => ({ success: false }),
  register: async () => ({ success: false }),
  logout: async () => {},
  switchAccount: async () => ({ success: false }),
  addAccount: async () => ({ success: false }),
  getCachedAccounts: () => [],
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

export function useAuthContext() {
  return useContext(AuthContext);
}
