import { gsap } from 'gsap'

type Direction = 'forward' | 'backward'

/** CSS 3D page turn (kept as utility, not currently used). */
export function pageTurnExit(page: HTMLElement, direction: Direction): gsap.core.Timeline {
  const isForward = direction === 'forward'
  const tl = gsap.timeline()

  // 3D page flip — perspective is on the parent container
  tl.to(page, {
    rotateY: isForward ? -105 : 105,
    duration: 0.5,
    ease: 'power2.inOut',
    transformOrigin: `${isForward ? 'left' : 'right'} center`,
  })

  // Edge shadow that grows as page lifts
  tl.fromTo(page, {
    boxShadow: '0 0 0 rgba(0,0,0,0)',
  }, {
    boxShadow: isForward
      ? '-15px 0 30px rgba(0,0,0,0.25)'
      : '15px 0 30px rgba(0,0,0,0.25)',
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
      duration: 0.25,
      ease: 'power2.out',
      stagger: 0.03,
    })
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
