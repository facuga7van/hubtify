import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  CauldronStats,
  CauldronTimerState,
  CauldronPreset,
} from '../../../../shared/types';
import { statsShimmer } from '../../../shared/animations/cauldron';

export default function CauldronDashboardWidget() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<CauldronStats>({ today: 0, week: 0, total: 0 });
  const [timerState, setTimerState] = useState<CauldronTimerState | null>(null);
  const countRef = useRef<HTMLSpanElement>(null);
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
  const remainingSeconds = timerState ? Math.ceil(timerState.remainingMs / 1000) : 0;
  const mins = Math.floor(remainingSeconds / 60);
  const secs = remainingSeconds % 60;

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
    <div className="cauldron-widget">
      <div className="cauldron-widget-count">
        <span className="cauldron-widget-icon">🧪</span>
        <span ref={countRef}>{stats.today}</span>
      </div>
      <div className="cauldron-widget-label">{t('cauldron.stats.today', 'brews today')}</div>
      {isActive && (
        <div className="cauldron-widget-active">
          {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
        </div>
      )}
      {!isActive && (
        <button
          className="rpg-button"
          onClick={handleQuickStart}
          style={{ marginTop: 8, fontSize: '0.8rem' }}
        >
          {t('cauldron.startBrew', 'Start Brew')}
        </button>
      )}
    </div>
  );
}
