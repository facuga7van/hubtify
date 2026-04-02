import { describe, it, expect } from 'vitest'

describe('GSAP setup', () => {
  it('loads gsap without throwing', async () => {
    await expect(import('gsap')).resolves.toBeDefined()
  })

  it('gsap object is available and has expected API', async () => {
    const { gsap } = await import('gsap')
    expect(typeof gsap).toBe('object')
    expect(typeof gsap.to).toBe('function')
    expect(typeof gsap.from).toBe('function')
    expect(typeof gsap.fromTo).toBe('function')
    expect(typeof gsap.timeline).toBe('function')
    expect(typeof gsap.set).toBe('function')
    expect(typeof gsap.defaults).toBe('function')
  })

  it('gsap.defaults() returns the current defaults object', async () => {
    const { gsap } = await import('gsap')
    const defaults = gsap.defaults()
    expect(typeof defaults).toBe('object')
    expect(defaults).not.toBeNull()
  })

  it('ScrollTrigger is importable and is a constructor', async () => {
    const { ScrollTrigger } = await import('gsap/ScrollTrigger')
    expect(typeof ScrollTrigger).toBe('function')
  })

  it('gsap can register ScrollTrigger plugin without throwing', async () => {
    const { gsap } = await import('gsap')
    const { ScrollTrigger } = await import('gsap/ScrollTrigger')
    expect(() => gsap.registerPlugin(ScrollTrigger)).not.toThrow()
  })
})
