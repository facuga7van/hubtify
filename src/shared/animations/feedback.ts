import { gsap } from 'gsap'

export function completeTask(
  taskElement: HTMLElement,
  textElement: HTMLElement,
): gsap.core.Timeline {
  const tl = gsap.timeline()

  // Strikethrough: animate an overlay line from left to right
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

export function barGleam(barElement: HTMLElement, duration: number = 0.4): gsap.core.Timeline {
  const tl = gsap.timeline()

  // Create gleam overlay
  const gleam = document.createElement('div')
  gleam.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:linear-gradient(90deg,transparent 0%,rgba(212,160,23,0.4) 40%,rgba(212,160,23,0.6) 50%,rgba(212,160,23,0.4) 60%,transparent 100%);pointer-events:none;border-radius:inherit;'
  barElement.style.position = 'relative'
  barElement.style.overflow = 'hidden'
  barElement.appendChild(gleam)

  gsap.set(gleam, { x: '-100%' })
  tl.to(gleam, {
    x: '100%',
    duration,
    ease: 'power1.inOut',
    onComplete: () => gleam.remove(),
  })

  return tl
}
