import { useRef, useLayoutEffect, useCallback, useImperativeHandle, forwardRef, createContext, useContext } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { PageFlip } from 'page-flip'
import { bookOpen } from '../animations/transitions'
import { playPageFlip } from '../audio'
import bgTexture from '../../assets/bg.jpg'

let isFirstLoad = true

const MODULE_ORDER: Record<string, number> = {
  '/': 0,
  '/quests': 1,
  '/nutrition': 2,
  '/finance': 3,
  '/character': 4,
  '/settings': 5,
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

function cleanup() {
  document.querySelectorAll('[data-flip-cover],[data-flip-container]').forEach(el => el.remove())
}

const AnimatedOutlet = forwardRef<AnimatedOutletHandle>(function AnimatedOutlet(_props, ref) {
  const location = useLocation()
  const navigate = useNavigate()
  const outletRef = useRef<HTMLDivElement>(null)
  const animatingRef = useRef(false)
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

    // cloneNode instead of reading innerHTML and re-parsing it into two new
    // trees: on a 100-row list that was hundreds of KB serialised twice.
    const oldClone = outletRef.current.cloneNode(true) as HTMLElement

    // If already animating, kill previous and proceed with new
    if (animatingRef.current) {
      try { pfRef.current?.destroy() } catch { /* ignore */ }
      pfRef.current = null
      cleanup()
    }

    animatingRef.current = true
    playPageFlip()

    const mainContent = outletRef.current.closest('.main-content') as HTMLElement
    if (!mainContent) { animatingRef.current = false; goPlain(); return }

    const rect = mainContent.getBoundingClientRect()
    const w = Math.round(rect.width)
    const h = Math.round(rect.height)
    const pad = getComputedStyle(mainContent).padding

    const fromOrder = MODULE_ORDER[getModulePath(currentPath)] ?? 99
    const toOrder = MODULE_ORDER[getModulePath(to)] ?? 99
    const forward = toOrder >= fromOrder

    // Cover: locks the old view in place instantly — prevents any flash
    const scrollTop = mainContent.scrollTop
    const cover = document.createElement('div')
    cover.setAttribute('data-flip-cover', '')
    // Below --z-tour (9500): the transition used to paint over the onboarding tour.
    cover.style.cssText = `position:fixed;top:${rect.top}px;left:${rect.left}px;z-index:var(--z-page-transition);pointer-events:none;overflow:hidden;background:var(--parch-0) url(${bgTexture}) repeat;background-size:600px;padding:${pad};box-sizing:border-box;width:${w}px;height:${h}px;`
    // Offset content to match the scroll position the user was at
    const wrapper = document.createElement('div')
    wrapper.style.cssText = `transform:translateY(-${scrollTop}px);`
    wrapper.appendChild(oldClone.cloneNode(true))
    cover.appendChild(wrapper)
    document.body.appendChild(cover)

    // Navigate — cover is showing old content so user sees nothing change
    navigate(to)

    // Two frames instead of a flat 150ms: one for React to commit the new
    // tree, one for the browser to lay it out. The cover hides the swap.
    afterTwoFrames(() => {
        // Scroll reset must happen after the new tree is laid out, otherwise
        // the browser clamps it back against the old scrollHeight.
        resetScroll()

        // If another navigation happened while we waited, bail
        if (!animatingRef.current) { cover.remove(); return }

        const newClone = (outletRef.current?.cloneNode(true) as HTMLElement | undefined)
          ?? (oldClone.cloneNode(true) as HTMLElement)

        const container = document.createElement('div')
        container.setAttribute('data-flip-container', '')
        container.style.cssText = `position:fixed;top:${rect.top}px;left:${rect.left}px;width:${w}px;height:${h}px;z-index:calc(var(--z-page-transition) + 1);pointer-events:none;overflow:hidden;`
        document.body.appendChild(container)

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
              pfRef.current = null
              container.remove()
              animatingRef.current = false
            })
          })

          // Remove cover and start flip in the same frame — no gap
          requestAnimationFrame(() => {
            cover.remove()
            pf.flipNext('top')
          })
        } catch {
          cover.remove()
          container.remove()
          pfRef.current = null
          animatingRef.current = false
        }
    })
  }, [location.pathname, navigate, resetScroll])

  useImperativeHandle(ref, () => ({ animatedNavigate }), [animatedNavigate])

  return (
    <div ref={outletRef}>
      <Outlet />
    </div>
  )
})

export default AnimatedOutlet
