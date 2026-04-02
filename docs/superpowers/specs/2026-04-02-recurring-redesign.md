# Rediseño de Transacciones Recurrentes — Coinify

## Contexto

Coinify tiene un sistema de transacciones recurrentes básico: se crean templates con nombre, tipo, monto, categoría, y se generan manualmente con un botón. No tienen día de cobro configurable (todo se genera con fecha día 1), no se auto-generan, y en la vista de Transacciones aparecen mezcladas con las demás sin distinción visual.

## Objetivo

1. Día de cobro configurable por recurrente (1-28)
2. Auto-generación al abrir Coinify + botón manual de fallback
3. En Transacciones, separar recurrentes de transacciones comunes en dos secciones accordion colapsables (inspirado en Questify proyectos)

## Modelo de datos

### Migration v6

```sql
ALTER TABLE finance_recurring ADD COLUMN billing_day INTEGER NOT NULL DEFAULT 1;
```

Solo eso. No hay cambios en `finance_transactions`.

## Cambios en generación

### `generateRecurringForMonth`

Actualmente genera transacciones con fecha `{month}-01`. Cambiar a `{month}-{billing_day}` usando el `billing_day` de cada recurrente.

La lógica de idempotencia no cambia — sigue checkeando `source = 'recurring' AND recurring_id = ? AND date LIKE ?`.

### Auto-generación

Al montar `Dashboard.tsx`, llamar `generateRecurringForMonth(currentMonth)`. Ya es idempotente.

El botón manual en el tab Recurrentes se mantiene como está.

## Cambios en UI — Tab Recurrentes

### Form de creación

Agregar campo `billing_day` (input numérico 1-28) al form de crear recurrente. Mismo patrón visual que `closing_day` de tarjetas de crédito.

### Lista de recurrentes

Mostrar el día de cobro en cada item, al lado del nombre o categoría. Ej: "Netflix — Día 15".

### IPC

- `finance:addRecurring` — aceptar `billingDay` en el tipo
- `finance:getRecurring` — devolver `billing_day AS billingDay`
- `finance:updateRecurring` — nuevo handler para actualizar nombre, categoría, y billingDay (no solo monto)

## Cambios en UI — Tab Transacciones

### Dos secciones accordion

Mismo patrón que Questify TaskList con proyectos:

#### Sección "Recurrentes" (arriba)
- Header colapsable: chevron SVG que rota (0° cerrado, 90° abierto) + título "Recurrentes" + count de items
- Contenido: transacciones del mes con `source === 'recurring'`
- Cada item se renderiza igual que una transacción normal

#### Sección "Transacciones" (abajo)
- Header colapsable: chevron + "Transacciones" + count
- Contenido: transacciones del mes con `source !== 'recurring'`
- Los filtros existentes (categoría, tipo, medio de pago) aplican a esta sección

### Estado colapsado

Persistido en localStorage key `coinify_collapsed_sections` como Set de strings (`'recurring'`, `'transactions'`). Mismo patrón que Questify usa `questify_collapsed_projects`.

### Separación de datos

No requiere cambios en backend. `getTransactions` ya devuelve `source` en cada transacción. La separación es puramente en el render, filtrando por `source`.

## IPC Endpoints

### Modificados
- `finance:addRecurring` — agregar `billingDay?: number` al tipo, insertar `billing_day`
- `finance:getRecurring` — agregar `billing_day AS billingDay` al SELECT
- `finance:generateRecurringForMonth` — usar `billing_day` para la fecha

### Nuevos
- Ninguno. `updateRecurring` ya no es necesario como handler nuevo — el `updateRecurringAmount` existente se puede extender o se deja como está si solo se necesita editar el monto.

## i18n

### Nuevas keys (coinify namespace)
- es: `"billingDay": "Día de cobro"`, `"recurringSection": "Recurrentes"`, `"transactionsSection": "Transacciones"`
- en: `"billingDay": "Billing day"`, `"recurringSection": "Recurring"`, `"transactionsSection": "Transactions"`
