import { useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { barGleam } from '../../../shared/animations/feedback';

type Goal = 'deficit' | 'maintain' | 'surplus';

interface Props {
  consumed: number;
  tdee: number;
  deficitTargetKcal: number; // positive = deficit, negative = surplus, 0 = maintain
}

function getGoal(deficitTargetKcal: number): Goal {
  if (deficitTargetKcal > 0) return 'deficit';
  if (deficitTargetKcal < 0) return 'surplus';
  return 'maintain';
}

function statusMessage(t: (k: string) => string, goal: Goal, consumed: number, target: number, barMax: number) {
  const pct = target > 0 ? consumed / target : 0;

  // Over the absolute max — always bad
  if (consumed > barMax) {
    return <span style={{ color: 'var(--rpg-hp-red)' }}>{t(`nutrify.status.${goal}.over`)}</span>;
  }

  if (goal === 'deficit') {
    if (consumed > target) return <span style={{ color: '#e67e22' }}>{t('nutrify.status.deficit.warning')}</span>;
    if (pct >= 0.85) return <span style={{ opacity: 0.5 }}>{t('nutrify.status.deficit.close')}</span>;
    if (pct >= 0.5) return <span style={{ color: 'var(--rpg-xp-green)' }}>{t('nutrify.status.deficit.good')}</span>;
    return <span style={{ opacity: 0.4 }}>{t('nutrify.status.deficit.early')}</span>;
  }

  if (goal === 'surplus') {
    if (pct >= 0.85) return <span style={{ color: 'var(--rpg-xp-green)' }}>{t('nutrify.status.surplus.close')}</span>;
    if (pct >= 0.5) return <span style={{ opacity: 0.5 }}>{t('nutrify.status.surplus.good')}</span>;
    return <span style={{ opacity: 0.4 }}>{t('nutrify.status.surplus.early')}</span>;
  }

  // maintain
  if (pct >= 0.85 && pct <= 1.0) return <span style={{ color: 'var(--rpg-xp-green)' }}>{t('nutrify.status.maintain.good')}</span>;
  if (pct >= 0.5) return <span style={{ opacity: 0.5 }}>{t('nutrify.status.maintain.onTrack')}</span>;
  return <span style={{ opacity: 0.4 }}>{t('nutrify.status.maintain.early')}</span>;
}

export default function CalorieProgressBar({ consumed, tdee, deficitTargetKcal }: Props) {
  const { t } = useTranslation();
  const barFillRef = useRef<HTMLDivElement>(null);
  const prevConsumedRef = useRef(consumed);

  useEffect(() => {
    if (consumed > prevConsumedRef.current && barFillRef.current) {
      barGleam(barFillRef.current, 0.4);
    }
    prevConsumedRef.current = consumed;
  }, [consumed]);

  if (tdee <= 0) return null;

  const goal = getGoal(deficitTargetKcal);
  const surplusAmount = Math.abs(deficitTargetKcal);

  // Bar max and target based on goal
  const barMax = goal === 'surplus' ? tdee + surplusAmount : tdee;
  const target = goal === 'deficit' ? tdee - deficitTargetKcal : barMax;

  const consumedPct = Math.min((consumed / barMax) * 100, 100);
  const targetPct = (target / barMax) * 100;
  const remaining = target - consumed;

  // Bar color
  const barColor = consumed > barMax
    ? 'var(--rpg-hp-red)'
    : goal === 'deficit' && consumed > target
      ? '#e67e22'
      : 'var(--rpg-xp-green)';

  return (
    <div style={{ marginBottom: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: '0.85rem', marginBottom: 6 }}>
        <span style={{ fontFamily: 'Fira Code, monospace', fontWeight: 'bold' }}>
          {consumed} <span style={{ opacity: 0.5, fontWeight: 'normal' }}>kcal</span>
        </span>
        {consumed <= target ? (
          <span style={{ color: 'var(--rpg-xp-green)', fontSize: '0.8rem' }}>
            {remaining} kcal {t('nutrify.remaining')}
          </span>
        ) : (
          <span style={{ color: consumed > barMax ? 'var(--rpg-hp-red)' : '#e67e22', fontSize: '0.8rem' }}>
            +{consumed - target} kcal {t('nutrify.overTarget')}
          </span>
        )}
      </div>

      {/* Bar */}
      <div style={{ position: 'relative' }}>
        <div className="rpg-bar" style={{ height: 22 }}>
          <div ref={barFillRef} style={{
            height: '100%', borderRadius: 2,
            width: `${consumedPct}%`,
            background: barColor,
            transition: 'width 0.5s ease, background 0.3s ease',
          }} />
        </div>

        {/* Deficit marker */}
        {goal === 'deficit' && (
          <div style={{
            position: 'absolute', top: -2, bottom: -2,
            left: `${targetPct}%`,
            width: 2, background: 'var(--rpg-gold)',
            boxShadow: '0 0 4px var(--rpg-gold)',
            borderRadius: 1,
          }} />
        )}

        {/* Overflow indicator */}
        {consumed > barMax && (
          <div style={{
            position: 'absolute', top: 0, right: 0, bottom: 0,
            width: 6, borderRadius: '0 2px 2px 0',
            background: 'var(--rpg-hp-red)',
            boxShadow: '0 0 6px var(--rpg-hp-red)',
          }} />
        )}
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: '0.75rem', marginTop: 4 }}>
        <span style={{ opacity: 0.5, fontFamily: 'Fira Code, monospace' }}>
          {goal === 'deficit' && <>{t('nutrify.target')}: <b>{target}</b> · </>}
          TDEE: <b>{tdee}</b>
          {goal === 'surplus' && <> · {t('nutrify.target')}: <b>{target}</b></>}
        </span>
        {statusMessage(t, goal, consumed, target, barMax)}
      </div>
    </div>
  );
}
