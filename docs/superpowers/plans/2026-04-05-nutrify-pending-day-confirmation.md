# Nutrify: Pending Day Confirmation — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace auto-close with manual day confirmation so users can review/edit before earning XP.

**Architecture:** New IPC endpoint `nutrition:getPendingDays` queries unclosed days with food. Frontend removes auto-close, adds badge on nav arrow, and replaces close-day popup with a confirmation popup showing summary + metrics inputs for past days.

**Tech Stack:** Electron IPC, SQLite, React, i18n

---

## Task 1: Backend — `nutrition:getPendingDays` IPC handler

**Files:**
- Modify: `electron/modules/nutrition.ipc.ts`

- [ ] **Step 1: Add the IPC handler**

Add after the existing `nutrition:isDayClosed` handler. Query finds dates in last 7 days (excluding today) that have food_log entries but no nutrition_daily_closed record:

```typescript
ipcHandle('nutrition:getPendingDays', () => {
  const db = getDb();
  const today = todayDateString();
  const sevenAgo = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return formatDateString(d);
  })();

  const rows = db.prepare(`
    SELECT DISTINCT f.date
    FROM food_log f
    LEFT JOIN nutrition_daily_closed c ON c.date = f.date
    WHERE c.date IS NULL
      AND f.date >= ? AND f.date < ?
    ORDER BY f.date ASC
  `).all(sevenAgo, today) as { date: string }[];

  return rows.map(r => r.date);
});
```

- [ ] **Step 2: Verify `todayDateString` and `formatDateString` are available**

These helpers should already be imported at the top of `nutrition.ipc.ts` (used by existing handlers). If not, they're in the same file as utility functions. Confirm they exist before proceeding.

- [ ] **Step 3: Commit**

```bash
git add electron/modules/nutrition.ipc.ts
git commit -m "feat(nutrition): add getPendingDays IPC handler"
```

---

## Task 2: Preload + Types + i18n

**Files:**
- Modify: `electron/preload.ts`
- Modify: `shared/types.ts`
- Modify: `src/i18n/es.json`
- Modify: `src/i18n/en.json`

- [ ] **Step 1: Add preload bridge**

In `electron/preload.ts`, in the nutrition section (near other `nutrition*` methods), add:

```typescript
nutritionGetPendingDays: () => ipcRenderer.invoke('nutrition:getPendingDays'),
```

- [ ] **Step 2: Add type to HubtifyApi**

In `shared/types.ts`, in the HubtifyApi interface nutrition section, add:

```typescript
nutritionGetPendingDays: () => Promise<string[]>;
```

- [ ] **Step 3: Add i18n keys to es.json**

In `src/i18n/es.json`, inside the `"nutrify"` object, add alphabetically:

```json
"balance": "Balance",
"caloriesConsumed": "Calorías consumidas",
"confirmDay": "Confirmar Día",
"confirmDayPrompt": "¿Confirmar este día y recibir experiencia?",
"confirmDaySummary": "Resumen del día",
"confirmTargetLabel": "Objetivo calórico",
"pendingConfirmation": "Pendiente de confirmar",
```

- [ ] **Step 4: Add i18n keys to en.json**

In `src/i18n/en.json`, inside the `"nutrify"` object, add alphabetically:

```json
"balance": "Balance",
"caloriesConsumed": "Calories consumed",
"confirmDay": "Confirm Day",
"confirmDayPrompt": "Confirm this day and receive experience?",
"confirmDaySummary": "Day summary",
"confirmTargetLabel": "Calorie target",
"pendingConfirmation": "Pending confirmation",
```

- [ ] **Step 5: Commit**

```bash
git add electron/preload.ts shared/types.ts src/i18n/es.json src/i18n/en.json
git commit -m "feat(nutrition): add getPendingDays preload, types, and i18n keys"
```

---

## Task 3: Frontend — Remove auto-close and add pending days state

**Files:**
- Modify: `src/modules/nutrition/components/Today.tsx`

- [ ] **Step 1: Remove the auto-close useEffect**

Delete the entire useEffect block at lines 108-137 that loops through past 7 days and auto-closes them. This is the block that starts with:

```typescript
// Auto-close past days that have food but weren't closed
useEffect(() => {
  (async () => {
    const today = todayDateString();
    for (let i = 1; i <= 7; i++) {
```

Delete through the closing `}, []);`

- [ ] **Step 2: Add pending days state**

Add new state variable near the other state declarations (around line 56):

```typescript
const [pendingDays, setPendingDays] = useState<string[]>([]);
```

- [ ] **Step 3: Add loadPendingDays function**

Add after the `loadData` callback:

```typescript
const loadPendingDays = useCallback(async () => {
  const days = await window.api.nutritionGetPendingDays();
  setPendingDays(days);
}, []);
```

- [ ] **Step 4: Call loadPendingDays on mount and date change**

Add a useEffect after the existing data-loading effects:

```typescript
useEffect(() => {
  loadPendingDays();
}, [date, loadPendingDays]);
```

- [ ] **Step 5: Add loadPendingDays to account:switched listener**

In the existing useEffect at lines 140-150 that listens to `account:switched`, update the handler to also reload pending days:

```typescript
const handler = () => {
  loadData(date);
  loadPendingDays();
};
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/nutrition/components/Today.tsx
git commit -m "feat(nutrition): remove auto-close, add pending days state"
```

---

## Task 4: Frontend — Badge on left arrow

**Files:**
- Modify: `src/modules/nutrition/components/Today.tsx`

- [ ] **Step 1: Compute pending count before current date**

Add a derived value (useMemo or inline) before the return JSX:

```typescript
const pendingBeforeCount = pendingDays.filter(d => d < date).length;
```

- [ ] **Step 2: Update the left arrow button with badge**

Replace the left arrow button (lines 389-394) with:

```tsx
<button className="rpg-button" onClick={() => goDay(-1)}
  style={{ padding: '6px 10px', position: 'relative' }}
  aria-label={`Previous day${pendingBeforeCount > 0 ? `, ${pendingBeforeCount} pending` : ''}`}>
  <svg width="16" height="12" viewBox="0 0 16 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 1L1 6l5 5M1 6h14"/>
  </svg>
  {pendingBeforeCount > 0 && (
    <span style={{
      position: 'absolute', top: -6, right: -6,
      background: 'var(--rpg-gold)', color: 'var(--rpg-wood-dark, #2c1810)',
      borderRadius: '50%', width: 18, height: 18,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '0.7rem', fontWeight: 700,
      border: '1.5px solid var(--rpg-gold-dark)',
    }}>
      {pendingBeforeCount}
    </span>
  )}
</button>
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/nutrition/components/Today.tsx
git commit -m "feat(nutrition): add pending days badge on nav arrow"
```

---

## Task 5: Frontend — Pending day indicator + confirmation button

**Files:**
- Modify: `src/modules/nutrition/components/Today.tsx`

- [ ] **Step 1: Add isPending derived value**

Add near `pendingBeforeCount`:

```typescript
const isToday = date === todayDateString();
const isPending = pendingDays.includes(date);
```

- [ ] **Step 2: Add pending banner below date navigation**

After the date navigation `<div>` (after line 408), before the CalorieProgressBar, add:

```tsx
{isPending && (
  <div data-anim="stagger-child" style={{
    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
    marginBottom: 12, borderRadius: 'var(--rpg-radius)',
    background: 'rgba(255, 193, 7, 0.1)', border: '1px solid var(--rpg-gold)',
    fontSize: '0.85rem', color: 'var(--rpg-gold)',
  }}>
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="7"/><path d="M8 5v3"/><circle cx="8" cy="11" r="0.5" fill="currentColor"/>
    </svg>
    {t('nutrify.pendingConfirmation')}
  </div>
)}
```

- [ ] **Step 3: Update Close Day card title and button for pending days**

In the Close Day card (line 518-552), update the title and button text to show "Confirmar Día" for past pending days:

Change the card title (line 525):
```tsx
{isPending ? t('nutrify.confirmDay') : t('nutrify.closeDay')}
```

Change the button text (line 548):
```tsx
{isPending ? t('nutrify.confirmDay') : t('nutrify.closeDayButton')}
```

- [ ] **Step 4: Commit**

```bash
git add src/modules/nutrition/components/Today.tsx
git commit -m "feat(nutrition): add pending indicator and confirm button text"
```

---

## Task 6: Frontend — Confirmation popup with summary

**Files:**
- Modify: `src/modules/nutrition/components/Today.tsx`

- [ ] **Step 1: Update the close day popup for pending days**

Replace the close day popup (lines 600-639) with a version that shows a summary section when it's a pending day. The popup should:
- For pending days: show read-only summary (calories consumed, target, balance) ABOVE the steps/gym inputs
- For today: keep the existing popup as-is (just steps + gym)

Replace the popup content with:

```tsx
{closeDayPopup && (
  <div style={{
    position: 'fixed', inset: 0, background: 'rgba(44, 24, 16, 0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  }}>
    <div style={{
      background: 'linear-gradient(135deg, var(--rpg-wood) 0%, var(--rpg-leather) 100%)',
      border: '2px solid var(--rpg-gold-dark)',
      borderRadius: 'var(--rpg-radius)', padding: '24px', maxWidth: 380,
      textAlign: 'center', color: 'var(--rpg-parchment)',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
    }}>
      <h3 style={{ fontFamily: 'Cinzel, serif', marginBottom: 16, color: 'var(--rpg-gold-light)' }}>
        {isPending ? t('nutrify.confirmDaySummary') : t('nutrify.closeDay')}
      </h3>

      {/* Summary section for pending days */}
      {isPending && (
        <div style={{ marginBottom: 16, textAlign: 'left', fontSize: '0.85rem', lineHeight: 1.8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ opacity: 0.7 }}>{t('nutrify.caloriesConsumed')}</span>
            <span style={{ fontWeight: 600 }}>{consumed} kcal</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ opacity: 0.7 }}>{t('nutrify.confirmTargetLabel')}</span>
            <span style={{ fontWeight: 600 }}>{target} kcal</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.15)', paddingTop: 4, marginTop: 4 }}>
            <span style={{ opacity: 0.7 }}>{t('nutrify.balance')}</span>
            <span style={{ fontWeight: 700, color: (target - consumed) >= 0 ? 'var(--rpg-xp-green)' : 'var(--rpg-hp-red)' }}>
              {target - consumed >= 0 ? '+' : ''}{target - consumed} kcal
            </span>
          </div>
          <p style={{ fontSize: '0.8rem', opacity: 0.5, marginTop: 8, textAlign: 'center' }}>
            {t('nutrify.confirmDayPrompt')}
          </p>
        </div>
      )}

      {/* Steps input */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', marginBottom: 12, fontSize: '0.9rem' }}>
        <span>{t('nutrify.steps')}</span>
        <RpgNumberInput
          value={popupSteps}
          onChange={setPopupSteps}
          step={100} min={0} max={99999}
          style={{ width: 120 }}
          autoFocus
        />
      </label>
      {/* Gym checkbox */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', marginBottom: 20, fontSize: '0.9rem', cursor: 'pointer' }}
        onClick={() => setPopupGym(!popupGym)}>
        <Checkbox checked={popupGym} onChange={() => setPopupGym(!popupGym)} />
        <span>{t('nutrify.gym')}</span>
      </div>
      {/* Confirm button */}
      <button className="rpg-button" onClick={handleCloseDayConfirm} style={{ width: '100%', marginBottom: 8 }}>
        {isPending ? t('nutrify.confirmDay') : t('nutrify.closeDayButton')}
      </button>
      {/* Cancel button */}
      <button onClick={() => setCloseDayPopup(false)} className="rpg-button"
        style={{ width: '100%', padding: '4px 8px', fontSize: '0.75rem', background: 'transparent', border: '1px solid var(--rpg-gold-dark)', color: 'var(--rpg-gold)' }}>
        {t('questify.cancel')}
      </button>
    </div>
  </div>
)}
```

- [ ] **Step 2: Update handleCloseDayConfirm to reload pending days**

Modify the existing `handleCloseDayConfirm` function (lines 280-287) to reload pending days after closing:

```typescript
const handleCloseDayConfirm = async () => {
  const stepsVal = popupSteps ? parseInt(popupSteps) : null;
  await window.api.nutritionSaveDailyMetrics({ ...metrics, steps: stepsVal, gym: popupGym, date });
  setCloseDayPopup(false);
  await doCloseDay();
  loadPendingDays();
};
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/nutrition/components/Today.tsx
git commit -m "feat(nutrition): confirmation popup with summary for pending days"
```

---

## Task 7: Verification

- [ ] **Step 1: Manual test — pending days appear**
1. Log food for today, navigate to yesterday, log food there too
2. Don't close either day
3. Restart app
4. Verify: no auto-close happens, yesterday shows as pending

- [ ] **Step 2: Manual test — badge count**
1. Create pending days for 2 past dates
2. Verify badge shows "2" on left arrow
3. Navigate back one day to a pending day — badge should show "1"
4. Navigate to the other pending day — badge should show "0" or hidden

- [ ] **Step 3: Manual test — confirmation flow**
1. Navigate to a pending day
2. See the "Pendiente de confirmar" banner
3. Click "Confirmar Día"
4. Popup shows summary (calories, target, balance) + steps/gym inputs
5. Fill in steps, check gym, click "Confirmar Día"
6. XP breakdown appears, toast shows
7. Badge count decreases

- [ ] **Step 4: Manual test — today unchanged**
1. On today's view, click "Cerrar Día"
2. Popup shows only steps + gym (no summary section)
3. Flow works as before

- [ ] **Step 5: Manual test — expiration**
1. If possible, verify that days older than 7 days don't appear as pending (they naturally won't be returned by the query)
