# GSAP Animation System Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement GSAP as the animation layer using the "Layer Cake" approach — CSS for trivial interactions, GSAP for coordinated animations, page transitions, and epic moments.

**Architecture:** Shared animation module at `src/shared/animations/` with centralized setup, reusable transition/feedback functions, and a unified toast system. Components use `useGSAP()` for scope and cleanup. `prefers-reduced-motion` respected globally.

**Tech Stack:** GSAP 3, @gsap/react (useGSAP hook), ScrollTrigger plugin, React 19, TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-04-01-gsap-animations-design.md`

**GSAP Skills:** Before writing GSAP code, load the relevant skill:
- Core API: `~/.claude/skills/gsap-core/SKILL.md`
- React integration: `~/.claude/skills/gsap-react/SKILL.md`
- Timelines: `~/.claude/skills/gsap-timeline/SKILL.md`
- ScrollTrigger: `~/.claude/skills/gsap-scrolltrigger/SKILL.md`
- Plugins: `~/.claude/skills/gsap-plugins/SKILL.md`
- Performance: `~/.claude/skills/gsap-performance/SKILL.md`
- Utilities: `~/.claude/skills/gsap-utils/SKILL.md`

---

## File Structure

### New Files to Create

```
src/shared/animations/
  gsap-setup.ts                     (plugin registration, global defaults, reduced motion)
  transitions.ts                    (page turn transition timelines)
  feedback.ts                       (micro-interaction functions)
  epic.ts                           (dramatic moment timelines)
  useScrollReveal.ts                (ScrollTrigger wrapper hook)

src/shared/components/
  ToastProvider.tsx                  (toast queue provider + GSAP animations)
  Toast.tsx                         (toast display component)
  useToast.ts                       (toast dispatch hook)
  QuillCheckbox.tsx                 (SVG quill pen checkbox)
  AnimatedOutlet.tsx                (route transition wrapper with DOM snapshot)
```

### Files to Modify

```
src/main.tsx                        (import gsap-setup)
src/App.tsx                         (wrap Outlet with AnimatedOutlet)
src/hub/Layout.tsx                  (add ToastProvider, replace level-up modal with GSAP epic)
src/hub/PlayerCard.tsx              (XP bar gleam, streak animation)
src/shared/components/XpBar.tsx     (golden gleam effect on update)
src/shared/components/Checkbox.tsx  (replace with QuillCheckbox)
src/modules/quests/components/TaskList.tsx         (ScrollTrigger batch, disable during drag)
src/modules/quests/components/SubtaskList.tsx      (quill checkbox integration, task completion animation)
src/modules/finance/components/shared/AnimatedNumber.tsx  (migrate to GSAP)
src/modules/finance/components/Transactions.tsx    (slide-in for new rows, balance flash)
src/modules/finance/components/FinanceLayout.tsx   (remove CoinToastProvider, use shared)
src/modules/nutrition/components/Today.tsx         (scale animation for new food items)
src/modules/nutrition/components/CalorieProgressBar.tsx   (golden gleam on update)
src/modules/nutrition/components/FoodLogItem.tsx   (entry animation)
```

### CSS Files to Clean Up (after GSAP replacement)

```
src/modules/quests/styles/quests.css       (remove questCardExit, questCardEnter — replaced by GSAP)
src/modules/finance/styles/coinify.css     (remove coinFadeOut, coinSlideIn — replaced by GSAP)
src/modules/nutrition/styles/nutri.css     (remove nutriFadeOut, nutriSlideIn — replaced by GSAP)
src/hub/styles/layout.css                  (remove contentFadeIn — replaced by page turn)
```

### Test Files

```
src/shared/animations/__tests__/gsap-setup.test.ts
src/shared/animations/__tests__/feedback.test.ts
src/shared/components/__tests__/useToast.test.ts
src/shared/components/__tests__/AnimatedNumber.test.ts
```

---

## Chunk 1: Foundation — GSAP Setup & AnimatedNumber Migration

### Task 1: GSAP Setup Module

**Files:**
- Create: `src/shared/animations/gsap-setup.ts`
- Modify: `src/main.tsx`

**Skills:** Load `gsap-core` and `gsap-react` skills before starting.

- [ ] **Step 1: Create gsap-setup.ts**

Register ScrollTrigger plugin, set global defaults:
```typescript
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useGSAP } from '@gsap/react'

gsap.registerPlugin(ScrollTrigger, useGSAP)

gsap.defaults({
  duration: 0.3,
  ease: 'power2.out',
})

// Reduced motion: override defaults when user prefers reduced motion
gsap.matchMedia().add('(prefers-reduced-motion: reduce)', () => {
  gsap.defaults({
    duration: 0.1,
    ease: 'none',
  })
  // Disable ScrollTrigger globally
  ScrollTrigger.disable()
})
```

- [ ] **Step 2: Import setup in main.tsx**

Add `import './shared/animations/gsap-setup'` as the FIRST import after React in `src/main.tsx`.

- [ ] **Step 3: Verify GSAP loads**

Run the app with `npm run dev`. Open DevTools console. Type `gsap.version` — should return the installed version. Verify no console errors.

- [ ] **Step 4: Commit**

```bash
git add src/shared/animations/gsap-setup.ts src/main.tsx
git commit -m "feat(animations): GSAP setup with plugin registration and reduced motion"
```

---

### Task 2: Migrate AnimatedNumber to GSAP

**Files:**
- Modify: `src/modules/finance/components/shared/AnimatedNumber.tsx`

**Skills:** Load `gsap-core` and `gsap-react` skills before starting.

- [ ] **Step 1: Read current AnimatedNumber implementation**

Read `src/modules/finance/components/shared/AnimatedNumber.tsx` fully. Understand the current API: props `value`, `prefix`, `duration`, `locale`, and how `requestAnimationFrame` + `easeOutCubic` work.

- [ ] **Step 2: Rewrite internals with GSAP**

Replace `requestAnimationFrame` loop with `gsap.to()` on a proxy object. Keep the SAME external props interface. Add optional `ease` prop (default `power3.out`).

```typescript
import { useRef, useState } from 'react'
import { useGSAP } from '@gsap/react'
import { gsap } from 'gsap'

interface AnimatedNumberProps {
  value: number
  prefix?: string
  duration?: number
  locale?: string
  ease?: string
}

export function AnimatedNumber({
  value,
  prefix = '',
  duration = 0.6,
  locale = 'es-AR',
  ease = 'power3.out',
}: AnimatedNumberProps) {
  const [display, setDisplay] = useState(value)
  const proxyRef = useRef({ value: 0 })
  const containerRef = useRef<HTMLSpanElement>(null)

  useGSAP(() => {
    if (value === 0 && proxyRef.current.value === 0) {
      setDisplay(0)
      return
    }
    gsap.to(proxyRef.current, {
      value,
      duration,
      ease,
      onUpdate: () => setDisplay(proxyRef.current.value),
    })
  }, { dependencies: [value, duration, ease], scope: containerRef })

  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(display))

  return <span ref={containerRef}>{prefix}{formatted}</span>
}
```

- [ ] **Step 3: Test manually**

Navigate to Coinify in the app. Verify the balance numbers still animate smoothly when data changes. Verify no console errors. Check that changing between views still animates numbers.

- [ ] **Step 4: Commit**

```bash
git add src/modules/finance/components/shared/AnimatedNumber.tsx
git commit -m "refactor(coinify): migrate AnimatedNumber from rAF to GSAP"
```

---

## Chunk 2: Unified Toast System

### Task 3: Toast Types and Hook

**Files:**
- Create: `src/shared/components/useToast.ts`

- [ ] **Step 1: Create toast types and context**

```typescript
import { createContext, useContext, useCallback } from 'react'

export type ToastType = 'xp' | 'coin' | 'nutri' | 'success' | 'warning' | 'info'

export interface ToastDetails {
  xp?: number
  bonusTier?: number
  comboMultiplier?: number
  streakMilestone?: number
  transactionType?: 'expense' | 'income' | 'settled' | 'imported' | 'generated'
}

export interface ToastData {
  id: string
  type: ToastType
  message: string
  icon?: string
  details?: ToastDetails
}

export interface ToastContextValue {
  toast: (data: Omit<ToastData, 'id'>) => void
}

export const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/components/useToast.ts
git commit -m "feat(toast): unified toast types and useToast hook"
```

---

### Task 4: Toast Component

**Files:**
- Create: `src/shared/components/Toast.tsx`

**Skills:** Load `gsap-react` skill before starting.

- [ ] **Step 1: Create Toast display component**

Single component that renders a toast item with variant styling. Uses `useGSAP` for enter animation. Accepts `onDismiss` callback.

Visual variants:
- `xp`: gold border accent (#d4a017), sword icon default
- `coin`: copper border (#b87333), coin icon default
- `nutri`: green border (#27ae60), food icon default
- `success`: green, `warning`: orange, `info`: blue

Enter animation: slide from right (+40px) with fade and scale (0.95 → 1), 250ms, `power2.out`.
Exit animation: slide right (+40px) with fade, 200ms.

The component renders `message` always, plus conditional `details` display:
- XP toast: shows combo multiplier and bonus tier if present
- Coin toast: shows transaction-type specific icon override
- Others: just message

- [ ] **Step 2: Commit**

```bash
git add src/shared/components/Toast.tsx
git commit -m "feat(toast): Toast display component with GSAP animations"
```

---

### Task 5: Toast Provider

**Files:**
- Create: `src/shared/components/ToastProvider.tsx`
- Modify: `src/hub/Layout.tsx`

**Skills:** Load `gsap-react` skill before starting.

- [ ] **Step 1: Create ToastProvider**

Manages a queue of toasts (max 3 visible). Uses `useState` for the queue. Each toast auto-dismisses after 2.5s via `setTimeout`. When a toast is dismissed, animate exit with GSAP then remove from state.

Stacking: toasts stack from bottom, previous ones shift up when new ones arrive (animated with GSAP stagger).

Renders a fixed-position container (bottom-right) with toast items.

- [ ] **Step 2: Add ToastProvider to Layout.tsx**

Wrap the Layout's return JSX with `<ToastProvider>`. Place it inside the existing provider tree.

- [ ] **Step 3: Verify toast renders**

Add a temporary `useToast()` call in Dashboard that fires a test toast on mount. Verify it appears, animates in, auto-dismisses. Remove the test call.

- [ ] **Step 4: Commit**

```bash
git add src/shared/components/ToastProvider.tsx src/hub/Layout.tsx
git commit -m "feat(toast): ToastProvider with queue management and GSAP animations"
```

---

### Task 6: Replace Module Toasts with Unified System

**Files:**
- Modify: `src/modules/quests/components/TaskList.tsx` (or wherever XpToast is triggered)
- Modify: `src/modules/finance/components/FinanceLayout.tsx`
- Modify: `src/modules/finance/components/Transactions.tsx` (or wherever CoinToast is triggered)
- Modify: `src/modules/nutrition/components/Today.tsx` (or wherever NutriToast is triggered)
- Modify: `src/modules/finance/components/Import.tsx`
- Modify: `src/modules/finance/components/Recurring.tsx`
- Modify: `src/modules/finance/components/Loans.tsx`
- Modify: `src/App.tsx` (remove NutriToastProvider wrapper from route tree)
- Delete references to: `XpToast.tsx`, `CoinToast.tsx`, `CoinToastProvider.tsx`, `NutriToast.tsx`, `NutriToastProvider.tsx`

- [ ] **Step 1: Find all toast trigger points**

Search for `showXpToast`, `showCoinToast`, `showNutriToast`, `setToast`, or similar state setters across the codebase. Map each to the new `useToast()` API.

- [ ] **Step 2: Replace XP toast triggers**

In Questify components, replace the XpToast state + component with `useToast()` calls:
```typescript
const { toast } = useToast()
// On task completion:
toast({ type: 'xp', message: `+${xp} XP`, icon: '⚔', details: { xp, bonusTier, comboMultiplier } })
```

- [ ] **Step 3: Replace Coin toast triggers**

In Finance components, remove `CoinToastProvider` wrapper from `FinanceLayout.tsx`. Replace `useCoinToast()` calls with `useToast()`:
```typescript
toast({ type: 'coin', message: formatAmount(amount), icon: '💰', details: { transactionType } })
```

- [ ] **Step 3b: Replace Coin toast in remaining finance components**

In Import.tsx, Recurring.tsx, and Loans.tsx, replace `useCoinToast()` calls with `useToast()` following the same pattern as Step 3.

- [ ] **Step 4: Replace Nutri toast triggers**

In Nutrition components, remove `NutriToastProvider` wrapper. Replace with `useToast()`. Also remove the `NutriToastProvider` wrapper from `src/App.tsx` route tree.
```typescript
toast({ type: 'nutri', message: 'Alimento registrado', icon: '🍕' })
```

- [ ] **Step 5: Delete old toast files**

Remove the 5 old toast files. Verify no imports remain (search for old file names).

- [ ] **Step 6: Test all 3 modules**

Navigate to each module, trigger a toast (complete a quest, add a transaction, log food). Verify unified toast appears correctly in each case with correct styling. Also verify Import, Recurring, and Loans in Coinify trigger toasts correctly.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(toast): replace 3 module toasts with unified GSAP toast system"
```

---

## Chunk 3: Page Turn Transitions

### Task 7: Page Turn Transition Functions

**Files:**
- Create: `src/shared/animations/transitions.ts`

**Skills:** Load `gsap-timeline` and `gsap-performance` skills before starting.

- [ ] **Step 1: Create transition functions**

```typescript
import { gsap } from 'gsap'

type Direction = 'forward' | 'backward'

export function pageTurnExit(page: HTMLElement, direction: Direction): gsap.core.Timeline {
  const rotateTarget = direction === 'forward' ? -105 : 105
  const originX = direction === 'forward' ? 'left' : 'right'

  const tl = gsap.timeline()

  // Fade content quickly so text isn't distorted during rotation
  tl.to(page.children, {
    opacity: 0,
    duration: 0.1,
    stagger: 0.02,
  })
  // 3D page flip
  tl.to(page, {
    rotateY: rotateTarget,
    duration: 0.45,
    ease: 'power2.inOut',
    transformOrigin: `${originX} center`,
    transformPerspective: 1200,
  }, 0.05)
  // Moving shadow during flip
  tl.fromTo(page, {
    boxShadow: '0 0 0 rgba(0,0,0,0)',
  }, {
    boxShadow: direction === 'forward'
      ? '-20px 0 40px rgba(0,0,0,0.3)'
      : '20px 0 40px rgba(0,0,0,0.3)',
    duration: 0.25,
    ease: 'power1.in',
  }, 0)
  tl.to(page, {
    boxShadow: '0 0 0 rgba(0,0,0,0)',
    duration: 0.15,
  }, 0.35)

  return tl
}

export function pageEnter(container: HTMLElement): gsap.core.Timeline {
  const tl = gsap.timeline()
  const children = container.querySelectorAll('[data-anim="stagger-child"]')

  if (children.length > 0) {
    gsap.set(children, { opacity: 0, x: 12 })
    tl.to(children, {
      opacity: 1,
      x: 0,
      duration: 0.3,
      ease: 'power2.out',
      stagger: 0.04,
    }, 0.1) // slight delay after page settles
  } else {
    gsap.set(container, { opacity: 0 })
    tl.to(container, { opacity: 1, duration: 0.2 })
  }

  return tl
}

export function crossfade(outEl: HTMLElement, inEl: HTMLElement): gsap.core.Timeline {
  const tl = gsap.timeline()
  tl.to(outEl, { opacity: 0, duration: 0.15 })
  tl.fromTo(inEl, { opacity: 0 }, { opacity: 1, duration: 0.15 }, 0.05)
  return tl
}

export function bookOpen(container: HTMLElement): gsap.core.Timeline {
  // First app load — book covers open from center revealing content
  const tl = gsap.timeline()

  // Create temporary cover overlays
  const leftCover = document.createElement('div')
  const rightCover = document.createElement('div')
  const coverStyle = 'position:absolute;top:0;width:50%;height:100%;background:linear-gradient(135deg,#8b7355,#6b5640);z-index:10;'
  leftCover.style.cssText = coverStyle + 'left:0;transform-origin:left center;'
  rightCover.style.cssText = coverStyle + 'right:0;transform-origin:right center;'

  container.style.position = 'relative'
  container.style.perspective = '1200px'
  container.appendChild(leftCover)
  container.appendChild(rightCover)

  // Content starts hidden
  gsap.set(container.children, { opacity: 0 })
  gsap.set([leftCover, rightCover], { opacity: 1 })

  // Covers open with 3D rotateY (400ms)
  tl.to(leftCover, {
    rotateY: -105,
    duration: 0.4,
    ease: 'power3.out',
  })
  tl.to(rightCover, {
    rotateY: 105,
    duration: 0.4,
    ease: 'power3.out',
  }, '<')

  // Remove covers and reveal content
  tl.to([leftCover, rightCover], {
    opacity: 0,
    duration: 0.1,
    onComplete: () => { leftCover.remove(); rightCover.remove() },
  })

  // Stagger in content children
  const children = container.querySelectorAll('[data-anim="stagger-child"]')
  if (children.length > 0) {
    tl.to(children, {
      opacity: 1,
      y: 0,
      duration: 0.3,
      ease: 'power2.out',
      stagger: 0.04,
    }, 0.25)
  }

  return tl
}
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/animations/transitions.ts
git commit -m "feat(transitions): page turn functions with 3D flip, stagger, crossfade, and book open"
```

---

### Task 8: AnimatedOutlet Component

**Files:**
- Create: `src/shared/components/AnimatedOutlet.tsx`
- Modify: `src/App.tsx`

**Skills:** Load `gsap-react` and `gsap-timeline` skills before starting.

- [ ] **Step 1: Create AnimatedOutlet**

This is the most complex component. It wraps React Router's `<Outlet>` and manages page transitions using the functions from `transitions.ts`.

Core algorithm:
1. Track previous location with useRef. On location change (detected via useLocation()),
   compare previous and new paths.
2. Use useLayoutEffect keyed on location.pathname. Inside:
   a. If previousRef.current exists and is different from current path:
      - The outlet container ref still has the OLD content in the DOM at this point
        (useLayoutEffect fires synchronously after DOM mutations but before paint)
      - Clone outletRef.current.innerHTML into a snapshot div
      - Position snapshot absolutely over the outlet (same dimensions, z-index above)
      - Append snapshot to the outlet's parent
      - Update previousRef.current to new path
   b. After React paints the new route content underneath:
      - Run pageTurnExit on the snapshot div
      - Run pageEnter on the outlet container (new content)
      - On timeline complete, remove the snapshot div from DOM
3. The snapshot is a detached DOM clone — React's unmount of the old route component
   does NOT affect it. useGSAP cleanup on the old route kills its own animations,
   but the snapshot animation runs on a non-React-managed node.
4. Store the active timeline in a ref. If location changes again during animation,
   kill the active timeline, remove any existing snapshot, and start fresh.
5. z-index management: snapshot gets z-index 2, new content gets z-index 1.
   After animation, snapshot is removed entirely.

Module index mapping for direction:
```typescript
const MODULE_ORDER: Record<string, number> = {
  '/': 0,
  '/quests': 1,
  '/nutrition': 2,
  '/finance': 3,
  '/character': 4,
  '/settings': 5,
}
```

- [ ] **Step 2: Integrate into App.tsx**

Replace `<Outlet />` in the Layout route with `<AnimatedOutlet />`. The AnimatedOutlet renders `<Outlet />` internally.

- [ ] **Step 3: Add `data-anim="stagger-child"` to module containers**

Add the data attribute to top-level section elements in each module's main component (Dashboard, TaskList header/cards area, Transactions header/list, Today header/sections). This marks them as participants in the stagger animation.

- [ ] **Step 4: Remove old contentFadeIn CSS**

In `src/hub/styles/layout.css`, remove the `@keyframes contentFadeIn` and the `.content-area` animation that uses it. GSAP page turn replaces this.

- [ ] **Step 5: Test navigation**

Navigate between all modules via sidebar. Verify:
- Forward navigation (Quest → Coinify): page turns right-to-left
- Backward navigation (Coinify → Quest): page turns left-to-right
- Same module: simple crossfade
- Rapid navigation: previous animation killed, new one starts
- No React errors or orphan DOM nodes
- Stagger-child elements animate in sequence

- [ ] **Step 6: Commit**

```bash
git add src/shared/components/AnimatedOutlet.tsx src/App.tsx src/hub/styles/layout.css
git add src/modules/quests/components/TaskList.tsx src/modules/finance/components/Transactions.tsx src/modules/nutrition/components/Today.tsx
git commit -m "feat(transitions): AnimatedOutlet with 3D page turn effect"
```

---

### Task 9: Sub-route Crossfade

**Files:**
- Modify: `src/shared/components/AnimatedOutlet.tsx`

- [ ] **Step 1: Detect sub-route vs module navigation**

In AnimatedOutlet, compare the top-level path segment of the old and new routes. If the top-level is the same (e.g., both `/finance/*`), use `crossfade()` instead of `pageTurnExit()`.

```typescript
function getModulePath(pathname: string): string {
  return '/' + (pathname.split('/')[1] || '')
}
// If getModulePath(oldPath) === getModulePath(newPath) → crossfade
// Else → page turn with direction
```

- [ ] **Step 2: Test sub-route navigation**

Navigate between Coinify sub-routes (`/finance/transactions` → `/finance/loans`). Verify crossfade, not page turn. Navigate between modules — verify page turn still works.

- [ ] **Step 3: Commit**

```bash
git add src/shared/components/AnimatedOutlet.tsx
git commit -m "feat(transitions): crossfade for sub-route navigation within modules"
```

---

## Chunk 4: Micro-interactions

### Task 10: Quill Pen Checkbox

**Files:**
- Create: `src/shared/components/QuillCheckbox.tsx`
- Modify: `src/shared/components/Checkbox.tsx`

**Skills:** Load `gsap-core` and `gsap-react` skills before starting.

- [ ] **Step 1: Create QuillCheckbox component**

SVG-based checkbox with quill pen drawing animation:

```typescript
import { useRef, useCallback } from 'react'
import { useGSAP } from '@gsap/react'
import { gsap } from 'gsap'

interface QuillCheckboxProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}
```

SVG structure:
- Hidden native `<input type="checkbox">` for accessibility
- Visible SVG (24x24) with:
  - A rounded rect for the box (parchment fill, gold border)
  - A polyline path for the checkmark (`M6,13 L10,17 L18,7` — two segments)
  - Both with `stroke-dasharray` / `stroke-dashoffset` for draw animation

On check (checked becomes true):
1. Animate `strokeDashoffset` from full length to 0 (300ms, `power1.inOut`) — checkmark draws. Additionally, apply a CSS filter animation: `filter: blur(1px)` at the start of the stroke that animates to `filter: blur(0)` over the first 150ms of the drawing — simulating wet ink sharpening as it dries. Use `gsap.fromTo` on the SVG path's `filter` property in parallel with the strokeDashoffset tween.
2. Spawn 2 ink splatter `<span>` particles at checkmark endpoint, positioned randomly within 8px, fade out in 150ms
3. Return the timeline for parent to chain (strikethrough, XP toast)

On uncheck: instant reset, no animation (undo is quick).

- [ ] **Step 2: Update Checkbox.tsx to use QuillCheckbox**

Replace the current Checkbox implementation to render QuillCheckbox internally. Keep the same external API.

- [ ] **Step 3: Test in Questify**

Complete a subtask. Verify:
- Checkmark draws with quill effect
- Ink splatters appear and fade
- Unchecking is instant
- No accessibility regression (tab, space, screen reader)

- [ ] **Step 4: Commit**

```bash
git add src/shared/components/QuillCheckbox.tsx src/shared/components/Checkbox.tsx
git commit -m "feat(animations): quill pen checkbox with ink draw and splatter"
```

---

### Task 11: Task Completion Animation Chain

**Files:**
- Create: `src/shared/animations/feedback.ts`
- Modify: `src/modules/quests/components/SubtaskList.tsx`

**Skills:** Load `gsap-timeline` skill before starting.

- [ ] **Step 1: Create feedback.ts with completeTask**

```typescript
import { gsap } from 'gsap'

export function completeTask(
  taskElement: HTMLElement,
  textElement: HTMLElement,
): gsap.core.Timeline {
  const tl = gsap.timeline()

  // Strikethrough: animate a pseudo-element or overlay line from left to right
  const strikethrough = document.createElement('div')
  strikethrough.style.cssText = 'position:absolute;left:0;top:50%;height:2px;width:0;background:#8b7355;transform:translateY(-50%);pointer-events:none;'
  textElement.style.position = 'relative'
  textElement.appendChild(strikethrough)

  tl.to(strikethrough, {
    width: '100%',
    duration: 0.2,
    ease: 'power1.inOut',
  })
  tl.to(textElement, {
    opacity: 0.5,
    duration: 0.15,
  }, '<0.1')

  return tl
}

export function removeItem(element: HTMLElement): gsap.core.Timeline {
  const tl = gsap.timeline()
  tl.to(element, {
    x: -20,
    opacity: 0,
    duration: 0.2,
    ease: 'power2.in',
  })
  return tl
}

export function addTransaction(element: HTMLElement, borderFlash?: { el: HTMLElement; color: string }): gsap.core.Timeline {
  const tl = gsap.timeline()
  gsap.set(element, { opacity: 0, x: 30 })
  tl.to(element, {
    opacity: 1,
    x: 0,
    duration: 0.15,
    ease: 'power2.out',
  })
  if (borderFlash) {
    tl.fromTo(borderFlash.el, {
      borderColor: borderFlash.color,
    }, {
      borderColor: 'transparent',
      duration: 0.4,
      ease: 'power1.out',
    }, 0)
  }
  return tl
}

export function registerFood(element: HTMLElement): gsap.core.Timeline {
  const tl = gsap.timeline()
  gsap.set(element, { opacity: 0, scale: 0.95 })
  tl.to(element, {
    opacity: 1,
    scale: 1,
    duration: 0.1,
    ease: 'power2.out',
  })
  return tl
}
```

- [ ] **Step 2: Integrate into SubtaskList**

On subtask completion, chain: QuillCheckbox timeline → completeTask(strikethrough) → toast. The QuillCheckbox returns its timeline, the parent appends the strikethrough and toast to it.

- [ ] **Step 3: Test the full chain**

Complete a subtask in Questify. Verify: checkmark draws → ink splatters → text strikes through → XP toast appears. All in sequence, smooth.

- [ ] **Step 4: Commit**

```bash
git add src/shared/animations/feedback.ts src/modules/quests/components/SubtaskList.tsx
git commit -m "feat(animations): task completion chain — quill, strikethrough, toast"
```

---

### Task 12: XP Bar Golden Gleam

**Files:**
- Modify: `src/shared/components/XpBar.tsx`
- Modify: `src/hub/PlayerCard.tsx`

**Skills:** Load `gsap-core` and `gsap-react` skills before starting.

- [ ] **Step 1: Add gleam effect to XpBar**

After the XP bar width updates, a golden gradient overlay sweeps left-to-right across the full bar width. The gleam is brighter in the delta zone (the newly filled portion). Implemented as an absolutely-positioned pseudo-div inside the bar with a linear-gradient that animates `translateX` from -100% to 100%.

Duration: 400ms, `power1.inOut`. Triggered when the `value` prop changes (detected via useRef comparing previous value).

- [ ] **Step 2: Test XP bar gleam**

Complete a quest that gives XP. Watch the sidebar XP bar — verify golden gleam sweeps across, brighter in the new portion.

- [ ] **Step 3: Commit**

```bash
git add src/shared/components/XpBar.tsx src/hub/PlayerCard.tsx
git commit -m "feat(animations): golden gleam effect on XP bar update"
```

---

### Task 13: Transaction & Food Micro-interactions

**Files:**
- Modify: `src/modules/finance/components/Transactions.tsx`
- Modify: `src/modules/nutrition/components/Today.tsx`
- Modify: `src/modules/nutrition/components/FoodLogItem.tsx`
- Modify: `src/modules/nutrition/components/CalorieProgressBar.tsx`

**Skills:** Load `gsap-core` and `gsap-react` skills before starting.

- [ ] **Step 1: Transaction slide-in**

When a new transaction is added, use `addTransaction()` from feedback.ts on the new row element. Pass the `borderFlash` parameter with the hero balance section element and the appropriate color (red for expense, gold for income).

- [ ] **Step 2: Food item scale-in**

When a new food item is logged, use `registerFood()` from feedback.ts on the new FoodLogItem element.

- [ ] **Step 3: Calorie bar gleam**

Apply the same golden gleam pattern from XpBar to CalorieProgressBar. Extract the gleam logic into a reusable function in feedback.ts: `barGleam(barElement: HTMLElement, duration?: number)`.

- [ ] **Step 4: Test both modules**

- Coinify: add a transaction → row slides in, balance animates, border flashes
- Nutrify: log food → item scales in, calorie bar gleams

- [ ] **Step 5: Commit**

```bash
git add src/shared/animations/feedback.ts
git add src/modules/finance/components/Transactions.tsx
git add src/modules/nutrition/components/Today.tsx src/modules/nutrition/components/FoodLogItem.tsx src/modules/nutrition/components/CalorieProgressBar.tsx
git commit -m "feat(animations): transaction slide-in, food scale-in, calorie bar gleam"
```

---

## Chunk 5: Epic Moments

### Task 14: Level Up Epic Animation

**Files:**
- Create: `src/shared/animations/epic.ts`
- Modify: `src/hub/Layout.tsx`

**Skills:** Load `gsap-timeline` and `gsap-react` skills before starting.

- [ ] **Step 1: Create epic.ts with levelUp function**

```typescript
import { gsap } from 'gsap'

export function levelUp(
  overlayEl: HTMLElement,
  bookEl: HTMLElement,
  levelTextEl: HTMLElement,
  onDismiss: () => void,
): gsap.core.Timeline {
  const tl = gsap.timeline({
    onComplete: onDismiss,
  })

  // Phase 1: Darken overlay (200ms)
  gsap.set(overlayEl, { opacity: 0, display: 'flex' })
  tl.to(overlayEl, { opacity: 1, duration: 0.2 })

  // Phase 2: Book opens (500ms)
  const leftCover = bookEl.querySelector('[data-book="left"]') as HTMLElement
  const rightCover = bookEl.querySelector('[data-book="right"]') as HTMLElement
  gsap.set([leftCover, rightCover], { rotateY: 0 })
  tl.to(leftCover, {
    rotateY: -105,
    duration: 0.5,
    ease: 'power3.out',
    transformOrigin: 'left center',
    transformPerspective: 1200,
  }, 0.2)
  tl.to(rightCover, {
    rotateY: 105,
    duration: 0.5,
    ease: 'power3.out',
    transformOrigin: 'right center',
    transformPerspective: 1200,
  }, 0.2)

  // Phase 3: Level text draws in with quill effect (400ms)
  const textPath = levelTextEl.querySelector('path')
  if (textPath) {
    const length = textPath.getTotalLength()
    gsap.set(textPath, { strokeDasharray: length, strokeDashoffset: length })
    tl.to(textPath, {
      strokeDashoffset: 0,
      duration: 0.4,
      ease: 'power1.inOut',
    }, 0.6)
  }
  tl.to(levelTextEl, { opacity: 1, duration: 0.3 }, 0.6)

  // Phase 4: Golden glow pulse (300ms)
  tl.fromTo(bookEl, {
    boxShadow: '0 0 0 rgba(212,160,23,0)',
  }, {
    boxShadow: '0 0 80px rgba(212,160,23,0.6)',
    duration: 0.3,
    ease: 'power2.out',
  }, 1.0)
  tl.to(bookEl, {
    boxShadow: '0 0 20px rgba(212,160,23,0.2)',
    duration: 0.3,
  }, 1.3)

  // Phase 5: Particles — create 15-20 golden motes floating up (1000ms)
  for (let i = 0; i < 18; i++) {
    const mote = document.createElement('span')
    mote.style.cssText = `position:absolute;width:${2 + Math.random() * 4}px;height:${2 + Math.random() * 4}px;border-radius:50%;background:rgba(212,160,23,${0.5 + Math.random() * 0.5});pointer-events:none;`
    bookEl.appendChild(mote)
    const startX = -40 + Math.random() * 80
    const startY = 20 + Math.random() * 40
    gsap.set(mote, { x: startX, y: startY, opacity: 0 })
    tl.to(mote, {
      y: startY - 60 - Math.random() * 40,
      x: startX + (-20 + Math.random() * 40),
      opacity: 1,
      duration: 0.3,
      ease: 'power1.out',
    }, 1.0 + Math.random() * 0.3)
    tl.to(mote, {
      opacity: 0,
      duration: 0.4,
      onComplete: () => mote.remove(),
    }, 1.4 + Math.random() * 0.3)
  }

  // Phase 6: Dismiss (400ms)
  tl.to(overlayEl, {
    opacity: 0,
    duration: 0.4,
    onComplete: () => { overlayEl.style.display = 'none' },
  }, '+=0.3')

  return tl
}
```

- [ ] **Step 2: Replace current level-up modal in Layout.tsx**

Remove the current level-up modal JSX and its CSS animation classes. Replace with new markup that the `levelUp()` function targets:
- A full-screen overlay div (sepia background, not black)
- A book container with left/right cover divs
- A level text area (SVG or styled text)

Wire the `levelUp()` function to trigger when `showLevelUp` state becomes true. Pass `onDismiss` to reset state. Add click handler on overlay for early dismiss (kills timeline, triggers dismiss phase).

Sync `playLevelUp()` sound call with phase 3 (the text reveal).

- [ ] **Step 3: Test level up**

Manually trigger a level up (either by gaining enough XP or temporarily lowering the threshold). Verify:
- Sepia overlay fades in
- Book covers open with 3D effect
- Level text appears
- Golden glow pulses
- Particles float up
- Auto-dismiss works
- Click-to-dismiss works (early exit)
- Sound plays at the right moment

- [ ] **Step 4: Commit**

```bash
git add src/shared/animations/epic.ts src/hub/Layout.tsx
git commit -m "feat(animations): epic level-up with book open, quill text, particles"
```

---

### Task 15: Streak Animation

**Files:**
- Modify: `src/shared/animations/epic.ts`
- Modify: `src/hub/PlayerCard.tsx`

- [ ] **Step 1: Add streakAchieved function to epic.ts**

```typescript
export function streakAchieved(
  streakEl: HTMLElement,
  count: number,
): gsap.core.Timeline {
  const tl = gsap.timeline()
  const isHighStreak = count >= 30
  const particleCount = isHighStreak ? 6 : 2

  // Icon scale with elastic bounce
  tl.to(streakEl, {
    scale: 1.5,
    duration: 0.4,
    ease: 'elastic.out(1, 0.5)',
  })
  tl.to(streakEl, {
    scale: 1,
    duration: 0.3,
    ease: 'power2.out',
  })

  // Fire halo pulse
  tl.fromTo(streakEl, {
    boxShadow: '0 0 0 rgba(230,126,34,0)',
  }, {
    boxShadow: `0 0 ${isHighStreak ? 30 : 15}px rgba(230,126,34,0.6)`,
    duration: 0.3,
  }, 0)
  tl.to(streakEl, {
    boxShadow: '0 0 0 rgba(230,126,34,0)',
    duration: 0.4,
  }, 0.4)

  // Fire particles
  for (let i = 0; i < particleCount; i++) {
    const spark = document.createElement('span')
    spark.style.cssText = `position:absolute;width:3px;height:3px;border-radius:50%;background:#e67e22;pointer-events:none;`
    streakEl.style.position = 'relative'
    streakEl.appendChild(spark)
    const spread = isHighStreak ? 20 : 10
    gsap.set(spark, { x: -spread/2 + Math.random() * spread, y: 0, opacity: 0 })
    tl.to(spark, {
      y: -15 - Math.random() * 15,
      opacity: 1,
      duration: 0.2,
    }, 0.2 + i * 0.05)
    tl.to(spark, {
      opacity: 0,
      duration: isHighStreak ? 0.4 : 0.2,
      onComplete: () => spark.remove(),
    }, 0.4 + i * 0.05)
  }

  return tl
}
```

- [ ] **Step 2: Wire streak animation in PlayerCard**

When a streak milestone is reached (3, 7, 14, 30 days), trigger `streakAchieved()` on the streak icon element. This fires AFTER the quest completion chain finishes (listen for the XP update event or use a callback).

- [ ] **Step 3: Test streak animation**

Trigger a streak milestone. Verify elastic bounce, fire halo, particles. Test high streak (30+) for more intense particles.

- [ ] **Step 4: Commit**

```bash
git add src/shared/animations/epic.ts src/hub/PlayerCard.tsx
git commit -m "feat(animations): streak milestone with elastic bounce and fire particles"
```

---

### Task 16: Loan Paid Off Animation

**Files:**
- Modify: `src/shared/animations/epic.ts`
- Modify: `src/modules/finance/components/Loans.tsx` (or wherever loan completion is handled)

- [ ] **Step 1: Add loanPaidOff function to epic.ts**

Scale + rotate the row (enhanced chainBreak), then stamp a golden wax seal with `back.out` scale (0 → 1.15 → 1), then fade to completed state.

- [ ] **Step 2: Wire into loan completion handler**

When a loan is fully paid, trigger `loanPaidOff()` on the row element.

- [ ] **Step 3: Test loan paid off**

Pay off a loan. Verify chain break → wax seal stamp → fade to completed.

- [ ] **Step 4: Commit**

```bash
git add src/shared/animations/epic.ts src/modules/finance/components/Loans.tsx
git commit -m "feat(animations): loan paid off with chain break and wax seal stamp"
```

---

## Chunk 6: ScrollTrigger

### Task 17: Scroll Reveal Hook

**Files:**
- Create: `src/shared/animations/useScrollReveal.ts`

**Skills:** Load `gsap-scrolltrigger` and `gsap-react` skills before starting.

- [ ] **Step 1: Create useScrollReveal hook**

```typescript
import { useRef } from 'react'
import { useGSAP } from '@gsap/react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

interface ScrollRevealOptions {
  stagger?: number
  y?: number
  duration?: number
  disabled?: boolean  // for disabling during drag
}

export function useScrollReveal(
  containerSelector: string,
  itemSelector: string,
  options: ScrollRevealOptions = {},
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const triggersRef = useRef<ScrollTrigger[]>([])

  const {
    stagger = 0.03,
    y = 15,
    duration = 0.2,
  } = options

  useGSAP(() => {
    if (!containerRef.current) return

    const items = containerRef.current.querySelectorAll(itemSelector)
    if (items.length === 0) return

    // Only animate items that are NOT already visible on initial render
    ScrollTrigger.batch(items, {
      onEnter: (batch) => {
        gsap.fromTo(batch, {
          opacity: 0,
          y,
        }, {
          opacity: 1,
          y: 0,
          duration,
          stagger,
          ease: 'power1.out',
          overwrite: true,
        })
      },
      start: 'top bottom-=50',
      once: true,
      scroller: containerRef.current,
    })

    triggersRef.current = ScrollTrigger.getAll()
  }, { scope: containerRef, dependencies: [] })

  // Methods for dnd-kit integration
  const disableScrollTrigger = () => {
    triggersRef.current.forEach(t => t.disable())
  }
  const enableScrollTrigger = () => {
    triggersRef.current.forEach(t => t.enable())
  }

  return { containerRef, disableScrollTrigger, enableScrollTrigger }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/animations/useScrollReveal.ts
git commit -m "feat(animations): useScrollReveal hook with ScrollTrigger.batch"
```

---

### Task 18: Integrate ScrollTrigger in Questify

**Files:**
- Modify: `src/modules/quests/components/TaskList.tsx`

- [ ] **Step 1: Apply useScrollReveal to task list**

Add `useScrollReveal` to the TaskList component. The container is the scrollable quest list wrapper. The items are individual quest cards.

Wire dnd-kit's `onDragStart` → `disableScrollTrigger()` and `onDragEnd` → `enableScrollTrigger()`.

- [ ] **Step 2: Mark quest cards with data attribute**

Add `data-anim="quest-card"` to each quest card element for ScrollTrigger targeting.

- [ ] **Step 3: Test ScrollTrigger**

Open Questify with enough tasks to require scrolling. Scroll down — verify cards cascade in with fade + slide. Scroll back up — cards stay visible (once: true). Drag a task to reorder — verify no animation glitches during drag.

- [ ] **Step 4: Commit**

```bash
git add src/modules/quests/components/TaskList.tsx
git commit -m "feat(animations): ScrollTrigger batch reveal on quest list with drag safety"
```

---

## Chunk 7: CSS Cleanup & First Load

### Task 19: First App Load Book Open

**Files:**
- Modify: `src/shared/components/AnimatedOutlet.tsx`

- [ ] **Step 1: Add first-load detection**

Use a module-level `let isFirstLoad = true` flag. On the FIRST render of AnimatedOutlet, run `bookOpen()` instead of a page turn. Set `isFirstLoad = false` after. Subsequent navigations use page turn as normal.

- [ ] **Step 2: Test first load**

Close and reopen the app. Verify dashboard content enters with the book-opening animation. Navigate to another module — verify normal page turn (not book open).

- [ ] **Step 3: Commit**

```bash
git add src/shared/components/AnimatedOutlet.tsx
git commit -m "feat(animations): book open animation on first app load"
```

---

### Task 20: Remove Replaced CSS Animations

**Files:**
- Modify: `src/modules/quests/styles/quests.css`
- Modify: `src/modules/finance/styles/coinify.css`
- Modify: `src/modules/nutrition/styles/nutri.css`
- Modify: `src/hub/styles/layout.css`

- [ ] **Step 1: Remove GSAP-replaced keyframes from quests.css**

Remove `@keyframes questCardEnter`, `@keyframes questCardExit`, `@keyframes xp-toast-in`, and any CSS rules that reference them. Keep shimmer and hover animations.

- [ ] **Step 2: Remove GSAP-replaced keyframes from coinify.css**

Remove `@keyframes coinSlideIn`, `@keyframes coinFadeOut`, `@keyframes coinToastIn`, `@keyframes coinStaggerIn`, `@keyframes coinContentFadeIn`. Keep shimmer, hover, and seal/chain animations that aren't yet replaced (or are still used as fallbacks).

- [ ] **Step 3: Remove GSAP-replaced keyframes from nutri.css**

Remove `@keyframes nutriStaggerIn`, `@keyframes nutriSlideIn`, `@keyframes nutriFadeOut`, `@keyframes nutriToastIn`. Keep shimmer.

- [ ] **Step 4: Remove contentFadeIn from layout.css**

Remove `@keyframes contentFadeIn` and the animation rule on the content area. Already replaced by page turn.

- [ ] **Step 5: Search for orphan references**

Search the entire codebase for any CSS class names that referenced the removed keyframes. Remove any orphan classes from components.

- [ ] **Step 6: Test all modules**

Navigate through every module and sub-route. Verify no visual regressions, no missing animations, no console errors. Check:
- Dashboard loads correctly
- Questify: tasks display, complete, reorder
- Coinify: transactions, balance, all sub-routes
- Nutrify: food log, calorie bar, all sub-routes

- [ ] **Step 7: Commit**

```bash
git add src/modules/quests/styles/quests.css src/modules/finance/styles/coinify.css
git add src/modules/nutrition/styles/nutri.css src/hub/styles/layout.css
git commit -m "refactor(css): remove keyframes replaced by GSAP animations"
```

---

### Task 20b: Unit Tests for Core Animation Utilities

**Files:**
- Create: `src/shared/animations/__tests__/gsap-setup.test.ts`
- Create: `src/shared/components/__tests__/useToast.test.ts`

- [ ] **Step 1: Test GSAP setup**

Write a vitest test that verifies:
- GSAP is loaded with correct defaults (duration 0.3, ease power2.out)
- ScrollTrigger plugin is registered
- Import does not throw

- [ ] **Step 2: Test useToast hook**

Write a vitest test using renderHook that verifies:
- useToast throws when used outside ToastProvider
- toast() adds a toast to the queue
- Toast auto-dismisses after 2.5s (use vi.useFakeTimers)
- Max 3 toasts visible at once

- [ ] **Step 3: Run tests**

Run: `npx vitest run --reporter=verbose`
Expected: All new tests pass. Existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add src/shared/animations/__tests__/ src/shared/components/__tests__/
git commit -m "test: unit tests for GSAP setup and unified toast system"
```

---

## Chunk 8: Final Integration Testing

### Task 21: Full Integration Smoke Test

- [ ] **Step 1: Test complete user flow**

Run through the app as a user would:
1. Open app → book open animation
2. Dashboard → navigate to Questify → page turn forward
3. Complete a task → quill checkbox → strikethrough → XP toast
4. XP bar gleams in sidebar
5. Navigate to Nutrify → page turn forward
6. Log food → scale-in → calorie bar gleams → nutri toast
7. Navigate to Coinify → page turn forward
8. Add transaction → slide-in → balance animates → coin toast → border flash
9. Navigate back to Questify → page turn backward
10. Scroll quest list → cards cascade in

Verify no console errors, no memory leaks (check DevTools Performance tab), no orphan DOM nodes.

- [ ] **Step 2: Test reduced motion**

Enable "Reduce motion" in Windows settings (Settings → Accessibility → Visual effects → Animation effects: Off). Reload app. Verify:
- No page turn (crossfade instead)
- No quill draw (instant checkmark)
- No particles
- Toasts have minimal animation
- ScrollTrigger disabled

- [ ] **Step 3: Test rapid navigation**

Click between modules rapidly (5+ rapid clicks). Verify no orphan snapshots, no stacking transitions, no layout breaks. The last navigation should complete cleanly.

- [ ] **Step 4: Commit final state**

```bash
git add -A
git commit -m "test: full integration smoke test — all GSAP animations verified"
```
