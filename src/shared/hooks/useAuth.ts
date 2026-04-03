import { useState, useEffect, useCallback } from 'react';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  type User,
  type AuthError,
} from 'firebase/auth';
import {
  getOrCreateApp,
  getActiveAuth,
  setActiveAppName,
  getActiveAppName,
} from '../firebase';
import {
  getCachedAccounts as getStoredAccounts,
  addCachedAccount,
  removeCachedAccount,
  touchAccount,
  type CachedAccount,
} from '../accountStore';
import { getAuth } from 'firebase/auth';
import { syncPush, syncPull } from '../sync';

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
}

const firebaseErrorMap: Record<string, string> = {
  'auth/invalid-email': 'auth.errors.invalidEmail',
  'auth/user-not-found': 'auth.errors.userNotFound',
  'auth/wrong-password': 'auth.errors.wrongPassword',
  'auth/invalid-credential': 'auth.errors.invalidCredential',
  'auth/email-already-in-use': 'auth.errors.emailInUse',
  'auth/weak-password': 'auth.errors.weakPassword',
  'auth/too-many-requests': 'auth.errors.tooManyRequests',
  'auth/user-disabled': 'auth.errors.userDisabled',
  'auth/network-request-failed': 'auth.errors.networkError',
};

function getErrorKey(err: unknown): string {
  const code = (err as AuthError)?.code;
  return firebaseErrorMap[code] ?? 'auth.errors.generic';
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [activeAppVersion, setActiveAppVersion] = useState(0);

  // Listen to auth state on the active app — re-subscribes when app changes
  useEffect(() => {
    const auth = getActiveAuth();
    const unsub = onAuthStateChanged(auth, (firebaseUser: User | null) => {
      setUser(firebaseUser ? {
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        displayName: firebaseUser.displayName,
      } : null);
      setLoading(false);
    });
    return unsub;
  }, [activeAppVersion]);

  const login = useCallback(async (email: string, password: string) => {
    try {
      const auth = getActiveAuth();
      const cred = await signInWithEmailAndPassword(auth, email, password);
      addCachedAccount({
        uid: cred.user.uid,
        email: cred.user.email ?? email,
        firebaseAppName: getActiveAppName(),
      });
      await window.api.syncSetCurrentUser(cred.user.uid);
      await syncPull(cred.user.uid);
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: getErrorKey(err) };
    }
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    try {
      const auth = getActiveAuth();
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      addCachedAccount({
        uid: cred.user.uid,
        email: cred.user.email ?? email,
        firebaseAppName: getActiveAppName(),
      });
      await window.api.syncSetCurrentUser(cred.user.uid);
      await syncPull(cred.user.uid);
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: getErrorKey(err) };
    }
  }, []);

  const logout = useCallback(async () => {
    const currentUser = user;
    if (currentUser) {
      removeCachedAccount(currentUser.uid);
    }
    await window.api.syncClearUserData();
    localStorage.removeItem('hubtify_reminders');
    localStorage.removeItem('questify_habits_collapsed');
    localStorage.removeItem('questify_collapsed_projects');
    localStorage.removeItem('hubtify_weight_dismiss_date');
    await signOut(getActiveAuth());

    // Switch to next cached account if available
    const remaining = getStoredAccounts();
    if (remaining.length > 0) {
      const next = remaining[0];
      setActiveAppName(next.firebaseAppName);
      setActiveAppVersion(v => v + 1);
      const nextAuth = getAuth(getOrCreateApp(next.firebaseAppName));
      const nextUser = nextAuth.currentUser;
      if (nextUser) {
        touchAccount(next.uid);
        await window.api.syncSetCurrentUser(next.uid);
        await syncPull(next.uid);
        setUser({
          uid: nextUser.uid,
          email: nextUser.email,
          displayName: nextUser.displayName,
        });
        window.dispatchEvent(new Event('rpg:statsChanged'));
        window.dispatchEvent(new Event('sync:questsUpdated'));
        window.dispatchEvent(new Event('account:switched'));
      } else {
        // Token expired, remove stale account
        removeCachedAccount(next.uid);
        setUser(null);
      }
    } else {
      setUser(null);
    }
  }, [user]);

  const switchAccount = useCallback(async (appName: string) => {
    if (!user) return;
    setSwitching(true);
    try {
      // Push current account data
      await syncPush(user.uid);
      await window.api.syncClearUserData();

      // Switch to target app
      setActiveAppName(appName);
      setActiveAppVersion(v => v + 1);
      const targetAuth = getAuth(getOrCreateApp(appName));
      const targetUser = targetAuth.currentUser;

      if (!targetUser) {
        // Token expired — remove from store
        const accounts = getStoredAccounts();
        const stale = accounts.find(a => a.firebaseAppName === appName);
        if (stale) removeCachedAccount(stale.uid);
        // Restore original app
        const currentAccount = getStoredAccounts()[0];
        if (currentAccount) {
          setActiveAppName(currentAccount.firebaseAppName);
        }
        return { success: false, expired: true };
      }

      // Pull new account data
      touchAccount(targetUser.uid);
      await window.api.syncSetCurrentUser(targetUser.uid);
      await syncPull(targetUser.uid);

      setUser({
        uid: targetUser.uid,
        email: targetUser.email,
        displayName: targetUser.displayName,
      });

      window.dispatchEvent(new Event('rpg:statsChanged'));
      window.dispatchEvent(new Event('sync:questsUpdated'));
      window.dispatchEvent(new Event('account:switched'));

      return { success: true };
    } finally {
      setSwitching(false);
    }
  }, [user]);

  const addAccount = useCallback(async (email: string, password: string) => {
    // Create a new Firebase app instance for this account
    const newAppName = `account-${Date.now()}`;
    const newApp = getOrCreateApp(newAppName);
    const newAuth = getAuth(newApp);

    try {
      const cred = await signInWithEmailAndPassword(newAuth, email, password);
      addCachedAccount({
        uid: cred.user.uid,
        email: cred.user.email ?? email,
        firebaseAppName: newAppName,
      });

      // Switch to the new account
      if (user) {
        await syncPush(user.uid);
        await window.api.syncClearUserData();
      }

      setActiveAppName(newAppName);
      setActiveAppVersion(v => v + 1);
      touchAccount(cred.user.uid);
      await window.api.syncSetCurrentUser(cred.user.uid);
      await syncPull(cred.user.uid);

      setUser({
        uid: cred.user.uid,
        email: cred.user.email,
        displayName: cred.user.displayName,
      });

      window.dispatchEvent(new Event('rpg:statsChanged'));
      window.dispatchEvent(new Event('sync:questsUpdated'));
      window.dispatchEvent(new Event('account:switched'));

      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: getErrorKey(err) };
    }
  }, [user]);

  const getCachedAccounts = useCallback((): CachedAccount[] => {
    return getStoredAccounts();
  }, []);

  return { user, loading, switching, login, register, logout, switchAccount, addAccount, getCachedAccounts };
}
