# Lógica de Tarjeta de Crédito — Coinify

## Contexto

Coinify es el módulo de finanzas de Hubtify (app Electron + React + better-sqlite3). Actualmente los gastos con tarjeta de crédito se tratan igual que cualquier otro gasto — impactan el balance inmediatamente y las cuotas arrancan en el mes actual. Esto no refleja la realidad: un gasto con tarjeta genera una obligación de pago futuro, no un gasto inmediato.

## Objetivo

Implementar un sistema de tarjetas de crédito con:
1. Múltiples tarjetas con fecha de cierre configurable
2. Gastos de tarjeta como tracking (no impactan balance)
3. Statements mensuales como la deuda real
4. Flujo de pago con ajuste de monto

## Principio de diseño: Dos capas

- **Capa de tracking** → gastos individuales con tarjeta. Responden "¿en qué gasté?". Aparecen en breakdown por categorías. NO impactan balance. `impacts_balance = 0`.
- **Capa de cashflow** → pago del statement. Responde "¿cuánta plata salió de mi cuenta?". Impacta balance. `impacts_balance = 1`. Categoría "Pago Tarjeta" (excluida del breakdown por categorías para no duplicar).

## Modelo de datos

### Nueva tabla `finance_credit_cards`

```sql
CREATE TABLE IF NOT EXISTS finance_credit_cards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,           -- "Visa BBVA", "Mastercard Galicia"
  closing_day INTEGER NOT NULL, -- día de cierre (1-28)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Nueva tabla `finance_credit_card_statements`

```sql
CREATE TABLE IF NOT EXISTS finance_credit_card_statements (
  id TEXT PRIMARY KEY,
  credit_card_id TEXT NOT NULL REFERENCES finance_credit_cards(id),
  period_month TEXT NOT NULL,        -- "2026-04" (mes del período)
  calculated_amount REAL NOT NULL,   -- suma de gastos individuales
  paid_amount REAL,                  -- monto real pagado (null = no pagado)
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  paid_date TEXT,
  transaction_id TEXT,               -- FK a finance_transactions (el expense del pago)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cc_statements_card ON finance_credit_card_statements(credit_card_id);
CREATE INDEX IF NOT EXISTS idx_cc_statements_month ON finance_credit_card_statements(period_month);
```

### Cambios en `finance_transactions` (migration v5)

```sql
ALTER TABLE finance_transactions ADD COLUMN credit_card_id TEXT;
ALTER TABLE finance_transactions ADD COLUMN impacts_balance INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_finance_tx_credit_card ON finance_transactions(credit_card_id);
```

### Lógica de `impacts_balance`

- Gastos con `payment_method = 'credit_card'` → `impacts_balance = 0`
- Todo lo demás (efectivo, débito, transferencia) → `impacts_balance = 1`
- Pago del statement → `impacts_balance = 1`, categoría "Pago Tarjeta"

### Seed de categoría

```sql
INSERT OR IGNORE INTO finance_categories (name) VALUES ('Pago Tarjeta');
```

## Flujo de operaciones

### 1. Crear tarjeta de crédito

CRUD simple — nombre + día de cierre. Modal RPG-themed tipo CategoryManager.

### 2. Registrar gasto con tarjeta

Desde QuickAddForm, cuando `payment_method = 'credit_card'`:
- Aparece select adicional para elegir tarjeta
- Se guarda con `impacts_balance = 0` y `credit_card_id = <tarjeta>`
- La fecha determina en qué período cae según `closing_day`

### 3. Lógica de período (closing_day)

Si la tarjeta cierra el día 15:
- Gasto del 1 al 15 de abril → período abril → statement de mayo
- Gasto del 16 al 30 de abril → período mayo → statement de junio

Fórmula: si `day(gasto) <= closing_day` → período = mes del gasto, statement = mes siguiente. Si `day(gasto) > closing_day` → período = mes siguiente del gasto, statement = mes+2.

Corrección: el "período" del statement es el mes en que SE PAGA, no el mes de los gastos. Entonces:
- Gasto del 1 al 15 de abril (cierre 15) → cae en cierre de abril → se paga en mayo → statement period = "2026-05"
- Gasto del 16 al 30 de abril (cierre 15) → cae en cierre de mayo → se paga en junio → statement period = "2026-06"

### 4. Generación del statement

Se genera automáticamente (similar a recurring) o manualmente. Al crear:
1. Suma todos los gastos de tarjeta del período para esa tarjeta
2. Crea registro en `finance_credit_card_statements` con `status = 'pending'`
3. Crea UNA transacción de expense con:
   - `impacts_balance = 1`
   - `category = 'Pago Tarjeta'`
   - `payment_method = 'debit'` (default, el pago de la tarjeta sale de tu cuenta)
   - El monto = `calculated_amount`
   - La fecha = primer día del period_month
4. Vincula la transacción al statement via `transaction_id`

### 5. Pagar el statement

El usuario va al statement pendiente:
1. Ajusta `paid_amount` si difiere del calculado (impuestos, gastos olvidados, etc.)
2. Se actualiza la transacción asociada con el monto real (`paid_amount`)
3. `status` pasa a `'paid'`, se guarda `paid_date`

### 6. Cuotas con tarjeta

Al crear grupo de cuotas con `payment_method = 'credit_card'`:
- Se elige la tarjeta
- Primera cuota arranca en el **período siguiente** según el closing_day
- Cada cuota con `impacts_balance = 0` y `credit_card_id`
- Cada cuota alimenta el statement del mes correspondiente

## Impacto en queries existentes

### `getMonthlyBalance`

Agregar `AND impacts_balance = 1` al WHERE. Los gastos individuales de tarjeta no cuentan. Solo impacta el pago del statement.

### `getCategoryBreakdown`

NO filtra por `impacts_balance` — muestra todos los gastos individuales para saber "en qué gasté". PERO excluye categoría "Pago Tarjeta" para evitar duplicación.

### `getProjection`

Incluir statements pendientes futuros (cuotas futuras ya conocidas).

### Lista de transacciones (Transactions.tsx)

Muestra todo. Gastos con `impacts_balance = 0` llevan indicador visual (badge "TC" o ícono de tarjeta, o texto más tenue) para distinguirlos.

## UI nueva

### Sección "Tarjetas" en Coinify

- Lista de tarjetas con nombre y día de cierre
- CRUD modal (como CategoryManager)

### Vista de statements

- Lista de statements por mes, agrupados por tarjeta
- Cada uno muestra: tarjeta, período, monto calculado, estado (pendiente/pagado)
- Click para detalle: gastos individuales que componen el statement
- Botón "Pagar" → input para ajustar monto → confirma → status = paid

### QuickAddForm

- Cuando `payment_method = 'credit_card'` → aparece select de tarjeta

### Indicadores visuales en lista de transacciones

- Gastos de tarjeta: badge o ícono que indique que son tracking, no balance

## IPC Endpoints nuevos

### Credit Cards CRUD

- `finance:getCreditCards` → lista de tarjetas
- `finance:addCreditCard` → crear tarjeta (name, closing_day)
- `finance:updateCreditCard` → editar tarjeta
- `finance:deleteCreditCard` → eliminar tarjeta

### Statements

- `finance:getCreditCardStatements` → lista de statements (filtro por tarjeta, mes, status)
- `finance:generateStatement` → generar statement para tarjeta+período
- `finance:payStatement` → marcar como pagado con monto real
- `finance:getStatementDetail` → gastos individuales de un statement

### Modificaciones existentes

- `finance:addTransaction` → aceptar `creditCardId` e `impactsBalance`
- `finance:getMonthlyBalance` → filtrar por `impacts_balance = 1`
- `finance:getCategoryBreakdown` → excluir categoría "Pago Tarjeta"
- `finance:createInstallmentGroup` → si es credit_card, primera cuota mes siguiente, todas con `impacts_balance = 0` y `credit_card_id`
