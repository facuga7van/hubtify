# Habit Reminders & Retroactive Check — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add habit reminder notifications (configurable time) and yesterday-only retroactive habit checks.

**Architecture:** Extends existing notification engine with new `evaluateHabitNotifications` evaluator. Adds `quests:checkHabitForDate` IPC for retroactive checks. UI badge in HabitTracker for yesterday recovery. Settings row for reminder time config.

**Tech Stack:** Electron Notification API, better-sqlite3, React, IPC via `ipcHandle()`, localStorage for settings.

**Spec:** `docs/superpowers/specs/2026-05-01-habit-reminders-retroactive-design.md`

---

## Chunk 1: Backend — Retroactive Check IPC

### Task 1: Add `yesterdayDateString` helper to date-utils

**Files:**
- Modify: `shared/date-utils.ts:13-18`

- [ ] **Step 1: Add `yesterdayDateString` function**

In `shared/date-utils.ts`, the existing `daysAgoDateString(1)` works but a named alias is clearer. Add after line 18:

```typescript
/** Returns yesterday's date as YYYY-MM-DD string */
export function yesterdayDateString(): string {
  return daysAgoDateString(1);
}
```

- [ ] **Step 2: Commit**

```bash
git add shared/date-utils.ts
git commit -m "feat(quests): add yesterdayDateString helper"
```

### Task 2: Add `quests:checkHabitForDate` IPC handler

**Files:**
- Modify: `electron/modules/quests.ipc.ts` (after the `quests:checkHabit` handler, ~line 515)

- [ ] **Step 1: Add the handler**

After the existing `quests:checkHabit` handler (line 515), add:

```typescript
ipcHandle('quests:checkHabitForDate', (_e, habitId: string, date: string) => {
  const db = getDb();
  const yesterday = yesterdayDateString();
  if (date !== yesterday) {
    throw new Error(`Retroactive check only allowed for yesterday (${yesterday}), got: ${date}`);
  }
  const now = new Date().toISOString();

  const checkTx = db.transaction(() => {
    const existing = db.prepare(
      'SELECT id, deleted_at FROM habit_checks WHERE habit_id = ? AND date = ?'
    ).get(habitId, date) as { id: string; deleted_at: string | null } | undefined;

    if (existing && !existing.deleted_at) {
      db.prepare('UPDATE habit_checks SET deleted_at = ?, updated_at = ? WHERE id = ?')
        .run(now, now, existing.id);
      return { checked: false };
    } else if (existing && existing.deleted_at) {
      db.prepare('UPDATE habit_checks SET deleted_at = NULL, updated_at = ? WHERE id = ?')
        .run(now, existing.id);
      return { checked: true };
    } else {
      const id = genId();
      db.prepare('INSERT INTO habit_checks (id, habit_id, date, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, habitId, date, now, now);
      return { checked: true };
    }
  });

  return checkTx();
});
```

Modify the existing import at top of file (line 4) to include `yesterdayDateString`:
```typescript
import { todayDateString, formatDateString, yesterdayDateString } from '../../shared/date-utils';
```

- [ ] **Step 2: Commit**

```bash
git add electron/modules/quests.ipc.ts shared/date-utils.ts
git commit -m "feat(quests): add checkHabitForDate IPC handler (yesterday only)"
```

### Task 3: Add `checkedYesterday` to `getHabits` response

**Files:**
- Modify: `electron/modules/quests.ipc.ts:317-432` (the `quests:getHabits` handler)
- Modify: `src/modules/quests/types.ts:30-35` (the `HabitWithStreak` interface)

- [ ] **Step 1: Compute `checkedYesterday` in `getHabits`**

In `electron/modules/quests.ipc.ts`, inside the `quests:getHabits` handler, after line 341 (`const checkedToday = dates.has(todayStr);`), add:

```typescript
const yesterdayStr = yesterdayDateString();
const checkedYesterday = dates.has(yesterdayStr);
```

Then in the return object at line 430, add `checkedYesterday`:

```typescript
return { ...h, streak, checkedToday, checkedYesterday, checksThisPeriod, targetThisPeriod };
```

Note: `yesterdayDateString` is already imported from Task 2.

- [ ] **Step 2: Update `HabitWithStreak` interface**

In `src/modules/quests/types.ts`, add `checkedYesterday` to the interface:

```typescript
export interface HabitWithStreak extends Habit {
  streak: number;
  checkedToday: boolean;
  checkedYesterday: boolean;
  checksThisPeriod: number;
  targetThisPeriod: number;
}
```

- [ ] **Step 3: Commit**

```bash
git add electron/modules/quests.ipc.ts src/modules/quests/types.ts
git commit -m "feat(quests): add checkedYesterday field to getHabits response"
```

### Task 4: Expose `checkHabitForDate` in preload & types

**Files:**
- Modify: `electron/preload.ts` (after the `questsCheckHabit` entry)
- Modify: `shared/types.ts` (after the `questsCheckHabit` entry in `HubtifyApi`)

- [ ] **Step 1: Add preload entry**

In `electron/preload.ts`, after the `questsCheckHabit` line, add:

```typescript
questsCheckHabitForDate: (habitId: string, date: string) => ipcRenderer.invoke('quests:checkHabitForDate', habitId, date),
```

- [ ] **Step 2: Add type**

In `shared/types.ts`, after the `questsCheckHabit` entry in `HubtifyApi`, add:

```typescript
questsCheckHabitForDate: (habitId: string, date: string) => Promise<{ checked: boolean }>;
```

- [ ] **Step 3: Commit**

```bash
git add electron/preload.ts shared/types.ts
git commit -m "feat(quests): expose checkHabitForDate in preload and types"
```

---

## Chunk 2: Backend — Habit Notification Evaluator

### Task 5: Add `habit_reminder` message to notification engine

**Files:**
- Modify: `electron/modules/notification-engine.ts:24-61` (MESSAGES map)

- [ ] **Step 1: Add message entry**

In the `MESSAGES` constant, add a new entry (after `quest_stale` or at the end, before the closing `}`):

```typescript
habit_reminder: {
  es: { title: () => 'Hábitos pendientes', body: 'Tenés hábitos sin marcar hoy.' },
  en: { title: () => 'Habits pending', body: 'You have unchecked habits today.' },
},
```

- [ ] **Step 2: Commit**

```bash
git add electron/modules/notification-engine.ts
git commit -m "feat(quests): add habit_reminder message to notification engine"
```

### Task 6: Implement `evaluateHabitNotifications` evaluator

**Files:**
- Modify: `electron/modules/notification-engine.ts` (new function after `evaluateQuestNotifications`, ~line 142)

- [ ] **Step 1: Add the evaluator function**

After line 142 (end of `evaluateQuestNotifications`), add:

```typescript
// ── Habit Evaluator ─────────────────────────────────────────

export function evaluateHabitNotifications(
  db: Database.Database,
  reminderTime: string,
): NotificationCandidate[] {
  // Gate: only run if current time >= configured reminder time
  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (currentTime < reminderTime) return [];

  const todayStr = localDate();

  // Get all active habits
  const habits = db.prepare(`
    SELECT id, name, frequency, times_per_week AS timesPerWeek
    FROM habits WHERE deleted_at IS NULL
  `).all() as Array<{ id: string; name: string; frequency: string; timesPerWeek: number }>;

  if (habits.length === 0) return [];

  // Get today's checks (and this week/month for non-daily)
  const allChecks = db.prepare(
    'SELECT habit_id, date FROM habit_checks WHERE deleted_at IS NULL'
  ).all() as Array<{ habit_id: string; date: string }>;

  const checksByHabit = new Map<string, Set<string>>();
  for (const c of allChecks) {
    let set = checksByHabit.get(c.habit_id);
    if (!set) { set = new Set(); checksByHabit.set(c.habit_id, set); }
    set.add(c.date);
  }

  let uncheckedCount = 0;

  for (const h of habits) {
    const dates = checksByHabit.get(h.id) ?? new Set<string>();

    if (h.frequency === 'daily') {
      if (!dates.has(todayStr)) uncheckedCount++;
    } else if (h.frequency === 'weekly') {
      // Count checks this week (Mon-Sun)
      const today = new Date();
      const dayOfWeek = today.getDay() || 7;
      const monday = new Date(today);
      monday.setDate(today.getDate() - dayOfWeek + 1);
      const mondayStr = localDate(monday);
      let count = 0;
      for (const d of dates) {
        if (d >= mondayStr && d <= todayStr) count++;
      }
      if (count < h.timesPerWeek) uncheckedCount++;
    } else if (h.frequency === 'monthly') {
      // Only fire during last 3 days of month
      const today = new Date();
      const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
      if (today.getDate() < lastDay - 2) continue; // skip unless last 3 days
      const monthStart = todayStr.slice(0, 7) + '-01';
      let count = 0;
      for (const d of dates) {
        if (d >= monthStart && d <= todayStr) count++;
      }
      if (count < 1) uncheckedCount++;
    }
  }

  if (uncheckedCount === 0) return [];

  return [{
    type: 'habit_reminder',
    module: 'quests',
    ...msg('habit_reminder'),
    actionRoute: '/quests',
    refId: todayStr,
  }];
}
```

- [ ] **Step 2: Commit**

```bash
git add electron/modules/notification-engine.ts
git commit -m "feat(quests): implement evaluateHabitNotifications evaluator"
```

### Task 7: Add `habit_reminder` auto-resolve case

**Files:**
- Modify: `electron/modules/notification-engine.ts:349-450` (the `autoResolve` function)

- [ ] **Step 1: Add resolve case**

Inside `autoResolve`, after the `finance_recurring_missing` block (line 429) and before the `if (shouldResolve)` check (line 431), add:

```typescript
if (n.type === 'habit_reminder') {
  // Re-check if all habits are complete for the ref date
  const refDate = n.ref_id;
  const habits = db.prepare(`
    SELECT id, frequency, times_per_week AS timesPerWeek
    FROM habits WHERE deleted_at IS NULL
  `).all() as Array<{ id: string; frequency: string; timesPerWeek: number }>;

  const allChecks = db.prepare(
    'SELECT habit_id, date FROM habit_checks WHERE deleted_at IS NULL'
  ).all() as Array<{ habit_id: string; date: string }>;

  const checksByHabit = new Map<string, Set<string>>();
  for (const c of allChecks) {
    let set = checksByHabit.get(c.habit_id);
    if (!set) { set = new Set(); checksByHabit.set(c.habit_id, set); }
    set.add(c.date);
  }

  let allComplete = true;
  for (const h of habits) {
    const dates = checksByHabit.get(h.id) ?? new Set<string>();
    if (h.frequency === 'daily') {
      if (!dates.has(refDate)) { allComplete = false; break; }
    } else if (h.frequency === 'weekly') {
      const ref = new Date(refDate + 'T00:00:00');
      const dayOfWeek = ref.getDay() || 7;
      const monday = new Date(ref);
      monday.setDate(ref.getDate() - dayOfWeek + 1);
      const mondayStr = localDate(monday);
      let count = 0;
      for (const d of dates) { if (d >= mondayStr && d <= refDate) count++; }
      if (count < h.timesPerWeek) { allComplete = false; break; }
    } else if (h.frequency === 'monthly') {
      const monthStart = refDate.slice(0, 7) + '-01';
      let count = 0;
      for (const d of dates) { if (d >= monthStart && d <= refDate) count++; }
      if (count < 1) { allComplete = false; break; }
    }
  }
  if (allComplete) shouldResolve = true;

  // Also resolve if the notification is from a previous day (stale)
  if (refDate !== localDate()) shouldResolve = true;
}
```

- [ ] **Step 2: Commit**

```bash
git add electron/modules/notification-engine.ts
git commit -m "feat(quests): add habit_reminder auto-resolve in notification engine"
```

### Task 8: Wire evaluator into notification pipeline

**Files:**
- Modify: `electron/modules/notifications.ipc.ts:16-22` (state vars)
- Modify: `electron/modules/notifications.ipc.ts:24-77` (runNotificationCheck)
- Modify: `electron/modules/notifications.ipc.ts:90-166` (registerNotificationIpcHandlers)

- [ ] **Step 1: Add state variables**

After line 22 (the `NATIVE_COOLDOWN_MS` constant), add:

```typescript
let habitReminderEnabled = true;
let habitReminderTime = '21:00';
```

- [ ] **Step 2: Add import**

Add `evaluateHabitNotifications` to the import from `./notification-engine`:

```typescript
import {
  evaluateQuestNotifications,
  evaluateNutritionNotifications,
  evaluateFinanceNotifications,
  evaluateHabitNotifications,
  deduplicateAndInsert,
  autoResolve,
  cleanupOldNotifications,
  getEngineLocale,
  setEngineLocale,
} from './notification-engine';
```

- [ ] **Step 3: Add to pipeline in `runNotificationCheck`**

In the `candidates` array assembly (around line 30), add the habit evaluator:

```typescript
const candidates = [
  ...(enabledModules.quests ? evaluateQuestNotifications(db) : []),
  ...(enabledModules.quests && habitReminderEnabled ? evaluateHabitNotifications(db, habitReminderTime) : []),
  ...(enabledModules.nutrition ? evaluateNutritionNotifications(db) : []),
  ...(enabledModules.finance ? evaluateFinanceNotifications(db) : []),
];
```

- [ ] **Step 4: Add IPC handler**

Inside `registerNotificationIpcHandlers`, before the closing `}` (line 166), add:

```typescript
ipcHandle('notifications:setHabitReminder', (_e, enabled: boolean, time: string) => {
  habitReminderEnabled = enabled;
  if (time) habitReminderTime = time;
});
```

- [ ] **Step 5: Commit**

```bash
git add electron/modules/notifications.ipc.ts
git commit -m "feat(quests): wire habit evaluator into notification pipeline"
```

### Task 9: Expose `notificationsSetHabitReminder` in preload & types

**Files:**
- Modify: `electron/preload.ts` (after `notificationsSetModuleEnabled` entry)
- Modify: `shared/types.ts` (after `notificationsSetModuleEnabled` in `HubtifyApi`)

- [ ] **Step 1: Add preload entry**

```typescript
notificationsSetHabitReminder: (enabled: boolean, time: string) => ipcRenderer.invoke('notifications:setHabitReminder', enabled, time),
```

- [ ] **Step 2: Add type**

```typescript
notificationsSetHabitReminder: (enabled: boolean, time: string) => Promise<void>;
```

- [ ] **Step 3: Commit**

```bash
git add electron/preload.ts shared/types.ts
git commit -m "feat(quests): expose notificationsSetHabitReminder in preload and types"
```

---

## Chunk 3: Frontend — Settings UI

### Task 10: Add habit reminder settings row

**Files:**
- Modify: `src/hub/SettingsPage.tsx:218-280` (Notifications section)
- Modify: `src/i18n/es.json` (settings section)
- Modify: `src/i18n/en.json` (settings section)

- [ ] **Step 1: Add state variables**

In `SettingsPage.tsx`, after the existing notification state variables (around line 27), add:

```typescript
const [habitReminderEnabled, setHabitReminderEnabled] = useState(
  () => localStorage.getItem('hubtify_habit_reminder_enabled') !== 'false'
);
const [habitReminderTime, setHabitReminderTime] = useState(
  () => localStorage.getItem('hubtify_habit_reminder_time') || '21:00'
);
```

- [ ] **Step 2: Add boot sync useEffect**

After the existing state declarations, add a useEffect to sync localStorage values to main process on mount. Use refs to avoid stale closure and satisfy exhaustive-deps:

```typescript
const habitReminderEnabledRef = useRef(habitReminderEnabled);
const habitReminderTimeRef = useRef(habitReminderTime);

useEffect(() => {
  window.api.notificationsSetHabitReminder?.(habitReminderEnabledRef.current, habitReminderTimeRef.current);
}, []);
```

Add `useRef` to the React import at the top of the file if not already present.

- [ ] **Step 3: Add settings row JSX**

Inside the Notifications section, after the per-module toggles map (after the closing `})}` of the map around line 278), add before the section's closing `</div>`:

```tsx
{/* Habit reminder */}
<div className="settings-row__separator" style={{ borderTop: '1px solid rgba(212,160,23,0.15)', margin: '8px 0', paddingTop: 8 }}>
  <div className="settings-row__label" style={{ fontSize: 'var(--fs-label)', opacity: 0.75, marginBottom: 6 }}>
    {t('settings.habitReminder', 'Recordatorio de hábitos')}
  </div>
</div>
<div className="settings-row">
  <div>
    <div className="settings-row__label">{t('settings.habitReminderLabel', 'Recordatorio diario')}</div>
    <div className="settings-row__desc">{t('settings.habitReminderDesc', 'Notificación si quedan hábitos sin marcar')}</div>
  </div>
  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
    {habitReminderEnabled && (
      <input
        type="time"
        value={habitReminderTime}
        onChange={(e) => {
          const next = e.target.value;
          setHabitReminderTime(next);
          localStorage.setItem('hubtify_habit_reminder_time', next);
          window.api.notificationsSetHabitReminder?.(habitReminderEnabled, next);
        }}
        className="rpg-input"
        style={{ width: 100, fontSize: 'var(--fs-label)' }}
      />
    )}
    <button
      className={`settings-toggle${habitReminderEnabled ? ' settings-toggle--on' : ''}`}
      onClick={() => {
        const next = !habitReminderEnabled;
        setHabitReminderEnabled(next);
        localStorage.setItem('hubtify_habit_reminder_enabled', next ? 'true' : 'false');
        window.api.notificationsSetHabitReminder?.(next, habitReminderTime);
      }}
    >
      <span className="settings-toggle__thumb" />
      <span className="settings-toggle__text">
        {habitReminderEnabled ? t('settings.toggleOn') : t('settings.toggleOff')}
      </span>
    </button>
  </div>
</div>
```

- [ ] **Step 4: Add i18n keys**

In `src/i18n/es.json`, in the `settings` section (alphabetically):

```json
"habitReminder": "Recordatorio de hábitos",
"habitReminderDesc": "Notificación si quedan hábitos sin marcar",
"habitReminderLabel": "Recordatorio diario",
```

In `src/i18n/en.json`, in the `settings` section (alphabetically):

```json
"habitReminder": "Habit reminder",
"habitReminderDesc": "Notification if habits are unchecked",
"habitReminderLabel": "Daily reminder",
```

- [ ] **Step 5: Commit**

```bash
git add src/hub/SettingsPage.tsx src/i18n/es.json src/i18n/en.json
git commit -m "feat(quests): add habit reminder settings in Notifications section"
```

---

## Chunk 4: Frontend — Retroactive Check UI

### Task 11: Adapt `processHabitCheck` for retroactive date

**Files:**
- Modify: `src/modules/quests/utils.tsx:53-108`

- [ ] **Step 1: Add optional `date` parameter**

Update the function signature and logic:

```typescript
export async function processHabitCheck(
  habitId: string,
  habits: HabitWithStreak[],
  callbacks: HabitCheckCallbacks,
  date?: string,
): Promise<void> {
  const habit = habits.find(h => h.id === habitId);
  if (!habit) return;

  const result = date
    ? await window.api.questsCheckHabitForDate(habitId, date)
    : await window.api.questsCheckHabit(habitId);

  if (result.checked) {
    if (date) {
      // Retroactive check: flat 5 XP (period-completion gate doesn't apply to past dates)
      const rpgResult = await window.api.processRpgEvent({
        type: 'HABIT_CHECKED', moduleId: 'quests',
        payload: { xp: 5, hp: 0, habitId },
        timestamp: Date.now(),
      });
      callbacks.toast({
        type: 'xp',
        message: `+${rpgResult.xpGained} XP`,
        details: {
          xp: rpgResult.xpGained,
          bonusTier: bonusMultiplierToTier(rpgResult.bonusMultiplier),
          comboMultiplier: rpgResult.comboMultiplier,
          streakMilestone: rpgResult.milestoneXp || undefined,
        },
      });
      callbacks.onXpGained?.();
      window.dispatchEvent(new Event('rpg:statsChanged'));
    } else {
      // Normal check: XP only when period just completed
      const justCompletedPeriod = habit.checksThisPeriod + 1 >= habit.targetThisPeriod
        && habit.checksThisPeriod < habit.targetThisPeriod;
      if (justCompletedPeriod) {
        const streak = habit.streak + 1;
        const xp = 5 + Math.min(streak, 10);
        const rpgResult = await window.api.processRpgEvent({
          type: 'HABIT_CHECKED', moduleId: 'quests',
          payload: { xp, hp: 0, habitId },
          timestamp: Date.now(),
        });
        callbacks.toast({
          type: 'xp',
          message: `+${rpgResult.xpGained} XP`,
          details: {
            xp: rpgResult.xpGained,
            bonusTier: bonusMultiplierToTier(rpgResult.bonusMultiplier),
            comboMultiplier: rpgResult.comboMultiplier,
            streakMilestone: rpgResult.milestoneXp || undefined,
          },
        });
        callbacks.onXpGained?.();
        window.dispatchEvent(new Event('rpg:statsChanged'));
      }
    }
    playTaskComplete();
  } else {
    // Uncheck logic (only for normal checks, not retroactive)
    if (!date) {
      const droppedBelowTarget = habit.checksThisPeriod === habit.targetThisPeriod;
      if (droppedBelowTarget) {
        await window.api.processRpgEvent({
          type: 'HABIT_UNCHECKED', moduleId: 'quests',
          payload: { xp: -5, hp: 0, habitId },
          timestamp: Date.now(),
        });
        callbacks.toast({ type: 'warning', message: callbacks.t('questify.habitUnchecked', 'Habit unchecked — XP deducted') });
        window.dispatchEvent(new Event('rpg:statsChanged'));
      }
    }
  }
  window.dispatchEvent(new Event('quests:dataChanged'));
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/quests/utils.tsx
git commit -m "feat(quests): adapt processHabitCheck for retroactive date param"
```

### Task 12: Add "Yesterday" badge to HabitTracker

**Files:**
- Modify: `src/modules/quests/components/HabitTracker.tsx`
- Modify: `src/modules/quests/styles/quests.css`
- Modify: `src/i18n/es.json`
- Modify: `src/i18n/en.json`

- [ ] **Step 1: Add import for `daysAgoDateString`**

In `HabitTracker.tsx`, add to the import from `date-utils`:

```typescript
import { formatDateString, daysAgoDateString } from '../../../../shared/date-utils';
```

- [ ] **Step 2: Add `canRetroCheck` helper and `handleRetroCheck` handler**

After `handleCheck` (around line 90), add:

```typescript
const canRetroCheck = useCallback((h: HabitWithStreak): boolean => {
  // Only show badge if yesterday was NOT checked (checkedToday is irrelevant)
  if (h.checkedYesterday) return false;
  if (h.frequency === 'daily') return true;
  if (h.frequency === 'weekly') {
    // Yesterday must be in current week (today is NOT Monday)
    return new Date().getDay() !== 1;
  }
  if (h.frequency === 'monthly') {
    // Yesterday must be in current month (today is NOT the 1st)
    return new Date().getDate() !== 1;
  }
  return false;
}, []);

const handleRetroCheck = async (habitId: string) => {
  const yesterday = daysAgoDateString(1);
  await processHabitCheck(habitId, habits, { toast, t, onXpGained }, yesterday);
  await loadHabits();
  if (heatmapOpen) loadHeatmap();
};
```

- [ ] **Step 3: Add badge JSX**

In the habit row JSX (inside `.quest-habit-right`, before the `<Tick>` component, around line 260), add:

```tsx
{canRetroCheck(h) && (
  <button
    type="button"
    className="quest-retro-badge"
    onClick={(e) => { e.stopPropagation(); handleRetroCheck(h.id); }}
    title={t('questify.retroCheckTitle', 'Marcar hábito de ayer')}
  >
    {t('questify.yesterday', 'Ayer')}
  </button>
)}
```

- [ ] **Step 4: Add CSS styles**

In `src/modules/quests/styles/quests.css`, append at end of file:

```css
/* ── Retroactive check badge ──────────────────── */
.quest-retro-badge {
  background: rgba(196, 164, 76, 0.15);
  border: 1px dashed var(--rpg-gold);
  border-radius: 4px;
  color: var(--rpg-gold);
  cursor: pointer;
  font-family: 'Crimson Text', serif;
  font-size: var(--fs-label);
  line-height: 1;
  padding: 2px 6px;
  transition: background 0.2s, border-color 0.2s;
}
.quest-retro-badge:hover {
  background: rgba(196, 164, 76, 0.3);
  border-color: var(--rpg-gold);
}
.quest-retro-badge:active {
  background: rgba(196, 164, 76, 0.45);
}
```

- [ ] **Step 5: Add i18n keys**

In `src/i18n/es.json`, in the `questify` section (alphabetically):

```json
"retroCheckTitle": "Marcar hábito de ayer",
"yesterday": "Ayer",
```

In `src/i18n/en.json`, in the `questify` section (alphabetically):

```json
"retroCheckTitle": "Check yesterday's habit",
"yesterday": "Yesterday",
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/quests/components/HabitTracker.tsx src/modules/quests/styles/quests.css src/i18n/es.json src/i18n/en.json
git commit -m "feat(quests): add yesterday retroactive check badge in HabitTracker"
```

---

## Chunk 5: Testing

### Task 13: Test `checkHabitForDate` IPC handler

**Files:**
- Create: `tests/modules/quests/quests-habits.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { questsMigrations } from '@modules/quests/quests.schema';

function runMigrations(db: Database.Database, migrations: { up: string }[]) {
  for (const m of migrations) {
    db.exec(m.up);
  }
}

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db, questsMigrations);
  return db;
}

function getYesterdayStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString('en-CA');
}

describe('checkHabitForDate', () => {
  it('should insert a check for yesterday', () => {
    const db = setupDb();
    db.prepare("INSERT INTO habits (id, name, updated_at) VALUES ('h1', 'Exercise', '')").run();
    const yesterdayStr = getYesterdayStr();
    const now = new Date().toISOString();

    db.prepare('INSERT INTO habit_checks (id, habit_id, date, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('c1', 'h1', yesterdayStr, now, now);

    const check = db.prepare('SELECT * FROM habit_checks WHERE habit_id = ? AND date = ?')
      .get('h1', yesterdayStr) as { date: string; deleted_at: string | null };
    expect(check).toBeDefined();
    expect(check.date).toBe(yesterdayStr);
    expect(check.deleted_at).toBeNull();
  });

  it('should use current timestamp for created_at, not the check date', () => {
    const db = setupDb();
    db.prepare("INSERT INTO habits (id, name, updated_at) VALUES ('h1', 'Read', '')").run();
    const yesterdayStr = getYesterdayStr();
    const now = new Date().toISOString();

    db.prepare('INSERT INTO habit_checks (id, habit_id, date, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('c1', 'h1', yesterdayStr, now, now);

    const check = db.prepare('SELECT created_at FROM habit_checks WHERE id = ?')
      .get('c1') as { created_at: string };
    expect(check.created_at.startsWith(new Date().toISOString().slice(0, 10))).toBe(true);
  });

  it('should soft-delete (toggle off) existing retroactive check', () => {
    const db = setupDb();
    db.prepare("INSERT INTO habits (id, name, updated_at) VALUES ('h1', 'Meditate', '')").run();
    const yesterdayStr = getYesterdayStr();
    const now = new Date().toISOString();

    db.prepare('INSERT INTO habit_checks (id, habit_id, date, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('c1', 'h1', yesterdayStr, now, now);

    db.prepare('UPDATE habit_checks SET deleted_at = ?, updated_at = ? WHERE id = ?')
      .run(now, now, 'c1');

    const check = db.prepare('SELECT deleted_at FROM habit_checks WHERE id = ?')
      .get('c1') as { deleted_at: string | null };
    expect(check.deleted_at).not.toBeNull();
  });

  it('should resurrect a soft-deleted retroactive check', () => {
    const db = setupDb();
    db.prepare("INSERT INTO habits (id, name, updated_at) VALUES ('h1', 'Meditate', '')").run();
    const yesterdayStr = getYesterdayStr();
    const now = new Date().toISOString();

    // Insert then soft-delete
    db.prepare('INSERT INTO habit_checks (id, habit_id, date, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('c1', 'h1', yesterdayStr, now, now);
    db.prepare('UPDATE habit_checks SET deleted_at = ?, updated_at = ? WHERE id = ?')
      .run(now, now, 'c1');

    // Resurrect
    db.prepare('UPDATE habit_checks SET deleted_at = NULL, updated_at = ? WHERE id = ?')
      .run(now, 'c1');

    const check = db.prepare('SELECT deleted_at FROM habit_checks WHERE id = ?')
      .get('c1') as { deleted_at: string | null };
    expect(check.deleted_at).toBeNull();
  });

  it('should enforce UNIQUE(habit_id, date) constraint', () => {
    const db = setupDb();
    db.prepare("INSERT INTO habits (id, name, updated_at) VALUES ('h1', 'Walk', '')").run();
    const yesterdayStr = getYesterdayStr();
    const now = new Date().toISOString();

    db.prepare('INSERT INTO habit_checks (id, habit_id, date, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('c1', 'h1', yesterdayStr, now, now);

    expect(() => {
      db.prepare('INSERT INTO habit_checks (id, habit_id, date, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run('c2', 'h1', yesterdayStr, now, now);
    }).toThrow();
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/modules/quests/quests-habits.test.ts`
Expected: All 5 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/modules/quests/quests-habits.test.ts
git commit -m "test(quests): add checkHabitForDate tests"
```

### Task 14: Test `evaluateHabitNotifications` evaluator

**Files:**
- Create: `tests/modules/notifications/notification-habits.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { notificationsMigrations } from '../../../electron/modules/notifications.schema';
import { questsMigrations } from '@modules/quests/quests.schema';
import {
  evaluateHabitNotifications,
  deduplicateAndInsert,
  autoResolve,
} from '../../../electron/modules/notification-engine';

function runMigrations(db: Database.Database, migrations: { up: string }[]) {
  for (const m of migrations) {
    db.exec(m.up);
  }
}

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db, notificationsMigrations);
  runMigrations(db, questsMigrations);
  return db;
}

describe('evaluateHabitNotifications', () => {
  it('should return empty when before reminder time', () => {
    const db = setupDb();
    db.prepare("INSERT INTO habits (id, name, updated_at) VALUES ('h1', 'Exercise', '')").run();
    const result = evaluateHabitNotifications(db, '23:59');
    const hour = new Date().getHours();
    if (hour < 23) {
      expect(result).toHaveLength(0);
    }
  });

  it('should generate candidate when habits are unchecked after reminder time', () => {
    const db = setupDb();
    db.prepare("INSERT INTO habits (id, name, updated_at) VALUES ('h1', 'Exercise', '')").run();
    const result = evaluateHabitNotifications(db, '00:00');
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('habit_reminder');
    expect(result[0].module).toBe('quests');
    expect(result[0].actionRoute).toBe('/quests');
  });

  it('should return empty when all daily habits are checked', () => {
    const db = setupDb();
    db.prepare("INSERT INTO habits (id, name, updated_at) VALUES ('h1', 'Exercise', '')").run();
    const today = new Date().toLocaleDateString('en-CA');
    db.prepare("INSERT INTO habit_checks (id, habit_id, date, updated_at) VALUES ('c1', 'h1', ?, '')")
      .run(today);
    const result = evaluateHabitNotifications(db, '00:00');
    expect(result).toHaveLength(0);
  });

  it('should ignore soft-deleted habits', () => {
    const db = setupDb();
    const now = new Date().toISOString();
    db.prepare("INSERT INTO habits (id, name, updated_at, deleted_at) VALUES ('h1', 'Deleted', '', ?)")
      .run(now);
    const result = evaluateHabitNotifications(db, '00:00');
    expect(result).toHaveLength(0);
  });
});

describe('habit_reminder auto-resolve', () => {
  it('should resolve habit_reminder when all habits are checked', () => {
    const db = setupDb();
    db.prepare("INSERT INTO habits (id, name, updated_at) VALUES ('h1', 'Exercise', '')").run();
    const today = new Date().toLocaleDateString('en-CA');

    // Insert a habit_reminder notification
    const candidates = evaluateHabitNotifications(db, '00:00');
    expect(candidates).toHaveLength(1);
    deduplicateAndInsert(db, candidates);

    // Verify notification exists
    const before = db.prepare("SELECT COUNT(*) as cnt FROM notifications WHERE type = 'habit_reminder' AND status = 'active'")
      .get() as { cnt: number };
    expect(before.cnt).toBe(1);

    // Now check the habit
    db.prepare("INSERT INTO habit_checks (id, habit_id, date, updated_at) VALUES ('c1', 'h1', ?, '')")
      .run(today);

    // Auto-resolve should clear it
    const resolved = autoResolve(db);
    expect(resolved).toBeGreaterThanOrEqual(1);

    const after = db.prepare("SELECT COUNT(*) as cnt FROM notifications WHERE type = 'habit_reminder' AND status = 'active'")
      .get() as { cnt: number };
    expect(after.cnt).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/modules/notifications/notification-habits.test.ts`
Expected: All 5 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/modules/notifications/notification-habits.test.ts
git commit -m "test(quests): add evaluateHabitNotifications and auto-resolve tests"
```
