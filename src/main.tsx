import { createRoot } from 'react-dom/client';
import './shared/animations/gsap-setup';
import './i18n';
import './hub/styles/theme.css';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './shared/AuthContext';
import { ConfirmProvider } from './shared/components/ConfirmDialog';
import { isNativeMobile } from './shared/platform-detect';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element not found');
// Alias tipado: el render pasó a vivir dentro de closures (`renderApp`,
// `bootstrap`) y TS no propaga ahí el estrechamiento del `if` de arriba.
const root: HTMLElement = rootEl;

const isFloatingTimer = new URLSearchParams(window.location.search).get('view') === 'floating-timer';

function renderApp(): void {
  if (isFloatingTimer) {
    import('./modules/cauldron/components/CauldronFloatingWindow').then(({ default: CauldronFloatingWindow }) => {
      createRoot(root).render(
        <ConfirmProvider>
          <CauldronFloatingWindow />
        </ConfirmProvider>
      );
    });
  } else {
    createRoot(root).render(
      <HashRouter>
        <AuthProvider>
          <ConfirmProvider>
            <App />
          </ConfirmProvider>
        </AuthProvider>
      </HashRouter>
    );
  }
}

/**
 * En Android `window.api` no existe hasta que el worker instaló el VFS, abrió la
 * DB y aplicó las migraciones (spec §3.5): se espera ANTES de montar React.
 * Ningún módulo lee `window.api` a nivel de módulo, así que el orden es seguro.
 *
 * El guard usa la constante de `define` ADEMÁS de `isNativeMobile()`: esbuild
 * pliega `"desktop" === 'android'` a `false` y Rollup elimina los `import()`
 * de abajo del bundle desktop. Con solo la llamada en runtime, el renderer de
 * Electron emitiría chunks para install-api, Capacitor, el worker entero,
 * sqlite-wasm (579 KB + 865 KB de .wasm) y una copia de shared-logic.
 */
async function bootstrap(): Promise<void> {
  if (typeof __HUBTIFY_PLATFORM__ !== 'undefined' && __HUBTIFY_PLATFORM__ === 'android' && isNativeMobile()) {
    const { installMobileApi } = await import('./mobile/install-api');
    try {
      await installMobileApi();
    } catch (err) {
      const [{ default: FatalScreen }, { MobileFatal }] = await Promise.all([
        import('./mobile/FatalScreen'),
        import('./mobile/protocol'),
      ]);
      const fatal =
        err instanceof MobileFatal
          ? err
          : new MobileFatal('open', err instanceof Error ? err.message : String(err));
      console.error('[mobile] arranque fallido:', fatal.reason, fatal.message);
      createRoot(root).render(
        <FatalScreen
          reason={fatal.reason}
          message={fatal.message}
          namespace={fatal.namespace}
          version={fatal.version}
        />
      );
      return;
    }
  }
  renderApp();
}

void bootstrap();
