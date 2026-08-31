import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { PlayIcon, PauseIcon, StopIcon, SkipForwardIcon, CrossMark } from '../../../shared/components/icons/CodexIcons';
import {
  playCauldronPause,
  playCauldronResume,
  playCauldronWarning,
  playCauldronCycleEnd,
} from '../../../shared/audio';
import type { CauldronSessionEndResult } from '../../../../shared/types';
import {
  autoStartSecondsLeft,
  UNLABELED_POTION_COLOR,
  type CauldronTimerStateEx,
  type CauldronSessionEndResultEx,
} from '../types';
import { cancelAutoStart } from '../api';
import { formatTime } from '../utils';
import '../styles/cauldron-window.css';

export default function CauldronFloatingWindow() {
  const { t } = useTranslation();
  const [timerState, setTimerState] = useState<CauldronTimerStateEx | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const warningFiredRef = useRef(false);
  /** True while the last broadcast had an auto-start armed — see the tick handler. */
  const autoStartArmedRef = useRef(false);

  const loadState = useCallback(() => {
    window.api.cauldronGetState().then((s) => setTimerState(s));
  }, []);

  useEffect(() => {
    loadState();
  }, [loadState]);

  // Tick events — with 10s warning sound
  useEffect(() => {
    const cleanup = window.api.onCauldronTick((next) => {
      const state = next as CauldronTimerStateEx;
      const wasArmed = autoStartArmedRef.current;
      const isArmed = state.status === 'awaiting_next' && state.autoStartAt != null;
      autoStartArmedRef.current = isArmed;

      // Countdown expired and the segment started on its own: a quiet cue, not the
      // full manual-start fanfare.
      if (wasArmed && !isArmed && (state.status === 'work' || state.status === 'on_break')) {
        playCauldronResume();
      }

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
    const cleanup = window.api.onCauldronSessionEnd((raw: CauldronSessionEndResult) => {
      const result = raw as CauldronSessionEndResultEx;
      warningFiredRef.current = false;

      // The 10 s heads-up already uses playCauldronWarning; a segment ending gets
      // its own cue so the two events do not sound identical. The loop runs past
      // the long break now, so a closed lap is flagged, not inferred from `null`.
      if (result.completed) {
        if (result.cycleComplete || result.nextType === null) playCauldronCycleEnd();
        else playCauldronPause();
      }

      loadState();
    });
    return cleanup;
  }, [loadState]);

  // A pending "really stop?" that the user walked away from must not stay armed.
  useEffect(() => {
    if (!confirmStop) return;
    const id = setTimeout(() => setConfirmStop(false), 4000);
    return () => clearTimeout(id);
  }, [confirmStop]);

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
  const autoSeconds = autoStartSecondsLeft(timerState);
  const isAutoStarting = autoSeconds !== null;

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

  /** «Esperá» — disarms the auto-start, back to waiting for an explicit Continue. */
  const handleWait = async () => {
    await cancelAutoStart();
  };

  const extMin = timerState.extensionMinutes ?? 5;

  const handleExtend = async () => {
    await window.api.cauldronExtend(extMin);
  };

  /**
   * Two-step stop. This window is rendered by its own React root (see main.tsx)
   * with no ConfirmProvider above it, so `useConfirm()` is not available — the
   * button turns into an explicit confirm instead of ending the session on one
   * mis-click next to Pause.
   */
  const handleStop = async () => {
    if (!confirmStop) {
      setConfirmStop(true);
      return;
    }
    setConfirmStop(false);
    await window.api.cauldronStop();
  };

  const handleClose = () => {
    window.api.cauldronCloseWindow();
  };

  return (
    <div className={`cfw ${phaseClass} ${isRunning ? 'cfw--active' : ''} ${isPaused ? 'cfw--paused' : ''} ${isAwaiting ? 'cfw--awaiting' : ''}`}>
      <div className="cfw__info">
        <div className="cfw__top">
          <span className="cfw__label">{isAwaiting ? t('cauldron.segmentDone', '¡Tiempo!') : isPaused ? t('cauldron.paused', 'Pausado') : segmentLabel}</span>
          {isAutoStarting && (
            <span className="cfw__autostart">
              {t('cauldron.autoStart.short', 'auto {{seconds}}s', { seconds: autoSeconds })}
            </span>
          )}
          {timerState.presetName && (
            <span className="cfw__preset">{timerState.presetName}</span>
          )}
        </div>
        {/* La misión vinculada. Esta ventana es de solo-mirar: se cambia en la
            página del caldero, no acá. */}
        {timerState.taskId && (
          <div className="cfw__mission" title={timerState.taskName ?? undefined}>
            <span
              className="cauldron-mission-swatch"
              style={{ background: timerState.taskProjectColor ?? UNLABELED_POTION_COLOR }}
              aria-hidden="true"
            />
            {timerState.taskName ?? t('cauldron.shelf.unlabeled', 'sin etiqueta')}
          </div>
        )}
        <div className="cfw__bottom">
          <span className="cfw__time">{formatTime(timerState.remainingMs)}</span>
          <span className="cfw__cycle">
            {t('cauldron.cycle', 'Cycle {{current}} of {{total}}', {
              current: timerState.currentCycle,
              total: timerState.totalCycles,
            })}
            {(timerState.round ?? 1) > 1 &&
              ` · ${t('cauldron.round', '{{round}}ª ronda', { round: timerState.round })}`}
          </span>
        </div>
      </div>
      <div className="cfw__controls">
        {isAutoStarting && (
          <button
            className="cfw__btn cfw__btn--wait"
            onClick={handleWait}
            aria-label={t('cauldron.autoStart.wait', 'Esperá')}
            title={t(
              'cauldron.autoStart.waitHelp',
              'Cancela el arranque automático: el siguiente segmento espera a que le des Continuar.',
            )}
          >
            <PauseIcon width={14} height={14} />
          </button>
        )}
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
              className={`cfw__btn cfw__btn--stop${confirmStop ? ' cfw__btn--confirm-stop' : ''}`}
              onClick={handleStop}
              aria-label={confirmStop ? t('cauldron.stopConfirmShort', '¿Detener?') : t('cauldron.stop', 'Stop')}
              title={confirmStop
                ? t('cauldron.stopConfirm', '¿Detener la sesión? Se perderá el progreso actual.')
                : t('cauldron.stop', 'Stop')}
            >
              {confirmStop ? t('cauldron.stopConfirmShort', '¿Detener?') : <StopIcon width={14} height={14} />}
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
              className={`cfw__btn cfw__btn--stop${confirmStop ? ' cfw__btn--confirm-stop' : ''}`}
              onClick={handleStop}
              aria-label={confirmStop ? t('cauldron.stopConfirmShort', '¿Detener?') : t('cauldron.stop', 'Stop')}
              title={confirmStop
                ? t('cauldron.stopConfirm', '¿Detener la sesión? Se perderá el progreso actual.')
                : t('cauldron.stop', 'Stop')}
            >
              {confirmStop ? t('cauldron.stopConfirmShort', '¿Detener?') : <StopIcon width={14} height={14} />}
            </button>
          </>
        )}
      </div>
      <button
        className="cfw__close-bar tap-target"
        onClick={handleClose}
        aria-label={t('cauldron.closeWindow', 'Close window')}
        title={t('cauldron.closeWindow', 'Close window')}
      >
        <CrossMark width={12} height={12} />
      </button>
      <div className="cfw__bar">
        <span style={{ width: `${progress.toFixed(1)}%` }} />
      </div>
    </div>
  );
}
