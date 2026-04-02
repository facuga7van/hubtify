import { gsap } from 'gsap'

export function levelUp(
  overlayEl: HTMLElement,
  bookEl: HTMLElement,
  levelTextEl: HTMLElement,
  onDismiss: () => void,
): gsap.core.Timeline {
  const tl = gsap.timeline({ onComplete: onDismiss })

  // Phase 1: Darken overlay (200ms)
  gsap.set(overlayEl, { opacity: 0, display: 'flex' })
  tl.to(overlayEl, { opacity: 1, duration: 0.2 })

  // Phase 2: Book opens (500ms)
  const leftCover = bookEl.querySelector('[data-book="left"]') as HTMLElement
  const rightCover = bookEl.querySelector('[data-book="right"]') as HTMLElement
  gsap.set([leftCover, rightCover], { rotateY: 0 })
  tl.to(leftCover, {
    rotateY: -105, duration: 0.5, ease: 'power3.out',
    transformOrigin: 'left center', transformPerspective: 1200,
  }, 0.2)
  tl.to(rightCover, {
    rotateY: 105, duration: 0.5, ease: 'power3.out',
    transformOrigin: 'right center', transformPerspective: 1200,
  }, 0.2)

  // Phase 3: Level text draws in (400ms)
  const textPath = levelTextEl.querySelector('path')
  if (textPath) {
    const length = textPath.getTotalLength()
    gsap.set(textPath, { strokeDasharray: length, strokeDashoffset: length })
    tl.to(textPath, { strokeDashoffset: 0, duration: 0.4, ease: 'power1.inOut' }, 0.6)
  }
  tl.to(levelTextEl, { opacity: 1, duration: 0.3 }, 0.6)

  // Phase 4: Golden glow (300ms)
  tl.fromTo(bookEl,
    { boxShadow: '0 0 0 rgba(212,160,23,0)' },
    { boxShadow: '0 0 80px rgba(212,160,23,0.6)', duration: 0.3, ease: 'power2.out' }, 1.0)
  tl.to(bookEl, { boxShadow: '0 0 20px rgba(212,160,23,0.2)', duration: 0.3 }, 1.3)

  // Phase 5: Golden mote particles (1000ms) — 18 DOM spans
  for (let i = 0; i < 18; i++) {
    const mote = document.createElement('span')
    mote.style.cssText = `position:absolute;width:${2 + Math.random() * 4}px;height:${2 + Math.random() * 4}px;border-radius:50%;background:rgba(212,160,23,${0.5 + Math.random() * 0.5});pointer-events:none;`
    bookEl.appendChild(mote)
    const startX = -40 + Math.random() * 80
    const startY = 20 + Math.random() * 40
    gsap.set(mote, { x: startX, y: startY, opacity: 0 })
    tl.to(mote, { y: startY - 60 - Math.random() * 40, x: startX + (-20 + Math.random() * 40), opacity: 1, duration: 0.3, ease: 'power1.out' }, 1.0 + Math.random() * 0.3)
    tl.to(mote, { opacity: 0, duration: 0.4, onComplete: () => mote.remove() }, 1.4 + Math.random() * 0.3)
  }

  // Phase 6: Dismiss (400ms)
  tl.to(overlayEl, { opacity: 0, duration: 0.4, onComplete: () => { overlayEl.style.display = 'none' } }, '+=0.3')

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
