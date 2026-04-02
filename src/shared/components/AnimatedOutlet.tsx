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

const pageBgStyle = (pad: string) =>
  `width:100%;height:100%;background:var(--rpg-parchment,#f5f0e1) url(${bgTexture}) repeat;background-size:600px;padding:${pad};box-sizing:border-box;overflow:hidden;`

function createPageDiv(html: string, pad: string): HTMLElement {
  const page = document.createElement('div')
  const inner = document.createElement('div')
  inner.innerHTML = html
  inner.style.cssText = pageBgStyle(pad)
  page.appendChild(inner)
  return page
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

  const animatedNavigate = useCallback((to: string) => {
    const currentPath = location.pathname
    if (to === currentPath) return

    const isSameModule = getModulePath(currentPath) === getModulePath(to)
    if (isSameModule) { navigate(to); return }
    if (!outletRef.current) { navigate(to); return }

    const oldHtml = outletRef.current.innerHTML
    if (!oldHtml) { navigate(to); return }

    // If already animating, kill previous and proceed with new
    if (animatingRef.current) {
      try { pfRef.current?.destroy() } catch { /* ignore */ }
      pfRef.current = null
      cleanup()
    }

    animatingRef.current = true
    playPageFlip()

    const mainContent = outletRef.current.closest('.main-content') as HTMLElement
    if (!mainContent) { navigate(to); animatingRef.current = false; return }

    const rect = mainContent.getBoundingClientRect()
    const w = Math.round(rect.width)
    const h = Math.round(rect.height)
    const pad = getComputedStyle(mainContent).padding

    const fromOrder = MODULE_ORDER[getModulePath(currentPath)] ?? 99
    const toOrder = MODULE_ORDER[getModulePath(to)] ?? 99
    const forward = toOrder >= fromOrder

    // Cover: locks the old view in place instantly — prevents any flash
    const cover = document.createElement('div')
    cover.setAttribute('data-flip-cover', '')
    cover.innerHTML = oldHtml
    cover.style.cssText = `position:fixed;top:${rect.top}px;left:${rect.left}px;width:${w}px;height:${h}px;z-index:9998;pointer-events:none;overflow:hidden;${pageBgStyle(pad)}`
    document.body.appendChild(cover)

    // Navigate — cover is showing old content so user sees nothing change
    navigate(to)

    // Wait for React to render new content + initial data fetch
    // Cover keeps old content visible during the wait
    setTimeout(() => {
        // If another navigation happened while we waited, bail
        if (!animatingRef.current) { cover.remove(); return }

        const newHtml = outletRef.current?.innerHTML || oldHtml

        const container = document.createElement('div')
        container.setAttribute('data-flip-container', '')
        container.style.cssText = `position:fixed;top:${rect.top}px;left:${rect.left}px;width:${w}px;height:${h}px;z-index:9999;pointer-events:none;overflow:hidden;`
        document.body.appendChild(container)

        const oldPage = createPageDiv(oldHtml, pad)
        const newPage = createPageDiv(newHtml, pad)
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
    }, 150)
  }, [location.pathname, navigate])

  useImperativeHandle(ref, () => ({ animatedNavigate }), [animatedNavigate])

  return (
    <div ref={outletRef}>
      <Outlet />
    </div>
  )
})

export default AnimatedOutlet
