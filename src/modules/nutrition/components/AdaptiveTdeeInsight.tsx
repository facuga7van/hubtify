import type { TFunction } from 'i18next';
import { Compass } from '../../../shared/components/icons';
import type { AdaptiveTdeeEstimate } from '../../../../shared/adaptive-tdee';
import { MIN_LOGGED_DAYS } from '../../../../shared/adaptive-tdee';

// `t` arrives as a prop so this stays a pure presentational component the browser
// test can feed a fake translator (mirrors MacroBars in Today.tsx).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type T = TFunction<any, any>;

export interface AdaptiveTdeeInsightProps {
  /** The adaptive estimate from the backend (never null; carries its own status). */
  result: AdaptiveTdeeEstimate;
  /** The current static TDEE shown elsewhere in settings, for comparison. */
  staticTdee: number;
  /** Signed deficit the user currently targets (+ cut, − bulk, 0 maintenance). */
  signedDeficit: number;
  /** Called when the user explicitly chooses to apply the estimate to their goal. */
  onApply?: () => void;
  t: T;
}

const CONFIDENCE_ORDER = ['low', 'medium', 'high'] as const;

/**
 * Read-only INSIGHT card for the data-derived ("adaptive") TDEE.
 *
 * Shows the user's estimated REAL expenditure next to the static estimate, a
 * confidence badge and a plain-language explanation. When confidence is high
 * enough it offers an explicit "use this value" button that pre-fills the goal —
 * it NEVER changes anything on its own. When data is thin it nudges the user to
 * keep logging instead of inventing a number.
 */
export function AdaptiveTdeeInsight({ result, staticTdee, signedDeficit, onApply, t }: AdaptiveTdeeInsightProps) {
  const hasEstimate = result.tdee != null && result.confidence !== 'insufficient';

  // ── Insufficient data: encourage, don't shame ──
  if (!hasEstimate) {
    const needMoreDays = Math.max(0, MIN_LOGGED_DAYS - result.sampleDays);
    const needWeight = result.weightSamples < 2;
    const message = needWeight
      ? t('nutrify.adaptiveTdeeNeedWeight', 'Registrá tu peso un par de semanas y seguí cargando comidas: con eso voy a poder estimar tu gasto real.')
      : t('nutrify.adaptiveTdeeNeedDays', 'Seguí registrando tus comidas para estimar tu gasto real (faltan {{count}} días).', { count: needMoreDays });

    return (
      <div className="nutri-adaptive-insight is-pending">
        <div className="nutri-adaptive-head">
          <span className="nutri-t-ico"><Compass width={14} height={14} /></span>
          <span className="nutri-adaptive-title">{t('nutrify.adaptiveTdeeTitle', 'Gasto real estimado')}</span>
        </div>
        <p className="nutri-adaptive-pending">{message}</p>
      </div>
    );
  }

  const realTdee = result.tdee as number;
  const diff = realTdee - staticTdee;
  const diffLabel = `${diff >= 0 ? '+' : ''}${diff}`;
  const suggestedTarget = realTdee - signedDeficit;

  // Higher real expenditure means you can eat more for the same goal, and vice versa.
  const explanation = diff === 0
    ? t('nutrify.adaptiveTdeeExplainEqual', 'Tu gasto real coincide con el estimado: vas afinado.')
    : diff > 0
      ? t('nutrify.adaptiveTdeeExplainHigher', 'Tu cuerpo gasta más de lo que dice la fórmula: podés comer un poco más y mantener el mismo objetivo.')
      : t('nutrify.adaptiveTdeeExplainLower', 'Tu cuerpo gasta menos de lo que dice la fórmula: ajustá un poco para seguir en rumbo.');

  const confidenceLabel = t(`nutrify.adaptiveConfidence_${result.confidence}`,
    result.confidence === 'high' ? 'Confianza alta' : result.confidence === 'medium' ? 'Confianza media' : 'Confianza baja');

  return (
    <div className="nutri-adaptive-insight">
      <div className="nutri-adaptive-head">
        <span className="nutri-t-ico"><Compass width={14} height={14} /></span>
        <span className="nutri-adaptive-title">{t('nutrify.adaptiveTdeeTitle', 'Gasto real estimado')}</span>
        <span className={`nutri-confidence-badge conf-${result.confidence}`}>
          {CONFIDENCE_ORDER.map((lvl) => (
            <i key={lvl} className={`conf-pip${CONFIDENCE_ORDER.indexOf(result.confidence as typeof CONFIDENCE_ORDER[number]) >= CONFIDENCE_ORDER.indexOf(lvl) ? ' on' : ''}`} />
          ))}
          {confidenceLabel}
        </span>
      </div>

      <div className="nutri-adaptive-figures">
        <div className="nutri-adaptive-real">
          <span className="nutri-adaptive-val">{realTdee.toLocaleString()}</span>
          <span className="nutri-adaptive-unit">kcal/{t('nutrify.perDay', 'día')}</span>
        </div>
        <div className="nutri-adaptive-vs">
          {t('nutrify.adaptiveTdeeVsStatic', 'Estimado por fórmula: {{tdee}} kcal', { tdee: staticTdee.toLocaleString() })}
          <span className={`nutri-adaptive-diff ${diff >= 0 ? 'pos' : 'neg'}`}>{diffLabel} kcal</span>
        </div>
      </div>

      <p className="nutri-adaptive-explain">{explanation}</p>

      <div className="nutri-adaptive-foot">
        <span className="nutri-field-hint">
          {t('nutrify.adaptiveTdeeBasis', 'Calculado con {{days}} días de registro y tu tendencia de peso.', { days: result.sampleDays })}
        </span>
        {onApply && (
          <button type="button" className="nutri-btn nutri-btn-sm" onClick={onApply}>
            {t('nutrify.adaptiveTdeeApply', 'Usar este valor')}
            <span className="nutri-adaptive-apply-target"> ({suggestedTarget.toLocaleString()} kcal)</span>
          </button>
        )}
      </div>
    </div>
  );
}
