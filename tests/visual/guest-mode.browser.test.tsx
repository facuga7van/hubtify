import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import AuthPage from '@hub/AuthPage';
import PlayerCard from '@hub/PlayerCard';
import ToastProvider from '@shared/components/ToastProvider';
import { ConfirmProvider } from '@shared/components/ConfirmDialog';
import { AuthContext } from '@shared/AuthContext';
import { GUEST_STORAGE_KEY, enterGuestMode, leaveGuestMode, isGuestMode } from '@shared/guest';
import { installApi, SCREENS, stats } from './audit-hub-harness';

import '../../src/i18n';
import '../../src/hub/styles/theme.css';
import '../../src/hub/styles/components.css';
import '../../src/hub/styles/layout.css';
import '../../src/hub/styles/shell.css';

/**
 * Modo invitado, de punta a punta en el DOM real: la puerta sin muro en el
 * login y la vía de vuelta en el PlayerCard.
 */

const noUser = {
  user: null,
  loading: false,
  switching: false,
  login: async () => ({ success: false }),
  register: async () => ({ success: false }),
  logout: async () => ({ success: true }),
  switchAccount: async () => ({ success: true }),
  addAccount: async () => ({ success: false }),
  forgotPassword: async () => ({ success: false }),
  getCachedAccounts: () => [],
} as unknown as React.ContextType<typeof AuthContext>;

const withUser = {
  ...noUser,
  user: { uid: 'u1', email: 'aventurero@hubtify.app', displayName: 'Facundo' },
} as unknown as React.ContextType<typeof AuthContext>;

beforeAll(() => {
  document.body.style.margin = '0';
  installApi({ characterGetName: () => Promise.resolve('') });
});

beforeEach(() => {
  leaveGuestMode();
  localStorage.removeItem(GUEST_STORAGE_KEY);
});

function renderAuth(props: Record<string, unknown> = {}) {
  return render(
    <AuthContext.Provider value={noUser}>
      <AuthPage onAuth={() => {}} {...props} />
    </AuthContext.Provider>,
  );
}

describe('AuthPage — entrar sin cuenta', () => {
  test('el botón está en el login y dice qué se pierde', async () => {
    renderAuth({ onGuest: () => {} });
    await expect.element(page.getByRole('button', { name: 'Entrar sin cuenta' })).toBeVisible();
    await expect.element(page.getByText(/solo en este dispositivo/i)).toBeVisible();
    await expect.element(page.getByText(/sin respaldo en la nube/i)).toBeVisible();
    await expect.element(page.getByText(/vincular una cuenta cuando quieras/i)).toBeVisible();
    await page.screenshot({ path: `${SCREENS}/09-guest-login.png` });
  });

  test('un clic y el flag queda prendido', async () => {
    renderAuth({ onGuest: () => enterGuestMode() });
    await page.getByRole('button', { name: 'Entrar sin cuenta' }).click();
    expect(isGuestMode()).toBe(true);
  });

  test('también está en el alta de cuenta', async () => {
    renderAuth({ onGuest: () => {} });
    await page.getByRole('button', { name: '¿No tenés cuenta? Registrate' }).click();
    await expect.element(page.getByRole('button', { name: 'Entrar sin cuenta' })).toBeVisible();
  });

  test('NO aparece en «recuperar contraseña»', async () => {
    renderAuth({ onGuest: () => {} });
    await page.getByRole('button', { name: '¿Olvidaste tu contraseña?' }).click();
    await expect.element(page.getByRole('button', { name: 'Enviar enlace' })).toBeVisible();
    expect(document.body.textContent).not.toContain('Entrar sin cuenta');
  });

  test('NO aparece en «agregar cuenta»', async () => {
    renderAuth({ onGuest: () => {}, mode: 'addAccount', onBack: () => {} });
    await expect.element(page.getByRole('button', { name: 'Agregar cuenta' })).toBeVisible();
    expect(document.body.textContent).not.toContain('Entrar sin cuenta');
  });

  test('NO aparece cuando el invitado vuelve a vincular', async () => {
    enterGuestMode();
    renderAuth({ onGuest: () => {} });
    await expect.element(page.getByRole('button', { name: 'Entrar al Reino' })).toBeVisible();
    expect(document.body.textContent).not.toContain('Entrar sin cuenta');
  });

  test('sin `onGuest` la pantalla es la de siempre', async () => {
    renderAuth();
    await expect.element(page.getByRole('button', { name: 'Entrar al Reino' })).toBeVisible();
    expect(document.body.textContent).not.toContain('Entrar sin cuenta');
  });
});

function mountCard(auth: React.ContextType<typeof AuthContext>) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <AuthContext.Provider value={auth}>
        <ToastProvider><ConfirmProvider>
          <div className="sidebar" style={{ width: 300 }}>
            <Routes>
              <Route path="/" element={<PlayerCard stats={stats} onBellClick={() => {}} />} />
              <Route path="/login" element={<div data-testid="login-route">login</div>} />
            </Routes>
          </div>
        </ConfirmProvider></ToastProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

describe('PlayerCard — la vía de vuelta', () => {
  test('sin cuenta avisa que no hay respaldo y no inventa un email', async () => {
    enterGuestMode();
    mountCard(noUser);
    await expect.element(page.getByRole('button', { name: 'Solo en este dispositivo' })).toBeVisible();
    expect(document.body.textContent).not.toContain('@');
  });

  test('el botón de cuenta ofrece vincular y navega a /login', async () => {
    enterGuestMode();
    mountCard(noUser);
    const btn = page.getByRole('button', { name: 'Vincular cuenta' });
    await expect.element(btn).toBeVisible();
    // No promete un menú que no existe.
    expect(document.querySelector('.player-card__account-btn')?.getAttribute('aria-haspopup')).toBeNull();
    await btn.click();
    await expect.element(page.getByTestId('login-route')).toBeVisible();
  });

  test('el aviso también lleva a vincular', async () => {
    enterGuestMode();
    mountCard(noUser);
    await page.getByRole('button', { name: 'Solo en este dispositivo' }).click();
    await expect.element(page.getByTestId('login-route')).toBeVisible();
  });

  test('con cuenta nada cambia: sigue el menú y el email', async () => {
    mountCard(withUser);
    await expect.element(page.getByRole('button', { name: 'Menú de cuenta' })).toBeVisible();
    await expect.element(page.getByTitle('aventurero@hubtify.app').first()).toBeVisible();
    expect(document.body.textContent).not.toContain('Solo en este dispositivo');
  });

  test('sin cuenta y sin modo invitado no aparece nada nuevo', async () => {
    mountCard(noUser);
    expect(document.body.textContent).not.toContain('Solo en este dispositivo');
    expect(document.body.textContent).not.toContain('Vincular cuenta');
  });
});
