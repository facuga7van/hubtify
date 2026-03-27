import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import Loading from '../../../shared/components/Loading';

export default function NutritionDashboardWidget() {
  const { t } = useTranslation();
  const [calories, setCalories] = useState(0);
  const [target, setTarget] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      window.api.nutritionGetTodayCalories(),
      window.api.nutritionGetTodayTarget(),
    ]).then(([c, t]) => {
      setCalories(c);
      setTarget(t);
      setLoading(false);
    }).catch(console.error);
  }, []);

  if (loading) return <Loading size="sm" />;

  const pct = target && target > 0 ? Math.round((calories / target) * 100) : 0;

  return (
    <div>
      <p style={{ fontSize: '1.5rem', fontFamily: 'Fira Code, monospace', color: 'var(--rpg-wood)' }}>
        {calories} <span style={{ fontSize: '0.75rem', opacity: 0.6 }}>kcal</span>
      </p>
      {target ? (
        <p style={{ fontSize: '0.85rem', opacity: 0.7, marginTop: 4 }}>
          {t('nutrify.calorieTarget', { pct, target })}
        </p>
      ) : (
        <p style={{ fontSize: '0.85rem', opacity: 0.5, fontStyle: 'italic' }}>{t('nutrify.setupRequired')}</p>
      )}
    </div>
  );
}
