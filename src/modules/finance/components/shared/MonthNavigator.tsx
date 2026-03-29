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
    <div className="flex items-center gap-4">
      <button onClick={() => navigate(-1)} className="rpg-btn-sm">&lt;</button>
      <span className="text-lg font-semibold capitalize">{label}</span>
      <button onClick={() => navigate(1)} className="rpg-btn-sm">&gt;</button>
    </div>
  );
}
