import { useRef, useLayoutEffect, useCallback, useImperativeHandle, forwardRef, createContext, useContext, Suspense } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { PageFlip } from 'page-flip'
import { bookOpen } from '../animations/transitions'
import { playPageFlip } from '../audio'
import { preloadRoute } from '../../routes'
import Loading from './Loading'
import bgTexture from '../../assets/bg.jpg'

let isFirstLoad = true

/** Sidebar order — it decides which way the page turns. A route missing from
    this map falls to the end, which made /achievements ↔ /rewards flip the
    same way in both directions. */
const MODULE_ORDER: Record<string, number> = {
  '/': 0,
  '/quests': 1,
  '/nutrition': 2,
  '/finance': 3,
  '/cauldron': 4,
  '/achievements': 5,
  '/rewards': 6,
  '/character': 7,
  '/settings': 8,
}

function getModulePath(pathname: string): string {
  return '/' + (pathname.split('/')[1] || '')
}

export type AnimatedNavigateFn = (to: string) => void
const AnimatedNavigateContext = createContext<AnimatedNavigateFn>(() => {})
export function useAnimatedNavigate(): AnimatedNavigateFn {
  return useContext(AnimatedNavigateContext)
}
export { AnimatedNavigateContext }

export interface AnimatedOutletHandle {
  animatedNavigate: AnimatedNavigateFn
}

/** localStorage flag the Settings page toggles: 'false' disables page flips. */
export const PAGE_ANIMATIONS_KEY = 'hubtify_page_animations'

function pageAnimationsEnabled(): boolean {
  try {
    if (localStorage.getItem(PAGE_ANIMATIONS_KEY) === 'false') return false
  } catch { /* storage unavailable */ }
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

const pageBgStyle = (pad: string) =>
  `width:100%;height:100%;background:var(--parch-0) url(${bgTexture}) repeat;background-size:600px;padding:${pad};box-sizing:border-box;overflow:hidden;`

/** Takes a live DOM subtree clone — never a serialize/reparse round-trip. */
function createPageDiv(content: Node, pad: string): HTMLElement {
  const page = document.createElement('div')
  const inner = document.createElement('div')
  inner.style.cssText = pageBgStyle(pad)
  inner.appendChild(content)
  page.appendChild(inner)
  return page
}

/** Two frames: one for React to commit, one for the browser to lay it out. */
function afterTwoFrames(fn: () => void) {
  requestAnimationFrame(() => requestAnimationFrame(fn))
}

/** Ceiling on the chunk wait — a slow disk must never hold the click hostage. */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, ms) })
}

/**
 * Resolves once React has actually swapped the outlet's subtree for the new
 * route's.
 *
 * Asking "does the outlet have content?" is not enough: the OUTGOING tree
 * answers yes on the very first frame, so the flip cloned the page you were
 * leaving and used it as its own destination — the book turned from a page
 * onto a copy of itself. Measured on a warm chunk: the flip container was
 * built at 36ms, React committed the new route at 100ms. Node identity is the
 * only honest signal that the swap happened; a plain frame count guesses.
 *
 * The deadline is wall-clock, not frames, so a 120Hz display and a throttled
 * background tab wait the same amount of real time.
 */
function waitForSwap(
  el: () => HTMLElement | null,
  previous: Element | null,
  maxMs = 250,
): Promise<void> {
  return new Promise(resolve => {
    const deadline = performance.now() + maxMs
    const tick = () => {
      const node = el()
      const child = node?.firstElementChild ?? null
      const swapped = child !== null && child !== previous && node!.getBoundingClientRect().height > 0
      if (swapped || performance.now() >= deadline) {
        resolve()
        return
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

function cleanup() {
  document.querySelectorAll('[data-flip-cover],[data-flip-container]').forEach(el => el.remove())
}

const AnimatedOutlet = forwardRef<AnimatedOutletHandle>(function AnimatedOutlet(_props, ref) {
  const location = useLocation()
  const navigate = useNavigate()
  const outletRef = useRef<HTMLDivElement>(null)
  // A counter, not a boolean: on two fast clicks the second run killed the
  // first PageFlip but the first run's queued frame callback still saw the
  // flag set — by the second run — and built a second container on top.
  // Every await point below re-checks its own generation instead.
  const genRef = useRef(0)
  const activeRef = useRef(false)
  const pfRef = useRef<InstanceType<typeof PageFlip> | null>(null)

  useLayoutEffect(() => {
    if (!isFirstLoad || !outletRef.current) return
    isFirstLoad = false
    bookOpen(outletRef.current)
  }, [])

  /** Navigating used to leave the new page scrolled where the old one was. */
  const resetScroll = useCallback(() => {
    const main = outletRef.current?.closest('.main-content') as HTMLElement | null
    if (main) main.scrollTop = 0
  }, [])

  const animatedNavigate = useCallback((to: string) => {
    const currentPath = location.pathname
    if (to === currentPath) return

    const goPlain = () => { navigate(to); afterTwoFrames(resetScroll) }

    const isSameModule = getModulePath(currentPath) === getModulePath(to)
    if (isSameModule) { navigate(to); return }
    if (!outletRef.current) { goPlain(); return }
    if (!pageAnimationsEnabled()) { goPlain(); return }
    if (!outletRef.current.firstChild) { goPlain(); return }

    const gen = ++genRef.current

    // A flip still running belongs to a click the user has already changed
    // their mind about: kill it before starting this one.
    if (activeRef.current) {
      try { pfRef.current?.destroy() } catch { /* ignore */ }
      pfRef.current = null
      cleanup()
      activeRef.current = false
    }

    void (async () => {
      // Wait for the destination chunk BEFORE anything freezes: /achievements
      // and /rewards were cloned while their chunk was still on disk, so the
      // book turned onto a blank page and the content popped in afterwards.
      // No cover yet on purpose — the old view stays live and interactive
      // while it downloads; the cover only exists to hide `navigate()`.
      await Promise.race([preloadRoute(to), sleep(250)])
      if (genRef.current !== gen) return
      if (!outletRef.current) { goPlain(); return }

      const mainContent = outletRef.current.closest('.main-content') as HTMLElement
      if (!mainContent) { goPlain(); return }

      activeRef.current = true

      const rect = mainContent.getBoundingClientRect()
      const w = Math.round(rect.width)
      const h = Math.round(rect.height)
      const pad = getComputedStyle(mainContent).padding

      const fromOrder = MODULE_ORDER[getModulePath(currentPath)] ?? 99
      const toOrder = MODULE_ORDER[getModulePath(to)] ?? 99
      const forward = toOrder >= fromOrder

      // cloneNode instead of reading innerHTML and re-parsing it into two new
      // trees: on a 100-row list that was hundreds of KB serialised twice.
      // ONE clone of the old view for the whole navigation — it lives in the
      // cover first and is handed over to the outgoing flip page below.
      const oldClone = outletRef.current.cloneNode(true) as HTMLElement

      // Taken from the LIVE node, not the clone: this is the identity
      // `waitForSwap` compares against to know React finished the handover.
      const previousChild = outletRef.current.firstElementChild

      // Cover: locks the old view in place instantly — prevents any flash
      const scrollTop = mainContent.scrollTop
      const cover = document.createElement('div')
      cover.setAttribute('data-flip-cover', '')
      // Below --z-tour (9500): the transition used to paint over the onboarding tour.
      cover.style.cssText = `position:fixed;top:${rect.top}px;left:${rect.left}px;z-index:var(--z-page-transition);pointer-events:none;overflow:hidden;contain:layout paint;background:var(--parch-0) url(${bgTexture}) repeat;background-size:600px;padding:${pad};box-sizing:border-box;width:${w}px;height:${h}px;`
      // Offset content to match the scroll position the user was at
      const wrapper = document.createElement('div')
      wrapper.style.cssText = `transform:translateY(-${scrollTop}px);`
      wrapper.appendChild(oldClone)
      cover.appendChild(wrapper)
      document.body.appendChild(cover)

      // Navigate — cover is showing old content so user sees nothing change
      navigate(to)

      // Wait for the swap, not for "some content": two fixed frames were not
      // enough for a route whose chunk had just arrived (the flip cloned an
      // empty div), and merely having content is a test the outgoing page also
      // passes (the flip cloned the page it was leaving).
      await waitForSwap(() => outletRef.current, previousChild)

      // Scroll reset must happen after the new tree is laid out, otherwise
      // the browser clamps it back against the old scrollHeight.
      resetScroll()

      // If another navigation happened while we waited, bail — and leave
      // `activeRef` alone, the newer run owns it now.
      if (genRef.current !== gen) { cover.remove(); return }

      const newClone = (outletRef.current?.cloneNode(true) as HTMLElement | undefined)
        ?? (oldClone.cloneNode(true) as HTMLElement)

      const container = document.createElement('div')
      container.setAttribute('data-flip-container', '')
      container.style.cssText = `position:fixed;top:${rect.top}px;left:${rect.left}px;width:${w}px;height:${h}px;z-index:calc(var(--z-page-transition) + 1);pointer-events:none;overflow:hidden;will-change:transform;contain:layout paint;`
      document.body.appendChild(container)

      // `createPageDiv` moves `oldClone` out of the cover rather than taking a
      // third deep clone of it. Nothing paints between here and `loadFromHTML`
      // — it is all one task — and the container sits above the cover, so the
      // old view is on screen without interruption until the flip starts.
      const oldPage = createPageDiv(oldClone, pad)
      const newPage = createPageDiv(newClone, pad)
      const pages = [oldPage, newPage]

      if (!forward) {
        container.style.transformOrigin = 'center'
        container.style.transform = 'scaleX(-1)'
        oldPage.querySelector('div')!.style.transform = 'scaleX(-1)'
        newPage.querySelector('div')!.style.transform = 'scaleX(-1)'
      }

      pages.forEach(p => container.appendChild(p))

      try {
        const pf = new PageFlip(container, {
          width: w,
          height: h,
          size: 'fixed',
          usePortrait: true,
          showCover: false,
          drawShadow: true,
          maxShadowOpacity: 0.5,
          flippingTime: 450,
          useMouseEvents: false,
          showPageCorners: false,
          startPage: 0,
          autoSize: false,
        })

        pfRef.current = pf
        pf.loadFromHTML(pages)

        pf.on('flip', () => {
          // Small delay to let the last frame paint before removing
          requestAnimationFrame(() => {
            try { pf.destroy() } catch { /* ignore */ }
            container.remove()
            // A newer navigation already owns these refs — clearing them from
            // here would tell it there is no live flip to kill.
            if (genRef.current !== gen) return
            pfRef.current = null
            activeRef.current = false
          })
        })

        // Remove cover and start flip in the same frame — no gap
        requestAnimationFrame(() => {
          cover.remove()
          // A newer navigation already destroyed this PageFlip — flipping it
          // now would animate a dead instance, and whoosh for nothing.
          if (genRef.current !== gen) return
          // Sound lives here, not at the click: with the chunk wait in front
          // of it the page used to whoosh up to 250ms before it moved.
          playPageFlip()
          pf.flipNext('top')
        })
      } catch {
        cover.remove()
        container.remove()
        if (genRef.current !== gen) return
        pfRef.current = null
        activeRef.current = false
      }
    })()
  }, [location.pathname, navigate, resetScroll])

  useImperativeHandle(ref, () => ({ animatedNavigate }), [animatedNavigate])

  // Routes are code-split. src/routes.tsx keeps each resolved chunk in a closure
  // and prefetches them on idle, so in practice this fallback only shows if you
  // navigate in the first moments after startup — the flip transition below
  // still reads whatever is inside `outletRef`, spinner included, and degrades
  // to a plain flip rather than breaking.
  return (
    <div ref={outletRef}>
      <Suspense fallback={<Loading />}>
        <Outlet />
      </Suspense>
    </div>
  )
})

export default AnimatedOutlet
