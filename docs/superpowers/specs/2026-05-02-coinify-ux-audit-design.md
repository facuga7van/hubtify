# Coinify UX Audit — Design Spec

**Goal:** Fix 9 high-impact UX/UI issues in the Coinify (finance) module covering data integrity, i18n, accessibility, visual consistency, and form usability.

**Architecture:** Schema-first (migration V10), then IPC handler updates, then UI fixes. Each item is independently committable.

---

## Section 1: Schema + Data Integrity

### Item 1 — Migration V10: Loan Tables + Indices

**Problem:** `finance_loans` is missing `updated_at` (added to all other finance tables in V8). `finance_loan_payments` is missing both `deleted_at` and `updated_at`. Credit card statements and loans lack performance indices.

**Current state:**
- `finance_loans` CREATE TABLE (schema line 23-34): has `created_at` but no `updated_at`
- `finance_loan_payments` CREATE TABLE (schema line 96-105): has `created_at` only
- 9 existing migrations in `finance.schema.ts`

**Solution — Migration V10:**
```sql
ALTER TABLE finance_loans ADD COLUMN updated_at TEXT DEFAULT NULL;
ALTER TABLE finance_loan_payments ADD COLUMN deleted_at TEXT DEFAULT NULL;
ALTER TABLE finance_loan_payments ADD COLUMN updated_at TEXT DEFAULT NULL;
UPDATE finance_loans SET updated_at = created_at WHERE updated_at IS NULL;
UPDATE finance_loan_payments SET updated_at = created_at WHERE updated_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_finance_statements_status ON finance_credit_card_statements(status);
CREATE INDEX IF NOT EXISTS idx_finance_loans_settled ON finance_loans(settled);
```

**Files:** `src/modules/finance/finance.schema.ts`

### Item 2 — Soft Delete + updated_at in Loan IPC Handlers

**Problem:** No `finance:deleteLoanPayment` handler exists — loan payments cannot be deleted at all. Loan-related mutations don't set `updated_at`. The `finance:getLoanPayments` query has no `deleted_at IS NULL` filter (needed after V10 adds the column).

**Solution:**
- **Create** new `finance:deleteLoanPayment` IPC handler that performs soft delete: `UPDATE finance_loan_payments SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND deleted_at IS NULL`
- Add `AND deleted_at IS NULL` to `finance:getLoanPayments` SELECT query
- Add `updated_at = datetime('now')` to loan mutations: `finance:settleLoan`, `finance:addLoanPayment`, `finance:addLoan`
- Update sync handlers in `sync.ipc.ts`:
  - `sync:getAllFinanceData` loans query (line 659): add `updated_at` to SELECT
  - `sync:getAllFinanceData` loanPayments query (line 666): add `deleted_at, updated_at` to SELECT
  - `sync:mergeFinanceData` loanPayments merge: add `deleted_at, updated_at` to INSERT, add LWW update after insert
  - **Note:** The loans merge handler uses a "settled-wins" one-way strategy (not full LWW). Rewriting the loans merge to full LWW is out of scope for this audit — we only add the `updated_at` field to the export for forward compatibility. A full loans sync rewrite is a separate task.
- Expose `deleteLoanPayment` in preload.ts and type in `shared/types.ts`

**Files:** `electron/modules/finance.ipc.ts`, `electron/modules/sync.ipc.ts`, `electron/preload.ts`, `shared/types.ts`

---

## Section 2: i18n + Empty States

### Item 3 — DashboardWidget Hardcoded Spanish

**Problem:** Line 64 of `DashboardWidget.tsx`:
```typescript
description: quickDesc.trim() || (quickType === 'expense' ? 'Gasto rapido' : 'Ingreso rapido'),
```
Hardcoded Spanish fallback instead of `t()`.

**Solution:**
```typescript
description: quickDesc.trim() || (quickType === 'expense' ? t('coinify.quickExpense', 'Gasto rápido') : t('coinify.quickIncome', 'Ingreso rápido')),
```

**i18n keys:**
- `coinify.quickExpense`: es="Gasto rápido", en="Quick expense"
- `coinify.quickIncome`: es="Ingreso rápido", en="Quick income"

**Files:** `src/modules/finance/components/DashboardWidget.tsx`, `src/i18n/es.json`, `src/i18n/en.json`

### Item 4 — Consistent Empty States

**Problem:** Loans.tsx empty state (line 194) uses inline `style={{ padding: '40px 16px' }}` and nested `<div className="qb-hand">` — inconsistent with the clean `.coin-empty-codex` pattern used everywhere else (Dashboard, Transactions, Recurring).

**Solution:** Normalize Loans.tsx empty state to match the standard pattern:
```tsx
<div className="coin-empty-codex">
  <p>{t('coinify.noLoans', 'No hay préstamos registrados')}</p>
</div>
```

Also enrich existing empty states where they're bare text:
- Transactions empty (after filter): add note that filter is active
- Recurring empty: add CTA hint text

**Files:** `src/modules/finance/components/Loans.tsx`, `src/modules/finance/components/Transactions.tsx`, `src/modules/finance/components/Recurring.tsx`

---

## Section 3: UX Polish

### Item 5 — Double-Submit Prevention in Loans

**Problem:** Loans.tsx `handleAddLoan` (line 86-134) has no `submitting` state — button stays enabled during async request, allowing double-submission.

**Note:** QuickAddForm.tsx is out of scope — it's a presentational component that calls `onSubmit` synchronously and clears immediately. The parent handles async. DashboardWidget.tsx already has `submitting` state (line 20) and disables its button during request.

**Solution:**
- **Loans.tsx**: Add `const [submitting, setSubmitting] = useState(false)`. Wrap `handleAddLoan` body in `setSubmitting(true)` / `finally { setSubmitting(false) }`. Add `disabled={submitting}` to submit button (line 373).

**Files:** `src/modules/finance/components/Loans.tsx`

### Item 6 — DollarChip Inline Styles → CSS

**Problem:** DollarChip.tsx has ~11 inline `style={{}}` blocks (lines 120, 124, 126, 132-137, 139-142, 143, 148-152, 168-172, 191-194, 196, 197-199) totaling ~70 lines of inline styles. Hard to maintain, can't be themed.

**Solution:** Extract to CSS classes in `coinify.css`:
- `.coin-dollar-menu` — dropdown container (position, background, border, shadow)
- `.coin-dollar-menu__header` — header row (flex, border-bottom)
- `.coin-dollar-menu__title` — title text (font size, weight, opacity)
- `.coin-dollar-menu__config-btn` — config toggle (+ `--active` modifier)
- `.coin-dollar-menu__checkbox` — rate toggle row (flex, gap, padding, cursor)
- `.coin-dollar-menu__checkbox--disabled` — last-item disabled state
- `.coin-dollar-menu__rate` — rate display row (flex, gap, padding)
- `.coin-dollar-menu__rate-label` — label (flex, opacity)
- `.coin-dollar-menu__rate-value` — value (monospace, bold)

**Files:** `src/modules/finance/components/shared/DollarChip.tsx`, `src/modules/finance/styles/coinify.css`

### Item 7 — Sort Headers Accessibility

**Problem:** Transactions.tsx sort headers (lines 506-517) use `<span role="button">` instead of actual `<button>` elements. Screen readers and keyboard navigation work better with semantic buttons.

**Solution:** Change `<span className="coin-sort-header" role="button" ...>` to `<button className="coin-sort-header" ...>`. Add CSS reset for button appearance:
```css
button.coin-sort-header {
  background: none;
  border: none;
  font: inherit;
  color: inherit;
  cursor: pointer;
  padding: 0;
}
button.coin-sort-header:focus-visible {
  outline: 2px solid var(--rpg-gold);
  outline-offset: 2px;
  border-radius: 2px;
}
```

**Files:** `src/modules/finance/components/Transactions.tsx`, `src/modules/finance/styles/coinify.css`

### Item 8 — Chest Panel Contrast

**Problem:** `.coin-chest-panel` uses semi-transparent background that can have contrast issues on certain backgrounds. The vertical "TESORO" label and numeric values may be hard to read.

**Solution:** Bump background opacity from 0.6/0.4 to 0.85/0.7 in CSS:
```css
.coin-chest-panel {
  background: linear-gradient(180deg, rgba(245, 231, 192, 0.85), rgba(217, 195, 138, 0.7));
}
```

Also add subtle text shadow to `.coin-chest-panel__amount` and `.coin-chest-panel__usd` values for extra legibility:
```css
.coin-chest-panel__amount,
.coin-chest-panel__usd {
  text-shadow: 0 1px 2px rgba(255, 255, 255, 0.3);
}
```

**Files:** `src/modules/finance/styles/coinify.css`

### Item 9 — Touch Targets in Recurring

**Problem:** Recurring.tsx has ~10 small action buttons (toggle, edit amount, delete, etc.) ALL using inline `style={{ padding: '2px 8px', fontSize: 'var(--fs-label)' }}` — tiny touch targets and duplicated inline styles.

**Solution:**
- Add `.coin-action-btn` class with `min-height: 32px; min-width: 32px; display: inline-flex; align-items: center; justify-content: center` for all small action buttons
- Apply to ALL small buttons in Recurring.tsx (lines ~340, 345, 354, 356, 389, 391, 403, 413, 420), replacing their inline padding/fontSize styles
- Chest button touch area is already ≥44px via chest SVG — leave as-is

**Files:** `src/modules/finance/components/Recurring.tsx`, `src/modules/finance/styles/coinify.css`

---

## Files Summary

| File | Items |
|------|-------|
| `src/modules/finance/finance.schema.ts` | 1 |
| `electron/modules/finance.ipc.ts` | 2 |
| `electron/modules/sync.ipc.ts` | 2 |
| `src/modules/finance/components/DashboardWidget.tsx` | 3 |
| `src/modules/finance/components/Loans.tsx` | 4, 5 |
| `src/modules/finance/components/Transactions.tsx` | 4, 7 |
| `src/modules/finance/components/Recurring.tsx` | 4, 9 |
| `electron/preload.ts` | 2 |
| `shared/types.ts` | 2 |
| `src/modules/finance/components/shared/DollarChip.tsx` | 6 |
| `src/modules/finance/styles/coinify.css` | 7, 8, 9 |
| `src/i18n/es.json` | 3 |
| `src/i18n/en.json` | 3 |
| `tests/modules/finance/finance-loan-soft-delete.test.ts` | 1, 2 (new) |
