import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAnimatedNavigate } from '../../../shared/components/AnimatedOutlet';
import { playCauldronPause } from '../../../shared/audio';
import type { CauldronTimerState } from '../../../../shared/types';

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

  const remainingSeconds = Math.ceil(timerState.remainingMs / 1000);
  const mins = Math.floor(remainingSeconds / 60);
  const secs = remainingSeconds % 60;
  const timeDisplay = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  const isRunning = timerState.status === 'work' || timerState.status === 'on_break';
  const isPaused = timerState.status === 'work_paused' || timerState.status === 'break_paused';
  const sessionTypeClass =
    timerState.sessionType === 'work'
      ? 'work'
      : timerState.sessionType === 'long_break'
        ? 'long-break'
        : 'break';

  const progress = timerState.totalMs > 0 ? (1 - timerState.remainingMs / timerState.totalMs) : 0;

  const segmentLabel =
    timerState.sessionType === 'work'
      ? t('cauldron.work', 'Focus')
      : timerState.sessionType === 'long_break'
        ? t('cauldron.longBreak', 'Long Break')
        : t('cauldron.break', 'Break');

  const handlePauseResume = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isRunning) await window.api.cauldronPause();
    else if (isPaused) await window.api.cauldronResume();
    playCauldronPause();
  };

  const handleSkip = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await window.api.cauldronSkip();
  };

  const handleNavigate = () => {
    animatedNavigate('/cauldron');
  };

  return (
    <div className={`cauldron-floating-timer ${sessionTypeClass} active`} onClick={handleNavigate}>
      <span className="cauldron-floating-label">{segmentLabel}</span>
      <span className="cauldron-floating-time">{timeDisplay}</span>
      <button
        className="cauldron-floating-btn"
        onClick={handlePauseResume}
        title={isRunning ? t('cauldron.pause', 'Pause') : t('cauldron.resume', 'Resume')}
      >
        {isRunning ? '\u23F8' : '\u25B6'}
      </button>
      <button
        className="cauldron-floating-btn"
        onClick={handleSkip}
        title={t('cauldron.skip', 'Skip')}
      >
        {'\u23ED'}
      </button>
      <div
        className={`cauldron-floating-progress ${sessionTypeClass}`}
        style={{ width: `${progress * 100}%` }}
      />
    </div>
  );
}
