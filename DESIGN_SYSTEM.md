# Hubtify Design System

Medieval RPG Codex theme. Gamified life hub built with Electron + React + TypeScript.

---

## Table of Contents

1. [Color Palette](#color-palette)
2. [Typography](#typography)
3. [Spacing & Layout](#spacing--layout)
4. [Z-Index Scale](#z-index-scale)
5. [Borders & Shadows](#borders--shadows)
6. [Gradients](#gradients)
7. [Base Components](#base-components)
8. [Codex Components](#codex-components)
9. [Chart Components](#chart-components)
10. [Icon System](#icon-system)
11. [Toast System](#toast-system)
12. [Animations](#animations)
13. [Responsive Breakpoints](#responsive-breakpoints)
14. [Accessibility](#accessibility)
15. [Module Prefixes](#module-prefixes)
16. [Component Catalog](#component-catalog)

---

## Color Palette

### Core Colors

| Variable | Hex | Swatch | Usage |
|----------|-----|--------|-------|
| `--ink` | `#2a1d0e` | ![](https://via.placeholder.com/16/2a1d0e/2a1d0e) | Primary text |
| `--ink-soft` | `#4a3520` | ![](https://via.placeholder.com/16/4a3520/4a3520) | Secondary text |
| `--ink-faded` | `#4a3520` | ![](https://via.placeholder.com/16/4a3520/4a3520) | Tertiary/disabled text |

### Accent Colors

| Variable | Hex | Swatch | Usage |
|----------|-----|--------|-------|
| `--rubric` | `#7a1e1e` | ![](https://via.placeholder.com/16/7a1e1e/7a1e1e) | Danger, HP, warnings |
| `--rubric-light` | `#a43030` | ![](https://via.placeholder.com/16/a43030/a43030) | Hover states |
| `--moss` | `#556b3c` | ![](https://via.placeholder.com/16/556b3c/556b3c) | Success, XP, growth |
| `--moss-light` | `#6b8a4c` | ![](https://via.placeholder.com/16/6b8a4c/6b8a4c) | Hover/highlight |
| `--gold` | `#a88a3c` | ![](https://via.placeholder.com/16/a88a3c/a88a3c) | Primary accent, nav |
| `--gold-light` | `#c4a84e` | ![](https://via.placeholder.com/16/c4a84e/c4a84e) | Active/focus |
| `--gold-dark` | `#8a7030` | ![](https://via.placeholder.com/16/8a7030/8a7030) | Borders, shadows |

### Parchment Scale

| Variable | Hex | Swatch | Usage |
|----------|-----|--------|-------|
| `--parch-0` | `#f5e7c0` | ![](https://via.placeholder.com/16/f5e7c0/f5e7c0) | Lightest — main bg |
| `--parch-1` | `#e8d5a3` | ![](https://via.placeholder.com/16/e8d5a3/e8d5a3) | Cards, contrast |
| `--parch-2` | `#d4bc82` | ![](https://via.placeholder.com/16/d4bc82/d4bc82) | Accents, bars |
| `--parch-3` | `#b89a6a` | ![](https://via.placeholder.com/16/b89a6a/b89a6a) | Depth |

### Leather Scale

| Variable | Hex | Swatch | Usage |
|----------|-----|--------|-------|
| `--leather` | `#3a2513` | ![](https://via.placeholder.com/16/3a2513/3a2513) | Sidebar, dark areas |
| `--leather-light` | `#5c3a1e` | ![](https://via.placeholder.com/16/5c3a1e/5c3a1e) | Buttons, hover |
| `--leather-dark` | `#2a1d0e` | ![](https://via.placeholder.com/16/2a1d0e/2a1d0e) | Deepest dark bg |

### Semantic Color Mapping

| Concept | Color | Variable |
|---------|-------|----------|
| HP / Danger | Red | `--rubric` |
| XP / Success | Green | `--moss` |
| Gold / Rewards | Gold | `--gold` |
| Info / Neutral | Brown | `--ink-soft` |
| Warning | Gold | `--gold` |

---

## Typography

### Font Stack

| Role | Font | Weight | Source |
|------|------|--------|--------|
| Display titles | `UnifrakturCook` | 700 | Google Fonts |
| Small caps | `IM Fell English SC` | 400 | Google Fonts |
| Body/italic | `IM Fell English` | 400 | Google Fonts |
| Serif body | `Cormorant Garamond` | 400, 600, 700 | Google Fonts |
| Monospace | `Fira Code` | 400, 700 | Google Fonts |

### Type Scale

Responsive via `--font-scale` multiplier (presets: `0.85`, `1`, `1.15`, `1.3`).

| Token | Size | Usage |
|-------|------|-------|
| `--fs-timer` | 64px | Pomodoro timer face |
| `--fs-display` | 34px | Page titles |
| `--fs-hero` | 28px | Level numbers, big stats |
| `--fs-stat` | 24px | Stat values, balances |
| `--fs-accent` | 22px | Section titles |
| `--fs-heading` | 20px | Subheadings |
| `--fs-nav` | 18px | Nav items, card titles |
| `--fs-sub` | 16px | Subheaders |
| `--fs-body` | 15px | Standard body text |
| `--fs-quote` | 16px | Epigraphs, secondary |
| `--fs-label` | 13px | Labels, hints (**minimum**) |

### Typography Utility Classes

| Class | Font | Properties | Use Case |
|-------|------|-----------|----------|
| `.qb-title` | UnifrakturCook | `--fs-display`, 0.03em spacing | Display titles |
| `.qb-subtitle` | Cormorant Garamond | italic, `--fs-quote`, faded | Subtitles |
| `.qb-eyebrow` | IM Fell English SC | uppercase, 0.12em spacing, `--fs-label` | Section labels |
| `.qb-hand` | IM Fell English | italic | Handwritten style |
| `.qb-numeral` | UnifrakturCook | — | Decorative numbers |
| `.qb-small-caps` | IM Fell English SC | `--fs-label`, 0.08em spacing | Capitalized labels |

### Element Defaults

| Element | Font | Size |
|---------|------|------|
| `h1–h3` | UnifrakturCook | Inherited from scale |
| `h4` | IM Fell English SC | — |
| `body` | IM Fell English, Cormorant Garamond | `--fs-body` |
| `.rpg-card-title` | UnifrakturCook 700 | `calc(1rem * var(--font-scale))` |
| `.rpg-button` | IM Fell English SC | `calc(0.8rem * var(--font-scale))` |
| `.rpg-bar-label` | IM Fell English SC | `--fs-label` |

---

## Spacing & Layout

### Spacing Scale

| Value | Usage |
|-------|-------|
| `2px` | Tiny inline gaps |
| `4px` | Micro spacing |
| `6px` | Compact rows, dividers |
| `8px` | Default gap, button padding |
| `10px` | Section spacing, card internal |
| `12px` | Medium spacing, form rows |
| `14px` | Form fields, header nav |
| `16px` | Card padding, grid gap |
| `18px` | Column gaps |
| `20px` | Header bottom margin |
| `24px` | Page padding (top/side) |
| `28px` | Page padding (side) |
| `32px` | Page padding (bottom) |

### Page Structure

```
Viewport (100vh, flex column)
├── TitleBar (32px fixed)
└── App Layout (flex row, flex: 1)
    ├── Sidebar (260px expanded / 56px collapsed, fixed)
    └── Main Content (flex: 1, overflow-y auto)
        └── .qb-page (24px 28px 32px padding)
            ├── Corner ornaments × 4
            ├── .qb-header (flex, gap: 16px)
            ├── .qb-rule (ornamental divider)
            ├── .qb-tabs (optional)
            └── .qb-content (flex: 1)
```

### Sidebar

| Property | Expanded | Collapsed |
|----------|----------|-----------|
| Width | `260px` | `56px` |
| Position | Fixed, `top: 32px` | Fixed |
| Background | `linear-gradient(180deg, var(--leather), var(--leather-dark))` | Same |
| Border-right | `2px solid var(--gold)` | Same |
| Z-index | `var(--z-sidebar)` (999) | Same |
| Transition | `width .28s cubic-bezier(.4,.1,.2,1)` | — |

### Dashboard Grid

```css
.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  grid-auto-rows: 1fr;
  gap: 16px;
}
```

### Module Page Spacing Pattern

```
[24px top padding]
[Content with 28px side padding]
  └── [Cards with 16px padding]
      └── [Elements with 8px gaps]
[32px bottom padding]
```

---

## Z-Index Scale

| Token | Value | Usage |
|-------|-------|-------|
| `--z-base` | `1` | Local stacking (badges) |
| `--z-dropdown` | `50` | Dropdowns, autocomplete |
| `--z-floating` | `100` | Floating timer, sticky |
| `--z-sidebar` | `999` | Sidebar navigation |
| `--z-overlay` | `1000` | Modal overlays |
| `--z-drawer` | `1001` | Drawers above overlays |
| `--z-modal` | `5000` | Full modals |
| `--z-toast` | `8000` | XP/feedback toasts |
| `--z-dropdown-top` | `9000` | Account dropdown, tooltips |
| `--z-tour` | `9500` | Onboarding tour |
| `--z-system-toast` | `10003` | System toast (topmost) |

---

## Borders & Shadows

### Border Styles

| Style | Usage |
|-------|-------|
| `1px solid rgba(74, 55, 32, 0.5)` | Standard parchment border |
| `1.5px solid var(--gold-dark)` | Prominent borders |
| `2px solid var(--gold)` | Sidebar, strong emphasis |
| `2px solid var(--gold-dark)` | RPG cards |
| `1px dashed var(--gold-dark)` | Decorative dashed |
| `1px solid rgba(168, 138, 60, 0.25)` | Inner ornamental border |
| `3px double {color}` | Quest tier indicator (left border) |

### Border Radius

| Value | Usage |
|-------|-------|
| `2px` | Subtle (inline elements) |
| `3px` | Default |
| `4px` | Cards |
| `6px` | Modals, buttons |
| `50%` | Circles, badges, avatars |

### Box Shadows

| Shadow | Usage |
|--------|-------|
| `inset 0 1px 2px rgba(42, 29, 14, 0.25)` | Subtle inset (inputs, bars) |
| `0 2px 4px rgba(42, 29, 14, 0.3)` | Low elevation (buttons) |
| `0 2px 8px rgba(42, 29, 14, 0.3)` | Standard elevation (cards) |
| `0 4px 16px rgba(42, 29, 14, 0.35)` | Medium elevation |
| `0 8px 32px rgba(0, 0, 0, 0.5)` | High elevation (modals) |

---

## Gradients

### Standard Patterns

| Name | CSS | Usage |
|------|-----|-------|
| Parchment Card | `linear-gradient(135deg, var(--parch-0) 0%, var(--parch-1) 60%, var(--parch-2) 100%)` | Cards, panels |
| Leather Button | `linear-gradient(180deg, var(--leather-light) 0%, var(--leather) 100%)` | Buttons |
| Gold Accent | `linear-gradient(180deg, var(--gold) 0%, var(--gold-dark) 100%)` | Active states |
| Sidebar | `linear-gradient(180deg, var(--leather) 0%, var(--leather-dark) 100%)` | Navigation |
| Wax Seal | `radial-gradient(circle at 35% 30%, #c23a3a 0%, #8a1b1b 45%, #5a0e0e 100%)` | Seal elements |
| HP Bar | `repeating-linear-gradient(135deg, var(--rubric) 0 4px, #5a1414 4px 8px)` | Health bar fill |
| XP Bar | `repeating-linear-gradient(135deg, var(--moss) 0 4px, #3d4d2a 4px 8px)` | Experience bar fill |
| Gold Bar | `repeating-linear-gradient(135deg, var(--gold-light) 0 4px, var(--gold) 4px 8px)` | Gold bar fill |

---

## Base Components

### RPG Card

Container for content sections.

```css
.rpg-card {
  padding: 16px;
  border: 2px solid var(--gold-dark);
  border-radius: 6px;
  background: linear-gradient(135deg, var(--parch-0) 0%, var(--parch-1) 60%, var(--parch-2) 100%);
  box-shadow: 0 2px 8px rgba(42, 29, 14, 0.3), inset 0 1px 3px rgba(42, 29, 14, 0.1);
}
```

**Variants:** `.rpg-card-sm` (reduced padding), `.rpg-card-title` (heading with gold border-bottom)

**Inner ornament:** `border: 1px solid rgba(168, 138, 60, 0.25)` via absolute-positioned pseudo-element.

```html
<div class="rpg-card">
  <div class="rpg-card-title">Title</div>
  <!-- content -->
</div>
```

### RPG Button

Primary action button with leather texture.

```css
.rpg-button {
  background: linear-gradient(180deg, var(--leather-light) 0%, var(--leather) 100%);
  color: var(--gold);
  border: 1px solid var(--gold-dark);
  padding: 8px 16px;
  border-radius: 6px;
  font-family: 'IM Fell English SC', serif;
  box-shadow: 0 2px 4px rgba(42, 29, 14, 0.3);
  transition: all 0.2s ease;
}

.rpg-button:hover {
  background: linear-gradient(180deg, var(--gold) 0%, var(--gold-dark) 100%);
  color: var(--ink);
  transform: translateY(-1px);
}
```

**Variants:** `.rpg-btn-sm` (smaller), `.rpg-btn-active` (gold bg)

### RPG Input

Text input with parchment styling.

```css
.rpg-input {
  background: var(--parch-0);
  border: 1px solid var(--gold-dark);
  color: var(--ink);
  padding: 6px 10px;
  border-radius: 3px;
  font-family: 'IM Fell English', serif;
}

.rpg-input:focus {
  border-color: var(--gold);
  box-shadow: 0 0 0 1px var(--gold-light);
}
```

### RPG Select

Dropdown with same styling as `.rpg-input`.

### RPG Bar (Progress)

Animated striped progress bar.

```css
.rpg-bar {
  height: 16px;
  background: var(--parch-2);
  border: 1px solid rgba(74, 55, 32, 0.5);
  border-radius: 2px;
  overflow: hidden;
  box-shadow: inset 0 1px 2px rgba(42, 29, 14, 0.25);
}

.rpg-bar-fill {
  height: 100%;
  animation: bar-stripe-scroll 1.5s linear infinite;
}
```

**Fill variants:**
- `.rpg-bar-fill--hp` — Red (rubric) stripes
- `.rpg-bar-fill--xp` — Green (moss) stripes
- `.rpg-bar-fill--gold` — Gold stripes

**Sidebar variant:** Height `9px` (compact)

### Settings Toggle

Animated on/off switch.

```css
.settings-toggle {
  /* 42x22 track with gold indicator circle */
  transition: background-color 0.2s ease;
}
```

---

## Codex Components

Parchment-themed UI system under `.qb-*` prefix (`src/shared/components/codex/`).

### Page Structure

| Class | Description |
|-------|-------------|
| `.qb-page` | Full page wrapper with corner ornaments |
| `.qb-header` | Flex header (text + extra) |
| `.qb-header-text` | Title area (flex: 1) |
| `.qb-header-extra` | Right-aligned actions |
| `.qb-rule` | Ornamental SVG divider (14px) |
| `.qb-tabs` | Tab navigation strip |
| `.qb-content` | Main content area (flex: 1) |
| `.qb-corner` | Decorative iron bracket (44x44, opacity 0.35) |

### Display Elements

| Class | Description |
|-------|-------------|
| `.qb-rune` | Colored pill badge |
| `.qb-rune--rubric` | Red variant |
| `.qb-rune--sage` | Green variant |
| `.qb-rune--gold` | Gold variant |
| `.qb-rune--ink` | Dark variant |
| `.qb-cartouche` | Stat display box |
| `.qb-stat-box` | Stat container |
| `.qb-small-count` | Compact count badge |

### Banners & Seals

| Class | Description |
|-------|-------------|
| `.qb-banner` | Ribbon banner |
| `.qb-banner--sage` | Green variant |
| `.qb-banner--gold` | Gold variant |
| `.qb-banner--ink` | Dark variant |
| `.qb-seal` | Wax seal (78x78, radial gradient) |
| `.qb-seal--btn` | Clickable seal |

### Gauges

| Class | Description |
|-------|-------------|
| `.qb-gauge` | 10px progress track |
| `.qb-gauge-fill--ink` | Dark fill |
| `.qb-gauge-fill--rubric` | Red fill |
| `.qb-gauge-fill--sage` | Green fill |
| `.qb-gauge-fill--gold` | Gold fill |

### Layout

| Class | Description |
|-------|-------------|
| `.qb-col-2` | 2-column grid |
| `.qb-col-3` | 3-column grid |
| `.qb-section` | Content section |
| `.qb-dropcap` | Drop-cap initial letter |

---

## Chart Components

Location: `src/shared/components/charts/`

### CastleBarChart

Bar chart with castle/merlon design aesthetic.

| Prop | Type | Description |
|------|------|-------------|
| `data` | `DataPoint[]` | Chart data |
| `title` | `string?` | Optional title |
| `valueFormatter` | `fn?` | Format values |
| `themed` | `boolean?` | Use RPG theme |

CSS: `.castle-chart`, `.castle-bar`, `.castle-legend`

### TreasureLineChart

Line chart with "treasure map" aesthetic, area fill.

CSS: `.treasure-chart`, `.treasure-line`, `.treasure-area`, `.treasure-corner`

### HeatmapCalendar

Day/week/month grid with 4-level intensity.

| Class | Description |
|-------|-------------|
| `.heatmap-cell--l0` | Empty (no activity) |
| `.heatmap-cell--l1` | Low activity |
| `.heatmap-cell--l2` | Medium activity |
| `.heatmap-cell--l3` | High activity |
| `.heatmap-cell--l4` | Maximum activity |
| `.heatmap-cell--today` | Today highlight (pulsing) |

### SparklineChart

Micro inline SVG chart (no axes, labels). Minimal props: `data: number[]`, `height`, `color`.

### CircularProgress

SVG circular progress ring. Props: `value`, `max`, `size`, `color`.

CSS: `.circular-progress`, `.circular-progress-svg`, `.circular-progress-bar`

---

## Icon System

Location: `src/shared/components/icons/CodexIcons.tsx`

All icons are hand-crafted inline SVG. Default: **24x24** viewBox, `stroke: currentColor`, `strokeWidth: 1.2`.

### Default SVG Props

```jsx
{
  viewBox: '0 0 24 24',
  width: 24,
  height: 24,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round'
}
```

### Size Convention

| Context | Size |
|---------|------|
| Inline metadata | 12x12 |
| Small label | 14x14 |
| Section header | 18x18 |
| Default | 24x24 |

### Color

Icons inherit `currentColor`. Style via `style={{ color: 'var(--rubric)' }}`.

### Complete Icon Catalog

**Combat/Armor:**
`Sword`, `Shield`, `Dagger`, `Bow`

**Resources/Items:**
`Coin`, `Potion`, `Scroll`, `Bread`, `Meat`, `Apple`, `Fish`, `Platter`, `Cauldron`, `Herb`, `Chalice`

**Character/Status:**
`Crown`, `Heart`, `Skull`, `Flame`

**Navigation/Info:**
`Compass`, `Key`, `Map`, `Tower`, `Scale`

**Library/Knowledge:**
`Quill`, `Book`, `Rune`, `HelpSeal`

**Celestial:**
`MoonCrescent`, `NoonSun`, `DawnSun`, `Lantern`

**Gems/Treasure:**
`GemRough`, `GemCut`, `GemBrilliant`

**Tools:**
`Gear`, `Bag`

**Legendary:**
`Dragon`

### Ornaments

Location: `src/shared/components/icons/Ornaments.tsx`

| Component | Size | Description |
|-----------|------|-------------|
| `Flourish` | 200x12 | Wavy line divider |
| `QBDivider` | 28x16 | Diamond section break |
| `CornerBracket` | 64x64 | Iron corner (tl/tr/bl/br) |
| `TopRule` | 700x14 | Full-width header rule |

---

## Toast System

Location: `src/shared/components/Toast.tsx`, `ToastProvider.tsx`

### Toast Types

| Type | Border Color | Default Icon |
|------|-------------|--------------|
| `xp` | `var(--moss)` | ⚔ |
| `coin` | `var(--gold)` | ✪ |
| `nutri` | `var(--rubric)` | ♣ |
| `success` | `var(--moss)` | ✔ |
| `warning` | `var(--gold)` | ⚠ |
| `info` | `var(--ink-soft)` | ℹ |

### Toast API

```typescript
const { toast } = useToast()

toast({
  type: 'xp',
  message: '+50 XP ganados',
  details: {
    xp: 50,
    bonusTier: 'golden',
    comboMultiplier: 1.5
  }
})
```

### Toast Data Interface

```typescript
interface ToastData {
  id: string
  type: 'xp' | 'coin' | 'nutri' | 'success' | 'warning' | 'info'
  message: string
  icon?: string
  details?: {
    xp?: number
    bonusTier?: string
    comboMultiplier?: number
    streakMilestone?: number
    transactionType?: 'expense' | 'income' | 'settled' | 'imported' | 'generated'
  }
}
```

### Behavior

| Feature | Value |
|---------|-------|
| Max visible | 3 |
| Auto-dismiss | 2500ms |
| Position | Fixed bottom-right (20px) |
| Z-index | 10003 |
| Pause on hover | Yes |
| Click to dismiss | Yes |
| Entry animation | Slide from right + scale (0.25s) |
| Exit animation | Slide right + fade (0.2s) |

### Visual Style

```css
background: linear-gradient(135deg, var(--parch-0) 0%, var(--parch-1) 100%);
border: 1px solid var(--gold-dark);
border-left: 3px solid {type-color};
border-radius: 6px;
box-shadow: 0 2px 8px rgba(42, 29, 14, 0.35);
min-width: 240px;
max-width: 320px;
padding: 10px 14px;
font-family: 'IM Fell English', serif;
```

---

## Animations

### GSAP Patterns

Location: `src/shared/animations/`

| File | Animations | Use Case |
|------|-----------|----------|
| `transitions.ts` | `pageTurnExit`, `pageEnter`, `bookOpen`, `bookClose` | Page navigation |
| `feedback.ts` | `barGleam`, `xpPop`, `coinDrop`, `hpFlash` | RPG feedback |
| `particles.ts` | `spawnParticles` | Achievement effects |
| `cauldron.ts` | Timer animations | Pomodoro module |

### CSS Keyframes

| Animation | Duration | Usage |
|-----------|----------|-------|
| `fadeIn` | — | Opacity 0→1 |
| `levelUpScale` | — | Scale bounce (0.5→1.1→1) |
| `stepSlideIn` | 0.3s | Onboarding forward |
| `stepSlideBack` | 0.3s | Onboarding backward |
| `spin` | — | Loading compass |
| `bar-stripe-scroll` | 1.5s infinite | Progress bar stripes |
| `coinShimmer` | 1.5s infinite | Finance skeleton |
| `coinDrop` | 0.35s | Coin fall effect |
| `coinPulseGold` | — | Gold border pulse |
| `heatmapPulse` | — | Calendar "today" cell |
| `cauldron-ember-float` | — | Ember particle rise |
| `cauldron-steam-rise` | — | Steam plume |
| `tourGlowPulse` | — | Tour spotlight glow |

### Transition Durations

| Duration | Usage |
|----------|-------|
| `0.1s` | Instant feedback, icon changes |
| `0.15s` | Tab switching, quick hover |
| `0.2s` | Standard hover states |
| `0.25s` | Text fade, toast enter |
| `0.28s` | Sidebar collapse (custom easing) |
| `0.3s` | Page transitions, bars expand |
| `0.4s` | Gleam effects |
| `0.5s` | Book animations |
| `1.5s` | Continuous patterns |

### Easing Functions

| Easing | Usage |
|--------|-------|
| `cubic-bezier(.4,.1,.2,1)` | Sidebar, systematic smoothness |
| `power1.in / power1.out` | Quick, natural |
| `power2.in / power2.out` | Stronger |
| `power3.out` | Book open (snappy) |
| `back.out(2)` | Level number bounce |
| `elastic.out(1, 0.6)` | Letter spring effect |
| `ease / ease-in-out` | CSS defaults |

### Interaction Feedback

| State | Effect |
|-------|--------|
| Hover | 0.2s color shift + shadow + `translateY(-1px)` |
| Active | Border highlight + darker bg |
| Disabled | `opacity: 0.5` + `cursor: not-allowed` |
| Loading | Shimmer animation (1.5s infinite) |
| Success | Particle burst + sound |

### List Item Entry / Exit

Used whenever rows appear or disappear in a list (tasks, food entries, transactions).

| Phase | From | To | Timing |
|-------|------|----|--------|
| Entry | `translateY(-10px)`, `opacity: 0` | `translateY(0)`, `opacity: 1` | 300ms ease-out |
| Exit  | `opacity: 1` | `translateX(-20px)`, `opacity: 0` | 300ms ease-in |

For a staggered reveal of sibling sections, add an incremental `animation-delay`
(`0ms`, `50ms`, `100ms`, …) via `:nth-child()`.

### Active / Inactive Toggle Glow

For togglable rows (recurring transactions, habits, reminders):

| State | Style |
|-------|-------|
| Active | `border-left: 3px solid var(--moss); box-shadow: inset 3px 0 6px rgba(64, 82, 44, 0.15);` |
| Inactive | `border-left: 3px solid rgba(0, 0, 0, 0.1);` |
| Transition | `border-color 0.3s ease, box-shadow 0.3s ease` |

---

## Responsive Breakpoints

| Breakpoint | Changes |
|------------|---------|
| `> 900px` | Full layout — sidebar 260px, 2-col grids |
| `700px–900px` | Sidebar 220px, reduced nav padding |
| `< 700px` | Dashboard single column, quest columns stack, stats 2-col |
| `< 600px` | Chart responsive adjustments |
| `< 500px` | Finance narrow mode |

### Reduced Motion

```css
@media (prefers-reduced-motion: reduce) {
  /* All infinite animations disabled */
  /* Transition durations → 0.01ms */
}
```

---

## Accessibility

### Focus States

```css
.rpg-button:focus-visible {
  outline: 2px solid var(--gold-light);
  outline-offset: 2px;
}

.rpg-input:focus-visible {
  border-color: var(--gold);
  box-shadow: 0 0 0 1px var(--gold-light);
}

.sidebar-nav-item:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: -2px;
}
```

### Font Scale

User-configurable `--font-scale`: `0.85`, `1.0`, `1.15`, `1.3`. All font sizes multiply by this value.

### Selection

```css
::selection {
  background: var(--gold);
  color: var(--ink);
}
```

### Scrollbar

Custom scrollbar: parchment gradient track with gold border.

---

## Module Prefixes

Each module scopes its CSS with a unique prefix to avoid collisions.

**Naming: BEM-lite.** `block`, `block--modifier`, `block__element` — e.g.
`.coin-tx`, `.coin-tx--income`, `.coin-tx__amount`. Prefix stays on the block.
One dedicated CSS file per module, imported from `src/App.tsx`.

| Module | Prefix | Primary Colors | CSS File |
|--------|--------|---------------|----------|
| Finance (Coinify) | `.coin-*` | Gold, Rubric | `modules/finance/styles/coinify.css` |
| Quests (Questify) | `.quest-*` | Multi-tier | `modules/quests/styles/quests.css` |
| Nutrition (Nutrify) | `.nutri-*` | Moss, Gold | `modules/nutrition/styles/nutri.css` |
| Cauldron (Pomodoro) | `.cauldron-*` | Rubric, Moss | `modules/cauldron/styles/cauldron.css` |
| Character | `.hero-*` | Parchment | `hub/styles/character.css` |
| Codex (Shared) | `.qb-*` | Neutral | `shared/components/codex/codex.css` |
| Charts | `.castle-*`, `.treasure-*`, `.heatmap-*` | Themed | `shared/components/charts/charts.css` |
| Tour | `.tour-*` | Gold accent | (inline) |
| Help | `.help-bubble*` | Gold, Leather | `shared/styles/help-bubble.css` |
| Notifications | `.notif-*` | Parchment | `shared/styles/notifications.css` |

### Quest Tiers

The real task tiers are defined in `src/modules/quests/types.ts` as
`TASK_TIER = { QUICK: 1, NORMAL: 2, EPIC: 3 }`.

| Tier | Value | XP | i18n key | Visual Indicator |
|------|-------|----|----------|------------------|
| Quick | `1` | 5 | `questify.tier.quick` | Neutral (default) |
| Normal | `2` | 15 | `questify.tier.normal` | Colored left border |
| Epic | `3` | 40 | `questify.tier.epic` | Strongest emphasis |

**Not to be confused with the Latin *rarity* labels.** `quests.css` also defines
`.quest-tier-label--{communis,rara,epica,legendaria,delata}` (with matching
`questify.tiers.*` strings). Those are a separate rarity vocabulary, and as of
today **no `.tsx` renders them** — treat both the CSS block and the i18n section
as unwired until something claims them.

---

## Component Catalog

### Shared Components (`src/shared/components/`)

#### Progress & Status

| Component | Props | Description |
|-----------|-------|-------------|
| `HpBar` | `hp`, `maxHp` | Red striped health bar |
| `XpBar` | `xp`, `level` | Green striped XP bar with gleam |
| `CircularProgress` | `value`, `max`, `size`, `color` | SVG ring progress |
| `Loading` | `text?`, `size?` | Spinning compass with text |

#### Inputs & Forms

| Component | Props | Description |
|-----------|-------|-------------|
| `RpgNumberInput` | `value`, `onChange`, `step`, `min`, `max`, `suffix` | Number input with arrows + hold-to-repeat |
| `RpgDatePicker` | `value` (YYYY-MM-DD), `onChange` | Popup date picker with day/month/year |
| `RpgDateTimePicker` | `value` (ISO), `onChange` | Date picker + hour/minute |
| `Checkbox` / `QuillCheckbox` | `checked`, `onChange`, `size` | Animated quill-drawn checkmark |

#### Dialogs & Overlays

| Component | Props / API | Description |
|-----------|------------|-------------|
| `ConfirmDialog` | `useConfirm()` hook → `confirm({ message, danger? })` | RPG-themed confirmation modal |
| `HelpBubble` | `text`, `position`, `variant` | "?" hover tooltip |
| `Tooltip` | `text`, `children` | Simple text tooltip |
| `NotificationBell` | `onClick` | Bell icon with count badge |
| `NotificationCenter` | `open`, `onClose`, `onNavigate` | Drawer with grouped notifications |
| `ShortcutModal` | `open`, `onClose` | Keyboard shortcuts reference |

#### Layout & Navigation

| Component | Props | Description |
|-----------|-------|-------------|
| `PageHeader` | `title`, `subtitle?`, `actions?` | Section header with ornament |
| `TitleBar` | — | Electron window chrome |
| `AnimatedOutlet` | — | Page-flip transitions between modules |
| `ErrorBoundary` | `children`, `fallback?` | React error boundary |

#### Toasts

| Component | Description |
|-----------|-------------|
| `ToastProvider` | Context provider, manages queue |
| `Toast` | Individual toast element |
| `useToast()` | Hook to fire toasts |

### Finance Shared (`src/modules/finance/components/shared/`)

| Component | Description |
|-----------|-------------|
| `AnimatedNumber` | Count up/down with locale formatting |
| `BalanceBar` | Stacked income/expense ratio bar |
| `CoinStatCard` | Single stat with animated number |
| `CategorySelect` / `CategoryManager` | Category CRUD |
| `CreditCardSelect` / `CreditCardManager` | Credit card CRUD |
| `DollarChip` | Live USD exchange rates (AR market) |
| `DonutChart` | Category breakdown donut |
| `MonthNavigator` | Month prev/next navigation |
| `QuickAddForm` | Transaction quick entry |
| `InstallmentAddForm` | Installment creation |
| `StatementDetail` | Full transaction detail modal |

### Codex Components (`src/shared/components/codex/`)

| Component | Description |
|-----------|-------------|
| `BookPage` | Parchment page container with corners, stains |
| `CodexPrimitives` | Utility SVG ornaments |

---

## CSS File Map

| File | Scope | Key Classes |
|------|-------|-------------|
| `hub/styles/theme.css` | Global tokens | `:root` vars, fonts, z-index, keyframes |
| `hub/styles/components.css` | Base components | `.rpg-*`, `.auth-*`, `.dashboard-*`, `.settings-*`, `.onboarding-*` |
| `hub/styles/layout.css` | App shell | `.main-layout`, `.main-content`, `.sidebar-*` |
| `hub/styles/character.css` | Character module | `.char-*`, `.level-card-*` |
| `shared/components/codex/codex.css` | Codex system | `.qb-*` |
| `shared/components/charts/charts.css` | Charts | `.castle-*`, `.treasure-*`, `.heatmap-*`, `.circular-*` |
| `shared/styles/help-bubble.css` | Help tooltips | `.help-bubble*` |
| `shared/styles/notifications.css` | Notifications | `.notif-*` |
| `modules/finance/styles/coinify.css` | Finance | `.coin-*` |
| `modules/nutrition/styles/nutri.css` | Nutrition | `.nutri-*` |
| `modules/quests/styles/quests.css` | Quests | `.quest-*` |
| `modules/cauldron/styles/cauldron.css` | Cauldron | `.cauldron-*` |
