import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { RingGauge, Rune } from '../../../shared/components/codex';
import { SparklineChart } from '../../../shared/components/charts';

export default function NutritionDashboardWidget() {
  const { t } = useTranslation();
  const [calories, setCalories] = useState(0);
  const [target, setTarget] = useState<number | null>(null);
  const [weekCalories, setWeekCalories] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const loadData = useCallback(() => {
    Promise.all([
      window.api.nutritionGetTodayCalories(),
      window.api.nutritionGetTodayTarget(),
      window.api.nutritionGetWeekCalories(),
    ]).then(([c, t, wk]) => {
      setCalories(c);
      setTarget(t);
      setWeekCalories(wk);
      setLoading(false);
    }).catch(() => { setLoadError(true); setLoading(false); });
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Reload data when account is switched
  useEffect(() => {
    const handler = () => loadData();
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
  }, [loadData]);

  if (loading)
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '6px 0 10px' }}>
        <div style={{ width: 68, height: 68, borderRadius: '50%', background: 'rgba(74,55,32,.1)' }} />
        <div style={{ flex: 1 }}>
          <div style={{ height: 10, background: 'rgba(74,55,32,.1)', marginBottom: 4 }} />
          <div style={{ height: 10, background: 'rgba(74,55,32,.08)', width: '70%' }} />
        </div>
      </div>
    );

  if (loadError)
    return (
      <p style={{ fontSize: 'var(--fs-label)', color: 'var(--rubric)' }}>
        {t('common.somethingWentWrong', 'Something went wrong')}
      </p>
    );

  const effectiveTarget = target && target > 0 ? target : 2000;
  const pct = Math.round((calories / effectiveTarget) * 100);
  const isSetup = target && target > 0;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '6px 0 10px' }}>
        <RingGauge
          value={calories}
          max={effectiveTarget}
          size={68}
          label="kcal"
        />
        <div style={{ flex: 1 }}>
          {isSetup ? (
            <>
              <div style={{ fontSize: 'var(--fs-label)', color: 'var(--ink)' }}>
                <span className="qb-numeral" style={{ fontSize: 'var(--fs-nav)' }}>{calories}</span>
                <span className="qb-hand" style={{ marginLeft: 4 }}>{t('nutrify.ofTarget', 'de')} {effectiveTarget} kcal</span>
              </div>
              <div className="qb-hand" style={{ fontSize: 'var(--fs-label)', color: 'var(--ink-faded)', marginTop: 2 }}>
                {pct}% {t('nutrify.ofDailyTarget', 'del objetivo diario')}
              </div>
            </>
          ) : (
            <p className="qb-hand" style={{ fontSize: 'var(--fs-label)', color: 'var(--ink-faded)', fontStyle: 'italic', margin: 0 }}>
              {t('nutrify.setupRequired', 'Setup required')}
            </p>
          )}
        </div>
        {weekCalories.length >= 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <SparklineChart data={weekCalories} width={80} height={24} color="var(--rpg-hp-red)" showArea />
            <span className="qb-hand" style={{ fontSize: 'calc(var(--fs-label) * 0.85)', color: 'var(--ink-faded)' }}>
              {t('nutrify.weekTrend', '7d trend')}
            </span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 8,
          paddingTop: 6,
          borderTop: '1px solid rgba(74,55,32,.2)',
          fontSize: 'var(--fs-label)',
        }}
      >
        <span className="qb-hand">
          {calories > 0 ? `${calories} ${t('nutrify.kcalLogged', 'kcal registradas')}` : t('nutrify.noFood', 'Sin comidas registradas')}
        </span>
        {isSetup && (
          <Rune tone={pct >= 80 && pct <= 120 ? 'sage' : pct > 120 ? 'rubric' : undefined}>
            {pct >= 80 && pct <= 120
              ? t('nutrify.balanceFavorable', 'balance favorable')
              : pct > 120
                ? t('nutrify.excess', 'exceso')
                : t('nutrify.inProgress', 'en curso')}
          </Rune>
        )}
      </div>
    </div>
  );
}
