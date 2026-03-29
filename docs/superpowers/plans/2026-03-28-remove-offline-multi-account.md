# Remove Offline Mode & Multi-Account Dropdown — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove offline/guest mode, force login, and add multi-account switching via a dropdown in the PlayerCard using Firebase multi-app instances.

**Architecture:** Firebase multi-app instances give each cached account its own auth persistence (scoped by apiKey + appName in IndexedDB). A central `accountStore` in localStorage tracks which accounts are cached. The active app instance is swapped on switch, with Firestore/Auth/Functions getters resolving dynamically. The PlayerCard gets a floating dropdown for account management.

**Tech Stack:** React, Firebase Web SDK v9+, TypeScript, Electron (via window.api IPC)

**Spec:** `docs/superpowers/specs/2026-03-28-remove-offline-multi-account-design.md`

---

## File Structure

| File | Status | Responsibility |
|------|--------|---------------|
| `src/shared/firebase.ts` | Modify | Multi-app instance management, dynamic getters |
| `src/shared/accountStore.ts` | Create | Cached accounts CRUD in localStorage |
| `src/shared/hooks/useAuth.ts` | Modify | Multi-account: switch, add, getCachedAccounts |
| `src/shared/AuthContext.tsx` | Modify | Expose new multi-account functions |
| `src/shared/sync.ts` | Modify | Replace module-level Firestore singleton |
| `src/modules/nutrition/estimate-service.ts` | Modify | Replace module-level Functions/Auth singletons |
| `src/hub/AccountDropdown.tsx` | Create | Floating dropdown component |
| `src/hub/PlayerCard.tsx` | Modify | Clickable title + dropdown trigger |
| `src/hub/Sidebar.tsx` | Modify | Remove footer auth, pass authUser |
| `src/hub/AuthPage.tsx` | Modify | Remove offline button, add addAccount mode |
| `src/hub/Onboarding.tsx` | Modify | Remove auth step (4 steps -> 3) |
| `src/App.tsx` | Modify | Force auth gate, addAccount route |
| `src/i18n/en.json` | Modify | Remove offline keys, add account dropdown keys |
| `src/i18n/es.json` | Modify | Remove offline keys, add account dropdown keys |

---

## Chunk 1: Firebase Multi-App Infrastructure

### Task 1: Refactor firebase.ts for multi-app support

**Files:**
- Modify: `src/shared/firebase.ts:1-16`

- [ ] **Step 1: Rewrite firebase.ts with multi-app management**

Replace the entire file with:

```ts
import { initializeApp, getApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFunctions, type Functions } from 'firebase/functions';
import { getFirestore, type Firestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyAXs0DtXOmjf2bdWce43vKY2fAeNi3hID8",
  authDomain: "hubtify-ab4ab.firebaseapp.com",
  projectId: "hubtify-ab4ab",
  storageBucket: "hubtify-ab4ab.firebasestorage.app",
  messagingSenderId: "792579152721",
  appId: "1:792579152721:web:e7cfe94e831605e3561170"
};

let activeAppName = '[DEFAULT]';

export function getOrCreateApp(name?: string): FirebaseApp {
  const appName = name ?? '[DEFAULT]';
  try {
    return getApp(appName);
  } catch {
    return initializeApp(firebaseConfig, appName === '[DEFAULT]' ? undefined : appName);
  }
}

export function getActiveApp(): FirebaseApp {
  return getOrCreateApp(activeAppName);
}

export function setActiveAppName(name: string): void {
  activeAppName = name;
}

export function getActiveAppName(): string {
  return activeAppName;
}

export function getActiveAuth(): Auth {
  return getAuth(getActiveApp());
}

export function getActiveFirestore(): Firestore {
  return getFirestore(getActiveApp());
}

export function getActiveFunctions(): Functions {
  return getFunctions(getActiveApp());
}

// Initialize default app eagerly
getOrCreateApp();
```

- [ ] **Step 2: Verify file compiles**

Run: `cd E:\code\Hubtify && npx tsc --noEmit src/shared/firebase.ts`

- [ ] **Step 3: Commit**

```bash
git add src/shared/firebase.ts
git commit -m "refactor: firebase.ts to support multi-app instances"
```

---

### Task 2: Create accountStore.ts

**Files:**
- Create: `src/shared/accountStore.ts`

- [ ] **Step 1: Create the account store module**

```ts
export interface CachedAccount {
  uid: string;
  email: string;
  firebaseAppName: string;
  lastUsed: string;
}

const STORAGE_KEY = 'hubtify_accounts';
const MAX_ACCOUNTS = 5;

function readAccounts(): CachedAccount[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeAccounts(accounts: CachedAccount[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
}

export function getCachedAccounts(): CachedAccount[] {
  return readAccounts();
}

export function addCachedAccount(account: Omit<CachedAccount, 'lastUsed'>): void {
  const accounts = readAccounts().filter(a => a.uid !== account.uid);
  accounts.unshift({ ...account, lastUsed: new Date().toISOString() });
  writeAccounts(accounts.slice(0, MAX_ACCOUNTS));
}

export function removeCachedAccount(uid: string): void {
  writeAccounts(readAccounts().filter(a => a.uid !== uid));
}

export function touchAccount(uid: string): void {
  const accounts = readAccounts();
  const idx = accounts.findIndex(a => a.uid === uid);
  if (idx >= 0) {
    accounts[idx].lastUsed = new Date().toISOString();
    writeAccounts(accounts);
  }
}

export function getActiveAccountUid(): string | null {
  const accounts = readAccounts();
  return accounts.length > 0 ? accounts[0].uid : null;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/accountStore.ts
git commit -m "feat: add accountStore for multi-account session caching"
```

---

### Task 3: Update sync.ts to use dynamic Firestore

**Files:**
- Modify: `src/shared/sync.ts:1-5`

- [ ] **Step 1: Replace module-level Firestore import**

Replace lines 1-5:

```ts
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { getFirestore } from 'firebase/firestore';
import { app } from './firebase';

const firestore = getFirestore(app);
```

With:

```ts
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { getActiveFirestore } from './firebase';
```

- [ ] **Step 2: Replace all `firestore` references with `getActiveFirestore()`**

In `syncPush` (line 19), replace:
```ts
const userRef = doc(firestore, 'hubtify_users', uid);
```
With:
```ts
const userRef = doc(getActiveFirestore(), 'hubtify_users', uid);
```

In `syncPull` (line 46), replace:
```ts
const userRef = doc(firestore, 'hubtify_users', uid);
```
With:
```ts
const userRef = doc(getActiveFirestore(), 'hubtify_users', uid);
```

- [ ] **Step 3: Commit**

```bash
git add src/shared/sync.ts
git commit -m "refactor: sync.ts uses dynamic Firestore from active app"
```

---

### Task 4: Update estimate-service.ts to use dynamic getters

**Files:**
- Modify: `src/modules/nutrition/estimate-service.ts:1-6`

- [ ] **Step 1: Replace module-level imports**

Replace lines 1-6:

```ts
import { httpsCallable } from 'firebase/functions';
import { functions, auth } from '../../shared/firebase';

type AiResult = { calories: number; items: Array<{ name: string; calories: number }> };

const estimateNutritionFn = httpsCallable<{ description: string }, AiResult>(functions, 'estimateNutrition');
```

With:

```ts
import { httpsCallable } from 'firebase/functions';
import { getActiveFunctions, getActiveAuth } from '../../shared/firebase';

type AiResult = { calories: number; items: Array<{ name: string; calories: number }> };
```

- [ ] **Step 2: Update the function body**

Replace lines 8-13:

```ts
export async function estimateNutrition(description: string): Promise<AiResult> {
  if (!auth.currentUser) {
    throw new Error('Login required to estimate nutrition');
  }
  const result = await estimateNutritionFn({ description });
  return result.data;
}
```

With:

```ts
export async function estimateNutrition(description: string): Promise<AiResult> {
  if (!getActiveAuth().currentUser) {
    throw new Error('Login required to estimate nutrition');
  }
  const fn = httpsCallable<{ description: string }, AiResult>(getActiveFunctions(), 'estimateNutrition');
  const result = await fn({ description });
  return result.data;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/nutrition/estimate-service.ts
git commit -m "refactor: estimate-service uses dynamic Functions/Auth from active app"
```

---

### Task 5: Rewrite useAuth.ts for multi-account

**Files:**
- Modify: `src/shared/hooks/useAuth.ts:1-79`

- [ ] **Step 1: Rewrite the entire useAuth hook**

Replace the full file with:

```ts
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
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/hooks/useAuth.ts
git commit -m "feat: useAuth supports multi-account switch, add, cached accounts"
```

---

### Task 6: Update AuthContext.tsx

**Files:**
- Modify: `src/shared/AuthContext.tsx:1-28`

- [ ] **Step 1: Expand the context interface**

Replace the full file:

```tsx
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
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/AuthContext.tsx
git commit -m "feat: AuthContext exposes multi-account functions"
```

---

## Chunk 2: Remove Offline Mode

### Task 7: Remove offline button from AuthPage

**Files:**
- Modify: `src/hub/AuthPage.tsx:5-7, 95-105`

- [ ] **Step 1: Add mode prop and back button, remove offline button**

Replace the Props interface and add mode support. Replace full file:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthContext } from '../shared/AuthContext';

interface Props {
  onAuth: () => void;
  mode?: 'default' | 'addAccount';
  onBack?: () => void;
}

export default function AuthPage({ onAuth, mode = 'default', onBack }: Props) {
  const { t } = useTranslation();
  const { login, register, addAccount } = useAuthContext();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setError('');
    setLoading(true);

    try {
      if (mode === 'addAccount') {
        const result = await addAccount(email, password);
        if (result.success) {
          onAuth();
        } else {
          setError(t(result.error ?? 'auth.errors.generic'));
        }
      } else {
        const result = isLogin
          ? await login(email, password)
          : await register(email, password);
        if (result.success) {
          onAuth();
        } else {
          setError(t(result.error ?? 'auth.errors.generic'));
        }
      }
    } catch {
      setError(t('auth.errors.networkError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', background: 'var(--rpg-parchment)',
      backgroundImage: `url(${new URL('../assets/bg.jpg', import.meta.url).href})`,
      backgroundSize: '600px', backgroundRepeat: 'repeat',
    }}>
      <div className="rpg-card" style={{ width: 360, padding: 32 }}>
        <h2 style={{ textAlign: 'center', marginBottom: 4, fontSize: '1.6rem' }}>{t('app.title')}</h2>
        <p style={{ textAlign: 'center', opacity: 0.6, marginBottom: 24, fontSize: '0.9rem' }}>
          {mode === 'addAccount'
            ? t('auth.addAccountDesc')
            : isLogin ? t('auth.welcomeBack') : t('auth.beginAdventure')}
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            type="email"
            placeholder={t('auth.email')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rpg-input"
            style={{ width: '100%' }}
            autoFocus
          />
          <input
            type="password"
            placeholder={t('auth.password')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rpg-input"
            style={{ width: '100%' }}
          />

          {error && (
            <p style={{ color: 'var(--rpg-hp-red)', fontSize: '0.85rem', margin: 0 }}>{error}</p>
          )}

          <button className="rpg-button" type="submit" disabled={loading}
            style={{ width: '100%', padding: '10px', fontSize: '0.9rem', marginTop: 4 }}>
            {loading
              ? t('common.loading')
              : mode === 'addAccount'
                ? t('auth.addAccount')
                : isLogin ? t('auth.enterRealm') : t('auth.createAccount')}
          </button>
        </form>

        {mode !== 'addAccount' && (
          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <button
              onClick={() => { setIsLogin(!isLogin); setError(''); }}
              style={{
                background: 'none', border: 'none', color: 'var(--rpg-gold-dark)',
                cursor: 'pointer', fontSize: '0.85rem', textDecoration: 'underline',
              }}
            >
              {isLogin ? t('auth.noAccount') : t('auth.hasAccount')}
            </button>
          </div>
        )}

        {mode === 'addAccount' && onBack && (
          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <button
              onClick={onBack}
              style={{
                background: 'none', border: 'none', color: 'var(--rpg-ink-light)',
                cursor: 'pointer', fontSize: '0.85rem',
              }}
            >
              {t('common.back')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hub/AuthPage.tsx
git commit -m "feat: AuthPage supports addAccount mode, remove offline button"
```

---

### Task 8: Remove auth step from Onboarding (4 -> 3 steps)

**Files:**
- Modify: `src/hub/Onboarding.tsx:1-233`

- [ ] **Step 1: Rewrite Onboarding without auth step**

Remove all auth-related state (email, password, isLogin, authError, authLoading, handleAuth), remove case 3, change step 2's "continue" button to call `finishOnboarding`, update step indicators from `[0,1,2,3]` to `[0,1,2]`.

Replace full file:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Character from './Character';
import TitleBar from '../shared/components/TitleBar';

interface Props {
  onComplete: () => void;
}

export default function Onboarding({ onComplete }: Props) {
  const { t, i18n } = useTranslation();
  const [step, setStep] = useState(0);
  const [animDir, setAnimDir] = useState<'forward' | 'back'>('forward');

  const finishOnboarding = () => {
    localStorage.setItem('hubtify_onboarded', 'true');
    onComplete();
  };

  const goStep = (target: number) => {
    setAnimDir(target > step ? 'forward' : 'back');
    setStep(target);
  };

  const setLanguage = (lang: string) => {
    i18n.changeLanguage(lang);
    localStorage.setItem('hubtify_lang', lang);
  };

  const animClass = animDir === 'forward' ? 'onboarding-step-forward' : 'onboarding-step-back';

  const stepContent = () => {
    switch (step) {
      case 0:
        return (
          <div key="welcome" className={animClass} style={{ textAlign: 'center' }}>
            <svg width="48" height="48" viewBox="0 0 18 18" fill="none" stroke="var(--rpg-gold)" strokeWidth="1.2" strokeLinecap="round" style={{ marginBottom: 16 }}>
              <path d="M9 2L3 5v4c0 4 3 6 6 7 3-1 6-3 6-7V5L9 2z"/>
              <path d="M7 9l2 2 3-4"/>
            </svg>
            <h2 style={{ fontSize: '1.8rem', marginBottom: 8 }}>Hubtify</h2>
            <p style={{ fontSize: '1rem', opacity: 0.7, marginBottom: 24 }}>
              {t('onboarding.tagline')}
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 24 }}>
              <button className="rpg-button"
                onClick={() => setLanguage('es')}
                style={{ opacity: i18n.language === 'es' ? 1 : 0.5 }}>
                {t('settings.languageEs')}
              </button>
              <button className="rpg-button"
                onClick={() => setLanguage('en')}
                style={{ opacity: i18n.language === 'en' ? 1 : 0.5 }}>
                {t('settings.languageEn')}
              </button>
            </div>
            <button className="rpg-button" onClick={() => goStep(1)}
              style={{ padding: '10px 32px', fontSize: '1rem' }}>
              {t('onboarding.startAdventure')}
            </button>
          </div>
        );

      case 1:
        return (
          <div key="character" className={animClass} style={{ textAlign: 'center' }}>
            <h2 style={{ marginBottom: 16 }}>{t('onboarding.createCharacter')}</h2>
            <Character size={128} canCustomize />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 24 }}>
              <button className="rpg-button" onClick={() => goStep(0)}
                style={{ padding: '8px 20px', opacity: 0.7 }}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M7 1L3 5l4 4"/></svg>
              </button>
              <button className="rpg-button" onClick={() => goStep(2)}
                style={{ padding: '10px 32px', fontSize: '1rem' }}>
                {t('onboarding.continue')}
              </button>
            </div>
          </div>
        );

      case 2:
        return (
          <div key="modules" className={animClass} style={{ textAlign: 'center' }}>
            <h2 style={{ marginBottom: 16 }}>{t('onboarding.yourModules')}</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24, textAlign: 'left' }}>
              {[
                { name: 'Questify', desc: t('onboarding.questifyDesc'), icon: <path d="M14 2l-8 8M6 10l-2 2 2 2 2-2M10.5 5.5l2 2M14 2l2 2-3 3"/> },
                { name: 'Nutrify', desc: t('onboarding.nutriftyDesc'), icon: <><path d="M6 3h6v4c0 2-1.5 3-3 3s-3-1-3-3V3z"/><path d="M9 10v3M6 13h6"/></> },
                { name: 'Coinify', desc: t('onboarding.coinifyDesc'), icon: <><ellipse cx="7" cy="10" rx="5" ry="3"/><path d="M2 10v2c0 1.7 2.2 3 5 3s5-1.3 5-3v-2"/></> },
              ].map((mod) => (
                <div key={mod.name} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 14px', borderRadius: 'var(--rpg-radius)',
                  border: '1px solid var(--rpg-gold-dark)', background: 'rgba(201,168,76,0.06)',
                }}>
                  <svg width="22" height="22" viewBox="0 0 18 18" fill="none" stroke="var(--rpg-gold)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    {mod.icon}
                  </svg>
                  <div>
                    <div style={{ fontFamily: 'Cinzel, serif', fontSize: '0.9rem', fontWeight: 700, color: 'var(--rpg-wood)' }}>{mod.name}</div>
                    <div style={{ fontSize: '0.8rem', opacity: 0.6 }}>{mod.desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button className="rpg-button" onClick={() => goStep(1)}
                style={{ padding: '8px 20px', opacity: 0.7 }}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M7 1L3 5l4 4"/></svg>
              </button>
              <button className="rpg-button" onClick={finishOnboarding}
                style={{ padding: '10px 32px', fontSize: '1rem' }}>
                {t('onboarding.continue')}
              </button>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <TitleBar />
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--rpg-parchment)',
        backgroundImage: `url(${new URL('../assets/bg.jpg', import.meta.url).href})`,
        backgroundSize: '600px', backgroundRepeat: 'repeat',
      }}>
        <div className="rpg-card" style={{ maxWidth: 500, padding: 32, width: '90%', overflow: 'hidden' }}>
          {stepContent()}

          {/* Step indicators */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 20 }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{
                width: 8, height: 8, borderRadius: '50%',
                background: i === step ? 'var(--rpg-gold)' : i < step ? 'var(--rpg-gold-dark)' : 'var(--rpg-parchment-dark)',
                border: '1px solid var(--rpg-gold-dark)',
                transition: 'background 0.3s',
              }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hub/Onboarding.tsx
git commit -m "feat: remove auth step from onboarding (4 steps -> 3)"
```

---

### Task 9: Update App.tsx for auth gate and addAccount route

**Files:**
- Modify: `src/App.tsx:1-58`

- [ ] **Step 1: Rewrite App.tsx**

The key change: onboarding only shows AFTER auth. Auth gate wraps everything. Add `/login/add` route for addAccount mode.

Replace full file:

```tsx
import { useState } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import Layout from './hub/Layout';
import Onboarding from './hub/Onboarding';
import Dashboard from './hub/Dashboard';
import CharacterPage from './hub/CharacterPage';
import AuthPage from './hub/AuthPage';
import SettingsPage from './hub/SettingsPage';
import ErrorBoundary from './shared/components/ErrorBoundary';
import { questsModule } from './modules/quests';
import TaskList from './modules/quests/components/TaskList';
import './modules/quests/styles/quests.css';
import { nutritionModule } from './modules/nutrition';
import Today from './modules/nutrition/components/Today';
import NutritionCharts from './modules/nutrition/components/NutritionCharts';
import NutritionSettings from './modules/nutrition/components/NutritionSettings';
import { financeModule } from './modules/finance';
import FinanceDashboard from './modules/finance/components/FinanceDashboard';
import { useAuthContext } from './shared/AuthContext';

function AuthPageWrapper() {
  const navigate = useNavigate();
  return <AuthPage onAuth={() => navigate('/')} />;
}

function AddAccountPageWrapper() {
  const navigate = useNavigate();
  return <AuthPage mode="addAccount" onAuth={() => navigate('/')} onBack={() => navigate(-1)} />;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuthContext();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const [onboarded, setOnboarded] = useState(() => localStorage.getItem('hubtify_onboarded') === 'true');
  const { user, loading } = useAuthContext();

  // Show loading while Firebase checks auth state
  if (loading) return null;

  // Auth gate: must be logged in first
  if (!user) {
    return (
      <ErrorBoundary>
        <Routes>
          <Route path="/login" element={<AuthPageWrapper />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </ErrorBoundary>
    );
  }

  // Onboarding gate: must complete onboarding after first login
  if (!onboarded) {
    return <Onboarding onComplete={() => setOnboarded(true)} />;
  }

  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="/login/add" element={<AddAccountPageWrapper />} />
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/character" element={<CharacterPage />} />
          <Route path="/quests" element={<TaskList />} />
          <Route path="/nutrition" element={<Today />} />
          <Route path="/nutrition/dashboard" element={<NutritionCharts />} />
          <Route path="/nutrition/settings" element={<NutritionSettings />} />
          <Route path="/finance" element={<FinanceDashboard />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/App.tsx
git commit -m "feat: auth gate in App.tsx, onboarding after login, addAccount route"
```

---

### Task 10: Update i18n files

**Files:**
- Modify: `src/i18n/en.json:252-253, 349-350`
- Modify: `src/i18n/es.json:252-253, 349-350`

- [ ] **Step 1: Remove offline keys and add new keys in en.json**

Remove these lines from the `auth` section (~line 252-253):
```json
"continueOffline": "Continue offline",
"loginForSync": "Login for cloud sync",
```

Remove these lines from the `onboarding` section (~line 349-350):
```json
"continueOffline": "Continue without account",
"offlineWarning": "Your data will only be saved on this device",
```

Add these new keys to the `auth` section:
```json
"addAccount": "Add Account",
"addAccountDesc": "Log in to add another account",
"switchAccount": "Switch Account",
"sessionExpired": "Session expired for {email}. Please log in again.",
```

Add to the `account` section (new):
```json
"account": {
  "addAccount": "Add account",
  "signOut": "Sign out",
  "cached": "Saved accounts"
}
```

- [ ] **Step 2: Same changes in es.json**

Remove the same offline keys. Add:
```json
"addAccount": "Agregar cuenta",
"addAccountDesc": "Iniciá sesión para agregar otra cuenta",
"switchAccount": "Cambiar cuenta",
"sessionExpired": "Sesión expirada para {email}. Iniciá sesión de nuevo.",
```

```json
"account": {
  "addAccount": "Agregar cuenta",
  "signOut": "Cerrar sesión",
  "cached": "Cuentas guardadas"
}
```

- [ ] **Step 3: Commit**

```bash
git add src/i18n/en.json src/i18n/es.json
git commit -m "feat: update i18n - remove offline keys, add account dropdown keys"
```

---

## Chunk 3: Account Dropdown UI

### Task 11: Create AccountDropdown component

**Files:**
- Create: `src/hub/AccountDropdown.tsx`

- [ ] **Step 1: Create the floating dropdown component**

```tsx
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { CachedAccount } from '../shared/accountStore';
import type { AuthUser } from '../shared/hooks/useAuth';

interface Props {
  activeUser: AuthUser;
  cachedAccounts: CachedAccount[];
  onSwitch: (appName: string) => Promise<{ success: boolean; expired?: boolean } | undefined>;
  onLogout: () => void;
  onClose: () => void;
}

export default function AccountDropdown({ activeUser, cachedAccounts, onSwitch, onLogout, onClose }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const [expiredEmail, setExpiredEmail] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const otherAccounts = cachedAccounts.filter(a => a.uid !== activeUser.uid);

  const handleSwitch = async (account: CachedAccount) => {
    const result = await onSwitch(account.firebaseAppName);
    if (result?.expired) {
      setExpiredEmail(account.email);
      setTimeout(() => setExpiredEmail(null), 4000);
    } else {
      onClose();
    }
  };

  return (
    <div ref={ref} className="account-dropdown">
      {/* Expired session toast */}
      {expiredEmail && (
        <div className="account-dropdown__item" style={{ color: '#e74c3c', fontSize: '0.65rem' }}>
          {t('auth.sessionExpired', { email: expiredEmail })}
        </div>
      )}

      {/* Active account */}
      <div className="account-dropdown__item account-dropdown__item--active">
        <div className="account-dropdown__dot" />
        <span className="account-dropdown__email">{activeUser.email}</span>
      </div>

      {/* Cached accounts */}
      {otherAccounts.map((account) => (
        <button
          key={account.uid}
          className="account-dropdown__item account-dropdown__item--switch"
          onClick={() => handleSwitch(account)}
        >
          <div className="account-dropdown__avatar">
            {account.email.charAt(0).toUpperCase()}
          </div>
          <span className="account-dropdown__email">{account.email}</span>
        </button>
      ))}

      {/* Add account */}
      <button
        className="account-dropdown__item account-dropdown__item--add"
        onClick={() => { navigate('/login/add'); onClose(); }}
      >
        <span className="account-dropdown__plus">+</span>
        <span>{t('account.addAccount')}</span>
      </button>

      {/* Sign out */}
      <button
        className="account-dropdown__item account-dropdown__item--logout"
        onClick={() => { onLogout(); onClose(); }}
      >
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M5 1H2v10h3M8 3l3 3-3 3M4 6h7"/>
        </svg>
        <span>{t('account.signOut')}</span>
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Add CSS for the dropdown**

Add to `src/hub/styles/layout.css`:

```css
/* Account dropdown */
.account-dropdown {
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  width: calc(100% - 16px);
  background: rgba(20, 20, 40, 0.95);
  border: 1px solid var(--rpg-gold-dark);
  border-radius: 6px;
  overflow: hidden;
  z-index: 100;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.6);
  margin-top: 4px;
}

.account-dropdown__item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border: none;
  background: none;
  width: 100%;
  text-align: left;
  font-size: 0.7rem;
  color: rgba(255, 255, 255, 0.7);
  cursor: default;
  border-bottom: 1px solid rgba(201, 168, 76, 0.15);
}

.account-dropdown__item:last-child {
  border-bottom: none;
}

.account-dropdown__item--switch,
.account-dropdown__item--add,
.account-dropdown__item--logout {
  cursor: pointer;
}

.account-dropdown__item--switch:hover,
.account-dropdown__item--add:hover {
  background: rgba(201, 168, 76, 0.1);
}

.account-dropdown__item--logout {
  color: #e74c3c;
}

.account-dropdown__item--logout:hover {
  background: rgba(231, 76, 60, 0.1);
}

.account-dropdown__item--add {
  color: var(--rpg-gold);
}

.account-dropdown__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #4a9e3f;
  flex-shrink: 0;
}

.account-dropdown__avatar {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(201, 168, 76, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  color: var(--rpg-gold);
  flex-shrink: 0;
}

.account-dropdown__plus {
  font-size: 12px;
  flex-shrink: 0;
}

.account-dropdown__email {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/hub/AccountDropdown.tsx src/hub/styles/layout.css
git commit -m "feat: AccountDropdown floating component with styles"
```

---

### Task 12: Update PlayerCard with dropdown trigger

**Files:**
- Modify: `src/hub/PlayerCard.tsx:1-60`

- [ ] **Step 1: Add dropdown trigger to PlayerCard**

Replace the full file:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import HpBar from '../shared/components/HpBar';
import XpBar from '../shared/components/XpBar';
import Loading from '../shared/components/Loading';
import Character from './Character';
import AccountDropdown from './AccountDropdown';
import type { PlayerStats } from '../../shared/types';
import type { AuthUser } from '../shared/hooks/useAuth';
import { useAuthContext } from '../shared/AuthContext';

interface PlayerCardProps {
  stats: PlayerStats | null;
  collapsed?: boolean;
}

export default function PlayerCard({ stats, collapsed }: PlayerCardProps) {
  const { t } = useTranslation();
  const { user: authUser, logout, switching, switchAccount, getCachedAccounts } = useAuthContext();
  const [dropdownOpen, setDropdownOpen] = useState(false);

  if (!stats) {
    return <Loading />;
  }

  const hpGlow = stats.hp > 75
    ? '0 0 12px rgba(201, 168, 76, 0.4)'
    : stats.hp > 50
    ? '0 0 8px rgba(45, 90, 39, 0.3)'
    : stats.hp > 25
    ? '0 0 8px rgba(230, 126, 34, 0.3)'
    : '0 0 8px rgba(139, 32, 32, 0.4)';

  return (
    <div className={`player-card ${collapsed ? 'player-card--collapsed' : ''}`} style={{ position: 'relative' }}>
      {/* Avatar — fixed size canvas, scaled with CSS transform */}
      <div className="player-card__avatar-wrap">
        <div className="player-card__avatar-glow" style={{ boxShadow: hpGlow }}>
          <Character size={72} />
        </div>
        {stats.streak > 0 && (
          <div className="player-card__streak">
            <svg width="12" height="12" viewBox="0 0 14 14" fill="#e67e22" style={{ flexShrink: 0 }}>
              <path d="M7 1c-1 1.5-3.5 3.5-3.5 6a3.5 3.5 0 007 0c0-1-.5-1.8-1.3-2.6.4.8.4 1.7-.4 2.6-.9-.9-.9-2.6-1.8-3.5-.4 1.3-.9 2.2-.9 3a1.3 1.3 0 002.6 0c0-.4-.3-1.3-.9-2.2z"/>
            </svg>
            <span className="player-card__streak-text">x{stats.streak}</span>
          </div>
        )}
      </div>

      {/* Level & title */}
      <div className="player-card__info">
        <div className="player-card__level">{t('common.levelPrefix')}{stats.level}</div>
        {!collapsed ? (
          <button
            className="player-card__title player-card__title--clickable"
            onClick={() => setDropdownOpen(!dropdownOpen)}
          >
            {stats.title}
            <svg
              width="10" height="10" viewBox="0 0 10 10" fill="none"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
              style={{ marginLeft: 4, transition: 'transform 0.2s', transform: dropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
            >
              <path d="M3 4l2 2 2-2"/>
            </svg>
          </button>
        ) : (
          <div className="player-card__title">{stats.title}</div>
        )}
      </div>

      {/* Bars */}
      <div className="player-card__bars">
        <HpBar hp={stats.hp} maxHp={stats.maxHp} />
        <XpBar xp={stats.xp} xpToNextLevel={stats.xpToNextLevel} level={stats.level} />
      </div>

      {stats.dailyCombo > 0 && (
        <div className="player-card__combo">
          {t('common.combo')}{[1.0, 1.25, 1.5, 1.75, 2.0][Math.min(stats.dailyCombo, 4)]} ({stats.dailyCombo})
        </div>
      )}

      {/* Switching overlay */}
      {switching && (
        <div style={{
          position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: 'inherit', zIndex: 99,
        }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--rpg-gold)' }}>{t('common.loading')}</span>
        </div>
      )}

      {/* Account dropdown */}
      {dropdownOpen && authUser && !switching && (
        <AccountDropdown
          activeUser={authUser}
          cachedAccounts={getCachedAccounts()}
          onSwitch={switchAccount}
          onLogout={logout}
          onClose={() => setDropdownOpen(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add clickable title CSS**

Add to `src/hub/styles/layout.css`:

```css
/* Clickable title in PlayerCard */
.player-card__title--clickable {
  background: none;
  border: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  padding: 0;
  transition: opacity 0.2s;
}

.player-card__title--clickable:hover {
  opacity: 0.8;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/hub/PlayerCard.tsx src/hub/styles/layout.css
git commit -m "feat: PlayerCard with clickable title and AccountDropdown trigger"
```

---

### Task 13: Update Sidebar — remove footer auth section

**Files:**
- Modify: `src/hub/Sidebar.tsx:104-132`

- [ ] **Step 1: Remove auth section from sidebar footer**

Replace lines 104-132 (the entire `{authUser ? ...}` block) with nothing. The sidebar footer should only keep the version and language toggle.

Replace the `sidebar-footer` div (lines 104-147):

```tsx
      <div className="sidebar-footer">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'space-between' }}>
          {!collapsed && (
            <div style={{ fontSize: '0.7rem', fontFamily: 'Fira Code, monospace', opacity: 0.35 }}>
              v{APP_VERSION}
            </div>
          )}
          <button onClick={() => {
            const newLang = i18n.language === 'es' ? 'en' : 'es';
            i18n.changeLanguage(newLang);
            localStorage.setItem('hubtify_lang', newLang);
          }} style={{ background: 'none', border: 'none', color: 'var(--rpg-gold)', cursor: 'pointer', fontSize: '0.75rem' }}>
            {i18n.language === 'es' ? 'EN' : 'ES'}
          </button>
        </div>
      </div>
```

Also remove the `useAuthContext` import and usage since Sidebar no longer needs it:
- Remove from line 5: `import { useAuthContext } from '../shared/AuthContext';`
- Remove from line 58: `const { user: authUser, logout } = useAuthContext();`

- [ ] **Step 2: Commit**

```bash
git add src/hub/Sidebar.tsx
git commit -m "feat: remove auth section from sidebar footer"
```

---

### Task 14: Final verification

- [ ] **Step 1: TypeScript check**

Run: `cd E:\code\Hubtify && npx tsc --noEmit`

Fix any type errors that arise.

- [ ] **Step 2: Dev server smoke test**

Run: `cd E:\code\Hubtify && npm run dev`

Verify:
- App shows AuthPage on cold start (no user)
- After login, onboarding shows 3 steps (no auth step)
- After onboarding, Layout loads with dropdown in PlayerCard
- Clicking adventurer name opens floating dropdown
- Dropdown shows current account, "Add account", "Sign out"
- Sign out returns to AuthPage
- "Add account" navigates to `/login/add` with back button

- [ ] **Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address type errors and integration issues"
```
