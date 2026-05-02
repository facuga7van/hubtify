import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { PlayIcon, PauseIcon, StopIcon, SkipForwardIcon } from '../../../shared/components/icons/CodexIcons';
import {
  playCauldronPause,
  playCauldronResume,
  playCauldronWarning,
  playCauldronCycleEnd,
} from '../../../shared/audio';
import type { CauldronTimerState, CauldronSessionEndResult } from '../../../../shared/types';
import { formatTime } from '../utils';
import '../styles/cauldron-window.css';

export default function CauldronFloatingWindow() {
  const { t } = useTranslation();
  const [timerState, setTimerState] = useState<CauldronTimerState | null>(null);
  const warningFiredRef = useRef(false);

  const loadState = useCallback(() => {
    window.api.cauldronGetState().then((s) => setTimerState(s));
  }, []);

  useEffect(() => {
    loadState();
  }, [loadState]);

  // Tick events — with 10s warning sound
  useEffect(() => {
    const cleanup = window.api.onCauldronTick((state) => {
      setTimerState(state);
      if (state.remainingMs <= 10000 && !warningFiredRef.current) {
        warningFiredRef.current = true;
        playCauldronWarning();
      }
    });
    return cleanup;
  }, []);

  // Session end — play sounds + reset warning ref
  useEffect(() => {
    const cleanup = window.api.onCauldronSessionEnd((result: CauldronSessionEndResult) => {
      warningFiredRef.current = false;

      if (result.sessionType === 'work' && result.completed) {
        if (result.nextType === null) {
          playCauldronCycleEnd();
        } else {
          playCauldronWarning();
        }
      } else if (result.sessionType !== 'work' && result.completed) {
        playCauldronWarning();
      }

      loadState();
    });
    return cleanup;
  }, [loadState]);

  // Auto-close window when timer goes idle
  useEffect(() => {
    if (timerState && timerState.status === 'idle') {
      window.api.cauldronCloseWindow();
    }
  }, [timerState]);

  if (!timerState || timerState.status === 'idle') {
    return <div className="cfw" />;
  }

  const isRunning = timerState.status === 'work' || timerState.status === 'on_break';
  const isPaused = timerState.status === 'work_paused' || timerState.status === 'break_paused';
  const isAwaiting = timerState.status === 'awaiting_next';

  const phaseClass =
    timerState.sessionType === 'work'
      ? 'cfw--work'
      : timerState.sessionType === 'long_break'
        ? 'cfw--long-break'
        : 'cfw--break';

  const progress =
    timerState.totalMs > 0
      ? ((timerState.totalMs - timerState.remainingMs) / timerState.totalMs) * 100
      : 0;

  const segmentLabel =
    timerState.sessionType === 'work'
      ? t('cauldron.work', 'Focus')
      : timerState.sessionType === 'long_break'
        ? t('cauldron.longBreak', 'Long Break')
        : t('cauldron.break', 'Break');

  const handlePauseResume = async () => {
    if (isRunning) {
      await window.api.cauldronPause();
      playCauldronPause();
    } else if (isPaused) {
      await window.api.cauldronResume();
      playCauldronResume();
    }
  };

  const handleSkip = async () => {
    await window.api.cauldronSkip();
  };

  const handleConfirmNext = async () => {
    await window.api.cauldronConfirmNext();
  };

  const extMin = timerState.extensionMinutes ?? 5;

  const handleExtend = async () => {
    await window.api.cauldronExtend(extMin);
  };

  const handleStop = async () => {
    await window.api.cauldronStop();
  };

  const handleClose = () => {
    window.api.cauldronCloseWindow();
  };

  return (
    <div className={`cfw ${phaseClass} ${isRunning ? 'cfw--active' : ''} ${isPaused ? 'cfw--paused' : ''} ${isAwaiting ? 'cfw--awaiting' : ''}`}>
      <div className="cfw__drag" />
      <div className="cfw__info">
        <div className="cfw__top">
          <span className="cfw__label">{isAwaiting ? t('cauldron.segmentDone', '¡Tiempo!') : isPaused ? t('cauldron.paused', 'Pausado') : segmentLabel}</span>
          {timerState.presetName && (
            <span className="cfw__preset">{timerState.presetName}</span>
          )}
        </div>
        <div className="cfw__bottom">
          <span className="cfw__time">{formatTime(timerState.remainingMs)}</span>
          <span className="cfw__cycle">
            {t('cauldron.cycle', 'Cycle {{current}} of {{total}}', {
              current: timerState.currentCycle,
              total: timerState.totalCycles,
            })}
          </span>
        </div>
      </div>
      <div className="cfw__controls">
        {isAwaiting ? (
          <>
            <button
              className="cfw__btn cfw__btn--confirm"
              onClick={handleConfirmNext}
              aria-label={t('cauldron.confirmNext', 'Continuar')}
              title={t('cauldron.confirmNext', 'Continuar')}
            >
              <SkipForwardIcon width={14} height={14} />
            </button>
            <button
              className="cfw__btn"
              onClick={handleExtend}
              aria-label={t('cauldron.extend', '+{{min}} min', { min: extMin })}
              title={t('cauldron.extend', '+{{min}} min', { min: extMin })}
            >
              <span className="cfw__extend-label">+{extMin}</span>
            </button>
            <button
              className="cfw__btn cfw__btn--stop"
              onClick={handleStop}
              aria-label={t('cauldron.stop', 'Stop')}
              title={t('cauldron.stop', 'Stop')}
            >
              <StopIcon width={14} height={14} />
            </button>
          </>
        ) : (
          <>
            <button
              className="cfw__btn"
              onClick={handlePauseResume}
              aria-label={isRunning ? t('cauldron.pause', 'Pause') : t('cauldron.resume', 'Resume')}
              title={isRunning ? t('cauldron.pause', 'Pause') : t('cauldron.resume', 'Resume')}
            >
              {isRunning ? <PauseIcon width={14} height={14} /> : <PlayIcon width={14} height={14} />}
            </button>
            <button
              className="cfw__btn"
              onClick={handleSkip}
              aria-label={t('cauldron.skip', 'Skip')}
              title={t('cauldron.skip', 'Skip')}
            >
              <SkipForwardIcon width={14} height={14} />
            </button>
            <button
              className="cfw__btn cfw__btn--stop"
              onClick={handleStop}
              aria-label={t('cauldron.stop', 'Stop')}
              title={t('cauldron.stop', 'Stop')}
            >
              <StopIcon width={14} height={14} />
            </button>
          </>
        )}
      </div>
      <button
        className="cfw__close-bar"
        onClick={handleClose}
        aria-label={t('cauldron.closeWindow', 'Close window')}
        title={t('cauldron.closeWindow', 'Close window')}
      />
      <div className="cfw__bar">
        <span style={{ width: `${progress.toFixed(1)}%` }} />
      </div>
    </div>
  );
}
