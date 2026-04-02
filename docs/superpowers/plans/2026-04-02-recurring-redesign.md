# Recurring Transactions Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add billing day configuration to recurring transactions, auto-generate on app load, and visually separate recurring from regular transactions in the Transactions view using collapsible accordion sections.

**Architecture:** Migration v6 adds `billing_day` to `finance_recurring`. Generation logic uses billing_day for transaction dates. Dashboard auto-generates on mount. Transactions.tsx splits data into two accordion sections by `source` field.

**Tech Stack:** Electron + React + better-sqlite3, i18next, RPG-themed UI.

**Spec:** `docs/superpowers/specs/2026-04-02-recurring-redesign.md`

---

## File Structure

### Modified Files
- `src/modules/finance/finance.schema.ts` -- Migration v6 (ALTER TABLE)
- `electron/modules/finance.ipc.ts` -- Update addRecurring, getRecurring, generateRecurringForMonth
- `src/modules/finance/components/Recurring.tsx` -- Add billing_day to form and list
- `src/modules/finance/components/Transactions.tsx` -- Two accordion sections
- `src/modules/finance/components/Dashboard.tsx` -- Auto-generation on mount
- `src/i18n/es.json` -- New translation keys
- `src/i18n/en.json` -- New translation keys

---

## Task 1: Migration v6

**Files:**
- Modify: `src/modules/finance/finance.schema.ts`

- [ ] **Step 1: Add migration v6**

Add after the version 5 migration block (after line 213, before the closing `];` on line 214) in the `financeMigrations` array:

```typescript
  {
    namespace: 'finance',
    version: 6,
    up: `
      ALTER TABLE finance_recurring ADD COLUMN billing_day INTEGER NOT NULL DEFAULT 1;
    `,
  },
```

The v5 migration ends at line 213 (`},`). The array closes at line 214 (`];`). Insert between them.

- [ ] **Step 2: Commit**

```bash
git add src/modules/finance/finance.schema.ts
git commit -m "feat(finance): add migration v6 for recurring billing_day"
```

---

## Task 2: Backend IPC Changes

**Files:**
- Modify: `electron/modules/finance.ipc.ts`

- [ ] **Step 1: Update `finance:getRecurring` SELECT (line 784-789)**

Current SELECT at lines 784-789:
```sql
SELECT id, name, type, amount, currency, category, active,
       created_at AS createdAt
FROM finance_recurring
ORDER BY created_at ASC
```

Add `billing_day AS billingDay` to the SELECT columns:
```sql
SELECT id, name, type, amount, currency, category, active,
       billing_day AS billingDay,
       created_at AS createdAt
FROM finance_recurring
ORDER BY created_at ASC
```

- [ ] **Step 2: Update `finance:addRecurring` to accept billingDay (lines 792-817)**

Current parameter type at lines 792-799:
```typescript
ipcHandle('finance:addRecurring', (_e, rec: {
  id?: string;
  name: string;
  type: 'expense' | 'income';
  amount: number;
  currency?: string;
  category?: string;
}) => {
```

Add `billingDay?: number` to the type:
```typescript
ipcHandle('finance:addRecurring', (_e, rec: {
  id?: string;
  name: string;
  type: 'expense' | 'income';
  amount: number;
  currency?: string;
  category?: string;
  billingDay?: number;
}) => {
```

Current INSERT at lines 803-806:
```sql
INSERT OR IGNORE INTO finance_recurring
  (id, name, type, amount, currency, category, active, created_at)
VALUES (?, ?, ?, ?, ?, ?, 1, ?)
```

Update to include `billing_day`:
```sql
INSERT OR IGNORE INTO finance_recurring
  (id, name, type, amount, currency, category, active, billing_day, created_at)
VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
```

Current `.run()` arguments at lines 807-815:
```typescript
.run(
  id,
  rec.name,
  rec.type,
  rec.amount,
  rec.currency ?? 'ARS',
  rec.category ?? 'Otros',
  now,
);
```

Update to include `billingDay`:
```typescript
.run(
  id,
  rec.name,
  rec.type,
  rec.amount,
  rec.currency ?? 'ARS',
  rec.category ?? 'Otros',
  rec.billingDay ?? 1,
  now,
);
```

- [ ] **Step 3: Update `finance:generateRecurringForMonth` to use billing_day (lines 848-904)**

Current SELECT at lines 850-861:
```sql
SELECT id, name, type, amount, currency, category
FROM finance_recurring
WHERE active = 1
```

Add `billing_day AS billingDay` and update the type cast:
```sql
SELECT id, name, type, amount, currency, category, billing_day AS billingDay
FROM finance_recurring
WHERE active = 1
```

Add `billingDay: number;` to the type assertion at lines 854-861.

Current date value at line 889:
```typescript
`${month}-01`,
```

Change to use the billing day from the recurring record:
```typescript
`${month}-${String(rec.billingDay ?? 1).padStart(2, '0')}`,
```

- [ ] **Step 4: Commit**

```bash
git add electron/modules/finance.ipc.ts
git commit -m "feat(finance): add billing_day support to recurring IPC handlers"
```

---

## Task 3: i18n Translations

**Files:**
- Modify: `src/i18n/es.json`
- Modify: `src/i18n/en.json`

- [ ] **Step 1: Add Spanish translations**

In `src/i18n/es.json`, add to the `coinify` namespace (after line 331, before the closing `}` of coinify on line 332):
```json
    "billingDay": "Dia de cobro",
    "recurringSection": "Recurrentes",
    "transactionsSection": "Transacciones"
```

Existing nearby keys for reference: `"installmentAmount"` is at line 331, coinify closes at line 332.

- [ ] **Step 2: Add English translations**

In `src/i18n/en.json`, add to the `coinify` namespace (after line 331, before the closing `}` of coinify on line 332):
```json
    "billingDay": "Billing day",
    "recurringSection": "Recurring",
    "transactionsSection": "Transactions"
```

Same structure: `"installmentAmount"` is at line 331, coinify closes at line 332.

- [ ] **Step 3: Commit**

```bash
git add src/i18n/es.json src/i18n/en.json
git commit -m "feat(finance): add recurring redesign i18n translations"
```

---

## Task 4: Update Recurring Component

**Files:**
- Modify: `src/modules/finance/components/Recurring.tsx`

- [ ] **Step 1: Add billingDay to RecurringRow interface (line 8-16)**

Current interface at lines 8-16:
```typescript
interface RecurringRow {
  id: string;
  name: string;
  type: 'expense' | 'income';
  amount: number;
  currency: string;
  category: string;
  active: boolean | number;
}
```

Add `billingDay: number;` after `active`:
```typescript
interface RecurringRow {
  id: string;
  name: string;
  type: 'expense' | 'income';
  amount: number;
  currency: string;
  category: string;
  active: boolean | number;
  billingDay: number;
}
```

- [ ] **Step 2: Add billingDay state to the form**

After `formCategory` state on line 41, add:
```typescript
const [formBillingDay, setFormBillingDay] = useState(1);
```

- [ ] **Step 3: Add billing day input to the form (after line 192)**

In the form, after the category select row (the `</div>` at line 192 closing the row with `RpgNumberInput`, currency select, and `CategorySelect`), add a new row before the submit button at line 194:

```tsx
<div className="coin-quick-add-form__row">
  <label style={{ fontSize: '0.8rem', opacity: 0.7, whiteSpace: 'nowrap' }}>{t('coinify.billingDay')}</label>
  <input type="number" className="rpg-input" value={formBillingDay}
    onChange={(e) => setFormBillingDay(Math.min(28, Math.max(1, parseInt(e.target.value) || 1)))}
    style={{ width: 60 }} min={1} max={28} />
</div>
```

- [ ] **Step 4: Pass billingDay in handleAddSubmit (line 73-75)**

Current call at lines 73-75:
```typescript
await window.api.financeAddRecurring({
  name: formName, type: formType, amount: parsed, currency: formCurrency, category: formCategory,
});
```

Update to include `billingDay`:
```typescript
await window.api.financeAddRecurring({
  name: formName, type: formType, amount: parsed, currency: formCurrency, category: formCategory, billingDay: formBillingDay,
});
```

Reset at line 76-77. Add `setFormBillingDay(1);` to the reset sequence:
```typescript
setFormName(''); setFormAmount(''); setFormType('expense');
setFormCurrency('ARS'); setFormCategory('Otros'); setFormBillingDay(1); setShowForm(false);
```

- [ ] **Step 5: Show billing day in the list (after line 245)**

After the category span at line 245:
```tsx
<span className="coin-recurring__category">{item.category}</span>
```

Add:
```tsx
<span style={{ fontSize: '0.75rem', opacity: 0.5 }}>
  {t('coinify.billingDay')}: {item.billingDay}
</span>
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/finance/components/Recurring.tsx
git commit -m "feat(finance): add billing day to recurring form and list"
```

---

## Task 5: Auto-generation on Dashboard Mount

**Files:**
- Modify: `src/modules/finance/components/Dashboard.tsx`

- [ ] **Step 1: Understand current mount logic**

Dashboard.tsx has two main useEffects:
- Lines 106-130: Fetches month-dependent data (balance, categories). Runs when `month` changes.
- Lines 133-137: `loadStaticData` fetches projection, loans, installment count. Called once via `useEffect` at line 139.

There is NO existing auto-generation call in Dashboard. Currently, generation only happens in Transactions.tsx (line 81) and manually via the Recurring.tsx generate button (line 130).

- [ ] **Step 2: Add auto-generation call**

Add a new useEffect after line 139 (`useEffect(() => { loadStaticData(); }, [loadStaticData]);`):

```typescript
// Auto-generate recurring transactions for the current month (idempotent)
useEffect(() => {
  const m = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  window.api.financeGenerateRecurringForMonth(m);
}, []);
```

Note: `now` is already defined at line 92.

- [ ] **Step 3: Commit**

```bash
git add src/modules/finance/components/Dashboard.tsx
git commit -m "feat(finance): auto-generate recurring on dashboard mount"
```

---

## Task 6: Accordion Sections in Transactions

**Files:**
- Modify: `src/modules/finance/components/Transactions.tsx`

This is the most complex task. The current structure:
- Lines 50-68: Component state declarations
- Lines 70-76: `loadTransactions` with filters applied
- Lines 78-82: useEffect that loads transactions AND generates recurring (line 81)
- Lines 198-212: Filters UI (type, payment method selects)
- Lines 214-295: Transaction list rendering (`coin-tx-list` div)

- [ ] **Step 1: Add collapsed state with localStorage persistence**

After `rowRefs` at line 68, add:

```typescript
const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => {
  try {
    const saved = localStorage.getItem('coinify_collapsed_sections');
    return saved ? new Set(JSON.parse(saved)) : new Set();
  } catch { return new Set(); }
});

const toggleSection = (key: string) => {
  setCollapsedSections((prev) => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    localStorage.setItem('coinify_collapsed_sections', JSON.stringify([...next]));
    return next;
  });
};
```

- [ ] **Step 2: Split transactions into two groups**

After the `loadTransactions` callback (after line 76), or inside the render before the JSX, compute:

```typescript
const recurringTx = transactions.filter((tx) => tx.source === 'recurring');
const normalTx = transactions.filter((tx) => tx.source !== 'recurring');
```

Note: The `source` field is already part of `TransactionRow` (line 20) and is returned from the backend SELECT (line 64 of finance.ipc.ts).

- [ ] **Step 3: Create a reusable SectionHeader component (inline)**

Inside the `Transactions` function body, before the return statement (before line 182), add:

```tsx
const SectionHeader = ({ sectionKey, title, count }: { sectionKey: string; title: string; count: number }) => {
  const isCollapsed = collapsedSections.has(sectionKey);
  return (
    <div
      onClick={() => toggleSection(sectionKey)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
        cursor: 'pointer', borderBottom: '1px solid var(--rpg-parchment-dark)',
        userSelect: 'none', marginTop: 8,
      }}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor"
        strokeWidth="1.5" strokeLinecap="round"
        style={{ transition: 'transform 0.2s', transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)' }}>
        <path d="M3 1l4 4-4 4" />
      </svg>
      <span style={{ fontWeight: 'bold', flex: 1, fontFamily: 'Cinzel, serif', fontSize: '0.9rem' }}>
        {title}
      </span>
      <span style={{ fontSize: '0.75rem', opacity: 0.5 }}>{count}</span>
    </div>
  );
};
```

- [ ] **Step 4: Restructure the transaction list rendering**

Replace the current single list rendering (lines 214-295: `coin-tx-list` div) with two accordion sections. The existing transaction row rendering logic (lines 219-293) stays the same -- just wrap it in the accordion pattern.

The new structure should be:

```tsx
{/* Transaction List */}
<div data-anim="stagger-child" className="coin-tx-list">
  {/* Recurring Section */}
  <SectionHeader sectionKey="recurring" title={t('coinify.recurringSection')} count={recurringTx.length} />
  {!collapsedSections.has('recurring') && (
    recurringTx.length === 0 ? (
      <p className="coin-empty" style={{ fontSize: '0.85rem' }}>{t('coinify.noRecurring')}</p>
    ) : (
      recurringTx.map((tx) => {
        /* same row rendering as current lines 220-292 */
      })
    )
  )}

  {/* Normal Transactions Section */}
  <SectionHeader sectionKey="transactions" title={t('coinify.transactionsSection')} count={normalTx.length} />
  {!collapsedSections.has('transactions') && (
    <>
      {/* Filters (moved from lines 199-212 into this section) */}
      <div className="coin-filters">
        {/* existing filter selects */}
      </div>
      {normalTx.length === 0 ? (
        <p className="coin-empty">{t('coinify.noTransactions')}</p>
      ) : (
        normalTx.map((tx) => {
          /* same row rendering as current lines 220-292 */
        })
      )}
    </>
  )}
</div>
```

Key changes:
1. Move the filters (currently at lines 198-212) INSIDE the transactions section, after the SectionHeader.
2. The filters only apply to `normalTx` (they already do via `loadTransactions` backend filters, but the recurring section shows ALL recurring for the month regardless).
3. Extract the row rendering into a helper function to avoid duplicating the row JSX for both sections.

Suggested helper (add before the return):
```typescript
const renderTxRow = (tx: TransactionRow) => {
  const isEntering = enteringId === tx.id;
  const isExiting = exitingId === tx.id;
  const isEditing = editingId === tx.id;

  return (
    <div
      key={tx.id}
      ref={(el) => { if (el) rowRefs.current.set(tx.id, el); else rowRefs.current.delete(tx.id); }}
      className={[
        'coin-tx',
        tx.type === 'income' ? 'coin-tx--income' : 'coin-tx--expense',
        isExiting ? 'coin-tx--exiting' : '',
        isEditing ? 'coin-tx--editing' : '',
      ].filter(Boolean).join(' ')}
    >
      {/* existing row content from lines 238-290 */}
    </div>
  );
};
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/finance/components/Transactions.tsx
git commit -m "feat(finance): add accordion sections for recurring vs normal transactions"
```
