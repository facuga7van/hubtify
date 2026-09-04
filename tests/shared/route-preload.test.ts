/**
 * `preloadRoute` tiene que esperar TODOS los chunks que el segmento necesita.
 *
 * `/finance` renderiza dos: la cáscara (`FinanceLayout`) y su hijo índice
 * (`FinanceDashboard`), y son chunks separados. Esperando solo la cáscara, el
 * hijo suspendía DESPUÉS de que el pase de página ya había arrancado — y la
 * única frontera de Suspense es la de `AnimatedOutlet`, así que ese hijo
 * reemplazaba el subárbol ENTERO del outlet por el spinner; `waitForSwap` veía
 * cambiar la identidad del nodo, resolvía, y el flip clonaba un spinner pelado
 * como página de destino. Exactamente el bug que la espera vino a matar.
 *
 * Alcanzable haciendo click en «Coinify» en el primer segundo tras arrancar,
 * antes de que el prefetch en idle llegue a `FinanceDashboard` (4º en
 * `PRELOAD_ORDER`). En Android la ventana es más ancha.
 */
import { describe, it, expect, vi } from 'vitest';

const gate = vi.hoisted(() => {
  const requested: string[] = [];
  let openDashboard!: () => void;
  const dashboard = new Promise<void>((resolve) => { openDashboard = resolve; });
  return { requested, dashboard, openDashboard: () => openDashboard() };
});

// Los chunks reales arrastran React, CSS y el módulo entero de finanzas: acá lo
// único que importa es CUÁNDO resuelve cada import, así que se sustituyen por
// módulos vacíos y el del panel se deja abierto a voluntad.
vi.mock('../../src/modules/finance/components/FinanceLayout', async () => {
  gate.requested.push('layout');
  return { default: () => null };
});
vi.mock('../../src/modules/finance/components/Dashboard', async () => {
  gate.requested.push('dashboard');
  await gate.dashboard;
  return { default: () => null };
});
vi.mock('../../src/modules/quests/components/TaskList', () => ({ default: () => null }));
vi.mock('../../src/modules/nutrition/components/Today', () => ({ default: () => null }));

const { preloadRoute } = await import('../../src/routes');

/** Deja correr la cola de microtareas (y una vuelta de macrotareas). */
const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });

describe('preloadRoute', () => {
  it('/finance espera la cáscara Y el panel índice, no solo la cáscara', async () => {
    const pending = preloadRoute('/finance');
    let done = false;
    void pending.then(() => { done = true; });

    await settle();
    // Los dos chunks se pidieron…
    expect([...gate.requested].sort()).toEqual(['dashboard', 'layout']);
    // …y la espera NO terminó con el panel todavía en el aire. Si terminara,
    // el flip arrancaría y el panel suspendería encima, clonando el spinner.
    expect(done).toBe(false);

    gate.openDashboard();
    await pending;
    expect(done).toBe(true);
  });

  it('un segmento de un solo chunk resuelve con ese chunk', async () => {
    await expect(preloadRoute('/quests')).resolves.toBeDefined();
    // `/nutrition` no necesita lista: su ruta padre renderiza un <Outlet/> pelado
    // (no es un chunk), así que el hijo índice ES el segmento entero.
    await expect(preloadRoute('/nutrition')).resolves.toBeDefined();
  });

  it('una ruta desconocida resuelve en el acto en vez de colgar la navegación', async () => {
    await expect(preloadRoute('/no-existe')).resolves.toBeUndefined();
    await expect(preloadRoute('/')).resolves.toBeUndefined();
  });

  it('la sub-ruta de un segmento espera lo mismo que el segmento', async () => {
    // El mapa se indexa por el PRIMER tramo: entrar por /finance/transactions
    // tiene que esperar lo mismo que entrar por /finance.
    await expect(preloadRoute('/finance/transactions')).resolves.toBeDefined();
  });
});
