import { gsap } from 'gsap'
import { createParticleBurst } from './particles'

/**
 * Los ~300 ms que siguen a completar algo.
 *
 * «El juice vale más que cualquier ajuste de curva»: la micro-celebración hace
 * que tildar una tarea se sienta bien TODOS los días, no solo al subir de
 * nivel. Un burst de partículas doradas desde el ancla (el checkbox) y un pop
 * sutil de escala en la fila. Nada más — a esta escala, más sería menos.
 *
 * Fire-and-forget a propósito: nunca devuelve nada, nunca tira, nunca bloquea
 * el flujo (el toast, la regeneración de recurrentes y el resto siguen igual).
 * Cualquier módulo puede adoptarla: `celebrateCompletion(checkboxEl)`.
 *
 * `prefers-reduced-motion`: ni partículas ni escala — a lo sumo un lavado de
 * color suave sobre `popEl`, que es información («esto se completó»), no
 * movimiento.
 */

/** Lado del cuadrado invisible donde viven las partículas, centrado en el ancla. */
const BURST_BOX_PX = 150
const BURST_PARTICLE_COUNT = 14
/** Las partículas decaen solas en ~1.2 s; esto solo garantiza la limpieza. */
const BURST_CLEANUP_MS = 1800

export interface CelebrateOptions {
  /**
   * El elemento que recibe el pop de escala (típicamente la fila). Sin él,
   * solo hay partículas.
   */
  popEl?: HTMLElement | null
}

export function celebrateCompletion(
  anchorEl: HTMLElement | null | undefined,
  options: CelebrateOptions = {},
): void {
  if (!anchorEl || !anchorEl.isConnected) return

  try {
    const popEl = options.popEl ?? null
    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (reduced) {
      // Sin partículas ni escala: un cambio de color suave y nada más.
      if (popEl) {
        gsap.fromTo(
          popEl,
          { backgroundColor: 'rgba(212, 160, 23, 0.18)' },
          {
            backgroundColor: 'rgba(212, 160, 23, 0)',
            duration: 0.4,
            ease: 'none',
            clearProps: 'backgroundColor',
          },
        )
      }
      return
    }

    // El burst existente dibuja desde el CENTRO de su parent y recorta en sus
    // bordes, así que el checkbox no sirve de parent directo (las chispas
    // morirían a 8 px). Un contenedor fijo, efímero y sin eventos, centrado en
    // el ancla, le da aire para volar.
    const rect = anchorEl.getBoundingClientRect()
    const holder = document.createElement('div')
    const half = BURST_BOX_PX / 2
    holder.style.cssText =
      `position:fixed;pointer-events:none;z-index:9999;` +
      `left:${rect.left + rect.width / 2 - half}px;` +
      `top:${rect.top + rect.height / 2 - half}px;` +
      `width:${BURST_BOX_PX}px;height:${BURST_BOX_PX}px;`
    document.body.appendChild(holder)

    const burst = createParticleBurst({ parent: holder, count: BURST_PARTICLE_COUNT })
    burst.start()
    window.setTimeout(() => {
      burst.stop()
      holder.remove()
    }, BURST_CLEANUP_MS)

    // El pop: apenas por encima de 1 y de vuelta, ~240 ms. Transform-only para
    // no forzar layout; `clearProps` devuelve el inline style intacto.
    if (popEl) {
      gsap.fromTo(
        popEl,
        { scale: 1, transformOrigin: '50% 50%' },
        {
          scale: 1.02,
          duration: 0.12,
          ease: 'power2.out',
          yoyo: true,
          repeat: 1,
          clearProps: 'scale,transformOrigin',
        },
      )
    }
  } catch {
    // La celebración jamás rompe el flujo que celebra.
  }
}
