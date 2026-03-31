import { useTranslation } from 'react-i18next';

interface MonthNavigatorProps {
  month: string;
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
    <div className="coin-month-nav">
      <button onClick={() => navigate(-1)} className="rpg-button coin-month-nav__btn">&lt;</button>
      <span className="coin-month-nav__label">{label}</span>
      <button onClick={() => navigate(1)} className="rpg-button coin-month-nav__btn">&gt;</button>
    </div>
  );
}
