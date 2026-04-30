# Hubtify — App Map (Complete UI & Feature Reference)

> Gamified life hub: Electron 41 + React 19 + TypeScript + better-sqlite3 + Firebase Firestore.
> Medieval RPG theme with parchment, leather, gold, and ink aesthetics.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Design System](#2-design-system)
3. [Hub / Shell](#3-hub--shell)
4. [Questify (Tasks)](#4-questify-tasks)
5. [Coinify (Finance)](#5-coinify-finance)
6. [Nutrify (Nutrition)](#6-nutrify-nutrition)
7. [Cauldron (Pomodoro)](#7-cauldron-pomodoro)
8. [Character (Avatar)](#8-character-avatar)
9. [Cross-Cutting Systems](#9-cross-cutting-systems)

---

## 1. Architecture Overview

### Route Map

```
/login                    Auth gate
  /login                  Login/Register page
  /login/add              Add new account (multi-account)

/                         Authenticated shell (after onboarding)
  /                       Dashboard (Codex home)
  /character              Character profile & stats
  /quests                 Questify — Task management
  /nutrition              Nutrify — Today (food logging)
  /nutrition/dashboard    Nutrify — Charts & analytics
  /nutrition/settings     Nutrify — Profile & goals
  /finance                Coinify — Dashboard
  /finance/transactions   Coinify — Ledger
  /finance/installments   Coinify — Cuotas
  /finance/cards          Coinify — Credit cards
  /finance/loans          Coinify — Loans
  /finance/recurring      Coinify — Recurring items
  /finance/import         Coinify — PDF import
  /cauldron               Cauldron — Pomodoro timer
  /settings               App settings
```

### Sidebar Navigation

| Path | Label | Icon | Badge |
|------|-------|------|-------|
| `/` | TABLA | scroll | — |
| `/quests` | MISIONES | sword | overdue task count |
| `/nutrition` | PROVISIONES | bread | dot if no meals today |
| `/finance` | TESORO | coin | — |
| `/cauldron` | CALDERO | cauldron | — |
| `/achievements` | LOGROS | crown | Coming Soon |
| `/village` | ALDEA | tower | Coming Soon |
| `/character` | HEROE | shield | (bottom section) |
| `/settings` | Settings | gear | (bottom section) |

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+1–6 | Navigate to module |
| Ctrl+, | Settings |
| Ctrl+Q | Toggle sidebar collapse |

---

## 2. Design System

### Color Palette (CSS Variables)

**Codex Palette:**
- `--ink` #2a1d0e — Primary text
- `--ink-soft` #4a3520 — Secondary text
- `--ink-faded` #4a3520 — Hints, disabled
- `--rubric` #7a1e1e — Danger, HP, expenses
- `--rubric-light` #a43030 — Hover danger
- `--moss` #556b3c — Success, XP, income
- `--moss-light` #6b8a4c — Light success
- `--gold` #a88a3c — Primary accent, interactive
- `--gold-light` #c4a84e — Highlights
- `--gold-dark` #8a7030 — Borders, shadows
- `--parch-0` #f5e7c0 — Lightest parchment
- `--parch-1` #e8d5a3 — Mid parchment
- `--parch-2` #d4bc82 — Darker parchment
- `--parch-3` #b89a6a — Deep parchment
- `--leather` #3a2513 — Button bg, dark interactive
- `--leather-light` #5c3a1e — Button hover
- `--leather-dark` #2a1d0e — Darkest (title bar)

### Typography

| Usage | Font | Size Var |
|-------|------|----------|
| Timer display | UnifrakturCook | `--fs-timer` 64px |
| Page titles | UnifrakturCook | `--fs-display` 34px |
| Big values | UnifrakturCook | `--fs-hero` 28px |
| Stat values | Cinzel | `--fs-stat` 24px |
| Section titles | Cinzel | `--fs-accent` 22px |
| Subheadings | Cinzel | `--fs-heading` 20px |
| Nav items | Cinzel | `--fs-nav` 18px |
| Standard text | Crimson Text | `--fs-body` 15px |
| Epigraphs | Cormorant Garamond italic | `--fs-quote` 16px |
| Handwritten feel | IM Fell English | n/a |
| Labels (min) | Crimson Text | `--fs-label` 13px |
| Code/numbers | Fira Code | n/a |

Font scale adjustable via `--font-scale` (Compact/Normal/Large/XLarge).

### Base Components

**`.rpg-card`** — Primary container: parchment gradient bg, 2px gold border, radius 6px, inner border via ::before, inset shadow.

**`.rpg-button`** — Leather gradient bg, gold text, gold-dark border. Hover: gradient inverts. Variants: `.rpg-btn-sm`, `.rpg-btn-active`, disabled (50% opacity).

**`.rpg-bar`** — Progress bars (HP/XP): 16px height, parchment bg, striped animated fill. HP = red stripes, XP = green stripes.

**`.rpg-input` / `.rpg-select`** — Parchment bg, gold-dark border. Focus: gold border + gold shadow.

### Shared React Components

| Component | Purpose |
|-----------|---------|
| `QuillCheckbox` | Animated quill-pen drawn checkmark with ink splatter |
| `Toast` / `ToastProvider` | Bottom-right notifications (xp/coin/nutri/success/warning/info). Max 3 visible, 2.5s auto-dismiss, slide-in animation |
| `ConfirmDialog` / `useConfirm()` | RPG-themed modal confirmation. Parchment card, gold border, danger variant |
| `PageHeader` | Fraktur title + italic subtitle + ornamental line + actions |
| `RpgNumberInput` | Number input with hold-to-repeat ± buttons, leather gradient |
| `RpgStepper` | Compact ± inline control |
| `NotificationBell` | SVG bell with badge count, pulse animation |
| `Tooltip` | Fixed-position portal, leather bg, gold border, smart positioning |
| `Loading` | Spinning compass rose SVG (2s rotation) |
| `HpBar` / `XpBar` | Striped progress bars with gleam animation on change |
| `Checkbox` | Wrapper around QuillCheckbox |

### Icon System

All icons are inline SVGs, 24x24 viewBox, `currentColor` inheritance, stroke-based.

**CodexIcons:** Sword, Shield, Potion, Coin, Scroll, Chalice, Herb, Bread, Crown, Tower, Cauldron, Gear, etc.

**Ornaments:** Flourish, QBDivider, CornerBracket (4 corners with screw dots), TopRule.

### Animation System (GSAP)

**Feedback animations:**
- `completeTask()` — Strikethrough sweep + text fade
- `removeItem()` — Slide left + fade
- `addTransaction()` — Slide right + border flash
- `registerFood()` — Scale bounce + fade
- `barGleam()` — Gold gradient overlay slides across bar

**Epic animations:**
- `levelUp()` — 4.5s sequence: screen flash → shockwave → shake → god rays → 100 golden particles → "LEVEL UP" text elastic-in → level number → auto-dismiss
- `streakAchieved()` — Scale bounce + box-shadow pulse + sparks
- `loanPaidOff()` — Chain break shake + wax seal stamp + border glow

**Page transitions:**
- `pageTurnExit()` — 3D rotateY flip with shadow
- `pageEnter()` — Stagger children with opacity + x slide
- `bookOpen()` — Cover flips open, content fades in with stagger

**Particle system:** Canvas-based burst (100 golden particles, radial velocity, gravity, alpha decay). HiDPI-aware.

All animations respect `prefers-reduced-motion` (simplified to basic fades).

### Z-Index Scale

```
--z-base:         1       (decorative)
--z-dropdown:     50      (form dropdowns)
--z-floating:     100     (floating timer)
--z-sidebar:      999     (navigation)
--z-overlay:      1000    (modal backdrop)
--z-modal:        5000    (full modals)
--z-toast:        8000    (XP/feedback toasts)
--z-dropdown-top: 9000    (account dropdown)
--z-tour:         9500    (onboarding overlay)
--z-system-toast: 10003   (topmost)
```

---

## 3. Hub / Shell

### Layout (`Layout.tsx`)

Main application shell wrapping all authenticated views.

**Structure:**
- **Top:** TitleBar (Electron window controls)
- **Left:** Collapsible Sidebar (Ctrl+Q)
  - PlayerCard (avatar + account dropdown)
  - Stat bars: HP, XP, Streak
  - Main navigation (7 items + 2 bottom)
  - Footer: combo indicator, language toggle, version
- **Main:** AnimatedOutlet with GSAP page transitions
  - Sync error banner (retry button)
  - Level-up overlay (epic animation on level increase)

**Global features:** Auto-sync (push on change/30s debounce, pull on focus), keyboard shortcuts, update notification popup, floating Cauldron timer, tour provider, toast notifications.

### PlayerCard (`PlayerCard.tsx`)

- Avatar circle (72px, gold border ring)
- Level badge (top-right corner)
- Character name (clickable → AccountDropdown)
- Title + Level eyebrow
- Notification bell (if enabled)

### AccountDropdown (`AccountDropdown.tsx`)

Portal-rendered dropdown:
- Active account (green dot)
- Cached accounts (click to switch)
- "Add Account" button → `/login/add`
- "Sign Out" button

**Multi-account flow:** Click account → `switchAccount()` → fires `account:switched` event → all components reload data.

### Dashboard (`Dashboard.tsx`)

BookPage layout (medieval codex). Eyebrow: "HUBTIFY — CODICE DEL AVENTURERO"

**Sections:**
1. **Salutation + Wax Seal** — Random Latin epigraph, greeting with player name/date/streak, interactive "Level Seal" button
2. **Stat Cartouches** (4): NIVEL (level+title), XP HODIE (today's XP), RACHA (streak+flame), VITA (HP/maxHP)
3. **Quick Module Stats** (3): Tasks due today, meals logged, transactions today
4. **Module Cards** (2x2 grid): Clickable cards linking to each module with Latin names and icons
5. **Recent Chronicle** (left): Last 8 RPG events with icons, descriptions, +XP, time elapsed
6. **XP Ledger** (right): 7-day mini bar chart (XP per day)

**States:** Loading (skeleton), Error (retry button), Loaded.

### Auth Page (`AuthPage.tsx`)

Centered card with medieval ornaments.

**Modes:**
- Login: Email + password
- Register: Email + password + username
- Add Account: Same as login but returns to app
- Forgot Password: Email-only → sends reset link

### Onboarding (`Onboarding.tsx`)

4-step wizard (shown after first login).

**Step 0 — Welcome:** Language toggle (ES/EN), font scale (4 options), toggles (sounds, help bubbles, notifications), "Start Adventure" button.

**Step 1 — Character Creation:** Hero name input (max 24), character customizer (128px avatar).

**Step 2 — Nutrition Setup** (optional): Body info (DOB, sex, height, weight, activity) + goal selection (deficit/maintain/surplus) + TDEE calculation.

**Step 3 — Ready:** Success icon, "Start Exploring" button.

Visual: Step indicator dots (wax seal style), slide transitions.

### Settings Page (`SettingsPage.tsx`)

Sections:
1. **About** — Version + changelog
2. **Language** — ES/EN toggle
3. **Font Size** — 4 presets
4. **Sound Effects** — Toggle
5. **Help Bubbles** — Toggle
6. **Notifications** — In-app + system + per-module toggles (Questify, Nutrify, Coinify)
7. **Cloud Sync** — Upload/download buttons, status, logout
8. **Backup** — Export/import file dialogs
9. **Keyboard Shortcuts** — Static list
10. **Feedback** — Opens FeedbackDialog
11. **Danger Zone** — Reset onboarding, restart tour, reset all data

---

## 4. Questify (Tasks)

**Route:** `/quests` | **CSS prefix:** `.quest-*`

### Main Screen: TaskList

**Two-column layout:**

**Left Column (Tasks):**
- **Stats strip** (4 badges): IN PROGRESS | OVERDUE | TODAY'S DUE | COMPLETED
- **Task form** — Quick add (name + submit) or full form (tier, description, project, category, due date)
- **Tab bar** — Pending/Completed tabs + project selector + category filter + batch actions (Complete N / Delete N)
- **Task display:**
  - Pending: Grouped by due date (Overdue → Today → This Week → Later → No Date), collapsible groups, drag-sortable within groups (dnd-kit)
  - Completed: Sorted by completedAt, strikethrough, faded

**Right Column:**
- **Habits section** — Daily/weekly/monthly habit tracker with streaks and heatmap
- **Campaigns section** — Project progress bars (color-coded)
- **Actions** — "Manage Projects" button

### Task Row (`SortableQuestRow`)

```
[drag] [checkbox] [tier-gem] Title          [subtask gauge]  [+XP] [actions]
                   Category . Date
```

**Tier badges:** GemRough (5 XP), GemCut (15 XP), GemBrilliant (40 XP)

**States:** Pending (normal), Overdue (red tint), Completing (animation), Completed (faded + strikethrough)

**Actions per row:** Due date badge (color-coded), notes icon (with count), edit, select checkbox

**Completion flow:** Click checkbox → quill-draw animation → API call → RPG event TASK_COMPLETED → XP toast with bonus tier + combo multiplier → stats refresh.

**XP bonus system:** Normal (70%, 1x), Good (20%, 1.5x), Critical (8%, 2x), Legendary (2%, 3x). Final XP = base × combo × bonus.

### Subtasks (`SubtaskList`)

Nested under task row (expandable). Max 30 per task.
- Drag-reorderable
- Add/edit inline form (name, description, tier)
- Check/uncheck with RPG events
- 2-step delete confirmation
- Show/hide completed toggle

### Habits (`HabitTracker`)

Grid layout: habit name | frequency | progress (weekly/monthly) | streak + flame | check | edit | delete

- Frequencies: daily, weekly (N times/week), monthly
- Habit heatmap: 30-day activity calendar (collapsible), color intensity by activity ratio
- XP: 5 + min(streak, 10) on period complete

### Projects (`ProjectManager`)

Modal: CRUD projects with 8 medieval color options (tierra, verde musgo, borravino, azul pizarra, dorado oscuro, violeta, cobre, verde agua).

### Scroll Notes (`ScrollNotes`)

Per-task canvas drawing system:
- 500x350 canvas with parchment texture background
- Pen tool (ink color #3a2a1a, 2px) + eraser (18px)
- Multi-page navigation (prev/next/new)
- Auto-save on nav/close, PNG data URL storage

### Dashboard Widget

Mini view: 4 pending tasks with quick-complete checkboxes, done count, overdue count, first 3 habit streaks.

---

## 5. Coinify (Finance)

**Route:** `/finance/*` | **CSS prefix:** `.coin-*`

### Finance Layout

Header tabs: Dashboard | Transactions | Installments | Credit Cards | Loans

Header extras: DollarChip (live USD rates) + CryptoChip (live crypto prices).

### Dashboard

**Month navigator** + range mode (month/quarter/year/all-time) + CSV export.

**Sections:**
1. **Treasure Chest Panel** — Interactive SVG chest (click bounces + coin sound). Shows net balance (ARS), USD balance, trend % vs previous month, 6-month sparkline
2. **Income Card** — Animated green amount + gauge
3. **Expenses Card** — Animated red amount + active installments + credit card pending
4. **Previous Month Comparison** (toggle) — Side-by-side cartouches
5. **Category Breakdown** — SVG pie/donut chart + legend table
6. **Loans & Debts** — "Owed" (green) vs "Owing" (red) cards
7. **3-Month Projection** — Line chart for installments + recurring
8. **Quick Actions** — "+ Expense" / "+ Income" buttons

### Transactions

**Month navigator** + "Recurring" / "Import" / "+ Quick Add" buttons.

**Quick Add Form:** Type toggle (expense/income), amount, category (with auto-suggestion from merchant patterns), description. Advanced: date, currency (ARS/USD), payment method, credit card + installments.

**Ledger:** Sortable columns (Date, Description, Category, Amount). Filters: type + payment method. Collapsible sections (normal vs recurring). Each row: day, description, category rune, anomaly indicator (>1.5x monthly avg), source icon, payment method, amount. Inline editing. Pagination (50 per page).

**Anomaly detection:** Warning icon on transactions where category spending > 1.5x monthly average.

### Import (PDF Statements)

4-step flow:
1. Select PDF → parse via Electron backend
2. Error handling
3. Preview table: Include checkbox | Date | Merchant | Installment | Amount | Currency | Category dropdown. Skipped lines warning.
4. Confirm: month selector, import button, seal animation on success

### Installments

**Month navigator** + "New installment" form.

**Groups display:** Description, progress gauge (current/total), delete button. Rows: "Cuota X/Y", third-party indicator (→ person), amount (click to edit inline).

**Month summary cartouches:** Own installments | Third party | Net total.

**12-month projection chart** (CastleBarChart).

### Credit Cards

**Manage Credit Cards** button → modal (CRUD: name + closing day).

**Statements per card:** Card name, closing day, period range, amount + status badge (Pending red / Paid green), "Details" button or "Generate Statement" button.

**Statement Detail Modal:** Calculated amount, transaction list, pay input + button (if pending), paid date (if paid).

### Loans

**Tabs:** Lent / Borrowed.

**Add form:** Person name, direction, type (single/installments), amount, currency, installment count, category, description, date.

**Display:** Grouped by person (avatar = first letter). Single loans: settle button (confirmation + animation + XP). Installment groups: gauge + "Mark payment" button → payment modal. Settled section (collapsible, lower opacity).

### Recurring

**List of recurring items.** Each card: active/pause toggle, name, type badge (expense red/income green), category, billing day, days until next, amount (click to edit), edit/history/delete buttons.

**Amount history:** Timeline of changes (strikethrough old → new + date).

**Generate button:** Creates transactions for current month. Coin drop animation on success.

### DollarChip

Button: "USD $[rate]". Dropdown: 7 exchange rate types (oficial, blue, bolsa, cripto, tarjeta, CCL, mayorista). Config mode: toggle visibility per type.

### CryptoChip

Button: featured crypto + price. Dropdown: visible cryptos with 24h change %. Config mode: searchable list, toggle visibility. Data from CoinGecko.

### Dashboard Widget

Compact: income (green) + expense (red) + spend gauge + month progress rune + active loans.

---

## 6. Nutrify (Nutrition)

**Route:** `/nutrition/*` | **CSS prefix:** `.nutri-*`

### Today Screen (`Today.tsx`)

**Main daily food logging interface.**

**Sections:**

1. **Hero Card (Daily Calories)**
   - Date navigation (← date →, pending badge for unclosed days)
   - Circular progress ring (160px): consumed kcal center, color by target (red=over, green=in range, gold=under)
   - Detail panel: remaining, target range (±5% tolerance), progress %, goal note
   - Contextual status message (good/warn/bad/muted)

2. **Food Input Card** (if day not closed)
   - Mode toggle: AI Mode / Manual
   - **AI Mode:** Natural language input → Firebase function estimates calories → shows breakdown → editable total → confirm/favorite/dismiss
   - **Manual Mode:** Description + calories input

3. **Favorite Foods Card** (collapsible)
   - Pill buttons: click to quick-log, right-click to remove

4. **Food Log Card**
   - Title + "X meals, Y kcal" + delete-day button
   - Grouped by meal type (Breakfast/Lunch/Dinner/Snack)
   - Each meal group: icon, name, total kcal, food item rows
   - Empty state: "No hay comidas..."

5. **Frequent Foods Card**
   - Searchable, ordered by usage frequency
   - Quick-log pills (max 12 shown)

6. **Close Day Card**
   - If open: consumed | target | diff % + "Close Day" button
   - If closed: status + reward breakdown (XP + HP)

**Modals:**
- **Weight Check-in:** Weekly reminder (if enabled). Input + save/dismiss. Shows last weight as hint.
- **Close Day Confirmation:** Steps input (0–99999), gym checkbox, consumed/target/balance summary.

### Food Log Item (`FoodLogItem.tsx`)

Row states:
- **Normal:** Meal icon (clickable dropdown), description, time, calories, AI breakdown toggle, edit/delete/favorite buttons
- **Editing:** Description input, calories input, re-estimate button
- **Breakdown expanded:** Nested items list
- **Delete confirmation:** Full-width bar

New item animation: gold pulse outline + bounce (GSAP).

### Meal Auto-Assignment

System checks current time against meal schedule windows. Falls back to "snack" (catch-all). User can override via dropdown.

### Settings Screen (`NutritionSettings.tsx`)

Sections:
1. **Body Info** — DOB, sex, height, weight, activity level, calculated TDEE (Mifflin-St Jeor)
2. **Goal** — Deficit/Maintain/Surplus + amount input. Daily target = TDEE ± adjustment
3. **Meal Schedule** — Enable/disable meals + time ranges (breakfast/lunch/dinner) + snack as catch-all. Overlap warning.
4. **Weight Reminder** — Weekly enable + day selector (Mon–Sun)

### Charts Screen (`NutritionCharts.tsx`)

Page: "ALCHEMIST'S CHRONICLE". Range selector: 7d / 30d / 90d / Year.

**KPI Strip:** Precision (% days within ±10%), Weight (latest + delta), Streak, Days Logged.

**Charts:**
1. **Towers of Sustenance** (CastleBarChart) — Daily calorie bars + goal line. Colors: red (over), gold (ok), muted (under)
2. **Weight Journey** (TreasureLineChart) — Smoothed trend + velocity (kg/week). Green if direction matches goal.
3. **Consistency Calendar** (HeatmapCalendar) — Full-width, cell colors by precision %

### RPG Integration

- **MEAL_LOGGED:** +10 XP on every food log
- **DAY_SUMMARY:** XP from precision + steps + gym + weight. HP change based on goal achievement (deficit: heal if under target, damage if over TDEE; surplus: inverted; maintain: ±10% heals)

### Dashboard Widget

Ring gauge (68px, color-coded) + "X of Y kcal" + 7-day sparkline + status rune badge.

---

## 7. Cauldron (Pomodoro)

**Route:** `/cauldron` | **CSS prefix:** `.cauldron-*`

### Main Screen (`CauldronPage.tsx`)

BookPage layout (medieval codex).

**Structure:**
- **Preset selector pills** — Tabbed presets + "+ New Recipe" button
- **Timer Hero (2-column grid):**
  - **Left (Cauldron Stage):** Animated SVG cauldron with dynamic liquid fill, flames, embers, steam. Time display (MM:SS Fraktur). Cycle progress dots (idle/pulsing/gold). Rotating flavor text.
  - **Right (Info Panel):** "Now Brewing" card (preset info, durations, cycles, XP reward). Progress gauge. Control buttons (Start/Pause/Resume/Skip/Stop). "Ingredients" checklist.
- **Statistics (Brewing Log):** Cartouches: Today, This Week, Total, Streak. Shimmer on count increase.
- **Weekly Focus Chart** (CastleBarChart) — Cycles per day.
- **Session History** — Collapsible, paginated.

### State Machine

```
idle → work → on_break → work → on_break → ... → idle
         ↕                  ↕
    work_paused         break_paused
```

Session types: work (red), break (green), long_break (gold).

Default presets: Classic (25/5/15, 4x), Long Focus (50/10/30, 3x), Quick Sprint (15/3/10, 4x).

### Preset Editor Modal

Fields: Name (max 32), Work min (1–180), Break min (1–60), Long Break min (1–120), Cycles (2–8).
Cycle preview bar showing proportional segments.

### Floating Timer (`CauldronFloatingTimer.tsx`)

Fixed bottom-right overlay (visible when timer active). Phase tag (colored rune), time (MM:SS), pause/resume button, striped progress bar. Click navigates to `/cauldron`. Phase-colored pulsing glow.

### RPG Integration

- **POMODORO_COMPLETED:** +20 XP on work phase complete.
- XP toast with message, stats refresh.

### Dashboard Widget

When idle: brews today count + "Quick Brew" button. When active: timer MM:SS + session type + cycle indicator + pause badge.

### Cauldron Visuals

- Liquid waves (3s cycle), color by phase
- Bubbles rise (2.5–3.2s stagger)
- Embers float up (2.2–3.2s)
- Steam plumes (3.6s infinite)
- Fire under cauldron (0.8–1.3s)
- Cycle dots pulse (1.4s)
- Ambient orbs when active (GSAP)
- Brew complete celebration (GSAP timeline)

---

## 8. Character (Avatar)

**Route:** `/character`

### Character Page (`CharacterPage.tsx`)

BookPage layout. Eyebrow: "TOMO V — EFFIGIES HEROIS"

**Left Column:**
1. **Portrait Frame** — Large avatar (160px) + banner with name (uppercase)
2. **Name Editor** — Click-to-edit, inline input (max 30), save on Enter/blur
3. **Level & Motto** — "NIVEL X . Title", medieval motto
4. **HP & XP Bars** — Current/max gauges, XP to next level, next title preview
5. **Wax Seals** (3) — Total tasks completed, streak days, royal seal

**Right Column:**
1. **Virtues of the Hero** (6 gauges): Strength (HP), Wisdom (tasks), Temperance (meals), Dexterity (combo), Fortune (expenses), Spirit (streak). Each: icon + name + value (cap 99) + % gauge.
2. **Book of Deeds** (8-stat grid): MISIONES, VIANDAS, MONEDAS, COMBO, RACHA, NIVEL, XP TOTAL, SALUD MAX
3. **Recent Chronicle** (12 events) — Icon + type + XP (positive/negative)
4. **Title Trail** — Horizontal progression line with nodes: future (gray), done (gold), current (highlighted). Titles sorted by level.

---

## 9. Cross-Cutting Systems

### Multi-Account Sync

- **Push:** Debounced 30s on data change, immediate on window blur
- **Pull:** Immediate on window focus, on mount
- **Events:** `account:switched` fires on switch/add/logout → all components reload
- **Storage:** Firestore subcollections per user (`hubtify_users/{uid}/module/data`)
- **Conflict resolution:** INSERT OR IGNORE, soft deletes (`deleted_at`), LWW (last-write-wins)

### RPG System

Modules emit events via `window.api.processRpgEvent()`. Each module defines handlers.

**Stats:** level, xp, maxHp, hp, streak, dailyCombo, totalTasks, totalMeals, totalExpenses, title.

**Combo multiplier:** 1.0–2.0x based on daily activity count.

**Titles by level:** Progression from "Aprendiz" through higher ranks.

**Level-up:** Full-screen epic animation (flash + shockwave + shake + god rays + 100 particles + text).

### Toast System

Types: xp (green), coin (gold), nutri (red), success, warning, info.
Fixed bottom-right, max 3 visible, 2.5s auto-dismiss, hover pauses timer.

### Event Bus

| Event | Trigger | Listeners |
|-------|---------|-----------|
| `account:switched` | Account switch/logout/add | All data-loading components |
| `rpg:statsChanged` | Any RPG event | Dashboard, Sidebar, Layout |
| `quests:dataChanged` | Quest CRUD | Layout sync |
| `finance:dataChanged` | Finance CRUD | Layout sync |
| `nutrition:dataChanged` | Nutrition CRUD | Layout sync |
| `cauldron:dataChanged` | Cauldron session end | Layout sync |
| `character:nameChanged` | Name edit | PlayerCard, CharacterPage |

### i18n

Files: `src/i18n/es.json`, `src/i18n/en.json`. Nested by module (coinify.*, questify.*, nutri.*, etc.). Spanish primary (fallbackLng). Always use fallback: `t('key', 'Default text')`.

### Notifications

**In-app:** Bell icon → notification center per module. Quests: overdue. Nutrition: unclosed days. Finance: payment dates.

**System:** Windows native notifications (toggleable per module).

---

## Appendix: Module CSS Prefixes

| Module | Prefix | Example |
|--------|--------|---------|
| Hub/Shell | `.rpg-*`, `.dashboard-*`, `.auth-*`, `.onboarding-*` | `.rpg-card`, `.dashboard-grid` |
| Questify | `.quest-*` | `.quest-row`, `.quest-habit-row` |
| Coinify | `.coin-*` | `.coin-dashboard`, `.coin-ledger` |
| Nutrify | `.nutri-*` | `.nutri-hero-card`, `.nutri-meal-group` |
| Cauldron | `.cauldron-*` | `.cauldron-stage`, `.cauldron-floating-timer` |
| Character | `.hero-*` | `.hero-portrait-frame`, `.hero-virtues-grid` |
| Settings | `.settings-*` | `.settings-toggle` |
