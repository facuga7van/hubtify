import { createRoot } from 'react-dom/client';
import './shared/animations/gsap-setup';
import { HashRouter } from 'react-router-dom';
import './i18n';
import App from './App';
import './hub/styles/theme.css';
import { AuthProvider } from './shared/AuthContext';
import { ConfirmProvider } from './shared/components/ConfirmDialog';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <HashRouter>
    <AuthProvider>
      <ConfirmProvider>
        <App />
      </ConfirmProvider>
    </AuthProvider>
  </HashRouter>
);
