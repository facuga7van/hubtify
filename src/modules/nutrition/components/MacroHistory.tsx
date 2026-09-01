import type { TFunction } from 'i18next';
import type { DailySummary, MacroTargets } from '../types';

/** A day counts toward the macro average only if it has at least one macro logged. */
function hasMacros(s: DailySummary): boolean {
  return (s.proteinG ?? 0) > 0 || (s.carbsG ?? 0) > 0 || (s.fatG ?? 0) > 0;
}

/**
 * Historical macro view for the chronicle: average daily protein/carbs/fat
 * across the selected range, compared against the current targets.
 * Reuses the Fase 1A `.nutri-macro-*` bars so the colors stay consistent.
 * Presentational — receives data + `t` via props for easy isolation in tests.
 */
export function MacroHistory({
  summaries,
  targets,
  t,
}: {
  summaries: DailySummary[];
  targets: MacroTargets | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: TFunction<any, any>;
}) {
  if (!targets) return null;

  const days = summaries.filter(hasMacros);
  const count = days.length;

  if (count === 0) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 120,
        }}
      >
        <p
          style={{
            opacity: 0.65,
            fontStyle: 'italic',
            textAlign: 'center',
            fontFamily: "'IM Fell English', serif",
            color: 'var(--ink-faded)',
          }}
        >
          {t('nutrify.noMacroData', 'Sin registro de macros en este período')}
        </p>
      </div>
    );
  }

  const avg = (sel: (s: DailySummary) => number | null | undefined) =>
    Math.round(days.reduce((sum, s) => sum + (sel(s) ?? 0), 0) / count);

  const rows: Array<{ key: string; label: string; consumed: number; target: number }> = [
    { key: 'protein', label: t('nutrify.protein', 'Proteína'), consumed: avg((s) => s.proteinG), target: targets.proteinG },
    { key: 'carbs', label: t('nutrify.carbs', 'Carbohidratos'), consumed: avg((s) => s.carbsG), target: targets.carbsG },
    { key: 'fat', label: t('nutrify.fat', 'Grasa'), consumed: avg((s) => s.fatG), target: targets.fatG },
  ];

  return (
    <div className="nutri-macros">
      <div className="nutri-macros-head">
        <span className="nutri-macros-title">
          {t('nutrify.macroBalanceSub', 'Promedio diario sobre {{count}} días con registro', { count })}
        </span>
        {targets.auto && (
          <span className="nutri-macros-auto">{t('nutrify.autoSuggested', 'Sugerido automáticamente')}</span>
        )}
      </div>
      {rows.map((row) => {
        const pct = row.target > 0 ? Math.round((row.consumed / row.target) * 100) : 0;
        const fill = Math.min(100, pct);
        const over = pct > 100;
        return (
          <div key={row.key} className={`nutri-macro${over ? ' is-over' : ''}`}>
            <div className="nutri-macro-info">
              <span className="nutri-macro-label">{row.label}</span>
              <span className="nutri-macro-val">
                {row.consumed} / {row.target} g
                <span className="nutri-macro-pct">{' '}{'·'} {pct}%</span>
              </span>
            </div>
            <div className={`nutri-macro-bar nutri-macro-bar--${row.key}${over ? ' is-over' : ''}`}>
              <div className="nutri-macro-fill" style={{ width: `${fill}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
