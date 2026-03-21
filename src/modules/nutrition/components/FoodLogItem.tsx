interface FoodEntry {
  id: number; time: string; description: string; calories: number;
  source: string; aiBreakdown: string | null;
}

interface Props {
  entry: FoodEntry;
  onDelete: (id: number) => void;
}

export default function FoodLogItem({ entry, onDelete }: Props) {
  const sourceIcon = entry.source === 'ai_estimate' ? '\uD83E\uDD16' : entry.source === 'frequent' ? '\u2B50' : '\u270F\uFE0F';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
      borderBottom: '1px solid var(--rpg-parchment-dark)',
    }}>
      <span style={{ fontSize: '0.8rem', opacity: 0.5, minWidth: 45 }}>{entry.time}</span>
      <span>{sourceIcon}</span>
      <span style={{ flex: 1 }}>{entry.description}</span>
      <span style={{ fontFamily: 'Fira Code, monospace', fontWeight: 'bold' }}>{entry.calories}</span>
      <span style={{ fontSize: '0.75rem', opacity: 0.5 }}>kcal</span>
      <button onClick={() => onDelete(entry.id)} style={{
        background: 'none', border: 'none', cursor: 'pointer', color: 'var(--rpg-hp-red)', fontSize: '0.85rem',
      }}>{'\u2715'}</button>
    </div>
  );
}
