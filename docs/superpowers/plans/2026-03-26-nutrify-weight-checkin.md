# Nutrify Weight Check-in & DOB Migration — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a weekly weight check-in popup to Nutrify and migrate the profile from `age` to `date_of_birth`.

**Architecture:** New migration adds DOB and weight_check_day columns. Age is derived at runtime via `getAgeFromDob()`. Weight popup triggers on Today.tsx mount when the configured day has passed without a log. Weight persists to existing `nutrition_weekly_metrics` table.

**Tech Stack:** Electron + React + better-sqlite3 + i18n (react-i18next)

**Spec:** `docs/superpowers/specs/2026-03-26-nutrify-weight-checkin-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `shared/date-utils.ts` | Add `getAgeFromDob()` |
| Modify | `src/modules/nutrition/nutrition.schema.ts` | Migration v3: DOB + weight_check_day |
| Modify | `electron/modules/nutrition.ipc.ts` | Update getProfile, saveProfile, recalcSummary, saveWeeklyMetrics; add shouldAskWeight |
| Modify | `shared/types.ts` | Add `nutritionShouldAskWeight` to HubtifyApi |
| Modify | `electron/preload.ts` | Expose new IPC channel |
| Modify | `src/modules/nutrition/components/Today.tsx` | Weight check-in popup on mount |
| Modify | `src/modules/nutrition/components/NutritionOnboarding.tsx` | Age → DOB date picker |
| Modify | `src/modules/nutrition/components/NutritionSettings.tsx` | Age → DOB picker + weight_check_day dropdown |
| Modify | `src/i18n/es.json` | New i18n keys |
| Modify | `src/i18n/en.json` | New i18n keys |

---

## Chunk 1: Backend — DOB Migration & Age Calculation

### Task 1: Add `getAgeFromDob` to date-utils

**Files:**
- Modify: `shared/date-utils.ts` (after line 19)

- [ ] **Step 1: Add the function**

Append to `shared/date-utils.ts`:

```ts
/** Calculates age in years from a YYYY-MM-DD date of birth string */
export function getAgeFromDob(dob: string): number {
  const birth = new Date(dob + 'T00:00:00');
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add shared/date-utils.ts
git commit -m "feat(nutrify): add getAgeFromDob to date-utils"
```

---

### Task 2: Schema migration v3 — DOB + weight_check_day

**Files:**
- Modify: `src/modules/nutrition/nutrition.schema.ts` (after line 88, the end of migration v2)

- [ ] **Step 1: Add migration v3**

Add to the `nutritionMigrations` array:

```ts
{
  namespace: 'nutrition',
  version: 3,
  up: `
    ALTER TABLE nutrition_profile ADD COLUMN date_of_birth TEXT DEFAULT NULL;
    ALTER TABLE nutrition_profile ADD COLUMN weight_check_day INTEGER NOT NULL DEFAULT 1;

    UPDATE nutrition_profile SET date_of_birth = (
      CAST(strftime('%Y', 'now') AS INTEGER) - age
    ) || '-01-01' WHERE date_of_birth IS NULL;
  `,
},
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/modules/nutrition/nutrition.schema.ts
git commit -m "feat(nutrify): migration v3 — date_of_birth and weight_check_day columns"
```

---

### Task 3: Update `getProfile` to return DOB

**Files:**
- Modify: `electron/modules/nutrition.ipc.ts` (lines 32-42, the getProfile handler)

- [ ] **Step 1: Update the handler return**

In the `nutrition:getProfile` handler, change the return object. Replace `age: row.age` with `dateOfBirth: row.date_of_birth`. Also add `weightCheckDay`:

```ts
ipcHandle('nutrition:getProfile', () => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM nutrition_profile WHERE id = 1').get() as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    dateOfBirth: row.date_of_birth, sex: row.sex, heightCm: row.height_cm,
    initialWeightKg: row.initial_weight_kg, activityLevel: row.activity_level,
    deficitTargetKcal: row.deficit_target_kcal, gymCalories: row.gym_calories,
    stepCaloriesFactor: row.step_calories_factor, weightCheckDay: row.weight_check_day,
  };
});
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add electron/modules/nutrition.ipc.ts
git commit -m "feat(nutrify): getProfile returns dateOfBirth instead of age"
```

---

### Task 4: Update `saveProfile` for DOB validation and storage

**Files:**
- Modify: `electron/modules/nutrition.ipc.ts` (lines 44-63, the saveProfile handler)

- [ ] **Step 1: Update the handler**

Add `import { getAgeFromDob } from '../../shared/date-utils';` at top of file (with existing date-utils imports).

Change the handler parameter type and validation. Replace the age validation block (line 48) and the INSERT statement to use `date_of_birth` and `weight_check_day`:

```ts
ipcHandle('nutrition:saveProfile', (_e, profile: {
  dateOfBirth: string; sex: string; heightCm: number; initialWeightKg: number;
  activityLevel: string; deficitTargetKcal?: number; gymCalories?: number;
  stepCaloriesFactor?: number; weightCheckDay?: number;
}) => {
  if (!profile.dateOfBirth || !/^\d{4}-\d{2}-\d{2}$/.test(profile.dateOfBirth)) throw new Error('Invalid date of birth format');
  const dobDate = new Date(profile.dateOfBirth + 'T00:00:00');
  if (isNaN(dobDate.getTime()) || dobDate > new Date() || dobDate.getFullYear() < 1900) throw new Error('Invalid date of birth');
  if (!Number.isFinite(profile.heightCm) || profile.heightCm < 50 || profile.heightCm > 250) throw new Error('Invalid height');
  if (!Number.isFinite(profile.initialWeightKg) || profile.initialWeightKg < 10 || profile.initialWeightKg > 500) throw new Error('Invalid weight');
  if (profile.deficitTargetKcal !== undefined && (!Number.isFinite(profile.deficitTargetKcal) || profile.deficitTargetKcal < 0 || profile.deficitTargetKcal > 2000)) throw new Error('Invalid deficit target');
  const weightCheckDay = Math.max(1, Math.min(7, profile.weightCheckDay ?? 1));
  const age = getAgeFromDob(profile.dateOfBirth);
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO nutrition_profile (id, date_of_birth, age, sex, height_cm, initial_weight_kg, activity_level, deficit_target_kcal, gym_calories, step_calories_factor, weight_check_day)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(profile.dateOfBirth, age, profile.sex, profile.heightCm, profile.initialWeightKg,
    profile.activityLevel, profile.deficitTargetKcal ?? 500, profile.gymCalories ?? 300,
    profile.stepCaloriesFactor ?? 0.04, weightCheckDay);

  const today = todayDateString();
  recalcSummary(db, today);
});
```

Note: We still write `age` to the column for backwards compatibility, computed from DOB.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add electron/modules/nutrition.ipc.ts
git commit -m "feat(nutrify): saveProfile accepts dateOfBirth with validation"
```

---

### Task 5: Update `recalcSummary` to derive age from DOB

**Files:**
- Modify: `electron/modules/nutrition.ipc.ts` (line 433 in recalcSummary)

- [ ] **Step 1: Change age derivation**

At line 433, replace:
```ts
const bmr = calculateBMR(weight, profile.height_cm as number, profile.age as number, profile.sex as string);
```
With:
```ts
const dob = profile.date_of_birth as string | null;
const age = dob ? getAgeFromDob(dob) : (profile.age as number) ?? 30;
const bmr = calculateBMR(weight, profile.height_cm as number, age, profile.sex as string);
```

The fallback to `profile.age` handles the edge case where DOB hasn't been set yet (shouldn't happen after migration, but safe).

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add electron/modules/nutrition.ipc.ts
git commit -m "fix(nutrify): recalcSummary derives age from DOB instead of stale column"
```

---

## Chunk 2: Backend — Weight Check-in Logic

### Task 6: Add `shouldAskWeight` IPC handler

**Files:**
- Modify: `electron/modules/nutrition.ipc.ts` (add new handler near other handlers)
- Modify: `shared/types.ts` (line ~117, after last nutrition method)
- Modify: `electron/preload.ts` (line ~76, after last nutrition line)

- [ ] **Step 1: Add the IPC handler**

Add to `nutrition.ipc.ts` inside `registerNutritionIpcHandlers()`:

```ts
ipcHandle('nutrition:shouldAskWeight', () => {
  const db = getDb();
  const profile = db.prepare('SELECT weight_check_day FROM nutrition_profile WHERE id = 1').get() as { weight_check_day: number } | undefined;
  if (!profile) return { shouldAsk: false };

  const checkDay = profile.weight_check_day ?? 1;
  const today = new Date();
  const dow = today.getDay() || 7; // Monday=1, Sunday=7

  if (dow < checkDay) return { shouldAsk: false };

  const monday = getMondayOfWeek();
  const thisWeekWeight = db.prepare(
    'SELECT weight_kg FROM nutrition_weekly_metrics WHERE date = ? AND weight_kg IS NOT NULL'
  ).get(monday) as { weight_kg: number } | undefined;

  if (thisWeekWeight) return { shouldAsk: false };

  const lastWeight = db.prepare(
    'SELECT weight_kg FROM nutrition_weekly_metrics WHERE weight_kg IS NOT NULL ORDER BY date DESC LIMIT 1'
  ).get() as { weight_kg: number } | undefined;

  return { shouldAsk: true, lastWeight: lastWeight?.weight_kg };
});
```

Make sure `getMondayOfWeek` is imported from `shared/date-utils` at the top of the file (should already be there from the date standardization refactor).

- [ ] **Step 2: Add to preload.ts**

Add after line ~76 in `electron/preload.ts`:
```ts
nutritionShouldAskWeight: () => ipcRenderer.invoke('nutrition:shouldAskWeight'),
```

- [ ] **Step 3: Add to HubtifyApi type**

Add after line ~117 in `shared/types.ts`:
```ts
nutritionShouldAskWeight: () => Promise<{ shouldAsk: boolean; lastWeight?: number }>;
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add electron/modules/nutrition.ipc.ts electron/preload.ts shared/types.ts
git commit -m "feat(nutrify): add shouldAskWeight IPC handler"
```

---

### Task 7: Add `recalcSummary` call to `saveWeeklyMetrics`

**Files:**
- Modify: `electron/modules/nutrition.ipc.ts` (lines 171-177, saveWeeklyMetrics handler)

- [ ] **Step 1: Add recalc after weight save**

After the existing INSERT OR REPLACE in `saveWeeklyMetrics`, add:

```ts
recalcSummary(db, todayDateString());
```

Make sure `todayDateString` is imported (should already be from earlier refactor).

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add electron/modules/nutrition.ipc.ts
git commit -m "fix(nutrify): recalc TDEE after weekly weight save"
```

---

## Chunk 3: Frontend — DOB Migration in Onboarding & Settings

### Task 8: Add i18n keys

**Files:**
- Modify: `src/i18n/es.json`
- Modify: `src/i18n/en.json`

- [ ] **Step 1: Add keys to both files**

Add these keys to the `nutrify` section of each file:

**es.json:**
```json
"nutrify.dateOfBirth": "Fecha de nacimiento",
"nutrify.calculatedAge": "{{age}} años",
"nutrify.weightCheckin.title": "Registro semanal de peso",
"nutrify.weightCheckin.lastWeight": "Último peso registrado: {{weight}} kg",
"nutrify.weightCheckin.placeholder": "Tu peso actual (kg)",
"nutrify.weightCheckin.save": "Guardar",
"nutrify.weightCheckin.later": "Ahora no",
"nutrify.weightCheckDay": "Día de pesaje semanal",
"nutrify.weekdays.1": "Lunes",
"nutrify.weekdays.2": "Martes",
"nutrify.weekdays.3": "Miércoles",
"nutrify.weekdays.4": "Jueves",
"nutrify.weekdays.5": "Viernes",
"nutrify.weekdays.6": "Sábado",
"nutrify.weekdays.7": "Domingo"
```

**en.json:**
```json
"nutrify.dateOfBirth": "Date of birth",
"nutrify.calculatedAge": "{{age}} years old",
"nutrify.weightCheckin.title": "Weekly weight check-in",
"nutrify.weightCheckin.lastWeight": "Last recorded weight: {{weight}} kg",
"nutrify.weightCheckin.placeholder": "Your current weight (kg)",
"nutrify.weightCheckin.save": "Save",
"nutrify.weightCheckin.later": "Not now",
"nutrify.weightCheckDay": "Weekly weigh-in day",
"nutrify.weekdays.1": "Monday",
"nutrify.weekdays.2": "Tuesday",
"nutrify.weekdays.3": "Wednesday",
"nutrify.weekdays.4": "Thursday",
"nutrify.weekdays.5": "Friday",
"nutrify.weekdays.6": "Saturday",
"nutrify.weekdays.7": "Sunday"
```

- [ ] **Step 2: Commit**

```bash
git add src/i18n/es.json src/i18n/en.json
git commit -m "feat(nutrify): i18n keys for DOB and weight check-in"
```

---

### Task 9: Update NutritionOnboarding — age → DOB

**Files:**
- Modify: `src/modules/nutrition/components/NutritionOnboarding.tsx`

- [ ] **Step 1: Replace age state and input**

Replace the `age` state (line 13):
```ts
// Before
const [age, setAge] = useState(25);
// After
const [dateOfBirth, setDateOfBirth] = useState('');
```

Replace the age input JSX (lines 49-53):
```tsx
<label style={labelStyle}>
  {t('nutrify.dateOfBirth')}
  <input type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)}
    max={new Date().toISOString().split('T')[0]} min="1900-01-01" className="rpg-input" />
</label>
```

Update the save call to pass `dateOfBirth` instead of `age`. Find where `window.api.nutritionSaveProfile` is called and replace `age` with `dateOfBirth` in the object.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/modules/nutrition/components/NutritionOnboarding.tsx
git commit -m "feat(nutrify): onboarding uses date of birth instead of age"
```

---

### Task 10: Update NutritionSettings — age → DOB + weight_check_day

**Files:**
- Modify: `src/modules/nutrition/components/NutritionSettings.tsx`

- [ ] **Step 1: Replace age state and add weightCheckDay**

Replace `age` state (line 18) with `dateOfBirth` state. Add `weightCheckDay` state:
```ts
const [dateOfBirth, setDateOfBirth] = useState('');
const [weightCheckDay, setWeightCheckDay] = useState(1);
```

Update the `useEffect` that loads the profile to read `dateOfBirth` and `weightCheckDay` from the profile response instead of `age`.

- [ ] **Step 2: Replace age input with DOB picker + age label**

Replace age input JSX (lines 84-87):
```tsx
<label style={labelStyle}>
  {t('nutrify.dateOfBirth')}
  <input type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)}
    max={new Date().toISOString().split('T')[0]} min="1900-01-01" className="rpg-input" />
  {dateOfBirth && (
    <span style={{ fontSize: '0.75rem', opacity: 0.6, marginTop: 2 }}>
      {t('nutrify.calculatedAge', { age: getAgeFromDob(dateOfBirth) })}
    </span>
  )}
</label>
```

Import `getAgeFromDob` from `shared/date-utils`.

- [ ] **Step 3: Add weight_check_day dropdown**

Add a dropdown selector in the settings, in the Exercise Config section or as a new card:
```tsx
<label style={labelStyle}>
  {t('nutrify.weightCheckDay')}
  <select value={weightCheckDay} onChange={(e) => setWeightCheckDay(+e.target.value)} className="rpg-input">
    {[1, 2, 3, 4, 5, 6, 7].map(d => (
      <option key={d} value={d}>{t(`nutrify.weekdays.${d}`)}</option>
    ))}
  </select>
</label>
```

- [ ] **Step 4: Update save call**

Replace `age` with `dateOfBirth` and add `weightCheckDay` in the `nutritionSaveProfile` call.

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/modules/nutrition/components/NutritionSettings.tsx
git commit -m "feat(nutrify): settings uses DOB picker and weight check-in day selector"
```

---

## Chunk 4: Frontend — Weight Check-in Popup

### Task 11: Add weight check-in popup to Today.tsx

**Files:**
- Modify: `src/modules/nutrition/components/Today.tsx`

- [ ] **Step 1: Add state and mount check**

Add state variables near the top of the component:
```ts
const [weightPopup, setWeightPopup] = useState<{ show: boolean; lastWeight?: number }>({ show: false });
const [weightInput, setWeightInput] = useState('');
```

Add a `useEffect` that runs on mount to check if weight popup should show. Only trigger when viewing today's date:

```ts
useEffect(() => {
  if (date !== todayDateString()) return;
  const dismissed = localStorage.getItem('hubtify_weight_dismiss_date');
  if (dismissed === todayDateString()) return;
  window.api.nutritionShouldAskWeight().then(result => {
    if (result.shouldAsk) {
      setWeightPopup({ show: true, lastWeight: result.lastWeight });
      if (result.lastWeight) setWeightInput(String(result.lastWeight));
    }
  }).catch(console.error);
}, [date]);
```

Import `todayDateString` from `shared/date-utils`.

- [ ] **Step 2: Add save and dismiss handlers**

```ts
const handleWeightSave = async () => {
  const kg = parseFloat(weightInput);
  if (!isFinite(kg) || kg < 30 || kg > 300) return;
  await window.api.nutritionSaveWeeklyMetrics({ weightKg: kg });
  setWeightPopup({ show: false });
};

const handleWeightDismiss = () => {
  localStorage.setItem('hubtify_weight_dismiss_date', todayDateString());
  setWeightPopup({ show: false });
};
```

- [ ] **Step 3: Add popup JSX**

Add the modal dialog before the component's closing tag. Follow the existing RPG dialog pattern in the app:

```tsx
{weightPopup.show && (
  <div style={{
    position: 'fixed', inset: 0, background: 'rgba(44, 24, 16, 0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  }}>
    <div style={{
      background: 'var(--rpg-panel-bg)', border: '2px solid var(--rpg-gold-dark)',
      borderRadius: 'var(--rpg-radius)', padding: '24px', maxWidth: 340,
      textAlign: 'center', color: 'var(--rpg-parchment)',
    }}>
      <h3 style={{ fontFamily: 'Cinzel, serif', marginBottom: 12, color: 'var(--rpg-gold-light)' }}>
        {t('nutrify.weightCheckin.title')}
      </h3>
      {weightPopup.lastWeight && (
        <p style={{ fontSize: '0.8rem', opacity: 0.6, marginBottom: 12 }}>
          {t('nutrify.weightCheckin.lastWeight', { weight: weightPopup.lastWeight })}
        </p>
      )}
      <input
        type="number" step="0.1" min={30} max={300}
        value={weightInput}
        onChange={(e) => setWeightInput(e.target.value)}
        placeholder={t('nutrify.weightCheckin.placeholder')}
        className="rpg-input"
        style={{ width: '100%', marginBottom: 16, textAlign: 'center', fontSize: '1.2rem' }}
        autoFocus
      />
      <button className="rpg-button" onClick={handleWeightSave} style={{ width: '100%', marginBottom: 8 }}>
        {t('nutrify.weightCheckin.save')}
      </button>
      <button onClick={handleWeightDismiss}
        style={{ background: 'none', border: 'none', color: 'var(--rpg-gold)', opacity: 0.6, cursor: 'pointer', fontSize: '0.8rem' }}>
        {t('nutrify.weightCheckin.later')}
      </button>
    </div>
  </div>
)}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/modules/nutrition/components/Today.tsx
git commit -m "feat(nutrify): weekly weight check-in popup on Today view"
```

---

## Final Verification

### Task 12: Full compile check and sidebar commit

- [ ] **Step 1: Run full TypeScript check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 2: Commit sidebar UI changes (from earlier session)**

```bash
git add src/hub/styles/layout.css src/hub/Layout.tsx src/hub/Sidebar.tsx
git commit -m "fix(ui): sidebar toggle button centered with slide-out on hover"
```

- [ ] **Step 3: Verify git status is clean**

Run: `git status`
Expected: nothing to commit (except possibly untracked plan/doc files)
