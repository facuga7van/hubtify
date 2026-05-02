import { createRoot } from 'react-dom/client';
import './shared/animations/gsap-setup';
import './i18n';
import './hub/styles/theme.css';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './shared/AuthContext';
import { ConfirmProvider } from './shared/components/ConfirmDialog';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

const isFloatingTimer = new URLSearchParams(window.location.search).get('view') === 'floating-timer';

if (isFloatingTimer) {
  import('./modules/cauldron/components/CauldronFloatingWindow').then(({ default: CauldronFloatingWindow }) => {
    createRoot(root).render(<CauldronFloatingWindow />);
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
