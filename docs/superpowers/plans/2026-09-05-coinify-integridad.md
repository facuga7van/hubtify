# Coinify Integridad Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar los bugs C1, C2, C3/C4, C6, C7, C8/C9 (plata que se pierde o se duplica en Coinify), los tres bajos C11, C12, C14, borrar el código muerto verificado y retirar `api-ext.ts`, siguiendo la spec aprobada `docs/superpowers/specs/2026-09-05-coinify-integridad-design.md`.

**Architecture:** Toda la lógica vive en `shared-logic/modules/` (sin `electron`/`fs`/`path`/`crypto`/`better-sqlite3`; `npm run typecheck:shared-logic` lo verifica). Las migraciones finance v20 (columna + backfill) y v21 (Pago Tarjeta de pendientes) son SQL puro en `src/modules/finance/finance.schema.ts` (`migrate.ts:437` hace `database.exec(migration.up)`), cada una en el commit del código que la necesita. Las seis invariantes nuevas de la spec gobiernan cada cambio: `date` dentro del mes del `statement_period`; un plan absorbe a lo sumo una línea por resumen; entre planes con la misma clave la línea va al de monto más cercano (la identidad no cambia, el monto desempata); ninguna proyección nace antes del mes del resumen; `closing_day` es del usuario; el «Pago Tarjeta» existe solo cuando el resumen está pagado. Los tests corren contra los handlers reales con `better-sqlite3` en memoria y `getHandler(channel)` del registry.

**Tech Stack:** TypeScript 5.7, Electron 41, React 19, better-sqlite3 (tests) / sqlite-wasm (Android), Vitest 4 (`--project unit`).

---

## Reglas para todo el plan

- **Comando de tests** (es EXACTAMENTE el script `test` de `package.json:18`, más el archivo):
  `npm test -- <archivo>` → expande a `cross-env ELECTRON_RUN_AS_NODE=1 electron node_modules/vitest/vitest.mjs run --project unit <archivo>`. `npx vitest` directo falla por ABI de better-sqlite3. Suite completa: `npm test`.
- **Typecheck**: `npx tsc --noEmit` (es lo que corre CI en `.github/workflows/ci.yml:36`; NO existe `npm run typecheck`) y `npm run typecheck:shared-logic`.
- **No hacer build.** El usuario lo hace.
- **Commits**: `type(finance): descripción`, sin Co-Authored-By ni atribución a IA.
- **TDD**: cada fix arranca con un test que falla — usar `@superpowers:test-driven-development`. Escribir el test, correrlo y VER que falla por el motivo esperado, recién ahí implementar.
- **Herramientas**: `rg`, `fd`, `bat`, `sd` (no `grep`/`cat`/`find`/`sed`).
- Antes de cada commit: typecheck en verde + tests del archivo tocado en verde.
- Patrón de test (copiar de `tests/modules/finance/finance-import.installments.test.ts:18-55`): `vi.hoisted` con `harness.db`, `vi.mock('electron', …)`, `vi.mock('../../../shared-logic/db', () => ({ getDb: () => harness.db }))`, `await import(...)` de los `register*IpcHandlers`, `invoke()` sobre `getHandler(channel)`, `setupDb()` con `financeMigrations` en `:memory:`.

---

## Chunk 1: Migración v20, columnas y tipos

### Task 1: Columna `purchase_date`, backfill de fechas, `transactionColumns`, tipos y sync

**Files:**
- Modify: `src/modules/finance/finance.schema.ts` (agregar v20 después de la v19 que cierra en `:590`, antes del `];` de `:591`)
- Modify: `shared-logic/modules/finance.ipc.ts:83-103` (`transactionColumns`)
- Modify: `shared-logic/modules/sync.ipc.ts:1175-1194` (export), `:1793-1802` (insert), `:1806-1820` (update), `:1832-1862` (params)
- Modify: `src/modules/finance/types.ts:10-33` (`Transaction`)
- Test: `tests/modules/finance/finance.migration-v20.test.ts` (nuevo)
- Test (debe seguir verde): `tests/modules/sync/finance-columns.test.ts`

- [ ] **Paso 1.1 — Test de migración que falla.** Crear `tests/modules/finance/finance.migration-v20.test.ts`:

```ts
/**
 * Migración finance v20 (spec 2026-09-05-coinify-integridad):
 *  - `purchase_date`: la fecha de COMPRA que imprime el papel. `date` pasa a
 *    vivir en el mes del resumen (invariante 1).
 *  - v21: un resumen pendiente no tiene «Pago Tarjeta» (invariante 6): las que
 *    generó la versión anterior se retiran (Task 8).
 *
 * Cada migración se corre sobre una base migrada hasta la anterior con filas
 * sembradas por SQL, que es exactamente lo que va a pasar en cada dispositivo.
 */
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { financeMigrations } from '@modules/finance/finance.schema';
import type { Migration } from '../../../shared/types';

const V20 = financeMigrations.find((m) => m.version === 20);

function dbUpTo(version: number): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const m of financeMigrations) {
    if (m.version > version) break;
    db.exec(m.up);
  }
  return db;
}

const OLD_STAMP = '2026-01-01T00:00:00.000Z';

interface TxSeed { date: string; source?: string; statementPeriod?: string | null; deletedAt?: string | null }

function seedTx(db: Database.Database, id: string, seed: TxSeed): void {
  db.prepare(`
    INSERT INTO finance_transactions
      (id, type, amount, currency, category, description, date, payment_method, source,
       impacts_balance, statement_period, created_at, updated_at, deleted_at)
    VALUES (?, 'expense', 100, 'ARS', 'Otros', '', ?, 'credit_card', ?, 0, ?, ?, ?, ?)
  `).run(id, seed.date, seed.source ?? 'import', seed.statementPeriod ?? null, OLD_STAMP, OLD_STAMP, seed.deletedAt ?? null);
}

function readTx(db: Database.Database, id: string) {
  return db.prepare(
    'SELECT date, purchase_date AS purchaseDate, updated_at AS updatedAt, deleted_at AS deletedAt FROM finance_transactions WHERE id = ?',
  ).get(id) as { date: string; purchaseDate: string | null; updatedAt: string; deletedAt: string | null };
}

/** Solo los UPDATE de una migración: el ALTER ya corrió y repetirlo tiraría «duplicate column». */
function rerunBackfill(db: Database.Database, migration: Migration): void {
  for (const chunk of migration.up.split(';')) {
    const stmt = chunk.replace(/--.*$/gm, '').trim();
    if (/^UPDATE/i.test(stmt)) db.exec(stmt);
  }
}

function snapshot(db: Database.Database): unknown[] {
  return db.prepare('SELECT * FROM finance_transactions ORDER BY id').all();
}

describe('finance v20 — purchase_date y date en el mes del resumen', () => {
  it('existe y agrega la columna', () => {
    expect(V20).toBeDefined();
    const db = dbUpTo(20);
    const cols = (db.pragma('table_info(finance_transactions)') as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toContain('purchase_date');
  });

  it('mueve una importada con período al mes del resumen y guarda la fecha de compra', () => {
    const db = dbUpTo(19);
    seedTx(db, 'imp', { date: '2025-05-20', statementPeriod: '2025-08' });
    db.exec(V20!.up);
    const row = readTx(db, 'imp');
    expect(row.date).toBe('2025-08-20');
    expect(row.purchaseDate).toBe('2025-05-20');
    // updated_at nuevo: LWW tiene que propagar la corrección a los otros dispositivos.
    expect(row.updatedAt).not.toBe(OLD_STAMP);
  });

  it('clampea el día al último del mes del resumen', () => {
    const db = dbUpTo(19);
    seedTx(db, 'imp31', { date: '2025-05-31', statementPeriod: '2025-06' });
    db.exec(V20!.up);
    expect(readTx(db, 'imp31').date).toBe('2025-06-30');
  });

  it('una manual con tarjeta no cambia', () => {
    const db = dbUpTo(19);
    seedTx(db, 'man', { date: '2025-05-20', source: 'manual' });
    db.exec(V20!.up);
    const row = readTx(db, 'man');
    expect(row.date).toBe('2025-05-20');
    expect(row.purchaseDate).toBeNull();
    expect(row.updatedAt).toBe(OLD_STAMP);
  });

  it('una importada sin período conserva su fecha pero gana purchase_date', () => {
    const db = dbUpTo(19);
    seedTx(db, 'cash', { date: '2025-05-20', statementPeriod: null });
    db.exec(V20!.up);
    const row = readTx(db, 'cash');
    expect(row.date).toBe('2025-05-20');
    expect(row.purchaseDate).toBe('2025-05-20');
    expect(row.updatedAt).toBe(OLD_STAMP);
  });

  it('una importada ya en su mes no se mueve', () => {
    const db = dbUpTo(19);
    seedTx(db, 'ok', { date: '2025-08-05', statementPeriod: '2025-08' });
    db.exec(V20!.up);
    const row = readTx(db, 'ok');
    expect(row.date).toBe('2025-08-05');
    expect(row.purchaseDate).toBe('2025-08-05');
    expect(row.updatedAt).toBe(OLD_STAMP);
  });

  it('una importada borrada no se mueve', () => {
    const db = dbUpTo(19);
    seedTx(db, 'del', { date: '2025-05-20', statementPeriod: '2025-08', deletedAt: OLD_STAMP });
    db.exec(V20!.up);
    expect(readTx(db, 'del').date).toBe('2025-05-20');
  });

  it('es idempotente: la segunda corrida no cambia nada', () => {
    const db = dbUpTo(19);
    seedTx(db, 'imp', { date: '2025-05-20', statementPeriod: '2025-08' });
    seedTx(db, 'man', { date: '2025-05-20', source: 'manual' });
    db.exec(V20!.up);
    const before = snapshot(db);
    rerunBackfill(db, V20!);
    expect(snapshot(db)).toEqual(before);
  });
});
```

- [ ] **Paso 1.2 — Verlo fallar.** `npm test -- tests/modules/finance/finance.migration-v20.test.ts`. Esperado: `existe y agrega la columna` falla con `expected undefined to be defined`, el resto con `TypeError: Cannot read properties of undefined (reading 'up')`.

- [ ] **Paso 1.3 — Migración v20 (parte 1).** En `src/modules/finance/finance.schema.ts`, después del objeto `version: 19` (línea `590`: `  },`) y antes de `];`, agregar. **Copiar el SQL de la spec tal cual**; no usar backticks dentro del template:

```ts
  {
    namespace: 'finance',
    version: 20,
    up: `
      -- Fecha de COMPRA de una fila importada: la que imprime el papel. Desde
      -- ahora la fila importada (y la materializada) vive en el mes de su
      -- statement_period (invariante 1: toda fila con tarjeta tiene date dentro
      -- del mes de su resumen), y la fecha del papel queda acá para que la
      -- deduplicación entre lotes siga matcheando (COALESCE(purchase_date, date)).
      ALTER TABLE finance_transactions ADD COLUMN purchase_date TEXT DEFAULT NULL;

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
        AND substr(date, 1, 7) <> statement_period;
    `,
  },
```

- [ ] **Paso 1.4 — Verlo pasar.** `npm test -- tests/modules/finance/finance.migration-v20.test.ts` → 8 passed.

- [ ] **Paso 1.5 — `transactionColumns` expone `purchaseDate`.** En `shared-logic/modules/finance.ipc.ts:98`, después de `${p}statement_period AS statementPeriod,` agregar la línea:

```ts
  ${p}purchase_date AS purchaseDate,
```

- [ ] **Paso 1.6 — Tipo `Transaction`.** En `src/modules/finance/types.ts:10-33`, después de `transferGroupId?: string | null;` agregar:

```ts
  /** Fecha de COMPRA que imprime el papel (filas importadas). `date` es la del resumen. */
  purchaseDate?: string | null;
```

(La spec dice `shared/types.ts`, pero ahí no existe ninguna interfaz `Transaction`; ver «Discrepancias».)

- [ ] **Paso 1.7 — Sync.** Correr `npm test -- tests/modules/sync/finance-columns.test.ts` → esperado: 3 tests de `finance_transactions` fallan con `columnas ausentes … ["purchase_date"]`. Editar `shared-logic/modules/sync.ipc.ts`:
  - Export (`:1190`): después de `statement_period AS statementPeriod,` agregar `purchase_date AS purchaseDate,`.
  - Insert (`:1793-1802`): columna `purchase_date` después de `statement_period,` en la lista de columnas y un `?` más en `VALUES` (quedan 27).
  - Update (`:1806-1820`): después de `statement_period = CASE WHEN ? THEN ? ELSE statement_period END,` agregar `purchase_date = CASE WHEN ? THEN ? ELSE purchase_date END,` («ausente = sin opinión», mismo criterio que `statement_period`).
  - Loop (`:1834`): después de `const statementPeriod = …` agregar `const purchaseDate = t.purchaseDate ?? t.purchase_date ?? null;`.
  - `insertTx.run(…)` (`:1843`): después de `statementPeriod,` agregar `purchaseDate,`.
  - `updateTx.run(…)` (`:1859`): después de `('statementPeriod' in t || 'statement_period' in t) ? 1 : 0, statementPeriod,` agregar `('purchaseDate' in t || 'purchase_date' in t) ? 1 : 0, purchaseDate,`.

- [ ] **Paso 1.8 — Verificar.** `npm test -- tests/modules/sync/finance-columns.test.ts tests/modules/finance/finance.migration-v20.test.ts tests/modules/sync` → todo verde. `npx tsc --noEmit && npm run typecheck:shared-logic` → sin salida.

- [ ] **Paso 1.9 — Commit.**
```
git add src/modules/finance/finance.schema.ts shared-logic/modules/finance.ipc.ts shared-logic/modules/sync.ipc.ts src/modules/finance/types.ts tests/modules/finance/finance.migration-v20.test.ts
git commit -m "feat(finance): columna purchase_date y backfill de fechas importadas al mes del resumen (v20)"
```

---

## Chunk 2: Import — C1, C3/C4, C6, C11, C14

Todo en `shared-logic/modules/finance-import.ipc.ts` (`finance:importConfirm`, `:396-659`, y `finance:getImportBatches`, `:697-708`).

### Task 2: C1 — la fila importada vive en el mes del resumen

**Files:**
- Modify: `shared-logic/modules/finance-import.ipc.ts:460-474` (dupCheck, insertTx), `:509-515` (materialise), `:525-611` (loop), `:627-650` (proyectadas)
- Test: `tests/modules/finance/finance-import.installments.test.ts:94-106, 127-129, 186-190` + test nuevo
- Test: `tests/modules/finance/finance-import.dedup.test.ts:119-126`

- [ ] **Paso 2.1 — Adaptar asserts y agregar tests que fallan.** En `finance-import.installments.test.ts`:
  - `planRows` (`:94-106`): agregar `purchase_date AS purchaseDate,` al SELECT y `purchaseDate: string | null;` al tipo.
  - Líneas `127-129`, reemplazar por:
    ```ts
    const imported = rows[0];
    // Invariante 1: la fila importada vive en el mes del resumen; la fecha del
    // papel queda en purchase_date.
    expect(imported.date).toBe('2025-08-20');
    expect(imported.purchaseDate).toBe('2025-05-20');
    expect(imported.statementPeriod).toBe('2025-08');
    ```
  - Líneas `186-190` (test «materializa»), reemplazar por:
    ```ts
    // La cuota 4 pasó de proyectada a real: monto del papel (el banco ajusta
    // entre resúmenes), fecha en el mes del resumen de septiembre y la fecha
    // de compra del papel.
    const cuatro = rows.find((r) => r.n === 4)!;
    expect(cuatro.amount).toBeCloseTo(25_400);
    expect(cuatro.date).toBe('2025-09-20');
    expect(cuatro.purchaseDate).toBe('2025-05-20');
    expect(cuatro.statementPeriod).toBe('2025-09');
    ```
    La línea `:175` (`amountARS: 25_400`) queda INTACTA: la identidad del plan no incluye el monto.
  - Agregar dentro del `describe` un test nuevo:
    ```ts
    it('la cuota importada aparece en la pestaña Cuotas del mes del resumen, con su fecha de compra', async () => {
      await invoke('finance:importConfirm', [CUOTA_3_DE_12], '2025-08', 'agosto.pdf', cardId);

      const agosto = await invoke<Array<{ installmentNumber: number; date: string }>>(
        'finance:getInstallmentsForMonth', '2025-08',
      );
      expect(agosto).toHaveLength(1);
      expect(agosto[0].installmentNumber).toBe(3);
      expect(agosto[0].date).toBe('2025-08-20');

      // Nada en mayo: la fecha del papel no arrastra la cuota al mes de la compra.
      expect(await invoke('finance:getInstallmentsForMonth', '2025-05')).toHaveLength(0);

      // Solo la fila del papel (y las que materialice un resumen siguiente)
      // llevan purchase_date. Las proyectadas quedan en NULL: si la tuvieran,
      // dupCheck las tomaría por la cuota real del resumen siguiente cuando el
      // banco no ajusta el monto, y esa cuota nunca se materializaría.
      const [plan] = plans();
      const rows = planRows(plan.id);
      expect(rows.find((r) => r.n === 3)!.purchaseDate).toBe('2025-05-20');
      expect(rows.filter((r) => r.n > 3).every((r) => r.purchaseDate === null)).toBe(true);

      // Y el ledger la expone como purchaseDate.
      const [row] = await invoke<Array<{ purchaseDate: string | null }>>('finance:getTransactions', { month: '2025-08' });
      expect(row.purchaseDate).toBe('2025-05-20');
    });
    ```
  - En `finance-import.dedup.test.ts:119-126`, reemplazar el test por:
    ```ts
    it('re-importing the SAME statement is still a duplicate (dedup por purchase_date)', async () => {
      await invoke('finance:importConfirm', [fridge(4)], '2026-09', 'sep.pdf', cardId);
      const again = await invoke<ImportResult>('finance:importConfirm', [fridge(4)], '2026-09', 'sep.pdf', cardId);
      expect(again.count).toBe(0);
      expect(again.duplicateCount).toBe(1);
      // La 4 del papel y las 8 que faltan del plan; el segundo import no suma nada.
      expect(liveImportRows()).toHaveLength(9);
      // La fila guardada ya NO tiene la fecha del papel en `date`: dupCheck matchea por purchase_date.
      const row = harness.db.prepare(
        "SELECT date, purchase_date AS purchaseDate FROM finance_transactions WHERE installment_number = 4 AND deleted_at IS NULL",
      ).get() as { date: string; purchaseDate: string };
      expect(row.date).toBe('2026-09-10');
      expect(row.purchaseDate).toBe('2026-05-10');
    });
    ```

- [ ] **Paso 2.2 — Verlos fallar.** `npm test -- tests/modules/finance/finance-import.installments.test.ts tests/modules/finance/finance-import.dedup.test.ts`. Esperado: fallan `crea el plan…` (`expected '2025-05-20' to be '2025-08-20'`), `la cuota importada aparece…`, `materializa…`, y el dedup (`expected '2026-05-10' to be '2026-09-10'`).

- [ ] **Paso 2.3 — Implementar.** En `finance-import.ipc.ts`:
  - `dupCheck` (`:460-466`): cambiar `AND date = ? AND description = ?` por `AND COALESCE(purchase_date, date) = ? AND description = ?`. Actualizar el comentario de arriba: la clave compara la fecha DEL PAPEL, que desde v20 vive en `purchase_date` (`COALESCE` cubre filas sincronizadas desde un dispositivo sin migrar).
  - `insertTx` (`:468-474`), reemplazar por:
    ```ts
    const insertTx = db.prepare(
      `INSERT INTO finance_transactions
       (id, type, amount, currency, category, description, date, purchase_date, payment_method, source, import_batch_id,
        installments, installment_number, billed_amount_ars, credit_card_id, impacts_balance,
        statement_period, fx_rate, fx_rate_source, account_id, installment_group_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'import', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    ```
  - `materialise` (`:509-515`), reemplazar por:
    ```ts
    // La cuota proyectada pasa a ser la del papel: monto real, fecha en el mes
    // del resumen, fecha de compra y el resumen al que pertenece. No se agrega otra fila.
    const materialise = db.prepare(
      `UPDATE finance_transactions
          SET type = ?, amount = ?, currency = ?, category = ?, description = ?, date = ?, purchase_date = ?,
              billed_amount_ars = ?, statement_period = ?, import_batch_id = ?,
              fx_rate = ?, fx_rate_source = ?, account_id = ?, updated_at = ?
        WHERE id = ?`,
    );
    ```
  - En el loop, después de `const installmentNumber = …` (`:536`) agregar:
    ```ts
    // Invariante 1: con tarjeta la fila vive en el mes del resumen (mismo día
    // de compra, clampeado); la fecha del papel queda en purchase_date. Sin
    // tarjeta es un gasto en efectivo que ya ocurrió: impacta en su fecha real.
    const rowDate = statementPeriod === null
      ? row.date
      : dateInMonthClamped(statementPeriod, Number(row.date.slice(8, 10)));
    ```
  - `materialise.run(…)` (`:563-568`): cambiar `row.merchant, row.date,` por `row.merchant, rowDate, row.date,`.
  - `insertTx.run(…)` de la fila importada (`:588-610`): cambiar `row.date,\n            paymentMethod,` por `rowDate,\n            row.date,\n            paymentMethod,`.
  - `insertTx.run(…)` de las proyectadas (`:627-649`): `insertTx` ganó la columna `purchase_date`, así que hay que pasar un valor en esa posición, y es **`null`**: cambiar `addMonthsClamped(anchorDate, offset),\n                paymentMethod,` por `addMonthsClamped(anchorDate, offset),\n                null,\n                paymentMethod,`. Agregar arriba el comentario:
    ```ts
              // purchase_date queda NULL hasta que materialise la escriba con la
              // fecha del papel. Si la proyectada la tuviera, dupCheck (que además
              // filtra source='import', amount, installment_number y otro lote) la
              // confundiría con la cuota real del resumen siguiente cuando el banco
              // no ajusta el monto, y esa cuota nunca se materializaría.
    ```

- [ ] **Paso 2.4 — Verlos pasar.** `npm test -- tests/modules/finance/finance-import.installments.test.ts tests/modules/finance/finance-import.dedup.test.ts tests/modules/finance/finance-import.card.test.ts tests/modules/finance/finance-import.tax.test.ts tests/modules/finance/finance-import.usd.test.ts` → todo verde (el usd y el tax no cambian: sus asserts miran totales del resumen por `statement_period`).

- [ ] **Paso 2.5 — Typecheck y commit.** `npx tsc --noEmit && npm run typecheck:shared-logic`.
```
git add shared-logic/modules/finance-import.ipc.ts tests/modules/finance/finance-import.installments.test.ts tests/modules/finance/finance-import.dedup.test.ts
git commit -m "fix(finance): la fila importada vive en el mes del resumen y dedupa por purchase_date (C1)"
```

### Task 3: C3/C4 — dos compras iguales en un PDF son dos planes

La identidad del plan NO cambia (comercio + fecha + moneda + total de cuotas + tarjeta): el banco ajusta montos entre resúmenes (`installments.test.ts:171-191`, 25.400 contra 25.000, sigue igual). El monto es DESEMPATE: `findGroup` ordena los candidatos por `abs(monto proyectado de la cuota n − monto de la línea)` y toma el primero que no haya absorbido una línea de este lote.

**Files:**
- Modify: `shared-logic/modules/finance-import.ipc.ts:489-506` (findGroup, findInstallment), `:555-561`, `:625`
- Test: `tests/modules/finance/finance-import.plans.test.ts` (nuevo)

- [ ] **Paso 3.1 — Tests que fallan.** Crear `tests/modules/finance/finance-import.plans.test.ts` con el mismo arnés de `finance-import.installments.test.ts:18-62` (mismos mocks, `invoke`, `setupDb`, `beforeEach` con `cardId`) y:

```ts
const LINE = {
  date: '2025-05-20',
  merchant: 'TIENDA MUEBLES',
  installmentCurrent: 1,
  installmentTotal: 3,
  amountARS: 10_000,
  isExcluded: false,
  suggestedCategory: 'Compras',
};

function plans() {
  return harness.db.prepare(
    `SELECT id, total_amount AS totalAmount, category FROM finance_installment_groups
      WHERE deleted_at IS NULL ORDER BY total_amount ASC`,
  ).all() as Array<{ id: string; totalAmount: number; category: string }>;
}

function liveRows(groupId?: string) {
  const where = groupId ? 'AND installment_group_id = ?' : '';
  return harness.db.prepare(
    `SELECT installment_number AS n, date, amount, category, installment_group_id AS groupId,
            import_batch_id AS batchId
       FROM finance_transactions WHERE deleted_at IS NULL ${where}
      ORDER BY installment_group_id, installment_number`,
  ).all(...(groupId ? [groupId] : [])) as Array<{
    n: number | null; date: string; amount: number; category: string; groupId: string | null; batchId: string | null;
  }>;
}

async function monthTotal(month: string): Promise<number> {
  const rows = await invoke<Array<{ amount: number }>>('finance:getInstallmentsForMonth', month);
  return rows.reduce((acc, r) => acc + r.amount, 0);
}

describe('C3 — dos artículos distintos de la misma tienda, mismo día, misma cuota N/M', () => {
  it('son dos planes: el monto forma parte de la identidad', async () => {
    const cheap = LINE;
    const dear = { ...LINE, amountARS: 20_000 };
    const res = await invoke<{ count: number; duplicateCount: number }>(
      'finance:importConfirm', [cheap, dear], '2025-08', 'agosto.pdf', cardId,
    );
    expect(res.count).toBe(2);
    expect(res.duplicateCount).toBe(0);

    const found = plans();
    expect(found.map((p) => p.totalAmount)).toEqual([30_000, 60_000]);
    // Total del mes del resumen = las dos cuotas 1/3; proyección total = 90.000.
    expect(await monthTotal('2025-08')).toBe(30_000);
    expect(liveRows().reduce((acc, r) => acc + r.amount, 0)).toBe(90_000);
  });

  it('el resumen siguiente manda cada cuota 2 a SU plan, por cercanía de monto', async () => {
    await invoke('finance:importConfirm', [LINE, { ...LINE, amountARS: 20_000 }], '2025-08', 'agosto.pdf', cardId);
    const [planA, planB] = plans(); // 30.000 (10.000 × 3) y 60.000 (20.000 × 3)

    // El banco ajustó: 10.100 y 20.200. Y llegan en orden inverso a propósito:
    // el desempate es por monto, no por posición en el PDF.
    const res = await invoke<{ count: number; duplicateCount: number }>(
      'finance:importConfirm',
      [{ ...LINE, installmentCurrent: 2, amountARS: 20_200 }, { ...LINE, installmentCurrent: 2, amountARS: 10_100 }],
      '2025-09', 'septiembre.pdf', cardId,
    );
    expect(res.count).toBe(2);
    expect(res.duplicateCount).toBe(0);
    expect(plans()).toHaveLength(2);

    expect(liveRows(planA.id).map((r) => [r.n, r.amount])).toEqual([[1, 10_000], [2, 10_100], [3, 10_000]]);
    expect(liveRows(planB.id).map((r) => [r.n, r.amount])).toEqual([[1, 20_000], [2, 20_200], [3, 20_000]]);
  });
});

describe('C4 — dos unidades del mismo artículo', () => {
  it('dos líneas idénticas en un PDF son dos planes y dos filas en el mes', async () => {
    const res = await invoke<{ count: number; duplicateCount: number }>(
      'finance:importConfirm', [LINE, { ...LINE }], '2025-08', 'agosto.pdf', cardId,
    );
    expect(res.count).toBe(2);
    expect(plans()).toHaveLength(2);
    expect(await invoke('finance:getInstallmentsForMonth', '2025-08')).toHaveLength(2);
    // Cada plan tiene sus 3 cuotas: nadie materializó sobre una fila de este mismo lote.
    for (const p of plans()) expect(liveRows(p.id).map((r) => r.n)).toEqual([1, 2, 3]);
  });

  it('reimportar el mismo PDF sigue sin duplicar', async () => {
    await invoke('finance:importConfirm', [LINE, { ...LINE }], '2025-08', 'agosto.pdf', cardId);
    const again = await invoke<{ count: number; duplicateCount: number }>(
      'finance:importConfirm', [LINE, { ...LINE }], '2025-08', 'agosto.pdf', cardId,
    );
    expect(again.count).toBe(0);
    expect(again.duplicateCount).toBe(2);
    expect(plans()).toHaveLength(2);
  });

  it('el resumen siguiente materializa la cuota 2 de CADA plan', async () => {
    await invoke('finance:importConfirm', [LINE, { ...LINE }], '2025-08', 'agosto.pdf', cardId);
    const second = { ...LINE, installmentCurrent: 2 };
    const res = await invoke<{ count: number }>(
      'finance:importConfirm', [second, { ...second }], '2025-09', 'septiembre.pdf', cardId,
    );
    expect(res.count).toBe(2);
    expect(plans()).toHaveLength(2);
    expect(liveRows()).toHaveLength(6);
    // Las dos cuotas 2 quedaron marcadas con el lote de septiembre, una por plan.
    const sept = liveRows().filter((r) => r.n === 2);
    expect(new Set(sept.map((r) => r.groupId)).size).toBe(2);
    expect(new Set(sept.map((r) => r.batchId)).size).toBe(1);
  });
});
```

- [ ] **Paso 3.2 — Verlos fallar.** `npm test -- tests/modules/finance/finance-import.plans.test.ts`. Esperado: C3 falla en `plans()` (1 plan, `[30000]`), C4 en `toHaveLength(2)` (hoy la segunda línea materializa sobre la fila recién insertada); el de «cada cuota 2 a SU plan» falla porque hoy hay un solo plan.

- [ ] **Paso 3.3 — Implementar.** Reemplazar `findGroup` (`:489-497`) por:

```ts
    // Identidad del plan: comercio + fecha de compra + moneda + total de
    // cuotas + tarjeta. Galicia imprime la fecha ORIGINAL de la compra en cada
    // cuota, así que la clave es estable entre resúmenes consecutivos y el
    // segundo import encuentra el plan del primero en vez de duplicarlo. El
    // monto NO es identidad (el banco lo ajusta entre resúmenes): es DESEMPATE.
    // Los candidatos se ordenan por cercanía entre el monto de la línea y el de
    // la cuota n ya proyectada en el plan (o el promedio del plan si esa cuota
    // no existe todavía, resúmenes desordenados), y se toma el primero que no
    // haya absorbido una línea de ESTE lote: un plan absorbe a lo sumo una
    // línea por resumen (invariante 2). Dos artículos distintos de la misma
    // tienda, el mismo día y en la misma cantidad de cuotas → dos planes, y en
    // el resumen siguiente cada cuota vuelve al suyo por monto.
    // La tarjeta no vive en el grupo, así que se mira en sus filas.
    const findGroup = db.prepare(
      `SELECT g.id AS id, g.category AS category FROM finance_installment_groups g
        WHERE g.deleted_at IS NULL AND g.description = ? AND g.currency = ?
          AND g.total_installments = ? AND g.date = ?
          AND EXISTS (SELECT 1 FROM finance_transactions t
                       WHERE t.installment_group_id = g.id AND t.deleted_at IS NULL
                         AND t.credit_card_id IS ?)
          AND NOT EXISTS (SELECT 1 FROM finance_transactions t
                           WHERE t.installment_group_id = g.id AND t.import_batch_id = ?)
        ORDER BY abs(
            COALESCE(
              (SELECT t.amount FROM finance_transactions t
                WHERE t.installment_group_id = g.id AND t.installment_number = ?
                  AND t.deleted_at IS NULL
                ORDER BY t.created_at ASC LIMIT 1),
              g.total_amount / g.total_installments
            ) - ?
          ) ASC,
          g.created_at ASC
        LIMIT 1`,
    );
```

Reemplazar `findInstallment` (`:503-506`) por:

```ts
    // Nunca materializa sobre una fila de este mismo lote: solo las que vienen
    // de lotes anteriores (o de ninguno) cuentan como «ya existe».
    const findInstallment = db.prepare(
      `SELECT id, category FROM finance_transactions
        WHERE installment_group_id = ? AND installment_number = ? AND deleted_at IS NULL
          AND (import_batch_id IS NULL OR import_batch_id <> ?)
        LIMIT 1`,
    );
```

Llamadas:
  - `:555-557`: `findGroup.get(row.merchant, currency, totalInstallments, row.date, cardId, batchId, installmentNumber, amount) as { id: string; category: string } | undefined;`
  - `:561`: `findInstallment.get(groupId, installmentNumber, batchId) as { id: string; category: string } | undefined;`
  - `:625`: `if (findInstallment.get(groupId, n, batchId)) continue;`

- [ ] **Paso 3.4 — Verlos pasar.** `npm test -- tests/modules/finance/finance-import.plans.test.ts tests/modules/finance/finance-import.installments.test.ts tests/modules/finance/finance-import.dedup.test.ts` → verde.

- [ ] **Paso 3.5 — Commit.** `npx tsc --noEmit && npm run typecheck:shared-logic`.
```
git add shared-logic/modules/finance-import.ipc.ts tests/modules/finance/finance-import.plans.test.ts
git commit -m "fix(finance): el monto desempata entre planes y un lote nunca materializa sobre sí mismo (C3/C4)"
```

### Task 4: C6 — la proyección sin tarjeta se ancla en el mes del resumen

**Files:**
- Modify: `shared-logic/modules/finance-import.ipc.ts:1-24` (import), `:620`
- Test: `tests/modules/finance/finance-import.plans.test.ts`

- [ ] **Paso 4.1 — Test que falla.** Agregar a `finance-import.plans.test.ts` (importar `todayDateString` de `'../../../shared/date-utils'` y `addMonthsToMonth` de `'../../../shared-logic/modules/finance.balance'`):

```ts
describe('C6 — sin tarjeta, la proyección se ancla en el mes del resumen', () => {
  const CUOTA_3_DE_12 = { ...LINE, installmentCurrent: 3, installmentTotal: 12, amountARS: 25_000 };

  it('con statementMonth, las proyectadas arrancan el mes siguiente al resumen', async () => {
    await invoke('finance:importConfirm', [CUOTA_3_DE_12], '2025-08', 'agosto.pdf', null);
    const rows = liveRows();
    expect(rows.map((r) => r.n)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    // La importada sin tarjeta impacta en su fecha de compra (decisión explícita de la spec).
    expect(rows[0].date).toBe('2025-05-20');
    expect(rows[1].date).toBe('2025-09-20');
    expect(rows.slice(1).every((r) => r.date >= '2025-09-01')).toBe(true);
  });

  it('sin statementMonth válido, el ancla es el mes actual', async () => {
    await invoke('finance:importConfirm', [CUOTA_3_DE_12], '', 'suelto.pdf', null);
    const rows = liveRows();
    const nextMonth = addMonthsToMonth(todayDateString().slice(0, 7), 1);
    expect(rows[1].date.slice(0, 7)).toBe(nextMonth);
  });
});
```

- [ ] **Paso 4.2 — Verlo fallar.** `npm test -- tests/modules/finance/finance-import.plans.test.ts` → el primero falla con `expected '2025-06-20' to be '2025-09-20'`.

- [ ] **Paso 4.3 — Implementar.** En `finance-import.ipc.ts`:
  - Agregar `import { todayDateString } from '../../shared/date-utils';` después de `import { platform } from '../platform';` (`:4`).
  - Reemplazar `:618-621`:
    ```ts
            // La cuota importada cae en el resumen que se está cargando; las que
            // siguen, uno por mes desde ahí, conservando el día de la compra.
            // Sin tarjeta no se guarda statement_period, pero el mes del resumen
            // sigue siendo el ancla (invariante 4): ninguna proyección nace en un
            // mes anterior al del resumen que la origina.
            const anchorMonth = isValidMonthString(statementMonth)
              ? statementMonth
              : todayDateString().slice(0, 7);
            const anchorDate = dateInMonthClamped(anchorMonth, Number(row.date.slice(8, 10)));
    ```

- [ ] **Paso 4.4 — Verlo pasar.** `npm test -- tests/modules/finance/finance-import.plans.test.ts tests/modules/finance/finance-import.installments.test.ts` → verde.

- [ ] **Paso 4.5 — Commit.** `npx tsc --noEmit && npm run typecheck:shared-logic`.
```
git add shared-logic/modules/finance-import.ipc.ts tests/modules/finance/finance-import.plans.test.ts
git commit -m "fix(finance): la proyección sin tarjeta se ancla en el mes del resumen, nunca en el pasado (C6)"
```

### Task 5: C11 — materializar conserva la categoría editada a mano

**Files:**
- Modify: `shared-logic/modules/finance-import.ipc.ts` (`materialise` y su `.run`)
- Test: `tests/modules/finance/finance-import.plans.test.ts`

- [ ] **Paso 5.1 — Test que falla.** Agregar a `finance-import.plans.test.ts`:

```ts
describe('C11 — materializar no pisa una categoría corregida a mano', () => {
  const CUOTA_3_DE_12 = { ...LINE, installmentCurrent: 3, installmentTotal: 12, amountARS: 25_000 };

  it('conserva la editada; fija la sugerida solo sobre la categoría por defecto del import', async () => {
    await invoke('finance:importConfirm', [CUOTA_3_DE_12], '2025-08', 'agosto.pdf', cardId);
    const [plan] = plans();
    const four = harness.db.prepare(
      'SELECT id FROM finance_transactions WHERE installment_group_id = ? AND installment_number = 4',
    ).get(plan.id) as { id: string };
    await invoke('finance:updateTransaction', four.id, { category: 'Hogar' });

    await invoke('finance:importConfirm', [{ ...CUOTA_3_DE_12, installmentCurrent: 4 }], '2025-09', 'septiembre.pdf', cardId);
    await invoke('finance:importConfirm', [{ ...CUOTA_3_DE_12, installmentCurrent: 5, suggestedCategory: 'Muebles' }], '2025-10', 'octubre.pdf', cardId);

    const byNumber = new Map(liveRows(plan.id).map((r) => [r.n, r.category]));
    expect(byNumber.get(4)).toBe('Hogar');    // la corrección del usuario sobrevive
    expect(byNumber.get(5)).toBe('Muebles');  // la sugerida pisa el default del import
    expect(byNumber.get(6)).toBe('Compras');  // una proyectada intacta sigue con el default
  });
});
```

- [ ] **Paso 5.2 — Verlo fallar.** → `expected 'Compras' to be 'Hogar'`.

- [ ] **Paso 5.3 — Implementar.** En `materialise`, cambiar `category = ?,` por `category = CASE WHEN category = ? THEN ? ELSE category END,` (dos parámetros: la categoría del plan —el default con el que nació la proyectada— y la sugerida). En el `.run` de `materialise`, cambiar `type, amount, currency, row.suggestedCategory, row.merchant, rowDate, row.date,` por `type, amount, currency, found.category, row.suggestedCategory, row.merchant, rowDate, row.date,` (`found` es el resultado de `findGroup`, que desde Task 3 devuelve `category`).

- [ ] **Paso 5.4 — Verlo pasar.** `npm test -- tests/modules/finance/finance-import.plans.test.ts tests/modules/finance/finance-import.installments.test.ts` → verde.

- [ ] **Paso 5.5 — Commit.**
```
git add shared-logic/modules/finance-import.ipc.ts tests/modules/finance/finance-import.plans.test.ts
git commit -m "fix(finance): materializar una cuota conserva la categoría corregida a mano (C11)"
```

### Task 6: C14 — «N de M vigentes» cuenta líneas, no cuotas proyectadas

**Files:**
- Modify: `shared-logic/modules/finance-import.ipc.ts:697-708`
- Test: `tests/modules/finance/finance-import.plans.test.ts`

- [ ] **Paso 6.1 — Test que falla.**

```ts
describe('C14 — el contador del lote cuenta líneas del papel', () => {
  const CUOTA_3_DE_12 = { ...LINE, installmentCurrent: 3, installmentTotal: 12, amountARS: 25_000 };
  const CONTADO = { date: '2025-08-04', merchant: 'RAPPIPRO', amountARS: 8_000, isExcluded: false, suggestedCategory: 'Delivery' };
  type Batch = { id: string; rowCount: number; liveCount: number };

  it('un lote de una línea 3/12 → 1 de 1 vigentes', async () => {
    await invoke('finance:importConfirm', [CUOTA_3_DE_12], '2025-08', 'agosto.pdf', cardId);
    const [batch] = await invoke<Batch[]>('finance:getImportBatches');
    expect(batch.rowCount).toBe(1);
    expect(batch.liveCount).toBe(1);
  });

  it('una línea en cuotas + una al contado → 2; revertir → 0', async () => {
    const res = await invoke<{ batchId: string }>('finance:importConfirm', [CUOTA_3_DE_12, CONTADO], '2025-08', 'agosto.pdf', cardId);
    expect((await invoke<Batch[]>('finance:getImportBatches'))[0].liveCount).toBe(2);
    await invoke('finance:undoImportBatch', res.batchId);
    expect((await invoke<Batch[]>('finance:getImportBatches'))[0].liveCount).toBe(0);
  });
});
```

- [ ] **Paso 6.2 — Verlo fallar.** → `expected 10 to be 1`.

- [ ] **Paso 6.3 — Implementar.** Reemplazar el handler `finance:getImportBatches` (`:697-708`) por:

```ts
  /**
   * «N de M vigentes»: M son las líneas del papel (`row_count`), N las que
   * siguen vivas. Una línea en cuotas escribe 1 + las proyectadas, y contarlas
   * todas daba «10 de 1». Regla: filas vivas sueltas (sin plan) más UNA por cada
   * plan que este lote tocó y que conserva alguna fila viva del lote — la de
   * menor `installment_number`, que es la importada o materializada (las
   * proyectadas siempre tienen un número mayor). Límite conocido: si el usuario
   * borra a mano la fila importada y quedan proyectadas vivas, cuenta 1 igual.
   */
  ipcHandle('finance:getImportBatches', () => {
    const db = getDb();
    return db
      .prepare(
        `SELECT b.id, b.source, b.filename, b.row_count AS rowCount, b.created_at AS createdAt,
                (SELECT COUNT(*) FROM finance_transactions t
                  WHERE t.import_batch_id = b.id AND t.deleted_at IS NULL
                    AND t.installment_group_id IS NULL)
              + (SELECT COUNT(*) FROM (
                    SELECT t.installment_group_id FROM finance_transactions t
                     WHERE t.import_batch_id = b.id AND t.deleted_at IS NULL
                       AND t.installment_group_id IS NOT NULL
                     GROUP BY t.installment_group_id)) AS liveCount
         FROM finance_import_batches b
         ORDER BY b.created_at DESC`,
      )
      .all();
  });
```

- [ ] **Paso 6.4 — Verlo pasar.** `npm test -- tests/modules/finance/finance-import.plans.test.ts` → verde. `npm test -- tests/modules/finance` → verde.

- [ ] **Paso 6.5 — Commit.** `npx tsc --noEmit && npm run typecheck:shared-logic`.
```
git add shared-logic/modules/finance-import.ipc.ts tests/modules/finance/finance-import.plans.test.ts
git commit -m "fix(finance): el contador de vigentes del lote cuenta líneas del papel, no cuotas proyectadas (C14)"
```

---

## Chunk 3: C2 — editar una compra con tarjeta no la desengancha

### Task 7: `finance:updateTransaction` conserva la tarjeta y `saveEdit` manda el `creditCardId`

**Files:**
- Modify: `shared-logic/modules/finance.ipc.ts:291-302`
- Modify: `src/modules/finance/components/Transactions.tsx:30-53` (`TransactionRow`), `:511-517` (`saveEdit`)
- Test: `tests/modules/finance/finance.card-edit.test.ts` (nuevo)

- [ ] **Paso 7.1 — Test que falla.** Crear `tests/modules/finance/finance.card-edit.test.ts` con el arnés de `finance.statement-paper.test.ts:11-44` (solo `registerFinanceIpcHandlers`) y:

```ts
let cardId: string;

function cardFields(id: string) {
  return harness.db.prepare(
    'SELECT credit_card_id AS creditCardId, impacts_balance AS impactsBalance, statement_period AS statementPeriod, payment_method AS paymentMethod FROM finance_transactions WHERE id = ?',
  ).get(id) as { creditCardId: string | null; impactsBalance: number; statementPeriod: string | null; paymentMethod: string };
}

/** Una compra con tarjeta con período explícito, como la deja el import. */
async function cardPurchase(): Promise<string> {
  const id = await invoke<string>('finance:addTransaction', {
    type: 'expense', amount: 1000, date: '2025-08-20', paymentMethod: 'credit_card', creditCardId: cardId, category: 'Compras',
  });
  harness.db.prepare("UPDATE finance_transactions SET statement_period = '2025-08' WHERE id = ?").run(id);
  return id;
}

beforeEach(async () => {
  harness.db = setupDb();
  cardId = await invoke<string>('finance:addCreditCard', { name: 'Visa', closingDay: 25 });
});

describe('C2 — editar una compra con tarjeta no la desengancha', () => {
  it('paymentMethod credit_card sin creditCardId conserva tarjeta, impacts_balance y período', async () => {
    const id = await cardPurchase();
    expect(await invoke('finance:updateTransaction', id, { amount: 2000, paymentMethod: 'credit_card' })).toEqual({ ok: true });
    expect(cardFields(id)).toEqual({ creditCardId: cardId, impactsBalance: 0, statementPeriod: '2025-08', paymentMethod: 'credit_card' });
  });

  it('sin paymentMethod ni creditCardId tampoco toca nada de la tarjeta', async () => {
    const id = await cardPurchase();
    await invoke('finance:updateTransaction', id, { description: 'otra' });
    expect(cardFields(id)).toMatchObject({ creditCardId: cardId, impactsBalance: 0, statementPeriod: '2025-08' });
  });

  it('cambiar a cash limpia tarjeta y período y vuelve al saldo', async () => {
    const id = await cardPurchase();
    await invoke('finance:updateTransaction', id, { paymentMethod: 'cash' });
    expect(cardFields(id)).toEqual({ creditCardId: null, impactsBalance: 1, statementPeriod: null, paymentMethod: 'cash' });
  });

  it('un creditCardId explícito se respeta (incluido null)', async () => {
    const other = await invoke<string>('finance:addCreditCard', { name: 'Master', closingDay: 10 });
    const id = await cardPurchase();
    await invoke('finance:updateTransaction', id, { paymentMethod: 'credit_card', creditCardId: other });
    expect(cardFields(id)).toMatchObject({ creditCardId: other, impactsBalance: 0 });
    await invoke('finance:updateTransaction', id, { paymentMethod: 'credit_card', creditCardId: null });
    expect(cardFields(id)).toMatchObject({ creditCardId: null, impactsBalance: 0 });
  });
});
```

- [ ] **Paso 7.2 — Verlo fallar.** `npm test -- tests/modules/finance/finance.card-edit.test.ts` → el primero falla (`creditCardId: null`), el tercero falla en `statementPeriod` (`'2025-08'` en vez de `null`).

- [ ] **Paso 7.3 — Implementar el handler.** Reemplazar `finance.ipc.ts:291-302` por:

```ts
    if (fields.paymentMethod !== undefined) {
      sets.push('payment_method = ?'); vals.push(fields.paymentMethod);
      if (fields.paymentMethod === 'credit_card') {
        // Sin creditCardId explícito la tarjeta, impacts_balance y el período
        // existentes se conservan: editar el monto de una compra con tarjeta no
        // puede desengancharla de su resumen. Con creditCardId (incluido null)
        // se respeta lo que vino, como siempre.
        if (fields.creditCardId !== undefined) {
          sets.push('impacts_balance = ?'); vals.push(0);
          sets.push('credit_card_id = ?'); vals.push(fields.creditCardId);
        }
      } else {
        sets.push('impacts_balance = ?'); vals.push(1);
        sets.push('credit_card_id = ?'); vals.push(null);
        sets.push('statement_period = ?'); vals.push(null);
      }
    } else if (fields.creditCardId !== undefined) {
      sets.push('credit_card_id = ?'); vals.push(fields.creditCardId);
    }
```

- [ ] **Paso 7.4 — Verlo pasar.** `npm test -- tests/modules/finance/finance.card-edit.test.ts tests/modules/finance/finance.ipc.test.ts` → verde.

- [ ] **Paso 7.5 — `saveEdit` manda el `creditCardId` actual.** En `Transactions.tsx`:
  - En `TransactionRow` (`:30-53`), después de `impactsBalance?: number;` agregar `/** Tarjeta de una compra con tarjeta; se reenvía al editar para no desengancharla. */\n  creditCardId?: string | null;`.
  - En `saveEdit` (`:511-517`), reemplazar el objeto por:
    ```ts
    const result = await unwrap(window.api.financeUpdateTransaction(editingId, {
      amount,
      description: editFields.description,
      category: editFields.category,
      date: editFields.date,
      paymentMethod: editFields.paymentMethod,
      // Contrato explícito: la tarjeta que la fila ya tiene. El handler la
      // conserva igual sin este campo; mandarla deja claro que no se toca.
      creditCardId: original?.creditCardId ?? null,
    }));
    ```
    (`original` ya existe en `:501`.)

- [ ] **Paso 7.6 — Verificar y commit.** `npx tsc --noEmit && npm run typecheck:shared-logic`.
```
git add shared-logic/modules/finance.ipc.ts src/modules/finance/components/Transactions.tsx tests/modules/finance/finance.card-edit.test.ts
git commit -m "fix(finance): editar una compra con tarjeta conserva tarjeta, saldo y período (C2)"
```

---

## Chunk 4: C8/C9 — el «Pago Tarjeta» nace al pagar, fechado el día del pago

### Task 8: `settleStatement`, `payStatement` con fecha, `generateStatement` sin transacción, `saveStatementPaper` async, migración v21

**Files:**
- Modify: `shared-logic/modules/finance.ipc.ts:763-859` (generateStatement), `:880-1000` (saveStatementPaper), `:1011-1065` (payStatement); nueva función `settleStatement` a nivel de módulo (antes de `registerFinanceIpcHandlers`, después de `resolveAccountId` `:124`)
- Modify: `src/modules/finance/finance.schema.ts` (v21, después de la v20; viaja en el mismo commit que el código que la necesita)
- Modify: `shared/types.ts:805` (`financePayStatement`)
- Modify: `src/modules/finance/utils/api-ext.ts:167-180` (`payStatement`)
- Modify: `src/modules/finance/components/shared/StatementDetail.tsx:1-10, 90-97`
- Test: `tests/modules/finance/finance.settle-statement.test.ts` (nuevo)
- Test: `tests/modules/finance/finance.migration-v20.test.ts` (bloque v21)
- Test (adaptar): `finance-import.card.test.ts:121-141`, `finance-import.dedup.test.ts:169-180`, `finance.accounts-inherit.test.ts:85`, `finance.review-medium.test.ts:165-175`, `finance.fx-rate-source.test.ts:201-213`, `finance.statement-paper.test.ts:134-150`

- [ ] **Paso 8.1 — Test nuevo que falla.** Crear `tests/modules/finance/finance.settle-statement.test.ts` con el arnés de `finance.accounts-inherit.test.ts:9-56` (solo finance handlers; `setupDb` con el `dollar_cache` a 1000) y:

```ts
import { todayDateString } from '../../../shared/date-utils';

let cardId: string;

async function purchase(date: string, amount: number, currency = 'ARS'): Promise<void> {
  await invoke('finance:addTransaction', {
    type: 'expense', amount, currency, category: 'Compras', description: 'compra',
    date, paymentMethod: 'credit_card', creditCardId: cardId,
  });
}

function payments() {
  return harness.db.prepare(`
    SELECT id, amount, currency, date, impacts_balance AS impactsBalance, fx_rate AS fxRate,
           fx_rate_source AS fxRateSource, account_id AS accountId
    FROM finance_transactions WHERE category = ? AND deleted_at IS NULL ORDER BY currency
  `).all(CARD_PAYMENT_CATEGORY) as Array<{
    id: string; amount: number; currency: string; date: string; impactsBalance: number;
    fxRate: number | null; fxRateSource: string | null; accountId: string | null;
  }>;
}

function statementRow(id: string) {
  return harness.db.prepare(`
    SELECT status, paid_date AS paidDate, paid_amount AS paidAmount,
           transaction_id AS transactionId, transaction_id_usd AS transactionIdUsd
    FROM finance_credit_card_statements WHERE id = ?
  `).get(id) as { status: string; paidDate: string | null; paidAmount: number | null; transactionId: string | null; transactionIdUsd: string | null };
}

beforeEach(async () => {
  harness.db = setupDb();
  cardId = await invoke<string>('finance:addCreditCard', { name: 'Visa', closingDay: 25 });
});

describe('C8/C9 — el Pago Tarjeta existe solo cuando el resumen está pagado', () => {
  it('generar un resumen no crea transacción ni toca el saldo', async () => {
    await purchase('2025-11-10', 15_000);
    const id = await invoke<string>('finance:generateStatement', cardId, '2025-11');
    expect(statementRow(id)).toMatchObject({ status: 'pending', transactionId: null, transactionIdUsd: null });
    expect(payments()).toHaveLength(0);
    expect(computeMonthlyBalance(harness.db, '2025-11').ARS.expenses).toBe(0);
  });

  it('pagar con fecha: la transacción cae ese día, con cuenta y cotización; diciembre baja, noviembre no', async () => {
    const banco = await invoke<{ id: string }>('finance:saveAccount', { name: 'Banco', kind: 'bank', initialBalance: 100_000 });
    await purchase('2025-11-10', 15_000);
    const id = await invoke<string>('finance:generateStatement', cardId, '2025-11');

    expect(await invoke('finance:payStatement', id, 15_000, 0, banco.id, '2025-12-10')).toEqual({ ok: true });

    const [pago] = payments();
    expect(pago).toMatchObject({ amount: 15_000, currency: 'ARS', date: '2025-12-10', impactsBalance: 1, accountId: banco.id, fxRate: 1000, fxRateSource: 'process' });
    expect(statementRow(id)).toMatchObject({ status: 'paid', paidDate: '2025-12-10', paidAmount: 15_000, transactionId: pago.id });
    expect(computeMonthlyBalance(harness.db, '2025-12').ARS.expenses).toBe(15_000);
    expect(computeMonthlyBalance(harness.db, '2025-11').ARS.expenses).toBe(0);
    expect(computeAccountsOverview(harness.db).accounts.find((a) => a.id === banco.id)?.balance).toBe(85_000);
  });

  it('pagar dos veces deja UNA transacción, con el monto y la fecha del último pago', async () => {
    await purchase('2025-11-10', 15_000);
    const id = await invoke<string>('finance:generateStatement', cardId, '2025-11');
    await invoke('finance:payStatement', id, 15_000, 0, undefined, '2025-12-10');
    await invoke('finance:payStatement', id, 14_000, 0, undefined, '2025-12-12');
    expect(payments()).toHaveLength(1);
    expect(payments()[0]).toMatchObject({ amount: 14_000, date: '2025-12-12' });
  });

  it('una pata por moneda, nunca dos', async () => {
    await purchase('2025-11-10', 50_000);
    await purchase('2025-11-11', 30, 'USD');
    const id = await invoke<string>('finance:generateStatement', cardId, '2025-11');
    await invoke('finance:payStatement', id, 50_000, 30, undefined, '2025-12-10');
    await invoke('finance:payStatement', id, 50_000, 30, undefined, '2025-12-11');
    expect(payments().map((p) => [p.currency, p.amount, p.date])).toEqual([['ARS', 50_000, '2025-12-11'], ['USD', 30, '2025-12-11']]);
  });

  it('sin fecha paga hoy; una fecha inválida se rechaza', async () => {
    await purchase('2025-11-10', 15_000);
    const id = await invoke<string>('finance:generateStatement', cardId, '2025-11');
    expect(await invoke('finance:payStatement', id, 15_000, 0, undefined, 'ayer')).toEqual({ ok: false, reason: 'invalid_date' });
    expect(payments()).toHaveLength(0);
    await invoke('finance:payStatement', id, 15_000);
    expect(payments()[0].date).toBe(todayDateString());
  });

  it('saveStatementPaper con SU PAGO fecha el pago en el cierre del papel', async () => {
    await purchase('2025-10-10', 100_000);
    const octId = await invoke<string>('finance:generateStatement', cardId, '2025-10');
    await purchase('2025-11-10', 15_000);
    await invoke('finance:generateStatement', cardId, '2025-11');

    const res = await invoke<{ settledPrevious: boolean }>('finance:saveStatementPaper', cardId, {
      period: '2025-11', closingDate: '2025-11-27', priorPaymentArs: 100_000,
    });
    expect(res.settledPrevious).toBe(true);
    const [pago] = payments();
    expect(pago).toMatchObject({ amount: 100_000, date: '2025-11-27', impactsBalance: 1, accountId: null });
    expect(statementRow(octId)).toMatchObject({ status: 'paid', paidDate: '2025-11-27', transactionId: pago.id });
    expect(computeMonthlyBalance(harness.db, '2025-10').ARS.expenses).toBe(0);
    expect(computeMonthlyBalance(harness.db, '2025-11').ARS.expenses).toBe(100_000);
  });

  it('generateStatement sanea un pendiente que trae transacción (sync desde un dispositivo viejo)', async () => {
    await purchase('2025-11-10', 15_000);
    const id = await invoke<string>('finance:generateStatement', cardId, '2025-11');
    harness.db.prepare(`
      INSERT INTO finance_transactions (id, type, amount, currency, category, description, date, payment_method, source, impacts_balance, created_at, updated_at)
      VALUES ('stale', 'expense', 15000, 'ARS', ?, 'Pago tarjeta - 2025-11', '2025-11-01', 'debit', 'manual', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
    `).run(CARD_PAYMENT_CATEGORY);
    harness.db.prepare("UPDATE finance_credit_card_statements SET transaction_id = 'stale' WHERE id = ?").run(id);

    expect(await invoke('finance:generateStatement', cardId, '2025-11')).toBe(id);
    expect(statementRow(id).transactionId).toBeNull();
    const stale = harness.db.prepare('SELECT deleted_at AS d FROM finance_transactions WHERE id = ?').get('stale') as { d: string | null };
    expect(stale.d).not.toBeNull();
    expect(computeMonthlyBalance(harness.db, '2025-11').ARS.expenses).toBe(0);
  });
});
```

(Importar `CARD_PAYMENT_CATEGORY`, `computeMonthlyBalance`, `computeAccountsOverview` de `'../../../shared-logic/modules/finance.balance'`.)

- [ ] **Paso 8.2 — Test de la migración v21 que falla.** Agregar a `finance.migration-v20.test.ts` (después de `const V20 = …`: `const V21 = financeMigrations.find((m) => m.version === 21);`) y al final:

```ts
describe('finance v21 — un resumen pendiente no tiene Pago Tarjeta', () => {
  function seed(db: Database.Database) {
    db.prepare("INSERT INTO finance_credit_cards (id, name, closing_day, created_at, updated_at) VALUES ('card', 'Visa', 25, ?, ?)").run(OLD_STAMP, OLD_STAMP);
    for (const id of ['tx-pend', 'tx-pend-usd', 'tx-paid']) {
      db.prepare(`
        INSERT INTO finance_transactions (id, type, amount, currency, category, description, date, payment_method, source, impacts_balance, created_at, updated_at)
        VALUES (?, 'expense', 100, 'ARS', 'Pago Tarjeta', '', '2025-11-01', 'debit', 'manual', 1, ?, ?)
      `).run(id, OLD_STAMP, OLD_STAMP);
    }
    db.prepare(`
      INSERT INTO finance_credit_card_statements (id, credit_card_id, period_month, calculated_amount, status, transaction_id, transaction_id_usd, created_at, updated_at)
      VALUES ('s-pend', 'card', '2025-11', 100, 'pending', 'tx-pend', 'tx-pend-usd', ?, ?),
             ('s-paid', 'card', '2025-10', 100, 'paid', 'tx-paid', NULL, ?, ?)
    `).run(OLD_STAMP, OLD_STAMP, OLD_STAMP, OLD_STAMP);
  }

  it('existe, después de la v20', () => {
    expect(V21).toBeDefined();
    expect(financeMigrations.map((m) => m.version).slice(-2)).toEqual([20, 21]);
  });

  it('retira las transacciones del pendiente y conserva la del pagado', () => {
    const db = dbUpTo(20);
    seed(db);
    db.exec(V21!.up);
    expect(readTx(db, 'tx-pend').deletedAt).not.toBeNull();
    expect(readTx(db, 'tx-pend-usd').deletedAt).not.toBeNull();
    expect(readTx(db, 'tx-paid').deletedAt).toBeNull();
    const rows = db.prepare('SELECT id, transaction_id AS t, transaction_id_usd AS u FROM finance_credit_card_statements ORDER BY id').all();
    expect(rows).toEqual([{ id: 's-paid', t: 'tx-paid', u: null }, { id: 's-pend', t: null, u: null }]);
  });

  it('también es idempotente', () => {
    const db = dbUpTo(20);
    seed(db);
    db.exec(V21!.up);
    const before = snapshot(db);
    rerunBackfill(db, V21!);
    expect(snapshot(db)).toEqual(before);
  });
});
```

- [ ] **Paso 8.3 — Verlos fallar.** `npm test -- tests/modules/finance/finance.settle-statement.test.ts tests/modules/finance/finance.migration-v20.test.ts`. Esperado: todos los de C8/C9 fallan (`payments()` tiene 1 elemento tras generar; `invalid_date` no existe; `paidDate` hoy); v21: `expected undefined to be defined` y `TypeError … reading 'up'`.

- [ ] **Paso 8.4 — Migración v21.** En `finance.schema.ts`, después del objeto `version: 20` y antes de `];`, agregar (SQL de la spec, ARS y USD). Va en el MISMO commit que `settleStatement`/`generateStatement`: la migración viaja con el código que la necesita.

```ts
  {
    namespace: 'finance',
    version: 21,
    up: `
      -- El «Pago Tarjeta» existe solo cuando el resumen está pagado (invariante 6).
      -- Un pendiente ya no tiene transacción: las que generó la versión anterior
      -- se retiran, primero la pata ARS y después la USD. Idempotente por
      -- construcción (transaction_id IS NOT NULL), y generateStatement sanea
      -- igual lo que llegue por sync desde un dispositivo sin migrar.
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
      UPDATE finance_transactions
      SET deleted_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
          updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
      WHERE deleted_at IS NULL AND id IN (
        SELECT transaction_id_usd FROM finance_credit_card_statements
        WHERE status = 'pending' AND deleted_at IS NULL AND transaction_id_usd IS NOT NULL
      );
      UPDATE finance_credit_card_statements
      SET transaction_id_usd = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
      WHERE status = 'pending' AND deleted_at IS NULL AND transaction_id_usd IS NOT NULL;
    `,
  },
```

- [ ] **Paso 8.5 — `settleStatement`.** En `finance.ipc.ts`, después de `resolveAccountId` (`:124`) y antes de `const TRANSACTION_COLUMNS`, agregar:

```ts
/**
 * Salda un resumen: escribe (o actualiza) su «Pago Tarjeta» por moneda,
 * fechado el DÍA DEL PAGO, y lo marca `paid`. Un resumen pendiente no tiene
 * transacción (invariante 6); esta es la única función que la crea, así que
 * nunca hay dos por moneda. Es síncrona y NO abre transacción: el llamador ya
 * está adentro de una (`db.transaction`).
 *
 * `accountId` cae en la pata cuya moneda coincide con la cuenta (un banco en
 * pesos no paga la pata en dólares). Una pata en cero no escribe nada; si
 * existía de un pago anterior, se retira.
 */
function settleStatement(
  db: ReturnType<typeof getDb>,
  statementId: string,
  input: { ars: number; usd: number; paidDate: string; accountId: string | null; fxRate: number | null },
): boolean {
  const stmt = db.prepare(`
    SELECT id, period_month AS periodMonth,
           transaction_id AS transactionId, transaction_id_usd AS transactionIdUsd
    FROM finance_credit_card_statements WHERE id = ?
  `).get(statementId) as
    { id: string; periodMonth: string; transactionId: string | null; transactionIdUsd: string | null } | undefined;
  if (!stmt) return false;

  const now = nowIso();
  const fxRateSource = input.fxRate === null ? null : fxRateSourceFor(input.paidDate);
  const account = input.accountId
    ? db.prepare('SELECT id, currency FROM finance_accounts WHERE id = ? AND deleted_at IS NULL').get(input.accountId) as
      { id: string; currency: string } | undefined
    : undefined;
  const accountFor = (currency: 'ARS' | 'USD') => (account && account.currency === currency ? account.id : null);

  const insertTx = db.prepare(`
    INSERT INTO finance_transactions
      (id, type, amount, currency, category, description, date, payment_method,
       source, installments, installment_group_id, for_third_party, recurring_id,
       import_batch_id, credit_card_id, impacts_balance, fx_rate, fx_rate_source, account_id, created_at, updated_at)
    VALUES (?, 'expense', ?, ?, ?, ?, ?, 'debit', 'manual', 1, NULL, 0, NULL, NULL, NULL, 1, ?, ?, ?, ?, ?)
  `);
  const updateTx = db.prepare(`
    UPDATE finance_transactions
    SET amount = ?, date = ?, deleted_at = NULL,
        account_id = CASE WHEN ? THEN ? ELSE account_id END, updated_at = ?
    WHERE id = ?
  `);
  const retireTx = db.prepare(
    'UPDATE finance_transactions SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
  );

  const settleLeg = (currentId: string | null, amount: number, currency: 'ARS' | 'USD'): string | null => {
    if (amount <= 0) {
      if (currentId) retireTx.run(now, now, currentId);
      return null;
    }
    const acc = accountFor(currency);
    if (currentId) {
      const res = updateTx.run(amount, input.paidDate, acc !== null ? 1 : 0, acc, now, currentId);
      if (res.changes > 0) return currentId;
    }
    const id = genId();
    insertTx.run(
      id, amount, currency, CARD_PAYMENT_CATEGORY, `Pago tarjeta - ${stmt.periodMonth}`, input.paidDate,
      input.fxRate, fxRateSource, acc, now, now,
    );
    return id;
  };

  const arsTxId = settleLeg(stmt.transactionId, input.ars, 'ARS');
  const usdTxId = settleLeg(stmt.transactionIdUsd, input.usd, 'USD');

  db.prepare(`
    UPDATE finance_credit_card_statements
    SET paid_amount = ?, paid_amount_usd = ?, status = 'paid', paid_date = ?,
        transaction_id = ?, transaction_id_usd = ?, updated_at = ?
    WHERE id = ?
  `).run(input.ars, input.usd, input.paidDate, arsTxId, usdTxId, now, statementId);
  return true;
}
```

- [ ] **Paso 8.6 — `payStatement` con `paidDate`.** Reemplazar `finance.ipc.ts:1002-1065` por:

```ts
  /**
   * Marks a statement paid and writes its `Pago Tarjeta` row(s) dated the day
   * it was paid (`paidDate`, default today). Until then the statement has no
   * transaction at all, so the balance moves exactly once, on the right month.
   *
   * `accountId` (optional) is the pocket the money left: it lands on the
   * payment row whose currency matches the account. Omitted or `null` = no
   * account. A dead/unknown account is refused rather than silently dropped.
   */
  ipcHandle('finance:payStatement', async (
    _e,
    statementId: string,
    paidAmount: number,
    paidAmountUsd?: number,
    accountId?: string | null,
    paidDate?: string,
  ) => {
    const ars = Number(paidAmount ?? 0);
    const usd = Number(paidAmountUsd ?? 0);
    if (!Number.isFinite(ars) || !Number.isFinite(usd) || ars < 0 || usd < 0) return fail('invalid_amount');
    if (ars <= 0 && usd <= 0) return fail('invalid_amount');
    const date = paidDate === undefined || paidDate === null ? todayDateString() : paidDate;
    if (!isValidDateString(date)) return fail('invalid_date');

    const db = getDb();
    const stmt = db.prepare('SELECT id FROM finance_credit_card_statements WHERE id = ?').get(statementId);
    if (!stmt) return fail('not_found');

    const wantedAccount = typeof accountId === 'string' && accountId.trim() !== '' ? accountId.trim() : null;
    if (wantedAccount) {
      const alive = db.prepare('SELECT id FROM finance_accounts WHERE id = ? AND deleted_at IS NULL').get(wantedAccount);
      if (!alive) return fail('account_not_found');
    }

    // Before the write transaction opens: async work inside db.transaction is not allowed.
    const fxRate = await captureFxRate(db);
    const trx = db.transaction(() => settleStatement(db, statementId, {
      ars: round2(ars), usd: round2(usd), paidDate: date, accountId: wantedAccount, fxRate,
    }));
    trx();
    return { ok: true };
  });
```

- [ ] **Paso 8.7 — `generateStatement` sin transacción + auto-saneo.** Reemplazar `finance.ipc.ts:755-859` por:

```ts
  /**
   * Creates or REFRESHES the statement for a period.
   *
   * Only a `paid` statement is frozen; a `pending` one is recalculated on every
   * call (the dashboard auto-generates on mount). A pending statement carries NO
   * `Pago Tarjeta` row (invariante 6): the payment is written by
   * `settleStatement` on the day it is actually paid. A pending statement that
   * still points at a transaction (synced from a device that never ran v20) is
   * sanitised here, which also makes the v20 backfill idempotent by construction.
   */
  ipcHandle('finance:generateStatement', (_e, creditCardId: string, periodMonth: string) => {
    const db = getDb();
    if (!isValidMonthString(periodMonth)) return null;

    const card = db.prepare(
      'SELECT id, closing_day AS closingDay FROM finance_credit_cards WHERE id = ? AND deleted_at IS NULL'
    ).get(creditCardId) as { id: string; closingDay: number } | undefined;
    if (!card) return null;

    // Ya no captura cotización: no escribe ninguna transacción. Síncrono como
    // el resto de las lecturas/escrituras sin red (los llamadores hacen `await`
    // sobre el invoke igual, nada cambia para ellos).
    const now = nowIso();
    const retireTx = db.prepare(
      'UPDATE finance_transactions SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
    );

    const trx = db.transaction(() => {
      const existing = db.prepare(`
        SELECT id, status, transaction_id AS transactionId, transaction_id_usd AS transactionIdUsd
        FROM finance_credit_card_statements
        WHERE credit_card_id = ? AND period_month = ? AND deleted_at IS NULL
      `).get(creditCardId, periodMonth) as
        { id: string; status: string; transactionId: string | null; transactionIdUsd: string | null } | undefined;

      // A paid statement is history — never rewrite it.
      if (existing && existing.status === 'paid') return existing.id;

      if (existing?.transactionId) retireTx.run(now, now, existing.transactionId);
      if (existing?.transactionIdUsd) retireTx.run(now, now, existing.transactionIdUsd);

      const { ars, usd } = computeStatementTotals(db, creditCardId, card.closingDay, periodMonth);

      if (!existing) {
        if (ars === 0 && usd === 0) return null;
        const statementId = genId();
        db.prepare(`
          INSERT INTO finance_credit_card_statements
            (id, credit_card_id, period_month, calculated_amount, calculated_amount_usd,
             status, transaction_id, transaction_id_usd, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?)
        `).run(statementId, creditCardId, periodMonth, ars, usd, now, now);
        return statementId;
      }

      // Every purchase that fed this statement is gone — retire it.
      if (ars === 0 && usd === 0) {
        db.prepare(`
          UPDATE finance_credit_card_statements
          SET transaction_id = NULL, transaction_id_usd = NULL, deleted_at = ?, updated_at = ?
          WHERE id = ?
        `).run(now, now, existing.id);
        return null;
      }

      db.prepare(`
        UPDATE finance_credit_card_statements
        SET calculated_amount = ?, calculated_amount_usd = ?,
            transaction_id = NULL, transaction_id_usd = NULL, updated_at = ?
        WHERE id = ?
      `).run(ars, usd, now, existing.id);
      return existing.id;
    });

    return trx();
  });
```

- [ ] **Paso 8.8 — `saveStatementPaper` async con `settleStatement`.** En `finance.ipc.ts:880`, cambiar `ipcHandle('finance:saveStatementPaper', (_e, creditCardId: string, paper: {` por `ipcHandle('finance:saveStatementPaper', async (_e, creditCardId: string, paper: {`. Antes de `const trx = db.transaction(() => {` (`:929`) agregar:

```ts
    // Before the write transaction opens: async work inside db.transaction is not allowed.
    const fxRate = await captureFxRate(db);
```

Reemplazar el bloque `:983-995` (desde `db.prepare(\`\n        UPDATE finance_credit_card_statements\n        SET paid_amount = ?, …` hasta `return { settledPrevious: true };`) por:

```ts
      // El «Pago Tarjeta» del resumen anterior nace acá, fechado el día del
      // cierre del papel (el banco lo recibió antes de cerrar), sin cuenta: el
      // papel no dice de qué bolsillo salió.
      const paidDate = typeof paper.closingDate === 'string' && isValidDateString(paper.closingDate)
        ? paper.closingDate
        : todayDateString();
      const settled = settleStatement(db, previous.id, {
        ars: paidArs, usd: paidUsd, paidDate, accountId: null, fxRate,
      });
      return { settledPrevious: settled };
```

- [ ] **Paso 8.9 — Verlos pasar.** `npm test -- tests/modules/finance/finance.settle-statement.test.ts tests/modules/finance/finance.migration-v20.test.ts` → verde. `npx tsc --noEmit && npm run typecheck:shared-logic` → si `captureFxRate`/`fxRateSourceFor` aparecen como no usados en algún lugar, no borrarlos: los usa `settleStatement`.

- [ ] **Paso 8.10 — Adaptar los tests que rompen a la nueva semántica.** Correr `npm test -- tests/modules/finance` y arreglar exactamente estos:
  - `finance-import.card.test.ts:121-141`, reemplazar el test por:
    ```ts
    it('never counts an imported purchase twice against the balance', async () => {
      await invoke('finance:importConfirm', ROWS, '2026-03', 'resumen.pdf', cardId);

      // Before the statement is PAID the purchases are off the balance entirely —
      // generating the statement writes no transaction.
      const statementId = await invoke<string>('finance:generateStatement', cardId, '2026-03');
      expect(computeMonthlyBalance(harness.db, '2026-03').ARS.expenses).toBe(0);

      await invoke('finance:payStatement', statementId, 20000, undefined, undefined, '2026-04-05');

      // Afterwards the ONLY impacting expense is the single statement payment —
      // 20 000 once, on the day it was paid, not as purchases plus statement.
      const impacting = harness.db
        .prepare(
          `SELECT COUNT(*) AS c, COALESCE(SUM(amount), 0) AS total
           FROM finance_transactions
           WHERE deleted_at IS NULL AND impacts_balance = 1 AND type = 'expense'`,
        )
        .get() as { c: number; total: number };
      expect(impacting.c).toBe(1);
      expect(impacting.total).toBe(20000);
      expect(computeMonthlyBalance(harness.db, '2026-03').ARS.expenses).toBe(0);
      expect(computeMonthlyBalance(harness.db, '2026-04').ARS.expenses).toBe(20000);
    });
    ```
  - `finance-import.dedup.test.ts:176`: `expect(await invoke('finance:payStatement', augustId, 25000, undefined, undefined, '2026-08-31')).toEqual({ ok: true });`
  - `finance.accounts-inherit.test.ts:85`: `expect(await invoke('finance:payStatement', statementId, 120000, undefined, bancoId, '2026-08-20')).toEqual({ ok: true });`
  - `finance.review-medium.test.ts:170-174`, reemplazar por:
    ```ts
    const statementId = await invoke<string>('finance:generateStatement', cardId, '2026-08');
    const stmt = db.prepare('SELECT calculated_amount AS c, transaction_id AS txId FROM finance_credit_card_statements WHERE id = ?').get(statementId) as { c: number; txId: string | null };
    expect(stmt.c).toBe(15016.62);
    expect(stmt.txId).toBeNull();
    await invoke('finance:payStatement', statementId, stmt.c);
    const payment = db.prepare('SELECT amount FROM finance_transactions WHERE category = ? AND deleted_at IS NULL').get('Pago Tarjeta') as { amount: number };
    expect(payment.amount).toBe(15016.62);
    ```
  - `finance.fx-rate-source.test.ts:208`, después de `const statementId = …` agregar `await invoke('finance:payStatement', statementId, 5000, undefined, undefined, '2026-01-25');` (el resto del test queda igual: la subquery por `transaction_id` ahora encuentra el pago).
  - `finance.statement-paper.test.ts:134-150`, al final del test `salda el resumen ANTERIOR…` agregar:
    ```ts
    const pago = harness.db.prepare(`
      SELECT date, amount, impacts_balance AS impactsBalance FROM finance_transactions
      WHERE id = (SELECT transaction_id FROM finance_credit_card_statements WHERE period_month = '2025-10')
    `).get() as { date: string; amount: number; impactsBalance: number };
    expect(pago).toEqual({ date: '2025-11-27', amount: 100_000, impactsBalance: 1 });
    ```
    Nota: `PAPER` (`:56-71`) trae `priorPaymentUsd: 10`, así que `settleStatement` crea TAMBIÉN la pata USD (`transaction_id_usd`, 10 USD, misma fecha). Van a quedar dos filas «Pago Tarjeta» en la base de ese test y es correcto; el assert selecciona por `transaction_id` (la pata ARS) y pasa.

- [ ] **Paso 8.11 — Suite finance en verde.** `npm test -- tests/modules/finance` → todo verde.

- [ ] **Paso 8.12 — Contrato del renderer.**
  - `shared/types.ts:805`: `financePayStatement: (id: string, paidAmount: number, paidAmountUsd?: number, accountId?: string | null, paidDate?: string) => Promise<{ ok: true } | { ok: false; reason: string }>;`
  - `src/modules/finance/utils/api-ext.ts:167-180`, reemplazar por:
    ```ts
    export function payStatement(
      id: string,
      paidAmount: number,
      paidAmountUsd?: number,
      accountId?: string | null,
      paidDate?: string,
    ): Promise<{ ok: true } | { ok: false; reason: string }> {
      return window.api.financePayStatement(id, paidAmount, paidAmountUsd, accountId, paidDate);
    }
    ```
    y borrar el comentario de `:158-166` (ya no hay «bridge caveat»).
  - `StatementDetail.tsx`: agregar `import { todayDateString } from '../../../../../shared/date-utils';` y en `:91-96` pasar el quinto argumento `todayDateString()` (el modal no ofrece fecha: hoy, explícito).

- [ ] **Paso 8.13 — Typecheck y commit.** `npx tsc --noEmit && npm run typecheck:shared-logic && npm test -- tests/modules/finance tests/modules/sync`.
```
git add shared-logic/modules/finance.ipc.ts src/modules/finance/finance.schema.ts shared/types.ts src/modules/finance/utils/api-ext.ts src/modules/finance/components/shared/StatementDetail.tsx tests/modules/finance
git commit -m "fix(finance): el Pago Tarjeta nace al pagar el resumen, fechado el día del pago; migración v21 (C8/C9)"
```

---

## Chunk 5: C7 (fronteras por papel) y C12 (fechas locales)

### Task 9: C7 — el papel no pisa `closing_day`; el período se deriva de los cierres reales

**Files:**
- Modify: `shared-logic/modules/finance.balance.ts:191-204` (agregar tipo + 2 funciones después de `statementPeriodFor`)
- Modify: `shared-logic/modules/finance.ipc.ts` (imports `:6-48`; `getStatementDetail` `:683-711`; `computeStatementTotals` `:716-753`; llamada en `generateStatement`; `saveStatementPaper` card select y `:948-965`)
- Test: `tests/modules/finance/finance.statement-boundaries.test.ts` (nuevo)
- Test (reescribir): `tests/modules/finance/finance.statement-paper.test.ts:107-120`

- [ ] **Paso 9.1 — Tests puros que fallan.** Crear `tests/modules/finance/finance.statement-boundaries.test.ts`:

```ts
/**
 * C7 (spec 2026-09-05-coinify-integridad): `closing_day` es configuración del
 * usuario y el papel no la pisa. Para ubicar una compra manual sin
 * `statement_period`, los cierres REALES de los papeles guardados
 * (`finance_credit_card_statements.closing_date`) mandan sobre el día fijo.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { financeMigrations } from '@modules/finance/finance.schema';
import { statementPeriodForWithBoundaries } from '../../../shared-logic/modules/finance.balance';

const harness = vi.hoisted(() => ({ db: null as unknown as Database.Database }));

import { getHandler } from '../../../shared-logic/registry';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  app: { getPath: () => '.' },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  BrowserWindow: { getFocusedWindow: () => null },
}));

vi.mock('../../../shared-logic/db', () => ({ getDb: () => harness.db }));

const { registerFinanceIpcHandlers } = await import('../../../shared-logic/modules/finance.ipc');
registerFinanceIpcHandlers();

async function invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const fn = getHandler(channel);
  if (!fn) throw new Error(`no handler registered for ${channel}`);
  return (await fn({}, ...args)) as T;
}

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  for (const m of financeMigrations) db.exec(m.up);
  return db;
}

describe('statementPeriodForWithBoundaries (pura)', () => {
  const NOV_DEC = [
    { periodMonth: '2025-11', closingDate: '2025-11-26' },
    { periodMonth: '2025-12', closingDate: '2025-12-28' },
  ];

  it('un statement_period explícito gana siempre', () => {
    expect(statementPeriodForWithBoundaries({ date: '2025-11-27', statementPeriod: '2026-02' }, 28, NOV_DEC)).toBe('2026-02');
  });

  it('con papeles consecutivos, una compra entre dos cierres cae en el segundo', () => {
    expect(statementPeriodForWithBoundaries({ date: '2025-11-27' }, 28, NOV_DEC)).toBe('2025-12');
    expect(statementPeriodForWithBoundaries({ date: '2025-12-28' }, 28, NOV_DEC)).toBe('2025-12');
  });

  it('el primer papel absorbe solo un mes hacia atrás', () => {
    expect(statementPeriodForWithBoundaries({ date: '2025-11-25' }, 28, NOV_DEC)).toBe('2025-11');
    expect(statementPeriodForWithBoundaries({ date: '2025-10-30' }, 28, NOV_DEC)).toBe('2025-11');
    // Más vieja que un mes antes del primer cierre: vuelve al closing_day.
    expect(statementPeriodForWithBoundaries({ date: '2025-10-20' }, 28, NOV_DEC)).toBe('2025-10');
  });

  it('después del último cierre conocido, manda closing_day', () => {
    expect(statementPeriodForWithBoundaries({ date: '2026-01-05' }, 28, NOV_DEC)).toBe('2026-01');
    expect(statementPeriodForWithBoundaries({ date: '2026-01-29' }, 28, NOV_DEC)).toBe('2026-02');
  });

  it('sin papeles, es getStatementPeriod', () => {
    expect(statementPeriodForWithBoundaries({ date: '2025-11-27' }, 28, [])).toBe('2025-11');
    expect(statementPeriodForWithBoundaries({ date: '2025-11-29' }, 28, [])).toBe('2025-12');
  });

  it('un hueco entre papeles no arrastra dos meses al segundo', () => {
    const GAP = [
      { periodMonth: '2025-09', closingDate: '2025-09-26' },
      { periodMonth: '2025-12', closingDate: '2025-12-28' },
    ];
    expect(statementPeriodForWithBoundaries({ date: '2025-11-27' }, 28, GAP)).toBe('2025-11');
    expect(statementPeriodForWithBoundaries({ date: '2025-12-05' }, 28, GAP)).toBe('2025-12');
  });
});

describe('C7 — el papel completa closing_day, nunca lo pisa; el detalle usa los cierres reales', () => {
  let cardId: string;

  async function purchase(date: string, amount: number): Promise<string> {
    return invoke<string>('finance:addTransaction', {
      type: 'expense', amount, category: 'Compras', description: `compra ${date}`,
      date, paymentMethod: 'credit_card', creditCardId: cardId,
    });
  }

  function cardDays() {
    return harness.db.prepare('SELECT closing_day AS closingDay, due_day AS dueDay FROM finance_credit_cards WHERE id = ?')
      .get(cardId) as { closingDay: number; dueDay: number | null };
  }

  async function detailDates(statementId: string): Promise<string[]> {
    const d = await invoke<{ transactions: Array<{ date: string }> }>('finance:getStatementDetail', statementId);
    return d.transactions.map((t) => t.date).sort();
  }

  beforeEach(async () => {
    harness.db = setupDb();
    cardId = await invoke<string>('finance:addCreditCard', { name: 'Visa', closingDay: 28 });
  });

  it('closing_day 28 sigue en 28 tras un papel que cierra el 26', async () => {
    await purchase('2025-11-10', 1000);
    await invoke('finance:generateStatement', cardId, '2025-11');
    await invoke('finance:saveStatementPaper', cardId, { period: '2025-11', closingDate: '2025-11-26', dueDate: '2025-12-05' });
    expect(cardDays()).toEqual({ closingDay: 28, dueDay: 5 }); // due_day estaba vacío: se completa
  });

  it('un closing_day vacío (fila insertada por SQL o sync) sí se completa', async () => {
    harness.db.prepare('UPDATE finance_credit_cards SET closing_day = 0 WHERE id = ?').run(cardId);
    await purchase('2025-11-10', 1000);
    await invoke('finance:generateStatement', cardId, '2025-11');
    await invoke('finance:saveStatementPaper', cardId, { period: '2025-11', closingDate: '2025-11-26' });
    expect(cardDays().closingDay).toBe(26);
  });

  it('con papeles de nov (26) y dic (28), el 27/11 es diciembre y el 25/11 es noviembre', async () => {
    await purchase('2025-11-10', 1000);
    const nov = await invoke<string>('finance:generateStatement', cardId, '2025-11');
    await invoke('finance:saveStatementPaper', cardId, { period: '2025-11', closingDate: '2025-11-26' });
    await purchase('2025-12-10', 1000);
    const dec = await invoke<string>('finance:generateStatement', cardId, '2025-12');
    await invoke('finance:saveStatementPaper', cardId, { period: '2025-12', closingDate: '2025-12-28' });

    await purchase('2025-11-27', 500);
    await purchase('2025-11-25', 700);
    await invoke('finance:generateStatement', cardId, '2025-11');
    await invoke('finance:generateStatement', cardId, '2025-12');

    expect(await detailDates(nov)).toEqual(['2025-11-10', '2025-11-25']);
    expect(await detailDates(dec)).toEqual(['2025-11-27', '2025-12-10']);
    const decRow = harness.db.prepare('SELECT calculated_amount AS c FROM finance_credit_card_statements WHERE id = ?').get(dec) as { c: number };
    expect(decRow.c).toBe(1500);
  });

  it('sin papeles, la derivación sigue siendo por closing_day', async () => {
    await purchase('2025-11-27', 500);
    await purchase('2025-11-29', 700);
    const nov = await invoke<string>('finance:generateStatement', cardId, '2025-11');
    const dec = await invoke<string>('finance:generateStatement', cardId, '2025-12');
    expect(await detailDates(nov)).toEqual(['2025-11-27']);
    expect(await detailDates(dec)).toEqual(['2025-11-29']);
  });
});
```

- [ ] **Paso 9.2 — Verlo fallar.** `npm test -- tests/modules/finance/finance.statement-boundaries.test.ts` → falla al importar: `statementPeriodForWithBoundaries` no existe.

- [ ] **Paso 9.3 — Funciones puras en `finance.balance.ts`.** Después de `statementPeriodFor` (`:204`) agregar:

```ts
/** Cierre REAL de un resumen guardado: el papel manda sobre el `closing_day` fijo. */
export interface StatementBoundary {
  periodMonth: string;
  /** `finance_credit_card_statements.closing_date` (YYYY-MM-DD). */
  closingDate: string;
}

/** Fronteras de una tarjeta, ordenadas por cierre. Solo resúmenes vivos con papel. */
export function loadStatementBoundaries(db: SqlDatabase, creditCardId: string): StatementBoundary[] {
  return db.prepare(`
    SELECT period_month AS periodMonth, closing_date AS closingDate
    FROM finance_credit_card_statements
    WHERE credit_card_id = ? AND deleted_at IS NULL AND closing_date IS NOT NULL
    ORDER BY closing_date ASC
  `).all(creditCardId) as StatementBoundary[];
}

/**
 * The statement period of a card purchase, using the REAL closing dates of the
 * statements the user saved (`closing_date`) before the card's fixed
 * `closing_day`. Rules, in order:
 *  1. an explicit `statementPeriod` wins;
 *  2. no boundary closes on or after the purchase → `getStatementPeriod`;
 *  3. the previous boundary `a` closed before the purchase and is the
 *     consecutive month of `b` → `b.periodMonth`;
 *  4. otherwise (first paper, or a gap) → `b.periodMonth` only if the purchase
 *     is at most one month older than `b`'s closing;
 *  5. anything else → `getStatementPeriod`.
 */
export function statementPeriodForWithBoundaries(
  tx: { date: string; statementPeriod?: string | null },
  closingDay: number,
  boundaries: StatementBoundary[],
): string {
  if (isValidMonthString(tx.statementPeriod)) return tx.statementPeriod;
  const idx = boundaries.findIndex((b) => b.closingDate >= tx.date);
  if (idx === -1) return getStatementPeriod(tx.date, closingDay);
  const b = boundaries[idx];
  const a = idx > 0 ? boundaries[idx - 1] : null;
  if (a && a.closingDate < tx.date && a.periodMonth === addMonthsToMonth(b.periodMonth, -1)) {
    return b.periodMonth;
  }
  if (tx.date > addMonthsClamped(b.closingDate, -1)) return b.periodMonth;
  return getStatementPeriod(tx.date, closingDay);
}
```

- [ ] **Paso 9.4 — Usarlas en `finance.ipc.ts`.**
  - Import (`:6-48`): agregar `loadStatementBoundaries,`, `statementPeriodForWithBoundaries,` y `type StatementBoundary,`; **borrar la línea 34 (`statementPeriodFor,`)**: tras los dos reemplazos de abajo no queda ningún uso en `finance.ipc.ts` y `tsc` falla por import sin usar (`noUnusedLocals`). Verificar con `rg "statementPeriodFor\b" shared-logic/modules/finance.ipc.ts` → cero resultados.
  - `getStatementDetail` (`:705-708`): reemplazar por
    ```ts
    // The explicit statement_period (imports) wins; then the real closing dates
    // of the saved papers; only then the card's fixed closing day.
    const boundaries = loadStatementBoundaries(db, statement.creditCardId);
    const filtered = (transactions as Array<{ date: string; statementPeriod?: string | null; [key: string]: unknown }>).filter((tx) => {
      return statementPeriodForWithBoundaries(tx, statement.closingDay, boundaries) === statement.periodMonth;
    });
    ```
  - `computeStatementTotals` (`:716-753`): agregar quinto parámetro `boundaries: StatementBoundary[]` (importar el tipo con `type StatementBoundary` desde `finance.balance`) y en `:737` usar `statementPeriodForWithBoundaries(tx, closingDay, boundaries)`.
  - `generateStatement`: antes de `const { ars, usd } = computeStatementTotals(…)` agregar `const boundaries = loadStatementBoundaries(db, creditCardId);` y pasarlo como quinto argumento.
  - `saveStatementPaper`: cambiar el select de la tarjeta (`:901-904`) por `'SELECT id, closing_day AS closingDay, due_day AS dueDay FROM finance_credit_cards WHERE id = ? AND deleted_at IS NULL'` con tipo `{ id: string; closingDay: number | null; dueDay: number | null }`, y reemplazar `:948-955` por:
    ```ts
      // La tarjeta: solo lo que el papel efectivamente trae, y el cierre y el
      // vencimiento SOLO si estaban vacíos (invariante 5: closing_day es
      // configuración del usuario; el papel la completa, nunca la pisa). Un
      // vacío solo aparece en filas insertadas por SQL o por sync: el alta
      // rechaza < 1.
      const sets: string[] = [];
      const vals: unknown[] = [];
      const closingDay = dayOf(paper.closingDate);
      const dueDay = dayOf(paper.dueDate);
      if (closingDay !== null && !(Number(card.closingDay) >= 1)) { sets.push('closing_day = ?'); vals.push(closingDay); }
      if (dueDay !== null && !(Number(card.dueDay) >= 1)) { sets.push('due_day = ?'); vals.push(dueDay); }
    ```

- [ ] **Paso 9.5 — Reescribir `finance.statement-paper.test.ts:107-120`.** Reemplazar el test por:

```ts
  it('completa vencimiento, últimos 4 y emisor; el cierre del usuario NO se pisa', async () => {
    await purchase('2025-11-10', 15_000);
    await invoke('finance:generateStatement', cardId, '2025-11');
    await invoke('finance:saveStatementPaper', cardId, PAPER);

    const card = harness.db.prepare(
      'SELECT closing_day, due_day, last4, issuer FROM finance_credit_cards WHERE id = ?',
    ).get(cardId) as Record<string, unknown>;
    expect(card.closing_day).toBe(25); // configuración del usuario: el papel (27) no la pisa
    expect(card.due_day).toBe(5);      // estaba vacío: se completa
    expect(card.last4).toBe('1234');
    expect(card.issuer).toBe('galicia_visa');
  });

  it('un cierre vacío sí se completa desde el papel', async () => {
    harness.db.prepare('UPDATE finance_credit_cards SET closing_day = 0 WHERE id = ?').run(cardId);
    await purchase('2025-11-10', 15_000);
    await invoke('finance:generateStatement', cardId, '2025-11');
    await invoke('finance:saveStatementPaper', cardId, PAPER);
    const card = harness.db.prepare('SELECT closing_day FROM finance_credit_cards WHERE id = ?').get(cardId) as { closing_day: number };
    expect(card.closing_day).toBe(27);
  });
```

- [ ] **Paso 9.6 — Verlo pasar.** `npm test -- tests/modules/finance/finance.statement-boundaries.test.ts tests/modules/finance/finance.statement-paper.test.ts tests/modules/finance` → verde. `npx tsc --noEmit && npm run typecheck:shared-logic`.

- [ ] **Paso 9.7 — Commit.**
```
git add shared-logic/modules/finance.balance.ts shared-logic/modules/finance.ipc.ts tests/modules/finance/finance.statement-boundaries.test.ts tests/modules/finance/finance.statement-paper.test.ts
git commit -m "fix(finance): el papel no pisa closing_day y el período usa los cierres reales de los resúmenes (C7)"
```

### Task 10: C12 — `settleLoan` y `updateRecurringAmount` fechan en el día local

**Files:**
- Modify: `shared-logic/modules/finance.ipc.ts:1385-1390` (settleLoan), `:1690-1713` (updateRecurringAmount)
- Test: `tests/modules/finance/finance.today-dates.test.ts` (nuevo)

- [ ] **Paso 10.1 — Test.** Crear `tests/modules/finance/finance.today-dates.test.ts` con el arnés de `finance.dashboard-period.test.ts:8-58` (fake timers solo de `Date`) y:

```ts
import { todayDateString } from '../../../shared/date-utils';

/**
 * A las 23:30 hora local, `nowIso().slice(0, 10)` (UTC) ya es MAÑANA en
 * cualquier huso al oeste de Greenwich (ART = UTC-3). La fecha de un hecho del
 * usuario es la del reloj de pared. En un CI en UTC este test pasa antes y
 * después del fix; en la máquina del usuario (ART) falla antes.
 */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 4, 23, 30, 0));
  harness.db = setupDb();
});

afterEach(() => { vi.useRealTimers(); });

describe('C12 — fechas del día local, no del UTC', () => {
  it('settleLoan fecha hoy, no mañana', async () => {
    const id = await invoke<string>('finance:addLoan', { personName: 'Ana', direction: 'lent', amount: 100, date: '2026-09-01' });
    await invoke('finance:settleLoan', id);
    const row = harness.db.prepare('SELECT settled_date AS d FROM finance_loans WHERE id = ?').get(id) as { d: string };
    expect(row.d).toBe(todayDateString());
    expect(row.d).toBe('2026-09-04');
  });

  it('updateRecurringAmount registra el cambio con fecha de hoy', async () => {
    const id = await invoke<string>('finance:addRecurring', { name: 'Luz', type: 'expense', amount: 1000 });
    expect(await invoke('finance:updateRecurringAmount', id, 1500)).toEqual({ ok: true });
    const row = harness.db.prepare('SELECT effective_date AS d FROM finance_recurring_amount_history WHERE recurring_id = ?').get(id) as { d: string };
    expect(row.d).toBe(todayDateString());
    expect(row.d).toBe('2026-09-04');
  });
});
```

- [ ] **Paso 10.2 — Verlo fallar** (en una máquina con TZ al oeste de UTC): `npm test -- tests/modules/finance/finance.today-dates.test.ts` → `expected '2026-09-05' to be '2026-09-04'`.

- [ ] **Paso 10.3 — Implementar.**
  - `settleLoan` (`:1388-1389`): `.run(todayDateString(), now, id);`
  - `updateRecurringAmount` (`:1696`): `const today = todayDateString();`

- [ ] **Paso 10.4 — Verlo pasar y commit.** `npm test -- tests/modules/finance/finance.today-dates.test.ts tests/modules/finance/finance.dashboard-period.test.ts` → verde. `npx tsc --noEmit && npm run typecheck:shared-logic`.
```
git add shared-logic/modules/finance.ipc.ts tests/modules/finance/finance.today-dates.test.ts
git commit -m "fix(finance): settleLoan y updateRecurringAmount fechan en el día local (C12)"
```

---

## Chunk 6: código muerto, `api-ext.ts` y verificación final

### Task 11: Borrar handlers muertos, sus canales y tipos, la lectura descartada y `transactionCount`

**Files:**
- Modify: `shared-logic/modules/finance.ipc.ts` (`finance:getTodayTransactionsCount` `:1086-1091`, `finance:getLoansByPerson` `:1333-1343`, `finance:deleteLoanPayment` `:1442-1447`, `finance:getPreviousMonthSummary` `:1918-1931`, `finance:getInstallmentGroups` `:1115-1128`)
- Modify: `shared/api-channels.ts:236, 241, 280, 284`
- Modify: `shared/types.ts:688, 693, 787, 795`
- Modify: `src/modules/finance/components/DashboardWidget.tsx:59-66`
- Test: `tests/shared/api-channels.test.ts:15`, `tests/modules/finance/finance.third-party.test.ts:82-90`, `tests/modules/finance/finance.ipc.test.ts:865-884`

- [ ] **Paso 11.1 — Tests primero.**
  - `tests/shared/api-channels.test.ts:15`: `expect(entries).toHaveLength(265);` (269 − 4).
  - `finance.third-party.test.ts:82-90`, reemplazar por:
    ```ts
    it('finance:getInstallmentGroups resolves it too', async () => {
      await createPurchase();
      const groups = await invoke<Array<{ thirdPartyName: string | null }>>('finance:getInstallmentGroups');
      expect(groups).toHaveLength(1);
      expect(groups[0].thirdPartyName).toBe('Malena');
      expect(groups[0]).not.toHaveProperty('transactionCount');
    });
    ```
  - `finance.ipc.test.ts:865-884`: borrar el test `groups loans by person (getLoansByPerson)` entero (es un espejo SQL de un handler que deja de existir).
  - Correr `npm test -- tests/shared/api-channels.test.ts tests/modules/finance/finance.third-party.test.ts` → los dos fallan.

- [ ] **Paso 11.2 — Borrar.**
  - `finance.ipc.ts`: eliminar los cuatro `ipcHandle(...)` completos (con sus comentarios `// ── C8: Previous month summary` en `:1918`). Verificar con `rg "getLoansByPerson|deleteLoanPayment|getPreviousMonthSummary|getTodayTransactionsCount" shared-logic shared src tests` → cero resultados al terminar la task.
  - `getInstallmentGroups` (`:1115-1128`): quitar `,\n             COUNT(t.id) AS transactionCount`, el `LEFT JOIN finance_transactions t ON …` y el `GROUP BY g.id`.
  - `shared/api-channels.ts`: eliminar las líneas `236` (`financeGetLoansByPerson`), `241` (`financeDeleteLoanPayment`), `280` (`financeGetPreviousMonthSummary`), `284` (`financeGetTodayTransactionsCount`). `electron/preload.ts` se arma en runtime desde `API_CHANNELS` (`preload.ts:2`); no se toca.
  - `shared/types.ts`: eliminar `688`, `693`, `787`, `795`.
  - `DashboardWidget.tsx:59-66`: quitar `window.api.financeGetMonthlyTotal(),` y el comentario de `:60-62`; `.then(([count, b]) => {`. El handler `finance:getMonthlyTotal` y su canal QUEDAN (la spec solo borra la llamada descartada).

- [ ] **Paso 11.3 — Verificar.** `npx tsc --noEmit && npm run typecheck:shared-logic && npm test` → suite completa en verde (`Test Files … passed`, 0 failed).

- [ ] **Paso 11.4 — Commit.**
```
git add shared-logic/modules/finance.ipc.ts shared/api-channels.ts shared/types.ts src/modules/finance/components/DashboardWidget.tsx tests/shared/api-channels.test.ts tests/modules/finance/finance.third-party.test.ts tests/modules/finance/finance.ipc.test.ts
git commit -m "chore(finance): borrar handlers sin llamador, la lectura descartada del widget y transactionCount"
```

### Task 12: `api-ext.ts` → `utils/result.ts`, sin feature-detection

Ningún canal de `api-ext.ts` falta ya en `shared/api-channels.ts:207-298`; el `bridge()`/`hasXSupport` no protege nada. `unwrap`/`failureMessage` (12 componentes) se mueven sin cambios a `utils/result.ts`; `payStatement`/`importConfirm` son redundantes con `HubtifyApi` (`financeImportConfirm` en `shared/types.ts:714` ya tiene los 5 argumentos y `financePayStatement` los tiene desde Task 8), así que se BORRAN y los dos llamadores usan `window.api.*` directo; todo lo demás también se reemplaza por `window.api.*` directo. El `bridge()` de `display-mode.ts:77` queda fuera de alcance.

**Files:**
- Create: `src/modules/finance/utils/result.ts`
- Modify: `src/modules/finance/types.ts` (tipos `AccountsOverview`, `BudgetCategoryStatus`, `BudgetStatus`)
- Modify (solo ruta del import): `DashboardWidget.tsx:8`, `Installments.tsx:14`, `Loans.tsx:15`, `shared/CategoryManager.tsx:8`, `shared/CreditCardManager.tsx:10`
- Modify: `Transactions.tsx:21, 223-226`; `Recurring.tsx:15, 138-141`; `shared/AccountSelect.tsx:3, 72-86`; `shared/AccountManager.tsx:11-18, 63-65, 91, 118, 143, 160, 175`; `Dashboard.tsx:15-26, 498-503, 509-513, 609-612, 671, 675, 820-825`; `Import.tsx:16-22, 107, 120-123, 346-349, 452-457, 829`; `shared/StatementDetail.tsx:9, 90-97`; `utils/budget-guards.ts:11, 60, 109`
- Delete: `src/modules/finance/utils/api-ext.ts`
- Test (fixture): `tests/visual/coinify-chest.browser.test.tsx:25-52`

- [ ] **Paso 12.1 — `result.ts`.** Crear `src/modules/finance/utils/result.ts` con el contenido de `api-ext.ts:1-65` reducido a: el encabezado (solo el punto 1 «Failure envelopes»), `FinanceFailure`, `FinanceResult`, `isFailure` (exportada), `unwrap`, `failureMessage`. Sin cambios de lógica.

- [ ] **Paso 12.2 — Borrar los pass-through.** `payStatement` (`api-ext.ts:167-180`) e `importConfirm` (`:186-201`) no se mueven: sus únicos llamadores pasan a `window.api`:
  - `StatementDetail.tsx:9` → `import { unwrap, failureMessage } from '../../utils/result';` y en `:90-97`:
    ```ts
    const result = await unwrap(
      window.api.financePayStatement(
        statement.id,
        payAmount,
        hasUsd ? payAmountUsd : undefined,
        accountsSupported ? accountIdForSubmit(accountValue) : undefined,
        todayDateString(),
      ),
    );
    ```
  - `Import.tsx:346-349`: `const result = await window.api.financeImportConfirm(` (mismos argumentos).

- [ ] **Paso 12.3 — Tipos.** En `src/modules/finance/types.ts`, después de `FinanceAccount` (`:58`):

```ts
/** `finance:getAccountsOverview`: el cofre abierto, filas más totales por moneda. */
export interface AccountsOverview {
  accounts: FinanceAccount[];
  totalArs: number;
  totalUsd: number;
}

export interface BudgetCategoryStatus {
  category: string;
  limit: number;
  spent: number;
  /** Sin clampear: más de 100 es un límite reventado. */
  pct: number;
}

/** `finance:getBudgetStatus`. */
export interface BudgetStatus {
  month: string;
  categories: BudgetCategoryStatus[];
  totalLimit: number;
  totalSpent: number;
}
```

- [ ] **Paso 12.4 — Cambios de import (solo ruta).** En `DashboardWidget.tsx:8`, `Installments.tsx:14`, `Loans.tsx:15`, `shared/CategoryManager.tsx:8`, `shared/CreditCardManager.tsx:10`: `'../utils/api-ext'` → `'../utils/result'` (o `'../../utils/result'` en `shared/`).

- [ ] **Paso 12.5 — `Transactions.tsx` y `Recurring.tsx`.** Import → `import { unwrap, failureMessage } from '../utils/result';`. `loadAccounts` (Transactions `:223-226`, Recurring `:138-141`) →
```ts
  const loadAccounts = useCallback(() => {
    window.api.financeGetAccounts()
      .then((rows) => setAccounts((rows as FinanceAccount[]) ?? []))
      .catch((err) => { console.error('[Transactions] financeGetAccounts failed:', err); setAccounts([]); });
  }, []);
```
(`FinanceAccount` ya está importado en ambos: `Transactions.tsx:22`, `Recurring.tsx:10`.)

- [ ] **Paso 12.6 — `AccountSelect.tsx`.** Borrar el import de `:3`. Reemplazar `:72-81` por:
```ts
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      let live: FinanceAccount[] = [];
      try {
        live = ((await window.api.financeGetAccounts()) as FinanceAccount[]) ?? [];
      } catch (err) {
        console.error('[AccountSelect] financeGetAccounts failed:', err);
      }
      if (cancelled) return;
```
y actualizar el docblock (`:6-13`): ya no hay feature-detection; el componente no renderiza nada cuando no hay cuentas vivas.

- [ ] **Paso 12.7 — `AccountManager.tsx`.** Import `:11-18` → `import { unwrap, failureMessage } from '../../utils/result';`. Cambios (`unwrap` devuelve `{ ok: true, value }` o `{ ok: false, reason }`; acá nunca se lee `value`):
  - `:63-65`:
    ```ts
    const loadAccounts = useCallback(() => {
      window.api.financeGetAccounts()
        .then((rows) => setAccounts((rows as FinanceAccount[]) ?? []))
        .catch((err) => { console.error('[AccountManager] financeGetAccounts failed:', err); setAccounts([]); });
    }, []);
    ```
  - `:91-100` (`handleCreate`):
    ```ts
    const result = await unwrap(window.api.financeSaveAccount({
      name: newName.trim(),
      kind: newKind,
      currency: newCurrency,
      initialBalance: Number.isFinite(initial) ? initial : 0,
    }));
    if (!result.ok) {
      toast({ type: 'warning', message: failureMessage(result.reason, t) });
      return;
    }
    ```
  - `:118-131` (`handleUpdate`):
    ```ts
    const result = await unwrap(window.api.financeSaveAccount({
      id: editingId,
      name: editName.trim(),
      kind: editKind,
      // The currency of an account with history must not flip — its balance
      // would silently change unit. Not offered in the edit row.
      currency: account.currency,
      initialBalance: Number.isFinite(initial) ? initial : 0,
      order: account.accountOrder,
    }));
    if (!result.ok) {
      toast({ type: 'warning', message: failureMessage(result.reason, t) });
      return;
    }
    ```
  - `:143-147` (`handleDelete`):
    ```ts
    const result = await unwrap(window.api.financeDeleteAccount(id));
    if (!result.ok) {
      toast({ type: 'warning', message: failureMessage(result.reason, t) });
      return;
    }
    ```
  - `:160-164` (`handleTransfer`):
    ```ts
    const result = await unwrap(window.api.financeTransferBetweenAccounts({ fromId: transferFrom, toId: transferTo, amount }));
    if (!result.ok) {
      toast({ type: 'warning', message: failureMessage(result.reason, t) });
      return;
    }
    ```
  - `:175`: `const canTransfer = accounts.length >= 2;`

- [ ] **Paso 12.8 — `Dashboard.tsx`.** Import `:15-26` → `import { unwrap } from '../utils/result';` + `import type { AccountsOverview, BudgetStatus } from '../types';` + `import type { ExpenseBreakdownByCurrency } from '../../../../shared/types';`. Cambios:
  - `:502`: `window.api.financeGetExpenseBreakdown(month).catch(() => null),`
  - `:512`: `window.api.financeGetExpenseBreakdownForRange(startMonth, endMonth).catch(() => null),`
  - `:609-612`:
    ```ts
    const loadAccountsOverview = useCallback(() => {
      window.api.financeGetAccountsOverview()
        .then((overview) => setAccountsOverview(overview as AccountsOverview))
        .catch(() => setAccountsOverview(null));
    }, []);
    ```
  - `:671`: `const budgetsApply = rangeMode === 'month' && mode === 'ars';`
  - `:675`: `window.api.financeGetBudgetStatus(forMonth)`
  - `:820-825`: `const res = await unwrap(window.api.financeSetBudget(category, limit));` / `if (!res.ok) {`.

- [ ] **Paso 12.9 — `Import.tsx`.** Borrar el import `:16-22` entero, agregar `import { unwrap } from '../utils/result';` y `FinanceImportBatch as ImportBatch` al `import type { … } from '../../../../shared/types'` de `:7`. Borrar `:107` (`batchSupport`); `:120-123` →
```ts
  const loadBatches = useCallback(() => {
    window.api.financeGetImportBatches().then(setBatches).catch(() => setBatches([]));
  }, []);
```
`:452-457` (`handleUndoBatch`). `unwrap` devuelve `{ ok: true, value: T }` (el payload va en `value`) o `{ ok: false, reason }`; `financeUndoImportBatch` devuelve `{ ok: boolean; reason?: string; deleted?: number }`, así que el número está en `res.value.deleted` (tipo `number | undefined`):
```ts
      const res = await unwrap(window.api.financeUndoImportBatch(batch.id));
      if (!res.ok) {
        toast({ type: 'warning', message: t('coinify.importUndoError', 'No se pudo revertir la importación') });
        return;
      }
      toast({ type: 'coin', message: t('coinify.importUndone', '{{count}} movimientos revertidos', { count: res.value.deleted ?? 0 }) });
```
`:829`: `{batches.length > 0 && (`.

- [ ] **Paso 12.10 — `budget-guards.ts`.** `:11` → `import type { BudgetStatus } from '../types';` y agregar:
```ts
/** `null` si el puente falla: un presupuesto que no se pudo leer no se anuncia. */
async function budgetStatus(month: string): Promise<BudgetStatus | null> {
  try {
    return await window.api.financeGetBudgetStatus(month);
  } catch (err) {
    console.error('[budget-guards] financeGetBudgetStatus failed:', err);
    return null;
  }
}
```
`:60` y `:109`: `getBudgetStatus(` → `budgetStatus(`.

- [ ] **Paso 12.11 — Borrar `api-ext.ts` y verificar.** `rm src/modules/finance/utils/api-ext.ts`. `rg "api-ext|payStatement\(|importConfirm\(" src` → solo el comentario de `display-mode.ts:12,73` (fuera de alcance; dejar) y los usos de i18n `t('coinify.payStatement')` / `t('coinify.importConfirm')`. `npx tsc --noEmit` → sin salida. `npm test` → verde.

- [ ] **Paso 12.12 — Fixtures de los tests visuales.** Relevamiento (`rg -n "\.api = \{" tests/visual` + `installApi` de `audit-hub-harness.tsx:109-119`, que envuelve en `Proxy`):
  - Stubs con `new Proxy` (devuelven una función para cualquier clave; NO se tocan): `coinify-empty-loading`, `audit-coin-dashboard`, `audit-coin-ledger`, `audit-coin-managers`, `audit-coin-layout`, `audit-coin-book-header`, `audit-hub-density`, `entry-defaults*`, `coinify-installments-recurring`, `state-fallbacks:38` y todo `tests/visual/mobile/**` (`installApi(FINANCE_API)`).
  - Stubs planos que NO montan Coinify (no se tocan): `nutrify-screens.browser.test.tsx:127` (Nutrify), `achievements-shelf.browser.test.tsx:31,81` (logros), `state-fallbacks.browser.test.tsx:238` (widget del Caldero).
  - Único stub plano que monta Coinify: **`tests/visual/coinify-chest.browser.test.tsx:25-52`** (`Dashboard`). Agregar dentro de `stubApi`:
    ```ts
        // Antes degradaban a null vía api-ext; ahora el dashboard los llama directo.
        financeGetExpenseBreakdown: () => Promise.resolve(null),
        financeGetExpenseBreakdownForRange: () => Promise.resolve(null),
        financeSetBudget: () => Promise.resolve({ ok: true }),
        financeDeleteAccount: () => Promise.resolve({ ok: true }),
        financeTransferBetweenAccounts: () => Promise.resolve({ ok: true, transferGroupId: 'tg', expenseId: 'e', incomeId: 'i' }),
    ```
    Los dos primeros se llaman al montar (`loadDashboard`); los otros tres solo por acción del usuario, pero `canTransfer` ya no se esconde y un stub incompleto convertiría un click en `TypeError`.
  - Correr `npm run test:visual -- tests/visual/coinify-chest.browser.test.tsx tests/visual/coinify-empty-loading.browser.test.tsx tests/visual/audit-coin-dashboard.browser.test.tsx tests/visual/audit-coin-ledger.browser.test.tsx tests/visual/audit-coin-managers.browser.test.tsx` → verde.

- [ ] **Paso 12.13 — Commit.**
```
git add src/modules/finance tests/visual/coinify-chest.browser.test.tsx
git commit -m "refactor(finance): api-ext.ts pasa a utils/result.ts; window.api directo sin feature-detection"
```

### Task 13: Verificación final

- [ ] `npx tsc --noEmit` → sin salida, exit 0.
- [ ] `npm run typecheck:shared-logic` → sin salida, exit 0.
- [ ] `npm test` → `Test Files N passed`, `0 failed`. Anotar N y la cantidad de tests en el mensaje final.
- [ ] `npm run lint` → 0 errores.
- [ ] `rg "transaction_id|transactionId" src/modules/finance shared-logic/modules/finance*` → solo los lugares esperados: `finance.ipc.ts` (`deleteCreditCard`, `getCreditCardStatements`, `settleStatement`, `generateStatement`), `src/modules/finance/types.ts:175-176`, `src/modules/finance/utils/rpg-events.ts` (es el id de la transacción del evento RPG, no del resumen). Ningún `.tsx` lee `transactionId` de un resumen.
- [ ] `rg "getLoansByPerson|deleteLoanPayment|getPreviousMonthSummary|getTodayTransactionsCount|hasAccountsSupport|hasBudgetSupport|hasImportBatchSupport|hasTransferSupport|finance-calls|api-ext" src shared shared-logic tests` → solo el comentario de `display-mode.ts` (fuera de alcance).
- [ ] `rg "version: 2[01]" src/modules/finance/finance.schema.ts` → dos migraciones, v20 (columna + backfill, Task 1) y v21 (Pago Tarjeta de pendientes, Task 8), cada una en el commit del código que la necesita.
- [ ] Riesgo de la spec «Migración v20 sobre datos reales»: antes de publicar, copiar la base de producción del usuario, correr la app contra la copia y comparar totales por mes (`finance:getMonthlyBalance`) antes/después. No es parte de este plan de código; queda como paso previo a la release.
- [ ] `git log --oneline master..HEAD` → 12 commits, todos `type(finance): …`, sin atribución a IA.

---

## Discrepancias con la spec

Anotadas con evidencia; en el plan se siguió la spec salvo donde era imposible (y ahí está dicho qué se hizo). Tres discrepancias de la primera versión de este plan (el monto como identidad del plan en C3, la v20 partida en dos commits, y los pass-through `payStatement`/`importConfirm`) se resolvieron corrigiendo la spec: el monto es desempate, la parte de resúmenes es la v21, y los pass-through redundantes con `HubtifyApi` se borran.

1. **`Transaction` no vive en `shared/types.ts`.** La spec (C1) dice «`Transaction` en `shared/types.ts` gana `purchaseDate?`». `rg "interface Transaction" shared/types.ts` no devuelve nada; la interfaz está en `src/modules/finance/types.ts:10-33`. El plan la agrega ahí (Task 1, paso 1.6).

2. **`npm run typecheck` no existe.** `package.json:13-32` solo tiene `typecheck:shared-logic`; CI corre `npx tsc --noEmit` (`.github/workflows/ci.yml:36`). El plan usa `npx tsc --noEmit` + `npm run typecheck:shared-logic` donde la spec/el pedido dicen `npm run typecheck`.

3. **`api-ext.ts` está en `src/modules/finance/utils/`, no en `src/modules/finance/`.** Ruta real: `src/modules/finance/utils/api-ext.ts` (importada como `'../utils/api-ext'` en 13 archivos). Sin impacto en el contenido del plan.

4. **`payStatement` con `ars = 0` y `usd > 0`.** La spec (C8/C9) dice «por cada moneda (ARS siempre; USD si `usd > 0`)». `payStatement` (`finance.ipc.ts:1020-1021`) acepta `ars = 0` cuando `usd > 0`; «ARS siempre» insertaría un «Pago Tarjeta» de $0. `settleStatement` (Task 8) trata las dos patas igual: solo escribe si el monto es `> 0` y retira una pata previa que quedó en cero. Es la generalización mínima; el resultado para todos los casos de la tabla de tests de la spec es el mismo.

5. **`finance.statement-paper.test.ts:134-150` no rompe por sí solo.** La spec dice que «rompe» al pasar `saveStatementPaper` a async; el test ya hace `await invoke(...)`, así que sigue verde. El plan lo EXTIENDE (paso 8.10) para afirmar la transacción fechada en el `closingDate`, que es lo que la nueva semántica agrega.

6. **`tests/shared/api-channels.test.ts:15` cuenta canales.** No está en la lista de tests a adaptar de la spec; al borrar 4 canales pasa de 269 a 265 (Task 11, paso 11.1).

7. **Tests visuales y stubs planos.** La spec no menciona `tests/visual`. Al quitar `hasXSupport()`, un stub de `window.api` sin el método ya no degrada a `null`: tira `TypeError`. Los stubs con `Proxy` no se ven afectados; `coinify-chest.browser.test.tsx` es un objeto plano y necesita dos métodos más (Task 12, paso 12.12). Es un cambio de fixture, no de UI.

8. **Las proyectadas NO reciben `purchase_date`** (spec C1, línea 30, corregida durante la revisión del plan). La primera versión de este plan se la escribía. `dupCheck` filtra `source = 'import'`, `description`, `amount`, `currency`, `installment_number` y «otro lote», y compara `COALESCE(purchase_date, date)` contra la fecha del papel: una proyectada con `purchase_date` = fecha de compra, monto igual y número n matchearía la línea n del resumen siguiente cuando el banco no ajusta el monto, el import la contaría como duplicada y la cuota nunca se materializaría (rompía `dedup.test.ts:96-117`, el test C4 «materializa la cuota 2 de CADA plan» y C11). Por eso `insertTx` de las proyectadas pasa `null` (Task 2, paso 2.3) y `materialise` es la única que escribe `purchase_date` sobre una proyectada.

9. **C12 no se puede hacer fallar en un CI en UTC.** `finance.today-dates.test.ts` compara contra `todayDateString()`; en ART falla antes del fix y pasa después; en UTC pasa siempre. La spec pide «reloj fijado a las 23:30 ART»; el huso del proceso no se puede cambiar con seguridad desde un test. Documentado en el propio test.
