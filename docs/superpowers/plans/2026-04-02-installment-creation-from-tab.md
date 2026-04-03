# Installment Creation from Cuotas Tab — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to create installment groups directly from the Installments tab, with support for variable amounts (linear interpolation between first and last cuota), any payment method, and inline editing of individual cuota amounts.

**Architecture:** Extend the existing `finance:createInstallmentGroup` IPC handler to accept an optional per-cuota amounts array and a payment method. Add a form component to the Installments tab following the established QuickAddForm pattern. Add inline amount editing for individual installment transactions.

**Tech Stack:** React 19, TypeScript, better-sqlite3, Electron IPC, i18next, existing RPG-themed CSS classes.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `electron/modules/finance.ipc.ts:300-363` | Extend `createInstallmentGroup` handler: accept `installmentAmounts[]` and `paymentMethod` |
| Modify | `electron/modules/finance.ipc.ts:254-272` | Extend `getInstallmentsForMonth` to return `installmentGroupId` for edit support |
| Create | `src/modules/finance/components/shared/InstallmentAddForm.tsx` | New form component for creating installment groups |
| Modify | `src/modules/finance/components/Installments.tsx` | Integrate form + inline edit |
| Modify | `electron/preload.ts:105` | No changes needed — already passes `Record<string, unknown>` |
| Modify | `shared/types.ts:164` | No changes needed — already typed as `Record<string, unknown>` |

---

## Chunk 1: Backend — Extend createInstallmentGroup

### Task 1: Extend IPC handler to accept variable amounts and payment method

**Files:**
- Modify: `electron/modules/finance.ipc.ts:300-363`

- [ ] **Step 1: Update the handler type signature**

Add `installmentAmounts?: number[]` and `paymentMethod?: string` to the group parameter:

```typescript
ipcHandle('finance:createInstallmentGroup', (_e, group: {
  description: string;
  totalAmount: number;
  installmentCount: number;
  installmentAmount: number;
  installmentAmounts?: number[];  // NEW: per-cuota amounts
  currency?: string;
  category?: string;
  startDate: string;
  forThirdParty?: boolean;
  paymentMethod?: string;  // NEW: defaults to 'credit_card'
}) => {
```

- [ ] **Step 2: Update the transaction creation loop**

Inside the `for` loop (line 334), use per-cuota amount when available:

```typescript
for (let i = 0; i < group.installmentCount; i++) {
  const txDate = new Date(startYear, startMonth + i, startDay);
  const txDateStr = `${txDate.getFullYear()}-${String(txDate.getMonth() + 1).padStart(2, '0')}-${String(txDate.getDate()).padStart(2, '0')}`;
  const txId = genId();
  const cuotaAmount = group.installmentAmounts?.[i] ?? group.installmentAmount;

  db.prepare(`
    INSERT INTO finance_transactions
      (id, type, amount, currency, category, description, date, payment_method,
       source, installments, installment_group_id, for_third_party, recurring_id,
       import_batch_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    txId,
    'expense',
    cuotaAmount,
    group.currency ?? 'ARS',
    group.category ?? 'Otros',
    `${group.description} (Cuota ${i + 1}/${group.installmentCount})`,
    txDateStr,
    group.paymentMethod ?? 'credit_card',
    'manual',
    group.installmentCount,
    groupId,
    group.forThirdParty ? 1 : 0,
    null,
    null,
    now,
    now,
  );
}
```

Also update `totalAmount` in the group INSERT to use the sum of all cuota amounts when `installmentAmounts` is provided:

```typescript
const totalAmount = group.installmentAmounts
  ? group.installmentAmounts.reduce((a, b) => a + b, 0)
  : group.totalAmount;
```

Use `totalAmount` in the group INSERT instead of `group.totalAmount`.

- [ ] **Step 3: Commit**

```bash
git add electron/modules/finance.ipc.ts
git commit -m "feat(finance): extend createInstallmentGroup to accept variable amounts and payment method"
```

---

### Task 2: Add IPC handler to update individual installment amount

**Files:**
- Modify: `electron/modules/finance.ipc.ts` (add after `deleteInstallmentGroup` handler ~line 375)
- Modify: `electron/preload.ts` (add preload bridge)
- Modify: `shared/types.ts` (add type to HubtifyApi)

- [ ] **Step 1: Add the IPC handler**

Add after the `deleteInstallmentGroup` handler:

```typescript
ipcHandle('finance:updateInstallmentAmount', (_e, txId: string, newAmount: number) => {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE finance_transactions SET amount = ?, updated_at = ? WHERE id = ?
  `).run(newAmount, now, txId);
});
```

- [ ] **Step 2: Add preload bridge**

In `electron/preload.ts`, in the finance installments section (around line 105):

```typescript
financeUpdateInstallmentAmount: (txId: string, newAmount: number) => ipcRenderer.invoke('finance:updateInstallmentAmount', txId, newAmount),
```

- [ ] **Step 3: Add type to HubtifyApi**

In `shared/types.ts`, in the HubtifyApi interface (near line 164):

```typescript
financeUpdateInstallmentAmount: (txId: string, newAmount: number) => Promise<void>;
```

- [ ] **Step 4: Commit**

```bash
git add electron/modules/finance.ipc.ts electron/preload.ts shared/types.ts
git commit -m "feat(finance): add updateInstallmentAmount IPC handler"
```

---

## Chunk 2: Frontend — Installment Add Form

### Task 3: Create InstallmentAddForm component

**Files:**
- Create: `src/modules/finance/components/shared/InstallmentAddForm.tsx`

- [ ] **Step 1: Create the form component**

Follow the exact same pattern as `Recurring.tsx` form (inline form inside rpg-card, not the collapsible QuickAddForm pattern). Fields:

1. Description (text input)
2. Category (CategorySelect)
3. Currency toggle (ARS/USD)
4. Payment method select (cash/debit/transfer/credit_card)
5. Start date (date input)
6. Number of installments (RpgNumberInput)
7. First cuota amount (RpgNumberInput)
8. Last cuota amount (RpgNumberInput, optional — placeholder "= primera cuota")

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Currency, PaymentMethod } from '../../types';
import { CategorySelect } from './CategorySelect';
import RpgNumberInput from '../../../../shared/components/RpgNumberInput';

interface Props {
  onCreated: () => void;
}

function computeLinearAmounts(first: number, last: number, count: number): number[] {
  if (count <= 1) return [first];
  const step = (last - first) / (count - 1);
  return Array.from({ length: count }, (_, i) =>
    Math.round((first + step * i) * 100) / 100
  );
}

export default function InstallmentAddForm({ onCreated }: Props) {
  const { t } = useTranslation();
  const today = new Date().toISOString().slice(0, 10);

  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Otros');
  const [currency, setCurrency] = useState<Currency>('ARS');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('debit');
  const [startDate, setStartDate] = useState(today);
  const [installmentCount, setInstallmentCount] = useState('');
  const [firstAmount, setFirstAmount] = useState('');
  const [lastAmount, setLastAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const count = parseInt(installmentCount, 10);
    const first = parseFloat(firstAmount);
    const last = lastAmount ? parseFloat(lastAmount) : first;
    if (!description || !count || !first) return;

    setSubmitting(true);
    try {
      const amounts = first === last
        ? undefined
        : computeLinearAmounts(first, last, count);

      await window.api.financeCreateInstallmentGroup({
        description,
        totalAmount: amounts ? amounts.reduce((a, b) => a + b, 0) : first * count,
        installmentCount: count,
        installmentAmount: first,
        installmentAmounts: amounts,
        currency,
        category,
        startDate,
        paymentMethod,
      });

      // Reset form
      setDescription('');
      setInstallmentCount('');
      setFirstAmount('');
      setLastAmount('');
      onCreated();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="rpg-card coin-quick-add-form">
      <div className="coin-quick-add-form__title">
        {t('coinify.addInstallment', 'Nueva cuota')}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {/* Row 1: Description + Category */}
        <div className="coin-quick-add-form__row">
          <input
            className="rpg-input"
            style={{ flex: 1 }}
            placeholder={t('coinify.description', 'Descripcion')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
          />
          <CategorySelect value={category} onChange={setCategory} />
        </div>

        {/* Row 2: Currency + Payment Method + Start Date */}
        <div className="coin-quick-add-form__row">
          <select className="rpg-select" value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
            <option value="ARS">ARS</option>
            <option value="USD">USD</option>
          </select>
          <select className="rpg-select" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}>
            <option value="debit">{t('coinify.debit', 'Debito')}</option>
            <option value="credit_card">{t('coinify.creditCard', 'Tarjeta')}</option>
            <option value="transfer">{t('coinify.transfer', 'Transferencia')}</option>
            <option value="cash">{t('coinify.cash', 'Efectivo')}</option>
          </select>
          <input
            className="rpg-input"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
          />
        </div>

        {/* Row 3: Installment count + First amount + Last amount */}
        <div className="coin-quick-add-form__row">
          <RpgNumberInput
            value={installmentCount}
            onChange={setInstallmentCount}
            min={1}
            max={120}
            step={1}
            placeholder={t('coinify.installmentCount', 'Cuotas')}
            required
          />
          <RpgNumberInput
            value={firstAmount}
            onChange={setFirstAmount}
            min={0}
            step={100}
            placeholder={t('coinify.firstAmount', '1ra cuota $')}
            required
          />
          <RpgNumberInput
            value={lastAmount}
            onChange={setLastAmount}
            min={0}
            step={100}
            placeholder={t('coinify.lastAmount', 'Ultima cuota $')}
          />
        </div>

        <button type="submit" className="rpg-button" style={{ width: '100%' }} disabled={submitting}>
          {submitting ? '...' : t('coinify.createInstallments', 'Crear cuotas')}
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/finance/components/shared/InstallmentAddForm.tsx
git commit -m "feat(finance): add InstallmentAddForm component with linear interpolation"
```

---

### Task 4: Integrate form and inline edit into Installments tab

**Files:**
- Modify: `src/modules/finance/components/Installments.tsx`

- [ ] **Step 1: Add imports and state for the form toggle and inline edit**

At the top of the file, add import:

```typescript
import InstallmentAddForm from './shared/InstallmentAddForm';
import RpgNumberInput from '../../../shared/components/RpgNumberInput';
```

Inside the component, add state:

```typescript
const [showForm, setShowForm] = useState(false);
const [editingId, setEditingId] = useState<string | null>(null);
const [editAmount, setEditAmount] = useState('');
```

- [ ] **Step 2: Add form toggle button and form component**

Right after the `<MonthNavigator>` div (after line 111), add:

```tsx
<div style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
  <button
    className="rpg-button"
    onClick={() => setShowForm(!showForm)}
  >
    {showForm ? t('common.cancel') : t('coinify.addInstallment', 'Nueva cuota')}
  </button>
</div>

{showForm && (
  <div style={{ marginBottom: 16 }}>
    <InstallmentAddForm onCreated={() => {
      setShowForm(false);
      loadRows(month);
      loadProjection();
    }} />
  </div>
)}
```

- [ ] **Step 3: Add inline amount edit to installment rows**

Replace the amount span in the installment row (the `<span className="coin-installment__amount">` block) with:

```tsx
{editingId === row.id ? (
  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
    <RpgNumberInput
      value={editAmount}
      onChange={setEditAmount}
      min={0}
      step={100}
      autoFocus
      style={{ width: 100 }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const val = parseFloat(editAmount);
          if (val > 0) {
            window.api.financeUpdateInstallmentAmount(row.id, val).then(() => {
              setEditingId(null);
              loadRows(month);
              loadProjection();
            });
          }
        }
        if (e.key === 'Escape') setEditingId(null);
      }}
    />
  </div>
) : (
  <span
    className="coin-installment__amount"
    style={{ cursor: 'pointer' }}
    title={t('coinify.clickToEdit', 'Click para editar')}
    onClick={() => {
      setEditingId(row.id);
      setEditAmount(String(row.amount));
    }}
  >
    ${row.amount.toLocaleString('es-AR')}
  </span>
)}
```

- [ ] **Step 4: Commit**

```bash
git add src/modules/finance/components/Installments.tsx
git commit -m "feat(finance): integrate installment creation form and inline amount editing"
```

---

## Chunk 3: Translations

### Task 5: Add i18n keys

**Files:**
- Modify: i18n translation files (Spanish)

- [ ] **Step 1: Find and update translation file**

Search for the translation file with existing `coinify.*` keys and add:

```json
"coinify.addInstallment": "Nueva cuota",
"coinify.installmentCount": "Cuotas",
"coinify.firstAmount": "1ra cuota $",
"coinify.lastAmount": "Ultima cuota $",
"coinify.createInstallments": "Crear cuotas",
"coinify.clickToEdit": "Click para editar"
```

Note: All translation calls already have fallback strings as second parameter, so the app works even without these keys. This step is nice-to-have polish.

- [ ] **Step 2: Commit**

```bash
git add <translation-file>
git commit -m "feat(i18n): add installment creation translation keys"
```
