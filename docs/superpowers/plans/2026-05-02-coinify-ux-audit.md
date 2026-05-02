# Coinify UX Audit Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 9 UX/UI issues in the Coinify module covering schema gaps, i18n, empty states, form usability, inline styles, accessibility, and contrast.

**Architecture:** Backend-first (migration V10 + IPC handlers + sync), then UI fixes. Each task is self-contained and independently committable.

**Tech Stack:** Electron 41, React 19, TypeScript, better-sqlite3, Vitest, i18next

**Spec:** `docs/superpowers/specs/2026-05-02-coinify-ux-audit-design.md`

---

## Chunk 1: Database & Backend

### Task 1: Migration V10 — Loan Tables + Indices

**Files:**
- Modify: `src/modules/finance/finance.schema.ts` (append to `financeMigrations` array)
- Create: `tests/modules/finance/finance-loan-soft-delete.test.ts`

**Context:** The migration array is exported as `financeMigrations` with 9 entries (V1-V9). Append V10. Pattern: `{ namespace: 'finance', version: N, up: '...' }`. `finance_loans` has `created_at` but no `updated_at`. `finance_loan_payments` has `created_at` only — no `deleted_at`, no `updated_at`.

- [ ] **Step 1: Write failing test**

Create `tests/modules/finance/finance-loan-soft-delete.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { financeMigrations } from '@modules/finance/finance.schema';

function runMigrations(db: Database.Database) {
  for (const m of financeMigrations) {
    try { db.exec(m.up); } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('duplicate column name')) continue;
      throw e;
    }
  }
}

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('finance migration V10 — loan soft deletes', () => {
  it('finance_loans has updated_at column', () => {
    const db = setupDb();
    const cols = db.pragma('table_info(finance_loans)') as Array<{ name: string }>;
    expect(cols.map(c => c.name)).toContain('updated_at');
  });

  it('finance_loan_payments has deleted_at and updated_at columns', () => {
    const db = setupDb();
    const cols = db.pragma('table_info(finance_loan_payments)') as Array<{ name: string }>;
    const names = cols.map(c => c.name);
    expect(names).toContain('deleted_at');
    expect(names).toContain('updated_at');
  });

  it('existing loans get updated_at backfilled from created_at', () => {
    const db = setupDb();
    db.prepare("INSERT INTO finance_loans (id, person_name, direction, type, amount, currency, date, created_at) VALUES ('l1', 'Juan', 'lent', 'single', 1000, 'ARS', '2026-01-01', '2026-01-01T10:00:00')").run();
    // Re-run V10 backfill (already ran in setupDb, but row was inserted after)
    db.exec("UPDATE finance_loans SET updated_at = created_at WHERE updated_at IS NULL");
    const row = db.prepare("SELECT updated_at FROM finance_loans WHERE id = 'l1'").get() as { updated_at: string };
    expect(row.updated_at).toBe('2026-01-01T10:00:00');
  });

  it('soft-deleted loan payments excluded from query', () => {
    const db = setupDb();
    db.prepare("INSERT INTO finance_loans (id, person_name, direction, type, amount, currency, date, created_at) VALUES ('l1', 'Juan', 'lent', 'single', 1000, 'ARS', '2026-01-01', datetime('now'))").run();
    db.prepare("INSERT INTO finance_loan_payments (id, loan_id, amount, currency, date, created_at) VALUES ('p1', 'l1', 500, 'ARS', '2026-02-01', datetime('now'))").run();
    db.prepare("INSERT INTO finance_loan_payments (id, loan_id, amount, currency, date, created_at, deleted_at) VALUES ('p2', 'l1', 300, 'ARS', '2026-03-01', datetime('now'), datetime('now'))").run();
    const rows = db.prepare("SELECT * FROM finance_loan_payments WHERE loan_id = 'l1' AND deleted_at IS NULL").all();
    expect(rows).toHaveLength(1);
  });

  it('idx_finance_statements_status index exists', () => {
    const db = setupDb();
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='finance_credit_card_statements'").all() as Array<{ name: string }>;
    expect(indexes.map(i => i.name)).toContain('idx_finance_statements_status');
  });

  it('idx_finance_loans_settled index exists', () => {
    const db = setupDb();
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='finance_loans'").all() as Array<{ name: string }>;
    expect(indexes.map(i => i.name)).toContain('idx_finance_loans_settled');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/modules/finance/finance-loan-soft-delete.test.ts`
Expected: FAIL — columns/indices don't exist yet

- [ ] **Step 3: Add migration V10**

In `src/modules/finance/finance.schema.ts`, append to the `financeMigrations` array (after the V9 entry, before the closing `]`):

```typescript
{
  namespace: 'finance',
  version: 10,
  up: `
    ALTER TABLE finance_loans ADD COLUMN updated_at TEXT DEFAULT NULL;
    ALTER TABLE finance_loan_payments ADD COLUMN deleted_at TEXT DEFAULT NULL;
    ALTER TABLE finance_loan_payments ADD COLUMN updated_at TEXT DEFAULT NULL;
    UPDATE finance_loans SET updated_at = created_at WHERE updated_at IS NULL;
    UPDATE finance_loan_payments SET updated_at = created_at WHERE updated_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_finance_statements_status ON finance_credit_card_statements(status);
    CREATE INDEX IF NOT EXISTS idx_finance_loans_settled ON finance_loans(settled);
  `,
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run tests/modules/finance/finance-loan-soft-delete.test.ts`
Expected: PASS (all 6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/modules/finance/finance.schema.ts tests/modules/finance/finance-loan-soft-delete.test.ts
git commit -m "feat(finance): migration V10 — loan soft deletes, updated_at, indices"
```

---

### Task 2: Loan IPC Handler Updates

**Files:**
- Modify: `electron/modules/finance.ipc.ts`
- Modify: `electron/preload.ts`
- Modify: `shared/types.ts`

**Context:** Loan IPC handlers in `electron/modules/finance.ipc.ts`:
- `finance:addLoan` (line 724): INSERT without `updated_at`
- `finance:settleLoan` (line 756): UPDATE without `updated_at`
- `finance:addLoanPayment` (line 762): INSERT without `updated_at`
- `finance:getLoanPayments` (line 786): SELECT without `deleted_at IS NULL`
- No `finance:deleteLoanPayment` handler exists — must create

- [ ] **Step 1: Add updated_at to finance:addLoan**

At line 724, add `updated_at` to INSERT columns and values. The `now` variable is already defined on line 736. Add `updated_at` after `created_at`:

```typescript
// Change INSERT column list to include updated_at:
INSERT INTO finance_loans
  (id, person_name, direction, type, amount, currency, date, description, settled, installment_group_id, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
// Add `now` as last parameter in .run()
```

- [ ] **Step 2: Add updated_at to finance:settleLoan**

At line 756, change:
```typescript
// OLD:
db.prepare(`UPDATE finance_loans SET settled = 1, settled_date = ? WHERE id = ?`).run(today, id);
// NEW:
db.prepare(`UPDATE finance_loans SET settled = 1, settled_date = ?, updated_at = datetime('now') WHERE id = ?`).run(today, id);
```

- [ ] **Step 3: Add updated_at to finance:addLoanPayment**

At line 762, add `updated_at` to INSERT columns and values:
```typescript
// Change INSERT to:
INSERT INTO finance_loan_payments (id, loan_id, amount, currency, date, note, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
// Add `now` as last parameter in .run()
```

- [ ] **Step 4: Add deleted_at IS NULL to finance:getLoanPayments**

At line 786, change:
```typescript
// OLD: WHERE loan_id = ?
// NEW: WHERE loan_id = ? AND deleted_at IS NULL
```

- [ ] **Step 5: Create finance:deleteLoanPayment handler**

After the `finance:getLoanPayments` handler (around line 794), add:
```typescript
ipcHandle('finance:deleteLoanPayment', (_e, id: string) => {
  const db = getDb();
  db.prepare("UPDATE finance_loan_payments SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND deleted_at IS NULL").run(id);
});
```

- [ ] **Step 6: Expose in preload.ts**

In `electron/preload.ts`, after `financeGetLoanPayments` (line ~193), add:
```typescript
financeDeleteLoanPayment: (id: string) => ipcRenderer.invoke('finance:deleteLoanPayment', id),
```

- [ ] **Step 7: Add type in shared/types.ts**

In `shared/types.ts`, after `financeGetLoanPayments` in HubtifyApi interface (line ~291), add:
```typescript
financeDeleteLoanPayment: (id: string) => Promise<void>;
```

- [ ] **Step 8: Run tests and commit**

Run: `npm test -- --run`
Commit: `feat(finance): loan handler updates — updated_at, soft delete, new deleteLoanPayment`

---

### Task 3: Sync Handler Updates for Loans

**Files:**
- Modify: `electron/modules/sync.ipc.ts`

**Context:**
- `sync:getAllFinanceData` loans query (line 659): SELECT missing `updated_at`
- `sync:getAllFinanceData` loanPayments query (line 666): SELECT missing `deleted_at, updated_at`
- `sync:mergeFinanceData` loanPayments merge (line 884): INSERT OR IGNORE without `deleted_at, updated_at`, no LWW update
- Loans merge (line 858): uses "settled-wins" strategy — NOT rewriting to LWW (out of scope), only adding `updated_at` to export

- [ ] **Step 1: Update getAllFinanceData — loans SELECT**

At line 659, add `updated_at` to SELECT:
```sql
SELECT id, person_name AS personName, direction, type, amount, currency,
       date, description, settled, installment_group_id AS installmentGroupId,
       settled_date AS settledDate, created_at AS createdAt, updated_at AS updatedAt
FROM finance_loans ORDER BY date DESC
```

- [ ] **Step 2: Update getAllFinanceData — loanPayments SELECT**

At line 666, add `deleted_at, updated_at` to SELECT:
```sql
SELECT id, loan_id AS loanId, amount, currency, date, note,
       created_at AS createdAt, deleted_at AS deletedAt, updated_at AS updatedAt
FROM finance_loan_payments ORDER BY date ASC
```

- [ ] **Step 3: Update mergeFinanceData — loanPayments**

At line 884, update INSERT OR IGNORE to include new columns and add LWW update:

```typescript
if (data.loanPayments && Array.isArray(data.loanPayments)) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO finance_loan_payments
      (id, loan_id, amount, currency, date, note, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const lww = db.prepare(
    "UPDATE finance_loan_payments SET deleted_at = ?, updated_at = ? WHERE id = ? AND (updated_at IS NULL OR updated_at < ?)"
  );
  for (const p of data.loanPayments as Array<Record<string, unknown>>) {
    const result = stmt.run(
      p.id, p.loanId, p.amount, p.currency ?? 'ARS', p.date, p.note ?? '',
      p.createdAt ?? now, p.updatedAt ?? null, p.deletedAt ?? null
    );
    if (result.changes > 0) changed = true;
    // LWW for soft-delete propagation
    if (p.deletedAt || p.updatedAt) {
      const u = lww.run(p.deletedAt ?? null, p.updatedAt ?? null, p.id, p.updatedAt);
      if (u.changes > 0) changed = true;
    }
  }
}
```

- [ ] **Step 4: Update mergeFinanceData — loans INSERT to include updated_at**

At line 858, in the loans merge section, update the INSERT OR IGNORE to include `updated_at`:

```typescript
const insertLoan = db.prepare(`
  INSERT OR IGNORE INTO finance_loans
    (id, person_name, direction, type, amount, currency, date, description,
     settled, installment_group_id, settled_date, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
```

And update the `.run()` call to pass `l.updatedAt ?? null` as the last parameter.

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- --run`
Commit: `feat(finance): include loan soft-delete fields in sync handlers`

---

## Chunk 2: i18n + Empty States + Forms

### Task 4: DashboardWidget Hardcoded Spanish

**Files:**
- Modify: `src/modules/finance/components/DashboardWidget.tsx`
- Modify: `src/i18n/es.json`
- Modify: `src/i18n/en.json`

**Context:** Line 64 has hardcoded `'Gasto rapido'` and `'Ingreso rapido'`. Component already uses `useTranslation()`.

- [ ] **Step 1: Replace hardcoded strings**

At line 64, change:
```typescript
// OLD:
description: quickDesc.trim() || (quickType === 'expense' ? 'Gasto rapido' : 'Ingreso rapido'),
// NEW:
description: quickDesc.trim() || (quickType === 'expense' ? t('coinify.quickExpense', 'Gasto rápido') : t('coinify.quickIncome', 'Ingreso rápido')),
```

- [ ] **Step 2: Add i18n keys**

In `src/i18n/es.json` under `"coinify"` (alphabetically):
```json
"quickExpense": "Gasto rápido",
"quickIncome": "Ingreso rápido"
```

In `src/i18n/en.json` under `"coinify"` (alphabetically):
```json
"quickExpense": "Quick expense",
"quickIncome": "Quick income"
```

- [ ] **Step 3: Run tests and commit**

Run: `npm test -- --run`
Commit: `fix(finance): replace hardcoded Spanish in dashboard widget`

---

### Task 5: Consistent Empty States

**Files:**
- Modify: `src/modules/finance/components/Loans.tsx`
- Modify: `src/modules/finance/components/Transactions.tsx`
- Modify: `src/modules/finance/components/Recurring.tsx`
- Modify: `src/i18n/es.json`
- Modify: `src/i18n/en.json`

**Context:**
- Loans.tsx line 192-197: uses `.coin-empty-codex` with inline `style={{ padding: '40px 16px' }}` and nested `qb-hand` div — inconsistent
- Transactions.tsx line 542: bare `<p>` with no filter-active hint
- Recurring.tsx line 308: bare `<p>` with no CTA hint

- [ ] **Step 1: Normalize Loans.tsx empty state**

At lines 192-197, replace:
```tsx
// OLD:
<div className="coin-empty-codex" style={{ padding: '40px 16px' }}>
  <div className="qb-hand" style={{ fontStyle: 'italic' }}>{t('coinify.noLoans')}</div>
</div>
// NEW:
<div className="coin-empty-codex">
  <p>{t('coinify.noLoans', 'Sin préstamos activos')}</p>
</div>
```

- [ ] **Step 2: Enrich Transactions.tsx empty state**

At line 542, replace:
```tsx
// OLD:
<p className="coin-empty-codex">{t('coinify.noTransactions')}</p>
// NEW:
<div className="coin-empty-codex">
  <p>{t('coinify.noTransactions', 'Sin transacciones este mes')}</p>
  {(filterCategory || filterType || filterPayment) && (
    <p style={{ fontSize: 'var(--fs-label)', marginTop: 4 }}>{t('coinify.filterActive', 'Hay filtros activos — probá limpiarlos')}</p>
  )}
</div>
```

Note: Filter state vars are `filterCategory`, `filterType`, `filterPayment` — all init to `''` (falsy when empty).

- [ ] **Step 3: Enrich Recurring.tsx empty state**

At line 308, replace:
```tsx
// OLD:
<p className="coin-empty-codex">{t('coinify.noRecurring')}</p>
// NEW:
<div className="coin-empty-codex">
  <p>{t('coinify.noRecurring', 'No hay recurrentes configurados')}</p>
  <p style={{ fontSize: 'var(--fs-label)', marginTop: 4 }}>{t('coinify.noRecurringHint', 'Agregá gastos fijos como alquiler, servicios o suscripciones')}</p>
</div>
```

- [ ] **Step 4: Add i18n keys**

In `src/i18n/es.json` under `"coinify"` (alphabetically):
```json
"filterActive": "Hay filtros activos — probá limpiarlos",
"noRecurringHint": "Agregá gastos fijos como alquiler, servicios o suscripciones"
```

In `src/i18n/en.json` under `"coinify"` (alphabetically):
```json
"filterActive": "Filters are active — try clearing them",
"noRecurringHint": "Add fixed expenses like rent, utilities or subscriptions"
```

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- --run`
Commit: `feat(finance): consistent and enriched empty states`

---

### Task 6: Double-Submit Prevention in Loans

**Files:**
- Modify: `src/modules/finance/components/Loans.tsx`

**Context:** `handleAddLoan` (line 86-134) has no `submitting` state. Submit button at line 373 is never disabled.

- [ ] **Step 1: Add submitting state**

Near the other state declarations (around line 30), add:
```typescript
const [submitting, setSubmitting] = useState(false);
```

- [ ] **Step 2: Wrap handleAddLoan**

Modify `handleAddLoan` to use submitting guard:
```typescript
const handleAddLoan = async (e: React.FormEvent) => {
  e.preventDefault();
  if (submitting) return;
  setSubmitting(true);
  try {
    // ... existing validation and logic unchanged ...
  } catch (err) {
    // ... existing error handling unchanged ...
  } finally {
    setSubmitting(false);
  }
};
```

- [ ] **Step 3: Disable submit button**

At line 373, add `disabled={submitting}`:
```tsx
<button type="submit" className="rpg-button" style={{ width: '100%' }} disabled={submitting}>
  {submitting ? '...' : t('coinify.add')}
</button>
```

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- --run`
Commit: `fix(finance): prevent double-submit in loan form`

---

## Chunk 3: CSS + Accessibility

### Task 7: DollarChip Inline Styles → CSS

**Files:**
- Modify: `src/modules/finance/components/shared/DollarChip.tsx`
- Modify: `src/modules/finance/styles/coinify.css`

**Context:** DollarChip.tsx has ~11 inline `style={{}}` blocks. Extract to CSS classes with `.coin-dollar-menu` BEM prefix.

- [ ] **Step 1: Add CSS classes to coinify.css**

Add at the end of `src/modules/finance/styles/coinify.css`:

```css
/* ── DollarChip menu ── */
.coin-dollar-menu {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  z-index: 100;
  background: var(--parch-0);
  border: 2px solid var(--gold-dark);
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(42, 29, 14, 0.35);
  padding: 8px;
  min-width: 200px;
}
.coin-dollar-menu__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--gold-dark);
}
.coin-dollar-menu__title {
  font-size: var(--fs-label);
  font-weight: 600;
  opacity: 0.7;
}
.coin-dollar-menu__config-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: currentColor;
  opacity: 0.5;
  border-radius: 4px;
  padding: 2px;
  display: flex;
  align-items: center;
  transition: opacity 0.15s, background 0.15s;
}
.coin-dollar-menu__config-btn--active {
  background: var(--gold-dark);
  color: var(--parch-0);
  opacity: 1;
}
.coin-dollar-menu__row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  font-size: var(--fs-label);
  border-bottom: 1px solid var(--parch-1);
}
.coin-dollar-menu__row--checkbox {
  cursor: pointer;
}
.coin-dollar-menu__row--disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.coin-dollar-menu__rate-label {
  flex: 1;
  opacity: 0.8;
}
.coin-dollar-menu__rate-value {
  font-family: 'Fira Code', monospace;
  font-weight: 600;
}
```

- [ ] **Step 2: Replace inline styles in DollarChip.tsx**

Replace each inline `style={{}}` with the corresponding CSS class. For the config button, use dynamic className:
```tsx
className={`coin-dollar-menu__config-btn${configMode ? ' coin-dollar-menu__config-btn--active' : ''}`}
```

For checkbox rows:
```tsx
className={`coin-dollar-menu__row coin-dollar-menu__row--checkbox${isLast ? ' coin-dollar-menu__row--disabled' : ''}`}
```

For rate display rows:
```tsx
className="coin-dollar-menu__row"
```

Keep `position: 'relative'` on the wrapper div (line 120) — it's structural, not visual.

- [ ] **Step 3: Run tests and commit**

Run: `npm test -- --run`
Commit: `refactor(finance): extract DollarChip inline styles to CSS classes`

---

### Task 8: Sort Headers + Chest Contrast

**Files:**
- Modify: `src/modules/finance/components/Transactions.tsx`
- Modify: `src/modules/finance/styles/coinify.css`

**Context:** Sort headers (lines 506-517) use `<span role="button">` instead of `<button>`. Chest panel background opacity is 0.6/0.4.

- [ ] **Step 1: Convert sort headers to buttons**

At lines 506-517, change all 4 sort headers from `<span>` to `<button>`. Remove `role="button"` (no longer needed). Example for date header:

```tsx
// OLD:
<span className="coin-sort-header" role="button" aria-label={t('coinify.colDate', 'DÍA')} onClick={() => toggleSort('date')}>
  {t('coinify.colDate', 'DÍA')} {sortIndicator('date')}
</span>
// NEW:
<button className="coin-sort-header" onClick={() => toggleSort('date')}>
  {t('coinify.colDate', 'DÍA')} {sortIndicator('date')}
</button>
```

For the amount header, keep the `style={{ textAlign: 'right' }}` since it's structural:
```tsx
<button className="coin-sort-header" onClick={() => toggleSort('amount')} style={{ textAlign: 'right' }}>
  {t('coinify.colAmount', 'MONEDAS')} {sortIndicator('amount')}
</button>
```

- [ ] **Step 2: Add button reset + focus-visible CSS**

In `coinify.css`, replace ONLY the `.coin-sort-header` and `.coin-sort-header:hover` rules (do NOT touch `.coin-sort-arrow` or any other rule):

```css
/* Replace ONLY .coin-sort-header and .coin-sort-header:hover with: */
button.coin-sort-header {
  background: none;
  border: none;
  font: inherit;
  color: inherit;
  cursor: pointer;
  padding: 0;
  user-select: none;
  transition: color 0.15s;
}
button.coin-sort-header:hover {
  color: var(--gold);
}
button.coin-sort-header:focus-visible {
  outline: 2px solid var(--rpg-gold);
  outline-offset: 2px;
  border-radius: 2px;
}
```

- [ ] **Step 3: Improve chest panel contrast**

In `coinify.css`, find `.coin-chest-panel` (line 198) and change background:
```css
/* OLD: */
background: linear-gradient(180deg, rgba(245, 231, 192, 0.6), rgba(217, 195, 138, 0.4));
/* NEW: */
background: linear-gradient(180deg, rgba(245, 231, 192, 0.85), rgba(217, 195, 138, 0.7));
```

Add text-shadow to amount elements:
```css
.coin-chest-panel__amount,
.coin-chest-panel__usd {
  text-shadow: 0 1px 2px rgba(255, 255, 255, 0.3);
}
```

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- --run`
Commit: `feat(finance): semantic sort headers + chest panel contrast`

---

### Task 9: Touch Targets in Recurring

**Files:**
- Modify: `src/modules/finance/components/Recurring.tsx`
- Modify: `src/modules/finance/styles/coinify.css`

**Context:** Recurring.tsx has ~10 small action buttons ALL using inline `style={{ padding: '2px 8px', fontSize: 'var(--fs-label)' }}`. Need to extract to a `.coin-action-btn` CSS class with proper min touch size.

- [ ] **Step 1: Add .coin-action-btn CSS class**

In `coinify.css`, add:
```css
/* ── Action buttons (small) ── */
.coin-action-btn {
  min-height: 32px;
  min-width: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px 8px;
  font-size: var(--fs-label);
  cursor: pointer;
  border-radius: 4px;
  transition: opacity 0.15s;
}
.coin-action-btn--danger {
  color: var(--rubric);
  opacity: 0.6;
}
.coin-action-btn--danger:hover {
  opacity: 1;
}
.coin-action-btn--muted {
  opacity: 0.5;
}
.coin-action-btn--muted:hover {
  opacity: 0.8;
}
```

- [ ] **Step 2: Replace inline styles on all action buttons**

In Recurring.tsx, find ALL buttons with `style={{ padding: '2px 8px', fontSize: 'var(--fs-label)' ... }}` (approximately lines 340, 345, 354, 356, 389, 391, 403, 413, 420). Replace inline styles with CSS classes.

For toggle/edit buttons:
```tsx
// OLD:
<button className="rpg-button" ... style={{ padding: '2px 8px', fontSize: 'var(--fs-label)', opacity: 0.5 }}>
// NEW:
<button className="rpg-button coin-action-btn coin-action-btn--muted" ...>
```

For delete buttons:
```tsx
// OLD:
<button className="rpg-button" ... style={{ padding: '2px 8px', fontSize: 'var(--fs-label)', color: 'var(--rubric)', opacity: 0.6 }}>
// NEW:
<button className="rpg-button coin-action-btn coin-action-btn--danger" ...>
```

Remove ALL inline `style` props from these buttons. Keep `aria-label` and `title` attributes.

- [ ] **Step 3: Run tests and commit**

Run: `npm test -- --run`
Commit: `feat(finance): proper touch targets for recurring action buttons`

---

## Execution Order

1. **Chunk 1 (Tasks 1-3)**: Backend — migration, IPC handlers, sync. Foundation for data integrity.
2. **Chunk 2 (Tasks 4-6)**: i18n, empty states, forms. Independent of each other.
3. **Chunk 3 (Tasks 7-9)**: CSS, accessibility, touch targets. Independent of each other.

## Verification

After all tasks complete:
- `npm test` — all tests pass (including new loan soft-delete tests)
- Manual check: add/settle loan → verify `updated_at` is set in DB
- Manual check: DashboardWidget quick-add shows translated description
- Manual check: Loans empty state matches standard `.coin-empty-codex` pattern
- Manual check: Transactions empty state shows filter-active hint when filtered
- Manual check: Loan form button disabled during submission
- Manual check: DollarChip dropdown styled by CSS, no inline styles
- Manual check: Sort headers are `<button>` with focus-visible ring
- Manual check: Chest panel text readable with improved contrast
- Manual check: Recurring action buttons have 32px min touch size
