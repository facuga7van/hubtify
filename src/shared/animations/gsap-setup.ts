import { gsap } from 'gsap'
import { useGSAP } from '@gsap/react'

gsap.registerPlugin(useGSAP)

gsap.defaults({
  duration: 0.3,
  ease: 'power2.out',
})

// Reduced motion: override defaults when user prefers reduced motion
gsap.matchMedia().add('(prefers-reduced-motion: reduce)', () => {
  gsap.defaults({
    duration: 0.1,
    ease: 'none',
  })
})
