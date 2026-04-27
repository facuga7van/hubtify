import { gsap } from 'gsap'
import { createParticleBurst, type ParticleBurst } from './particles'
import { playLevelUp } from '../audio'

export function levelUp(
  overlayEl: HTMLElement,
  contentEl: HTMLElement,
  levelNumber: number,
  onDismiss: () => void,
): gsap.core.Timeline {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const flash = overlayEl.querySelector('[data-levelup="flash"]') as HTMLElement
  const rays = overlayEl.querySelector('[data-levelup="rays"]') as HTMLElement
  const shockwave = overlayEl.querySelector('[data-levelup="shockwave"]') as HTMLElement
  const textContainer = overlayEl.querySelector('[data-levelup="text-container"]') as HTMLElement
  const titleLetters = overlayEl.querySelectorAll('[data-levelup="title"] span')
  const levelEl = overlayEl.querySelector('[data-levelup="level"]') as HTMLElement
  const dismissEl = overlayEl.querySelector('[data-levelup="dismiss"]') as HTMLElement

  let particles: ParticleBurst | null = null

  const tl = gsap.timeline({
    onComplete: () => {
      particles?.stop()
      onDismiss()
    },
    data: { particles: null as ParticleBurst | null },
  })

  // Phase 0: Show overlay, prep elements
  gsap.set(overlayEl, { display: 'flex' })
  gsap.set([flash, rays, shockwave, textContainer], { opacity: 0 })
  gsap.set(titleLetters, { scale: 0, opacity: 0 })
  gsap.set(levelEl, { scale: 0, opacity: 0 })
  gsap.set(dismissEl, { opacity: 0 })
  if (shockwave) gsap.set(shockwave, { scale: 0 })

  if (reducedMotion) {
    // Reduced motion: simple fade, instant text, 2s dismiss
    tl.to(overlayEl, { opacity: 1, duration: 0.3 })
    tl.set(titleLetters, { scale: 1, opacity: 1 }, 0.3)
    tl.set(levelEl, { scale: 1, opacity: 1 }, 0.3)
    tl.set(textContainer, { opacity: 1 }, 0.3)
    tl.call(() => playLevelUp(), [], 0.3)
    tl.to(dismissEl, { opacity: 0.5, duration: 0.2 }, 0.5)
    tl.to(overlayEl, {
      opacity: 0, duration: 0.4,
      onComplete: () => { overlayEl.style.display = 'none' },
    }, '+=1.5')
    return tl
  }

  // Phase 1: Flash (0.00s — 0.15s)
  tl.to(flash, { opacity: 0.8, duration: 0.07, ease: 'power2.in' }, 0)
  tl.to(flash, { opacity: 0, duration: 0.08, ease: 'power1.out' }, 0.07)

  // Phase 2: Shockwave (0.05s — 0.35s)
  tl.to(shockwave, { opacity: 0.7, scale: 1, duration: 0.3, ease: 'power2.out' }, 0.05)
  tl.to(shockwave, { opacity: 0, duration: 0.15 }, 0.25)

  // Phase 3: Screen shake (0.10s — 0.35s)
  tl.to(contentEl, {
    keyframes: [
      { x: -3, duration: 0.04 },
      { x: 3, duration: 0.04 },
      { x: -2, duration: 0.04 },
      { x: 2, duration: 0.04 },
      { x: -1, duration: 0.04 },
      { x: 0, duration: 0.05 },
    ],
    ease: 'none',
  }, 0.10)

  // Phase 4: God rays (0.10s — continuous)
  tl.to(rays, { opacity: 0.5, duration: 0.4, ease: 'power1.out' }, 0.10)
  tl.to(rays, { rotation: 60, duration: 4.0, ease: 'none' }, 0.10)

  // Phase 5: Canvas particles (0.15s)
  tl.call(() => {
    particles = createParticleBurst({ parent: overlayEl, count: 100 })
    tl.data.particles = particles
    particles.start()
  }, [], 0.15)

  // Phase 6: Sound (0.15s)
  tl.call(() => playLevelUp(), [], 0.15)

  // Phase 7: Text container visible
  tl.set(textContainer, { opacity: 1 }, 0.25)

  // Phase 7: "LEVEL UP" per-letter stagger (0.30s — 0.80s)
  tl.to(titleLetters, {
    scale: 1, opacity: 1,
    duration: 0.4,
    ease: 'elastic.out(1, 0.6)',
    stagger: 0.04,
  }, 0.30)

  // Phase 8: Level number (0.80s — 1.10s)
  tl.to(levelEl, {
    scale: 1, opacity: 1,
    duration: 0.3,
    ease: 'back.out(2)',
  }, 0.80)
  // Overshoot settle
  tl.fromTo(levelEl, { scale: 1.15 }, { scale: 1, duration: 0.15, ease: 'power2.out' }, 0.80)

  // Phase 9: Dismiss hint (1.10s)
  tl.to(dismissEl, { opacity: 0.5, duration: 0.2 }, 1.10)

  // Phase 10: Auto-dismiss (4.10s — 4.50s)
  tl.to(overlayEl, {
    opacity: 0, duration: 0.4,
    onComplete: () => {
      overlayEl.style.display = 'none'
      particles?.stop()
    },
  }, 4.10)

  return tl
}

export function streakAchieved(
  streakEl: HTMLElement,
  count: number,
): gsap.core.Timeline {
  const tl = gsap.timeline()
  const isHighStreak = count >= 30
  const particleCount = isHighStreak ? 6 : 2

  tl.to(streakEl, { scale: 1.5, duration: 0.4, ease: 'elastic.out(1, 0.5)' })
  tl.to(streakEl, { scale: 1, duration: 0.3, ease: 'power2.out' })

  tl.fromTo(streakEl,
    { boxShadow: '0 0 0 rgba(230,126,34,0)' },
    { boxShadow: `0 0 ${isHighStreak ? 30 : 15}px rgba(230,126,34,0.6)`, duration: 0.3 }, 0)
  tl.to(streakEl, { boxShadow: '0 0 0 rgba(230,126,34,0)', duration: 0.4 }, 0.4)

  for (let i = 0; i < particleCount; i++) {
    const spark = document.createElement('span')
    spark.style.cssText = `position:absolute;width:3px;height:3px;border-radius:50%;background:#e67e22;pointer-events:none;`
    streakEl.style.position = 'relative'
    streakEl.appendChild(spark)
    const spread = isHighStreak ? 20 : 10
    gsap.set(spark, { x: -spread / 2 + Math.random() * spread, y: 0, opacity: 0 })
    tl.to(spark, { y: -15 - Math.random() * 15, opacity: 1, duration: 0.2 }, 0.2 + i * 0.05)
    tl.to(spark, { opacity: 0, duration: isHighStreak ? 0.4 : 0.2, onComplete: () => spark.remove() }, 0.4 + i * 0.05)
  }

  return tl
}

export function loanPaidOff(
  rowEl: HTMLElement,
): gsap.core.Timeline {
  const tl = gsap.timeline()

  // Phase 1: Chain break — scale + rotate shake (200ms)
  tl.to(rowEl, { scale: 1.04, rotate: -2, duration: 0.08, ease: 'power1.out' })
  tl.to(rowEl, { scale: 1.04, rotate: 2, duration: 0.08, ease: 'power1.inOut' })
  tl.to(rowEl, { scale: 1, rotate: 0, duration: 0.1, ease: 'power2.out' })

  // Phase 2: Wax seal stamp — create DOM element and scale from 0 → 1.15 → 1
  const seal = document.createElement('div')
  seal.style.cssText = [
    'position:absolute',
    'top:50%',
    'left:50%',
    'transform:translate(-50%,-50%) scale(0)',
    'width:56px',
    'height:56px',
    'border-radius:50%',
    'background:radial-gradient(circle at 40% 35%, rgba(212,160,23,0.95) 0%, rgba(180,120,10,1) 60%, rgba(140,90,5,1) 100%)',
    'border:2px solid rgba(255,220,80,0.6)',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'pointer-events:none',
    'z-index:10',
    'box-shadow:0 2px 8px rgba(0,0,0,0.5),inset 0 1px 2px rgba(255,255,255,0.2)',
    'font-size:22px',
    'line-height:1',
  ].join(';')
  seal.textContent = '✓'
  rowEl.style.position = 'relative'
  rowEl.appendChild(seal)

  gsap.set(seal, { scale: 0, transformOrigin: 'center center' })
  tl.to(seal, { scale: 1.15, duration: 0.25, ease: 'back.out(2)' }, 0.26)
  tl.to(seal, { scale: 1, duration: 0.15, ease: 'power2.out' }, 0.51)

  // Phase 3: Golden flash on the row border
  tl.fromTo(rowEl,
    { boxShadow: '0 0 0 rgba(212,160,23,0)' },
    { boxShadow: '0 0 16px rgba(212,160,23,0.5)', duration: 0.2, ease: 'power2.out' }, 0.26)
  tl.to(rowEl, { boxShadow: '0 0 0 rgba(212,160,23,0)', duration: 0.4 }, 0.66)

  // Phase 4: Fade row to completed (dimmed) state
  tl.to(rowEl, { opacity: 0.6, duration: 0.4, ease: 'power1.inOut' }, 0.7)

  return tl
}
