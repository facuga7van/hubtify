import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAnimatedNavigate } from '../../../shared/components/AnimatedOutlet';
import { playCauldronPause, playCauldronResume } from '../../../shared/audio';
import { Rune } from '../../../shared/components/codex/CodexPrimitives';
import type { CauldronTimerState } from '../../../../shared/types';

function formatTime(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export default function CauldronFloatingTimer() {
  const { t } = useTranslation();
  const animatedNavigate = useAnimatedNavigate();
  const [timerState, setTimerState] = useState<CauldronTimerState | null>(null);

  const loadState = useCallback(() => {
    window.api.cauldronGetState().then((s) => setTimerState(s));
  }, []);

  useEffect(() => {
    loadState();
  }, [loadState]);

  // Subscribe to tick events
  useEffect(() => {
    const cleanup = window.api.onCauldronTick((state) => {
      setTimerState(state);
    });
    return cleanup;
  }, []);

  // Account switch reload
  useEffect(() => {
    const handler = () => loadState();
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
  }, [loadState]);

  // Hide when session ends (goes back to idle)
  useEffect(() => {
    const cleanup = window.api.onCauldronSessionEnd(() => {
      loadState();
    });
    return cleanup;
  }, [loadState]);

  if (!timerState || timerState.status === 'idle') return null;

  const isRunning = timerState.status === 'work' || timerState.status === 'on_break';
  const isPaused = timerState.status === 'work_paused' || timerState.status === 'break_paused';
  const sessionTypeClass =
    timerState.sessionType === 'work'
      ? 'work'
      : timerState.sessionType === 'long_break'
        ? 'long-break'
        : 'break';

  const progress =
    timerState.totalMs > 0
      ? ((timerState.totalMs - timerState.remainingMs) / timerState.totalMs) * 100
      : 0;

  const runeTone: 'rubric' | 'sage' | 'gold' =
    timerState.sessionType === 'work'
      ? 'rubric'
      : timerState.sessionType === 'long_break'
        ? 'gold'
        : 'sage';

  const segmentLabel =
    timerState.sessionType === 'work'
      ? t('cauldron.work', 'Focus')
      : timerState.sessionType === 'long_break'
        ? t('cauldron.longBreak', 'Long Break')
        : t('cauldron.break', 'Break');

  const handlePauseResume = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isRunning) {
      await window.api.cauldronPause();
      playCauldronPause();
    } else if (isPaused) {
      await window.api.cauldronResume();
      playCauldronResume();
    }
  };

  const handleNavigate = () => {
    animatedNavigate('/cauldron');
  };

  return (
    <div
      className={`cauldron-floating-timer ${sessionTypeClass} ${isRunning ? 'active' : ''}`}
      onClick={handleNavigate}
      role="button"
      aria-label={t('cauldron.openCauldron', 'Open Cauldron')}
    >
      <Rune tone={runeTone}>{segmentLabel}</Rune>
      <span className="cauldron-ft-time">{formatTime(timerState.remainingMs)}</span>
      <button
        className="cauldron-ft-btn"
        onClick={handlePauseResume}
        title={isRunning ? t('cauldron.pause', 'Pause') : t('cauldron.resume', 'Resume')}
        aria-label={isRunning ? t('cauldron.pause', 'Pause') : t('cauldron.resume', 'Resume')}
      >
        {isRunning ? '\u23F8' : '\u25B6'}
      </button>
      <div className="cauldron-ft-bar">
        <span style={{ width: `${progress.toFixed(1)}%` }} />
      </div>
    </div>
  );
}
