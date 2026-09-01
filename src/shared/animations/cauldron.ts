import { gsap } from 'gsap'

/**
 * `celebrate.ts` and `seal.ts` already honour this; the cauldron effects were
 * the ones still orbiting motes and bursting particles for users who asked
 * for no motion. Checked per call, not once at import — the OS setting can
 * change while the app is open.
 */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * Spawns 8 golden mote elements that orbit slowly around the container.
 * Returns a master timeline — call .kill() to stop and clean up motes.
 * Under reduced motion it returns an empty timeline: no motes at all.
 */
export function ambientOrbs(containerEl: HTMLElement): gsap.core.Timeline {
  const motes: HTMLSpanElement[] = []
  const tl = gsap.timeline({
    onComplete: () => motes.forEach((m) => m.remove()),
  })

  // Override kill to also clean up DOM
  const originalKill = tl.kill.bind(tl)
  tl.kill = () => {
    motes.forEach((m) => m.remove())
    return originalKill()
  }

  if (prefersReducedMotion()) return tl

  for (let i = 0; i < 8; i++) {
    const mote = document.createElement('span')
    const startX = Math.random() * 100
    const startY = Math.random() * 100
    mote.style.cssText = `position:absolute;width:6px;height:6px;border-radius:50%;background:radial-gradient(circle,rgba(212,160,23,0.8),rgba(212,160,23,0.2));opacity:0.4;pointer-events:none;left:${startX}%;top:${startY}%;`
    containerEl.appendChild(mote)
    motes.push(mote)

    const duration = 4 + Math.random() * 4
    const moveX = -80 + Math.random() * 160
    const moveY = -80 + Math.random() * 160

    tl.to(mote, {
      x: moveX,
      y: moveY,
      opacity: 0.2 + Math.random() * 0.4,
      duration,
      repeat: -1,
      yoyo: true,
      ease: 'sine.inOut',
    }, 0)
  }

  return tl
}

/**
 * Celebratory burst animation when a brew completes.
 * Flash + 16 golden particles exploding radially outward.
 * Under reduced motion only the brightness flash stays: it is information
 * ("the brew is done"), not movement.
 */
export function brewComplete(containerEl: HTMLElement): gsap.core.Timeline {
  const tl = gsap.timeline()
  const particles: HTMLSpanElement[] = []

  // Phase 1: Brightness flash on container
  tl.to(containerEl, {
    filter: 'brightness(1.8)',
    duration: 0.2,
    ease: 'power2.out',
  })
  tl.to(containerEl, {
    filter: 'brightness(1)',
    duration: 0.2,
    ease: 'power2.in',
  })

  if (prefersReducedMotion()) return tl

  // Phase 2: Particle burst — 16 golden circles from center
  const rect = containerEl.getBoundingClientRect()
  const centerX = rect.width / 2
  const centerY = rect.height / 2

  for (let i = 0; i < 16; i++) {
    const size = 4 + Math.random() * 4
    const particle = document.createElement('span')
    particle.style.cssText = `position:absolute;width:${size}px;height:${size}px;border-radius:50%;background:rgba(212,160,23,0.9);pointer-events:none;left:${centerX}px;top:${centerY}px;`
    containerEl.appendChild(particle)
    particles.push(particle)

    const angle = (Math.PI * 2 * i) / 16 + (Math.random() * 0.3 - 0.15)
    const distance = 80 + Math.random() * 80
    const endX = Math.cos(angle) * distance
    const endY = Math.sin(angle) * distance

    gsap.set(particle, { scale: 0, opacity: 1 })

    tl.to(particle, {
      scale: 1,
      x: endX,
      y: endY,
      opacity: 0,
      duration: 0.8,
      ease: 'power2.out',
      onComplete: () => particle.remove(),
    }, 0.2 + i * 0.02)
  }

  return tl
}

/**
 * Gleam shimmer across a stats element — gold gradient slides left to right.
 * Similar to barGleam from feedback.ts. Skipped entirely under reduced motion.
 */
export function statsShimmer(element: HTMLElement): gsap.core.Timeline {
  const tl = gsap.timeline()

  if (prefersReducedMotion()) return tl

  const overlay = document.createElement('div')
  overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:linear-gradient(90deg,transparent 0%,rgba(212,160,23,0.3) 50%,transparent 100%);pointer-events:none;border-radius:inherit;'
  const prevPosition = element.style.position
  const prevOverflow = element.style.overflow
  element.style.position = 'relative'
  element.style.overflow = 'hidden'
  element.appendChild(overlay)

  gsap.set(overlay, { x: '-100%' })
  tl.to(overlay, {
    x: '100%',
    duration: 0.6,
    ease: 'power1.inOut',
    onComplete: () => {
      overlay.remove()
      element.style.position = prevPosition
      element.style.overflow = prevOverflow
    },
  })

  return tl
}
