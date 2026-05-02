# Habit Reminders & Retroactive Check

**Date:** 2026-05-01
**Status:** Approved

## Problem

Habits (like nutrition logging) can be forgotten. Missing a single day breaks streaks and loses XP. Users need:
1. A configurable reminder when habits are unchecked
2. Ability to retroactively mark yesterday's habit if forgotten

## Design

### Feature 1 — Habit Reminder Notification

#### Notification Engine Integration

New evaluator `evaluateHabitNotifications(db, reminderTime)` in `notification-engine.ts`:

- **Gate**: Only runs if current time >= `reminderTime` (default `'21:00'`)
- **Query**: Finds habits with incomplete periods today
  - `daily`: no active check row for today
  - `weekly`: count of checks this week (Mon-Sun) < `times_per_week`. Fires every poll after reminder time, not only Sunday — gives user multiple nudges during the week.
  - `monthly`: count of checks this month < 1. Fires every poll after reminder time during the last 3 days of the month only.
- **Candidate**: type `habit_reminder`, module `quests`, refId `todayDateString()`
- **Dedup**: One notification per day (refId is the date)

#### Auto-resolve (in `autoResolve()` function, NOT in evaluator)

New case in `autoResolve()` for type `habit_reminder`:
- Re-runs the same unchecked-habits query used by the evaluator
- If query returns 0 unchecked habits → resolve the notification
- Follows existing pattern: evaluators produce candidates, `autoResolve()` handles resolution

#### Runtime State (notifications.ipc.ts)

New in-memory variables:
```typescript
let habitReminderEnabled = true;
let habitReminderTime = '21:00';
```

New IPC handler:
- `notifications:setHabitReminder(enabled: boolean, time: string)` — updates both vars

Pipeline change in `runNotificationCheck`:
```typescript
const candidates = [
  ...(enabledModules.quests ? evaluateQuestNotifications(db) : []),
  ...(enabledModules.quests && habitReminderEnabled ? evaluateHabitNotifications(db, habitReminderTime) : []),
  // ...existing evaluators
];
```

Habit reminders are gated by the existing `enabledModules.quests` flag AND the new `habitReminderEnabled` flag.

#### Initialization on Cold Boot

The main process defaults (`habitReminderEnabled = true`, `habitReminderTime = '21:00'`) match the localStorage defaults. On app startup, `SettingsPage` mounts and syncs current localStorage values to main process via `window.api.notificationsSetHabitReminder?.(enabled, time)` in a `useEffect` on mount — same pattern as existing `notificationsSetSystemEnabled` and `notificationsSetModuleEnabled` calls. This covers the case where the user previously changed the time.

#### Settings UI (SettingsPage.tsx)

Inside the existing Notifications section, new `settings-row`:
- Label: "Recordatorio de habitos" / "Habit reminder"
- Description: "Notificacion si quedan habitos sin marcar" / "Notification if habits are unchecked"
- Controls: toggle (on/off) + `<input type="time">` (only visible when enabled)
- localStorage keys: `hubtify_habit_reminder_enabled`, `hubtify_habit_reminder_time`
- On change: calls `window.api.notificationsSetHabitReminder?.(enabled, time)` to sync main process
- Uses optional chaining (`?.`) consistent with other notification IPC calls in SettingsPage

### Feature 2 — Retroactive Check (Yesterday Only)

#### New IPC Handler (quests.ipc.ts)

`quests:checkHabitForDate(habitId: string, date: string)`:
- **Validation**: `date` must equal yesterday's date string. Throws if not.
- **Logic**: Same toggle pattern as `checkHabit` (insert / soft-delete / resurrect) but uses provided `date` instead of `todayDateString()`
- **Returns**: `{ checked: boolean }` (same shape as `checkHabit` — caller already knows the date)
- **Timestamps**: `created_at` and `updated_at` use `new Date().toISOString()` (current time, not the check date). This is correct for LWW sync — `updated_at` reflects when the action happened, not the logical date of the check.

#### New field in `getHabits` response

Add `checkedYesterday: boolean` to `HabitWithStreak`. Computed in the existing `quests:getHabits` handler alongside `checkedToday`:
```typescript
checkedYesterday: dates.has(yesterdayDateString()),
```

This is needed for the badge rendering condition in `HabitTracker`.

#### Month boundary edge case

When today is the first day of a new month (e.g., May 1) and yesterday was the last day of the previous month (April 30): yesterday falls in the **previous period** for monthly habits. The badge should NOT show for monthly habits in this case — the previous period is closed. The condition must check that yesterday falls within the current period window.

Same logic for weekly: if today is Monday and yesterday was Sunday, yesterday falls in the previous week. Badge should not show for weekly habits at the week boundary.

#### Preload & Types

- `electron/preload.ts`: expose `questsCheckHabitForDate`
- `shared/types.ts`: add `questsCheckHabitForDate` to `HubtifyApi`, add `checkedYesterday` to `HabitWithStreak`

#### UI (HabitTracker.tsx)

Per-habit "yesterday" badge:
- **Condition**: `!h.checkedYesterday && !h.checkedToday` with period boundary guard:
  - For `daily`: always eligible (yesterday is always a valid daily period)
  - For `weekly`: only if yesterday falls within the current Mon-Sun week (i.e., today is NOT Monday)
  - For `monthly`: only if yesterday falls within the current month (i.e., today is NOT the 1st)
- **Render**: Small chip/badge next to the Tick component, text "Ayer" / "Yesterday"
- **Click**: Calls adapted `processHabitCheck` with yesterday's date
- **After check**: Badge disappears on reload, streak reconnects automatically

#### processHabitCheck Adaptation (utils.tsx)

Add optional `date` parameter:
```typescript
export async function processHabitCheck(
  habitId: string,
  habits: HabitWithStreak[],
  callbacks: HabitCheckCallbacks,
  date?: string,  // NEW — if provided, uses checkHabitForDate
): Promise<void>
```

When `date` is provided:
- Calls `window.api.questsCheckHabitForDate(habitId, date)` instead of `questsCheckHabit(habitId)`
- **XP rule for retroactive checks**: Award flat 5 XP (base, no streak bonus). Rationale: the period-completion gate (`justCompletedPeriod`) uses stale in-memory state that reflects today's period, not yesterday's. A flat award avoids double-counting or missing XP. The RPG engine still applies combo/bonus multipliers on top.

#### Streak Impact

No changes to streak calculation. The existing JS algorithm in `quests:getHabits` walks backward through `habit_checks` rows. A retroactive check for yesterday fills the gap and reconnects the streak automatically.

## Files Modified

| File | Change |
|------|--------|
| `electron/modules/notification-engine.ts` | New `evaluateHabitNotifications()` + auto-resolve case for `habit_reminder` in `autoResolve()` |
| `electron/modules/notifications.ipc.ts` | New vars, new IPC `notifications:setHabitReminder`, pipeline update, boot sync |
| `electron/modules/quests.ipc.ts` | New IPC `quests:checkHabitForDate` + `checkedYesterday` field in `getHabits` |
| `electron/preload.ts` | Expose `questsCheckHabitForDate` + `notificationsSetHabitReminder` |
| `shared/types.ts` | Add to `HubtifyApi` + `checkedYesterday` on `HabitWithStreak` |
| `src/hub/SettingsPage.tsx` | New row in Notifications section + boot sync useEffect |
| `src/modules/quests/components/HabitTracker.tsx` | "Yesterday" badge per habit |
| `src/modules/quests/utils.tsx` | `processHabitCheck` accepts optional date, flat XP for retroactive |
| `src/modules/quests/styles/quests.css` | Badge styles |
| `src/i18n/es.json` | New keys |
| `src/i18n/en.json` | New keys |

## Not Changed

- DB schema (habit_checks already supports any date via UNIQUE(habit_id, date))
- Streak calculation (JS-computed, not persisted)
- Sync handlers (habit_checks already synced)
- Existing notification types

## Error Handling

- `checkHabitForDate` throws on date !== yesterday
- Soft-deleted habits silently skipped
- Settings sync: renderer syncs localStorage → IPC on mount (useEffect), same pattern as existing notification toggles

## Testing

- `checkHabitForDate`: accepts yesterday, rejects today, rejects 2+ days ago
- `checkHabitForDate`: `created_at`/`updated_at` use current time, not check date
- `evaluateHabitNotifications`: generates candidate after configured time, skips before
- `evaluateHabitNotifications` weekly: fires when checks < target during the week, not only Sunday
- `evaluateHabitNotifications` monthly: fires only during last 3 days of month
- Auto-resolve: clears `habit_reminder` when all habits checked
- Badge: does NOT show for weekly habit on Monday (yesterday = previous week)
- Badge: does NOT show for monthly habit on 1st (yesterday = previous month)
- Retroactive XP: awards flat 5 XP, not period-completion gated
