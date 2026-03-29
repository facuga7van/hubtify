import { useTranslation } from 'react-i18next';

interface MonthNavigatorProps {
  month: string; // 'YYYY-MM' format
  onChange: (month: string) => void;
}

export function MonthNavigator({ month, onChange }: MonthNavigatorProps) {
  const { t } = useTranslation();

  const navigate = (delta: number) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    onChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const label = (() => {
    const [y, m] = month.split('-').map(Number);
    return new Date(y, m - 1).toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric',
    });
  })();

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <button onClick={() => navigate(-1)} className="rpg-button" style={{ fontSize: '0.8rem', padding: '4px 10px' }}>&lt;</button>
      <span style={{ fontSize: '1.1rem', fontWeight: 600, textTransform: 'capitalize' }}>{label}</span>
      <button onClick={() => navigate(1)} className="rpg-button" style={{ fontSize: '0.8rem', padding: '4px 10px' }}>&gt;</button>
    </div>
  );
}
