import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './hub/Layout';
import Dashboard from './hub/Dashboard';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Route>
    </Routes>
  );
}
