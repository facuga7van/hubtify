/**
 * Arnés del project `browser-mobile` (spec §7): viewport 390×844 con el define
 * de Android. Reusa el stub de window.api y las mediciones del arnés del hub y
 * monta cada página DENTRO del MobileShell real, para medirla con la cabecera
 * de 56 px, sin sidebar y con el drawer disponible.
 *
 * `page.screenshot({ path })` resuelve relativo al archivo de test, por eso
 * SHOTS sube un nivel: las capturas caen en tests/visual/__screenshots__/mobile/
 * (gitignored, como screens/).
 */
import type { ReactNode } from 'react';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import MobileShell from '@hub/MobileShell';
import ToastProvider from '@shared/components/ToastProvider';
import { ConfirmProvider } from '@shared/components/ConfirmDialog';
import { AuthContext } from '@shared/AuthContext';
import { AnimatedNavigateContext } from '@shared/components/AnimatedOutlet';
import { installApi, stats, fitCapture, resetCapture, overflowingNodes } from '../audit-hub-harness';

export { installApi, stats, overflowingNodes };

export const MOBILE: [number, number] = [390, 844];
export const SHOTS = '../__screenshots__/mobile';

const authUser = {
  uid: 'u1', email: 'facundot.galvan@gmail.com', displayName: 'Facundo',
} as unknown as NonNullable<React.ContextType<typeof AuthContext>['user']>;

export const baseAuth = {
  user: authUser,
  loading: false,
  switching: false,
  login: async () => ({ success: false }),
  register: async () => ({ success: false }),
  logout: async () => ({ success: true }),
  switchAccount: async () => ({ success: true }),
  addAccount: async () => ({ success: false }),
  forgotPassword: async () => ({ success: false }),
  getCachedAccounts: () => ([
    { uid: 'u2', email: 'segunda@hubtify.app', firebaseAppName: 'a2', lastUsed: '', username: 'Segundo' },
  ]),
} as unknown as React.ContextType<typeof AuthContext>;

/** El Sidebar navega por AnimatedNavigateContext; acá lo puenteamos al router de memoria. */
function NavBridge({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <AnimatedNavigateContext.Provider value={(to) => navigate(to)}>
      {children}
    </AnimatedNavigateContext.Provider>
  );
}

/** Monta `node` como página del MobileShell en la ruta `route`. */
export function mountInShell(node: ReactNode, route = '/') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AuthContext.Provider value={baseAuth}>
        <ToastProvider><ConfirmProvider>
          <NavBridge>
            <div className="shell-frame">
              <MobileShell stats={stats} onBellClick={() => {}} onToggleInn={() => {}}>
                {node}
              </MobileShell>
            </div>
          </NavBridge>
        </ConfirmProvider></ToastProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

export const settle = (ms = 500) => new Promise((r) => setTimeout(r, ms));

export async function setMobileViewport() {
  await page.viewport(...MOBILE);
  document.body.style.margin = '0';
  document.body.style.background = 'var(--parch-0)';
}

/** Desborde horizontal del documento: el criterio de aceptación de la fase (spec §11). */
export function docOverflowX(): number {
  return document.documentElement.scrollWidth - window.innerWidth;
}

export function mainOverflowX(): number {
  const main = document.querySelector('.main-content') as HTMLElement;
  return main.scrollWidth - main.clientWidth;
}

/** Captura arriba y, si la página scrollea, abajo. */
export async function shoot(name: string) {
  const main = document.querySelector('.main-content') as HTMLElement | null;
  fitCapture();
  await page.screenshot({ path: `${SHOTS}/${name}-a.png` });
  if (main && main.scrollHeight - main.clientHeight > 40) {
    main.scrollTop = main.scrollHeight;
    await settle(250);
    await page.screenshot({ path: `${SHOTS}/${name}-b.png` });
    main.scrollTop = 0;
  }
  resetCapture();
}
