import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAnimatedNavigate } from '../../../shared/components/AnimatedOutlet';
import { playCauldronPause, playCauldronResume } from '../../../shared/audio';
import { Rune } from '../../../shared/components/codex/CodexPrimitives';
import { PlayIcon, PauseIcon, StopIcon, CrossMark, PopOutIcon, SkipForwardIcon } from '../../../shared/components/icons/CodexIcons';
import type { CauldronTimerState, CauldronSessionEndResult } from '../../../../shared/types';
import { formatTime } from '../utils';

export default function CauldronFloatingTimer() {
  const { t } = useTranslation();
  const animatedNavigate = useAnimatedNavigate();
  const [timerState, setTimerState] = useState<CauldronTimerState | null>(null);
  const [hidden, setHidden] = useState(false);

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

  // Session end — grant XP for completed work sessions (this component is always mounted)
  useEffect(() => {
    const cleanup = window.api.onCauldronSessionEnd((result: CauldronSessionEndResult) => {
      if (result.sessionType === 'work' && result.completed) {
        window.api
          .processRpgEvent({
            type: 'POMODORO_COMPLETED',
            moduleId: 'cauldron',
            payload: { xp: 8, hp: 0 },
            timestamp: Date.now(),
          })
          .then(() => {
            window.dispatchEvent(new Event('rpg:statsChanged'));
            window.dispatchEvent(new Event('cauldron:dataChanged'));
          });
      }
      loadState();
    });
    return cleanup;
  }, [loadState]);

  // Reset hidden when timer goes idle
  useEffect(() => {
    if (!timerState || timerState.status === 'idle') {
      setHidden(false);
    }
  }, [timerState]);

  // Listen for toggle event from sidebar
  useEffect(() => {
    const handler = () => setHidden(false);
    window.addEventListener('cauldron:show-floating', handler);
    return () => window.removeEventListener('cauldron:show-floating', handler);
  }, []);

  // Re-show in-app timer when external window is closed
  useEffect(() => {
    const cleanup = window.api.onCauldronWindowClosed(() => {
      setHidden(false);
    });
    return cleanup;
  }, []);

  // Broadcast hidden state for sidebar indicator
  useEffect(() => {
    const isActive = !!timerState && timerState.status !== 'idle';
    window.dispatchEvent(
      new CustomEvent('cauldron:floating-visibility', {
        detail: { hidden, active: isActive },
      }),
    );
  }, [hidden, timerState]);

  if (!timerState || timerState.status === 'idle') return null;
  if (hidden) return null;

  const isRunning = timerState.status === 'work' || timerState.status === 'on_break';
  const isPaused = timerState.status === 'work_paused' || timerState.status === 'break_paused';
  const isAwaiting = timerState.status === 'awaiting_next';
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

  const handleConfirmNext = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await window.api.cauldronConfirmNext();
  };

  const extMin = timerState.extensionMinutes ?? 5;

  const handleExtend = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await window.api.cauldronExtend(extMin);
  };

  const handleStop = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await window.api.cauldronStop();
  };

  const handleHide = (e: React.MouseEvent) => {
    e.stopPropagation();
    setHidden(true);
  };

  const handlePopOut = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await window.api.cauldronOpenWindow();
    setHidden(true);
  };

  const handleNavigate = () => {
    animatedNavigate('/cauldron');
  };

  return (
    <div
      className={`cauldron-floating-timer ${sessionTypeClass} ${isRunning ? 'active' : ''} ${isPaused ? 'paused' : ''} ${isAwaiting ? 'awaiting' : ''}`}
      onClick={handleNavigate}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleNavigate(); } }}
      role="button"
      tabIndex={0}
      aria-label={t('cauldron.openCauldron', 'Open Cauldron')}
    >
      <Rune tone={runeTone}>{isAwaiting ? t('cauldron.segmentDone', '¡Tiempo!') : isPaused ? t('cauldron.paused', 'Pausado') : segmentLabel}</Rune>
      <span className="cauldron-ft-time">{isAwaiting ? '00:00' : formatTime(timerState.remainingMs)}</span>
      <div className="cauldron-ft-controls">
        {isAwaiting ? (
          <>
            <button
              className="cauldron-ft-btn cauldron-ft-btn--confirm"
              onClick={handleConfirmNext}
              title={t('cauldron.confirmNext', 'Continuar')}
              aria-label={t('cauldron.confirmNext', 'Continuar')}
            >
              <SkipForwardIcon width={12} height={12} />
            </button>
            <button
              className="cauldron-ft-btn"
              onClick={handleExtend}
              title={t('cauldron.extend', '+{{min}} min', { min: extMin })}
              aria-label={t('cauldron.extend', '+{{min}} min', { min: extMin })}
            >
              <span style={{ fontSize: 9, fontWeight: 700 }}>+{extMin}</span>
            </button>
            <button
              className="cauldron-ft-btn cauldron-ft-btn--stop"
              onClick={handleStop}
              title={t('cauldron.stop', 'Stop')}
              aria-label={t('cauldron.stop', 'Stop')}
            >
              <StopIcon width={12} height={12} />
            </button>
          </>
        ) : (
          <>
            <button
              className="cauldron-ft-btn"
              onClick={handlePauseResume}
              title={isRunning ? t('cauldron.pause', 'Pause') : t('cauldron.resume', 'Resume')}
              aria-label={isRunning ? t('cauldron.pause', 'Pause') : t('cauldron.resume', 'Resume')}
            >
              {isRunning ? <PauseIcon width={12} height={12} /> : <PlayIcon width={12} height={12} />}
            </button>
            <button
              className="cauldron-ft-btn cauldron-ft-btn--stop"
              onClick={handleStop}
              title={t('cauldron.stop', 'Stop')}
              aria-label={t('cauldron.stop', 'Stop')}
            >
              <StopIcon width={12} height={12} />
            </button>
          </>
        )}
        <button
          className="cauldron-ft-btn cauldron-ft-btn--popout"
          onClick={handlePopOut}
          title={t('cauldron.popOut', 'Floating window')}
          aria-label={t('cauldron.popOut', 'Floating window')}
        >
          <PopOutIcon width={12} height={12} />
        </button>
        <button
          className="cauldron-ft-btn cauldron-ft-btn--hide"
          onClick={handleHide}
          title={t('cauldron.hideTimer', 'Hide timer')}
          aria-label={t('cauldron.hideTimer', 'Hide timer')}
        >
          <CrossMark width={12} height={12} />
        </button>
      </div>
      <div className="cauldron-ft-bar">
        <span style={{ width: `${progress.toFixed(1)}%` }} />
      </div>
    </div>
  );
}
