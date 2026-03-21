interface Props { consumed: number; target: number; }

export default function CalorieProgressBar({ consumed, target }: Props) {
  if (target <= 0) return null;
  const pct = Math.min((consumed / target) * 100, 150);
  const over = consumed > target;
  const color = over ? 'var(--rpg-hp-red)' : 'var(--rpg-xp-green)';

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: 4 }}>
        <span>{consumed} kcal consumed</span>
        <span>Target: {target} kcal</span>
      </div>
      <div className="rpg-bar" style={{ height: 20 }}>
        <div className="rpg-bar-fill" style={{ width: `${Math.min(pct, 100)}%`, background: color }} />
        <span className="rpg-bar-label">{Math.round(pct)}%</span>
      </div>
      {over && <p style={{ color: 'var(--rpg-hp-red)', fontSize: '0.8rem', marginTop: 4 }}>
        Over by {consumed - target} kcal
      </p>}
    </div>
  );
}
