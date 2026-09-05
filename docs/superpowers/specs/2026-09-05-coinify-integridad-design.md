# Coinify: integridad de cuotas, tarjeta y resumen — diseño

Fecha: 2026-09-05. Base: v0.9.9. Origen: `docs/superpowers/plans/2026-09-05-menos-es-mas-audit.md`, sección 1.

## Objetivo

Cerrar los siete bugs de severidad alta de Coinify que pierden o duplican plata en uso normal (C1, C2, C3, C4, C6, C7, C8/C9), tres bajos baratos (C11, C12, C14) y borrar el código muerto verificado. Sin cambios de UI más allá de los estrictamente necesarios para que el fix exista.

**Fuera de alcance:** C5 (import vs cargas manuales) y C10 (reimport tras editar) pertenecen al matcher de coincidencias (propuesta P2). C13, C15, C16 quedan para después. Ninguna poda de UI.

## Invariantes nuevas

1. **Toda fila con tarjeta tiene `date` dentro del mes de su `statement_period`.** Vale para manuales (ya cumplen), proyectadas (ya cumplen), importadas y materializadas (hoy no cumplen).
2. **Un plan de cuotas absorbe a lo sumo una línea por resumen.** Dos líneas iguales en un mismo PDF son dos planes.
3. **Entre planes con la misma clave, la línea va al de monto más cercano.** La identidad del plan no cambia; el monto desempata.
4. **Ninguna proyección nace en un mes anterior al del resumen que la origina.**
5. **`closing_day` de la tarjeta es configuración del usuario.** El papel no la pisa; solo la completa si está vacía.
6. **El "Pago Tarjeta" existe solo cuando el resumen está pagado**, fechado el día del pago.

## Bloque 1: cuotas y tarjeta

### C1. Fecha de las filas importadas

Hoy (`shared-logic/modules/finance-import.ipc.ts:588-610` y `materialise` `:561-571`): `date = row.date` (fecha de compra del papel), `statement_period = mes del resumen`. Las proyectadas (`:617-651`) ya usan `dateInMonthClamped(anchorMonth, díaDeCompra)`.

Cambio:

- Nueva columna `finance_transactions.purchase_date TEXT DEFAULT NULL` (migración finance v20 en `src/modules/finance/finance.schema.ts`, después de la v19 que cierra en `:591`).
- Fila importada y materializada: `purchase_date = row.date`, `date = dateInMonthClamped(statementPeriod, day(row.date))`. Misma función que las proyectadas.
- Proyectadas: **`purchase_date` queda NULL** hasta que `materialise` la escriba con la fecha del papel. Si la recibieran, `dupCheck` (que también filtra `source='import'`, `amount`, `installment_number` y otro lote) las confundiría con la cuota real del resumen siguiente cuando el banco no ajusta el monto, y esa cuota nunca se materializaría.
- Import sin tarjeta (`statementPeriod === null`): `date = row.date` como hoy, `purchase_date = row.date`. Decisión explícita: la fila importada sin tarjeta impacta balance en su fecha de compra (es un gasto en efectivo ya ocurrido); solo sus proyecciones se anclan al mes del resumen (ver C6).
- **Deduplicación entre lotes** (`dupCheck`, `finance-import.ipc.ts:460-466`): pasa a comparar `COALESCE(purchase_date, date) = ?` en lugar de `date = ?` (el `COALESCE` cubre filas que lleguen por sync desde un dispositivo sin migrar, con `purchase_date` NULL). Si no, tras C1 la fila guardada ya no tiene la fecha del papel y cada reimport duplicaría (`finance-import.dedup.test.ts:119-126`). `findGroup` sigue comparando `g.date` (fecha de compra del plan), que no cambia.
- `transactionColumns` (`shared-logic/modules/finance.ipc.ts:83-103`) expone `purchase_date AS purchaseDate`. `Transaction` en `shared/types.ts` gana `purchaseDate?: string | null`.
- Sync: `purchase_date` entra en las columnas de `finance_transactions` de `sync:getAllFinanceData` / `sync:mergeFinanceData` (`shared-logic/modules/sync.ipc.ts`). `tests/modules/sync/finance-columns.test.ts` debe seguir verde.

Migración de datos (misma v20, patrón v11 `:310-322` y v14 `:388-396`). **Las migraciones son SQL puro**: `shared-logic/db/migrate.ts:437` hace `database.exec(migration.up)` y `:446` lo parte por `;`. Nada de TS. Dos sentencias, en este orden:

```sql
-- 1. Toda fila importada guarda su fecha de compra (con o sin tarjeta), para que dupCheck matchee.
UPDATE finance_transactions
SET purchase_date = date
WHERE source = 'import' AND purchase_date IS NULL;

-- 2. Solo las que tienen período y están en el mes equivocado se mueven al mes del resumen,
--    conservando el día de compra clampeado al último día del mes.
UPDATE finance_transactions
SET date = date(
      statement_period || '-01',
      '+' || (
        min(
          CAST(substr(date, 9, 2) AS INTEGER),
          CAST(strftime('%d', date(statement_period || '-01', '+1 month', '-1 day')) AS INTEGER)
        ) - 1
      ) || ' days'
    ),
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE deleted_at IS NULL
  AND source = 'import'
  AND statement_period IS NOT NULL
  AND statement_period GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'
  AND date(statement_period || '-01') IS NOT NULL
  AND date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
  AND substr(date, 1, 7) <> statement_period;
```

Los tres guards evitan que una fila con `statement_period` o `date` malformados (posibles vía sync, que no valida el formato) produzca `date(...) = NULL` y tumben la migración entera con `NOT NULL constraint failed` al arrancar la app. Esas filas conservan su fecha y no revientan nada.

Idempotente: la segunda corrida no encuentra filas (la 1 por `purchase_date IS NULL`, la 2 porque `substr(date,1,7) = statement_period`). `updated_at` nuevo para que LWW propague la corrección a los otros dispositivos.

### C2. Editar una compra con tarjeta la desengancha

Hoy: `src/modules/finance/components/Transactions.tsx:516` manda `paymentMethod` sin `creditCardId`; `finance:updateTransaction` (`finance.ipc.ts:293-295`) pone `credit_card_id = NULL` y deja `impacts_balance = 0`.

Cambio en el handler, que es la fuente de verdad:

- Si `paymentMethod` no viene o sigue siendo `'credit_card'` y `creditCardId` es `undefined`: conservar `credit_card_id`, `impacts_balance` y `statement_period` existentes.
- Si `paymentMethod` cambia a algo distinto de `'credit_card'`: `credit_card_id = NULL`, `impacts_balance = 1`, `statement_period = NULL`.
- Si `creditCardId` viene explícito (incluido `null`): se respeta como hoy.

`saveEdit` además manda el `creditCardId` actual para que el contrato sea explícito.

### C3 / C4. Dos compras iguales en un PDF

Hoy (`finance-import.ipc.ts:489-497`): identidad del plan = `description + currency + total_installments + date(compra) + tarjeta`. `findInstallment` (`:509-515`) devuelve cualquier fila del plan con ese `installment_number`, incluidas las insertadas hace un segundo por este mismo lote.

Cambio:

- La identidad del plan NO cambia (el banco ajusta montos entre resúmenes: `finance-import.installments.test.ts:171-191` materializa la cuota 4 con 25.400 contra un plan de 25.000, y eso debe seguir funcionando). El monto es **desempate**: `findGroup` devuelve todos los candidatos con la misma clave, ordenados por `abs(monto proyectado de la cuota n − monto de la línea)` ascendente, y se toma el primero que no haya absorbido una línea de este lote.
- `findGroup` devuelve los planes candidatos; se descarta cualquiera que ya haya recibido una fila con `import_batch_id = batchId` en este lote. Si no queda ninguno, plan nuevo.
- `findInstallment` solo devuelve filas con `import_batch_id <> batchId` (o NULL). Nunca materializa sobre una fila de este mismo lote.

Efecto: dos artículos distintos en la misma tienda con distinto monto → la primera línea crea el plan A, la segunda encuentra A ya absorbido en este lote y crea B (C3). En el resumen siguiente, la línea de 10.000 va a A y la de 20.000 a B por cercanía de monto. Dos unidades del mismo artículo → dos planes (C4). Reimportar el mismo PDF → el `COUNT(*)` de duplicados (`:460-466`) sigue omitiendo las filas, como hoy.

### C6. Proyección sin tarjeta anclada en el pasado

Hoy (`:620-621`): `anchorMonth = statementPeriod ?? row.date.slice(0, 7)`. Sin tarjeta, `statementPeriod` es `null` y el ancla es el mes de compra.

Cambio: `anchorMonth = isValidMonthString(statementMonth) ? statementMonth : todayDateString().slice(0, 7)` (no existe `currentMonth()` en `shared-logic`). `statementMonth` es el parámetro que ya recibe `importConfirm` (`:427`); sin tarjeta no se guarda como `statement_period`, pero sí sirve de ancla. Las proyectadas sin tarjeta siguen con `impacts_balance = 1` y `statement_period = NULL`.

## Bloque 2: contabilidad del resumen

### C7. El papel pisa `closing_day`

Hoy: `finance:saveStatementPaper` (`finance.ipc.ts:952-955`) escribe `closing_day` y `due_day` desde el papel en cada guardado. La derivación de período para filas sin `statement_period` (`finance.balance.ts:184-204`, usada en `finance.ipc.ts:707` y `:737`) usa ese `closing_day`.

Cambio:

- `saveStatementPaper` solo completa `closing_day` / `due_day` cuando la tarjeta los tiene NULL o 0. Nunca los pisa. `closing_day` es `INTEGER NOT NULL` (`finance.schema.ts:189`) y `addCreditCard` / `updateCreditCard` rechazan `< 1` (`finance.ipc.ts:580-581, 604-607`), así que el "vacío" solo aparece en filas insertadas por SQL o por sync; el test C7 inserta la tarjeta con `closing_day = 0` por SQL directo. El caso real que protege la invariante 5 es la tarjeta creada desde el papel en `Import.tsx:293-306`, que ya nace con el cierre correcto y no debe cambiar después. El test vigente `finance.statement-paper.test.ts:107-120` (espera `closing_day = 27` desde el papel sobre una tarjeta con 25) se reescribe: tarjeta con 25 → queda 25; tarjeta con 0 → se completa con 27.
- Nueva función pura en `finance.balance.ts`: `statementPeriodForWithBoundaries(tx, closingDay, boundaries)` donde `boundaries` es la lista ordenada por `closingDate` de `{ periodMonth, closingDate }` de los resúmenes guardados de esa tarjeta (`finance_credit_card_statements.closing_date`, v19 `finance.schema.ts:559-579`). Regla, en orden:
  1. Si `tx.statementPeriod` es válido, gana.
  2. Buscar la primera frontera `b` con `b.closingDate >= tx.date`. Si no hay (la compra es posterior al último cierre conocido), caer a `getStatementPeriod(tx.date, closingDay)`.
  3. Si `b` tiene frontera anterior `a`, `a.closingDate < tx.date` **y** `a.periodMonth === addMonthsToMonth(b.periodMonth, -1)` (papeles consecutivos, sin hueco), el período es `b.periodMonth`.
  4. Si no (primer papel, o hueco entre `a` y `b`): el período es `b.periodMonth` solo si `tx.date > addMonthsClamped(b.closingDate, -1)`; si la compra es más vieja que un mes antes de `b`, caer a `getStatementPeriod`.
  5. Cualquier otro caso: `getStatementPeriod`.
- `getStatementDetail` y `computeStatementTotals` cargan las fronteras de la tarjeta una vez y usan la nueva función.
- `src/modules/finance/components/CreditCards.tsx:12-17` (`getStatementPeriodRange`) sigue mostrando el rango derivado de `closing_day`. Se acepta: es texto informativo, no suma nada. Queda anotado para P3.

### C8 / C9. Pago Tarjeta al generar, fechado el día 1

Hoy: `insertPayment` (`finance.ipc.ts:787`) inserta el "Pago Tarjeta" con `impacts_balance = 1` y `date = {period}-01` al generar el resumen. `payStatement` (`:1046-1060`) marca `paid_date = hoy` sin tocar la fecha de la transacción.

Hay DOS caminos que saldan un resumen y ambos deben producir el mismo resultado: `payStatement` (`:1011-1025`, hoy sin parámetro de fecha, `paid_date = todayDateString()`) y `saveStatementPaper` (`:983-993`, marca `paid` el resumen anterior cuando el papel trae "SU PAGO" y solo ajusta el monto de la transacción existente).

Cambio:

- Generar un resumen no inserta transacción. `transaction_id` y `transaction_id_usd` quedan NULL mientras `status = 'pending'`.
- Nueva función interna `settleStatement(db, statementId, { ars, usd, paidDate, accountId, fxRate })` en `finance.ipc.ts`, síncrona. Por cada moneda (ARS siempre; USD si `usd > 0`): si el resumen no tiene transacción para esa moneda, la inserta con `date = paidDate`, `impacts_balance = 1`, `account_id`, `category = CARD_PAYMENT_CATEGORY`, `description = `Pago tarjeta - ${periodMonth}`` (como hoy, `:788`), y guarda el id; si ya la tiene, actualiza monto y fecha. Después `status = 'paid'`, `paid_date`, montos. Nunca hay dos transacciones por moneda (hoy `payStatement` no chequea `status`).
- `payStatement` gana un quinto parámetro posicional `paidDate?: string` (validado con `isValidDateString` de `finance.balance.ts:123`, default `todayDateString()`); la firma queda `(statementId, paidAmount, paidAmountUsd?, accountId?, paidDate?)` para no romper `finance.accounts-inherit.test.ts:85,104`. Se agrega en `HubtifyApi` (`shared/types.ts`), en `api-ext.payStatement` y en `StatementDetail.tsx:91`. El handler pasa a `async`: captura `fx_rate` con `captureFxRate` (`:773`) antes de abrir la transacción y se lo pasa a `settleStatement`.
- `saveStatementPaper` (`:880`, hoy sync) también pasa a `async` por el mismo motivo, y llama a `settleStatement` con `paidDate = closingDate` del papel y `accountId = null`. Rompe `finance.statement-paper.test.ts:134-150`, que se reescribe con la nueva semántica.
- `generateStatement` auto-sanea: si el pendiente existente tiene `transaction_id` o `transaction_id_usd`, soft-delete de esa transacción y NULL en el resumen. Cubre datos que lleguen por sync desde un dispositivo sin migrar y hace la migración idempotente por construcción.
- Lectores de `transaction_id` pendiente verificados: `deleteCreditCard` (`:631-651`) y `getUpcoming` (`finance.balance.ts:1524-1546`) ya toleran NULL; ningún `.tsx` lee `transactionId`. El plan incluye igual una búsqueda `rg transaction_id|transactionId` final.
- Migración **v21** (separada de la v20 para que cada migración viaje en el mismo commit que el código que la necesita; SQL puro, dos sentencias por columna ARS/USD):

```sql
UPDATE finance_transactions
SET deleted_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE deleted_at IS NULL AND id IN (
  SELECT transaction_id FROM finance_credit_card_statements
  WHERE status = 'pending' AND deleted_at IS NULL AND transaction_id IS NOT NULL
);
UPDATE finance_credit_card_statements
SET transaction_id = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE status = 'pending' AND deleted_at IS NULL AND transaction_id IS NOT NULL;
-- ídem con transaction_id_usd
```

## Bloque 3: chicos y código muerto

- **C11**: `materialise` (`finance-import.ipc.ts:511, 564`) conserva `category` de la fila proyectada si difiere de la sugerida por el mapeo. Solo la fija cuando la proyectada tiene la categoría por defecto del import.
- **C12**: `settleLoan` (`finance.ipc.ts:1389`) y `updateRecurringAmount` (`:1696`) usan `todayDateString()`.
- **C14**: el contador de lote "N de M vigentes" (`finance-import.ipc.ts:520, 702`; `Import.tsx:850`). `liveCount` pasa a contar filas vivas del lote con `installment_group_id IS NULL`, más una por cada grupo del lote: la de `installment_number = MIN(installment_number)` dentro del lote (las proyectadas siempre tienen número mayor que la importada o materializada). El lote no guarda período, así que esta es la única regla derivable de lo persistido. Límite conocido: si el usuario borra a mano la fila importada y quedan proyectadas vivas, la de menor número cuenta como 1. Aceptable.
- **Borrar**: `finance:getLoansByPerson` (`finance.ipc.ts:1333`), `finance:deleteLoanPayment` (`:1442`), `finance:getPreviousMonthSummary` (`:1920`), `finance:getTodayTransactionsCount` (`:1086`) con sus entradas en `shared/api-channels.ts` y `shared/types.ts`; la llamada descartada a `getMonthlyTotal` en `src/modules/finance/DashboardWidget.tsx:63-66`; `transactionCount` de `getInstallmentGroups` (`finance.ipc.ts:1122`).
- **`api-ext.ts`**: tarea final, separada. El archivo tiene tres cosas: (a) `bridge()` / `hasXSupport` para canales que ya existen (`shared/api-channels.ts:207-298`), se reemplazan por `window.api.*` directo; (b) `unwrap` / `failureMessage`, usados por 12 componentes, se mueven a `src/modules/finance/utils/result.ts` sin cambios; (c) `payStatement` / `importConfirm` con lógica propia, se mueven al mismo `utils/` como funciones sin feature-detection. Después se borra el archivo. El `bridge()` de `display-mode.ts:77` queda fuera de alcance.

## Tests

Todos con `ELECTRON_RUN_AS_NODE=1 electron vitest --project unit` (con `npx vitest` directo falla por ABI de better-sqlite3).

Cada fix arranca con un test que falle:

| Fix | Test |
|---|---|
| C1 | `finance-import.installments.test.ts`: la fila importada tiene `date` en el mes del resumen y `purchase_date` = fecha de compra. Corregir los asserts de `:127-128` y `:189`. Test nuevo: `getInstallmentsForMonth(mes del resumen)` devuelve la cuota importada. |
| C1 migración | DB con una fila `source='import'`, `date='2025-05-20'`, `statement_period='2025-08'` antes de v20 → después: `date='2025-08-20'`, `purchase_date='2025-05-20'`, `updated_at` cambiado. Fila manual con tarjeta no cambia. |
| C2 | `updateTransaction` con `paymentMethod: 'credit_card'` sin `creditCardId` conserva `credit_card_id`, `impacts_balance = 0`, `statement_period`. Con `paymentMethod: 'cash'` los limpia. |
| C3 | Un PDF con dos líneas mismo comercio/fecha/N, montos 10.000 y 20.000 → dos planes, total del mes = 30.000, proyección total = 90.000. Segundo PDF con las cuotas 2 de ambos (10.100 y 20.200) → cada una materializa en su plan, siguen siendo dos planes. El test existente de 25.400 contra 25.000 sigue igual. |
| C4 | Un PDF con dos líneas idénticas → dos planes, dos filas en el mes. |
| C6 | Import sin tarjeta, cuota 3/12, `statementMonth = '2025-08'`, `row.date = '2025-05-20'` → proyectadas desde 2025-09, ninguna anterior a 2025-08. |
| C7 | Tarjeta `closing_day = 28`, papel de noviembre con `closing_date = 2025-11-26`: `closing_day` sigue en 28. Compra manual del 27/11 con papeles de nov (cierre 26) y dic (cierre 28) → período diciembre. Compra del 25/11 → noviembre. Sin papeles → derivación por `closing_day`. |
| C8/C9 | Generar resumen → `computeMonthlyBalance` no cambia, `transaction_id` NULL. `payStatement(id, ars, 0, cuenta, '2025-12-10')` → transacción con `date = '2025-12-10'`, `impacts_balance = 1`, `fx_rate` no NULL, balance de diciembre baja, noviembre no. Segundo `payStatement` sobre el mismo → sigue habiendo UNA transacción. `saveStatementPaper` con "SU PAGO" sobre pendiente anterior → transacción fechada en el `closingDate` del papel. |
| C8 migración | Resumen pending con transacción antes de v20 → transacción con `deleted_at`, `transaction_id` NULL. Resumen paid conserva la suya. `generateStatement` sobre un pendiente que trae `transaction_id` (simula sync viejo) → lo sanea. |
| C1 dedup | Reimportar el mismo PDF tras C1 → cero filas nuevas (`dupCheck` por `purchase_date`). |
| C11 | Proyectada con categoría editada a mano → tras materializar conserva la editada. |
| C12 | Con reloj fijado a las 23:30 ART, `settleLoan` fecha hoy, no mañana. |
| C14 | Lote de 1 línea 3/12 → `row_count = 1`, vigentes = 1. |
| Muertos | `npm run typecheck` y la suite completa en verde tras borrar. `finance.ipc.test.ts:865` (`getLoansByPerson`) y `finance.third-party.test.ts:84-89` (`transactionCount`) se borran o adaptan. |

Tests existentes que van a romper y hay que adaptar a la nueva semántica (no silenciar): `finance-import.installments.test.ts:127-128, 189`; `finance-import.dedup.test.ts:119-126, 175-176`; `finance-import.card.test.ts:121-140`; `finance.statement-paper.test.ts:107-120, 134-150`; `finance.review-medium.test.ts:171` y `finance.fx-rate-source.test.ts:208-210` (leen `transaction_id` del recién generado); `finance.accounts-inherit.test.ts:78-119`. Revisar también, aunque probablemente no rompan: `finance-import.usd.test.ts:108`, `finance-import.tax.test.ts:134-156`.

## Riesgos

- **Migración v20 sobre datos reales.** Corre una vez por dispositivo; LWW propaga por `updated_at`. Si dos dispositivos migran a la vez producen el mismo resultado (determinista), así que no hay conflicto real. Antes de publicar: correr la migración sobre una copia de la DB de producción del usuario y comparar totales por mes.
- **Lectores de `transaction_id` pendiente.** Cualquier componente que asuma que un resumen pendiente tiene transacción rompe. El plan incluye la búsqueda exhaustiva.
- **Fronteras por papel (C7).** Si el usuario guardó papeles salteados, la regla 3 no aplica (períodos no consecutivos) y se cae a la ventana de un mes de la regla 4 o a `closing_day`. Aceptable.
- **Sync de `purchase_date`.** Un dispositivo viejo que reciba la columna la ignora (el merge usa listas explícitas de columnas). Un dispositivo nuevo que reciba filas viejas sin `purchase_date` las deja NULL. Ambos casos son seguros.
