import { useEffect, useRef, useState, type RefObject } from 'react';

/**
 * Ancho real del elemento, en píxeles, siguiendo los cambios de tamaño.
 *
 * Existe por un SVG que crecía sin techo: con un `viewBox` fijo y
 * `width: 100%`, un gráfico de 345×220 puesto en una tarjeta de 1640 px se
 * dibujaba a 1640×1046 — media pantalla de torres gigantes. Midiendo el
 * contenedor, el viewBox puede seguirlo y el dibujo queda 1:1: el alto es el
 * que se pidió y el ancho, el que hay.
 *
 * `fallback` es el ancho que se usa en el primer render, antes de medir (y en
 * cualquier entorno sin ResizeObserver).
 */
export function useElementWidth<T extends HTMLElement>(
  fallback: number,
): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const apply = (next: number) => {
      // Redondeado: un viewBox que cambia por fracciones de píxel re-renderiza
      // el SVG en cada scroll suave sin que se note diferencia alguna.
      const rounded = Math.round(next);
      if (rounded > 0) setWidth((prev) => (prev === rounded ? prev : rounded));
    };

    apply(el.getBoundingClientRect().width);

    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) apply(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, width];
}
