import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Rune } from '../../../shared/components/codex';
import type {
  CauldronStats,
  CauldronTimerState,
  CauldronPreset,
} from '../../../../shared/types';
import { statsShimmer } from '../../../shared/animations/cauldron';

function formatTime(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function getSessionLabel(sessionType: string, t: (key: string, fallback: string) => string): string {
  switch (sessionType) {
    case 'work':
      return t('cauldron.brewing', 'Brewing');
    case 'break':
      return t('cauldron.break', 'Break');
    case 'long_break':
      return t('cauldron.grandRest', 'Grand Rest');
    default:
      return '';
  }
}

/* ── Cauldron glyph SVG ───────────────────────────────────── */

function CauldronGlyph() {
  return (
    <svg
      width="62"
      height="62"
      viewBox="0 0 62 62"
      fill="none"
      stroke="var(--ink)"
      strokeWidth="1.1"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* bubbles */}
      <path d="M20 12 Q 22 8 24 12" stroke="var(--rubric)" opacity=".7" />
      <path d="M30 8 Q 32 4 34 8" stroke="var(--rubric)" opacity=".6" />
      <path d="M40 14 Q 42 10 44 14" stroke="var(--rubric)" opacity=".7" />
      {/* cauldron */}
      <path d="M10 28 H52 L50 48 Q 50 54 31 54 Q 12 54 12 48 Z" />
      <ellipse cx="31" cy="28" rx="22" ry="4" />
      <path d="M8 30 Q 6 34 10 38 M54 30 Q 56 34 52 38" />
      {/* stand */}
      <path d="M16 54 L14 60 M46 54 L48 60" />
      {/* flames */}
      <path d="M22 60 Q 24 54 27 60 Q 30 54 33 60 Q 36 54 39 60" stroke="var(--rubric)" />
    </svg>
  );
}

export default function CauldronDashboardWidget() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<CauldronStats>({ today: 0, week: 0, total: 0 });
  const [timerState, setTimerState] = useState<CauldronTimerState | null>(null);
  const countRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);

  const loadStats = useCallback(() => {
    window.api.cauldronGetStats().then((s) => setStats(s));
  }, []);

  const loadState = useCallback(() => {
    window.api.cauldronGetState().then((s) => setTimerState(s));
  }, []);

  useEffect(() => {
    loadStats();
    loadState();
  }, [loadStats, loadState]);

  // Reload data when account is switched
  useEffect(() => {
    const handler = () => {
      loadStats();
      loadState();
    };
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
  }, [loadStats, loadState]);

  // Subscribe to tick events
  useEffect(() => {
    const cleanup = window.api.onCauldronTick((state) => {
      setTimerState(state);
    });
    return cleanup;
  }, []);

  // Subscribe to session end events
  useEffect(() => {
    const cleanup = window.api.onCauldronSessionEnd(() => {
      loadStats();
    });
    return cleanup;
  }, [loadStats]);

  // Trigger shimmer when today's count increases
  useEffect(() => {
    if (stats.today > prevCountRef.current && countRef.current) {
      statsShimmer(countRef.current);
    }
    prevCountRef.current = stats.today;
  }, [stats.today]);

  const isActive = timerState && timerState.status !== 'idle';

  const handleQuickStart = async () => {
    try {
      const presets = (await window.api.cauldronGetPresets()) as CauldronPreset[];
      if (presets.length > 0) {
        await window.api.cauldronStart(presets[0].id);
      }
    } catch {
      /* already active */
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '6px 0 10px' }}>
        <CauldronGlyph />
        <div ref={countRef}>
          {isActive && timerState ? (
            <>
              <div className="qb-numeral" style={{ fontSize: 'var(--fs-hero)', lineHeight: 1 }}>
                {formatTime(timerState.remainingMs)}
              </div>
              <div className="qb-small-caps" style={{ marginTop: 4 }}>
                {getSessionLabel(timerState.sessionType, t)}
              </div>
              <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                <Rune tone="rubric">
                  {t('cauldron.cycle', 'Cycle {{current}} of {{total}}', {
                    current: timerState.currentCycle,
                    total: timerState.totalCycles,
                  })}
                </Rune>
                {(timerState.status === 'work_paused' || timerState.status === 'break_paused') && <Rune>{t('cauldron.paused', 'Pausado')}</Rune>}
              </div>
            </>
          ) : (
            <>
              <div className="qb-numeral" style={{ fontSize: 'var(--fs-hero)', lineHeight: 1 }}>
                {stats.today}
              </div>
              <div className="qb-small-caps" style={{ marginTop: 4 }}>
                {t('cauldron.stats.todaySub', 'brews today')}
              </div>
              <div style={{ marginTop: 6 }}>
                <button
                  className="rpg-button"
                  onClick={(e) => { e.stopPropagation(); handleQuickStart(); }}
                  style={{ fontSize: 'var(--fs-label)', padding: '4px 10px' }}
                >
                  {t('cauldron.startBrew', 'Quick Brew')}
                </button>
              </div>
            </>
          )}
        </div>
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
          {stats.today === 0
            ? t('cauldron.atRest', 'Caldero en reposo')
            : t('cauldron.brewsMade', '{{count}} pócima{{s}} hoy', { count: stats.today, s: stats.today > 1 ? 's' : '' })}
        </span>
        {isActive ? (
          <Rune tone="sage">{t('cauldron.inForge', 'En fragua')}</Rune>
        ) : (
          <Rune>{t('cauldron.weekCount', '{{count}} esta semana', { count: stats.week })}</Rune>
        )}
      </div>
    </div>
  );
}
