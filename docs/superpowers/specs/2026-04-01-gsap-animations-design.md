# GSAP Animation System — Design Spec

## Overview

Implement GSAP as the animation layer for Hubtify using the "Layer Cake" approach: CSS handles trivial interactions (hovers, focus rings, shimmer loops), GSAP handles everything requiring coordination, complex timing, or rich feedback. Animation intensity is hybrid — frequent actions are subtle and fast (200-400ms), special moments are dramatic and memorable (400ms-2s).

## Architecture

### Module Structure

New shared module at `src/shared/animations/`:

- **`gsap-setup.ts`** — Centralized plugin registration (ScrollTrigger, etc.) and global GSAP defaults (duration, ease). Imported once at the entry point. Also configures `gsap.matchMedia()` for reduced motion.
- **`transitions.ts`** — Page turn transition functions. `pageTransition(outContainer, inContainer, direction)`. Builds a timeline with 3D rotateY page-flip animation.
- **`feedback.ts`** — Micro-interaction functions: `completeTask(element)`, `gainXP(element, amount)`, `addTransaction(element)`, `registerFood(element)`, `removeItem(element)`.
- **`epic.ts`** — Dramatic moment timelines: `levelUp()`, `streakAchieved(count)`, `loanPaidOff(element)`.
- **`ToastProvider.tsx`** — Context provider at layout root managing the toast queue and rendering active toasts.
- **`Toast.tsx`** — Unified toast component that renders conditionally based on type (XP shows combo/bonus, coin shows transaction icons, etc.).
- **`useToast.ts`** — Hook to dispatch toasts from any module. Replaces 3 separate implementations (XpToast, CoinToast, NutriToast).
- **`useScrollReveal.ts`** — ScrollTrigger wrapper hook for viewport-entry animations.

### Conventions

- Every function returns the `gsap.core.Tween` or `gsap.core.Timeline` for cleanup via `.kill()`.
- Components use `useGSAP()` from `@gsap/react` for automatic scope and cleanup.
- Elements participating in animations are marked with `data-anim` attributes, not coupled to component internals.
- CSS continues to handle: hovers, focus rings, shimmer loops, cursor transitions.
- **Particle rendering**: All particles (ink splatter, level-up golden motes) are lightweight DOM nodes (small `<span>` elements) created dynamically by GSAP and removed after animation completes. NOT Pixi.js — that would be overkill for a handful of particles. Pixi.js is used elsewhere in the app for different purposes. Max particle counts: ink splatter 2 nodes, level-up motes ~15-20 nodes.

## Page Turn Transitions

When navigating between modules, a 3D page-flip effect simulates turning pages of the adventure book.

### Forward Navigation (next page)

The current page lifts from the right edge, curves with a rotateY rotation around the left axis (transformOrigin: left center), and flips over to the left revealing the new page underneath. A moving shadow follows the page during the flip, simulating the shadow cast by a lifted page.

- Container has `perspective` set for 3D depth
- Current page rotates from 0 degrees to -105 degrees on Y axis
- Ease: `power2.inOut` — feels like physical inertia, page accelerates mid-flip and settles
- Duration: 400-500ms
- Content fades out quickly at the start of the flip (don't want distorted text during rotation)
- New page content appears with subtle stagger once the page has settled

### Backward Navigation (previous page)

Reversed — the new page flips in from the left, rotating from -105 degrees to 0 degrees. Like flipping a page back.

### Smart Direction

Direction is determined by the sidebar position index of the source and destination modules. Navigating from a lower index to a higher index = forward (turning to next page). Higher to lower = backward (turning back). Same module navigation = simple crossfade fallback.

### React Router Integration

The app uses React Router with `<Outlet />`. A custom `<AnimatedOutlet>` wrapper handles the page turn lifecycle:

1. **Snapshot capture** — Before React unmounts the outgoing route, the wrapper clones the outgoing route's DOM into a snapshot container.
2. **Parallel phase** — The page turn exit animation runs on the DOM snapshot (not the live React tree) while the new route mounts behind it.
3. **Cleanup** — Once the exit animation completes, the snapshot container is removed from the DOM.

This avoids needing to keep both routes mounted simultaneously or relying on the View Transitions API. Because the outgoing "page" is a DOM clone, `useGSAP()` cleanup on the unmounting component doesn't kill the exit animation — the clone is outside React's lifecycle.

### First App Load

On first load (no previous page to transition from), content enters with a book-opening animation: two covers open from the center (similar to the level-up book open but faster, ~400ms) revealing the dashboard. This only happens once per app session — subsequent navigations use the page turn.

### Sub-route Navigation

Navigating between sub-routes within a module (e.g., `/finance/transactions` to `/finance/loans`) uses a simple crossfade (150ms), NOT the page turn. Page turn is reserved for top-level module changes only.

### Non-blocking

If the user navigates during an active transition, the current timeline is killed and the new one starts immediately. Animations never block navigation.

## Micro-interactions (Frequent Actions)

### Complete Quest/Subtask — Quill Pen Effect

1. **Checkmark drawn with quill** (300-400ms) — The current checkbox is replaced with a custom SVG element containing the checkmark path. The path data is a simple two-segment polyline (down-left to bottom, bottom to up-right). A hidden native `<input type="checkbox">` remains for accessibility and form state; the visible SVG overlays it. The path is animated via `strokeDashoffset`, tracing the tick mark as if drawn by a quill pen. Golden/sepia ink color on parchment. Ease: `power1.inOut` — pen accelerates on straight strokes, slows at direction changes.
2. **Ink effect** — Slight blur at the start of the stroke that sharpens as ink "dries" on the paper.
3. **Ink splatter** (150ms) — Always 2 tiny circular particles (2-3px), positioned randomly within 8px of the checkmark endpoint. They appear and fade like lifting a quill from paper. Particles are lightweight DOM nodes (small `<span>` elements) created dynamically by GSAP and removed after animation.
4. **Strikethrough** (200ms) — A horizontal line crosses through the task text from left to right, also drawn like a pen stroke. Not an instant `text-decoration` — it's an animated stroke.
5. **XP toast** — Enters synchronized right after the strikethrough completes.

Full timeline: checkmark (300ms) then splatter (150ms) then strikethrough (200ms) then XP toast.

### Gain XP

XP bar in sidebar doesn't just change width — a golden gleam sweeps left-to-right across the FULL bar width, but is only visible/bright in the delta zone (the newly filled portion has higher opacity gleam; the rest of the bar shows a subtle, nearly transparent pass). The XP number does an animated count-up (migrated AnimatedNumber).

### Add Transaction (Coinify)

New row slides in from the right (+30px) with fade, 150ms. Balance in the hero section animates via AnimatedNumber. If expense: subtle red flash on hero border. If income: golden flash.

### Register Food (Nutrify)

Item appears with scale from 0.95, 100ms. Daily calorie bar updates with the same golden gleam effect as XP bar — consistency across modules.

### Remove/Archive Items

Element slides left (-20px) with fade out (200ms). Items below animate upward to close the gap smoothly. Replaces current CSS `questCardExit` and `coinFadeOut`.

## Epic Moments (Rare, Dramatic)

### Level Up (~2 seconds)

1. **Dimming** (200ms) — Background overlay, sepia-dark tone (not black), parchment texture.
2. **Book opens** (500ms) — Two book cover halves open from center with 3D rotateY, like the page turn but symmetrical. `power3.out`.
3. **Level text revealed** (400ms) — New level number appears with quill pen drawing effect (same style as checkbox but larger and more dramatic). Calligraphic feel. "Level 12".
4. **Golden glow** (300ms) — Light pulse radiates from center outward, as if the book irradiates power.
5. **Particles** (1000ms) — ~15-20 small golden motes float upward, like magical dust rising from the book. Particles are lightweight DOM nodes (small `<span>` elements) created dynamically by GSAP and removed after animation. NOT Pixi.js — that would be overkill for a handful of particles.
6. **Dismiss** (400ms) — Everything fades smoothly. Sidebar XP bar and level indicator update with golden flash.

Level-up sound (Howler.js) synchronized with step 3. Auto-dismiss after full timeline completes. User CAN click to dismiss early — clicking kills the timeline at its current position and triggers the dismiss phase (step 6, the 400ms fade out). The 2-second timeline is not a forced wait.

### Streak Achieved (3, 7, 14, 30 days) (~1 second)

Streak milestone animation fires AFTER the quest completion timeline finishes (after the XP toast). It's a separate timeline that starts when the XP update triggers a streak milestone check. They don't overlap — streak fires as a follow-up.

Fire icon in sidebar scales with `elastic.out` (1 then 1.5 then 1). Streak number does count-up. Orange/golden fire halo pulses once around the icon. For high streaks (30+): 6 fire particles instead of 2, with a wider spread and 200ms longer duration.

### Loan Paid Off (Coinify)

Row plays enhanced `coinChainBreak` effect (scale + rotate) via GSAP timeline. Chains break, a golden wax seal stamp appears with `back.out` scale (like a wax seal dropping onto parchment), then the item fades to a "completed" state.

## Unified Toast System

### Architecture

`<ToastProvider>` at the layout root managing a toast queue. Any module calls `useToast()` with a unified data model:

```ts
toast({
  type: 'xp' | 'coin' | 'nutri' | 'success' | 'warning' | 'info',
  message: string,
  icon?: string,
  details?: {  // optional structured data
    xp?: number,
    bonusTier?: number,
    comboMultiplier?: number,
    streakMilestone?: number,
    transactionType?: 'expense' | 'income' | 'settled' | 'imported' | 'generated'
  }
})
```

The `Toast` component renders conditionally based on type — XP toasts show combo/bonus info when `details` is present, coin toasts show transaction-specific icons based on `transactionType`, etc. The ANIMATION is unified; the CONTENT varies by type.

### Animation

- **Enter**: Slide from right (+40px) with fade and scale (0.95 to 1). 250ms, `power2.out`. Like a note sliding between book pages.
- **Exit**: Slide right (+40px) with fade. 200ms.
- **Stacking**: Multiple toasts push previous ones upward with smooth stagger. Maximum 3 visible.
- **Auto-dismiss**: 2.5s (maintains current timing).

### Visual Variants

Each type has its own border accent and color (gold for XP, copper for coin, green for nutri) but same component, same animation, same positioning. Difference is purely aesthetic.

Replaces: `XpToast`, `CoinToast`, `NutriToast` (3 separate implementations).

## ScrollTrigger in Questify

### Quest List

When the quest list has internal scroll, cards outside the viewport animate in on scroll:

- Cards enter from below (+15px) with fade. 200ms, `power1.out`. Lightweight.
- `ScrollTrigger.batch()` groups simultaneous entries with 30ms stagger between cards. Fast scrolling shows a fluid cascade.
- `once: true` — animation fires once per card. No re-animation on scroll up/down.

### Exclusions

- **Initial load**: Visible cards enter via the page turn transition, not scroll.
- **Drag & drop**: When reordering with dnd-kit, ScrollTrigger does not interfere. Reorder animations are handled by dnd-kit. ScrollTrigger is temporarily disabled during active drag operations — listen for dnd-kit's drag start/end events to call `ScrollTrigger.disable()` / `ScrollTrigger.enable()` on the quest list triggers.

### Cleanup

ScrollTrigger instances are destroyed when leaving the Questify module. `useGSAP()` with container scope handles this automatically.

## AnimatedNumber Migration

### Changes

Current `requestAnimationFrame` + manual `easeOutCubic` replaced by `gsap.to()` on a proxy object `{ value: from }` tweening to `{ value: to }`.

### Benefits

- **Better easings** — `power3.out` for normal changes, `elastic.out(1, 0.5)` for epic moments.
- **Interruptible** — If value changes mid-animation, GSAP transitions smoothly from current position. No jumps.
- **Syncable** — Tween can be embedded in larger timelines (e.g., Coinify balance animates in sync with hero border flash).

### Interface

Same API as current component (`value`, `prefix`, `duration`, `locale`) plus an optional `ease` prop (defaults to `power3.out`). For epic moments, the caller passes the desired ease — for example, the level-up timeline passes `elastic.out(1, 0.5)` when updating the level number display. Only internals change — no consumer modifications needed for existing usage.

## Accessibility — Reduced Motion

Configured once in `gsap-setup.ts` via `gsap.matchMedia()` for `prefers-reduced-motion: reduce`:

| Feature | Normal | Reduced Motion |
|---------|--------|----------------|
| Page turn | 3D rotateY flip | Simple crossfade (150ms) |
| Quill checkbox | Animated stroke drawing | Instant checkmark |
| Epic moments | Full timeline with particles | Fade + basic scale |
| ScrollTrigger | Scroll-triggered entry | Disabled, elements visible immediately |
| Toasts and AnimatedNumber | Normal duration | Reduced to 100ms |

No per-component configuration needed. Global setting applies everywhere.

## What CSS Still Handles

- Button/card hover effects (scale, box-shadow)
- Focus rings and input transitions
- Skeleton shimmer loops (CSS is more efficient for simple infinite loops)
- Cursor transitions
- All interactions using CSS custom properties (`--rpg-transition-*`)

## Dependencies

- `gsap` (installed)
- `@gsap/react` (installed)
- No additional plugins needed beyond ScrollTrigger (included in gsap)
