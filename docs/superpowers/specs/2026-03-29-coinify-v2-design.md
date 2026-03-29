# Coinify v2 — Complete Finance Module Redesign

## Overview

Full redesign of the Coinify finance module within Hubtify. Replaces the current monolithic `FinanceDashboard` with a multi-page architecture focused on: daily expense tracking, credit card statement import, installment projection, loans, recurring transactions, and a clean dashboard.

## Goals

- Super simple daily expense/income entry (3-4 fields max)
- Full installment (cuotas) tracking with month-by-month projection
- Credit card statement import (PDF parsing, Galicia VISA initially)
- Loan tracking: single payment and installment-based, both directions
- Recurring expenses/income with editable amounts
- Clean dashboard: monthly balance + future projection at a glance
- Investments are just a category, not a separate tracking system

## Architecture

### Routing (sub-pages with internal navigation)

```
/finance              → Dashboard (read-only overview)
/finance/transactions → Daily expense/income list + quick add
/finance/installments → Installment tracking + monthly projection
/finance/loans        → Loans & third-party purchases
/finance/recurring    → Recurring expenses/income management
/finance/import       → Credit card statement PDF import
```

Each route is its own component. Coinify has an internal tab/nav bar for navigation between sections.

### Data Model

#### Transaction
```typescript
interface Transaction {
  id: string;
  type: 'expense' | 'income';
  amount: number;
  currency: 'ARS' | 'USD';
  category: string;
  description?: string;
  date: string;
  paymentMethod: 'cash' | 'debit' | 'transfer' | 'credit_card';
  // Credit card specific
  installments?: number;       // total installments (1 = single payment)
  installmentGroupId?: string; // links all installments of same purchase
  // Third-party purchase
  forThirdParty?: string;      // contact name if bought for someone else
  // Source tracking
  source: 'manual' | 'recurring' | 'import';
  recurringId?: string;        // links to RecurringTransaction if auto-generated
  importBatchId?: string;      // links to import session
  createdAt: string;
  updatedAt: string;
}
```

#### InstallmentGroup
```typescript
interface InstallmentGroup {
  id: string;
  description: string;
  totalAmount: number;
  installmentCount: number;
  installmentAmount: number;
  currency: 'ARS' | 'USD';
  startDate: string;            // first installment date
  category: string;
  paymentMethod: 'credit_card'; // always credit card for now
  forThirdParty?: string;       // if bought for someone else
  createdAt: string;
  updatedAt: string;
}
```

#### Loan
```typescript
interface Loan {
  id: string;
  personName: string;
  direction: 'lent' | 'borrowed';  // lent = me deben, borrowed = debo
  type: 'single' | 'installments';
  amount: number;
  currency: 'ARS' | 'USD';
  date: string;
  description?: string;
  settled: boolean;
  settledDate?: string;
  // If installment-based (linked from third-party purchase)
  installmentGroupId?: string;
  createdAt: string;
}
```

#### LoanPayment
```typescript
// Represents the third party paying YOU back (not the credit card charge itself).
// For installment-linked loans, each payment corresponds to one cuota being repaid.
// Currency is always inherited from the parent Loan — enforced by the handler.
interface LoanPayment {
  id: string;
  loanId: string;
  amount: number;
  installmentNumber?: number;   // which cuota was paid (for installment-linked loans)
  date: string;
  note?: string;
  createdAt: string;
}
```

#### RecurringTransaction
```typescript
interface RecurringTransaction {
  id: string;
  name: string;
  type: 'expense' | 'income';
  amount: number;
  currency: 'ARS' | 'USD';
  category: string;
  active: boolean;
  // Frequency is implicitly monthly. All recurrings generate on the 1st of each month.
  createdAt: string;
  updatedAt: string;
}
```

#### RecurringAmountHistory
```typescript
// Separate table — NOT stored inline on RecurringTransaction
interface RecurringAmountHistory {
  id: string;
  recurringId: string;
  previousAmount: number;
  newAmount: number;
  changedAt: string;
}
```

#### ImportBatch
```typescript
interface ImportBatch {
  id: string;
  fileName: string;
  statementMonth: string;       // which month the statement covers
  transactionCount: number;     // how many transactions were imported
  createdAt: string;
}
```

#### CategoryMapping (for smart import suggestions)
```typescript
interface CategoryMapping {
  id: string;
  merchantPattern: string;  // e.g., "RAPPI", "MERPAGO*"
  category: string;
  createdAt: string;
}
```

### Database Schema (SQLite migrations)

New tables needed:
- `finance_transactions` (redesigned with new fields)
- `finance_installment_groups`
- `finance_loans` (redesigned)
- `finance_loan_payments`
- `finance_recurring` (replaces income_sources, now handles both)
- `finance_recurring_amount_history`
- `finance_category_mappings`
- `finance_import_batches`

Migration strategy: v3 migration that creates new tables and migrates existing data from v2 tables.

### IPC Handlers

New handlers organized by domain:

**Transactions:**
- `financeGetTransactions(filters: { month?, category?, type?, paymentMethod?, installmentGroupId? })`
- `financeAddTransaction(tx)`
- `financeUpdateTransaction(id, fields)`
- `financeDeleteTransaction(id)`

**Installments:**
- `financeGetInstallmentGroups()`
- `financeGetInstallmentsForMonth(month)`
- `financeGetInstallmentProjection(months: number)` — next N months
- `financeCreateInstallmentGroup(group)` — auto-generates transactions per month

**Loans:**
- `financeGetLoans(filter?: { direction?, settled? })`
- `financeGetLoansByPerson(personName)`
- `financeAddLoan(loan)`
- `financeSettleLoan(id)`
- `financeAddLoanPayment(loanId, payment)` — for installment loans, includes `installmentNumber`
- `financeGetLoanPayments(loanId)`
- `financeCreateThirdPartyPurchase(data)` — composite: creates InstallmentGroup + Transactions + Loan atomically

**Recurring:**
- `financeGetRecurring()`
- `financeAddRecurring(rec)`
- `financeUpdateRecurringAmount(id, newAmount)` — logs to history
- `financeToggleRecurring(id)` — active/paused
- `financeDeleteRecurring(id)`
- `financeGenerateRecurringForMonth(month)` — idempotent: checks for existing `source: 'recurring'` + matching `recurringId` for the target month before creating. Safe to call multiple times.
- `financeGetRecurringAmountHistory(recurringId)`

**Import:**
- `financeImportParsePDF(filePath)` — parses Galicia VISA PDF, returns preview rows
- `financeImportConfirm(rows)` — creates transactions + installment groups from confirmed rows
- `financeGetCategoryMappings()`
- `financeUpdateCategoryMapping(merchantPattern, category)`

**Dashboard:**
- `financeGetMonthlyBalance(month?)` — returns `{ ARS: { income, expenses, balance }, USD: { income, expenses, balance } }`
- `financeGetCategoryBreakdown(month?)` — returns per-currency grouping: `Array<{ category, ARS: number, USD: number }>`
- `financeGetProjection(months: number)` — upcoming installments + recurring
- `financeGetActiveLoanSummary()` — total owed to me / I owe

**Dollar (existing, kept as-is):**
- `dollarGetRates()` — small chip in dashboard

### Behavioral Rules

#### Transaction creation from InstallmentGroup
When `financeCreateInstallmentGroup` is called, it auto-generates one Transaction per month:
- `type`: always `'expense'`
- `paymentMethod`: copied from group (`'credit_card'`)
- `date`: same day-of-month as `startDate`, incremented monthly
- `description`: auto-generated as `"{group.description} (Cuota X/{installmentCount})"`
- `category`: copied from group
- `currency`: copied from group
- `source`: `'manual'` (user-initiated)
- `installmentGroupId`: linked to group
- `forThirdParty`: copied from group if set

#### Third-party purchase composite flow
When user marks a credit card installment purchase as "for someone else":
1. `financeCreateThirdPartyPurchase` is called
2. Creates `InstallmentGroup` with `forThirdParty` set
3. Creates N `Transaction` records (one per month, as above)
4. Creates `Loan` with `direction: 'lent'`, `type: 'installments'`, linked to the group
5. All three created atomically (single DB transaction)

#### Recurring transaction auto-generation
- **Trigger**: on app open, check if current month has pending recurring generation
- **Idempotency**: before creating, check `SELECT * FROM finance_transactions WHERE source = 'recurring' AND recurringId = ? AND date LIKE '{month}%'`. If exists, skip.
- **Day**: generated on the 1st of each month
- **User can also manually trigger** from the Recurring page

#### Transaction deletion rules
- Deleting a transaction that belongs to an InstallmentGroup: allowed, but the group's data remains (it reflects the original purchase). The installment count on the group is NOT decremented.
- Deleting an InstallmentGroup: cascades to delete all linked transactions.
- Deleting a Loan: does NOT delete the linked InstallmentGroup or transactions (the credit card charges are real regardless).

#### Import → InstallmentGroup matching
When importing a PDF statement with installment rows (e.g., "FRAVEGA 05/09 $15,000"):
- **Match existing group**: search by merchant pattern + installment count + per-installment amount (within 1% tolerance for rounding)
- **If found**: link the new transaction to existing group
- **If not found**: create new group, back-calculate `startDate` from current installment number, create placeholder transactions for previous months marked as `source: 'import'`
- **Deduplication**: check if transaction with same `importBatchId` + merchant + amount + date already exists

#### Currency handling in dashboard
- Monthly balance and projections show ARS and USD separately (two numbers, not converted)
- Dollar rate chip is informational only, not used for conversions

#### Loan remaining balance
- Computed as `loan.amount - SUM(loan_payments.amount)` — no stored `remainingAmount` field
- For installment loans: progress = `COUNT(payments) / installmentGroup.installmentCount`

## Pages Detail

### 1. Dashboard (`/finance`)

Read-only overview. No data entry here (except quick-add buttons that navigate to transactions).

- **Monthly balance card**: big number showing income - expenses, with bar/donut chart by category
- **Projection card**: next month's estimated total (installments + recurring), expandable to 6-12 months
- **Active loans chip**: "Te deben: $X / Debés: $X" — clickable to `/finance/loans`
- **Dollar rate chip**: small, secondary, corner placement
- **Quick action FAB**: "+ Gasto" / "+ Ingreso" buttons → navigate to `/finance/transactions` with form open

### 2. Transactions (`/finance/transactions`)

- **Quick add form** (top, always visible or expandable):
  - Type toggle: Gasto / Ingreso
  - Amount (number input)
  - Category (dropdown, searchable)
  - Description (optional text)
  - Date (default today)
  - Payment method: Efectivo / Débito / Transferencia / Tarjeta
    - If Tarjeta → installment count input (default 1)
- **Transaction list**:
  - Month navigation (< Marzo 2026 >)
  - Filters: category, type, payment method
  - Each row: date | description | category | amount (colored by type)
  - Click to edit, swipe/button to delete

### 3. Installments (`/finance/installments`)

- **Month navigation** (< Abril 2026 >)
- **Installment list for selected month**:
  - Description, "Cuota X de Y", amount
  - Badge "→ Juan" if third-party purchase
- **Month summary**:
  - Total cuotas propias
  - Total cuotas cubiertas por tercero
  - Neto (lo que pagás vos)
- **Projection chart**: stacked bar or table showing next 6-12 months
  - Visual indicator of when installments end ("liberación")

### 4. Loans (`/finance/loans`)

- **Two tabs**: "Me deben" / "Debo"
- **Each loan card**:
  - Person name
  - Type badge: "Pago único" or "Cuotas"
  - Total amount / remaining
  - Status: active / settled
  - If installments: progress bar showing paid/remaining cuotas
  - Button to mark payment (single) or individual cuota as paid
- **Grouped by person**: if Juan owes from multiple purchases, grouped under "Juan"
- **Add loan button**: manual loan creation (direction, person, amount, type)

### 5. Recurring (`/finance/recurring`)

- **List of recurring transactions**:
  - Name, type (gasto/ingreso), current amount, category
  - Active/paused toggle
  - Edit amount button → logs previous amount to history
  - Amount change history expandable ("Gym: $15k → $18k → $22k")
- **Add recurring button**: name, type, amount, category
- **Auto-generation**: at month start, active recurrings create transactions automatically

### 6. Import (`/finance/import`)

- **Upload area**: drag & drop or file picker for PDF
- **Preview table** after parsing:
  - Date | Merchant | Installment (X/Y) | Amount | Currency | Suggested Category
  - Category dropdown per row (editable)
  - Checkbox to include/exclude each row
  - Highlight: impuestos/intereses pre-excluded by default
- **Smart categorization**:
  - Matches merchant names to saved patterns
  - "RAPPI" → Delivery (learned from user's previous categorizations)
  - New merchants get "Otros" by default
- **Confirm button** → creates transactions + installment groups
- **Initial scope**: Banco Galicia VISA format only

## PDF Parsing Strategy (Galicia VISA)

Based on actual statement analysis, the parser needs to handle:

**Line format:**
```
DATE * MERCHANT_NAME INSTALLMENT(XX/YY) RECEIPT_NUMBER AMOUNT_ARS AMOUNT_USD
```

**Key patterns:**
- Date: `DD-MM-YY`
- Installment: `XX/YY` (e.g., `05/09` = cuota 5 de 9)
- USD transactions: contain `USD` and amount in last column
- Negative amounts: refunds/returns (e.g., `DLO*RAPPI -22.590,00`)
- Exclude lines: `IMP DE SELLOS`, `INTERESES FINANCIACION`, `DB IVA`, `IIBB PERCEP`, `IVA RG`, `DB.RG 5617`, `DEV.IMP`

**Known merchants from statements:**
- MERPAGO* → MercadoPago purchases
- RAPPI / DLO*RAPPI / PROPINA*RAPPI → Delivery
- GOOGLE *YouTubeP → Suscripciones
- TWITCH → Suscripciones
- OPENAI *CHATGPT → Suscripciones
- DLO*CRUNCHYROLL → Suscripciones
- WWW.FRAVEGA.COM → Compras
- PAYU*AR*UBER → Transporte
- TELECENTRO SA → Servicios
- RAPPIPRO → Suscripciones

## RPG Integration

- `EXPENSE_LOGGED`: 5 XP (existing, maintained)
- `INCOME_LOGGED`: 5 XP
- `LOAN_SETTLED`: 10 XP (satisfying to close a loan)
- `STATEMENT_IMPORTED`: 15 XP (encourages monthly import habit)
- `RECURRING_UPDATED`: 3 XP (keeps data fresh)

## Migration from Current Coinify

v3 migration steps:

1. **finance_transactions**: Add new columns (`paymentMethod`, `source`, `installmentGroupId`, `forThirdParty`, `recurringId`, `importBatchId`). Defaults: `paymentMethod = 'cash'`, `source = 'manual'`
2. **finance_loans**: Rename `type` column to `direction` (preserving `'lent'`/`'borrowed'` values). Add new `type` column defaulting to `'single'`. Add `installmentGroupId` column.
3. **finance_income_sources** → migrate rows to new `finance_recurring` table with `type = 'income'`. Map: `name` → `name`, `estimatedAmount` → `amount`, `frequency` → dropped (all monthly), `isVariable` → dropped, `active` → `active`
4. **Create new tables**: `finance_installment_groups`, `finance_loan_payments`, `finance_recurring_amount_history`, `finance_category_mappings`, `finance_import_batches`
5. **finance_categories**: kept as-is
6. **dollar_cache**: unchanged

## Out of Scope

- Investment portfolio tracking (investments are just a category)
- Bank API integrations (manual + PDF import only)
- Multi-bank PDF import (Galicia VISA only for v2)
- Budgets / spending limits
- Savings goals
- Notifications / reminders
