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
- **NutritionSettings.tsx**: Same — date picker, show calculated age as label ("27 years"). Add `weight_check_day` dropdown selector (Monday-Sunday).
- **IPC handler `nutrition:saveProfile`**: Accept `dateOfBirth` string instead of `age`. Validate DOB is a valid date, not in the future, and not before 1900-01-01. Calculate age internally for BMR.
- **IPC handler `nutrition:getProfile`**: Return `dateOfBirth` string (from `date_of_birth` column) instead of `age`. Frontend computes display age via `getAgeFromDob()`.

### BMR Calculation

`calculateBMR` in `nutrition.ipc.ts` keeps its signature `(weight, height, age, sex)`. All callers derive `age` from DOB:

- **`recalcSummary`** (the critical caller): reads `profile.date_of_birth`, calls `getAgeFromDob()`, passes result to `calculateBMR`. Must NOT read `profile.age` anymore.
- **`saveProfile` handler**: same approach.

### Validation Changes

Replace age validation in `saveProfile`:
```ts
// Before
if (!Number.isFinite(profile.age) || profile.age < 1 || profile.age > 120) throw new Error('Invalid age');
// After
if (!profile.dateOfBirth || !/^\d{4}-\d{2}-\d{2}$/.test(profile.dateOfBirth)) throw new Error('Invalid date of birth format');
const dobDate = new Date(profile.dateOfBirth + 'T00:00:00');
if (isNaN(dobDate.getTime()) || dobDate > new Date() || dobDate.getFullYear() < 1900) throw new Error('Invalid date of birth');
```

---

## 2. Weekly Weight Check-in Popup

### Trigger Logic

On `Today.tsx` mount, **only when viewing today's date**, call `nutrition:shouldAskWeight` IPC handler which returns `{ shouldAsk: boolean; lastWeight?: number }`.

Backend logic:
1. Read `weight_check_day` from profile (1=Monday, 7=Sunday, default 1).
2. Get today's day of week using JS `getDay()` mapped to Monday=1 format: `const dow = d.getDay() || 7`.
3. Get the latest `nutrition_weekly_metrics` entry with a non-null `weight_kg`.
4. Determine if weight was already logged this week using `getMondayOfWeek()` from `shared/date-utils.ts` to compute the current week boundary.
5. If weight logged this week → `shouldAsk: false`.
6. If today is the configured day OR any day after it this week without a log → `shouldAsk: true`.
7. `lastWeight` returns the most recent weight for display as placeholder/reference.

Frontend adds a localStorage check using `todayDateString()` from `shared/date-utils.ts`: key `hubtify_weight_dismiss_date`. If it equals today's date string, don't show even if backend says `shouldAsk: true`. This avoids repeated prompts after "Ahora no" on the same day.

### Popup UI

RPG-styled modal dialog (follows existing confirmation dialog pattern):
- Title: i18n key `nutrify.weightCheckin.title` ("Registro semanal de peso")
- Shows last recorded weight as reference: `nutrify.weightCheckin.lastWeight`
- Number input for current weight (kg, step 0.1, range 30-300)
- "Guardar" button → saves and closes: `nutrify.weightCheckin.save`
- "Ahora no" link → sets localStorage dismiss date, closes: `nutrify.weightCheckin.later`

### Persistence

Weight saved via existing `nutrition:saveWeeklyMetrics` IPC handler. The popup omits the date parameter so the handler defaults to `getMondayOfWeek()` as the key — this ensures weight is always stored under the correct Monday.

After save, `saveWeeklyMetrics` must call `recalcSummary(db, todayDateString())` to trigger TDEE recalculation with the new weight. This is a change to the existing handler (currently it does NOT recalc).

### Configuration

New field `weight_check_day` in `nutrition_profile`:
- Type: INTEGER, range 1-7 (1=Monday, 7=Sunday)
- Default: 1 (set by ALTER TABLE DEFAULT, no separate backfill needed)
- Editable in NutritionSettings.tsx as a dropdown selector.
- Persisted via existing `nutrition:saveProfile` handler (add field).

---

## Files to Modify

### Schema & Backend
- `src/modules/nutrition/nutrition.schema.ts` — new migration (DOB + weight_check_day)
- `electron/modules/nutrition.ipc.ts` — new `shouldAskWeight` handler, modify `saveProfile` for DOB validation, modify `getProfile` to return `dateOfBirth`, update `recalcSummary` to derive age from DOB, add `recalcSummary` call to `saveWeeklyMetrics`
- `shared/date-utils.ts` — add `getAgeFromDob()`
- `shared/types.ts` — add `nutritionShouldAskWeight` to HubtifyApi with typed return `{ shouldAsk: boolean; lastWeight?: number }`
- `electron/preload.ts` — expose `nutritionShouldAskWeight` IPC channel

### Frontend
- `src/modules/nutrition/components/Today.tsx` — mount check (only when viewing today) + popup render
- `src/modules/nutrition/components/NutritionOnboarding.tsx` — age → DOB date picker
- `src/modules/nutrition/components/NutritionSettings.tsx` — age → DOB date picker + weight_check_day dropdown
- i18n translation files — new keys for popup UI

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
