# Remove Offline Mode & Multi-Account Dropdown

**Date:** 2026-03-28
**Status:** Design Spec

## Overview

Three interconnected changes:

1. Remove offline/guest mode entirely -- login is mandatory
2. Replace the logout button in sidebar footer with an account dropdown in the PlayerCard
3. Support multi-account session caching via Firebase multi-app instances for instant switching

---

## Section 1: Remove Offline Mode

### What changes

- **Onboarding** (`src/hub/Onboarding.tsx`): The entire auth step (current step 3) is removed. Onboarding goes from 4 steps to 3: (0) language, (1) character, (2) modules. Step indicators change from 4 dots to 3. All auth logic in Onboarding.tsx is deleted.
- **App.tsx**: If no authenticated user, always show AuthPage. Layout never renders without auth.
- **AuthPage.tsx**: Remove the "Continue offline" button.
- **Sidebar.tsx**: Remove the `else` branch that shows "Login for sync" button (unauthenticated state no longer exists).
- **i18n** (`en.json`, `es.json`): Remove keys `continueOffline`, `offlineWarning`, `loginForSync`.

### New startup flow

```
App opens -> Authenticated user?
  -> NO  -> AuthPage (login/register) -> Onboarded? -> NO -> Onboarding (language, character, modules) -> Layout
  -> YES -> Onboarded? -> NO -> Onboarding -> Layout
  -> YES -> Layout
```

`hubtify_onboarded` remains a per-installation flag (not per-account). Onboarding is a UI walkthrough, not user data.

---

## Section 2: Multi-Account with Firebase Multi-App

### Architecture

#### `accountStore.ts` (new file)

Manages a registry of cached accounts in localStorage under key `hubtify_accounts`.

```ts
interface CachedAccount {
  uid: string;
  email: string;
  firebaseAppName: string; // "default" for first, "account-1", "account-2", etc.
  lastUsed: string; // ISO timestamp
}
// localStorage: hubtify_accounts = CachedAccount[]
```

#### `firebase.ts` (modified)

Expose functions to create/get Firebase instances by name. Each account has its own `FirebaseApp` instance. Firebase Web SDK (v9+) scopes IndexedDB auth persistence by `apiKey + appName`, so each named app maintains an independent auth session.

```ts
// getOrCreateApp(name?: string): FirebaseApp
// getActiveApp(): FirebaseApp
// setActiveApp(name: string): void
```

#### `useAuth.ts` (modified)

- `switchAccount(appName)` -- switches active app. Sets up `onAuthStateChanged` on the new instance. If the listener fires with `null` (token expired/revoked), the account is removed from the store and a toast prompts re-login.
- `addAccount(email, password)` -- creates new instance, logs in, adds to store, switches.
- `logout()` -- signs out of active account, removes from store, switches to next cached account (or goes to AuthPage if none left).
- `getCachedAccounts()` -- returns list of accounts from store.

The `user` state updates reactively when `switchAccount` changes the active app, triggering re-renders in `Layout.tsx` and downstream consumers.

#### Token expiry handling

When `switchAccount` is called and `onAuthStateChanged` fires with `null` for a cached account (token expired or revoked server-side):
1. Remove the account from the cached accounts store
2. Show a toast: "Session expired for {email}. Please log in again."
3. If other cached accounts remain, stay on current account
4. If no accounts remain, redirect to AuthPage

#### Firestore singleton problem

`sync.ts` and `estimate-service.ts` currently import `app` at module level and call `getFirestore(app)`. After multi-app, these stale references would point to the wrong Firestore instance.

**Fix:** Replace module-level Firestore singletons with a getter that retrieves Firestore from the currently active app:

```ts
// firebase.ts exports:
export function getActiveFirestore(): Firestore {
  return getFirestore(getActiveApp());
}
export function getActiveAuth(): Auth {
  return getAuth(getActiveApp());
}
export function getActiveFunctions(): Functions {
  return getFunctions(getActiveApp());
}

// sync.ts, estimate-service.ts use:
import { getActiveFirestore } from './firebase';
// then per-call: const firestore = getActiveFirestore();
```

#### Data swap on account switch

Explicit sequence when switching from Account A to Account B:

1. `syncPush(accountA.uid)` -- save outgoing account's data
2. Clear local user data (stats, quests, nutrition, etc.)
3. Set active Firebase app to Account B's instance
4. `syncPull(accountB.uid)` -- load incoming account's data

A loading spinner overlay is shown during the switch to prevent stale data flash.

If `syncPull` fails after `syncPush` succeeded, show an error toast and retry `syncPull`. Do not roll back the push.

#### Sync uid source

`Layout.tsx` gets `authUser` from `useAuthContext()`. After multi-app, `useAuth` exposes the active app's user. When `switchAccount` changes the active app, the `user` state updates, `Layout.tsx` re-renders, and sync calls use the correct uid via the existing `useEffect` dependency on `authUser`.

#### Limit

Maximum 5 cached accounts.

---

## Section 3: Account Dropdown in PlayerCard

### Components

#### `AccountDropdown.tsx` (new)

Floating dropdown component. Receives cached accounts list, active account, and callbacks for switch/add/logout. Positioned with `position: absolute` relative to PlayerCard. Click outside closes it.

#### `PlayerCard.tsx` (modified)

- Receives `authUser` as prop (email).
- Adventure title (`stats.title`) is now clickable with a down arrow next to it.
- Click on name toggles AccountDropdown.
- PlayerCard wrapper needs `position: relative` to anchor dropdown.

#### `Sidebar.tsx` (modified)

- Remove entire footer section showing email/logout/login.
- Pass `authUser` to PlayerCard.
- Footer remains with only version + language toggle.

### Dropdown behavior

- **Active account:** email with green dot, not clickable.
- **Cached accounts:** initial as avatar + email, click = instant switch (with loading spinner during swap).
- **"+ Add account":** navigates to AuthPage in "add account" mode.
- **"Sign out" (red):** logout of current account.

### "Add account" mode for AuthPage

`AuthPage` receives an optional `mode` prop: `'default' | 'addAccount'`.

- Navigate via `/login?mode=add`
- In `addAccount` mode, successful auth calls `addAccount()` on a new Firebase instance instead of the normal login flow
- After success, navigates back to Layout (does NOT trigger onboarding)
- Shows a "Back" button to cancel and return to Layout

### Collapsed sidebar

Arrow and dropdown not accessible. Only character avatar visible. User must expand sidebar to access account switching. The sidebar collapse toggle remains accessible in collapsed state (existing behavior).

---

## Approach Decision

Firebase Multi-App instances chosen over manual token caching or native Firebase hacking because:

- Firebase natively supports multiple app instances, each with independently scoped IndexedDB auth persistence.
- Switch is just changing which instance the app uses.
- No manual token management needed -- Firebase handles refresh tokens per instance.
- Minimal memory overhead for 2-5 accounts.

---

## Files Affected

| File | Action |
|------|--------|
| `src/hub/Onboarding.tsx` | Remove auth step entirely (4 steps -> 3), delete auth logic |
| `src/hub/AuthPage.tsx` | Remove "Continue offline" button, add `mode` prop for addAccount |
| `src/App.tsx` | Force auth before any route |
| `src/hub/Sidebar.tsx` | Remove footer auth section, pass authUser to PlayerCard |
| `src/hub/PlayerCard.tsx` | Add clickable name + dropdown trigger |
| `src/hub/AccountDropdown.tsx` | New -- floating dropdown component |
| `src/shared/firebase.ts` | Add multi-app instance management, `getActiveFirestore()` |
| `src/shared/hooks/useAuth.ts` | Add switchAccount, addAccount, getCachedAccounts, token expiry handling |
| `src/shared/accountStore.ts` | New -- cached accounts registry in localStorage |
| `src/shared/sync.ts` | Replace module-level Firestore with `getActiveFirestore()`, push/pull on switch |
| `src/modules/nutrition/estimate-service.ts` | Replace module-level Functions/Auth with `getActiveFunctions()`, `getActiveAuth()` |
| `src/i18n/en.json` | Remove offline keys, add account dropdown keys |
| `src/i18n/es.json` | Remove offline keys, add account dropdown keys |
| `src/shared/AuthContext.tsx` | Expose new multi-account functions |
