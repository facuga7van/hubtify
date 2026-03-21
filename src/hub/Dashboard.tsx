import { useNavigate } from 'react-router-dom';
import QuestsDashboardWidget from '../modules/quests/components/QuestsDashboardWidget';
import NutritionDashboardWidget from '../modules/nutrition/components/NutritionDashboardWidget';
import FinanceDashboardWidget from '../modules/finance/components/FinanceDashboardWidget';
import './styles/components.css';

export default function Dashboard() {
  const navigate = useNavigate();

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: '1.4rem', marginBottom: 4 }}>Welcome, Adventurer</h2>
        <p style={{ fontSize: '0.9rem', opacity: 0.6 }}>Your quest log awaits</p>
      </div>
      <div className="dashboard-grid">
        <div
          className="rpg-card dashboard-widget"
          style={{ cursor: 'pointer' }}
          onClick={() => navigate('/quests')}
        >
          <div className="rpg-card-title">&#x2694; Quests</div>
          <QuestsDashboardWidget />
        </div>
        <div
          className="rpg-card dashboard-widget"
          style={{ cursor: 'pointer' }}
          onClick={() => navigate('/nutrition')}
        >
          <div className="rpg-card-title">&#x1F356; Nutrition</div>
          <NutritionDashboardWidget />
        </div>
        <div
          className="rpg-card dashboard-widget"
          style={{ cursor: 'pointer' }}
          onClick={() => navigate('/finance')}
        >
          <div className="rpg-card-title">&#x1F4B0; Finance</div>
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
