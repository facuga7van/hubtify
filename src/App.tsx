import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './hub/Layout';
import Dashboard from './hub/Dashboard';
import { questsModule } from './modules/quests';
import TaskList from './modules/quests/components/TaskList';
import './modules/quests/styles/quests.css';
import { nutritionModule } from './modules/nutrition';
import Today from './modules/nutrition/components/Today';
import { financeModule } from './modules/finance';
import FinanceDashboard from './modules/finance/components/FinanceDashboard';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/quests" element={<TaskList />} />
        <Route path="/nutrition" element={<Today />} />
        <Route path="/finance" element={<FinanceDashboard />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Route>
    </Routes>
  );
}
