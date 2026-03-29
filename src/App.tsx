import { useState } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import Layout from './hub/Layout';
import Onboarding from './hub/Onboarding';
import Dashboard from './hub/Dashboard';
import CharacterPage from './hub/CharacterPage';
import AuthPage from './hub/AuthPage';
import SettingsPage from './hub/SettingsPage';
import ErrorBoundary from './shared/components/ErrorBoundary';
import { questsModule } from './modules/quests';
import TaskList from './modules/quests/components/TaskList';
import './modules/quests/styles/quests.css';
import { nutritionModule } from './modules/nutrition';
import Today from './modules/nutrition/components/Today';
import NutritionCharts from './modules/nutrition/components/NutritionCharts';
import NutritionSettings from './modules/nutrition/components/NutritionSettings';
import { financeModule } from './modules/finance';
import FinanceLayout from './modules/finance/components/FinanceLayout';
import Dashboard from './modules/finance/components/Dashboard';
import Transactions from './modules/finance/components/Transactions';
import Installments from './modules/finance/components/Installments';
import Loans from './modules/finance/components/Loans';
import Recurring from './modules/finance/components/Recurring';
import Import from './modules/finance/components/Import';
import { useAuthContext } from './shared/AuthContext';

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
          <Route path="/quests" element={<TaskList />} />
          <Route path="/nutrition" element={<Today />} />
          <Route path="/nutrition/dashboard" element={<NutritionCharts />} />
          <Route path="/nutrition/settings" element={<NutritionSettings />} />
          <Route path="/finance" element={<FinanceLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="transactions" element={<Transactions />} />
            <Route path="installments" element={<Installments />} />
            <Route path="loans" element={<Loans />} />
            <Route path="recurring" element={<Recurring />} />
            <Route path="import" element={<Import />} />
          </Route>
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}
