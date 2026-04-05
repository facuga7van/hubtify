# Nutrify: Pending Day Confirmation

## Problem

When Nutrify auto-closes past days on app mount, users can't review or correct their food logs before XP is awarded. This means inaccurate data gets rewarded and there's no chance to fix mistakes.

## Solution

Remove auto-close. Past days with food logged but not closed become "pending" days. Users navigate to them, review/edit, and manually confirm to earn XP. Days older than 7 days expire (no XP).

## Design

### Backend Changes (`electron/modules/nutrition.ipc.ts`)

#### 1. New IPC: `nutrition:getPendingDays`
- Query: find dates in last 7 days (excluding today) that have entries in `food_log` but NO record in `nutrition_daily_closed`
- Returns: `string[]` — array of date strings (`YYYY-MM-DD`), sorted ascending
- Used by frontend to show badge count and determine pending status

#### 2. Remove auto-close logic
- The auto-close lives in `Today.tsx` frontend (useEffect on mount that scans last 7 days and calls `nutrition:closeDay` for each unclosed day with food). Remove that entire block.
- The `nutrition:closeDay` IPC handler stays as-is — it's the same mechanism, just no longer called automatically.

### Frontend Changes (`src/modules/nutrition/components/Today.tsx`)

#### 1. Remove auto-close useEffect
- Delete the useEffect that scans past days and auto-closes them on mount

#### 2. Badge on left navigation arrow
- Call `nutrition:getPendingDays` on mount and when date changes
- Count how many pending days are BEFORE the currently viewed date
- Display a small badge (number) on the left arrow ("previous day" button)
- Badge updates dynamically as user navigates:
  - Viewing Friday, pending: Tue+Thu → badge shows "2"
  - Navigate to Thursday (pending) → badge shows "1" (only Tue is before)
  - Navigate to Wednesday (not pending) → badge still shows "1"
  - Navigate to Tuesday (pending) → badge shows "0" or hidden
- Badge hidden when count is 0
- Badge styling: small circle positioned absolutely on top-right of the left arrow button. Background: `--rpg-gold`, text: dark, font-size ~0.7rem. Include count in button's aria-label.

#### 3. Pending day indicator
- When viewing a pending day (date is in pendingDays list), show a visual indicator
- A subtle banner or status text near the date showing it's pending confirmation
- Style: use `--rpg-gold` color, RPG-themed

#### 4. Confirmation button
- For past pending days: show "Confirmar Dia" button instead of "Cerrar Dia"
- For today: keep "Cerrar Dia" as-is
- i18n keys: `nutrify.confirmDay` / `nutrify.closeDay`

#### 5. Confirmation popup
- Clicking "Confirmar Dia" opens a custom modal (not `useConfirm`, which only supports plain text). Follow the pattern of the existing close-day popup in Today.tsx.
- The popup shows:
  - **Read-only summary:**
    - Total calories consumed
    - Calorie target (TDEE - deficit)
    - Balance (target - consumed)
  - **Editable inputs** (same as the current close-day flow in Today.tsx):
    - Steps: number input
    - Gym: checkbox
- Two buttons: "Confirmar" (proceeds to save metrics + close day + XP) and "Cancelar"
- On confirm: save metrics via `nutrition:saveDailyMetrics` (steps + gym), then reuse the existing `doCloseDay()` function from Today.tsx (which calls `nutrition:closeDay`, then `processRpgEvent`, dispatches `rpg:statsChanged`, and shows toast/XP breakdown). After successful confirmation, reload pending days so badge updates immediately.
- Style: RPG card style, similar to existing modals in the app

### Preload (`electron/preload.ts`)
- Add `nutritionGetPendingDays: () => ipcRenderer.invoke('nutrition:getPendingDays')`

### Types (`shared/types.ts`)
- Add `nutritionGetPendingDays: () => Promise<string[]>` to HubtifyApi interface

### i18n (`src/i18n/es.json` and `en.json`)
- `nutrify.confirmDay`: "Confirmar Dia" / "Confirm Day"
- `nutrify.pendingConfirmation`: "Pendiente de confirmar" / "Pending confirmation"
- `nutrify.confirmDaySummary`: "Resumen del dia" / "Day summary"
- `nutrify.caloriesConsumed`: "Calorias consumidas" / "Calories consumed"
- `nutrify.confirmTargetLabel`: "Objetivo calorico" / "Calorie target"
- `nutrify.steps`: "Pasos" / "Steps"
- `nutrify.gym`: "Gimnasio" / "Gym"
- `nutrify.balance`: "Balance" / "Balance"
- `nutrify.confirmDayPrompt`: "Confirmar este dia y recibir experiencia?" / "Confirm this day and receive experience?"

### What stays the same
- XP/HP calculation logic in `nutrition:closeDay` — untouched
- XP breakdown popup after confirmation — untouched
- Day navigation — untouched (already exists)
- Today's "Cerrar Dia" flow — untouched
- Weight check-in popup — untouched
- `account:switched` listener — must also reload pending days state (in addition to existing data reload)

### Expiration rule
- Days older than 7 days with food but not confirmed simply expire
- No XP awarded, no record created in `nutrition_daily_closed`
- The `getPendingDays` query only looks at last 7 days, so expired days naturally disappear

### Edge cases
- Day with 0 food entries: not pending (nothing to confirm)
- Today: always uses "Cerrar Dia", never shows as "pending"
- Day already closed: not pending, shows breakdown as currently
- Navigating to a day older than 7 days: no pending indicator, no confirm button
