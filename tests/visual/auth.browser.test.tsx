import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { AuthContext } from '@shared/AuthContext';
import AuthPage from '@hub/AuthPage';

// Real i18n + styles so the screenshots match production pixel-for-pixel.
import '../../src/i18n';
import '../../src/hub/styles/theme.css';
import '../../src/hub/styles/components.css';

// Default context value: noop async fns that never touch Firebase/window.api.
const baseAuth = {
  user: null,
  loading: false,
  switching: false,
  login: async () => ({ success: false }),
  register: async () => ({ success: false }),
  logout: async () => {},
  switchAccount: async () => ({ success: false }),
  addAccount: async () => ({ success: false }),
  forgotPassword: async () => ({ success: false }),
  getCachedAccounts: () => [],
};

type AuthOverrides = Partial<typeof baseAuth>;

function renderAuth(authOverrides: AuthOverrides = {}, props: Record<string, unknown> = {}) {
  return render(
    <AuthContext.Provider value={{ ...baseAuth, ...authOverrides }}>
      <AuthPage onAuth={() => {}} {...props} />
    </AuthContext.Provider>,
  );
}

// Paths are resolved relative to this test file's directory.
const SCREENS = 'screens';

beforeAll(() => {
  // The auth-page fills 100vh; kill the default body margin so the leather
  // background reaches every edge of the captured viewport.
  document.body.style.margin = '0';
});

beforeEach(() => {
  document.documentElement.scrollTop = 0;
});

describe('AuthPage — visual states', () => {
  test('login (default)', async () => {
    renderAuth();
    await expect.element(page.getByRole('button', { name: 'Entrar al Reino' })).toBeVisible();
    await page.screenshot({ path: `${SCREENS}/01-login.png` });
  });

  test('register', async () => {
    renderAuth();
    await page.getByRole('button', { name: '¿No tenés cuenta? Registrate' }).click();
    await expect.element(page.getByRole('button', { name: 'Crear Cuenta' })).toBeVisible();
    await page.screenshot({ path: `${SCREENS}/02-register.png` });
  });

  test('register — password too short error', async () => {
    renderAuth();
    await page.getByRole('button', { name: '¿No tenés cuenta? Registrate' }).click();
    await page.getByPlaceholder('Nombre de usuario').fill('aventurero');
    await page.getByPlaceholder('Correo electrónico').fill('test@hubtify.app');
    await page.getByPlaceholder('Contraseña').fill('123');
    await page.getByRole('button', { name: 'Crear Cuenta' }).click();
    await expect.element(page.getByText('La contraseña debe tener al menos 6 caracteres')).toBeVisible();
    await page.screenshot({ path: `${SCREENS}/03-register-error.png` });
  });

  test('forgot password — form', async () => {
    renderAuth();
    await page.getByRole('button', { name: '¿Olvidaste tu contraseña?' }).click();
    await expect.element(page.getByRole('button', { name: 'Enviar enlace' })).toBeVisible();
    await page.screenshot({ path: `${SCREENS}/04-forgot-form.png` });
  });

  test('forgot password — link sent', async () => {
    renderAuth({ forgotPassword: async () => ({ success: true }) });
    await page.getByRole('button', { name: '¿Olvidaste tu contraseña?' }).click();
    await page.getByPlaceholder('Ingresá tu correo electrónico').fill('test@hubtify.app');
    await page.getByRole('button', { name: 'Enviar enlace' }).click();
    await expect.element(page.getByText(/Te enviamos un enlace/i)).toBeVisible();
    await page.screenshot({ path: `${SCREENS}/05-forgot-sent.png` });
  });

  test('login — invalid credentials error', async () => {
    renderAuth({ login: async () => ({ success: false, error: 'auth.errors.invalidCredential' }) });
    await page.getByPlaceholder('Email o nombre de usuario').fill('test@hubtify.app');
    await page.getByPlaceholder('Contraseña').fill('wrongpass');
    await page.getByRole('button', { name: 'Entrar al Reino' }).click();
    await expect.element(page.getByText('Correo o contraseña incorrectos')).toBeVisible();
    await page.screenshot({ path: `${SCREENS}/06-login-error.png` });
  });

  test('login — password revealed', async () => {
    renderAuth();
    await page.getByPlaceholder('Contraseña').fill('secreto123');
    await page.getByRole('button', { name: 'Mostrar contraseña' }).click();
    await expect.element(page.getByRole('button', { name: 'Ocultar contraseña' })).toBeVisible();
    await page.screenshot({ path: `${SCREENS}/07-password-revealed.png` });
  });

  test('add account mode', async () => {
    renderAuth({}, { mode: 'addAccount', onBack: () => {} });
    await expect.element(page.getByRole('button', { name: 'Agregar cuenta' })).toBeVisible();
    await page.screenshot({ path: `${SCREENS}/08-add-account.png` });
  });
});
