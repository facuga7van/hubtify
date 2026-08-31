import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Heart, Scroll } from '../../../shared/components/icons';
import type { HistorySuggestion } from '../history-search';

interface Props {
  suggestions: HistorySuggestion[];
  /** -1 = nothing highlighted, which is the state Enter still means "ask the AI". */
  activeIndex: number;
  /** `usuals` shows the standing top of the ranking; `search` shows matches. */
  mode: 'usuals' | 'search' | 'idle';
  /** Staged portion multiplier from the portion chips, previewed in the kcal. */
  portion: number;
  onHover: (index: number) => void;
  onChoose: (suggestion: HistorySuggestion) => void;
  popupRef: React.RefObject<HTMLDivElement | null>;
  pos: { top: number; left: number };
  width: number;
}

/**
 * The suggestion dropdown, rendered into `document.body`.
 *
 * A portal, not an absolutely positioned child: the log-food card clips its
 * overflow, and an in-flow dropdown simply vanishes below the fold. Same reason
 * PostponeMenu and the date pickers use `useAnchoredPopup`.
 */
export default function FoodSuggestionList({
  suggestions, activeIndex, mode, portion, onHover, onChoose, popupRef, pos, width,
}: Props) {
  const { t } = useTranslation();

  return createPortal(
    <div
      ref={popupRef}
      id="nutri-suggest-popup"
      className="nutri-suggest-popup rpg-anchored-popup"
      role="listbox"
      aria-label={t('nutrify.historySuggestions', 'Sugerencias de tu historial')}
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: width || undefined }}
    >
      {mode === 'usuals' && (
        <div className="nutri-suggest-head">
          <Scroll width={12} height={12} />
          {t('nutrify.historyUsuals', 'Tus de siempre')}
        </div>
      )}
      {suggestions.map((s, i) => {
        const kcal = Math.round(s.calories * portion);
        return (
          <button
            key={`${s.source}:${s.description}`}
            type="button"
            role="option"
            aria-selected={i === activeIndex}
            className={`nutri-suggest-opt${i === activeIndex ? ' active' : ''}`}
            // Keep the caret in the input: without this the mousedown blurs it,
            // the dropdown unmounts, and the click never reaches this button.
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => onHover(i)}
            onClick={() => onChoose(s)}
          >
            <span className="nutri-suggest-name">
              {s.source === 'favorite' && (
                <Heart width={11} height={11} stroke="var(--rpg-hp-red)" />
              )}
              {s.description}
            </span>
            <span className="nutri-suggest-meta">
              {kcal} kcal
              {s.timesLogged > 0 && (
                <>
                  {' · '}
                  {t('nutrify.historyTimesLogged', '{{count}} veces', { count: s.timesLogged })}
                </>
              )}
              {portion !== 1 && <span className="nutri-suggest-portion">{'×'}{portion}</span>}
            </span>
          </button>
        );
      })}
      <div className="nutri-suggest-hint">
        {t('nutrify.historyKeysHint', '↑↓ elegir · Enter registra · Tab completa · Esc cierra')}
      </div>
    </div>,
    document.body,
  );
}
