# Nutrify — Resumen semanal (Pergamino de la semana) — Plan de implementación

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un ritual de cierre de semana en Nutrify que archiva un veredicto inmutable de cómo le fue al usuario y paga un bonus de XP escalado por consistencia.

**Architecture:** Espeja `nutrition:closeDay` un nivel de agregación arriba. El cálculo del veredicto es una función pura en `shared/`; los handlers viven en `shared-logic/modules/nutrition.ipc.ts`; el pago va por el motor RPG existente con un evento `WEEK_SUMMARY` plano y un guard de unicidad por `ref_id`, calcado del que ya protege `BUDGET_MONTH_MET`.

**Tech Stack:** TypeScript, better-sqlite3 (`:memory:` en tests), Vitest (project `unit`, `environment: 'node'`), React 19 + i18next en el renderer.

**Spec:** `docs/superpowers/specs/2026-09-04-nutrify-weekly-summary-design.md` — leerla antes de empezar. Este plan la ejecuta, no la reemplaza.

---

## Cómo se corren los tests

Siempre `npm test -- <archivo>`, **nunca `npx vitest`**. El script real es:

```
cross-env ELECTRON_RUN_AS_NODE=1 electron node_modules/vitest/vitest.mjs run --project unit
```

Vitest corre **dentro de Electron** porque `better-sqlite3` se compila contra su
ABI (`npm run rebuild` = `electron-rebuild -f -w better-sqlite3`). Hoy `npx
vitest` funciona de casualidad, con el módulo compilado para Node; en cuanto
alguien corra un rebuild, todo falla con `NODE_MODULE_VERSION`. `--project unit`
ya viene en el script, no hace falta pasarlo.

---

## Reglas que no se negocian

Salieron de cinco rondas de revisión adversarial. Cada una tiene un test que la
sostiene; romperla es romper el diseño.

1. **Fronteras de comida y cierre → `nutritionToday(db)`.** Nunca `new Date()`.
2. **El pesaje es la excepción**, y usa el reloj de pared a propósito. No tocar
   `saveWeeklyMetrics`.
3. **Denominador 7 fijo.** Nunca `days_closed`, nunca derivado de `food_log`.
4. **`WEEK_SUMMARY` es plano y no significativo.** Las dos listas, o hay farmeo.
5. **Sin `refId` no se paga.** No inventar un fallback de balde.
6. **El toast muestra lo que el motor pagó**, no lo que el sello declaró.
7. **El payload de sync es snake_case.** `WeekReport` es solo para el renderer.

---

## Estructura de archivos

| Archivo | Responsabilidad |
| --- | --- |
| `shared/week-report.ts` **(nuevo)** | Cálculo puro del veredicto y del XP. Sin DB, sin IO. |
| `src/modules/nutrition/nutrition.schema.ts` | + migración v19 |
| `shared-logic/modules/nutrition.ipc.ts` | + 4 handlers |
| `shared-logic/modules/rpg-handlers.ts` | + `WEEK_SUMMARY` en 2 mapas + guard |
| `shared/rpg-engine.ts` | + `WEEK_SUMMARY` en `NON_MEANINGFUL_EVENT_TYPES` |
| `shared-logic/modules/sync.ipc.ts` | + tabla, export y merge |
| `shared/api-channels.ts`, `shared/types.ts` | + 4 canales y sus tipos |
| `src/modules/nutrition/components/WeeklyScroll.tsx` **(nuevo)** | El pergamino |
| `src/modules/nutrition/weekly-api.ts` **(nuevo)** | Puente al bridge + emisión del evento |
| `src/i18n/{es,en}.json` | + claves `nutrify.weekly*`, `events.WEEK_SUMMARY` |
| `src/hub/CharacterPage.tsx` | + icono de `WEEK_SUMMARY` |

El cálculo va en `shared/` y no en `shared-logic/` a propósito: es una función
pura sobre filas, igual que `scoreNutritionDay` (`shared/meal-utils.ts`), y así se
testea sin montar una base.

---

## Chunk 1: Cimientos — esquema y cálculo puro

### Task 1: Migración v19 — `nutrition_weekly_closed`

**Files:**
- Modify: `src/modules/nutrition/nutrition.schema.ts` (agregar al final del array)
- Test: `tests/modules/nutrition/weekly-schema.test.ts` (crear)

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { nutritionMigrations } from '@modules/nutrition/nutrition.schema';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const m of nutritionMigrations) db.exec(m.up);
  return db;
}

describe('nutrition migration v19 — nutrition_weekly_closed', () => {
  it('crea la tabla con week_start como PRIMARY KEY', () => {
    const db = setupDb();
    const cols = db.pragma('table_info(nutrition_weekly_closed)') as
      Array<{ name: string; pk: number }>;
    const names = cols.map(c => c.name);

    expect(names).toEqual([
      'week_start', 'days_closed', 'days_compliant', 'avg_consumed', 'avg_target',
      'weight_start', 'weight_end', 'days_steps', 'days_gym', 'streak_end',
      'xp_total', 'closed_at', 'updated_at',
    ]);
    expect(cols.find(c => c.name === 'week_start')!.pk).toBe(1);
  });

  it('NO tiene deleted_at: nada en la app puede producir una lápida', () => {
    const db = setupDb();
    const cols = db.pragma('table_info(nutrition_weekly_closed)') as Array<{ name: string }>;
    expect(cols.map(c => c.name)).not.toContain('deleted_at');
  });

  it('corre sobre una base que venía en v18', () => {
    const db = new Database(':memory:');
    for (const m of nutritionMigrations.filter(m => m.version <= 18)) db.exec(m.up);
    expect(() => db.exec(nutritionMigrations.find(m => m.version === 19)!.up)).not.toThrow();
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- tests/modules/nutrition/weekly-schema.test.ts`
Expected: FAIL — `no such table: nutrition_weekly_closed`

- [ ] **Step 3: Agregar la migración**

Al final del array `nutritionMigrations` en `src/modules/nutrition/nutrition.schema.ts`:

```ts
  {
    namespace: 'nutrition',
    version: 19,
    up: `
      CREATE TABLE IF NOT EXISTS nutrition_weekly_closed (
        week_start      TEXT PRIMARY KEY,
        days_closed     INTEGER NOT NULL DEFAULT 0,
        days_compliant  INTEGER NOT NULL DEFAULT 0,
        avg_consumed    INTEGER NOT NULL DEFAULT 0,
        avg_target      INTEGER NOT NULL DEFAULT 0,
        weight_start    REAL,
        weight_end      REAL,
        days_steps      INTEGER NOT NULL DEFAULT 0,
        days_gym        INTEGER NOT NULL DEFAULT 0,
        streak_end      INTEGER NOT NULL DEFAULT 0,
        xp_total        INTEGER NOT NULL DEFAULT 0,
        closed_at       TEXT,
        updated_at      TEXT
      );
    `,
  },
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- tests/modules/nutrition/weekly-schema.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/modules/nutrition/nutrition.schema.ts tests/modules/nutrition/weekly-schema.test.ts
git commit -m "feat(nutrition): migración v19 con la tabla nutrition_weekly_closed"
```

---

### Task 2: Lunes anclado al mediodía

**Files:**
- Create: `shared/week-report.ts`
- Test: `tests/shared/week-report.test.ts` (crear)

`getMondayOfWeek` (`shared/date-utils.ts:43`) ancla en `T00:00:00`, a diferencia
del resto de los helpers del repo que usan `T12:00:00` "so DST can never shift
it". Como este lunes pasa a ser PRIMARY KEY, se usa una variante propia anclada
al mediodía. No se toca `getMondayOfWeek`: sus llamadores actuales dependen del
comportamiento que tienen.

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect } from 'vitest';
import { mondayOfWeek, weekEndOf } from '../../shared/week-report';

describe('mondayOfWeek', () => {
  it('devuelve el lunes de la semana de un miércoles', () => {
    expect(mondayOfWeek('2026-09-02')).toBe('2026-08-31'); // mié → lun
  });

  it('un lunes se devuelve a sí mismo', () => {
    expect(mondayOfWeek('2026-08-31')).toBe('2026-08-31');
  });

  it('el domingo pertenece a la semana que termina, no a la que empieza', () => {
    expect(mondayOfWeek('2026-09-06')).toBe('2026-08-31'); // dom → lun anterior
  });

  it('weekEndOf devuelve el domingo', () => {
    expect(weekEndOf('2026-08-31')).toBe('2026-09-06');
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- tests/shared/week-report.test.ts`
Expected: FAIL — no se puede resolver `shared/week-report`

- [ ] **Step 3: Crear el archivo con las dos funciones**

```ts
/**
 * Cálculo puro del pergamino semanal. Sin DB, sin IO, sin reloj.
 *
 * El lunes ancla en T12:00:00 y no en T00:00:00 como `getMondayOfWeek`
 * (shared/date-utils.ts:43): acá es PRIMARY KEY de una tabla, y un cambio de
 * horario a medianoche podría correr la frontera de una semana entera.
 */
import { scoreNutritionDay } from './meal-utils';

function parseNoon(dateStr: string): Date {
  return new Date(dateStr + 'T12:00:00');
}

function format(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** El lunes de la semana que contiene `dateStr`. Domingo = fin de semana, no inicio. */
export function mondayOfWeek(dateStr: string): string {
  const d = parseNoon(dateStr);
  const dow = d.getDay();              // 0 = domingo
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return format(d);
}

/** Desplaza una fecha YYYY-MM-DD por `days`, anclando al mediodía. */
export function shiftDay(dateStr: string, days: number): string {
  const d = parseNoon(dateStr);
  d.setDate(d.getDate() + days);
  return format(d);
}

/** El domingo de la semana que arranca en `weekStart`. */
export function weekEndOf(weekStart: string): string {
  return shiftDay(weekStart, 6);
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- tests/shared/week-report.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add shared/week-report.ts tests/shared/week-report.test.ts
git commit -m "feat(nutrition): helper de lunes anclado al mediodía para la semana"
```

---

### Task 3: Cumplimiento y XP — el corazón del veredicto

**Files:**
- Modify: `shared/week-report.ts`
- Test: `tests/shared/week-report.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Agregar a `tests/shared/week-report.test.ts`:

```ts
import { countCompliantDays, weeklyXp, WEEK_DAYS } from '../../shared/week-report';
import type { ClosedDayRow } from '../../shared/week-report';

/** Día que cumple en déficit: consumido por debajo del objetivo. */
const ok = (date: string): ClosedDayRow => ({ date, consumed: 1800, target: 1900 });
/** Día que no cumple: 30 % por encima. */
const bad = (date: string): ClosedDayRow => ({ date, consumed: 2470, target: 1900 });

describe('countCompliantDays', () => {
  it('cuenta solo los días que cumplen la banda del objetivo', () => {
    const rows = [ok('2026-08-31'), ok('2026-09-01'), bad('2026-09-02')];
    expect(countCompliantDays(rows, 500)).toBe(2);
  });

  it('un día sin consumo no cumple', () => {
    expect(countCompliantDays([{ date: '2026-08-31', consumed: 0, target: 1900 }], 500)).toBe(0);
  });
});

describe('weeklyXp — denominador SIEMPRE 7', () => {
  it('7 de 7 paga el techo de 50', () => {
    expect(weeklyXp(7)).toBe(50);
  });

  it('escala linealmente por debajo del pleno', () => {
    expect(weeklyXp(5)).toBe(29);
    expect(weeklyXp(4)).toBe(23);
    expect(weeklyXp(1)).toBe(6);
  });

  it('una semana sin días cumplidos paga 0', () => {
    expect(weeklyXp(0)).toBe(0);
  });

  it('el denominador es 7 y no la cantidad de días cerrados: 4/4 NO es pleno', () => {
    // Cerrar solo los cuatro días buenos no puede pagar lo mismo que cumplir siete.
    expect(weeklyXp(4)).toBe(23);
    expect(weeklyXp(4)).toBeLessThan(weeklyXp(7));
  });

  it('WEEK_DAYS es 7 y es el único denominador', () => {
    expect(WEEK_DAYS).toBe(7);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- tests/shared/week-report.test.ts`
Expected: FAIL — `countCompliantDays is not a function`

- [ ] **Step 3: Implementar**

Agregar a `shared/week-report.ts`:

```ts
/** Una fila viva de `nutrition_daily_closed`, con consumo y objetivo congelados. */
export interface ClosedDayRow {
  date: string;
  consumed: number;
  target: number;
}

/**
 * El denominador del cumplimiento semanal. SIEMPRE 7, nunca `days_closed`.
 *
 * Dividir por los días cerrados haría que cerrar únicamente los tres días que
 * salieron bien diera ratio 1.0 y el máximo. Con el denominador fijado por el
 * calendario, no cerrar un día simplemente cuesta y no queda nada que optimizar.
 */
export const WEEK_DAYS = 7;

/** Techo del bonus semanal, plano. ~12 % de una semana perfecta de cierres diarios. */
export const WEEKLY_XP_CAP = 50;

/**
 * Cuántos de los días cerrados cumplieron el objetivo.
 *
 * `consumed` y `target` vienen congelados de `nutrition_daily_closed`; el único
 * input vivo es `deficitTargetKcal`, que solo elige la banda (déficit / superávit
 * / mantenimiento). Al sellar, el resultado queda escrito y deja de depender de él.
 */
export function countCompliantDays(rows: ClosedDayRow[], deficitTargetKcal: number): number {
  return rows.filter(r => scoreNutritionDay(r.consumed, r.target, deficitTargetKcal).compliant).length;
}

/** Bonus de consistencia. 7/7 = 50; el +10 es exclusivo de la semana perfecta. */
export function weeklyXp(daysCompliant: number): number {
  const capped = Math.max(0, Math.min(WEEK_DAYS, daysCompliant));
  const base = Math.round(40 * capped / WEEK_DAYS);
  return base + (capped === WEEK_DAYS ? 10 : 0);
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- tests/shared/week-report.test.ts`
Expected: PASS (11 tests en total — 4 de la Task 2 más 7 de ésta)

- [ ] **Step 5: Commit**

```bash
git add shared/week-report.ts tests/shared/week-report.test.ts
git commit -m "feat(nutrition): cumplimiento semanal y bonus con denominador fijo en 7"
```

---

### Task 4: `nutrition:getWeekReport`

**Files:**
- Modify: `shared-logic/modules/nutrition.ipc.ts` (después de `nutrition:getSummaryRange`)
- Test: `tests/modules/nutrition/weekly-report.test.ts` (crear)

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

let testDb: Database.Database;

vi.mock('../../../shared-logic/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared-logic/db')>();
  return { ...actual, getDb: () => testDb, runModuleMigrations: vi.fn() };
});

import { getHandler, clearHandlers } from '../../../shared-logic/registry';
import { registerNutritionIpcHandlers } from '../../../shared-logic/modules/nutrition.ipc';
import { nutritionMigrations } from '@modules/nutrition/nutrition.schema';

const WEEK = '2026-08-31';        // lunes
const SUNDAY = '2026-09-06';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const m of nutritionMigrations) db.exec(m.up);
  db.prepare(`
    INSERT INTO nutrition_profile (id, age, sex, height_cm, initial_weight_kg,
      activity_level, deficit_target_kcal)
    VALUES (1, 30, 'M', 175, 80, 'moderate', 500)
  `).run();
  return db;
}

function closeDay(date: string, consumed: number, target = 1900): void {
  testDb.prepare(`
    INSERT INTO nutrition_daily_closed (date, xp_total, hp_change, consumed, target, closed_at, updated_at)
    VALUES (?, 0, 0, ?, ?, ?, ?)
  `).run(date, consumed, target, date + 'T12:00:00Z', date + 'T12:00:00Z');
}

const report = (week: string) => getHandler('nutrition:getWeekReport')!({}, week) as any;

describe('nutrition:getWeekReport', () => {
  beforeEach(() => {
    testDb = setupDb();
    clearHandlers();
    registerNutritionIpcHandlers();
  });

  it('agrega los días cerrados de la semana y calcula el XP', () => {
    closeDay('2026-08-31', 1800);   // cumple
    closeDay('2026-09-01', 1850);   // cumple
    closeDay('2026-09-02', 2600);   // no cumple
    const r = report(WEEK);

    expect(r.weekStart).toBe(WEEK);
    expect(r.weekEnd).toBe(SUNDAY);
    expect(r.daysClosed).toBe(3);
    expect(r.daysCompliant).toBe(2);
    expect(r.xpTotal).toBe(11);     // round(40 * 2/7)
    expect(r.sealed).toBe(false);
  });

  it('ignora los cierres de otras semanas', () => {
    closeDay('2026-08-30', 1800);   // domingo anterior
    closeDay('2026-09-07', 1800);   // lunes siguiente
    closeDay('2026-08-31', 1800);
    expect(report(WEEK).daysClosed).toBe(1);
  });

  it('ignora los cierres con lápida', () => {
    closeDay('2026-08-31', 1800);
    testDb.prepare("UPDATE nutrition_daily_closed SET deleted_at = 'x' WHERE date = ?")
      .run('2026-08-31');
    expect(report(WEEK).daysClosed).toBe(0);
  });

  it('devuelve null sin perfil, en vez de re-puntuar en banda de mantenimiento', () => {
    testDb.prepare('DELETE FROM nutrition_profile').run();
    expect(report(WEEK)).toBeNull();
  });

  it('toma weight_start de la semana y weight_end de la siguiente', () => {
    closeDay('2026-08-31', 1800);
    testDb.prepare('INSERT INTO nutrition_weekly_metrics (date, weight_kg) VALUES (?, ?)')
      .run('2026-08-31', 80.4);
    testDb.prepare('INSERT INTO nutrition_weekly_metrics (date, weight_kg) VALUES (?, ?)')
      .run('2026-09-07', 80.0);
    const r = report(WEEK);
    expect(r.weightStart).toBe(80.4);
    expect(r.weightEnd).toBe(80.0);
  });

  it('deja el peso en null cuando falta, sin inventar un delta', () => {
    closeDay('2026-08-31', 1800);
    const r = report(WEEK);
    expect(r.weightStart).toBeNull();
    expect(r.weightEnd).toBeNull();
  });

  it('cuenta días con pasos y días de gimnasio', () => {
    closeDay('2026-08-31', 1800);
    testDb.prepare('INSERT INTO nutrition_daily_metrics (date, steps, gym) VALUES (?, ?, ?)')
      .run('2026-08-31', 8000, 1);
    testDb.prepare('INSERT INTO nutrition_daily_metrics (date, steps, gym) VALUES (?, ?, ?)')
      .run('2026-09-01', 0, 0);
    const r = report(WEEK);
    expect(r.daysSteps).toBe(1);
    expect(r.daysGym).toBe(1);
  });

  it('promedia consumo y objetivo sobre los días cerrados', () => {
    closeDay('2026-08-31', 1700);
    closeDay('2026-09-01', 1900);
    const r = report(WEEK);
    expect(r.avgConsumed).toBe(1800);
    expect(r.avgTarget).toBe(1900);
  });

  // Spec test 16: la racha se mide al DOMINGO de esa semana, no al sellar.
  //
  // El fixture DEBE ser contiguo. `computeNutritionStreak` arranca en el domingo
  // de la semana y camina hacia atrás; en el primer hueco se niega a gastar el
  // día de gracia si el día anterior tampoco cumple (`meal-utils.ts:364`), así
  // que dos lunes sueltos dan racha 0 en ambas semanas y el test no probaría nada.
  it('streakEnd describe la semana, no el momento de sellar', () => {
    // 14 días compliant seguidos: lun 08-31 → dom 09-13.
    for (let i = 0; i < 14; i++) {
      const d = new Date('2026-08-31T12:00:00');
      d.setDate(d.getDate() + i);
      const date = d.toLocaleDateString('en-CA');
      closeDay(date, 1800);
      testDb.prepare(`INSERT INTO nutrition_daily_summary
        (date, total_calories_in, bmr, tdee, balance) VALUES (?, 1800, 1600, 2400, 0)`)
        .run(date);
    }

    // Semana 1 camina 09-06 → 08-31 y muere en el hueco del 08-30.
    expect(report('2026-08-31').streakEnd).toBe(7);
    // Semana 2 camina 09-13 → 08-31: la MISMA historia, otro punto de corte.
    expect(report('2026-09-07').streakEnd).toBe(14);
  });

  // Spec test 12: guarda del BORDE de la banda. Con déficit > 0 la banda es
  // `consumed <= target`, así que consumido == objetivo CUMPLE.
  // (No compara contra el puntaje sin redondear de `closeDay`; para eso haría
  // falta un tdee fraccionario. Como guarda de borde alcanza, pero no reclames
  // que cubre la divergencia de 1 kcal.)
  it('el borde exacto de la banda cumple', () => {
    closeDay('2026-08-31', 1900, 1900);   // consumido == objetivo, borde exacto
    // Déficit > 0 ⇒ compliant es `consumed <= target`: el borde CUMPLE.
    expect(report(WEEK).daysCompliant).toBe(1);
  });

  // Spec test 20, GUARDA del §Denominador: el XP no depende de food_log.
  it('borrar comidas viejas no cambia el XP de la semana', () => {
    closeDay('2026-08-31', 1800);
    const before = report(WEEK).xpTotal;
    testDb.prepare(`INSERT INTO food_log (date, time, description, calories, source)
      VALUES ('2026-08-31', '12:00', 'x', 500, 'manual')`).run();
    testDb.prepare("UPDATE food_log SET deleted_at = 'x'").run();
    expect(report(WEEK).xpTotal).toBe(before);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- tests/modules/nutrition/weekly-report.test.ts`
Expected: FAIL — `getHandler('nutrition:getWeekReport')` es `undefined`

- [ ] **Step 3: Implementar el handler**

En `shared-logic/modules/nutrition.ipc.ts`, después de `nutrition:getSummaryRange`.
Agregar el import arriba: `import { mondayOfWeek, weekEndOf, shiftDay, countCompliantDays, weeklyXp } from '../../shared/week-report';`

```ts
  // ── Pergamino semanal ──────────────────────────────

  /**
   * El veredicto de una semana. Idéntico esté sellada o en vista previa: si hay
   * fila en `nutrition_weekly_closed` se devuelve TAL CUAL quedó archivada, y si
   * no, se calcula en vivo. Un pergamino sellado nunca se recalcula.
   */
  ipcHandle('nutrition:getWeekReport', (_e, weekStart: string) => {
    const db = getDb();
    return buildWeekReport(db, weekStart);
  });
```

Y el helper, en la sección `// ── Helpers ──` al final del archivo:

```ts
/**
 * Arma el `WeekReport` de una semana.
 *
 * Sellada → se lee la fila archivada sin recalcular nada (§Inmutabilidad).
 * Sin sellar → se agrega en vivo desde `nutrition_daily_closed`.
 * Sin perfil → null: `scoreNutritionDay` leería un déficit 0 y re-puntuaría la
 * semana en banda de mantenimiento, mintiendo sobre quien está en déficit.
 */
export function buildWeekReport(
  db: ReturnType<typeof getDb>,
  weekStart: string,
): Record<string, unknown> | null {
  const profile = db.prepare('SELECT deficit_target_kcal FROM nutrition_profile WHERE id = 1')
    .get() as { deficit_target_kcal: number } | undefined;
  if (!profile) return null;

  const weekEnd = weekEndOf(weekStart);

  const sealed = db.prepare('SELECT * FROM nutrition_weekly_closed WHERE week_start = ?')
    .get(weekStart) as Record<string, unknown> | undefined;
  if (sealed) {
    return {
      weekStart, weekEnd,
      daysClosed: sealed.days_closed, daysCompliant: sealed.days_compliant,
      avgConsumed: sealed.avg_consumed, avgTarget: sealed.avg_target,
      weightStart: sealed.weight_start ?? null, weightEnd: sealed.weight_end ?? null,
      daysSteps: sealed.days_steps, daysGym: sealed.days_gym,
      streakEnd: sealed.streak_end, xpTotal: sealed.xp_total,
      sealed: true, closedAt: (sealed.closed_at as string | null) ?? null,
    };
  }

  const rows = db.prepare(`
    SELECT date, consumed, target FROM nutrition_daily_closed
    WHERE date BETWEEN ? AND ? AND deleted_at IS NULL ORDER BY date ASC
  `).all(weekStart, weekEnd) as Array<{ date: string; consumed: number; target: number }>;

  const deficit = profile.deficit_target_kcal ?? 0;
  const daysCompliant = countCompliantDays(rows, deficit);
  const n = rows.length;

  const weightAt = (from: string, to: string): number | null => {
    const r = db.prepare(`
      SELECT weight_kg FROM nutrition_weekly_metrics
      WHERE weight_kg IS NOT NULL AND date BETWEEN ? AND ? ORDER BY date ASC LIMIT 1
    `).get(from, to) as { weight_kg: number } | undefined;
    return r?.weight_kg ?? null;
  };

  const habits = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN steps > 0 THEN 1 ELSE 0 END), 0) AS steps,
           COALESCE(SUM(CASE WHEN gym = 1 THEN 1 ELSE 0 END), 0) AS gym
    FROM nutrition_daily_metrics WHERE date BETWEEN ? AND ?
  `).get(weekStart, weekEnd) as { steps: number; gym: number };

  return {
    weekStart, weekEnd,
    daysClosed: n,
    daysCompliant,
    avgConsumed: n ? Math.round(rows.reduce((s, r) => s + r.consumed, 0) / n) : 0,
    avgTarget: n ? Math.round(rows.reduce((s, r) => s + r.target, 0) / n) : 0,
    weightStart: weightAt(weekStart, weekEnd),
    weightEnd: weightAt(shiftDay(weekStart, 7), shiftDay(weekEnd, 7)),
    daysSteps: habits.steps,
    daysGym: habits.gym,
    streakEnd: weekStreakAt(db, weekEnd, deficit),
    xpTotal: weeklyXp(daysCompliant),
    sealed: false,
    closedAt: null,
  };
}

/**
 * La racha AL DOMINGO de esa semana, no al momento de sellar.
 *
 * Sellar puede pasar hasta 4 semanas después; calcularla al sellar haría que
 * cuatro pergaminos atrasados cerrados en la misma sesión registraran todos el
 * mismo número, que no describe ninguna de las cuatro semanas.
 */
function weekStreakAt(
  db: ReturnType<typeof getDb>,
  weekEnd: string,
  deficit: number,
): number {
  const rows = db.prepare(
    `SELECT date, total_calories_in AS totalCaloriesIn, tdee
     FROM nutrition_daily_summary
     WHERE date <= ? AND total_calories_in > 0
     ORDER BY date DESC LIMIT 366`,
  ).all(weekEnd) as StreakDay[];
  return computeNutritionStreak(rows, weekEnd, deficit).streak;
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- tests/modules/nutrition/weekly-report.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add shared-logic/modules/nutrition.ipc.ts tests/modules/nutrition/weekly-report.test.ts
git commit -m "feat(nutrition): handler getWeekReport con el veredicto de la semana"
```

---

### Task 5: `nutrition:getPendingWeeks` y el gate de peso

**Files:**
- Modify: `shared-logic/modules/nutrition.ipc.ts`
- Test: `tests/modules/nutrition/weekly-pending.test.ts` (crear)

Las cinco condiciones están en la spec, §Cuándo hay pergamino pendiente. La 5 es
la que más se rompe al implementar: **el escape es `weekStart+14`, no `+10`.**
`weight_check_day` va de 1 a 7, así que el pesaje de la semana siguiente puede
caer hasta en `weekStart+13`; un escape más corto dispara antes que el pesaje para
todo usuario con `weight_check_day >= 4`.

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

let testDb: Database.Database;

vi.mock('../../../shared-logic/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared-logic/db')>();
  return { ...actual, getDb: () => testDb, runModuleMigrations: vi.fn() };
});

import { getHandler, clearHandlers } from '../../../shared-logic/registry';
import { registerNutritionIpcHandlers } from '../../../shared-logic/modules/nutrition.ipc';
import { nutritionMigrations } from '@modules/nutrition/nutrition.schema';

const WEEK = '2026-08-31';    // lunes

/** Fija el reloj a las 12:00 del día pedido para que `nutritionToday` sea estable. */
function atNoon(dateStr: string): void {
  vi.setSystemTime(new Date(dateStr + 'T12:00:00'));
}

function setupDb(checkDay = 1): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const m of nutritionMigrations) db.exec(m.up);
  db.prepare(`
    INSERT INTO nutrition_profile (id, age, sex, height_cm, initial_weight_kg,
      activity_level, deficit_target_kcal, weight_check_day, day_cutoff_hour)
    VALUES (1, 30, 'M', 175, 80, 'moderate', 500, ?, 4)
  `).run(checkDay);
  return db;
}

function closeDay(date: string, consumed = 1800): void {
  testDb.prepare(`
    INSERT INTO nutrition_daily_closed (date, xp_total, hp_change, consumed, target, closed_at, updated_at)
    VALUES (?, 0, 0, ?, 1900, ?, ?)
  `).run(date, consumed, date, date);
}

function weighIn(date: string): void {
  testDb.prepare('INSERT INTO nutrition_weekly_metrics (date, weight_kg) VALUES (?, 80)').run(date);
}

const pending = () => getHandler('nutrition:getPendingWeeks')!({}) as string[];

describe('nutrition:getPendingWeeks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    testDb = setupDb();
    clearHandlers();
    registerNutritionIpcHandlers();
    closeDay('2026-08-31');
  });

  // Los fake timers también apagan setTimeout/setInterval: dejarlos puestos
  // contamina los archivos que corren después en la misma suite.
  afterEach(() => { vi.useRealTimers(); });

  it('la semana EN CURSO nunca aparece', () => {
    atNoon('2026-09-03');   // jueves de la misma semana
    expect(pending()).not.toContain(WEEK);
  });

  it('aparece apenas existe el pesaje de la semana siguiente', () => {
    weighIn('2026-09-07');   // lunes siguiente
    atNoon('2026-09-07');
    expect(pending()).toContain(WEEK);
  });

  it('sin pesaje, NO aparece antes de weekStart+14', () => {
    atNoon('2026-09-13');    // weekStart+13
    expect(pending()).not.toContain(WEEK);
  });

  it('sin pesaje, aparece en weekStart+14 por el escape', () => {
    atNoon('2026-09-14');
    expect(pending()).toContain(WEEK);
  });

  it('con weight_check_day = 7 el pesaje cae en +13 y el escape NO gana', () => {
    testDb.prepare('UPDATE nutrition_profile SET weight_check_day = 7').run();
    weighIn('2026-09-13');   // domingo de la semana siguiente = weekStart+13
    atNoon('2026-09-13');
    expect(pending()).toContain(WEEK);
  });

  it('una semana ya sellada no vuelve a aparecer', () => {
    testDb.prepare(`
      INSERT INTO nutrition_weekly_closed (week_start, days_closed, days_compliant, xp_total, closed_at, updated_at)
      VALUES (?, 1, 1, 6, 'x', 'x')
    `).run(WEEK);
    atNoon('2026-09-14');
    expect(pending()).not.toContain(WEEK);
  });

  it('una semana sin ningún cierre vivo no califica', () => {
    testDb.prepare('DELETE FROM nutrition_daily_closed').run();
    atNoon('2026-09-14');
    expect(pending()).not.toContain(WEEK);
  });

  it('la ventana de 4 semanas corta lo viejo', () => {
    atNoon('2026-10-05');   // el lunes actual está a 5 semanas de WEEK
    expect(pending()).not.toContain(WEEK);
  });

  it('a la 01:00 del lunes con corte 4 AM la semana en curso sigue siendo la anterior', () => {
    vi.setSystemTime(new Date('2026-09-07T01:00:00'));
    // El día nutricional es el domingo 2026-09-06, así que WEEK todavía corre.
    expect(pending()).not.toContain(WEEK);
  });

  it('el borde inferior de la ventana es INCLUSIVO: -28 días todavía entra', () => {
    atNoon('2026-09-28');   // el lunes actual está a exactamente 4 semanas
    expect(pending()).toContain(WEEK);
  });
});

/**
 * GUARDA de la Regla 2 — describe comportamiento ACTUAL y debe pasar antes de
 * que la feature aterrice.
 *
 * `saveWeeklyMetrics` keyea por el reloj de PARED a propósito: un pesaje no es
 * un evento de consumo, y tu peso a la 01:00 del lunes es el peso del lunes.
 * Si alguien "arregla" el escritor para usar el lunes nutricional, el pesaje
 * cae en `vStart` y el `INSERT OR REPLACE` PISA el weight_start de la semana:
 * el delta de todos los pergaminos se rompe en silencio. Este test es lo único
 * que lo impide.
 */
describe('GUARDA: el pesaje usa el reloj de pared', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    testDb = setupDb();
    clearHandlers();
    registerNutritionIpcHandlers();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('un pesaje a la 01:00 del lunes alimenta weight_end de la semana que termina', () => {
    // Lunes 2026-09-07 a la 01:00. Día nutricional: domingo 2026-09-06 (semana WEEK).
    vi.setSystemTime(new Date('2026-09-07T01:00:00'));
    getHandler('nutrition:saveWeeklyMetrics')!({}, { weightKg: 80 });

    const row = testDb.prepare('SELECT date FROM nutrition_weekly_metrics').get() as { date: string };
    // El lunes de PARED, que es el slot [WEEK+7, WEEK+13] = weight_end(WEEK).
    expect(row.date).toBe('2026-09-07');
    expect(row.date).not.toBe('2026-08-31');   // NO el lunes nutricional
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- tests/modules/nutrition/weekly-pending.test.ts`
Expected: FAIL — `getHandler('nutrition:getPendingWeeks')` es `undefined`

- [ ] **Step 3: Implementar**

```ts
  /**
   * Los lunes de las semanas que esperan pergamino.
   *
   * Cinco condiciones (spec §Cuándo hay pergamino pendiente). La 5 —el gate de
   * peso— existe porque `weight_end` sale del pesaje de la semana SIGUIENTE: sin
   * ella el usuario abre el pergamino el lunes temprano, lo sella, y el dato que
   * motivó toda la feature queda NULL para siempre.
   */
  ipcHandle('nutrition:getPendingWeeks', () => {
    const db = getDb();
    const currentWeek = mondayOfWeek(nutritionToday(db));
    const oldest = shiftDay(currentWeek, -28);

    const candidates = db.prepare(`
      SELECT DISTINCT c.date FROM nutrition_daily_closed c
      WHERE c.deleted_at IS NULL AND c.date >= ? AND c.date < ?
    `).all(oldest, currentWeek) as Array<{ date: string }>;

    const weeks = [...new Set(candidates.map(r => mondayOfWeek(r.date)))]
      .filter(w => w >= oldest && w < currentWeek)
      .sort();

    const isSealed = db.prepare('SELECT 1 FROM nutrition_weekly_closed WHERE week_start = ?');
    return weeks.filter(w => !isSealed.get(w) && weeklyGateOpen(db, w));
  });
```

Y el helper, junto a `buildWeekReport`:

```ts
/**
 * Condición 5: ¿hay con qué medir el peso, o ya se esperó suficiente?
 *
 * El escape es `weekStart+14` y el número no es negociable. `weight_check_day`
 * va de 1 a 7 (`nutrition.ipc.ts:238` lo clampea) y `shouldAskWeight` solo
 * pregunta cuando `dow >= checkDay`, así que el pesaje de la semana siguiente
 * puede caer en cualquier día entre `+7` y `+13`. Un escape más corto —`+10`,
 * por ejemplo— dispara antes que el pesaje para todo `weight_check_day >= 4`:
 * retendría el pergamino tres días y lo soltaría con `weight_end` en NULL igual.
 */
export function weeklyGateOpen(db: ReturnType<typeof getDb>, weekStart: string): boolean {
  const hasWeighIn = db.prepare(`
    SELECT 1 FROM nutrition_weekly_metrics
    WHERE weight_kg IS NOT NULL AND date BETWEEN ? AND ? LIMIT 1
  `).get(shiftDay(weekStart, 7), shiftDay(weekStart, 13));
  if (hasWeighIn) return true;
  return nutritionToday(db) >= shiftDay(weekStart, 14);
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- tests/modules/nutrition/weekly-pending.test.ts`
Expected: PASS (11 tests — 10 de `getPendingWeeks` más la guarda del pesaje)

El import de `afterEach` va en la primera línea del archivo, junto a `beforeEach`.

- [ ] **Step 5: Commit**

```bash
git add shared-logic/modules/nutrition.ipc.ts tests/modules/nutrition/weekly-pending.test.ts
git commit -m "feat(nutrition): getPendingWeeks con el gate de pesaje de la semana siguiente"
```

---

## Chunk 2: El sello y el motor RPG

### Task 6: `nutrition:closeWeek`

**Files:**
- Modify: `shared-logic/modules/nutrition.ipc.ts`
- Test: `tests/modules/nutrition/weekly-close.test.ts` (crear)

`closeWeek` **revalida la condición 5**. El gate no puede vivir sólo en
`getPendingWeeks`: `nutrition:closeWeek` es un canal público y un bug de UI podría
sellar una semana bloqueada y congelar `weight_end = NULL` para siempre. Mismo
principio que el guard del motor — el emisor garantiza, el receptor no confía.

- [ ] **Step 1: Escribir el test que falla**

```ts
// Copiar VERBATIM el preámbulo de weekly-pending.test.ts: el mock de
// '../../../shared-logic/db', setupDb(), closeDay(), weighIn() y atNoon().
// Importar además `afterEach` de vitest.

const closeWeek = (week: string) => getHandler('nutrition:closeWeek')!({}, week) as any;

describe('nutrition:closeWeek', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    testDb = setupDb();
    clearHandlers();
    registerNutritionIpcHandlers();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('sella la semana y archiva el veredicto', () => {
    closeDay('2026-08-31', 1800);
    closeDay('2026-09-01', 1850);
    weighIn('2026-09-07');
    atNoon('2026-09-07');

    const res = closeWeek(WEEK);
    expect(res.success).toBe(true);
    expect(res.report.daysCompliant).toBe(2);
    expect(res.report.xpTotal).toBe(11);
    expect(res.report.sealed).toBe(true);

    const row = testDb.prepare('SELECT * FROM nutrition_weekly_closed WHERE week_start = ?')
      .get(WEEK) as any;
    expect(row.days_compliant).toBe(2);
    expect(row.xp_total).toBe(11);
    expect(row.closed_at).toBeTruthy();
  });

  it('sellar dos veces devuelve alreadyClosed y no escribe otra fila', () => {
    closeDay('2026-08-31', 1800);
    weighIn('2026-09-07');
    atNoon('2026-09-07');
    closeWeek(WEEK);

    const second = closeWeek(WEEK);
    expect(second.success).toBe(false);
    expect(second.alreadyClosed).toBe(true);

    const count = testDb.prepare('SELECT COUNT(*) AS n FROM nutrition_weekly_closed').get() as { n: number };
    expect(count.n).toBe(1);
  });

  it('revalida el gate de peso: sellar directo una semana bloqueada falla', () => {
    closeDay('2026-08-31', 1800);
    atNoon('2026-09-08');   // terminó, pero sin pesaje y antes de +14
    const res = closeWeek(WEEK);
    expect(res.success).toBe(false);
    expect(res.error).toBe('Waiting for weigh-in');
    expect(testDb.prepare('SELECT COUNT(*) AS n FROM nutrition_weekly_closed').get()).toEqual({ n: 0 });
  });

  it('sin perfil devuelve No profile', () => {
    closeDay('2026-08-31', 1800);
    weighIn('2026-09-07');
    atNoon('2026-09-07');
    testDb.prepare('DELETE FROM nutrition_profile').run();
    expect(closeWeek(WEEK).error).toBe('No profile');
  });

  it('sin cierres diarios devuelve No closed days', () => {
    weighIn('2026-09-07');
    atNoon('2026-09-07');
    expect(closeWeek(WEEK).error).toBe('No closed days');
  });

  it('una semana que todavía no terminó devuelve Week not finished', () => {
    closeDay('2026-08-31', 1800);
    atNoon('2026-09-03');   // jueves de la misma semana
    expect(closeWeek(WEEK).error).toBe('Week not finished');
  });

  it('reabrir un día de una semana sellada no altera el pergamino', () => {
    closeDay('2026-08-31', 1800);
    closeDay('2026-09-01', 1850);
    weighIn('2026-09-07');
    atNoon('2026-09-07');
    closeWeek(WEEK);

    testDb.prepare("UPDATE nutrition_daily_closed SET deleted_at = 'x' WHERE date = ?")
      .run('2026-09-01');

    const r = getHandler('nutrition:getWeekReport')!({}, WEEK) as any;
    expect(r.daysCompliant).toBe(2);   // congelado, no 1
    expect(r.sealed).toBe(true);
  });
});

describe('nutrition:getClosedWeeks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    testDb = setupDb();
    clearHandlers();
    registerNutritionIpcHandlers();
  });
  afterEach(() => { vi.useRealTimers(); });

  const closed = (limit?: number) =>
    getHandler('nutrition:getClosedWeeks')!({}, limit) as any[];

  function sealAt(week: string, day: string): void {
    closeDay(day, 1800);
    weighIn(shiftDays(week, 7));
    atNoon(shiftDays(week, 7));
    closeWeek(week);
  }

  /** Helper local: no importar de shared/ para no acoplar el test al helper. */
  function shiftDays(d: string, n: number): string {
    const x = new Date(d + 'T12:00:00');
    x.setDate(x.getDate() + n);
    return x.toLocaleDateString('en-CA');
  }

  it('devuelve las semanas selladas, más reciente primero', () => {
    sealAt('2026-08-24', '2026-08-24');
    sealAt('2026-08-31', '2026-08-31');
    const rows = closed();
    expect(rows.map(r => r.weekStart)).toEqual(['2026-08-31', '2026-08-24']);
    expect(rows.every(r => r.sealed)).toBe(true);
  });

  it('respeta el límite pedido', () => {
    sealAt('2026-08-24', '2026-08-24');
    sealAt('2026-08-31', '2026-08-31');
    expect(closed(1)).toHaveLength(1);
  });

  it('sin semanas selladas devuelve una lista vacía', () => {
    expect(closed()).toEqual([]);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- tests/modules/nutrition/weekly-close.test.ts`
Expected: FAIL — `getHandler('nutrition:closeWeek')` es `undefined`

- [ ] **Step 3: Implementar**

```ts
  /**
   * Sella la semana. Irreversible por diseño: no existe `reopenWeek`.
   *
   * Revalida la condición 5 en vez de confiar en que el llamador pasó por
   * `getPendingWeeks`. Es el mismo principio que el guard de `ref_id` en el motor.
   */
  ipcHandle('nutrition:closeWeek', (_e, weekStart: string) => {
    const db = getDb();

    return db.transaction(() => {
      if (db.prepare('SELECT 1 FROM nutrition_weekly_closed WHERE week_start = ?').get(weekStart)) {
        return { success: false, alreadyClosed: true };
      }

      const profile = db.prepare('SELECT deficit_target_kcal FROM nutrition_profile WHERE id = 1').get();
      if (!profile) return { success: false, error: 'No profile' };

      if (weekStart >= mondayOfWeek(nutritionToday(db))) {
        return { success: false, error: 'Week not finished' };
      }

      const report = buildWeekReport(db, weekStart);
      if (!report || (report.daysClosed as number) === 0) {
        return { success: false, error: 'No closed days' };
      }

      if (!weeklyGateOpen(db, weekStart)) {
        return { success: false, error: 'Waiting for weigh-in' };
      }

      const stamp = syncStamp();
      db.prepare(`
        INSERT INTO nutrition_weekly_closed
          (week_start, days_closed, days_compliant, avg_consumed, avg_target,
           weight_start, weight_end, days_steps, days_gym, streak_end,
           xp_total, closed_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        weekStart, report.daysClosed, report.daysCompliant, report.avgConsumed, report.avgTarget,
        report.weightStart, report.weightEnd, report.daysSteps, report.daysGym, report.streakEnd,
        report.xpTotal, stamp, stamp,
      );

      return { success: true, report: { ...report, sealed: true, closedAt: stamp } };
    })();
  });

  /** Las semanas selladas, más recientes primero. Para releer el archivo. */
  ipcHandle('nutrition:getClosedWeeks', (_e, limit?: number) => {
    const db = getDb();
    const rows = db.prepare(
      'SELECT week_start FROM nutrition_weekly_closed ORDER BY week_start DESC LIMIT ?',
    ).all(Math.min(limit ?? 52, 200)) as Array<{ week_start: string }>;
    return rows.map(r => buildWeekReport(db, r.week_start)).filter(Boolean);
  });
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- tests/modules/nutrition/weekly-close.test.ts`
Expected: PASS (10 tests — 7 de `closeWeek` más 3 de `getClosedWeeks`)

- [ ] **Step 5: Commit**

```bash
git add shared-logic/modules/nutrition.ipc.ts tests/modules/nutrition/weekly-close.test.ts
git commit -m "feat(nutrition): closeWeek sella el pergamino y revalida el gate"
```

---

### Task 7: `WEEK_SUMMARY` en el motor RPG

**Files:**
- Modify: `shared/rpg-engine.ts` (`NON_MEANINGFUL_EVENT_TYPES`, línea 107)
- Modify: `shared-logic/modules/rpg-handlers.ts` (`FLAT_XP_EVENTS` :105, `REF_PAYLOAD_KEY_BY_TYPE` :160, guard entre :366 y :381)
- Test: `tests/ipc/rpg-week-summary.test.ts` (crear)

**`REF_FIELD_BY_TYPE` NO se toca.** Su único consumidor es la rama de undo
(`rpg-handlers.ts:434`) y no hay evento de undo para la semana: la entrada sería
código muerto.

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

let testDb: Database.Database;

vi.mock('../../shared-logic/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared-logic/db')>();
  return { ...actual, getDb: () => testDb, runModuleMigrations: vi.fn() };
});

const { initCoreTables, applyMigrations, coreMigrations } = await import('../../shared-logic/db');
import { getHandler, clearHandlers } from '../../shared-logic/registry';
import { registerRpgHandlers } from '../../shared-logic/modules/rpg-handlers';
import { NON_MEANINGFUL_EVENT_TYPES } from '../../shared/rpg-engine';

const WEEK = '2026-08-31';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initCoreTables(db);
  applyMigrations(db, coreMigrations);
  const today = new Date().toLocaleDateString('en-CA');
  db.prepare("UPDATE player_stats SET xp = 100, hp = 80, hp_date = ? WHERE user_id = 'default'").run(today);
  return db;
}

const process = (event: Record<string, unknown>) =>
  getHandler('rpg:processEvent')!({}, event);

const seal = (payload: Record<string, unknown>) =>
  process({ type: 'WEEK_SUMMARY', moduleId: 'nutrition', payload, timestamp: Date.now() });

describe('WEEK_SUMMARY', () => {
  beforeEach(() => {
    testDb = setupDb();
    clearHandlers();
    registerRpgHandlers();
  });

  it('paga plano: sin combo ni bonus aleatorio', async () => {
    const res = await seal({ xp: 50, hp: 0, weekStart: WEEK }) as any;
    expect(res.xpGained).toBe(50);
  });

  it('el guard por ref_id impide cobrar la misma semana dos veces', async () => {
    await seal({ xp: 50, hp: 0, weekStart: WEEK });
    const second = await seal({ xp: 50, hp: 0, weekStart: WEEK }) as any;
    expect(second.xpGained).toBe(0);
  });

  it('semanas distintas cobran cada una', async () => {
    await seal({ xp: 50, hp: 0, weekStart: WEEK });
    const other = await seal({ xp: 29, hp: 0, weekStart: '2026-09-07' }) as any;
    expect(other.xpGained).toBe(29);
  });

  it('sin weekStart no se paga: no hay fallback de balde', async () => {
    const res = await seal({ xp: 50, hp: 0 }) as any;
    expect(res.xpGained).toBe(0);
  });

  it('sin payload.xp paga 0 — el emisor DEBE declararlo', async () => {
    const res = await seal({ hp: 0, weekStart: WEEK }) as any;
    expect(res.xpGained).toBe(0);
  });

  it('no cuenta como evento significativo: no alimenta los logros diarios', () => {
    expect(NON_MEANINGFUL_EVENT_TYPES).toContain('WEEK_SUMMARY');
  });

  it('sellar 4 semanas atrasadas no infla el conteo de eventos del día', async () => {
    for (const w of ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24']) {
      await seal({ xp: 50, hp: 0, weekStart: w });
    }
    const meaningful = testDb.prepare(`
      SELECT COUNT(*) AS n FROM rpg_events
      WHERE xp_gained > 0 AND event_type NOT IN (${NON_MEANINGFUL_EVENT_TYPES.map(() => '?').join(',')})
    `).get(...NON_MEANINGFUL_EVENT_TYPES) as { n: number };
    expect(meaningful.n).toBe(0);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- tests/ipc/rpg-week-summary.test.ts`
Expected: FAIL — el primer test da `xpGained` multiplicado por el combo, no 50

- [ ] **Step 3: Las tres ediciones**

En `shared/rpg-engine.ts`, agregar a `NON_MEANINGFUL_EVENT_TYPES` (después de `'ACHIEVEMENT_UNLOCKED'`):

```ts
  // El pergamino semanal es DERIVADO de días que ya contaron. Si fuese
  // significativo, sellar 4 semanas atrasadas de un saque inyectaría 4 eventos
  // de Nutrify en un mismo día — entrada directa a polymath, perfect_day y la
  // escalera del Cronista. Un premio derivado no alimenta al matcher que lo generó.
  'WEEK_SUMMARY',
```

En `shared-logic/modules/rpg-handlers.ts`, línea 105:

```ts
const FLAT_XP_EVENTS = new Set(['DAY_SEALED', 'ACHIEVEMENT_UNLOCKED', 'WEEK_SUMMARY']);
```

En `REF_PAYLOAD_KEY_BY_TYPE` (línea 160):

```ts
  // Nutrify: el pergamino semanal se identifica por su lunes. Es el balde del
  // guard de unicidad, igual que `month` en BUDGET_MONTH_MET.
  WEEK_SUMMARY: 'weekStart',
```

Y el guard, en su **propio bloque** entre la extracción de `refId` (:366) y
`const isFlat` (:381) — **no** anidado dentro del bloque de `BUDGET_MONTH_MET`:

```ts
      // El pergamino semanal paga UNA vez por semana. A diferencia de
      // BUDGET_MONTH_MET no hay fallback de balde: el motor solo conoce el reloj
      // de PARED y cualquier lunes que derivara acá apuntaría a la semana pasada,
      // colapsando cuatro pergaminos atrasados en un solo balde y convirtiendo
      // tres pagos legítimos en 0. Sin balde, no se paga.
      if (event.type === 'WEEK_SUMMARY') {
        if (!refId) {
          baseXp = 0;
        } else {
          const alreadyPaid = db.prepare(
            "SELECT 1 FROM rpg_events WHERE event_type = 'WEEK_SUMMARY' AND ref_id = ? LIMIT 1",
          ).get(refId);
          if (alreadyPaid) baseXp = 0;
        }
      }
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- tests/ipc/rpg-week-summary.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Correr la suite de RPG entera para descartar regresiones**

Run: `npm test -- tests/ipc`
Expected: PASS — sobre todo `rpg-economy-audit`, `rpg-events` y `rpg-achievements`

- [ ] **Step 6: Commit**

```bash
git add shared/rpg-engine.ts shared-logic/modules/rpg-handlers.ts tests/ipc/rpg-week-summary.test.ts
git commit -m "feat(nutrition): evento WEEK_SUMMARY plano con guard de unicidad por semana"
```

---

## Chunk 3: Sync y puente al renderer

### Task 8: Sync multi-cuenta

**Files:**
- Modify: `shared-logic/modules/sync.ipc.ts` (`USER_DATA_TABLES` :224, export :1162, merge :1412+)
- Test: `tests/modules/nutrition/weekly-sync.test.ts` (crear)

**El payload de sync es snake_case crudo.** `sync:getAllNutritionData` arma su
literal con filas de `SELECT *`, así que el merge matchea `c.week_start`, no
`c.weekStart`. Si alguien toma `WeekReport` como referencia, el lookup devuelve
`undefined` para TODAS las filas: el merge no falla, no avisa, y no hace nada.

- [ ] **Step 1: Escribir el test que falla**

```ts
// Preámbulo: mock de '../../../shared-logic/db' (igual que weekly-pending.test.ts),
// setupDb() que corre `nutritionMigrations` Y `coreMigrations` sobre `initCoreTables`,
// y —imprescindible— `registerSyncIpcHandlers()` en el beforeEach: sin eso
// getHandler('sync:clearUserData') y getHandler('sync:getAllNutritionData') son
// undefined y los cinco tests explotan con un error que no dice nada útil.

describe('sync del pergamino semanal', () => {
  it('nutrition_weekly_closed está en USER_DATA_TABLES', async () => {
    const src = await import('../../../shared-logic/modules/sync.ipc');
    // El array no se exporta: se verifica por comportamiento, con clearUserData.
    testDb.prepare(`INSERT INTO nutrition_weekly_closed
      (week_start, days_closed, days_compliant, xp_total, closed_at, updated_at)
      VALUES ('2026-08-31', 3, 2, 11, 'x', 'x')`).run();
    getHandler('sync:clearUserData')!({});
    const n = testDb.prepare('SELECT COUNT(*) AS n FROM nutrition_weekly_closed').get() as { n: number };
    expect(n.n).toBe(0);
  });

  it('getAllNutritionData exporta weeklyClosed en snake_case', () => {
    testDb.prepare(`INSERT INTO nutrition_weekly_closed
      (week_start, days_closed, days_compliant, xp_total, closed_at, updated_at)
      VALUES ('2026-08-31', 3, 2, 11, 'x', 'x')`).run();
    const data = getHandler('sync:getAllNutritionData')!({}) as any;
    expect(data.weeklyClosed).toHaveLength(1);
    expect(data.weeklyClosed[0].week_start).toBe('2026-08-31');
  });

  it('mergeNutritionData inserta una semana que no estaba', () => {
    getHandler('sync:mergeNutritionData')!({}, {
      weeklyClosed: [{
        week_start: '2026-08-31', days_closed: 3, days_compliant: 2,
        avg_consumed: 1800, avg_target: 1900, days_steps: 1, days_gym: 1,
        streak_end: 5, xp_total: 11, closed_at: 'a', updated_at: 'a',
      }],
    });
    const row = testDb.prepare('SELECT * FROM nutrition_weekly_closed WHERE week_start = ?')
      .get('2026-08-31') as any;
    expect(row.days_compliant).toBe(2);
  });

  it('last-write-wins por updated_at', () => {
    testDb.prepare(`INSERT INTO nutrition_weekly_closed
      (week_start, days_closed, days_compliant, xp_total, closed_at, updated_at)
      VALUES ('2026-08-31', 3, 2, 11, 'a', '2026-09-07T10:00:00Z')`).run();

    getHandler('sync:mergeNutritionData')!({}, {
      weeklyClosed: [{
        week_start: '2026-08-31', days_closed: 5, days_compliant: 5,
        avg_consumed: 1800, avg_target: 1900, days_steps: 2, days_gym: 2,
        streak_end: 9, xp_total: 29, closed_at: 'b', updated_at: '2026-09-08T10:00:00Z',
      }],
    });
    const row = testDb.prepare('SELECT days_compliant FROM nutrition_weekly_closed WHERE week_start = ?')
      .get('2026-08-31') as any;
    expect(row.days_compliant).toBe(5);
  });

  it('una fila entrante MÁS VIEJA no pisa la local', () => {
    testDb.prepare(`INSERT INTO nutrition_weekly_closed
      (week_start, days_closed, days_compliant, xp_total, closed_at, updated_at)
      VALUES ('2026-08-31', 5, 5, 29, 'a', '2026-09-08T10:00:00Z')`).run();

    getHandler('sync:mergeNutritionData')!({}, {
      weeklyClosed: [{
        week_start: '2026-08-31', days_closed: 1, days_compliant: 1,
        avg_consumed: 1800, avg_target: 1900, days_steps: 0, days_gym: 0,
        streak_end: 1, xp_total: 6, closed_at: 'b', updated_at: '2026-09-07T10:00:00Z',
      }],
    });
    const row = testDb.prepare('SELECT days_compliant FROM nutrition_weekly_closed WHERE week_start = ?')
      .get('2026-08-31') as any;
    expect(row.days_compliant).toBe(5);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- tests/modules/nutrition/weekly-sync.test.ts`
Expected: FAIL — `data.weeklyClosed` es `undefined`

- [ ] **Step 3: Las tres ediciones**

`USER_DATA_TABLES` (`sync.ipc.ts:224`), junto a `'nutrition_daily_closed'`:

```ts
  'nutrition_weekly_closed',
```

En `sync:getAllNutritionData`, junto a `dailyClosed` (~:1152):

```ts
    const weeklyClosed = db.prepare('SELECT * FROM nutrition_weekly_closed ORDER BY week_start DESC').all();
```

y agregarlo al literal de retorno (`:1162`).

En `mergeNutritionDataInto`, siguiendo el patrón del bloque `dailyClosed` (:1520):

```ts
    // Sin `deleted_at`: nada en la app puede producir una lápida semanal
    // (no hay reopenWeek, clearUserData borra duro). Ver spec §Sin deleted_at.
    if (Array.isArray(d.weeklyClosed)) step(db, 'weeklyClosed', () => {
      const getWC = db.prepare('SELECT week_start, updated_at FROM nutrition_weekly_closed WHERE week_start = ?');
      const insertWC = db.prepare(`INSERT INTO nutrition_weekly_closed
        (week_start, days_closed, days_compliant, avg_consumed, avg_target, weight_start,
         weight_end, days_steps, days_gym, streak_end, xp_total, closed_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const updateWC = db.prepare(`UPDATE nutrition_weekly_closed SET
        days_closed = ?, days_compliant = ?, avg_consumed = ?, avg_target = ?, weight_start = ?,
        weight_end = ?, days_steps = ?, days_gym = ?, streak_end = ?, xp_total = ?,
        closed_at = ?, updated_at = ? WHERE week_start = ?`);

      for (const raw of d.weeklyClosed) {
        // La clave es snake_case: el payload viene de un SELECT *, no de WeekReport.
        if (!isUsableRow(raw, 'weeklyClosed', ['week_start'])) continue;
        const c = withNormStamps(raw);
        const local = getWC.get(c.week_start) as { week_start: string; updated_at: string | null } | undefined;
        const vals = [
          c.days_closed ?? 0, c.days_compliant ?? 0, c.avg_consumed ?? 0, c.avg_target ?? 0,
          c.weight_start ?? null, c.weight_end ?? null, c.days_steps ?? 0, c.days_gym ?? 0,
          c.streak_end ?? 0, c.xp_total ?? 0, c.closed_at ?? null, c.updated_at ?? null,
        ];
        if (!local) { insertWC.run(c.week_start, ...vals); changed = true; }
        else if (isNewerStamp(c.updated_at, local.updated_at)) { updateWC.run(...vals, c.week_start); changed = true; }
      }
    });
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- tests/modules/nutrition/weekly-sync.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add shared-logic/modules/sync.ipc.ts tests/modules/nutrition/weekly-sync.test.ts
git commit -m "feat(sync): nutrition_weekly_closed entra en el sync multi-cuenta"
```

---

### Task 9: Puente `window.api`

**Files:**
- Modify: `shared/api-channels.ts`, `shared/types.ts`
- Test: `tests/ipc/rpg-codex-contract.test.ts` (ver si ya cubre el contrato; si no, crear `tests/ipc/weekly-api-contract.test.ts`)

- [ ] **Step 1: Agregar los cuatro canales**

`API_CHANNELS` es un **objeto**, no un array, y `kind` es obligatorio en
`ChannelSpec`. En `shared/api-channels.ts`, junto a las demás de nutrition:

```ts
  nutritionGetPendingWeeks: { channel: 'nutrition:getPendingWeeks', kind: 'invoke' },
  nutritionGetWeekReport: { channel: 'nutrition:getWeekReport', kind: 'invoke' },
  nutritionCloseWeek: { channel: 'nutrition:closeWeek', kind: 'invoke' },
  nutritionGetClosedWeeks: { channel: 'nutrition:getClosedWeeks', kind: 'invoke' },
```

Sin `platforms`: los cuatro corren también en Android, porque los handlers viven
en `shared-logic/`.

En `shared/types.ts`, dentro de `HubtifyApi`:

```ts
  nutritionGetPendingWeeks: () => Promise<string[]>;
  nutritionGetWeekReport: (weekStart: string) => Promise<WeekReport | null>;
  nutritionCloseWeek: (weekStart: string) => Promise<CloseWeekResult>;
  nutritionGetClosedWeeks: (limit?: number) => Promise<WeekReport[]>;
```

Y los tipos, arriba en el mismo archivo:

```ts
export interface WeekReport {
  weekStart: string;
  weekEnd: string;
  daysClosed: number;
  daysCompliant: number;
  avgConsumed: number;
  avgTarget: number;
  weightStart: number | null;
  weightEnd: number | null;
  daysSteps: number;
  daysGym: number;
  streakEnd: number;
  xpTotal: number;
  sealed: boolean;
  closedAt: string | null;
}

export type CloseWeekResult =
  | { success: true; report: WeekReport }
  | { success: false; alreadyClosed: true }
  | { success: false; error: 'No profile' | 'No closed days'
                           | 'Week not finished' | 'Waiting for weigh-in' };
```

- [ ] **Step 2: Verificar que el typecheck de shared-logic pasa**

Run: `npm run typecheck:shared-logic`  (`tsc -p shared-logic --noEmit`)
Expected: sin errores. Arrastra `shared/` de forma transitiva, así que el
`satisfies` de `API_CHANNELS` dispara si falta una entrada o sobra.

**Ojo: no hay script de typecheck del renderer en `package.json`.** Éste es el
ÚNICO chequeo automático que reciben los cuatro tipos nuevos. Si `HubtifyApi` y
`API_CHANNELS` se desincronizan de una forma que `satisfies` no atrapa, no hay
red abajo.

- [ ] **Step 3: No hay nada que regenerar — y conviene entender por qué**

**No existe un paso de codegen.** El `CLAUDE.md` dice que `preload.ts` está
"generated from `shared/api-channels.ts`", pero eso describe un armado **en
runtime**, no un script: `electron/preload.ts` son 28 líneas escritas a mano cuyo
último statement es `contextBridge.exposeInMainWorld('api', buildApi(transport,
'desktop'))`. `buildApi` recorre `API_CHANNELS` cuando la app arranca.

Consecuencias para esta tarea:
- No hay `npm run build:api` ni equivalente (los scripts reales son `start`,
  `package`, `make`, `lint`, `test`, `typecheck:shared-logic`, `rebuild`,
  `mobile:*`, `ai:bench`, `test:visual*`, `test:e2e`)
- `electron/preload.ts` **no cambia** — no lo agregues al commit
- La entrada en `API_CHANNELS` más el tipo en `HubtifyApi` son TODO el cableado
- `src/mobile/install-api.ts` levanta los mismos cuatro canales de la misma tabla,
  gratis

- [ ] **Step 4: Commit**

```bash
git add shared/api-channels.ts shared/types.ts
git commit -m "feat(nutrition): expone los cuatro canales del pergamino en window.api"
```

---

## Chunk 4: El pergamino

### Task 10: `weekly-api.ts` — el puente y la emisión del evento

> Va ANTES de las claves de i18n: crea el único emisor de `WEEK_SUMMARY`, sin el
> cual la etiqueta queda huérfana y `rpg-event-labels` falla. Ver la nota en la
> Task 11.

**Files:**
- Create: `src/modules/nutrition/weekly-api.ts`
- Test: `tests/modules/nutrition/weekly-emit.test.ts` (crear)

**El toast muestra lo que el motor pagó, no lo que el sello declaró.** Copiar el
patrón de `closeNutritionDay` (`nutritionClose.ts:83, 92`, que devuelve
`b.xpTotal`) rompería en tres caminos vivos: sin `payload.xp`, sin `weekStart`, y
en multi-dispositivo. En los tres el motor paga 0 y el sello declara 50.

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sealWeek } from '@modules/nutrition/weekly-api';

const report = {
  weekStart: '2026-08-31', weekEnd: '2026-09-06', daysClosed: 7, daysCompliant: 7,
  avgConsumed: 1800, avgTarget: 1900, weightStart: 80.4, weightEnd: 80.0,
  daysSteps: 5, daysGym: 3, streakEnd: 12, xpTotal: 50, sealed: true, closedAt: 'x',
};

beforeEach(() => {
  (globalThis as any).window = { api: {} };
});

describe('sealWeek', () => {
  it('emite WEEK_SUMMARY con el weekStart del report, nunca uno derivado', async () => {
    const processRpgEvent = vi.fn().mockResolvedValue({ xpGained: 50 });
    (window as any).api = {
      nutritionCloseWeek: vi.fn().mockResolvedValue({ success: true, report }),
      processRpgEvent,
    };

    await sealWeek('2026-08-31');

    expect(processRpgEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'WEEK_SUMMARY',
      moduleId: 'nutrition',
      payload: expect.objectContaining({ xp: 50, hp: 0, weekStart: '2026-08-31' }),
    }));
  });

  it('devuelve el XP que PAGÓ el motor, no el que declaró el sello', async () => {
    (window as any).api = {
      nutritionCloseWeek: vi.fn().mockResolvedValue({ success: true, report }),
      processRpgEvent: vi.fn().mockResolvedValue({ xpGained: 0 }),   // el guard ya pagó
    };
    const res = await sealWeek('2026-08-31');
    expect(res!.xpGained).toBe(0);         // NO 50
    expect(res!.report.xpTotal).toBe(50);  // el declarado sigue disponible
  });

  it('no emite nada si el sellado falló', async () => {
    const processRpgEvent = vi.fn();
    (window as any).api = {
      nutritionCloseWeek: vi.fn().mockResolvedValue({ success: false, error: 'Waiting for weigh-in' }),
      processRpgEvent,
    };
    expect(await sealWeek('2026-08-31')).toBeNull();
    expect(processRpgEvent).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- tests/modules/nutrition/weekly-emit.test.ts`
Expected: FAIL — no se puede resolver `weekly-api`

- [ ] **Step 3: Implementar**

```ts
/**
 * Puente del renderer al pergamino semanal.
 *
 * El reparto espeja `closeNutritionDay` (src/hub/codex/nutritionClose.ts): el
 * handler sella y devuelve el veredicto, y el renderer emite el evento RPG.
 */
import type { WeekReport, CloseWeekResult } from '../../../shared/types';

export interface SealResult {
  report: WeekReport;
  /** Lo que el motor PAGÓ. Es lo único que puede mostrar el toast. */
  xpGained: number;
}

/**
 * Sella la semana y cobra el bonus.
 *
 * `weekStart` del payload sale de `report.weekStart`, NUNCA de un
 * `getMondayOfWeek()` local: el renderer corre con el reloj de pared, y a la
 * 01:00 del lunes derivaría un lunes distinto al de la fila recién sellada. Eso
 * es peor que pagar 0 — escribe el pago en el balde equivocado y rompe la
 * unicidad por semana en las dos direcciones.
 *
 * `payload.xp` es obligatorio: no hay entrada de WEEK_SUMMARY en
 * DEFAULT_EVENT_XP, así que omitirlo paga 0 en silencio.
 */
export async function sealWeek(weekStart: string): Promise<SealResult | null> {
  const res = (await window.api.nutritionCloseWeek(weekStart)) as CloseWeekResult;
  if (!res?.success) return null;

  const { report } = res;
  const rpg = await window.api.processRpgEvent({
    type: 'WEEK_SUMMARY',
    moduleId: 'nutrition',
    payload: { xp: report.xpTotal, hp: 0, weekStart: report.weekStart },
    timestamp: Date.now(),
  }) as { xpGained?: number } | null;

  return { report, xpGained: rpg?.xpGained ?? 0 };
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- tests/modules/nutrition/weekly-emit.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: NO commitear todavía**

Este commit va junto con la Task 11. Apenas `weekly-api.ts` emite
`type: 'WEEK_SUMMARY'` y la etiqueta de i18n no existe,
`tests/ipc/rpg-event-labels.test.ts` falla en su primera aserción ("cada tipo
emitido tiene etiqueta en los dos idiomas"). Seguí a la Task 11 y commiteá las
dos juntas.

---

### Task 11: Claves de i18n

> **El orden importa y no es cosmético.** Esta tarea va DESPUÉS de la 10, no
> antes. `tests/ipc/rpg-event-labels.test.ts` tiene un test —"no sobran etiquetas
> de tipos que ya nadie emite"— cuyo `emittedTypes()` (línea 33) camina solo
> `src/**` y `electron/**` buscando líneas con `type:` más un literal
> UPPER_SNAKE. El único emisor de `WEEK_SUMMARY` es
> `src/modules/nutrition/weekly-api.ts`, que nace en la Task 10. Agregar la
> etiqueta antes deja el tipo huérfano y ese test FALLA.
> (`WEEK_SUMMARY: Scroll` en `CharacterPage.tsx` no cuenta: el scan exige `type:`
> en la línea.)

**Files:**
- Modify: `src/i18n/es.json`, `src/i18n/en.json`
- Modify: `src/hub/CharacterPage.tsx` (mapa de iconos, :64)

- [ ] **Step 1: Agregar `events.WEEK_SUMMARY` en ambos idiomas**

En el bloque `"events"` de `es.json` (:950), alfabético:

```json
    "WEEK_SUMMARY": "Pergamino de la semana",
```

En `en.json`:

```json
    "WEEK_SUMMARY": "Weekly scroll",
```

Sin esto, la línea de tiempo del Códice muestra el string crudo `WEEK_SUMMARY`.

- [ ] **Step 2: Agregar las claves del pergamino**

En la sección `nutrify` de ambos archivos, alfabéticas. Como mínimo:
`weeklyTitle`, `weeklySeal`, `weeklySealConfirm`, `weeklyCompliance`,
`weeklyAvgIntake`, `weeklyWeightDelta`, `weeklyNoWeight`, `weeklyHabits`,
`weeklyStreakHelp`, `weeklyArchive`, `weeklyZeroXp`.

- [ ] **Step 3: Agregar el icono**

En `src/hub/CharacterPage.tsx`, junto a `DAY_SUMMARY: Scale` (:64):

```ts
  WEEK_SUMMARY: Scroll,
```

Importar `Scroll` de `src/shared/components/icons` si no está ya.

- [ ] **Step 4: Verificar las dos aserciones del archivo de etiquetas**

Run: `npm test -- tests/ipc/rpg-event-labels.test.ts`
Expected: PASS. Ese archivo afirma dos cosas, y esta feature toca las dos:
1. **Todo tipo emitido tiene etiqueta en `es` Y en `en`** — la satisface la clave
   que agregaste en el Step 1
2. **Ninguna etiqueta queda huérfana** — la satisface el emisor de la Task 10.
   La allowlist de excepciones es `LEVEL_UP`, `EXPENSE_TRACKED`,
   `RECURRING_UPDATED`; `WEEK_SUMMARY` no entra ahí, tiene que estar emitido

- [ ] **Step 5: Commit — junto con la Task 10**

Las dos tareas son inseparables: entre una y otra el repo queda rojo en un
sentido o en el otro (sin etiqueta falla la aserción 1, sin emisor falla la 2).
Hacé **un solo commit** con las dos:

```bash
git add src/modules/nutrition/weekly-api.ts tests/modules/nutrition/weekly-emit.test.ts \
        src/i18n/es.json src/i18n/en.json src/hub/CharacterPage.tsx
git commit -m "feat(nutrition): emisión de WEEK_SUMMARY con su etiqueta e icono"
```

---

### Task 12: `WeeklyScroll.tsx`

**Files:**
- Create: `src/modules/nutrition/components/WeeklyScroll.tsx`
- Modify: `src/modules/nutrition/components/NutritionCharts.tsx` (montarlo arriba)
- Modify: `src/modules/nutrition/styles/nutri.css` (bloque `.nutri-scroll-*`)

Sin test automatizado: es presentación pura sobre handlers ya cubiertos, y montar
un Chromium para eso sería desproporcionado (ver spec §Dónde corre cada test).

- [ ] **Step 1: Escribir el componente**

Requisitos que NO son opcionales:

- `useEffect` con listener de **`account:switched`** que recarga (`CLAUDE.md`)
- **`useConfirm()`** antes de sellar — es irreversible, no hay `reopenWeek`
- El toast usa `xpGained` de `sealWeek`, **nunca** `report.xpTotal`
- `daysCompliant` y `streakEnd` etiquetados distinto, con un `HelpBubble` que
  explique el día de gracia de la racha (spec §Dos definiciones de "cumplir")
- Semana de 0 XP: se sella igual y se dice sin castigar
- Iconos SVG inline de `src/shared/components/icons/` — **cero emojis**
- Clases `.rpg-card`, `.rpg-button` y el prefijo `.nutri-scroll-*`
- Todo texto por `t('nutrify.weekly…', 'fallback')`

Estructura:

```tsx
export default function WeeklyScroll() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const confirm = useConfirm();

  const [pending, setPending] = useState<string[]>([]);
  const [archive, setArchive] = useState<WeekReport[]>([]);
  const [open, setOpen] = useState<WeekReport | null>(null);

  const load = useCallback(async () => {
    const [weeks, closed] = await Promise.all([
      window.api.nutritionGetPendingWeeks(),
      window.api.nutritionGetClosedWeeks(12),
    ]);
    setPending(weeks);
    setArchive(closed);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Obligatorio: cambio de cuenta, alta de cuenta y logout disparan este evento.
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
  }, [load]);

  // … pergamino lacrado / desplegado / archivo
}
```

- [ ] **Step 2: Montarlo en el Códice**

En `NutritionCharts.tsx`, arriba de los gráficos:

```tsx
<WeeklyScroll />
```

- [ ] **Step 3: Verificar a mano**

El usuario corre la app. Checklist:
- El pergamino aparece sólo cuando hay semana pendiente
- Sellarlo pide confirmación
- El toast muestra el XP pagado
- Cambiar de cuenta recarga el pergamino
- Una semana sin peso dice "sin pesaje" y no un delta inventado

- [ ] **Step 4: Commit**

```bash
git add src/modules/nutrition/components/WeeklyScroll.tsx \
        src/modules/nutrition/components/NutritionCharts.tsx \
        src/modules/nutrition/styles/nutri.css
git commit -m "feat(nutrition): pergamino semanal en el Códice de Nutrify"
```

---

### Task 13: Aviso en Today

**Files:**
- Modify: `src/modules/nutrition/components/Today.tsx`

- [ ] **Step 1: Cargar las semanas pendientes**

Espejar `loadPendingDays` (`Today.tsx:307`), con su listener de `account:switched`.

- [ ] **Step 2: Renderizar el aviso**

Reusando `.nutri-pending-banner` (`Today.tsx:1270`), con `navigate('/nutrition/dashboard')`.

- [ ] **Step 3: Commit**

```bash
git add src/modules/nutrition/components/Today.tsx
git commit -m "feat(nutrition): aviso de pergamino pendiente en la vista diaria"
```

---

## Cierre

- [ ] **Correr la suite completa**

Run: `npm test`
Expected: PASS.

**Anotá la línea base ANTES de empezar la Task 1** (`npm test`
y guardá el número). No confíes en una cifra escrita acá: cualquier número que
ponga hoy queda viejo. Este plan agrega ~52 tests sobre esa base.

- [ ] **Typecheck de la frontera de shared-logic**

Run: `npm run typecheck:shared-logic`
Expected: sin errores.

- [ ] **No correr un build.** El usuario lo hace (`CLAUDE.md`).

- [ ] **Entrada de changelog.** Ver `~/.claude/skills/patch-notes/SKILL.md`. Ojo:
  ya hay una entrada pendiente sin registrar para la 0.9.7 (el fix del menú del
  teléfono) — conviene resolver las dos juntas antes de tagear.
