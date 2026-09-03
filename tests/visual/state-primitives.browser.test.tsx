import { beforeAll, describe, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import Skeleton from '@shared/components/Skeleton';
import EmptyState from '@shared/components/EmptyState';
import ErrorState from '@shared/components/ErrorState';
import { Sword } from '@shared/components/icons';

import '../../src/i18n';
import '../../src/hub/styles/theme.css';
import '../../src/hub/styles/components.css';

/**
 * Las tres primitivas compartidas de C8. Antes de esto había CUATRO dialectos de
 * esqueleto duplicados (quests, coinify, nutri, codex), dos más hardcodeados en
 * línea con colores literales y sin animación, doce clases `*-empty` distintas y
 * cuatro copias a mano del bloque «mensaje + reintentar».
 *
 * El shimmer sale de `.quest-skeleton` (`quests.css`), que es el mejor de los
 * cuatro: degradé a 90° con `background-size: 200% 100%`, que es lo que hace que
 * la luz VIAJE en vez de latir.
 */

beforeAll(() => {
  document.body.style.margin = '0';
  document.body.style.background = 'var(--parch-0)';
});

const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));

function q<T extends Element = HTMLElement>(sel: string): T {
  const node = document.querySelector<T>(sel);
  if (!node) throw new Error(`no encontré ${sel}`);
  return node;
}

describe('Skeleton', () => {
  test('pinta N barras con shimmer que viaja y un retardo escalonado', async () => {
    render(<Skeleton count={3} />);
    await settle();

    const bars = document.querySelectorAll<HTMLElement>('.hub-skeleton');
    expect(bars.length).toBe(3);

    const cs = getComputedStyle(bars[0]);
    // La luz viaja: 200 % de ancho de fondo y un degradé lineal, no un latido
    // de opacidad. Es exactamente lo que hace `.quest-skeleton`.
    expect(cs.backgroundImage).toMatch(/linear-gradient/);
    expect(cs.backgroundSize).toMatch(/200%/);
    expect(cs.animationName).not.toBe('none');
    expect(cs.animationIterationCount).toBe('infinite');

    // Escalonado: la tercera barra arranca después que la primera.
    const d0 = parseFloat(getComputedStyle(bars[0]).animationDelay);
    const d2 = parseFloat(getComputedStyle(bars[2]).animationDelay);
    expect(d2).toBeGreaterThan(d0);
  });

  test('se anuncia como ocupado y no como contenido', async () => {
    render(<Skeleton count={2} label="Cargando misiones" />);
    await settle();
    const group = q('.hub-skeleton-group');
    expect(group.getAttribute('aria-busy')).toBe('true');
    expect(group.getAttribute('role')).toBe('status');
    expect(group.textContent).toContain('Cargando misiones');
    // El texto es para el lector de pantalla, no para el ojo.
    const sr = q('.hub-sr-only');
    expect(sr.getBoundingClientRect().width).toBeLessThanOrEqual(1);
  });

  test('tres variantes con formas distintas', async () => {
    render(
      <>
        <div id="a"><Skeleton variant="line" /></div>
        <div id="b"><Skeleton variant="block" /></div>
        <div id="c"><Skeleton variant="card" /></div>
      </>,
    );
    await settle();
    const h = (id: string) => q(`#${id} .hub-skeleton`).getBoundingClientRect().height;
    expect(h('a')).toBeLessThan(h('b'));
    expect(h('b')).toBeLessThan(h('c'));
  });

  test('respeta prefers-reduced-motion con una regla propia', async () => {
    render(<Skeleton />);
    await settle();
    // La regla global de `theme.css` clava `animation-iteration-count: 1`, pero
    // un esqueleto que se congela a mitad del barrido queda como una mancha:
    // la hoja de las primitivas tiene que apagarlo del todo.
    const rules: string[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let list: CSSRuleList;
      try { list = sheet.cssRules; } catch { continue; }
      for (const rule of Array.from(list)) rules.push(rule.cssText);
    }
    const reduced = rules.filter((r) => /prefers-reduced-motion/.test(r) && /hub-skeleton/.test(r));
    expect(reduced.length, 'ninguna regla de reduced-motion menciona .hub-skeleton').toBeGreaterThan(0);
    // El CSSOM serializa el atajo entero; lo que importa es que el NOMBRE de la
    // animación quede en `none` y con `!important`, para ganarle a la regla
    // global que sólo baja la cuenta de iteraciones a 1.
    expect(reduced.join(' ')).toMatch(/animation:[^;]*\bnone\b[^;]*!important/);
  });
});

describe('EmptyState', () => {
  test('ícono, frase y salida — los tres DENTRO del hueco', async () => {
    const onClick = vi.fn();
    render(
      <EmptyState
        icon={<Sword width={32} height={32} />}
        title="El estante espera"
        message="Todavía no hay nada acá."
        action={{ label: 'Anotá la primera', onClick }}
      />,
    );
    await settle();

    const hole = q('.hub-empty');
    expect(hole.querySelector('svg'), 'sin ícono').toBeTruthy();
    expect(hole.textContent).toContain('El estante espera');
    expect(hole.textContent).toContain('Todavía no hay nada acá.');

    const cta = hole.querySelector<HTMLButtonElement>('.hub-empty__cta');
    expect(cta, 'el botón vive FUERA del hueco').toBeTruthy();
    cta!.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test('sin acción sigue siendo un hueco con ícono y frase', async () => {
    render(<EmptyState message="Nada por acá." />);
    await settle();
    const hole = q('.hub-empty');
    expect(hole.querySelector('svg'), 'el ícono por defecto no está').toBeTruthy();
    expect(hole.querySelector('.hub-empty__cta')).toBeNull();
  });

  test('la frase tiene medida de lectura', async () => {
    render(<EmptyState message={'x'.repeat(600)} />);
    await settle();
    expect(getComputedStyle(q('.hub-empty__text')).maxWidth).not.toBe('none');
  });
});

describe('ErrorState', () => {
  test('dice que FALLÓ y ofrece reintentar', async () => {
    const onRetry = vi.fn();
    render(<ErrorState message="No se pudo abrir el estante." onRetry={onRetry} />);
    await settle();

    const box = q('.hub-error');
    expect(box.getAttribute('role')).toBe('alert');
    expect(box.querySelector('svg'), 'sin ícono de aviso').toBeTruthy();
    expect(box.textContent).toContain('No se pudo abrir el estante.');

    const retry = box.querySelector<HTMLButtonElement>('.hub-error__retry');
    expect(retry, 'no hay botón de reintentar').toBeTruthy();
    retry!.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test('sin `message` cae en la frase del sistema, nunca en el vacío', async () => {
    render(<ErrorState />);
    await settle();
    const text = q('.hub-error').textContent ?? '';
    expect(text.trim().length).toBeGreaterThan(0);
    expect(text).not.toMatch(/common\.[a-zA-Z]/);
  });

  test('sin `onRetry` no dibuja un botón muerto', async () => {
    render(<ErrorState message="Falló." />);
    await settle();
    expect(document.querySelector('.hub-error__retry')).toBeNull();
  });
});
