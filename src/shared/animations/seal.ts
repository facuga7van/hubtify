import { gsap } from 'gsap'
import { createParticleBurst, type ParticleBurst } from './particles'
import { playSealPress, playWrite } from '../audio'

/**
 * The Codex closing ceremony.
 *
 * Deliberately NOT `levelUp()` from epic.ts: no flash, no god rays, no screen
 * shake, no 4.5s hold. Sealing the day is the quiet counterpart to a level-up —
 * wax falls, spits a few sparks, and stamps. ~1.5s, and the page stays readable
 * underneath the whole time.
 *
 * Expected markup inside `rootEl` (all optional — a missing node is skipped):
 *   [data-seal="wax"]     the molten blob that drops onto the page
 *   [data-seal="stamp"]   the matrix that presses into it
 *   [data-seal="halo"]    a soft ring that pulses once on impact
 *   [data-seal="result"]  the "+N XP" block revealed afterwards
 *
 * Under `prefers-reduced-motion` everything lands instantly and only fades in.
 *
 * Cleanup: the returned timeline carries the particle burst on
 * `tl.data.particles` (same convention epic.ts uses) so the caller can stop it
 * when unmounting mid-flight.
 */
export function sealCeremony(
  rootEl: HTMLElement,
  onComplete?: () => void,
): gsap.core.Timeline {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const wax = rootEl.querySelector('[data-seal="wax"]') as HTMLElement | null
  const stamp = rootEl.querySelector('[data-seal="stamp"]') as HTMLElement | null
  const halo = rootEl.querySelector('[data-seal="halo"]') as HTMLElement | null
  const result = rootEl.querySelector('[data-seal="result"]') as HTMLElement | null

  let particles: ParticleBurst | null = null

  const tl = gsap.timeline({
    onComplete: () => {
      particles?.stop()
      onComplete?.()
    },
    data: { particles: null as ParticleBurst | null },
  })

  const present = [wax, stamp, halo, result].filter(Boolean) as HTMLElement[]
  if (present.length === 0) {
    tl.to({}, { duration: 0.01 })
    return tl
  }

  if (reducedMotion) {
    // Instant stamp: final state, one gentle fade, one sound. No motion.
    gsap.set(present, { clearProps: 'transform' })
    gsap.set([wax, stamp].filter(Boolean) as HTMLElement[], { opacity: 0 })
    if (halo) gsap.set(halo, { opacity: 0 })
    if (result) gsap.set(result, { opacity: 0 })

    tl.to([wax, stamp].filter(Boolean) as HTMLElement[], { opacity: 1, duration: 0.25, ease: 'none' }, 0)
    tl.call(() => playSealPress(), [], 0)
    if (result) tl.to(result, { opacity: 1, duration: 0.3, ease: 'none' }, 0.2)
    return tl
  }

  /* ── prep ─────────────────────────────────────────── */
  if (wax) gsap.set(wax, { opacity: 0, y: -72, scale: 0.35, rotate: -6, transformOrigin: '50% 50%' })
  if (stamp) gsap.set(stamp, { opacity: 0, scale: 1.55, rotate: -16, transformOrigin: '50% 50%' })
  if (halo) gsap.set(halo, { opacity: 0, scale: 0.55, transformOrigin: '50% 50%' })
  if (result) gsap.set(result, { opacity: 0, y: 10 })

  /* ── phase 1: the wax falls (0.00 — 0.38) ─────────── */
  if (wax) {
    tl.to(wax, { opacity: 1, duration: 0.1, ease: 'none' }, 0)
    tl.to(wax, { y: 0, scale: 1, duration: 0.38, ease: 'power2.in' }, 0)
    // splat on impact, then settle
    tl.to(wax, { scaleX: 1.3, scaleY: 0.72, duration: 0.09, ease: 'power2.out' }, 0.38)
    tl.to(wax, { scaleX: 1, scaleY: 1, duration: 0.42, ease: 'elastic.out(1, 0.45)' }, 0.47)
  }

  /* ── phase 2: it spits (0.40) ─────────────────────── */
  tl.call(() => { playSealPress() }, [], 0.38)
  tl.call(() => {
    particles = createParticleBurst({ parent: rootEl, count: 16 })
    tl.data.particles = particles
    particles.start()
  }, [], 0.40)

  if (halo) {
    tl.to(halo, { opacity: 0.5, scale: 1.25, duration: 0.34, ease: 'power2.out' }, 0.38)
    tl.to(halo, { opacity: 0, scale: 1.5, duration: 0.3, ease: 'power1.out' }, 0.68)
  }

  /* ── phase 3: the matrix presses (0.46 — 0.80) ────── */
  if (stamp) {
    tl.to(stamp, { opacity: 1, duration: 0.12, ease: 'none' }, 0.46)
    tl.to(stamp, { scale: 1, rotate: -6, duration: 0.32, ease: 'back.out(2.4)' }, 0.46)
    // the paper takes it
    tl.call(() => { playWrite() }, [], 0.62)
  }

  /* ── phase 4: the reckoning (0.95) ────────────────── */
  if (result) {
    tl.to(result, { opacity: 1, y: 0, duration: 0.38, ease: 'power2.out' }, 0.95)
  }

  // Hold a beat so the burst finishes before onComplete fires.
  tl.to({}, { duration: 0.25 })

  return tl
}
