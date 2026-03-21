import { useNavigate } from 'react-router-dom';
import PageHeader from '../shared/components/PageHeader';
import QuestsDashboardWidget from '../modules/quests/components/QuestsDashboardWidget';
import NutritionDashboardWidget from '../modules/nutrition/components/NutritionDashboardWidget';
import FinanceDashboardWidget from '../modules/finance/components/FinanceDashboardWidget';
import './styles/components.css';

export default function Dashboard() {
  const navigate = useNavigate();

  return (
    <div>
      <PageHeader title="Welcome, Adventurer" subtitle="Your quest log awaits" />
      <div className="dashboard-grid">
        <div
          className="rpg-card dashboard-widget"
          style={{ cursor: 'pointer' }}
          onClick={() => navigate('/quests')}
        >
          <div className="rpg-card-title">&#x2694; Questify</div>
          <QuestsDashboardWidget />
        </div>
        <div
          className="rpg-card dashboard-widget"
          style={{ cursor: 'pointer' }}
          onClick={() => navigate('/nutrition')}
        >
          <div className="rpg-card-title">&#x1F356; Nutrify</div>
          <NutritionDashboardWidget />
        </div>
        <div
          className="rpg-card dashboard-widget"
          style={{ cursor: 'pointer' }}
          onClick={() => navigate('/finance')}
        >
          <div className="rpg-card-title">&#x1F4B0; Coinify</div>
          <FinanceDashboardWidget />
        </div>
        <div
          className="rpg-card dashboard-widget"
          style={{ cursor: 'pointer' }}
          onClick={() => navigate('/character')}
        >
          <div className="rpg-card-title">&#x1F6E1; Character</div>
          <p style={{ opacity: 0.5, fontStyle: 'italic' }}>View your stats &amp; progress</p>
        </div>
      </div>
    </div>
  );
}
