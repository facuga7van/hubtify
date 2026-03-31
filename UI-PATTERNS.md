# UI Patterns Reference

Reusable animation, component, and style patterns established across modules.
Reference this file when working on any module to maintain visual consistency.

## Reusable Components

### AnimatedNumber
**Origin:** Coinify UX overhaul (2026-03-29)
**Location:** `src/modules/finance/components/shared/AnimatedNumber.tsx`
**Purpose:** Counter that animates from 0 (or previous value) to target value with easing.
**Props:** `{ value, duration?, prefix?, locale? }`
**Details:**
- Uses `requestAnimationFrame` for 60fps
- Default duration: 600ms
- Handles negatives: sign before prefix (`-$15,000`)
- Formats with `toLocaleString`
**Use for:** Any numeric KPI that changes (XP totals, calorie counts, streaks, balances)

### CoinStatCard
**Origin:** Coinify UX overhaul (2026-03-29)
**Location:** `src/modules/finance/components/shared/CoinStatCard.tsx`
**Purpose:** Stat card with icon + animated number + label. Based on `rpg-stat-card`.
**Props:** `{ icon: ReactNode, label, value, color?, prefix? }`
**Use for:** KPI grids on any dashboard/summary page

### DonutChart
**Origin:** Coinify UX overhaul (2026-03-29)
**Location:** `src/modules/finance/components/shared/DonutChart.tsx`
**Purpose:** Pure SVG donut chart with animated segments and center total.
**Props:** `{ data: Array<{ label, value, color }> }`
**Details:** Uses `stroke-dashoffset` transitions, no Recharts dependency
**Use for:** Category breakdowns, distribution visualizations

### BalanceBar
**Origin:** Coinify UX overhaul (2026-03-29)
**Location:** `src/modules/finance/components/shared/BalanceBar.tsx`
**Purpose:** Dual-segment horizontal bar (e.g., income vs expenses, done vs remaining).
**Props:** `{ income, expenses }` (generalize props if reusing)
**Use for:** Any two-value comparison bar (calories in vs out, tasks done vs pending)

## Feedback Toast Pattern

**Origin:** Coinify UX overhaul (2026-03-29), modeled after Quests `XpToast`
**Architecture:**
1. Create a `<ModuleToastProvider>` context wrapping the module layout
2. Provider renders the toast component (fixed, bottom-right)
3. `useModuleToast()` hook exposes `showToast(type, message)`
4. One toast at a time, auto-dismiss 2.5s, new replaces existing
**Coinify impl:** `CoinToastProvider.tsx` + `CoinToast.tsx`
**Use for:** Any module that needs action feedback (achievement unlocked, habit checked, day closed)

## Animation Patterns

### Staggered Fade-In
**CSS:** Uses existing `contentFadeIn` keyframe with incremental `animation-delay`.
```css
.section:nth-child(1) { animation-delay: 0ms; }
.section:nth-child(2) { animation-delay: 50ms; }
.section:nth-child(3) { animation-delay: 100ms; }
/* etc. */
```
**Use for:** Dashboard sections, list items appearing on page load

### Card Entry / Exit
**Entry:** `translateY(-10px) + opacity 0` to `translateY(0) + opacity 1` in 300ms ease-out
**Exit:** `opacity 1` to `opacity 0 + translateX(-20px)` in 300ms ease-in
**Use for:** Adding/removing items in any list (tasks, food entries, transactions)

### Inline Edit Pulse
**CSS:** Pulsing gold border while editing inline.
```css
@keyframes coinPulseGold {
  0%, 100% { border-color: var(--rpg-gold); }
  50% { border-color: var(--rpg-gold-light); box-shadow: 0 0 6px rgba(201, 168, 76, 0.4); }
}
```
**Duration:** 1.5s infinite
**Use for:** Any inline editing state across modules

### Skeleton / Shimmer Loading
**CSS:** Parchment-colored placeholder with left-to-right shimmer.
```css
@keyframes coinShimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
.coin-skeleton {
  background: linear-gradient(90deg, var(--rpg-parchment-dark) 25%, var(--rpg-parchment-light) 50%, var(--rpg-parchment-dark) 75%);
  background-size: 200% 100%;
  animation: coinShimmer 1.5s ease infinite;
  border-radius: var(--rpg-radius);
}
```
**Use for:** Any page that fetches data on mount — replace content areas with skeleton blocks until data arrives

### Active/Inactive Glow
**Active:** `border-left: 3px solid var(--rpg-xp-green); box-shadow: inset 3px 0 6px rgba(45, 90, 39, 0.15);`
**Inactive:** `border-left: 3px solid rgba(0,0,0,0.1);`
**Transition:** `border-color 0.3s ease, box-shadow 0.3s ease`
**Use for:** Togglable items (recurring transactions, habits, reminders)

## CSS Conventions

- **Module prefix:** Each module gets its own prefix (`coin-`, `quest-`, `nutri-`) to avoid collisions
- **BEM-lite:** `.coin-tx`, `.coin-tx--income`, `.coin-tx__amount` (block, modifier, element)
- **Reuse theme variables:** Never hardcode colors — always use `--rpg-*` variables from `theme.css`
- **Transition speeds:** `--rpg-transition-fast` (0.15s), `--rpg-transition` (0.2s), `--rpg-transition-slow` (0.3s)
- **Dedicated CSS file per module:** Imported from `App.tsx` (e.g., `quests.css`, `coinify.css`)

## Existing Patterns (already in theme.css / components.css)

For reference, these already exist and should be used before creating new ones:
- `rpg-card`, `rpg-card-sm`, `rpg-card-title` — card containers
- `rpg-button`, `rpg-btn-sm`, `rpg-btn-active` — buttons
- `rpg-input`, `rpg-select` — form elements
- `rpg-bar`, `rpg-bar-fill`, `rpg-bar-fill--hp`, `rpg-bar-fill--xp` — progress bars
- `rpg-stat-card`, `rpg-stat-number`, `rpg-stat-label` — stat displays
- `dashboard-grid`, `dashboard-widget` — grid layouts
- `page-header` — section headers with ornamental line
- `contentFadeIn` — page content entry animation
- `fadeIn`, `levelUpScale` — utility animations
