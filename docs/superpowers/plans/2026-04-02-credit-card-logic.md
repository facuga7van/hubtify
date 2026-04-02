# Credit Card Logic Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement credit card management with multiple cards, closing dates, statement generation, and two-layer tracking (individual expenses for categorization vs statement payments for cashflow).

**Architecture:** New tables for credit cards and statements. Transactions get `credit_card_id` and `impacts_balance` columns. Individual CC expenses are tracking-only (impacts_balance=0), while statement payments are real cashflow (impacts_balance=1). Period calculation uses card's closing_day to determine which statement a charge belongs to.

**Tech Stack:** Electron + React + better-sqlite3, i18next for i18n, RPG-themed UI components.

**Spec:** `docs/superpowers/specs/2026-04-02-credit-card-logic-design.md`

---

## File Structure

### New Files
- `src/modules/finance/components/CreditCards.tsx` — Credit cards page (list + statements view)
- `src/modules/finance/components/shared/CreditCardManager.tsx` — CRUD modal for cards (name + closing_day)
- `src/modules/finance/components/shared/CreditCardSelect.tsx` — Select dropdown for choosing a card
- `src/modules/finance/components/shared/StatementDetail.tsx` — Modal showing statement detail + pay flow

### Modified Files
- `src/modules/finance/finance.schema.ts` — Migration v5 (new tables + ALTER)
- `src/modules/finance/types.ts` — New interfaces (CreditCard, CreditCardStatement)
- `electron/modules/finance.ipc.ts` — New IPC handlers + modify existing queries
- `electron/preload.ts` — Expose new IPC calls
- `shared/types.ts` — Add new methods to HubtifyApi interface
- `src/modules/finance/components/shared/QuickAddForm.tsx` — Card select when payment_method=credit_card
- `src/modules/finance/components/Transactions.tsx` — Visual indicator for CC tracking transactions
- `src/modules/finance/components/FinanceLayout.tsx` — Add "Tarjetas" tab
- `src/App.tsx` — Add CreditCards route
- `src/i18n/es.json` — Spanish translations
- `src/i18n/en.json` — English translations

---

## Chunk 1: Database + Types + Backend

### Task 1: Database Migration v5

**Files:**
- Modify: `src/modules/finance/finance.schema.ts`

- [ ] **Step 1: Add migration v5 to financeMigrations array**

Add after the version 4 migration:

```typescript
  {
    namespace: 'finance',
    version: 5,
    up: `
      CREATE TABLE IF NOT EXISTS finance_credit_cards (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        closing_day INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS finance_credit_card_statements (
        id TEXT PRIMARY KEY,
        credit_card_id TEXT NOT NULL REFERENCES finance_credit_cards(id),
        period_month TEXT NOT NULL,
        calculated_amount REAL NOT NULL DEFAULT 0,
        paid_amount REAL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
        paid_date TEXT,
        transaction_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_cc_statements_card ON finance_credit_card_statements(credit_card_id);
      CREATE INDEX IF NOT EXISTS idx_cc_statements_month ON finance_credit_card_statements(period_month);

      ALTER TABLE finance_transactions ADD COLUMN credit_card_id TEXT;
      ALTER TABLE finance_transactions ADD COLUMN impacts_balance INTEGER NOT NULL DEFAULT 1;
      CREATE INDEX IF NOT EXISTS idx_finance_tx_credit_card ON finance_transactions(credit_card_id);

      INSERT OR IGNORE INTO finance_categories (name) VALUES ('Pago Tarjeta');
    `,
  },
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/finance/finance.schema.ts
git commit -m "feat(finance): add migration v5 for credit cards and statements"
```

---

### Task 2: TypeScript Types

**Files:**
- Modify: `src/modules/finance/types.ts`

- [ ] **Step 1: Add CreditCard and CreditCardStatement interfaces**

Add after the existing `CategoryMapping` interface (after line 83):

```typescript
export interface CreditCard {
  id: string;
  name: string;
  closingDay: number;
  createdAt: string;
}

export interface CreditCardStatement {
  id: string;
  creditCardId: string;
  creditCardName?: string;
  periodMonth: string;
  calculatedAmount: number;
  paidAmount: number | null;
  status: 'pending' | 'paid';
  paidDate: string | null;
  transactionId: string | null;
  createdAt: string;
}
```

- [ ] **Step 2: Add `creditCardId` and `impactsBalance` to Transaction interface**

In the `Transaction` interface, add after `importBatchId`:

```typescript
  creditCardId?: string;
  impactsBalance?: boolean;
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/finance/types.ts
git commit -m "feat(finance): add credit card TypeScript types"
```

---

### Task 3: Credit Cards CRUD IPC Handlers

**Files:**
- Modify: `electron/modules/finance.ipc.ts`

- [ ] **Step 1: Add credit cards CRUD handlers**

Add a new section after the Categories section (after the `finance:deleteCategory` handler):

```typescript
  // ── Credit Cards ──────────────────────────────────

  ipcHandle('finance:getCreditCards', () => {
    const db = getDb();
    return db.prepare(`
      SELECT id, name, closing_day AS closingDay, created_at AS createdAt
      FROM finance_credit_cards
      ORDER BY created_at ASC
    `).all();
  });

  ipcHandle('finance:addCreditCard', (_e, card: { name: string; closingDay: number }) => {
    const db = getDb();
    const id = genId();
    db.prepare('INSERT INTO finance_credit_cards (id, name, closing_day) VALUES (?, ?, ?)').run(id, card.name.trim(), card.closingDay);
    return id;
  });

  ipcHandle('finance:updateCreditCard', (_e, id: string, fields: { name?: string; closingDay?: number }) => {
    const db = getDb();
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (fields.name !== undefined) { sets.push('name = ?'); vals.push(fields.name.trim()); }
    if (fields.closingDay !== undefined) { sets.push('closing_day = ?'); vals.push(fields.closingDay); }
    if (sets.length === 0) return;
    vals.push(id);
    db.prepare(`UPDATE finance_credit_cards SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  });

  ipcHandle('finance:deleteCreditCard', (_e, id: string) => {
    const db = getDb();
    db.prepare('DELETE FROM finance_credit_cards WHERE id = ?').run(id);
  });
```

- [ ] **Step 2: Commit**

```bash
git add electron/modules/finance.ipc.ts
git commit -m "feat(finance): add credit card CRUD IPC handlers"
```

---

### Task 4: Statement IPC Handlers

**Files:**
- Modify: `electron/modules/finance.ipc.ts`

- [ ] **Step 1: Add period calculation helper**

Add this helper function inside `registerFinanceIpcHandlers` (at the top, after the `genId` usage):

```typescript
  /** Given a transaction date and a card's closing day, returns the statement period_month (YYYY-MM) */
  function getStatementPeriod(txDate: string, closingDay: number): string {
    const [y, m, d] = txDate.split('-').map(Number);
    // If day <= closingDay, it falls in this month's closing → payment next month
    // If day > closingDay, it falls in next month's closing → payment month+2
    if (d <= closingDay) {
      const dt = new Date(y, m, 1); // m is already 1-based, so m as month gives us next month (0-based)
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
    } else {
      const dt = new Date(y, m + 1, 1); // month+2
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
    }
  }
```

- [ ] **Step 2: Add statement handlers**

```typescript
  // ── Credit Card Statements ─────────────────────────

  ipcHandle('finance:getCreditCardStatements', (_e, filters: {
    creditCardId?: string;
    periodMonth?: string;
    status?: 'pending' | 'paid';
  } = {}) => {
    const db = getDb();
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.creditCardId) { conditions.push('s.credit_card_id = ?'); params.push(filters.creditCardId); }
    if (filters.periodMonth) { conditions.push('s.period_month = ?'); params.push(filters.periodMonth); }
    if (filters.status) { conditions.push('s.status = ?'); params.push(filters.status); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    return db.prepare(`
      SELECT s.id, s.credit_card_id AS creditCardId, c.name AS creditCardName,
             s.period_month AS periodMonth, s.calculated_amount AS calculatedAmount,
             s.paid_amount AS paidAmount, s.status, s.paid_date AS paidDate,
             s.transaction_id AS transactionId, s.created_at AS createdAt
      FROM finance_credit_card_statements s
      JOIN finance_credit_cards c ON c.id = s.credit_card_id
      ${where}
      ORDER BY s.period_month DESC, c.name ASC
    `).all(...params);
  });

  ipcHandle('finance:getStatementDetail', (_e, statementId: string) => {
    const db = getDb();
    const statement = db.prepare(`
      SELECT s.id, s.credit_card_id AS creditCardId, s.period_month AS periodMonth,
             s.calculated_amount AS calculatedAmount, s.paid_amount AS paidAmount,
             s.status, c.closing_day AS closingDay, c.name AS creditCardName
      FROM finance_credit_card_statements s
      JOIN finance_credit_cards c ON c.id = s.credit_card_id
      WHERE s.id = ?
    `).get(statementId) as { creditCardId: string; periodMonth: string; closingDay: number } | undefined;

    if (!statement) return null;

    // Get all CC transactions that belong to this statement period
    const transactions = db.prepare(`
      SELECT id, type, amount, currency, category, description, date,
             payment_method AS paymentMethod, source, installments,
             installment_group_id AS installmentGroupId,
             created_at AS createdAt
      FROM finance_transactions
      WHERE credit_card_id = ? AND impacts_balance = 0
      ORDER BY date DESC, created_at DESC
    `).all(statement.creditCardId);

    // Filter transactions that match this statement's period
    const filtered = (transactions as Array<{ date: string; [key: string]: unknown }>).filter((tx) => {
      return getStatementPeriod(tx.date, statement.closingDay) === statement.periodMonth;
    });

    return { statement, transactions: filtered };
  });

  ipcHandle('finance:generateStatement', (_e, creditCardId: string, periodMonth: string) => {
    const db = getDb();
    const card = db.prepare('SELECT id, closing_day AS closingDay FROM finance_credit_cards WHERE id = ?').get(creditCardId) as { id: string; closingDay: number } | undefined;
    if (!card) return null;

    // Check if already exists
    const existing = db.prepare(
      'SELECT id FROM finance_credit_card_statements WHERE credit_card_id = ? AND period_month = ?'
    ).get(creditCardId, periodMonth);
    if (existing) return (existing as { id: string }).id;

    // Sum all CC transactions for this card that fall in this period
    const allTx = db.prepare(`
      SELECT date, amount FROM finance_transactions
      WHERE credit_card_id = ? AND impacts_balance = 0
    `).all(creditCardId) as Array<{ date: string; amount: number }>;

    const total = allTx
      .filter((tx) => getStatementPeriod(tx.date, card.closingDay) === periodMonth)
      .reduce((sum, tx) => sum + tx.amount, 0);

    const statementId = genId();
    const txId = genId();
    const now = new Date().toISOString();

    // Create the payment transaction (impacts balance)
    db.prepare(`
      INSERT INTO finance_transactions
        (id, type, amount, currency, category, description, date, payment_method,
         source, installments, installment_group_id, for_third_party, recurring_id,
         import_batch_id, credit_card_id, impacts_balance, created_at, updated_at)
      VALUES (?, 'expense', ?, 'ARS', 'Pago Tarjeta', ?, ?, 'debit', 'manual', 1, NULL, 0, NULL, NULL, NULL, 1, ?, ?)
    `).run(txId, total, `Pago tarjeta - ${periodMonth}`, `${periodMonth}-01`, now, now);

    // Create the statement
    db.prepare(`
      INSERT INTO finance_credit_card_statements
        (id, credit_card_id, period_month, calculated_amount, status, transaction_id, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?)
    `).run(statementId, creditCardId, periodMonth, total, txId, now);

    return statementId;
  });

  ipcHandle('finance:payStatement', (_e, statementId: string, paidAmount: number) => {
    const db = getDb();
    const now = new Date().toISOString();
    const today = now.slice(0, 10);

    const stmt = db.prepare(
      'SELECT transaction_id AS transactionId FROM finance_credit_card_statements WHERE id = ?'
    ).get(statementId) as { transactionId: string } | undefined;

    if (!stmt) return;

    // Update statement
    db.prepare(`
      UPDATE finance_credit_card_statements
      SET paid_amount = ?, status = 'paid', paid_date = ?
      WHERE id = ?
    `).run(paidAmount, today, statementId);

    // Update the linked transaction amount to the real paid amount
    db.prepare(`
      UPDATE finance_transactions SET amount = ?, updated_at = ? WHERE id = ?
    `).run(paidAmount, now, stmt.transactionId);
  });
```

- [ ] **Step 3: Commit**

```bash
git add electron/modules/finance.ipc.ts
git commit -m "feat(finance): add statement generation and payment IPC handlers"
```

---

### Task 5: Modify Existing Queries

**Files:**
- Modify: `electron/modules/finance.ipc.ts`

- [ ] **Step 1: Update `finance:addTransaction` to accept creditCardId and impactsBalance**

In the `finance:addTransaction` handler, add to the type definition:
```typescript
    creditCardId?: string | null;
    impactsBalance?: boolean;
```

Update the INSERT to include the new columns. Change the SQL to:
```sql
INSERT INTO finance_transactions
  (id, type, amount, currency, category, description, date, payment_method,
   source, installments, installment_group_id, for_third_party, recurring_id,
   import_batch_id, credit_card_id, impacts_balance, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```

Add to the `.run()` call, before `now, now`:
```typescript
      tx.creditCardId ?? null,
      (tx.impactsBalance === false || tx.paymentMethod === 'credit_card') ? 0 : 1,
```

- [ ] **Step 2: Update `finance:getTransactions` SELECT to include new fields**

Add to the SELECT:
```sql
credit_card_id AS creditCardId,
impacts_balance AS impactsBalance,
```

- [ ] **Step 3: Update `finance:getMonthlyBalance` to filter by impacts_balance**

Change the WHERE clause from:
```sql
WHERE date LIKE ?
```
to:
```sql
WHERE date LIKE ? AND impacts_balance = 1
```

- [ ] **Step 4: Update `finance:getCategoryBreakdown` to exclude 'Pago Tarjeta'**

Change the WHERE clause from:
```sql
WHERE type = 'expense' AND date LIKE ?
```
to:
```sql
WHERE type = 'expense' AND date LIKE ? AND category != 'Pago Tarjeta'
```

- [ ] **Step 5: Update `finance:getMonthlyTotal` to filter by impacts_balance**

Change the query to add `AND impacts_balance = 1`:
```sql
SELECT COALESCE(SUM(amount), 0) AS total FROM finance_transactions WHERE type = 'expense' AND currency = 'ARS' AND impacts_balance = 1 AND date LIKE ?
```

- [ ] **Step 6: Update `finance:createInstallmentGroup` for credit card logic**

Add to the handler's type definition:
```typescript
    creditCardId?: string | null;
```

When `paymentMethod` is `'credit_card'` and `creditCardId` is provided:
- Shift all installment dates by +1 month (first cuota starts next month)
- Set `impacts_balance = 0` and `credit_card_id` on each generated transaction

Change the loop to conditionally offset:
```typescript
    const isCreditCard = (group.paymentMethod ?? 'credit_card') === 'credit_card' && group.creditCardId;
    const monthOffset = isCreditCard ? 1 : 0;

    for (let i = 0; i < group.installmentCount; i++) {
      const txDate = new Date(startYear, startMonth + i + monthOffset, startDay);
      // ... rest of loop
```

And update the INSERT to include credit_card_id and impacts_balance:
```typescript
      db.prepare(`
        INSERT INTO finance_transactions
          (id, type, amount, currency, category, description, date, payment_method,
           source, installments, installment_group_id, for_third_party, recurring_id,
           import_batch_id, credit_card_id, impacts_balance, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        isCreditCard ? group.creditCardId : null,
        isCreditCard ? 0 : 1,
        now,
        now,
      );
```

- [ ] **Step 7: Commit**

```bash
git add electron/modules/finance.ipc.ts
git commit -m "feat(finance): update existing queries for credit card two-layer logic"
```

---

### Task 6: Preload + API Types

**Files:**
- Modify: `electron/preload.ts`
- Modify: `shared/types.ts`

- [ ] **Step 1: Add new IPC calls to preload**

Add after the finance categories section:

```typescript
  // Finance - Credit Cards
  financeGetCreditCards: () => ipcRenderer.invoke('finance:getCreditCards'),
  financeAddCreditCard: (card: Record<string, unknown>) => ipcRenderer.invoke('finance:addCreditCard', card),
  financeUpdateCreditCard: (id: string, fields: Record<string, unknown>) => ipcRenderer.invoke('finance:updateCreditCard', id, fields),
  financeDeleteCreditCard: (id: string) => ipcRenderer.invoke('finance:deleteCreditCard', id),
  financeGetCreditCardStatements: (filters?: Record<string, unknown>) => ipcRenderer.invoke('finance:getCreditCardStatements', filters),
  financeGetStatementDetail: (id: string) => ipcRenderer.invoke('finance:getStatementDetail', id),
  financeGenerateStatement: (cardId: string, periodMonth: string) => ipcRenderer.invoke('finance:generateStatement', cardId, periodMonth),
  financePayStatement: (id: string, paidAmount: number) => ipcRenderer.invoke('finance:payStatement', id, paidAmount),
```

- [ ] **Step 2: Add types to HubtifyApi interface**

Add after the finance categories section in the interface:

```typescript
  // Finance - Credit Cards
  financeGetCreditCards: () => Promise<unknown[]>;
  financeAddCreditCard: (card: Record<string, unknown>) => Promise<string>;
  financeUpdateCreditCard: (id: string, fields: Record<string, unknown>) => Promise<void>;
  financeDeleteCreditCard: (id: string) => Promise<void>;
  financeGetCreditCardStatements: (filters?: Record<string, unknown>) => Promise<unknown[]>;
  financeGetStatementDetail: (id: string) => Promise<unknown>;
  financeGenerateStatement: (cardId: string, periodMonth: string) => Promise<string | null>;
  financePayStatement: (id: string, paidAmount: number) => Promise<void>;
```

- [ ] **Step 3: Commit**

```bash
git add electron/preload.ts shared/types.ts
git commit -m "feat(finance): expose credit card IPC calls in preload and types"
```

---

## Chunk 2: Frontend — Components + Integration

### Task 7: i18n Translations

**Files:**
- Modify: `src/i18n/es.json`
- Modify: `src/i18n/en.json`

- [ ] **Step 1: Add Spanish translations**

Add to the `coinify` namespace in `es.json`:

```json
    "creditCards": "Tarjetas",
    "manageCreditCards": "Gestionar tarjetas",
    "cardName": "Nombre de tarjeta",
    "closingDay": "Día de cierre",
    "newCard": "Nueva tarjeta",
    "deleteCardConfirm": "¿Eliminar esta tarjeta? Los gastos asociados no se verán afectados.",
    "selectCard": "Seleccionar tarjeta",
    "statements": "Resúmenes",
    "generateStatement": "Generar resumen",
    "statementFor": "Resumen de",
    "calculated": "Calculado",
    "paid": "Pagado",
    "pending": "Pendiente",
    "payStatement": "Pagar",
    "paidAmount": "Monto pagado",
    "statementPaid": "Pagado",
    "statementPending": "Pendiente",
    "noStatements": "No hay resúmenes para este período",
    "ccTracking": "TC"
```

- [ ] **Step 2: Add English translations**

Add to the `coinify` namespace in `en.json`:

```json
    "creditCards": "Cards",
    "manageCreditCards": "Manage credit cards",
    "cardName": "Card name",
    "closingDay": "Closing day",
    "newCard": "New card",
    "deleteCardConfirm": "Delete this card? Associated transactions won't be affected.",
    "selectCard": "Select card",
    "statements": "Statements",
    "generateStatement": "Generate statement",
    "statementFor": "Statement for",
    "calculated": "Calculated",
    "paid": "Paid",
    "pending": "Pending",
    "payStatement": "Pay",
    "paidAmount": "Paid amount",
    "statementPaid": "Paid",
    "statementPending": "Pending",
    "noStatements": "No statements for this period",
    "ccTracking": "CC"
```

- [ ] **Step 3: Commit**

```bash
git add src/i18n/es.json src/i18n/en.json
git commit -m "feat(finance): add credit card i18n translations"
```

---

### Task 8: CreditCardManager Modal

**Files:**
- Create: `src/modules/finance/components/shared/CreditCardManager.tsx`

- [ ] **Step 1: Create the CreditCardManager component**

Same modal pattern as CategoryManager but with name + closing_day fields:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '../../../../shared/components/ConfirmDialog';
import type { CreditCard } from '../../types';

interface Props {
  cards: CreditCard[];
  onClose: () => void;
  onSaved: () => void;
}

export default function CreditCardManager({ cards, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editClosingDay, setEditClosingDay] = useState(1);
  const [newName, setNewName] = useState('');
  const [newClosingDay, setNewClosingDay] = useState(1);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await window.api.financeAddCreditCard({ name: newName.trim(), closingDay: newClosingDay });
    setNewName('');
    setNewClosingDay(1);
    onSaved();
  };

  const handleUpdate = async (id: string) => {
    if (!editName.trim()) return;
    await window.api.financeUpdateCreditCard(id, { name: editName.trim(), closingDay: editClosingDay });
    setEditingId(null);
    onSaved();
  };

  const handleDelete = async (id: string) => {
    const ok = await confirm({ message: t('coinify.deleteCardConfirm'), danger: true, confirmText: t('coinify.delete') });
    if (!ok) return;
    await window.api.financeDeleteCreditCard(id);
    onSaved();
  };

  const startEdit = (card: CreditCard) => {
    setEditingId(card.id);
    setEditName(card.name);
    setEditClosingDay(card.closingDay);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(44,24,16,0.7)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div className="rpg-card" style={{ width: 480, maxHeight: '80vh', overflow: 'auto' }}
        onClick={(e) => e.stopPropagation()}>
        <div className="rpg-card-title">{t('coinify.manageCreditCards')}</div>

        {cards.map((card) => (
          <div key={card.id} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
            borderBottom: '1px solid var(--rpg-parchment-dark)',
          }}>
            {editingId === card.id ? (
              <>
                <input className="rpg-input" value={editName} onChange={(e) => setEditName(e.target.value)}
                  style={{ flex: 1 }} autoFocus onKeyDown={(e) => e.key === 'Enter' && handleUpdate(card.id)} />
                <label style={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}>{t('coinify.closingDay')}</label>
                <input type="number" className="rpg-input" value={editClosingDay}
                  onChange={(e) => setEditClosingDay(Math.min(28, Math.max(1, parseInt(e.target.value) || 1)))}
                  style={{ width: 50 }} min={1} max={28} />
                <button className="rpg-button" onClick={() => handleUpdate(card.id)}
                  style={{ padding: '3px 8px', fontSize: '0.8rem' }}>OK</button>
                <button className="rpg-button" onClick={() => setEditingId(null)}
                  style={{ padding: '3px 8px', fontSize: '0.8rem', opacity: 0.6 }}>{t('coinify.cancel')}</button>
              </>
            ) : (
              <>
                <span style={{ flex: 1, fontWeight: 'bold' }}>{card.name}</span>
                <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>
                  {t('coinify.closingDay')}: {card.closingDay}
                </span>
                <button className="rpg-button" onClick={() => startEdit(card)}
                  style={{ padding: '3px 8px', fontSize: '0.75rem', opacity: 0.6 }}>
                  {t('coinify.edit')}
                </button>
                <button className="rpg-button" onClick={() => handleDelete(card.id)}
                  style={{ padding: '3px 8px', fontSize: '0.75rem', opacity: 0.4 }}>
                  {t('coinify.delete')}
                </button>
              </>
            )}
          </div>
        ))}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
          <input className="rpg-input" placeholder={t('coinify.cardName')} value={newName}
            onChange={(e) => setNewName(e.target.value)} style={{ flex: 1 }}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()} />
          <input type="number" className="rpg-input" placeholder={t('coinify.closingDay')}
            value={newClosingDay} onChange={(e) => setNewClosingDay(Math.min(28, Math.max(1, parseInt(e.target.value) || 1)))}
            style={{ width: 50 }} min={1} max={28} />
          <button className="rpg-button" onClick={handleCreate} disabled={!newName.trim()}>
            + {t('coinify.newCard')}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/finance/components/shared/CreditCardManager.tsx
git commit -m "feat(finance): add CreditCardManager modal component"
```

---

### Task 9: CreditCardSelect Component

**Files:**
- Create: `src/modules/finance/components/shared/CreditCardSelect.tsx`

- [ ] **Step 1: Create the CreditCardSelect component**

```tsx
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { CreditCard } from '../../types';
import CreditCardManager from './CreditCardManager';

interface Props {
  value: string;
  onChange: (cardId: string) => void;
  className?: string;
}

export function CreditCardSelect({ value, onChange, className }: Props) {
  const { t } = useTranslation();
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [showManager, setShowManager] = useState(false);

  const loadCards = useCallback(() => {
    window.api.financeGetCreditCards().then((data) => setCards(data as CreditCard[]));
  }, []);

  useEffect(() => { loadCards(); }, [loadCards]);

  // Auto-select first card if none selected
  useEffect(() => {
    if (!value && cards.length > 0) onChange(cards[0].id);
  }, [cards, value, onChange]);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (e.target.value === '__manage__') {
      setShowManager(true);
      return;
    }
    onChange(e.target.value);
  };

  return (
    <>
      <select value={value} onChange={handleChange}
        className={`rpg-select ${className ?? ''}`}>
        <option value="">{t('coinify.selectCard')}</option>
        {cards.map((card) => (
          <option key={card.id} value={card.id}>{card.name} ({t('coinify.closingDay')}: {card.closingDay})</option>
        ))}
        <option disabled>───────────</option>
        <option value="__manage__">{t('coinify.manageCreditCards')}...</option>
      </select>

      {showManager && (
        <CreditCardManager cards={cards} onClose={() => setShowManager(false)} onSaved={loadCards} />
      )}
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/finance/components/shared/CreditCardSelect.tsx
git commit -m "feat(finance): add CreditCardSelect dropdown component"
```

---

### Task 10: Update QuickAddForm

**Files:**
- Modify: `src/modules/finance/components/shared/QuickAddForm.tsx`

- [ ] **Step 1: Add credit card select when payment method is credit_card**

Import the new component at the top:
```typescript
import { CreditCardSelect } from './CreditCardSelect';
```

Add state for creditCardId:
```typescript
const [creditCardId, setCreditCardId] = useState('');
```

After the existing credit_card installments conditional block (after the `RpgNumberInput` for installments), add the card select:
```tsx
        {paymentMethod === 'credit_card' && (
          <CreditCardSelect value={creditCardId} onChange={setCreditCardId} />
        )}
```

Update the `onSubmit` call to include `creditCardId`:
```typescript
        creditCardId: paymentMethod === 'credit_card' ? creditCardId : undefined,
```

Also reset creditCardId when form resets.

- [ ] **Step 2: Commit**

```bash
git add src/modules/finance/components/shared/QuickAddForm.tsx
git commit -m "feat(finance): add credit card select to QuickAddForm"
```

---

### Task 11: StatementDetail Modal

**Files:**
- Create: `src/modules/finance/components/shared/StatementDetail.tsx`

- [ ] **Step 1: Create the StatementDetail component**

```tsx
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { CreditCardStatement } from '../../types';

interface Props {
  statement: CreditCardStatement;
  onClose: () => void;
  onPaid: () => void;
}

export default function StatementDetail({ statement, onClose, onPaid }: Props) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<{ statement: unknown; transactions: Array<{
    id: string; amount: number; currency: string; category: string;
    description: string; date: string;
  }> } | null>(null);
  const [payAmount, setPayAmount] = useState(statement.calculatedAmount);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    window.api.financeGetStatementDetail(statement.id).then((d) => setDetail(d as typeof detail));
  }, [statement.id]);

  const handlePay = async () => {
    setPaying(true);
    await window.api.financePayStatement(statement.id, payAmount);
    setPaying(false);
    onPaid();
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(44,24,16,0.7)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div className="rpg-card" style={{ width: 520, maxHeight: '80vh', overflow: 'auto' }}
        onClick={(e) => e.stopPropagation()}>
        <div className="rpg-card-title">
          {t('coinify.statementFor')} {statement.creditCardName} — {statement.periodMonth}
        </div>

        <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
          <div>
            <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>{t('coinify.calculated')}</span>
            <div style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>
              ${statement.calculatedAmount.toLocaleString('es-AR')}
            </div>
          </div>
          {statement.status === 'paid' && statement.paidAmount != null && (
            <div>
              <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>{t('coinify.paid')}</span>
              <div style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>
                ${statement.paidAmount.toLocaleString('es-AR')}
              </div>
            </div>
          )}
        </div>

        <div style={{ borderTop: '1px solid var(--rpg-parchment-dark)', paddingTop: 8 }}>
          {detail?.transactions.map((tx) => (
            <div key={tx.id} style={{
              display: 'flex', justifyContent: 'space-between', padding: '4px 0',
              fontSize: '0.85rem', borderBottom: '1px solid var(--rpg-parchment-dark)',
            }}>
              <span>{tx.date} — {tx.description || tx.category}</span>
              <span style={{ fontWeight: 'bold' }}>${tx.amount.toLocaleString('es-AR')}</span>
            </div>
          ))}
        </div>

        {statement.status === 'pending' && (
          <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={{ fontSize: '0.8rem' }}>{t('coinify.paidAmount')}:</label>
            <input type="number" className="rpg-input" value={payAmount}
              onChange={(e) => setPayAmount(parseFloat(e.target.value) || 0)}
              style={{ width: 120 }} step="0.01" />
            <button className="rpg-button" onClick={handlePay} disabled={paying}>
              {t('coinify.payStatement')}
            </button>
          </div>
        )}

        {statement.status === 'paid' && (
          <div style={{ marginTop: 12, textAlign: 'center', opacity: 0.7, fontStyle: 'italic' }}>
            {t('coinify.statementPaid')} — {statement.paidDate}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/finance/components/shared/StatementDetail.tsx
git commit -m "feat(finance): add StatementDetail modal component"
```

---

### Task 12: CreditCards Page

**Files:**
- Create: `src/modules/finance/components/CreditCards.tsx`

- [ ] **Step 1: Create the CreditCards page component**

This page has two sections: card management and statements list.

```tsx
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { CreditCard, CreditCardStatement } from '../types';
import CreditCardManager from './shared/CreditCardManager';
import StatementDetail from './shared/StatementDetail';
import MonthNavigator from './shared/MonthNavigator';

export default function CreditCards() {
  const { t } = useTranslation();
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [statements, setStatements] = useState<CreditCardStatement[]>([]);
  const [showManager, setShowManager] = useState(false);
  const [selectedStatement, setSelectedStatement] = useState<CreditCardStatement | null>(null);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  const loadCards = useCallback(() => {
    window.api.financeGetCreditCards().then((data) => setCards(data as CreditCard[]));
  }, []);

  const loadStatements = useCallback(() => {
    window.api.financeGetCreditCardStatements({ periodMonth: month })
      .then((data) => setStatements(data as CreditCardStatement[]));
  }, [month]);

  useEffect(() => { loadCards(); }, [loadCards]);
  useEffect(() => { loadStatements(); }, [loadStatements]);

  const handleGenerate = async (cardId: string) => {
    await window.api.financeGenerateStatement(cardId, month);
    loadStatements();
  };

  const handlePaid = () => {
    setSelectedStatement(null);
    loadStatements();
  };

  return (
    <div className="coin-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 className="rpg-heading">{t('coinify.creditCards')}</h2>
        <button className="rpg-button" onClick={() => setShowManager(true)}>
          {t('coinify.manageCreditCards')}
        </button>
      </div>

      <MonthNavigator month={month} onChange={setMonth} />

      {/* Statements section */}
      <div style={{ marginTop: 16 }}>
        <h3 className="rpg-heading" style={{ fontSize: '1rem' }}>{t('coinify.statements')}</h3>

        {cards.map((card) => {
          const cardStatements = statements.filter((s) => s.creditCardId === card.id);
          const stmt = cardStatements[0];

          return (
            <div key={card.id} className="rpg-card" style={{ marginBottom: 8, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span style={{ fontWeight: 'bold' }}>{card.name}</span>
                  <span style={{ fontSize: '0.75rem', opacity: 0.7, marginLeft: 8 }}>
                    {t('coinify.closingDay')}: {card.closingDay}
                  </span>
                </div>

                {stmt ? (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontWeight: 'bold' }}>
                      ${stmt.calculatedAmount.toLocaleString('es-AR')}
                    </span>
                    <span style={{
                      fontSize: '0.75rem', padding: '2px 6px', borderRadius: 4,
                      background: stmt.status === 'paid' ? 'var(--rpg-success, #4a7)' : 'var(--rpg-warning, #c84)',
                      color: '#fff',
                    }}>
                      {stmt.status === 'paid' ? t('coinify.statementPaid') : t('coinify.statementPending')}
                    </span>
                    <button className="rpg-button" onClick={() => setSelectedStatement(stmt)}
                      style={{ padding: '3px 8px', fontSize: '0.8rem' }}>
                      {t('coinify.details')}
                    </button>
                  </div>
                ) : (
                  <button className="rpg-button" onClick={() => handleGenerate(card.id)}
                    style={{ fontSize: '0.8rem' }}>
                    {t('coinify.generateStatement')}
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {cards.length === 0 && (
          <p style={{ opacity: 0.6, fontStyle: 'italic' }}>{t('coinify.noStatements')}</p>
        )}
      </div>

      {showManager && (
        <CreditCardManager cards={cards} onClose={() => setShowManager(false)} onSaved={() => { loadCards(); loadStatements(); }} />
      )}

      {selectedStatement && (
        <StatementDetail statement={selectedStatement} onClose={() => setSelectedStatement(null)} onPaid={handlePaid} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/finance/components/CreditCards.tsx
git commit -m "feat(finance): add CreditCards page with statements view"
```

---

### Task 13: Routing + Tab

**Files:**
- Modify: `src/modules/finance/components/FinanceLayout.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add tab to FinanceLayout**

In the `tabs` array in `FinanceLayout.tsx`, add after the installments tab:
```typescript
  { path: '/finance/cards', label: 'coinify.creditCards' },
```

- [ ] **Step 2: Add route to App.tsx**

Import the component:
```typescript
import CreditCards from './modules/finance/components/CreditCards';
```

Add the route inside the finance Route group (after installments):
```tsx
<Route path="cards" element={<CreditCards />} />
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/finance/components/FinanceLayout.tsx src/App.tsx
git commit -m "feat(finance): add credit cards tab and route"
```

---

### Task 14: Transaction Visual Indicator

**Files:**
- Modify: `src/modules/finance/components/Transactions.tsx`

- [ ] **Step 1: Add visual indicator for CC tracking transactions**

In the `getTransactions` SELECT, the `impactsBalance` field is now returned. In the transaction row rendering (around line 259 where payment method is shown), add a badge when `impactsBalance === 0`:

After the payment method span, add:
```tsx
{tx.impactsBalance === 0 && (
  <span style={{
    fontSize: '0.65rem', padding: '1px 4px', borderRadius: 3,
    background: 'var(--rpg-parchment-dark)', color: 'var(--rpg-ink)',
    marginLeft: 4, opacity: 0.7,
  }}>
    {t('coinify.ccTracking')}
  </span>
)}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/finance/components/Transactions.tsx
git commit -m "feat(finance): add CC tracking badge to transaction list"
```

---

### Task 15: Update InstallmentAddForm for Credit Card

**Files:**
- Modify: `src/modules/finance/components/shared/InstallmentAddForm.tsx`

- [ ] **Step 1: Read the current InstallmentAddForm component**

Read `src/modules/finance/components/shared/InstallmentAddForm.tsx` to understand the current form.

- [ ] **Step 2: Add CreditCardSelect when payment method is credit_card**

Import:
```typescript
import { CreditCardSelect } from './CreditCardSelect';
```

Add state:
```typescript
const [creditCardId, setCreditCardId] = useState('');
```

Add after the payment method select (when credit_card is selected):
```tsx
{paymentMethod === 'credit_card' && (
  <CreditCardSelect value={creditCardId} onChange={setCreditCardId} />
)}
```

Pass `creditCardId` in the submit call.

- [ ] **Step 3: Commit**

```bash
git add src/modules/finance/components/shared/InstallmentAddForm.tsx
git commit -m "feat(finance): add credit card select to installment form"
```
