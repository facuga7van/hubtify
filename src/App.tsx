import { useState, useEffect, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useNavigate, Outlet } from 'react-router-dom';
import Layout from './hub/Layout';
import Onboarding from './hub/Onboarding';
import Dashboard from './hub/Dashboard';
import AuthPage from './hub/AuthPage';
import ErrorBoundary from './shared/components/ErrorBoundary';
// Module stylesheets stay eager: the dashboard on `/` renders a widget from
// every module, so splitting them out would only trade a chunk for a FOUC.
import './modules/quests/styles/quests.css';
import './modules/finance/styles/coinify.css';
import './modules/nutrition/styles/nutri.css';
import './modules/cauldron/styles/cauldron.css';
import {
  CharacterPage,
  SettingsPage,
  CauldronPage,
  TaskList,
  Today,
  NutritionCharts,
  NutritionSettings,
  FinanceLayout,
  FinanceDashboard,
  Transactions,
  Installments,
  Loans,
  Recurring,
  Import,
  CreditCards,
  prefetchRoutes,
} from './routes';
import { useAuthContext } from './shared/AuthContext';

/* The Logros shelf is a rarely-first screen and its own chunk. It is lazied
   here rather than in `routes.tsx` because that module is owned by another
   pass; `fallback={null}` keeps the page-flip transition from ever being
   handed a spinner as if it were the destination page. */
const AchievementsPage = lazy(() => import('./hub/AchievementsPage'));
const RewardsPage = lazy(() => import('./hub/rewards/RewardsPage'));

// Solo se carga si el worker mobile muere después de `ready` (spec §3.5).
// Aceptado: el bundle desktop emite este chunk (FatalScreen + su CSS, unos KB)
// aunque nunca lo pida; `protocol.ts` no entra porque solo se importan tipos.
const FatalScreen = lazy(() => import('./mobile/FatalScreen'));

function AuthPageWrapper() {
  const navigate = useNavigate();
  return <AuthPage onAuth={() => navigate('/')} />;
}

function AddAccountPageWrapper() {
  const navigate = useNavigate();
  return <AuthPage mode="addAccount" onAuth={() => navigate('/')} onBack={() => navigate(-1)} />;
}

export default function App() {
  const [onboarded, setOnboarded] = useState(() => localStorage.getItem('hubtify_onboarded') === 'true');
  const { user, loading } = useAuthContext();

  // Re-read onboarded flag after login/account switch (syncPull may restore it from cloud)
  useEffect(() => {
    if (!user) return;
    const checkOnboarded = () => {
      const flag = localStorage.getItem('hubtify_onboarded') === 'true';
      setOnboarded(flag);
    };
    // Check after a short delay to allow syncPull to write localStorage
    const timer = setTimeout(checkOnboarded, 500);
    window.addEventListener('account:switched', checkOnboarded);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('account:switched', checkOnboarded);
    };
  }, [user]);

  // Warm the route chunks while the main thread is idle, so navigating (Ctrl+1..6
  // included) never waits on a chunk it could have fetched during the lull after
  // startup. Only once past both gates — the shell is what the chunks belong to.
  const shellVisible = !loading && !!user && onboarded;
  useEffect(() => {
    if (!shellVisible) return;
    return prefetchRoutes();
  }, [shellVisible]);

  // Android: el worker de datos murió. Sin recreación silenciosa: pantalla
  // terminal con «Reiniciar» (spec §3.5).
  const [workerCrash, setWorkerCrash] = useState<string | null>(null);
  useEffect(() => {
    const onCrash = (e: Event) => setWorkerCrash((e as CustomEvent<string>).detail || 'Worker crashed');
    window.addEventListener('mobile:workerCrashed', onCrash);
    return () => window.removeEventListener('mobile:workerCrashed', onCrash);
  }, []);

  if (workerCrash !== null) {
    return (
      <Suspense fallback={null}>
        <FatalScreen reason="crash" message={workerCrash} />
      </Suspense>
    );
  }

  // Show loading while Firebase checks auth state
  if (loading) return null;

  // Auth gate: must be logged in first
  if (!user) {
    return (
      <ErrorBoundary>
        <Routes>
          <Route path="/login" element={<AuthPageWrapper />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </ErrorBoundary>
    );
  }

  // Onboarding gate: must complete onboarding after first login
  if (!onboarded) {
    return <Onboarding onComplete={() => setOnboarded(true)} />;
  }

  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="/login/add" element={<AddAccountPageWrapper />} />
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/character" element={<CharacterPage />} />
          <Route
            path="/achievements"
            element={<Suspense fallback={null}><AchievementsPage /></Suspense>}
          />
          <Route
            path="/rewards"
            element={<Suspense fallback={null}><RewardsPage /></Suspense>}
          />
          <Route path="/quests" element={<TaskList />} />
          <Route path="/nutrition" element={<Outlet />}>
            <Route index element={<Today />} />
            <Route path="dashboard" element={<NutritionCharts />} />
            <Route path="settings" element={<NutritionSettings />} />
          </Route>
          <Route path="/finance" element={<FinanceLayout />}>
            <Route index element={<FinanceDashboard />} />
            <Route path="transactions" element={<Transactions />} />
            <Route path="installments" element={<Installments />} />
            <Route path="cards" element={<CreditCards />} />
            <Route path="loans" element={<Loans />} />
            <Route path="recurring" element={<Recurring />} />
            <Route path="import" element={<Import />} />
          </Route>
          <Route path="/cauldron" element={<CauldronPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}
