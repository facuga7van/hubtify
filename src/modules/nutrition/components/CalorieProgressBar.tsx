import { useTranslation } from 'react-i18next';

interface Props {
  consumed: number;
  target: number;    // TDEE - deficit (what you should eat)
  tdee: number;      // Total daily energy expenditure
}

export default function CalorieProgressBar({ consumed, target, tdee }: Props) {
  const { t } = useTranslation();
  if (tdee <= 0) return null;

  // Positions as % of TDEE (the full bar represents TDEE)
  const consumedPct = Math.min((consumed / tdee) * 100, 110);
  const targetPct = (target / tdee) * 100;
  const remaining = target - consumed;

  // Status
  const isOverTarget = consumed > target;
  const isOverTdee = consumed > tdee;
  const isInDeficit = consumed <= target;
  const deficitAmount = target - consumed;
  const surplusAmount = consumed - target;

  // Bar color based on status
  const barColor = isOverTdee
    ? 'var(--rpg-hp-red)'
    : isOverTarget
    ? '#e67e22'  // orange warning
    : 'var(--rpg-xp-green)';

  return (
    <div style={{ marginBottom: 16 }}>
      {/* Header stats */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: '0.85rem', marginBottom: 6 }}>
        <span style={{ fontFamily: 'Fira Code, monospace', fontWeight: 'bold' }}>
          {consumed} <span style={{ opacity: 0.5, fontWeight: 'normal' }}>kcal</span>
        </span>
        {isInDeficit ? (
          <span style={{ color: 'var(--rpg-xp-green)' }}>
            {remaining} kcal {t('nutrify.remaining')}
          </span>
        ) : (
          <span style={{ color: isOverTdee ? 'var(--rpg-hp-red)' : '#e67e22' }}>
            +{surplusAmount} kcal {t('nutrify.overTarget')}
          </span>
        )}
      </div>

      {/* Progress bar with markers */}
      <div style={{ position: 'relative' }}>
        <div className="rpg-bar" style={{ height: 22 }}>
          {/* Consumed fill */}
          <div style={{
            height: '100%', borderRadius: 2,
            width: `${Math.min(consumedPct, 100)}%`,
            background: barColor,
            transition: 'width 0.5s ease, background 0.3s ease',
          }} />
        </div>

        {/* Target marker line */}
        <div style={{
          position: 'absolute', top: -2, bottom: -2,
          left: `${Math.min(targetPct, 100)}%`,
          width: 2, background: 'var(--rpg-gold)',
          boxShadow: '0 0 4px var(--rpg-gold)',
          borderRadius: 1,
        }} />

      </div>

      {/* TDEE + Target below bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', fontFamily: 'Fira Code, monospace', opacity: 0.5, marginTop: 3 }}>
        <span>TDEE <b>{tdee}</b></span>
        <span><b style={{ color: 'var(--rpg-gold)' }}>{target}</b> kcal</span>
      </div>

      {/* Status message */}
      <div style={{ fontSize: '0.8rem', marginTop: 8, textAlign: 'center' }}>
        {isOverTdee ? (
          <span style={{ color: 'var(--rpg-hp-red)' }}>
            ⚠ {t('nutrify.overTdee')}
          </span>
        ) : isOverTarget ? (
          <span style={{ color: '#e67e22' }}>
            {t('nutrify.overTargetWarning')}
          </span>
        ) : deficitAmount > target * 0.3 ? (
          <span style={{ color: 'var(--rpg-xp-green)' }}>
            ★ {t('nutrify.greatDeficit')}
          </span>
        ) : (
          <span style={{ opacity: 0.5 }}>
            {t('nutrify.onTrack')}
          </span>
        )}
      </div>
    </div>
  );
}
