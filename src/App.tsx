import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './hub/Layout';
import Dashboard from './hub/Dashboard';
import CharacterPage from './hub/CharacterPage';
import ErrorBoundary from './shared/components/ErrorBoundary';
import { questsModule } from './modules/quests';
import TaskList from './modules/quests/components/TaskList';
import './modules/quests/styles/quests.css';
import { nutritionModule } from './modules/nutrition';
import Today from './modules/nutrition/components/Today';
import NutritionCharts from './modules/nutrition/components/NutritionCharts';
import { financeModule } from './modules/finance';
import FinanceDashboard from './modules/finance/components/FinanceDashboard';

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/character" element={<CharacterPage />} />
          <Route path="/quests" element={<TaskList />} />
          <Route path="/nutrition" element={<Today />} />
          <Route path="/nutrition/dashboard" element={<NutritionCharts />} />
          <Route path="/finance" element={<FinanceDashboard />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}
