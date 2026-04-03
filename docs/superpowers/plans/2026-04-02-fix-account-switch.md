# Fix Account Switch — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make account switching fully functional — clear all user data, push/pull complete finance data, and refresh all UI modules after switch.

**Architecture:** Complete the existing sync architecture by (1) adding missing tables to USER_DATA_TABLES, (2) creating a new `sync:getAllFinanceData` IPC handler to export all finance data, (3) adding a `sync:mergeFinanceData` handler to restore it, (4) expanding syncPush/syncPull to include full finance, (5) using Firestore subcollection for finance to avoid 1MB limit, (6) dispatching a universal `account:switched` event that all modules listen to.

**Tech Stack:** React 19, TypeScript, better-sqlite3, Electron IPC, Firebase Firestore (subcollections), i18next.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `electron/modules/sync.ipc.ts` | Add missing tables to USER_DATA_TABLES, add `sync:getAllFinanceData` and `sync:mergeFinanceData` handlers |
| Modify | `electron/preload.ts` | Expose new IPC bridges |
| Modify | `shared/types.ts` | Add types for new IPC methods |
| Modify | `src/shared/sync.ts` | Expand push/pull with finance subcollection |
| Modify | `src/shared/hooks/useAuth.ts` | Dispatch `account:switched` event instead of individual events |
| Modify | `src/hub/Layout.tsx` | Listen for `account:switched` |
| Modify | `src/modules/quests/components/TaskList.tsx` | Add `account:switched` listener |
| Modify | `src/modules/quests/components/HabitTracker.tsx` | Add `account:switched` listener |
| Modify | `src/modules/quests/components/QuestsDashboardWidget.tsx` | Add `account:switched` listener |
| Modify | `src/modules/nutrition/components/Today.tsx` | Add `account:switched` listener |
| Modify | `src/modules/finance/components/Transactions.tsx` | Add `account:switched` listener |
| Modify | `src/modules/finance/components/Installments.tsx` | Add `account:switched` listener |
| Modify | `src/modules/finance/components/Loans.tsx` | Add `account:switched` listener |
| Modify | `src/modules/finance/components/Recurring.tsx` | Add `account:switched` listener |
| Modify | `src/modules/finance/components/Dashboard.tsx` | Add `account:switched` listener |

---

## Chunk 1: Backend — Complete USER_DATA_TABLES and add finance sync handlers

### Task 1: Add missing tables to USER_DATA_TABLES

**Files:**
- Modify: `electron/modules/sync.ipc.ts:88-111`

- [ ] **Step 1: Add the missing finance tables**

Add these entries to the `USER_DATA_TABLES` array, after `'dollar_cache'`:

```typescript
const USER_DATA_TABLES = [
  'player_stats',
  'rpg_events',
  'user_profile',
  'character_data',
  'tasks',
  'subtasks',
  'task_categories',
  'projects',
  'task_drawings',
  'habits',
  'habit_checks',
  'finance_transactions',
  'finance_loans',
  'finance_categories',
  'nutrition_profile',
  'food_log',
  'frequent_foods',
  'nutrition_daily_metrics',
  'nutrition_weekly_metrics',
  'nutrition_daily_summary',
  'nutrition_daily_closed',
  'dollar_cache',
  // Finance tables previously missing
  'finance_recurring',
  'finance_recurring_amount_history',
  'finance_installment_groups',
  'finance_loan_payments',
  'finance_category_mappings',
  'finance_import_batches',
  'finance_credit_cards',
  'finance_credit_card_statements',
];
```

- [ ] **Step 2: Commit**

```bash
git add electron/modules/sync.ipc.ts
git commit -m "fix(sync): add missing finance tables to USER_DATA_TABLES"
```

---

### Task 2: Add sync:getAllFinanceData IPC handler

**Files:**
- Modify: `electron/modules/sync.ipc.ts` (add after existing handlers)

- [ ] **Step 1: Add the handler**

Add before the closing `}` of `registerSyncIpcHandlers`:

```typescript
ipcHandle('sync:getAllFinanceData', () => {
  const db = getDb();
  const transactions = db.prepare(`
    SELECT id, type, amount, currency, category, description, date,
           payment_method AS paymentMethod, source, installments,
           installment_group_id AS installmentGroupId,
           for_third_party AS forThirdParty,
           recurring_id AS recurringId,
           import_batch_id AS importBatchId,
           created_at AS createdAt, updated_at AS updatedAt
    FROM finance_transactions ORDER BY date DESC
  `).all();

  const loans = db.prepare(`
    SELECT id, person_name AS personName, direction, type, amount, currency,
           date, description, settled, installment_group_id AS installmentGroupId,
           settled_date AS settledDate, created_at AS createdAt
    FROM finance_loans ORDER BY date DESC
  `).all();

  const loanPayments = db.prepare(`
    SELECT id, loan_id AS loanId, amount, currency, date, note,
           created_at AS createdAt
    FROM finance_loan_payments ORDER BY date ASC
  `).all();

  const recurring = db.prepare(`
    SELECT id, name, type, amount, currency, category, active,
           created_at AS createdAt
    FROM finance_recurring ORDER BY created_at ASC
  `).all();

  const recurringHistory = db.prepare(`
    SELECT id, recurring_id AS recurringId, amount, currency,
           effective_date AS effectiveDate, created_at AS createdAt
    FROM finance_recurring_amount_history ORDER BY effective_date ASC
  `).all();

  const installmentGroups = db.prepare(`
    SELECT id, description, total_amount AS totalAmount, currency,
           total_installments AS totalInstallments, category, date,
           created_at AS createdAt
    FROM finance_installment_groups ORDER BY date DESC
  `).all();

  const categoryMappings = db.prepare(`
    SELECT id, keyword, category, created_at AS createdAt
    FROM finance_category_mappings
  `).all();

  const categories = db.prepare(`SELECT name FROM finance_categories`).all();

  const creditCards = db.prepare(`
    SELECT * FROM finance_credit_cards
  `).all();

  const creditCardStatements = db.prepare(`
    SELECT * FROM finance_credit_card_statements
  `).all();

  return {
    transactions, loans, loanPayments, recurring, recurringHistory,
    installmentGroups, categoryMappings, categories, creditCards,
    creditCardStatements,
  };
});
```

- [ ] **Step 2: Commit**

```bash
git add electron/modules/sync.ipc.ts
git commit -m "feat(sync): add getAllFinanceData IPC handler"
```

---

### Task 3: Add sync:mergeFinanceData IPC handler

**Files:**
- Modify: `electron/modules/sync.ipc.ts` (add after getAllFinanceData)

- [ ] **Step 1: Add the merge handler**

This uses INSERT OR IGNORE for all tables since data comes from a trusted push. After `clearUserData`, the tables are empty so every INSERT succeeds.

```typescript
ipcHandle('sync:mergeFinanceData', (_e, data: Record<string, unknown[]>) => {
  const db = getDb();
  let changed = false;

  const tx = db.transaction(() => {
    // Categories
    if (data.categories && Array.isArray(data.categories)) {
      const stmt = db.prepare(`INSERT OR IGNORE INTO finance_categories (name) VALUES (?)`);
      for (const c of data.categories as Array<{ name: string }>) {
        stmt.run(c.name);
      }
    }

    // Recurring templates
    if (data.recurring && Array.isArray(data.recurring)) {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO finance_recurring
          (id, name, type, amount, currency, category, active, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const r of data.recurring as Array<Record<string, unknown>>) {
        stmt.run(r.id, r.name, r.type, r.amount, r.currency ?? 'ARS', r.category ?? 'Otros', r.active ?? 1, r.createdAt ?? new Date().toISOString());
        changed = true;
      }
    }

    // Recurring amount history
    if (data.recurringHistory && Array.isArray(data.recurringHistory)) {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO finance_recurring_amount_history
          (id, recurring_id, amount, currency, effective_date, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const h of data.recurringHistory as Array<Record<string, unknown>>) {
        stmt.run(h.id, h.recurringId, h.amount, h.currency ?? 'ARS', h.effectiveDate, h.createdAt ?? new Date().toISOString());
      }
    }

    // Installment groups (must come before transactions that reference them)
    if (data.installmentGroups && Array.isArray(data.installmentGroups)) {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO finance_installment_groups
          (id, description, total_amount, currency, total_installments, category, date, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const g of data.installmentGroups as Array<Record<string, unknown>>) {
        stmt.run(g.id, g.description, g.totalAmount, g.currency ?? 'ARS', g.totalInstallments, g.category ?? 'Otros', g.date, g.createdAt ?? new Date().toISOString());
        changed = true;
      }
    }

    // Transactions
    if (data.transactions && Array.isArray(data.transactions)) {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO finance_transactions
          (id, type, amount, currency, category, description, date, payment_method,
           source, installments, installment_group_id, for_third_party,
           recurring_id, import_batch_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const t of data.transactions as Array<Record<string, unknown>>) {
        stmt.run(
          t.id, t.type, t.amount, t.currency ?? 'ARS', t.category ?? 'Otros',
          t.description ?? '', t.date, t.paymentMethod ?? 'cash',
          t.source ?? 'manual', t.installments ?? null, t.installmentGroupId ?? null,
          t.forThirdParty ?? 0, t.recurringId ?? null, t.importBatchId ?? null,
          t.createdAt ?? new Date().toISOString(), t.updatedAt ?? new Date().toISOString(),
        );
        changed = true;
      }
    }

    // Loans
    if (data.loans && Array.isArray(data.loans)) {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO finance_loans
          (id, person_name, direction, type, amount, currency, date, description,
           settled, installment_group_id, settled_date, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const l of data.loans as Array<Record<string, unknown>>) {
        stmt.run(
          l.id, l.personName, l.direction, l.type, l.amount, l.currency ?? 'ARS',
          l.date, l.description ?? '', l.settled ?? 0, l.installmentGroupId ?? null,
          l.settledDate ?? null, l.createdAt ?? new Date().toISOString(),
        );
        changed = true;
      }
    }

    // Loan payments
    if (data.loanPayments && Array.isArray(data.loanPayments)) {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO finance_loan_payments
          (id, loan_id, amount, currency, date, note, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const p of data.loanPayments as Array<Record<string, unknown>>) {
        stmt.run(p.id, p.loanId, p.amount, p.currency ?? 'ARS', p.date, p.note ?? '', p.createdAt ?? new Date().toISOString());
      }
    }

    // Category mappings
    if (data.categoryMappings && Array.isArray(data.categoryMappings)) {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO finance_category_mappings (id, keyword, category, created_at)
        VALUES (?, ?, ?, ?)
      `);
      for (const m of data.categoryMappings as Array<Record<string, unknown>>) {
        stmt.run(m.id, m.keyword, m.category, m.createdAt ?? new Date().toISOString());
      }
    }

    // Credit cards
    if (data.creditCards && Array.isArray(data.creditCards)) {
      const cols = db.prepare(`PRAGMA table_info(finance_credit_cards)`).all() as Array<{ name: string }>;
      const colNames = cols.map(c => c.name);
      const placeholders = colNames.map(() => '?').join(', ');
      const stmt = db.prepare(`INSERT OR IGNORE INTO finance_credit_cards (${colNames.join(', ')}) VALUES (${placeholders})`);
      for (const card of data.creditCards as Array<Record<string, unknown>>) {
        stmt.run(...colNames.map(col => card[col] ?? null));
      }
    }

    // Credit card statements
    if (data.creditCardStatements && Array.isArray(data.creditCardStatements)) {
      const cols = db.prepare(`PRAGMA table_info(finance_credit_card_statements)`).all() as Array<{ name: string }>;
      const colNames = cols.map(c => c.name);
      const placeholders = colNames.map(() => '?').join(', ');
      const stmt = db.prepare(`INSERT OR IGNORE INTO finance_credit_card_statements (${colNames.join(', ')}) VALUES (${placeholders})`);
      for (const s of data.creditCardStatements as Array<Record<string, unknown>>) {
        stmt.run(...colNames.map(col => s[col] ?? null));
      }
    }
  });

  tx();
  return { success: true, changed };
});
```

- [ ] **Step 2: Commit**

```bash
git add electron/modules/sync.ipc.ts
git commit -m "feat(sync): add mergeFinanceData IPC handler"
```

---

### Task 4: Expose new IPC methods in preload and types

**Files:**
- Modify: `electron/preload.ts`
- Modify: `shared/types.ts`

- [ ] **Step 1: Add preload bridges**

In `electron/preload.ts`, add in the sync section (around line 80):

```typescript
syncGetAllFinanceData: () => ipcRenderer.invoke('sync:getAllFinanceData'),
syncMergeFinanceData: (data: Record<string, unknown[]>) => ipcRenderer.invoke('sync:mergeFinanceData', data),
```

- [ ] **Step 2: Add types**

In `shared/types.ts`, in the HubtifyApi interface sync section:

```typescript
syncGetAllFinanceData: () => Promise<Record<string, unknown[]>>;
syncMergeFinanceData: (data: Record<string, unknown[]>) => Promise<{ success: boolean; changed: boolean }>;
```

- [ ] **Step 3: Commit**

```bash
git add electron/preload.ts shared/types.ts
git commit -m "feat(sync): expose getAllFinanceData and mergeFinanceData in preload"
```

---

## Chunk 2: Sync Push/Pull + Finance Subcollection

### Task 5: Expand syncPush to include full finance data via subcollection

**Files:**
- Modify: `src/shared/sync.ts`

- [ ] **Step 1: Update syncPush**

Replace the entire `syncPush` function. Finance data goes to a subcollection doc to avoid the 1MB Firestore limit:

```typescript
export async function syncPush(uid: string): Promise<{ success: boolean; error?: string }> {
  try {
    const [stats, questData, charData, nutritionData, financeData] = await Promise.all([
      window.api.getRpgStats(),
      window.api.syncGetAllQuestData(),
      window.api.characterLoad(),
      window.api.syncGetAllNutritionData(),
      window.api.syncGetAllFinanceData(),
    ]);

    const db = getActiveFirestore();
    const userRef = doc(db, 'hubtify_users', uid);

    // Main document — everything except finance
    await setDoc(userRef, {
      playerStats: stats,
      characterData: charData,
      questify: questData,
      nutrify: nutritionData,
      settings: {
        language: localStorage.getItem('hubtify_lang') || 'es',
        sound: localStorage.getItem('hubtify_sound') !== 'false',
        reminders: localStorage.getItem('hubtify_reminders') === 'true',
        sidebarCollapsed: localStorage.getItem('hubtify_sidebar_collapsed') === 'true',
        onboarded: localStorage.getItem('hubtify_onboarded') === 'true',
      },
      lastSyncAt: new Date().toISOString(),
    }, { merge: true });

    // Finance subcollection document
    const financeRef = doc(db, 'hubtify_users', uid, 'finance', 'data');
    await setDoc(financeRef, financeData);

    return { success: true };
  } catch (err: unknown) {
    const error = err as { message?: string };
    console.error('[Sync] Push failed:', err);
    return { success: false, error: error.message ?? 'Sync push failed' };
  }
}
```

- [ ] **Step 2: Update syncPull**

Replace the entire `syncPull` function. Read from both main doc and finance subcollection:

```typescript
export async function syncPull(uid: string): Promise<{ success: boolean; hasData?: boolean; changed?: boolean; error?: string }> {
  try {
    const db = getActiveFirestore();
    const userRef = doc(db, 'hubtify_users', uid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) return { success: true, hasData: false };

    const data = snap.data();
    let changed = false;

    if (data.playerStats) {
      await window.api.syncRestoreStats(data.playerStats);
    }

    if (data.characterData) {
      await window.api.characterSave(data.characterData);
    }

    if (data.questify) {
      const result = await window.api.syncMergeQuestData(data.questify);
      if (result.changed) changed = true;
    }

    if (data.nutrify) {
      const nutritionResult = await window.api.syncMergeNutritionData(data.nutrify);
      if (nutritionResult.changed) changed = true;
    }

    // Finance — read from subcollection
    const financeRef = doc(db, 'hubtify_users', uid, 'finance', 'data');
    const financeSnap = await getDoc(financeRef);
    if (financeSnap.exists()) {
      const financeData = financeSnap.data() as Record<string, unknown[]>;
      const financeResult = await window.api.syncMergeFinanceData(financeData);
      if (financeResult.changed) changed = true;
    } else if (data.coinify) {
      // Backward compat: old accounts have finance in main doc
      const legacyData: Record<string, unknown[]> = {};
      if (data.coinify.transactions) legacyData.transactions = data.coinify.transactions;
      if (data.coinify.loans) legacyData.loans = data.coinify.loans;
      if (data.coinify.recurring) legacyData.recurring = data.coinify.recurring;
      if (Object.keys(legacyData).length > 0) {
        const financeResult = await window.api.syncMergeFinanceData(legacyData);
        if (financeResult.changed) changed = true;
      }
    }

    // Restore settings
    if (data.settings) {
      const s = data.settings as SyncSettings;
      if (s.language) localStorage.setItem('hubtify_lang', s.language);
      if (s.sound !== undefined) localStorage.setItem('hubtify_sound', String(s.sound));
      if (s.reminders !== undefined) localStorage.setItem('hubtify_reminders', String(s.reminders));
      if (s.sidebarCollapsed !== undefined) localStorage.setItem('hubtify_sidebar_collapsed', String(s.sidebarCollapsed));
      if (s.onboarded) localStorage.setItem('hubtify_onboarded', 'true');
    }

    return { success: true, hasData: true, changed };
  } catch (err: unknown) {
    const error = err as { message?: string };
    console.error('[Sync] Pull failed:', err);
    return { success: false, error: error.message ?? 'Sync pull failed' };
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/shared/sync.ts
git commit -m "feat(sync): full finance push/pull with Firestore subcollection"
```

---

## Chunk 3: Universal account:switched event

### Task 6: Dispatch account:switched event from useAuth

**Files:**
- Modify: `src/shared/hooks/useAuth.ts:180-181`

- [ ] **Step 1: Replace individual events with universal event**

In `switchAccount()` (line 180-181), replace:

```typescript
window.dispatchEvent(new Event('rpg:statsChanged'));
window.dispatchEvent(new Event('sync:questsUpdated'));
```

With:

```typescript
window.dispatchEvent(new Event('rpg:statsChanged'));
window.dispatchEvent(new Event('sync:questsUpdated'));
window.dispatchEvent(new Event('account:switched'));
```

Keep the existing events for backward compatibility — they trigger stats and quest refresh. Add `account:switched` as the new universal event for finance and nutrition modules.

Also do the same in `addAccount()` and `logout()` — anywhere syncPull is called after switching user. Search for all dispatch sites in useAuth.ts.

- [ ] **Step 2: Commit**

```bash
git add src/shared/hooks/useAuth.ts
git commit -m "feat(auth): dispatch account:switched event after account switch"
```

---

### Task 7: Add account:switched listeners to finance components

**Files:**
- Modify: `src/modules/finance/components/Transactions.tsx`
- Modify: `src/modules/finance/components/Installments.tsx`
- Modify: `src/modules/finance/components/Loans.tsx`
- Modify: `src/modules/finance/components/Recurring.tsx`
- Modify: `src/modules/finance/components/Dashboard.tsx`

- [ ] **Step 1: Add listener to each finance component**

In EACH component that has a `loadXxx` or equivalent fetch function called on mount (inside a `useEffect`), add a second `useEffect`:

```typescript
useEffect(() => {
  const handler = () => { /* call the same load function used on mount */ };
  window.addEventListener('account:switched', handler);
  return () => window.removeEventListener('account:switched', handler);
}, [/* same deps as the load useEffect */]);
```

For each component, find the existing load function:

- **Transactions.tsx**: has `loadTransactions` in useEffect
- **Installments.tsx**: has `loadRows(month)` and `loadProjection()`
- **Loans.tsx**: has a load function for loans
- **Recurring.tsx**: has a load function for recurring items
- **Dashboard.tsx**: has multiple load functions for stats

Each component gets one useEffect that listens for `account:switched` and re-calls its load function.

- [ ] **Step 2: Add listener to Nutrition Today.tsx**

`src/modules/nutrition/components/Today.tsx` already listens for `sync:questsUpdated`. Add `account:switched` listener that triggers the same reload.

- [ ] **Step 3: Commit**

```bash
git add src/modules/finance/components/Transactions.tsx src/modules/finance/components/Installments.tsx src/modules/finance/components/Loans.tsx src/modules/finance/components/Recurring.tsx src/modules/finance/components/Dashboard.tsx src/modules/nutrition/components/Today.tsx
git commit -m "feat(sync): add account:switched listener to all data-displaying components"
```
