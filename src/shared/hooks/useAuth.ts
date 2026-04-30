import { useState, useEffect, useCallback } from 'react';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
  updateProfile,
  type User,
  type AuthError,
} from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import {
  getOrCreateApp,
  getActiveAuth,
  getActiveFirestore,
  getAuthWithPersistence,
  setActiveAppName,
  getActiveAppName,
  waitForAuthReady,
} from '../firebase';
import {
  getCachedAccounts as getStoredAccounts,
  addCachedAccount,
  removeCachedAccount,
  touchAccount,
  type CachedAccount,
} from '../accountStore';
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
  'auth/username-taken': 'auth.errors.usernameTaken',
  'auth/weak-password': 'auth.errors.weakPassword',
  'auth/too-many-requests': 'auth.errors.tooManyRequests',
  'auth/user-disabled': 'auth.errors.userDisabled',
  'auth/network-request-failed': 'auth.errors.networkError',
};

function getErrorKey(err: unknown): string {
  const code = (err as AuthError)?.code;
  if (code) return firebaseErrorMap[code] ?? 'auth.errors.generic';
  const msg = (err as Error)?.message;
  if (msg === 'usernameNotFound') return 'auth.errors.usernameNotFound';
  return 'auth.errors.generic';
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

  const login = useCallback(async (identifier: string, password: string) => {
    try {
      let email = identifier;

      // If identifier doesn't contain @, treat as username
      if (!identifier.includes('@')) {
        const db = getActiveFirestore();
        const usernameDoc = await getDoc(doc(db, 'usernames', identifier.toLowerCase()));
        if (!usernameDoc.exists()) {
          throw new Error('usernameNotFound');
        }
        email = usernameDoc.data().email;
      }

      const auth = getActiveAuth();
      const cred = await signInWithEmailAndPassword(auth, email, password);
      addCachedAccount({
        uid: cred.user.uid,
        email: cred.user.email ?? email,
        firebaseAppName: getActiveAppName(),
        username: cred.user.displayName ?? undefined,
      });
      await window.api.syncSetCurrentUser(cred.user.uid);
      await syncPull(cred.user.uid);
      window.dispatchEvent(new Event('rpg:statsChanged'));
      window.dispatchEvent(new Event('sync:questsUpdated'));
      window.dispatchEvent(new Event('sync:nutritionUpdated'));
      window.dispatchEvent(new Event('sync:cauldronUpdated'));
      window.dispatchEvent(new Event('account:switched'));
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: getErrorKey(err) };
    }
  }, []);

  const register = useCallback(async (email: string, password: string, username?: string) => {
    try {
      const auth = getActiveAuth();
      const db = getActiveFirestore();

      // Check username availability before creating account
      if (username) {
        const usernameDoc = await getDoc(doc(db, 'usernames', username.toLowerCase()));
        if (usernameDoc.exists()) {
          throw { code: 'auth/username-taken' } as AuthError;
        }
      }

      const cred = await createUserWithEmailAndPassword(auth, email, password);

      if (username) {
        await updateProfile(cred.user, { displayName: username });
        await setDoc(doc(db, 'usernames', username.toLowerCase()), {
          email: email.toLowerCase(),
          uid: cred.user.uid,
        });
        await window.api.characterSetUsername(username);
      }

      addCachedAccount({
        uid: cred.user.uid,
        email: cred.user.email ?? email,
        firebaseAppName: getActiveAppName(),
        username: username ?? undefined,
      });
      await window.api.syncSetCurrentUser(cred.user.uid);
      // New account — syncPull may fail (no Firestore doc yet, or rules delay).
      // Registration is already successful at this point; don't let sync break it.
      try { await syncPull(cred.user.uid); } catch { /* best effort */ }
      return { success: true };
    } catch (err: unknown) {
      console.error('[register] failed:', err);
      return { success: false, error: getErrorKey(err) };
    }
  }, []);

  const logout = useCallback(async () => {
    const currentUser = user;

    // Push local data to cloud BEFORE signing out — prevents data loss
    if (currentUser) {
      window.dispatchEvent(new Event('sync:cancelPush'));
      try { await syncPush(currentUser.uid); } catch { /* best effort */ }
    }

    await signOut(getActiveAuth());

    if (currentUser) {
      removeCachedAccount(currentUser.uid);
    }
    await window.api.syncClearUserData();
    localStorage.removeItem('hubtify_reminders');
    localStorage.removeItem('questify_habits_collapsed');
    localStorage.removeItem('questify_collapsed_projects');
    localStorage.removeItem('hubtify_weight_dismiss_date');
    localStorage.removeItem('hubtify_last_pull_at');

    // Switch to next cached account if available
    const remaining = getStoredAccounts();
    if (remaining.length > 0) {
      const next = remaining[0];
      setActiveAppName(next.firebaseAppName);
      setActiveAppVersion(v => v + 1);
      const nextAuth = await waitForAuthReady(next.firebaseAppName);
      const nextUser = nextAuth.currentUser;
      if (nextUser) {
        touchAccount(next.uid);
        await window.api.syncSetCurrentUser(next.uid);
        try {
          await syncPull(next.uid);
        } catch {
          // Pull failed — go to logged out state instead of leaving empty DB
          console.error('[logout] Pull for next account failed, going to logged out state');
          setUser(null);
          return;
        }
        setUser({
          uid: nextUser.uid,
          email: nextUser.email,
          displayName: nextUser.displayName,
        });
        window.dispatchEvent(new Event('rpg:statsChanged'));
        window.dispatchEvent(new Event('sync:questsUpdated'));
        window.dispatchEvent(new Event('sync:nutritionUpdated'));
        window.dispatchEvent(new Event('sync:cauldronUpdated'));
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
      // Validate target account BEFORE clearing any data — await persistence load
      const targetAuth = await waitForAuthReady(appName);
      const targetUser = targetAuth.currentUser;

      if (!targetUser) {
        // Token expired — remove stale account, no data was touched
        const accounts = getStoredAccounts();
        const stale = accounts.find(a => a.firebaseAppName === appName);
        if (stale) removeCachedAccount(stale.uid);
        return { success: false, expired: true };
      }

      // Target is valid — now safe to push and clear current data
      window.dispatchEvent(new Event('sync:cancelPush'));
      await syncPush(user.uid);
      await window.api.syncClearUserData();

      // Switch to target app
      setActiveAppName(appName);
      setActiveAppVersion(v => v + 1);

      // Pull new account data — rollback on failure
      touchAccount(targetUser.uid);
      await window.api.syncSetCurrentUser(targetUser.uid);
      try {
        await syncPull(targetUser.uid);
      } catch {
        // Rollback: restore original user's data
        console.error('[switchAccount] Pull failed, rolling back to original user');
        setActiveAppName(user.uid); // Won't match but we restore data below
        await window.api.syncSetCurrentUser(user.uid);
        await syncPull(user.uid);
        return { success: false, error: 'auth.errors.switchFailed' };
      }

      setUser({
        uid: targetUser.uid,
        email: targetUser.email,
        displayName: targetUser.displayName,
      });

      window.dispatchEvent(new Event('rpg:statsChanged'));
      window.dispatchEvent(new Event('sync:questsUpdated'));
      window.dispatchEvent(new Event('sync:nutritionUpdated'));
      window.dispatchEvent(new Event('sync:cauldronUpdated'));
      window.dispatchEvent(new Event('account:switched'));

      return { success: true };
    } catch (err) {
      console.error('Failed to switch account:', err);
      return { success: false, error: 'auth.errors.switchFailed' };
    } finally {
      setSwitching(false);
    }
  }, [user]);

  const addAccount = useCallback(async (identifier: string, password: string) => {
    // Resolve username to email if needed
    let email = identifier;
    if (!identifier.includes('@')) {
      const db = getActiveFirestore();
      const usernameDoc = await getDoc(doc(db, 'usernames', identifier.toLowerCase()));
      if (!usernameDoc.exists()) {
        return { success: false, error: 'auth.errors.usernameNotFound' };
      }
      email = usernameDoc.data().email;
    }

    // Create a new Firebase app instance for this account
    const newAppName = `account-${Date.now()}`;
    const newApp = getOrCreateApp(newAppName);
    const newAuth = getAuthWithPersistence(newApp);

    try {
      const cred = await signInWithEmailAndPassword(newAuth, email, password);
      addCachedAccount({
        uid: cred.user.uid,
        email: cred.user.email ?? email,
        firebaseAppName: newAppName,
        username: cred.user.displayName ?? undefined,
      });

      // Switch to the new account
      const previousUid = user?.uid;
      const previousAppName = user ? getActiveAppName() : null;
      if (user) {
        window.dispatchEvent(new Event('sync:cancelPush'));
        await syncPush(user.uid);
        await window.api.syncClearUserData();
      }

      setActiveAppName(newAppName);
      setActiveAppVersion(v => v + 1);
      touchAccount(cred.user.uid);
      await window.api.syncSetCurrentUser(cred.user.uid);

      try {
        await syncPull(cred.user.uid);
      } catch {
        // Rollback: restore original user's data if we had one
        if (previousUid && previousAppName) {
          console.error('[addAccount] Pull failed, rolling back to original user');
          setActiveAppName(previousAppName);
          setActiveAppVersion(v => v + 1);
          await window.api.syncSetCurrentUser(previousUid);
          await syncPull(previousUid);
        }
        return { success: false, error: 'auth.errors.switchFailed' };
      }

      setUser({
        uid: cred.user.uid,
        email: cred.user.email,
        displayName: cred.user.displayName,
      });

      window.dispatchEvent(new Event('rpg:statsChanged'));
      window.dispatchEvent(new Event('sync:questsUpdated'));
      window.dispatchEvent(new Event('sync:nutritionUpdated'));
      window.dispatchEvent(new Event('sync:cauldronUpdated'));
      window.dispatchEvent(new Event('account:switched'));

      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: getErrorKey(err) };
    }
  }, [user]);

  const forgotPassword = useCallback(async (email: string) => {
    try {
      const auth = getActiveAuth();
      await sendPasswordResetEmail(auth, email);
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: getErrorKey(err) };
    }
  }, []);

  const getCachedAccounts = useCallback((): CachedAccount[] => {
    return getStoredAccounts();
  }, []);

  return { user, loading, switching, login, register, logout, switchAccount, addAccount, forgotPassword, getCachedAccounts };
}
