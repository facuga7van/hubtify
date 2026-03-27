# Nutrify: Weekly Weight Check-in & DOB Migration

## Summary

Two changes to the Nutrify module:
1. **Migrate `age` to `date_of_birth`** in the nutrition profile, calculate age at runtime.
2. **Weekly weight check-in popup** that prompts the user to log their weight on a configurable day.

No weight chart in this scope — data is stored for future use.

---

## 1. DOB Migration

### Schema

New migration adds `date_of_birth TEXT` and `weight_check_day INTEGER DEFAULT 1` to `nutrition_profile`.

Backfill: `date_of_birth = (current_year - age) || '-01-01'` as approximation. User can correct in settings.

Column `age` remains in the table (SQLite limitation) but is no longer read.

### Runtime Age Calculation

New function in `shared/date-utils.ts`:

```ts
export function getAgeFromDob(dob: string): number {
  const birth = new Date(dob + 'T00:00:00');
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}
```

### UI Changes

- **NutritionOnboarding.tsx**: Replace age number input with date picker for date of birth.
- **NutritionSettings.tsx**: Same — date picker, show calculated age as label ("27 years").
- **IPC handler `nutrition:saveProfile`**: Accept `dateOfBirth` string instead of `age`. Calculate age internally for BMR.

### BMR Calculation

`calculateBMR` in `nutrition.ipc.ts` currently receives `age` as parameter. After migration, callers compute age from DOB via `getAgeFromDob()` before passing to `calculateBMR`. The function signature stays the same.

---

## 2. Weekly Weight Check-in Popup

### Trigger Logic

On `Today.tsx` mount, call `nutrition:shouldAskWeight` IPC handler which returns `{ shouldAsk: boolean, lastWeight?: number }`.

Backend logic:
1. Read `weight_check_day` from profile (1=Monday, 7=Sunday, default 1).
2. Get today's day of week (1-7, Monday=1).
3. Get the latest `nutrition_weekly_metrics` entry with a non-null `weight_kg`.
4. Determine if weight was already logged this week (same Monday-start week).
5. If weight logged this week → `shouldAsk: false`.
6. If today is the configured day OR any day after it this week without a log → `shouldAsk: true`.
7. `lastWeight` returns the most recent weight for display as placeholder/reference.

Frontend adds a localStorage check: `hubtify_weight_dismiss_date`. If it equals today's date string, don't show even if backend says `shouldAsk: true`. This avoids repeated prompts after "Ahora no" on the same day.

### Popup UI

RPG-styled modal dialog (follows existing confirmation dialog pattern):
- Title: "Registro semanal de peso" (i18n)
- Shows last recorded weight as reference
- Number input for current weight (kg, step 0.1, range 30-300)
- "Guardar" button → saves and closes
- "Ahora no" link → sets localStorage dismiss date, closes

### Persistence

Weight saved via existing `nutrition:saveWeeklyMetrics` IPC handler to `nutrition_weekly_metrics` table (already has `weight_kg` column, keyed by Monday date).

After save:
- Call `recalcSummary` for today (TDEE recalculation picks up new weight automatically).
- Dismiss popup.

### Configuration

New field `weight_check_day` in `nutrition_profile`:
- Type: INTEGER, range 1-7 (1=Monday, 7=Sunday)
- Default: 1
- Editable in NutritionSettings.tsx as a dropdown selector.
- Persisted via existing `nutrition:saveProfile` handler (add field).

---

## Files to Modify

### Schema & Backend
- `src/modules/nutrition/nutrition.schema.ts` — new migration (DOB + weight_check_day)
- `electron/modules/nutrition.ipc.ts` — new `shouldAskWeight` handler, modify `saveProfile` for DOB, age calculation from DOB in `recalcSummary`
- `shared/date-utils.ts` — add `getAgeFromDob()`
- `shared/types.ts` — add `shouldAskWeight` to HubtifyApi
- `electron/preload.ts` — expose new IPC channel

### Frontend
- `src/modules/nutrition/components/Today.tsx` — mount check + popup render
- `src/modules/nutrition/components/NutritionOnboarding.tsx` — age → DOB picker
- `src/modules/nutrition/components/NutritionSettings.tsx` — age → DOB picker, add weight_check_day selector

### Not Modified
- `NutritionCharts.tsx` — no chart changes in this scope
- `nutrition_weekly_metrics` table — already has `weight_kg`, no schema change needed
- `nutrition_daily_summary` — TDEE recalc already uses latest weight from weekly metrics

---

## Out of Scope

- Weight progress chart (future — data stored now for later)
- Waist circumference tracking
- BMI calculation display
- Goal adjustment suggestions based on weight trend
