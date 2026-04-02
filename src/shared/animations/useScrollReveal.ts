import { useRef } from 'react'
import { useGSAP } from '@gsap/react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

interface ScrollRevealOptions {
  stagger?: number
  y?: number
  duration?: number
}

export function useScrollReveal(
  itemSelector: string,
  options: ScrollRevealOptions = {},
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const triggersRef = useRef<ScrollTrigger[]>([])

  const { stagger = 0.03, y = 15, duration = 0.2 } = options

  useGSAP(() => {
    if (!containerRef.current) return

    const items = containerRef.current.querySelectorAll(itemSelector)
    if (items.length === 0) return

    triggersRef.current = ScrollTrigger.batch(items, {
      onEnter: (batch) => {
        gsap.fromTo(batch, { opacity: 0, y }, {
          opacity: 1, y: 0, duration, stagger,
          ease: 'power1.out', overwrite: true,
        })
      },
      start: 'top bottom-=50',
      once: true,
      scroller: containerRef.current,
    })
  }, { scope: containerRef, dependencies: [] })

  const disableScrollTrigger = () => triggersRef.current.forEach(t => t.disable())
  const enableScrollTrigger = () => triggersRef.current.forEach(t => t.enable())

  return { containerRef, disableScrollTrigger, enableScrollTrigger }
}
