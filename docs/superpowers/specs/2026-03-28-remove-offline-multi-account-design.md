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

- **Onboarding** (`src/hub/Onboarding.tsx`): Step 3 loses the "Continue without account" button. New flow: Login/Register FIRST, then onboarding (language, character, modules).
- **App.tsx**: If no authenticated user, always redirect to AuthPage. Layout never renders without auth.
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

---

## Section 2: Multi-Account with Firebase Multi-App

### Architecture

#### `accountStore.ts` (new file)

Manages a registry of cached accounts in localStorage under key `hubtify_accounts`.

```ts
interface CachedAccount {
  email: string;
  firebaseAppName: string; // "default" for first, "account-1", "account-2", etc.
  lastUsed: string; // ISO timestamp
}
// localStorage: hubtify_accounts = CachedAccount[]
```

#### `firebase.ts` (modified)

Expose functions to create/get Firebase instances by name. Each account has its own instance with its own auth state persisted automatically by Firebase.

#### `useAuth.ts` (modified)

- `switchAccount(appName)` -- switches active app, `onAuthStateChanged` on new instance already has user logged in (token cached by Firebase).
- `addAccount(email, password)` -- creates new instance, logs in, adds to store, switches.
- `logout()` -- signs out of active account, removes from store, switches to next cached account (or goes to AuthPage if none left).
- `getCachedAccounts()` -- returns list of accounts from store.

#### Sync on switch

On account switch, `syncPush` outgoing account, `syncPull` incoming. Local data (localStorage stats, quests, etc.) overwritten with new account's data.

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
- **Cached accounts:** initial as avatar + email, click = instant switch.
- **"+ Add account":** navigates to AuthPage in "add account" mode.
- **"Sign out" (red):** logout of current account.

### Collapsed sidebar

Arrow and dropdown not accessible. Only character avatar visible.

---

## Approach Decision

Firebase Multi-App instances chosen over manual token caching or native Firebase hacking because:

- Firebase natively supports multiple app instances, each with its own persisted auth state.
- Switch is just changing which instance the app uses.
- No manual token management needed.
- Minimal memory overhead for 2-5 accounts.

---

## Files Affected

| File | Action |
|------|--------|
| `src/hub/Onboarding.tsx` | Remove offline option from step 3, reorder flow |
| `src/hub/AuthPage.tsx` | Remove "Continue offline" button |
| `src/App.tsx` | Force auth before any route |
| `src/hub/Sidebar.tsx` | Remove footer auth section, pass authUser to PlayerCard |
| `src/hub/PlayerCard.tsx` | Add clickable name + dropdown trigger |
| `src/hub/AccountDropdown.tsx` | New -- floating dropdown component |
| `src/shared/firebase.ts` | Add multi-app instance management |
| `src/shared/hooks/useAuth.ts` | Add switchAccount, addAccount, getCachedAccounts |
| `src/shared/accountStore.ts` | New -- cached accounts registry in localStorage |
| `src/shared/sync.ts` | Push/pull on account switch |
| `src/i18n/en.json` | Remove offline keys, add account dropdown keys |
| `src/i18n/es.json` | Remove offline keys, add account dropdown keys |
| `src/shared/AuthContext.tsx` | Expose new multi-account functions |
