export interface ParticleBurst {
  start(): void
  stop(): void
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  alpha: number
  color: string
  decay: number
}

interface ParticleBurstOptions {
  parent: HTMLElement
  count: number
}

const COLORS = ['#f5c542', '#e6a817', '#d4a017', '#ffd700', '#e67e22', '#fff4c2']

export function createParticleBurst({ parent, count }: ParticleBurstOptions): ParticleBurst {
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5;'
  parent.appendChild(canvas)

  const ctx = canvas.getContext('2d')!
  let raf = 0
  let running = false
  const particles: Particle[] = []

  function resize() {
    const rect = parent.getBoundingClientRect()
    canvas.width = rect.width * devicePixelRatio
    canvas.height = rect.height * devicePixelRatio
    ctx.scale(devicePixelRatio, devicePixelRatio)
  }

  function spawn() {
    const rect = parent.getBoundingClientRect()
    const cx = rect.width / 2
    const cy = rect.height / 2

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2
      const speed = 1 + Math.random() * 3
      particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1,
        size: 1.5 + Math.random() * 2.5,
        alpha: 0.8 + Math.random() * 0.2,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        decay: 0.008 + Math.random() * 0.012,
      })
    }
  }

  function tick() {
    if (!running) return
    const w = canvas.width / devicePixelRatio
    const h = canvas.height / devicePixelRatio
    ctx.clearRect(0, 0, w, h)

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]
      p.x += p.vx
      p.y += p.vy
      p.vy += 0.03 // gravity
      p.alpha -= p.decay

      if (p.alpha <= 0) {
        particles.splice(i, 1)
        continue
      }

      ctx.globalAlpha = p.alpha
      ctx.fillStyle = p.color
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.globalAlpha = 1

    if (particles.length > 0) {
      raf = requestAnimationFrame(tick)
    } else {
      cleanup()
    }
  }

  function cleanup() {
    running = false
    cancelAnimationFrame(raf)
    canvas.remove()
  }

  return {
    start() {
      resize()
      spawn()
      running = true
      raf = requestAnimationFrame(tick)
    },
    stop() {
      cleanup()
    },
  }
}
