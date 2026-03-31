import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatedNumber } from '../../finance/components/shared/AnimatedNumber';

export default function NutritionDashboardWidget() {
  const { t } = useTranslation();
  const [calories, setCalories] = useState(0);
  const [target, setTarget] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    Promise.all([
      window.api.nutritionGetTodayCalories(),
      window.api.nutritionGetTodayTarget(),
    ]).then(([c, t]) => {
      setCalories(c);
      setTarget(t);
      setLoading(false);
    }).catch(() => { setLoadError(true); setLoading(false); });
  }, []);

  if (loading) return (
    <div>
      <div className="nutri-skeleton nutri-skeleton--number" style={{ marginBottom: 8 }} />
      <div className="nutri-skeleton nutri-skeleton--text" />
    </div>
  );
  if (loadError) return <p style={{ fontSize: '0.8rem', color: 'var(--rpg-hp-red)' }}>{t('common.somethingWentWrong')}</p>;

  const pct = target && target > 0 ? Math.round((calories / target) * 100) : 0;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontSize: '1.5rem', fontFamily: 'Fira Code, monospace', color: 'var(--rpg-wood)' }}>
          <AnimatedNumber
            value={calories}
            prefix=""
            locale="es-AR"
            className=""
          />
        </span>
        <span style={{ fontSize: '0.75rem', opacity: 0.6, fontFamily: 'Fira Code, monospace' }}>kcal</span>
      </div>
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
