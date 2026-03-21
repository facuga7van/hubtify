import './styles/components.css';

export default function Dashboard() {
  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>Dashboard</h2>
      <div className="dashboard-grid">
        <div className="rpg-card dashboard-widget">
          <div className="rpg-card-title">&#x2694; Quests</div>
          <p style={{ opacity: 0.5, fontStyle: 'italic' }}>Module not installed</p>
        </div>
        <div className="rpg-card dashboard-widget">
          <div className="rpg-card-title">&#x1F356; Nutrition</div>
          <p style={{ opacity: 0.5, fontStyle: 'italic' }}>Module not installed</p>
        </div>
        <div className="rpg-card dashboard-widget">
          <div className="rpg-card-title">&#x1F4B0; Finance</div>
          <p style={{ opacity: 0.5, fontStyle: 'italic' }}>Module not installed</p>
        </div>
        <div className="rpg-card dashboard-widget">
          <div className="rpg-card-title">&#x1F6E1; Character</div>
          <p style={{ opacity: 0.5, fontStyle: 'italic' }}>Stats overview coming soon</p>
        </div>
      </div>
    </div>
  );
}
