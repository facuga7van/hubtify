interface HpBarProps { hp: number; maxHp: number; }

export default function HpBar({ hp, maxHp }: HpBarProps) {
  const pct = Math.round((hp / maxHp) * 100);
  return (
    <div className="rpg-bar">
      <div className="rpg-bar-fill rpg-bar-fill--hp" style={{ width: `${pct}%` }} />
      <span className="rpg-bar-label">HP {hp}/{maxHp}</span>
    </div>
  );
}
