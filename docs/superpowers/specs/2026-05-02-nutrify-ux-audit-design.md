# Nutrify UX Audit

**Date:** 2026-05-02
**Status:** Approved

## Problem

Comprehensive UX/UI audit of the Nutrify module. Issues found across data integrity, user journey, visual feedback, accessibility, and mobile usability. 15 items across Critical/High/Medium/Low priorities.

## Item 1 — Soft Deletes for food_log, favorite_foods, and frequent_foods (Critical)

### Problem

`food_log`, `favorite_foods`, and `frequent_foods` use hard DELETE. Multi-account sync cannot replicate deletions — ghost entries appear on other accounts after sync. All three tables are in `USER_DATA_TABLES`.

### Solution

#### Migration V9

```sql
ALTER TABLE food_log ADD COLUMN updated_at TEXT DEFAULT NULL;
ALTER TABLE food_log ADD COLUMN deleted_at TEXT DEFAULT NULL;
ALTER TABLE favorite_foods ADD COLUMN deleted_at TEXT DEFAULT NULL;
ALTER TABLE frequent_foods ADD COLUMN deleted_at TEXT DEFAULT NULL;
```

Note: `food_log` lacks `updated_at` (omitted from V7 migration that added it to other tables). Must add it alongside `deleted_at` for LWW sync. `favorite_foods` and `frequent_foods` already have `updated_at` from V7.

#### IPC Changes (nutrition.ipc.ts)

- `nutrition:deleteFood(id)`: Change from `DELETE FROM food_log WHERE id = ?` to `UPDATE food_log SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
- `nutrition:removeFavoriteFood(id)`: Same pattern — SET deleted_at, updated_at instead of DELETE
- `nutrition:deleteFrequentFood(id)`: Same pattern — SET deleted_at, updated_at instead of DELETE
- `nutrition:deleteByDate(date)`: Soft-delete all foods for that date (UPDATE SET deleted_at)

#### Query Changes (nutrition.ipc.ts)

Add `AND deleted_at IS NULL` (or `AND f.deleted_at IS NULL` for aliased joins) to ALL food_log, favorite_foods, and frequent_foods queries:
- `nutrition:getFoodByDate` — WHERE clause
- `nutrition:getSummary` / `recalcSummary()` — calorie sum query (the core summary calculation)
- `nutrition:getSummaryRange` — same
- `nutrition:getFrequentFoods` — WHERE clause
- `nutrition:getFavoriteFoods` — WHERE clause
- `nutrition:getTodayCalories` — WHERE clause
- `nutrition:getTodayMealsCount` — WHERE clause
- `nutrition:getWeekCalories` — WHERE clause (used by dashboard sparkline)
- `nutrition:updateFood` — add `AND deleted_at IS NULL` guard to prevent updating deleted entries
- `nutrition:getPendingDays` — filter deleted entries so days with only deleted foods don't show as pending
- `nutrition:logFood` — duplicate check (if any)

#### Sync Changes (sync.ipc.ts)

Explicit changes required in sync handlers:

1. `sync:getAllNutritionData`: Add `deleted_at` and `updated_at` to SELECT for `food_log`, `favorite_foods`, and `frequent_foods` so deleted records are included in sync payload
2. `sync:mergeNutritionData`: For all three tables, update merge logic to:
   - INSERT new records including `deleted_at` value (may be NULL or a timestamp)
   - UPDATE existing records when remote `updated_at` > local `updated_at` (LWW), including setting `deleted_at` when remote has it set
   - This follows the same pattern used by quests module for soft-deleted records

## Item 2 — Closed Day Badge on Date Pill (Critical)

### Problem

Navigating between days shows no visual indicator of which days are already closed. Users may attempt to close twice or skip days unknowingly.

### Solution

#### Today.tsx

When `dayClosed !== null`, add class `.nutri-date-pill--closed` to the date pill button. Render a small lock SVG icon (12×12) inside the pill, before the date text.

#### CSS (nutri.css)

```css
.nutri-date-pill--closed {
  border-color: var(--rpg-xp-green);
  opacity: 0.85;
}
.nutri-date-pill--closed .nutri-closed-ico {
  margin-right: 4px;
  opacity: 0.7;
}
```

## Item 3 — AI Estimation Fallback to Manual in Dashboard Widget (High)

### Problem

AI estimation failure in the dashboard widget shows toast "try full module" and leaves user stranded with no inline fallback.

Note: Today.tsx already auto-switches to manual mode on AI failure (line 225: `setManualMode(true)`). No change needed there.

### Solution

#### NutritionDashboardWidget.tsx

In the catch handler, instead of toast + dismiss, show inline manual calories input:
```typescript
catch {
  setEstimation(null);
  setShowManualFallback(true); // New state
}
```

New state `showManualFallback` renders: `<input type="number" placeholder="kcal">` + confirm button. On confirm, calls `nutritionLogFood` with manual source.

## Item 4 — Touch Targets and Action Contrast (High)

### Problem

Heart/edit/delete icons in FoodLogItem are ~12-16px with opacity 0.4. Hard to tap on mobile, may fail WCAG AA contrast.

### Solution

#### FoodLogItem.tsx + CSS (nutri.css)

The action icons (heart, edit, delete) live inside `.nutri-meal-del` (line 225 of FoodLogItem.tsx) with inline styles `opacity: 0.4`. Changes:

1. Move inline `opacity` styles from JSX `<span>`/`<svg>` elements to CSS class
2. Add wrapper class `.nutri-food-action` to each action icon span for consistent sizing

```css
.nutri-food-action {
  min-height: 32px;
  min-width: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.nutri-food-action svg {
  opacity: 0.6; /* was 0.4 inline */
}
.nutri-food-action:hover svg {
  opacity: 1;
}
```

Each action `<span>` in FoodLogItem gets `className="nutri-food-action"` and its inline `opacity` style is removed.

## Item 5 — Unresolved Meal Badge (High)

### Problem

When food is logged at an ambiguous time (e.g., 11:50 between breakfast and lunch), `meal` is null. No visual indicator — user doesn't know they need to pick.

### Solution

#### FoodLogItem.tsx

When `getMealForEntry()` returns a meal but `entry.meal === null` (i.e., meal was inferred, not explicitly set), show a small "?" badge on the meal icon:

```tsx
{!entry.meal && (
  <span className="nutri-meal-unresolved" title={t('nutrify.pickMeal', 'Elegí la comida')}>?</span>
)}
```

Click on the badge opens the existing meal picker dropdown.

#### CSS

```css
.nutri-meal-unresolved {
  background: var(--rpg-gold);
  color: var(--ink);
  border-radius: 50%;
  width: 16px;
  height: 16px;
  font-size: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  position: absolute;
  top: -4px;
  right: -4px;
}
```

## Item 6 — Weight Check-in Always Accessible (High)

### Problem

Weight popup shows once per week on configured day. If dismissed, no way to log weight until next week. localStorage key not account-specific.

### Solution

#### Today.tsx — Metrics Section

Add a "Registrar peso" button in the daily metrics area (near steps/gym). Always visible, not gated by day-of-week.

```tsx
<button className="rpg-button nutri-btn-ghost" onClick={() => setWeightPopup({ show: true, lastWeight: lastWeight })}>
  {t('nutrify.logWeight', 'Registrar peso')}
</button>
```

This reuses the existing weight popup modal — just provides an always-available trigger.

#### Account-Specific Dismiss Key

Change localStorage key from `hubtify_weight_dismiss_date` to `hubtify_weight_dismiss_date_${currentAccountId}`.

The current key stores `todayDateString()` to prevent repeated popups on the same day. The fix adds account scoping so multi-account users don't share dismiss state.

Get `currentAccountId` from the existing auth/account context (check how other components get it — likely `window.api.authGetCurrentUser()` or similar stored state).

## Item 7 — Informative Empty States (Medium)

### Problem

No food logged shows empty space. Charts without data show generic text. No motivation or call-to-action.

### Solution

#### Today.tsx — No Foods

When `foods.length === 0 && !dayClosed`, show:
```tsx
<div className="nutri-empty">
  <Platter width={32} height={32} />
  <p>{t('nutrify.noFoodToday', 'No hay comidas registradas. Describí lo que comiste arriba o usá un favorito.')}</p>
</div>
```

#### NutritionCharts.tsx — No Data

When `summaries.length === 0`, show centered message with action button:
```tsx
<div className="nutri-empty">
  <p>{t('nutrify.noChartData', 'Logueá tu primer día para ver los gráficos')}</p>
  <button className="rpg-button" onClick={() => navigate('/nutrition')}>{t('nutrify.goToToday', 'Ir a hoy')}</button>
</div>
```

#### Weight Chart — Less Than 2 Points

Move the "Log at least 2 weights" message from below the chart to centered inside the chart area as a placeholder.

## Item 8 — Close Day Sticky Footer (Medium)

### Problem

"Confirmar Día" button is at the bottom of a long page. On mobile, requires extensive scrolling. Easy to forget.

### Solution

#### Today.tsx

When `!dayClosed && foods.length > 0`, render a sticky footer bar:

```tsx
{!dayClosed && foods.length > 0 && (
  <div className="nutri-sticky-footer">
    <button className="rpg-button nutri-close-day-btn" onClick={() => setCloseDayPopup(true)}>
      {t('nutrify.confirmDay', 'Confirmar Día')}
    </button>
  </div>
)}
```

#### CSS

```css
.nutri-sticky-footer {
  position: sticky;
  bottom: 0;
  z-index: 10;
  padding: 12px 16px;
  background: linear-gradient(transparent, var(--rpg-parchment) 20%);
  text-align: center;
}
```

Pattern matches `.coin-quick-add-form` sticky behavior in Finance module.

## Item 9 — Frequent Foods Case-Insensitive Dedup (Medium)

### Problem

"Milanesa", "milanesa", "MILANESA" create separate frequent food entries.

### Solution

#### nutrition.ipc.ts

**Important**: `frequent_foods.name` has NO UNIQUE constraint. Need to add one first.

#### Migration (part of V9)

Add case-insensitive unique index:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_frequent_foods_name ON frequent_foods(name COLLATE NOCASE);
```

This may fail if duplicates already exist. Before creating the index, deduplicate:
```sql
DELETE FROM frequent_foods WHERE rowid NOT IN (
  SELECT MIN(rowid) FROM frequent_foods GROUP BY name COLLATE NOCASE
);
```

#### IPC Changes

In `nutrition:createFrequentFood`: Normalize name and use INSERT OR IGNORE (now works with the UNIQUE index):
```typescript
const normalizedName = name.trim();
db.prepare('INSERT OR IGNORE INTO frequent_foods (name, calories, times_used, created_at) VALUES (?, ?, 1, datetime("now"))').run(normalizedName, calories);
```

In `nutrition:incrementFrequentUsage` and lookup queries: Use `COLLATE NOCASE`:
```sql
WHERE name = ? COLLATE NOCASE
```

## Item 10 — TDEE Transparency (Medium)

### Problem

TDEE adjusts dynamically (40% base activity + 60% recent gym/steps history) but user only sees a number. No explanation of why target changes day to day.

### Solution

#### Today.tsx — Target Row

Add HelpBubble next to the target display:
```tsx
<HelpBubble text={t('nutrify.targetHelp', 'Tu objetivo se ajusta según tu nivel de actividad base y tu actividad reciente (gym, pasos) de los últimos 14 días.')} />
```

#### NutritionSettings.tsx — Already Implemented

The BMR × multiplier breakdown is already displayed in NutritionSettings (lines 209-211) as `BMR {bmr} × {multiplier} actividad`. No change needed here.

## Item 11 — XP/HP Breakdown Labels in Close Day (Medium)

### Problem

Close day modal shows numbers (xpPrecision: 25, xpSteps: 5) without explaining what they mean.

### Solution

#### Today.tsx — Close Day Result Card

Change the breakdown display from bare numbers to labeled rows:

| Current | Proposed |
|---------|----------|
| Precisión: 25 XP | Precisión (cercanía al objetivo): 25 XP |
| Pasos: 5 XP | Actividad (pasos): 5 XP |
| Gym: 5 XP | Entrenamiento (gym): 5 XP |
| Peso: 5 XP | Registro de peso: 5 XP |
| Bonus: 10 XP | Bonus (excelente precisión): 10 XP |
| HP: +10 | HP: +10 (dentro del objetivo) |

Existing i18n keys already exist: `nutrify.xpPrecision` ("Precisión calórica"), `nutrify.xpSteps` ("Pasos"), `nutrify.xpGym` ("Gimnasio"), `nutrify.xpWeight` ("Peso registrado"), `nutrify.xpBonus` ("Bonus precisión"). Update their VALUES to include the descriptive context (e.g., "Precisión calórica" → "Precisión (cercanía al objetivo)"). Add one new key: `nutrify.hpExplanation` for the HP tooltip.

HP row gets color: green for positive, red for negative. Add tooltip via HelpBubble explaining the HP rule for the user's current goal type.

## Item 12 — Hardcoded Meal Labels in FoodLogItem (Low)

### Problem

`MEAL_LABELS` in FoodLogItem.tsx has Spanish strings hardcoded: `'Desayuno'`, `'Almuerzo'`, etc. Doesn't use i18n.

### Solution

#### FoodLogItem.tsx

Replace `MEAL_LABELS` constant with a function that uses `t()`:

```typescript
function getMealLabel(meal: MealType, t: TFunction): string {
  const labels: Record<MealType, string> = {
    breakfast: t('nutrify.mealBreakfast', 'Desayuno'),
    lunch: t('nutrify.mealLunch', 'Almuerzo'),
    dinner: t('nutrify.mealDinner', 'Cena'),
    snack: t('nutrify.mealSnack', 'Snack'),
  };
  return labels[meal];
}
```

Keys already exist in es.json and en.json.

## Item 13 — Dashboard Widget: No-Profile State + Error Fallback (Low)

### Problem

Widget shows ring gauge with target=2000 when no profile exists. AI estimation error shows unhelpful toast.

### Solution

#### NutritionDashboardWidget.tsx — No Profile

When `target === null` (no profile), render setup prompt instead of ring:

```tsx
{target === null ? (
  <div className="nutri-empty">
    <p>{t('nutrify.setupRequired', 'Configurá tu perfil nutricional')}</p>
  </div>
) : (
  /* existing ring gauge */
)}
```

#### Error Fallback

Same as Item 3 — show inline manual input on AI error instead of toast.

## Item 14 — Heatmap Touch Tooltips (Low)

### Problem

Heatmap calendar tooltips only show on hover. Touch devices can't hover.

### Solution

#### NutritionCharts.tsx

Add `onClick` to heatmap cells that toggles a selected state:

```typescript
const [activeHeatmapDate, setActiveHeatmapDate] = useState<string | null>(null);
```

On cell click: `setActiveHeatmapDate(date === activeHeatmapDate ? null : date)`. When `activeHeatmapDate === date`, show tooltip permanently (not just on hover).

Click outside (on the chart container) resets to null.

## Item 15 — Streak Tolerance Documentation (Low)

### Problem

Streak uses 10% tolerance. XP precision uses 5%/15%/30%. No documentation of why they differ.

### Solution

#### nutrition.ipc.ts — getStreak Handler

Add comment block:
```typescript
// Streak tolerance: ±10% of daily target
// This matches the HP system's "on target" threshold (±10% → +10 HP).
// XP precision uses finer gradations (5%/15%/30%) for reward scaling,
// but streak is binary (on/off) so the ±10% HP band is the right match.
```

No functional change — documentation only.

## Files Modified

| File | Items |
|------|-------|
| `src/modules/nutrition/nutrition.schema.ts` | 1 (migration V9), 9 (unique index) |
| `electron/modules/nutrition.ipc.ts` | 1, 9, 15 |
| `electron/modules/sync.ipc.ts` | 1 |
| `src/modules/nutrition/components/Today.tsx` | 2, 6, 7, 8, 10, 11 |
| `src/modules/nutrition/components/FoodLogItem.tsx` | 4, 5, 12 |
| `src/modules/nutrition/components/NutritionDashboardWidget.tsx` | 3, 13 |
| `src/modules/nutrition/components/NutritionCharts.tsx` | 7, 14 |
| `src/modules/nutrition/styles/nutri.css` | 2, 4, 5, 7, 8 |
| `src/i18n/es.json` | 5, 6, 7, 10, 11, 12 |
| `src/i18n/en.json` | 5, 6, 7, 10, 11, 12 |

## Not Changed

- Nutrition onboarding flow (working well)
- RPG event handlers (XP/HP formulas unchanged)
- AI estimation service (external Cloud Function)
- Meal schedule editor (functional, minor issues deferred)
- DB schema beyond soft delete migration

## Testing

- Soft delete: food deletion sets deleted_at, queries exclude deleted rows, sync includes deleted records
- Closed day badge: appears on navigating to closed day, disappears on open day
- AI fallback: mock estimation failure → manual mode auto-activates
- Touch targets: verify 32px minimum tappable area
- Meal badge: shows "?" when meal is null, click opens picker
- Weight button: always visible in metrics, opens popup, account-specific dismiss
- Empty states: render when no data, action buttons navigate correctly
- Sticky footer: appears when foods > 0 and day open, hides when closed
- Frequent dedup: case variations match same entry
- Heatmap: click toggles tooltip on touch
