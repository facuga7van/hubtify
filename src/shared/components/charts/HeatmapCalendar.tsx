import React, { useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import './charts.css';

/** 'grace' = dia puenteado por un indulto/dia de gracia: ni logrado ni perdido. */
export type CellLevel = 'l0' | 'l1' | 'l2' | 'l3' | 'l4' | 'miss' | 'grace' | 'today';

export interface HeatmapCalendarProps {
  data: CellLevel[];
  /** ISO date string (YYYY-MM-DD) of the first data element */
  startDate: string;
  /** Optional tooltip per cell (same length as data) */
  tooltips?: string[];
  columns?: number;
  themed?: boolean;
  legend?: boolean;
}

const LEVEL_CLASSES: Record<CellLevel, string> = {
  l0: 'heatmap-cell--l0',
  l1: 'heatmap-cell--l1',
  l2: 'heatmap-cell--l2',
  l3: 'heatmap-cell--l3',
  l4: 'heatmap-cell--l4',
  miss: 'heatmap-cell--miss',
  today: 'heatmap-cell--l4 heatmap-cell--today',
  grace: 'heatmap-cell--grace',
};

/** Monday=0 … Sunday=6 */
function weekdayOffset(dateStr: string): number {
  const d = new Date(dateStr + 'T12:00:00');
  return (d.getDay() + 6) % 7;
}

const DAY_LABELS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

export const HeatmapCalendar: React.FC<HeatmapCalendarProps> = ({
  data,
  startDate,
  tooltips,
  columns = 7,
  themed = true,
  legend = true,
}) => {
  const themeClass = themed ? 'heatmap-calendar--themed' : 'heatmap-calendar--simple';
  const offset = weekdayOffset(startDate);

  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  const showTip = useCallback((e: React.SyntheticEvent, idx: number) => {
    const text = tooltips?.[idx];
    if (!text) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTip({ text, x: rect.left + rect.width / 2, y: rect.top });
  }, [tooltips]);

  /** ISO date of cell `i`, so every cell can name its own day. */
  const dateAt = useCallback((i: number) => {
    const d = new Date(startDate + 'T12:00:00');
    d.setDate(d.getDate() + i);
    return d.toISOString().slice(0, 10);
  }, [startDate]);

  const hideTip = useCallback(() => setTip(null), []);

  return (
    <div className={`heatmap-calendar ${themeClass}`}>
      {/* Day-of-week headers */}
      <div className="heatmap-header" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 22px))`, justifyContent: 'center' }}>
        {DAY_LABELS.map((d) => (
          <span key={d} className="heatmap-day-label">{d}</span>
        ))}
      </div>

      <div className="heatmap-divider" />

      <div
        className="heatmap-grid"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 22px))`, justifyContent: 'center' }}
      >
        {Array.from({ length: offset }, (_, i) => (
          <div key={`pad-${i}`} className="heatmap-cell heatmap-cell--empty" />
        ))}

        {data.map((level, i) => {
          const isToday = level === 'today';
          const isMiss = level === 'miss';
          const cellClass = LEVEL_CLASSES[level] ?? 'heatmap-cell--l0';

          // The value of a day used to be reachable only by hovering with a
          // mouse: no title, no keyboard focus.
          const label = tooltips?.[i] ?? dateAt(i);

          return (
            <div
              key={i}
              className={`heatmap-cell ${cellClass}`}
              title={label}
              tabIndex={0}
              role="img"
              aria-label={label}
              onMouseEnter={(e) => showTip(e, i)}
              onMouseLeave={hideTip}
              onFocus={(e) => showTip(e, i)}
              onBlur={hideTip}
            >
              {isToday && <span className="heatmap-today-mark">{'\u2726'}</span>}
              {isMiss && <span className="heatmap-miss-mark">{'\u2715'}</span>}
              {themed && level === 'l4' && !isToday && (
                <span className="heatmap-ornament">{'\u2766'}</span>
              )}
            </div>
          );
        })}
      </div>

      {legend && <HeatmapLegend themed={themed} />}

      {tip && createPortal(
        <div
          ref={tipRef}
          className="heatmap-tooltip"
          style={{ left: tip.x, top: tip.y }}
        >
          {tip.text}
        </div>,
        document.body,
      )}
    </div>
  );
};

/* ── Legend strip ─── */
const HeatmapLegend: React.FC<{ themed: boolean }> = ({ themed }) => {
  const { t } = useTranslation();
  const levels: CellLevel[] = ['l0', 'l1', 'l2', 'l3', 'l4'];
  const themeClass = themed ? 'heatmap-calendar--themed' : '';

  return (
    <div className="heatmap-legend">
      <span className="heatmap-legend-label">{t('common.less', 'Less')}</span>

      {levels.map((level) => (
        <div
          key={level}
          className={`heatmap-cell ${LEVEL_CLASSES[level]} heatmap-legend-cell ${themeClass}`}
          style={{ width: 14, height: 14, aspectRatio: 'auto' }}
        />
      ))}

      <span className="heatmap-legend-label">{t('common.more', 'More')}</span>

      <span className="heatmap-legend-miss">
        <div
          className={`heatmap-cell heatmap-cell--miss heatmap-legend-cell ${themeClass}`}
          style={{ width: 14, height: 14, aspectRatio: 'auto' }}
        />
        {t('common.missed', 'Perdido')}
      </span>
    </div>
  );
};
