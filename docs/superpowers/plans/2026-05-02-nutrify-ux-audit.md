# Nutrify UX Audit Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 15 UX/UI issues in the Nutrify module covering data integrity, user journey, visual feedback, accessibility, and mobile usability.

**Architecture:** Backend-first approach — migration + soft deletes + sync changes first, then UI fixes layered on top. Each task is self-contained and independently committable.

**Tech Stack:** Electron 41, React 19, TypeScript, better-sqlite3, Vitest, i18next

**Spec:** `docs/superpowers/specs/2026-05-02-nutrify-ux-audit-design.md`

---

## Chunk 1: Database & Backend

### Task 1: Migration V9 — Soft Deletes + updated_at + Unique Index

**Files:**
- Modify: `src/modules/nutrition/nutrition.schema.ts` (append to `nutritionMigrations` array)
- Test: `tests/modules/nutrition/nutrition-soft-delete.test.ts` (new)

**Context:** The migration array is exported as `nutritionMigrations` with 8 entries (V1-V8). Append V9. Schema file path: `src/modules/nutrition/nutrition.schema.ts`. Migrations use pattern `{ namespace: 'nutrition', version: N, up: '...' }`. `food_log` has no `updated_at` column (missed in V7). `frequent_foods.name` has no UNIQUE constraint.

- [ ] **Step 1: Write failing test**

Create `tests/modules/nutrition/nutrition-soft-delete.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { nutritionMigrations } from '@modules/nutrition/nutrition.schema';

function runMigrations(db: Database.Database) {
  for (const m of nutritionMigrations) {
    try {
      db.exec(m.up);
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('duplicate column name')) continue;
      throw e;
    }
  }
}

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('nutrition migration V9 — soft deletes', () => {
  it('food_log has deleted_at and updated_at columns', () => {
    const db = setupDb();
    const cols = db.pragma('table_info(food_log)') as Array<{ name: string }>;
    const names = cols.map(c => c.name);
    expect(names).toContain('deleted_at');
    expect(names).toContain('updated_at');
  });

  it('favorite_foods has deleted_at column', () => {
    const db = setupDb();
    const cols = db.pragma('table_info(favorite_foods)') as Array<{ name: string }>;
    expect(cols.map(c => c.name)).toContain('deleted_at');
  });

  it('frequent_foods has deleted_at column', () => {
    const db = setupDb();
    const cols = db.pragma('table_info(frequent_foods)') as Array<{ name: string }>;
    expect(cols.map(c => c.name)).toContain('deleted_at');
  });

  it('frequent_foods has case-insensitive unique index on name', () => {
    const db = setupDb();
    db.prepare("INSERT INTO frequent_foods (name, calories, times_used, created_at) VALUES ('Milanesa', 400, 1, datetime('now'))").run();
    expect(() => {
      db.prepare("INSERT INTO frequent_foods (name, calories, times_used, created_at) VALUES ('milanesa', 300, 1, datetime('now'))").run();
    }).toThrow();
  });

  it('soft-deleted food_log entries are excluded from calorie sum', () => {
    const db = setupDb();
    db.prepare("INSERT INTO food_log (date, time, description, calories, source) VALUES ('2026-05-01', '12:00', 'Lunch', 500, 'manual')").run();
    db.prepare("INSERT INTO food_log (date, time, description, calories, source, deleted_at) VALUES ('2026-05-01', '13:00', 'Deleted', 300, 'manual', datetime('now'))").run();
    const row = db.prepare("SELECT COALESCE(SUM(calories), 0) AS total FROM food_log WHERE date = '2026-05-01' AND deleted_at IS NULL").get() as { total: number };
    expect(row.total).toBe(500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/modules/nutrition/nutrition-soft-delete.test.ts`
Expected: FAIL — columns don't exist yet

- [ ] **Step 3: Add migration V9**

In `src/modules/nutrition/nutrition.schema.ts`, append to the `nutritionMigrations` array:

```typescript
{
  namespace: 'nutrition',
  version: 9,
  up: `
    ALTER TABLE food_log ADD COLUMN updated_at TEXT DEFAULT NULL;
    ALTER TABLE food_log ADD COLUMN deleted_at TEXT DEFAULT NULL;
    ALTER TABLE favorite_foods ADD COLUMN deleted_at TEXT DEFAULT NULL;
    ALTER TABLE frequent_foods ADD COLUMN deleted_at TEXT DEFAULT NULL;
    DELETE FROM frequent_foods WHERE rowid NOT IN (
      SELECT MIN(rowid) FROM frequent_foods GROUP BY name COLLATE NOCASE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_frequent_foods_name ON frequent_foods(name COLLATE NOCASE);
  `,
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run tests/modules/nutrition/nutrition-soft-delete.test.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/modules/nutrition/nutrition.schema.ts tests/modules/nutrition/nutrition-soft-delete.test.ts
git commit -m "feat(nutrition): migration V9 — soft deletes, updated_at, unique index"
```

---

### Task 2: Soft Delete IPC Handlers

**Files:**
- Modify: `electron/modules/nutrition.ipc.ts`

**Context:** Three delete handlers need soft-delete conversion:
- `nutrition:deleteFood` at line 119: `DELETE FROM food_log WHERE id = ?`
- `nutrition:removeFavoriteFood` at line 526: `DELETE FROM favorite_foods WHERE id = ?`
- `nutrition:deleteFrequentFood` at line 187: `DELETE FROM frequent_foods WHERE id = ?`
- `nutrition:deleteByDate` at line 156: `DELETE FROM food_log WHERE date = ?`

- [ ] **Step 1: Convert deleteFood to soft delete**

At line 119, change:
```typescript
// OLD: db.prepare('DELETE FROM food_log WHERE id = ?').run(id);
// NEW:
db.prepare("UPDATE food_log SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND deleted_at IS NULL").run(id);
```

- [ ] **Step 2: Convert removeFavoriteFood to soft delete**

At line 526, change:
```typescript
// OLD: db.prepare('DELETE FROM favorite_foods WHERE id = ?').run(id);
// NEW:
db.prepare("UPDATE favorite_foods SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND deleted_at IS NULL").run(id);
```

- [ ] **Step 3: Convert deleteFrequentFood to soft delete**

At line 187, change:
```typescript
// OLD: db.prepare('DELETE FROM frequent_foods WHERE id = ?').run(id);
// NEW:
db.prepare("UPDATE frequent_foods SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND deleted_at IS NULL").run(id);
```

- [ ] **Step 4: Convert deleteByDate to soft delete**

At line 156, change:
```typescript
// OLD: db.prepare('DELETE FROM food_log WHERE date = ?').run(date);
// NEW:
db.prepare("UPDATE food_log SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE date = ? AND deleted_at IS NULL").run(date);
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: All pass (existing tests don't test delete behavior directly)

- [ ] **Step 6: Commit**

```bash
git add electron/modules/nutrition.ipc.ts
git commit -m "feat(nutrition): convert delete handlers to soft delete"
```

---

### Task 3: Add deleted_at IS NULL to All Queries

**Files:**
- Modify: `electron/modules/nutrition.ipc.ts`

**Context:** Every query that reads from `food_log`, `favorite_foods`, or `frequent_foods` must filter out soft-deleted rows. Here's the complete list with line numbers:

**food_log queries:**
- Line 108: `getFoodByDate` — `WHERE date = ?` → add `AND deleted_at IS NULL`
- Line 292: `getWeekCalories` — `WHERE date BETWEEN ? AND ?` → add `AND deleted_at IS NULL`
- Line 317: `getTodayCalories` — `WHERE date = ?` → add `AND deleted_at IS NULL`
- Line 324: `getTodayMealsCount` — `WHERE date = ?` → add `AND deleted_at IS NULL`
- Line 531: `getPendingDays` — `FROM food_log f` → add `AND f.deleted_at IS NULL`
- Line 551: `recalcSummary` helper — `SELECT COALESCE(SUM(calories), 0)` → add `AND deleted_at IS NULL`
- Line 132: `updateFood` — `WHERE id = ?` → add `AND deleted_at IS NULL`

**favorite_foods queries:**
- Line 512: `getFavoriteFoods` — `FROM favorite_foods` → add `WHERE deleted_at IS NULL`

**frequent_foods queries:**
- Line 168: `getFrequentFoods` — `FROM frequent_foods` → add `WHERE deleted_at IS NULL`

- [ ] **Step 1: Add filters to all food_log queries**

For each line listed above, add `AND deleted_at IS NULL` to the WHERE clause. For queries without WHERE (like getFavoriteFoods, getFrequentFoods), add `WHERE deleted_at IS NULL`.

Example for getFoodByDate (line 108):
```typescript
// OLD: WHERE date = ? ORDER BY time ASC
// NEW: WHERE date = ? AND deleted_at IS NULL ORDER BY time ASC
```

Example for recalcSummary (line ~555):
```typescript
// OLD: SELECT COALESCE(SUM(calories), 0) AS total FROM food_log WHERE date = ?
// NEW: SELECT COALESCE(SUM(calories), 0) AS total FROM food_log WHERE date = ? AND deleted_at IS NULL
```

- [ ] **Step 2: Add filters to favorite_foods and frequent_foods queries**

getFavoriteFoods (line 512):
```typescript
// OLD: FROM favorite_foods ORDER BY created_at DESC
// NEW: FROM favorite_foods WHERE deleted_at IS NULL ORDER BY created_at DESC
```

getFrequentFoods (line 168):
```typescript
// OLD: FROM frequent_foods ORDER BY times_used DESC
// NEW: FROM frequent_foods WHERE deleted_at IS NULL ORDER BY times_used DESC
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add electron/modules/nutrition.ipc.ts
git commit -m "feat(nutrition): filter soft-deleted rows from all queries"
```

---

### Task 4: Sync Handler Updates for Soft Deletes

**Files:**
- Modify: `electron/modules/sync.ipc.ts`

**Context:**
- `sync:getAllNutritionData` at line 457 — must include `deleted_at` and `updated_at` in SELECT for food_log, favorite_foods, frequent_foods
- `sync:mergeNutritionData` at line 473 — must handle deleted_at in INSERT/UPDATE for all three tables

- [ ] **Step 1: Update getAllNutritionData**

At line ~460 (food_log query), add `updated_at, deleted_at` to SELECT:
```typescript
// OLD: SELECT id, date, time, description, calories, source, frequent_food_id, ai_breakdown, meal FROM food_log ...
// NEW: SELECT id, date, time, description, calories, source, frequent_food_id, ai_breakdown, meal, updated_at, deleted_at FROM food_log ...
```

At line ~462 (frequent_foods query), add `deleted_at` to SELECT:
```typescript
// OLD: SELECT id, name, calories, ai_breakdown, times_used, created_at, updated_at FROM frequent_foods ...
// NEW: SELECT id, name, calories, ai_breakdown, times_used, created_at, updated_at, deleted_at FROM frequent_foods ...
```

At line ~467 (favorite_foods query), add `deleted_at` to SELECT:
```typescript
// OLD: SELECT id, description, calories, source, ai_breakdown AS aiBreakdown, created_at AS createdAt, updated_at AS updatedAt FROM favorite_foods ...
// NEW: SELECT id, description, calories, source, ai_breakdown AS aiBreakdown, created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt FROM favorite_foods ...
```

- [ ] **Step 2: Update mergeNutritionData — food_log**

At lines 495-524 (food_log merge). There are TWO code paths: id-based (line 501) and legacy (line 508). Both need updating.

**Modified INSERT (id-based path):**
```typescript
// OLD: INSERT OR IGNORE INTO food_log (id, date, time, description, calories, source, frequent_food_id, ai_breakdown, meal) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
// NEW: INSERT OR IGNORE INTO food_log (id, date, time, description, calories, source, frequent_food_id, ai_breakdown, meal, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```

**After INSERT OR IGNORE, add LWW update for soft-deleted entries (both paths):**
```typescript
if (entry.deleted_at || entry.updated_at) {
  db.prepare(
    "UPDATE food_log SET deleted_at = ?, updated_at = ? WHERE id = ? AND (updated_at IS NULL OR updated_at < ?)"
  ).run(entry.deleted_at ?? null, entry.updated_at ?? null, entry.id, entry.updated_at);
}
```

Also update the legacy code path (line 510-517) to include `updated_at, deleted_at` in its INSERT.

- [ ] **Step 3: Update mergeNutritionData — frequent_foods**

At lines 526-551 (frequent_foods merge):
- Include `deleted_at` in the UPDATE branch when remote is newer
- Include `deleted_at` in the INSERT branch for new entries

- [ ] **Step 4: Update mergeNutritionData — favorite_foods**

At lines 617-622 (favorite_foods merge):
- Change INSERT OR IGNORE to include `deleted_at`:

```typescript
// OLD: INSERT OR IGNORE INTO favorite_foods (id, description, calories, source, ai_breakdown, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
// NEW: INSERT OR IGNORE INTO favorite_foods (id, description, calories, source, ai_breakdown, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
```

- Add LWW update for existing entries:
```typescript
db.prepare(
  "UPDATE favorite_foods SET deleted_at = ?, updated_at = ? WHERE id = ? AND (updated_at IS NULL OR updated_at < ?)"
).run(entry.deletedAt, entry.updatedAt, entry.id, entry.updatedAt);
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add electron/modules/sync.ipc.ts
git commit -m "feat(nutrition): include soft-delete fields in sync handlers"
```

---

### Task 5: Frequent Foods Dedup + Streak Documentation (Items 9, 15)

**Files:**
- Modify: `electron/modules/nutrition.ipc.ts`

**Context:**
- `nutrition:createFrequentFood` at line 177: normalize name before insert. The UNIQUE index from V9 handles dedup, but we still trim the input.
- `nutrition:incrementFrequentUsage` at line 192: use COLLATE NOCASE for matching.
- `nutrition:getStreak` at line 261: add documentation comment about 10% tolerance.

- [ ] **Step 1: Normalize name in createFrequentFood**

At line 177, trim the name:
```typescript
const normalizedName = (name as string).trim();
// Then use normalizedName in INSERT
```

- [ ] **Step 2: Use COLLATE NOCASE in incrementFrequentUsage**

At line 192, modify query:
```typescript
// OLD: WHERE id = ?
// Change increment to also support name-based matching for legacy data:
// Keep id-based update as-is (it's correct), but the createFrequentFood
// INSERT OR IGNORE with the UNIQUE COLLATE NOCASE index handles dedup.
```

- [ ] **Step 3: Add streak tolerance documentation**

At line 261 (getStreak handler), add comment:
```typescript
// Streak tolerance: ±10% of daily target
// This matches the HP system's "on target" threshold (±10% → +10 HP).
// XP precision uses finer gradations (5%/15%/30%) for reward scaling,
// but streak is binary (on/off) so the ±10% HP band is the right match.
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add electron/modules/nutrition.ipc.ts
git commit -m "feat(nutrition): frequent food dedup + streak tolerance docs"
```

---

## Chunk 2: Today.tsx UI Changes

### Task 6: Closed Day Badge on Date Pill (Item 2)

**Files:**
- Modify: `src/modules/nutrition/components/Today.tsx` (lines 620-626)
- Modify: `src/modules/nutrition/styles/nutri.css`

**Context:** The date pill is at lines 620-626. When `dayClosed !== null`, add a lock icon and class.

- [ ] **Step 1: Add closed class and lock icon to date pill**

At lines 620-626, modify:
```tsx
<button
  className={`nutri-date-pill${dayClosed ? ' nutri-date-pill--closed' : ''}`}
  onClick={() => !isToday && setDate(todayDateString())}
  disabled={isToday}
>
  {dayClosed && (
    <svg className="nutri-closed-ico" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="8" width="10" height="7" rx="1"/><path d="M5 8V5a3 3 0 0 1 6 0v3"/>
    </svg>
  )}
  {isToday ? t('nutrify.today', 'Hoy') : `${date} \u00B7 ${dateDayName}`}
</button>
```

- [ ] **Step 2: Add CSS**

In `src/modules/nutrition/styles/nutri.css`, add:
```css
.nutri-date-pill--closed {
  border-color: var(--rpg-xp-green);
  opacity: 0.85;
}
.nutri-closed-ico {
  margin-right: 4px;
  opacity: 0.7;
  vertical-align: middle;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/nutrition/components/Today.tsx src/modules/nutrition/styles/nutri.css
git commit -m "feat(nutrition): closed day badge on date pill"
```

---

### Task 7: Weight Check-in Always Accessible (Item 6)

**Files:**
- Modify: `src/modules/nutrition/components/Today.tsx`
- Modify: `src/i18n/es.json`
- Modify: `src/i18n/en.json`

**Context:** The weight popup exists at lines 960-993 with state `weightPopup.show`. The close day card is at line ~945. No standalone metrics section exists — steps/gym are only in the close-day popup. Add a "Registrar peso" button near the close-day button area.

- [ ] **Step 1: Add weight button near close day area**

Near line 945 (inside the nutri-reward-card area), before the close day button, add:
```tsx
<button
  className="nutri-btn nutri-btn-ghost"
  style={{ width: '100%', marginBottom: 8 }}
  onClick={() => setWeightPopup({ show: true, lastWeight: weightPopup.lastWeight })}
>
  {t('nutrify.logWeight', 'Registrar peso')}
</button>
```

- [ ] **Step 2: Make dismiss key account-specific**

Find the localStorage key `hubtify_weight_dismiss_date` at lines ~423 and ~451. Need to get the current account ID. Check how other components get it — look for existing pattern.

**Deferred:** The account-specific localStorage key (`hubtify_weight_dismiss_date_${accountId}`) requires plumbing accountId into Today.tsx. This is a cross-cutting concern better handled in a dedicated multi-account cleanup task. Skip for this audit — the current date-based key is sufficient (resets daily).

- [ ] **Step 3: Add i18n keys**

In `src/i18n/es.json` under `nutrify`:
```json
"logWeight": "Registrar peso"
```

In `src/i18n/en.json` under `nutrify`:
```json
"logWeight": "Log weight"
```

- [ ] **Step 4: Commit**

```bash
git add src/modules/nutrition/components/Today.tsx src/i18n/es.json src/i18n/en.json
git commit -m "feat(nutrition): always-accessible weight check-in button"
```

---

### Task 8: Food Log Empty State (Item 7 — Today.tsx part)

**Files:**
- Modify: `src/modules/nutrition/components/Today.tsx` (line 878)
- Modify: `src/i18n/es.json`
- Modify: `src/i18n/en.json`

**Context:** Current empty state at line 878: `{foods.length === 0 && <p className="nutri-empty">{t('nutrify.noFood', 'No hay comidas registradas')}</p>}`. Replace with richer empty state including Platter icon and call-to-action text.

- [ ] **Step 1: Replace empty state**

At line 878, replace:
```tsx
{foods.length === 0 && !dayClosed && (
  <div className="nutri-empty">
    <Platter width={32} height={32} />
    <p>{t('nutrify.noFoodToday', 'No hay comidas registradas. Describí lo que comiste arriba o usá un favorito.')}</p>
  </div>
)}
```

Verify that `Platter` is already imported (check line 15 area — it's imported in FoodLogItem but may not be in Today.tsx). If not, add to imports:
```typescript
import { Platter } from '../../../shared/components/icons';
```

- [ ] **Step 2: Add i18n keys**

In `src/i18n/es.json` under `nutrify`:
```json
"noFoodToday": "No hay comidas registradas. Describí lo que comiste arriba o usá un favorito."
```

In `src/i18n/en.json` under `nutrify`:
```json
"noFoodToday": "No meals logged yet. Describe what you ate above or use a favorite."
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/nutrition/components/Today.tsx src/i18n/es.json src/i18n/en.json
git commit -m "feat(nutrition): informative empty state for food log"
```

---

### Task 9: Close Day Sticky Footer (Item 8)

**Files:**
- Modify: `src/modules/nutrition/components/Today.tsx`
- Modify: `src/modules/nutrition/styles/nutri.css`

**Context:** Close day button is at line 946-954 inside `.nutri-reward-card`. Move it to a sticky footer that stays visible while scrolling. Show only when day is open and has food.

- [ ] **Step 1: Add sticky footer at end of component JSX**

At the very end of the component return (just before closing `</div>` of the page), add:
```tsx
{!dayClosed && foods.length > 0 && (
  <div className="nutri-sticky-footer">
    <button className="rpg-button nutri-close-day-btn" onClick={() => {
      setPopupSteps(metrics.steps != null ? String(metrics.steps) : '');
      setPopupGym(!!metrics.gym);
      setCloseDayPopup(true);
    }}>
      {isPending ? t('nutrify.confirmDay', 'Confirmar Día') : t('nutrify.closeDayButton', 'Cerrar el Día')}
    </button>
  </div>
)}
```

Consider whether to keep or remove the existing close day button in the reward card. Recommendation: keep both — the inline one provides context, the sticky one provides accessibility.

- [ ] **Step 2: Add CSS**

In `src/modules/nutrition/styles/nutri.css`:
```css
.nutri-sticky-footer {
  position: sticky;
  bottom: 0;
  z-index: 10;
  padding: 12px 16px;
  background: linear-gradient(transparent, var(--rpg-parchment) 30%);
  text-align: center;
  pointer-events: none;
}
.nutri-sticky-footer .nutri-close-day-btn {
  pointer-events: auto;
}
```

If `position: sticky` doesn't work due to the scroll container structure (Electron sidebar layout), use `position: fixed` with `bottom: 0; left: var(--sidebar-width, 200px); right: 0` instead. The implementer should test both.

- [ ] **Step 3: Commit**

```bash
git add src/modules/nutrition/components/Today.tsx src/modules/nutrition/styles/nutri.css
git commit -m "feat(nutrition): sticky footer for close day button"
```

---

### Task 10: TDEE Help Bubble (Item 10)

**Files:**
- Modify: `src/modules/nutrition/components/Today.tsx`
- Modify: `src/i18n/es.json`
- Modify: `src/i18n/en.json`

**Context:** The target display is in the hero card at lines 670-679. `HelpBubble` is already imported at line 14.

- [ ] **Step 1: Add HelpBubble next to target**

Near line 670 (the target/objective row), add HelpBubble:
```tsx
<div className="nutri-cal-row">
  <span className="nutri-cal-label">
    {t('nutrify.target', 'Objetivo')}
    <HelpBubble text={t('nutrify.targetHelp', 'Tu objetivo se ajusta según tu nivel de actividad base y tu actividad reciente (gym, pasos) de los últimos 14 días.')} />
  </span>
  {/* ... rest of row unchanged */}
</div>
```

- [ ] **Step 2: Add i18n keys**

In `src/i18n/es.json` under `nutrify`:
```json
"targetHelp": "Tu objetivo se ajusta según tu nivel de actividad base y tu actividad reciente (gym, pasos) de los últimos 14 días."
```

In `src/i18n/en.json` under `nutrify`:
```json
"targetHelp": "Your target adjusts based on your base activity level and your recent activity (gym, steps) from the last 14 days."
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/nutrition/components/Today.tsx src/i18n/es.json src/i18n/en.json
git commit -m "feat(nutrition): TDEE help bubble on target display"
```

---

### Task 11: XP/HP Breakdown Labels (Item 11)

**Files:**
- Modify: `src/modules/nutrition/components/Today.tsx` (close day result area)
- Modify: `src/i18n/es.json`
- Modify: `src/i18n/en.json`

**Context:** Close day result shows XP breakdown. Existing i18n keys: `nutrify.xpPrecision` ("Precisión calórica"), `nutrify.xpSteps` ("Pasos"), `nutrify.xpGym` ("Gimnasio"), `nutrify.xpWeight` ("Peso registrado"), `nutrify.xpBonus` ("Bonus precisión"). Update values to include descriptive context. HP row needs color + tooltip.

- [ ] **Step 1: Update existing i18n key values**

In `src/i18n/es.json`:
```json
"xpPrecision": "Precisión (cercanía al objetivo)",
"xpSteps": "Actividad (pasos)",
"xpGym": "Entrenamiento (gym)",
"xpWeight": "Registro de peso",
"xpBonus": "Bonus (excelente precisión)",
"hpExplanation": "HP según cercanía al objetivo: dentro del rango = +HP, fuera del rango = -HP"
```

In `src/i18n/en.json`:
```json
"xpPrecision": "Precision (closeness to target)",
"xpSteps": "Activity (steps)",
"xpGym": "Training (gym)",
"xpWeight": "Weight logged",
"xpBonus": "Bonus (excellent precision)",
"hpExplanation": "HP based on target accuracy: within range = +HP, outside range = -HP"
```

- [ ] **Step 2: Add HP color and tooltip in close day result**

In the close day result card JSX (find where `hpChange` is displayed), add color class and HelpBubble:
```tsx
<span className={closeResult.hpChange >= 0 ? 'nutri-green' : 'nutri-red'}>
  {closeResult.hpChange >= 0 ? '+' : ''}{closeResult.hpChange} HP
</span>
<HelpBubble text={t('nutrify.hpExplanation')} />
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/nutrition/components/Today.tsx src/i18n/es.json src/i18n/en.json
git commit -m "feat(nutrition): descriptive XP/HP labels in close day result"
```

---

## Chunk 3: FoodLogItem, Dashboard Widget, Charts

### Task 12: Touch Targets + Action Contrast (Item 4)

**Files:**
- Modify: `src/modules/nutrition/components/FoodLogItem.tsx` (lines 225-251)
- Modify: `src/modules/nutrition/styles/nutri.css`

**Context:** Action icons at lines 225-251 use inline `opacity: 0.4` and are 12×12px. Need to wrap in tappable 32px areas with CSS-controlled opacity.

- [ ] **Step 1: Wrap each action icon in a span with className**

Replace the action icons section (lines 225-251). Each icon gets `className="nutri-food-action"` and inline opacity styles are REMOVED:

```tsx
<div className="nutri-meal-del">
  {onFavorite && (
    <span className="nutri-food-action" onClick={onFavorite}
      title={t('nutrify.saveToFavorites', 'Guardar en favoritos')}>
      <Heart width={14} height={14} stroke="var(--rpg-hp-red)" />
    </span>
  )}
  <span className="nutri-food-action" onClick={() => setEditing(true)}>
    <svg width="14" height="14" viewBox="0 0 12 12" fill="none"
      stroke="var(--gold-dark)" strokeWidth="1.2" strokeLinecap="round">
      <path d="M8.5 1.5l2 2M3 7l5.5-5.5 2 2L5 9H3V7z"/>
    </svg>
  </span>
  <span className="nutri-food-action" onClick={() => setConfirmDelete(true)}>
    <svg width="14" height="14" viewBox="0 0 12 12" fill="none"
      stroke="var(--rubric)" strokeWidth="1.5" strokeLinecap="round">
      <line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/>
    </svg>
  </span>
</div>
```

Remove `onMouseOver`/`onMouseOut` inline handlers from all three.

- [ ] **Step 2: Add CSS for touch targets**

In `src/modules/nutrition/styles/nutri.css`:
```css
.nutri-food-action {
  min-height: 32px;
  min-width: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border-radius: 4px;
  transition: background 0.2s;
}
.nutri-food-action svg {
  opacity: 0.6;
  transition: opacity 0.2s;
}
.nutri-food-action:hover svg {
  opacity: 1;
}
.nutri-food-action:hover {
  background: rgba(0, 0, 0, 0.05);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/nutrition/components/FoodLogItem.tsx src/modules/nutrition/styles/nutri.css
git commit -m "feat(nutrition): larger touch targets and better contrast for food actions"
```

---

### Task 13: Unresolved Meal Badge (Item 5)

**Files:**
- Modify: `src/modules/nutrition/components/FoodLogItem.tsx`
- Modify: `src/modules/nutrition/styles/nutri.css`
- Modify: `src/i18n/es.json`
- Modify: `src/i18n/en.json`

**Context:** When `entry.meal` is null (not explicitly set by user), show "?" badge on the meal icon. The meal icon area is around lines 155-190 where meal type is displayed.

- [ ] **Step 1: Add badge next to meal icon**

Find the meal icon rendering (around line 160 where `MEAL_ICON_MAP[currentMeal]` is used). Make the icon container `position: relative` and add the badge:

```tsx
<div className="nutri-meal-ico" style={{ position: 'relative' }} onClick={() => setShowPicker(true)}>
  {MEAL_ICON_MAP[currentMeal]}
  {!entry.meal && (
    <span className="nutri-meal-unresolved" title={t('nutrify.pickMeal', 'Elegí la comida')}>?</span>
  )}
</div>
```

- [ ] **Step 2: Add CSS**

In `src/modules/nutrition/styles/nutri.css`:
```css
.nutri-meal-unresolved {
  background: var(--rpg-gold);
  color: var(--ink);
  border-radius: 50%;
  width: 16px;
  height: 16px;
  font-size: 10px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  position: absolute;
  top: -4px;
  right: -6px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}
```

- [ ] **Step 3: Add i18n keys**

In `src/i18n/es.json` under `nutrify`:
```json
"pickMeal": "Elegí la comida"
```

In `src/i18n/en.json` under `nutrify`:
```json
"pickMeal": "Pick meal type"
```

- [ ] **Step 4: Commit**

```bash
git add src/modules/nutrition/components/FoodLogItem.tsx src/modules/nutrition/styles/nutri.css src/i18n/es.json src/i18n/en.json
git commit -m "feat(nutrition): unresolved meal badge on food log items"
```

---

### Task 14: Meal Labels i18n (Item 12)

**Files:**
- Modify: `src/modules/nutrition/components/FoodLogItem.tsx` (lines 40-45)

**Context:** `MEAL_LABELS` at lines 40-45 is a hardcoded Spanish object. The component already uses `useTranslation` (line 2). Replace with `t()` calls. Keys `nutrify.mealBreakfast`, `nutrify.mealLunch`, `nutrify.mealDinner`, `nutrify.mealSnack` already exist in i18n files.

- [ ] **Step 1: Replace MEAL_LABELS with function**

Remove the `MEAL_LABELS` constant (lines 40-45). Add a helper:
```typescript
function getMealLabel(meal: MealType, t: ReturnType<typeof useTranslation>['t']): string {
  const key = `nutrify.meal${meal.charAt(0).toUpperCase() + meal.slice(1)}`;
  const fallback: Record<MealType, string> = {
    breakfast: 'Desayuno', lunch: 'Almuerzo', dinner: 'Cena', snack: 'Snack',
  };
  return t(key, fallback[meal]);
}
```

- [ ] **Step 2: Update all usages of MEAL_LABELS**

Find all `MEAL_LABELS[...]` references and replace with `getMealLabel(meal, t)`. There are usages at lines ~164 and ~180. The `t` is available inside the component via `useTranslation`.

- [ ] **Step 3: Commit**

```bash
git add src/modules/nutrition/components/FoodLogItem.tsx
git commit -m "fix(nutrition): use i18n for meal labels instead of hardcoded Spanish"
```

---

### Task 15: Dashboard Widget Manual Fallback + No-Profile State (Items 3, 13)

**Files:**
- Modify: `src/modules/nutrition/components/NutritionDashboardWidget.tsx`
- Modify: `src/i18n/es.json`
- Modify: `src/i18n/en.json`

**Context:**
- Error handler at lines 53-54: shows toast "Error al estimar. Intenta en el modulo completo."
- No-profile state at lines 135-139: shows italic "Setup required" text
- Need: inline manual input on error, better no-profile message

- [ ] **Step 1: Add manual fallback state**

Add state:
```typescript
const [showManualFallback, setShowManualFallback] = useState(false);
const [manualCalories, setManualCalories] = useState('');
```

- [ ] **Step 2: Update error handler**

At lines 53-54, replace toast with:
```typescript
} catch {
  setEstimation(null);
  setShowManualFallback(true);
}
```

- [ ] **Step 3: Add manual fallback UI**

After the estimation UI, add:
```tsx
{showManualFallback && (
  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
    <input
      className="rpg-input"
      type="number"
      placeholder="kcal"
      value={manualCalories}
      onChange={(e) => setManualCalories(e.target.value)}
      style={{ flex: 1 }}
    />
    <button
      className="rpg-button"
      disabled={!manualCalories || Number(manualCalories) <= 0}
      onClick={async () => {
        const cal = Number(manualCalories);
        await window.api.nutritionLogFood({
          date: new Date().toISOString().slice(0, 10),
          description: foodInput.trim() || t('nutrify.manualEntry', 'Manual entry'),
          calories: cal,
          source: 'manual',
        });
        // Fire RPG event for consistency with normal log flow
        const rpgResult = await window.api.processRpgEvent({
          type: 'MEAL_LOGGED', moduleId: 'nutrition',
          payload: { xp: 5, hp: 0, calories: cal },
          timestamp: Date.now(),
        });
        toast({ type: 'xp', message: `+${rpgResult.xpGained} XP` });
        window.dispatchEvent(new Event('rpg:statsChanged'));
        setShowManualFallback(false);
        setManualCalories('');
        setFoodInput('');
        loadData();
      }}
    >
      {t('nutrify.confirm', 'Confirmar')}
    </button>
  </div>
)}
```

- [ ] **Step 4: Improve no-profile state**

At lines 135-139, inside the ELSE branch of the `isSetup ? ... : ...` ternary, replace the existing `<p className="qb-hand">` with:
```tsx
<div className="nutri-empty" style={{ textAlign: 'center', padding: 16 }}>
  <p style={{ color: 'var(--ink-faded)', fontStyle: 'italic', margin: 0 }}>
    {t('nutrify.setupRequired', 'Configurá tu perfil nutricional')}
  </p>
</div>
```

- [ ] **Step 5: Add i18n keys**

In `src/i18n/es.json` under `nutrify`:
```json
"manualEntry": "Entrada manual"
```

In `src/i18n/en.json` under `nutrify`:
```json
"manualEntry": "Manual entry"
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/nutrition/components/NutritionDashboardWidget.tsx src/i18n/es.json src/i18n/en.json
git commit -m "feat(nutrition): manual fallback on AI error + better no-profile state in widget"
```

---

### Task 16: Charts Empty States + Heatmap Touch (Items 7, 14)

**Files:**
- Modify: `src/modules/nutrition/components/NutritionCharts.tsx`
- Modify: `src/i18n/es.json`
- Modify: `src/i18n/en.json`

**Context:**
- Main empty state at lines 538-556: generic italic text
- Weight chart empty at lines 499-524: text below chart area
- Heatmap uses `HeatmapCalendar` shared component — touch support depends on its implementation. If it accepts an `onCellClick` prop, wire it up. Otherwise, note this for a separate shared component change.

- [ ] **Step 1: Improve main empty state**

At lines 538-556, replace the existing empty state (which uses `t('nutrify.startLogging')`) with a richer version. Remove the dead `startLogging` key from both i18n files later. Replace with:
```tsx
<div className="nutri-card medieval" style={{ textAlign: 'center', padding: '32px 24px' }}>
  <p style={{ color: 'var(--ink-faded)', fontStyle: 'italic', marginBottom: 16 }}>
    {t('nutrify.noChartData', 'Logueá tu primer día para ver los gráficos')}
  </p>
  <button className="rpg-button" onClick={() => navigate('/nutrition')}>
    {t('nutrify.goToToday', 'Ir a hoy')}
  </button>
</div>
```

Verify `navigate` is available (it's imported from react-router-dom at the top of NutritionCharts).

- [ ] **Step 2: Center weight empty state**

At lines 499-524, move the empty message inside the chart area to replace the chart (not below it):
```tsx
{lineData.length >= 2 ? (
  <TreasureLineChart ... />
) : (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
    <p style={{ opacity: 0.65, fontStyle: 'italic', textAlign: 'center', fontFamily: "'IM Fell English', serif", color: 'var(--ink-faded)' }}>
      {t('nutrify.needMoreWeights', 'Log at least 2 weight entries to see the trend')}
    </p>
  </div>
)}
```

- [ ] **Step 3: Check HeatmapCalendar for click support**

Read the HeatmapCalendar component in `src/shared/components/charts/` to see if it accepts `onCellClick` prop. If yes, wire it:
```tsx
<HeatmapCalendar
  data={heatmapData}
  startDate={heatmapStart}
  tooltips={heatmapTooltips}
  themed
  legend
  onCellClick={(index: number) => {/* toggle tooltip */}}
/>
```

If no `onCellClick` prop exists, skip touch tooltip for now — it requires modifying the shared component which is out of scope for this audit task. Add a comment: `// TODO: Add onCellClick to HeatmapCalendar for touch tooltip support`

- [ ] **Step 4: Add i18n keys**

In `src/i18n/es.json` under `nutrify`:
```json
"noChartData": "Logueá tu primer día para ver los gráficos",
"goToToday": "Ir a hoy"
```

In `src/i18n/en.json` under `nutrify`:
```json
"noChartData": "Log your first day to see the charts",
"goToToday": "Go to today"
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/nutrition/components/NutritionCharts.tsx src/i18n/es.json src/i18n/en.json
git commit -m "feat(nutrition): improved empty states in charts + centered weight placeholder"
```

---

## Execution Order

1. **Chunk 1 (Tasks 1-5)**: Backend — migration, soft deletes, sync, dedup. Foundation for everything else.
2. **Chunk 2 (Tasks 6-11)**: Today.tsx UI — can be done in parallel across tasks since they touch different JSX sections.
3. **Chunk 3 (Tasks 12-16)**: FoodLogItem, Widget, Charts — independent of each other.

## Verification

After all tasks complete:
- `npm test` — all tests pass (including new soft delete tests)
- Manual check: delete a food entry → verify it soft-deletes (deleted_at set, still in DB)
- Manual check: closed day badge appears on navigated closed days
- Manual check: weight button always visible
- Manual check: sticky footer shows on open day with food
- Manual check: "?" badge on meals without explicit type
- Manual check: action icons are 32px tappable
- Manual check: charts show empty state with action button
- Manual check: dashboard widget shows manual fallback on AI error
