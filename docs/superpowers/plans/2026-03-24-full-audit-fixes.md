# Full Audit Fixes — Questify + Nutrify

> **For agentic workers:** Each issue has a checkbox. When you complete a fix, mark it `[x]` and add a **Resolution** block below with: what changed, which files, and what to watch out for. This helps subsequent agents avoid breaking your work.

**Goal:** Fix all critical/high issues found in the March 24 2026 audit of Questify and Nutrify modules.

**Architecture:** Electron + React app with better-sqlite3 DB, IPC handlers in `electron/modules/`, frontend in `src/modules/`, shared types in `shared/types.ts`. Vitest for tests.

**Key files:**
- DB setup: `electron/ipc/db.ts`
- Quest IPC: `electron/modules/quests.ipc.ts` (423 lines)
- Quest schema: `src/modules/quests/quests.schema.ts`
- Sync IPC: `electron/modules/sync.ipc.ts`
- Nutrition IPC: `electron/modules/nutrition.ipc.ts` (480 lines)
- Nutrition schema: `src/modules/nutrition/nutrition.schema.ts`
- Ollama AI: `electron/modules/nutrition/ollama.ts`
- AI estimator: `electron/modules/nutrition/estimator.ts`
- Shared types: `shared/types.ts`
- Quest frontend: `src/modules/quests/components/` (TaskList 549 lines, HabitTracker, SubtaskList, etc.)
- Nutrition frontend: `src/modules/nutrition/components/` (Today 505 lines, etc.)

---

## Batch 1 — Data Integrity (CRITICAL)

### Q-DATA-1: Fix `IS ?` NULL comparison in sync

- [x] **Fix NULL handling in category sync**

> **Resolution:** Split `project_id IS ?` into two prepared statements: `getCategoryNoProject` (uses `IS NULL`) and `getCategoryWithProject` (uses `= ?`). Same for UPDATE. Files: `sync.ipc.ts`.

**File:** `electron/modules/sync.ipc.ts:215,222`

**Problem:** `WHERE name = ? AND project_id IS ?` — SQLite `IS ?` doesn't work as expected with parameterized NULL. When `projectId` is null, query returns wrong results, corrupting category sync.

**Fix:** Split into two query paths based on whether projectId is null:
```typescript
// When projectId is null:
'SELECT name, updated_at FROM task_categories WHERE name = ? AND project_id IS NULL'
// When projectId is not null:
'SELECT name, updated_at FROM task_categories WHERE name = ? AND project_id = ?'
```

Apply same pattern to the UPDATE and INSERT statements for categories in the merge function.

**Test:** Verify categories with `project_id = NULL` sync correctly between devices.

---

### Q-DATA-2: Wrap soft-delete in transaction

- [x] **Add transaction to `quests:deleteTasks`**

> **Resolution:** Wrapped subtasks + tasks soft-delete in `db.transaction()`. File: `quests.ipc.ts`.

**File:** `electron/modules/quests.ipc.ts:60-70`

**Problem:** Soft-deletes subtasks then tasks in separate statements. If second fails, subtasks marked deleted but tasks aren't.

**Fix:** Wrap in `db.transaction()`:
```typescript
const deleteTx = db.transaction((ids: string[], now: string) => {
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`UPDATE subtasks SET deleted_at = ?, updated_at = ? WHERE task_id IN (${placeholders}) AND deleted_at IS NULL`).run(now, now, ...ids);
  db.prepare(`UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id IN (${placeholders})`).run(now, now, ...ids);
});
deleteTx(ids, new Date().toISOString());
```

---

### Q-DATA-3: Wrap checkHabit in transaction

- [x] **Fix race condition in `quests:checkHabit`**

> **Resolution:** Wrapped SELECT+INSERT/UPDATE in `db.transaction()`. File: `quests.ipc.ts`.

**File:** `electron/modules/quests.ipc.ts:402-422`

**Problem:** SELECT then INSERT/UPDATE without transaction — concurrent calls can cause UNIQUE constraint violation.

**Fix:** Wrap the entire check/uncheck/insert logic in `db.transaction()`.

---

### Q-DATA-4: Fix duplicate deleted_at condition

- [x] **Remove duplicate `AND deleted_at IS NULL`**

> **Resolution:** Removed duplicate condition at line 304. File: `quests.ipc.ts`.

**File:** `electron/modules/quests.ipc.ts:301`

**Problem:** `AND deleted_at IS NULL AND deleted_at IS NULL` — copy-paste error.

**Fix:** Remove the duplicate condition.

---

### N-DATA-1: Add input validation to nutrition handlers

- [x] **Validate calories, profile, steps, weight**

> **Resolution:** Added validation to 5 handlers: logFood (calories positive), saveProfile (age 1-120, height 50-250, weight 10-500, deficit 0-2000), saveDailyMetrics (steps>=0), saveWeeklyMetrics (weight>0), updateFood (calories>0). File: `nutrition.ipc.ts`.

**File:** `electron/modules/nutrition.ipc.ts`

**Handlers to validate:**
- `nutrition:logFood` (line 61): calories must be positive integer
- `nutrition:saveProfile` (line 42): age 1-120, height 50-250cm, weight 10-500kg, deficitTargetKcal 0-2000
- `nutrition:saveDailyMetrics` (line 140): steps >= 0
- `nutrition:saveWeeklyMetrics` (line 150): weight_kg > 0
- `nutrition:updateFood` (line 92): calories > 0 if provided

**Pattern:** Add validation at top of each handler, throw descriptive error if invalid.

---

### N-DATA-2: Wrap closeDay in transaction

- [x] **Fix race condition in nutrition:closeDay**

> **Resolution:** Wrapped entire handler body in `db.transaction()`. File: `nutrition.ipc.ts`.

**File:** `electron/modules/nutrition.ipc.ts:280-371`

**Problem:** Check-then-insert without lock — two concurrent closeDay calls can both pass the check and double-insert.

**Fix:** Wrap entire handler body in `db.transaction()`. The INSERT will fail on PRIMARY KEY if racing, and the transaction ensures atomicity.

---

### N-DATA-3: Wrap logFood+recalcSummary in transaction

- [x] **Add transaction to nutrition:logFood, deleteFood, updateFood**

> **Resolution:** Wrapped DB write + recalcSummary in `db.transaction()` for all three handlers. File: `nutrition.ipc.ts`.

**File:** `electron/modules/nutrition.ipc.ts:61-73, 85-89, 92-103`

**Problem:** INSERT into food_log and recalcSummary are separate — if recalcSummary crashes, summary is out of sync.

**Fix:** Wrap each handler's DB operations + recalcSummary in a single transaction.

---

### N-DATA-4: Clamp BMR to valid range

- [x] **Add range validation to calculateBMR**

> **Resolution:** Added `Math.max(800, Math.min(3500, result))` clamp. File: `nutrition.ipc.ts`.

**File:** `electron/modules/nutrition.ipc.ts:459-462`

**Problem:** If weight/height/age are extreme (even after validation), BMR can be nonsensical.

**Fix:** After calculation, clamp: `return Math.max(800, Math.min(3500, bmr));`

---

## Batch 2 — Sync Critical

### Q-SYNC-1: Add drawings to sync

- [x] **Include task_drawings in getAllQuestData and mergeQuestData**

> **Resolution:** Added `SyncDrawing` interface, drawings SELECT in getAllQuestData, insert-if-not-exists merge in mergeQuestData. sync.ts passes payload through automatically. File: `sync.ipc.ts`.

**File:** `electron/modules/sync.ipc.ts`

**Problem:** `task_drawings` table is completely missing from sync. Users lose all drawings on cross-device sync.

**Fix in `getAllQuestData`:** Add query:
```typescript
const drawings = db.prepare(`
  SELECT id, task_id AS taskId, data, draw_order AS "order", created_at AS createdAt
  FROM task_drawings
`).all();
```
Return drawings in the result object.

**Fix in `mergeQuestData`:** Add merge section for drawings using same LWW pattern as other entities. Key by `id`, compare `createdAt` for conflict resolution (drawings are immutable — just INSERT if not exists).

**Also update:** `src/shared/sync.ts` to include drawings in push payload.

---

### Q-SYNC-2: Add updated_at to projects

- [x] **Add migration v7 with updated_at for projects**

> **Resolution:** Migration v7 adds `updated_at` column to projects (backfilled from created_at) + 4 composite indexes. upsertProject/deleteProject/syncProjectOrders now set updated_at. Sync merge uses proper timestamp comparison. Files: `quests.schema.ts`, `quests.ipc.ts`, `sync.ipc.ts`.

**File:** `src/modules/quests/quests.schema.ts`

**Add new migration:**
```typescript
{
  namespace: 'quests',
  version: 7,
  up: `
    ALTER TABLE projects ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
    UPDATE projects SET updated_at = created_at WHERE updated_at = '';
  `,
}
```

**Also update:** `quests.ipc.ts` — set `updated_at` in `quests:upsertProject` handler.
**Also update:** `sync.ipc.ts` — use `updated_at` for project conflict resolution instead of always-overwrite.

---

## Batch 3 — Performance

### Q-PERF-1: Fix N+1 in habits (300+ queries → 1 batch)

- [x] **Batch-load habit checks instead of per-habit per-day queries**

> **Resolution:** Replaced per-habit per-day DB queries with 2 total queries: 1 for habits, 1 for ALL habit_checks. Checks grouped into `Map<habit_id, Set<date>>` in memory. Streak/period/today calculated with Set.has(). O(N*streak) → O(2). File: `quests.ipc.ts`.

**File:** `electron/modules/quests.ipc.ts:290-385`

**Problem:** For each habit, queries DB per day to calculate streak. 10 habits × 30 days = 300+ queries.

**Fix:**
1. Load ALL habit_checks in one query: `SELECT habit_id, date FROM habit_checks WHERE deleted_at IS NULL`
2. Group in-memory by habit_id
3. Calculate streaks, period counts, and today-check in JavaScript using the grouped data

This should replace the entire habits handler loop.

---

### Q-PERF-2: Fix N+1 in drawing counts

- [x] **Add batch drawing count IPC handler**

> **Resolution:** Added `quests:getAllDrawingCounts` handler (GROUP BY query). Registered in preload.ts, added to types.ts. TaskList.tsx now uses single call instead of N parallel calls. Files: `quests.ipc.ts`, `preload.ts`, `shared/types.ts`, `TaskList.tsx`.

**Files:**
- `electron/modules/quests.ipc.ts` — add new handler `quests:getAllDrawingCounts`
- `shared/types.ts` — add to API interface
- `src/modules/quests/components/TaskList.tsx:61-63` — use new batch handler

**New handler:**
```typescript
ipcMain.handle('quests:getAllDrawingCounts', () => {
  const db = getDb();
  return db.prepare('SELECT task_id, COUNT(*) as count FROM task_drawings GROUP BY task_id').all();
});
```

**Frontend change:** Replace `Promise.all(taskList.map(t => window.api.questsGetDrawingCount(t.id)))` with single call.

---

### Q-PERF-3: Add missing indexes

- [x] **Add indexes for common query patterns**

> **Resolution:** 4 indexes added in migration v7: `idx_tasks_project_deleted`, `idx_subtasks_task_deleted`, `idx_categories_name_project`, `idx_drawings_task`. File: `quests.schema.ts`.

**File:** `src/modules/quests/quests.schema.ts` — add to migration v7 (or create v8)

```sql
CREATE INDEX IF NOT EXISTS idx_tasks_project_deleted ON tasks(project_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_subtasks_task_deleted ON subtasks(task_id, deleted_at, subtask_order);
CREATE INDEX IF NOT EXISTS idx_categories_name_project ON task_categories(name, project_id);
CREATE INDEX IF NOT EXISTS idx_drawings_task ON task_drawings(task_id, draw_order);
```

---

## Batch 4 — Error Handling

### Q-ERR-1: Add error handling to quest IPC handlers

- [x] **Wrap all quest IPC handlers in try-catch**

> **Resolution:** All 29 handlers wrapped with try-catch, console.error with `[quests:handlerName]` prefix, re-throw. File: `quests.ipc.ts`.

**File:** `electron/modules/quests.ipc.ts`

**Pattern:** Wrap each `ipcMain.handle` callback body in try-catch that logs the error and re-throws with a user-friendly message. This prevents silent failures.

```typescript
ipcMain.handle('quests:upsertTask', (_e, task) => {
  try {
    // ... existing code
  } catch (err) {
    console.error('[quests:upsertTask]', err);
    throw err;
  }
});
```

---

### N-ERR-1: Add error handling to nutrition IPC handlers

- [x] **Wrap all nutrition IPC handlers in try-catch**

> **Resolution:** All 26 handlers wrapped. learnFood/isDayClosed existing catches updated to consistent `[nutrition:handlerName]` format. File: `nutrition.ipc.ts`.

**File:** `electron/modules/nutrition.ipc.ts`

Same pattern as Q-ERR-1. Every handler gets try-catch with logging.

---

## Batch 5 — AI / Ollama

### N-AI-1: Improve system prompt

- [x] **Replace minimal prompt with structured JSON-output prompt**

> **Resolution:** Replaced single-line prompt with detailed JSON format spec, Argentine portions, strict output rules. File: `ollama.ts`.

**File:** `electron/modules/nutrition/ollama.ts:189`

**Current:** `'Estimá las calorías de esta comida'`

**Replace with:**
```typescript
const SYSTEM_PROMPT = `Sos un estimador preciso de calorías. Respondé SOLO con JSON válido.

Formato EXACTO:
{"calories": <número 10-5000>, "breakdown": "<descripción de ingredientes y calorías aprox>"}

Reglas:
- Estimá porciones típicas argentinas
- Redondeá hacia arriba si hay duda
- breakdown: "ingrediente1 ~Xkcal + ingrediente2 ~Ykcal"
- SOLO JSON, sin texto adicional`;
```

---

### N-AI-2: Increase Ollama inactivity timeout

- [x] **Change timeout from 15s to 5 minutes**

> **Resolution:** Changed `INACTIVITY_TIMEOUT_MS` from `15 * 1000` to `5 * 60 * 1000`. File: `ollama.ts`.

**File:** `electron/modules/nutrition/ollama.ts:10`

**Change:** `const INACTIVITY_TIMEOUT_MS = 15 * 1000;` → `const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;`

---

### N-AI-3: Add input sanitization

- [x] **Validate and sanitize AI input**

> **Resolution:** Added `sanitizeDescription()` — strips control chars, collapses whitespace, caps 500 chars. Called at start of `estimateWithAi`. File: `ollama.ts`.

**File:** `electron/modules/nutrition/ollama.ts` (before the fetch call ~line 201)

**Add:**
```typescript
function sanitizeDescription(input: string): string | null {
  if (!input || typeof input !== 'string') return null;
  let s = input.trim().replace(/[\x00-\x1F\x7F]/g, '').replace(/\s+/g, ' ');
  if (s.length > 500) s = s.slice(0, 500);
  return s || null;
}
```

Call before sending to model. Return null result if sanitization fails.

---

### N-AI-4: Add estimation caching

- [x] **Cache AI estimation results for 24h**

> **Resolution:** Added in-memory `estimationCache` (Map, 24h TTL, max 500 entries). Checks cache before Ollama call, stores on success. File: `ollama.ts`.

**File:** `electron/modules/nutrition/ollama.ts`

**Add:** In-memory Map with lowercase-trimmed key, 24h TTL, max 500 entries. Check cache before calling model, store on success.

---

### N-AI-5: Fix learnFood averaging

- [x] **Average calories instead of overwriting in learnFood**

> **Resolution:** Now SELECTs existing calories, computes `avg = Math.round((existing + new) / 2)`, uses avg in UPDATE. File: `nutrition.ipc.ts`.

**File:** `electron/modules/nutrition.ipc.ts:246-267`

**Problem:** `UPDATE food_database SET calories = ?` overwrites. Last entry wins.

**Fix:** Weighted average:
```typescript
// If existing entry found:
const existing = db.prepare('SELECT calories FROM food_database WHERE keywords = ?').get(keywords);
if (existing) {
  const avg = Math.round((existing.calories + caloriesPerUnit) / 2);
  db.prepare('UPDATE food_database SET calories = ? WHERE keywords = ?').run(avg, keywords);
}
```

---

## Batch 6 — Type Safety (shared/types.ts)

### TYPES-1: Type quest IPC returns

- [ ] **Replace `unknown[]` with proper types in quest API**

**Files:**
- `shared/types.ts:59-87` — replace `Promise<unknown[]>` with typed returns
- `src/modules/quests/types.ts` — export interfaces (Task, Subtask, Project, HabitWithStreak, Drawing)

**Changes in shared/types.ts:**
```typescript
import type { Task, Subtask, Project, HabitWithStreak, Drawing } from '../src/modules/quests/types';

questsGetTasks: (projectId?: string | null) => Promise<Task[]>;
questsGetSubtasks: (taskId: string) => Promise<Subtask[]>;
questsGetHabits: () => Promise<HabitWithStreak[]>;
questsGetDrawings: (taskId: string) => Promise<Drawing[]>;
questsGetProjects: () => Promise<Project[]>;
```

Remove all `as Task[]`, `as Subtask[]` casts from frontend components.

---

### TYPES-2: Type nutrition IPC returns

- [ ] **Replace `unknown` with proper types in nutrition API**

**Files:**
- `shared/types.ts:89-114` — replace `Promise<unknown>` with typed returns
- `src/modules/nutrition/types.ts` — export interfaces (NutritionProfile, FoodLogEntry, DailySummary, etc.)

Remove all `as Record<string, unknown>` casts from frontend and backend.

---

## Completed Fixes Log

_As each issue is resolved, move it here with a resolution summary._

---
