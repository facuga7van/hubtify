import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAnimatedNavigate } from '../../../shared/components/AnimatedOutlet';
import { useToast } from '../../../shared/components/useToast';
import { useConfirm } from '../../../shared/components/ConfirmDialog';
import {
  playCauldronPause,
  playCauldronResume,
  playCauldronWarning,
  playCauldronCycleEnd,
} from '../../../shared/audio';
import { Rune } from '../../../shared/components/codex/CodexPrimitives';
import { PlayIcon, PauseIcon, StopIcon, CrossMark, PopOutIcon, SkipForwardIcon } from '../../../shared/components/icons/CodexIcons';
import type { CauldronTimerState, CauldronSessionEndResult } from '../../../../shared/types';
import { formatTime } from '../utils';

export default function CauldronFloatingTimer() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const confirm = useConfirm();
  const animatedNavigate = useAnimatedNavigate();
  const [timerState, setTimerState] = useState<CauldronTimerState | null>(null);
  const [hidden, setHidden] = useState(false);
  const warningFiredRef = useRef(false);
  /** The external PiP window owns the audio while it is open. */
  const externalWindowOpenRef = useRef(false);

  const loadState = useCallback(() => {
    window.api.cauldronGetState().then((s) => setTimerState(s));
  }, []);

  useEffect(() => {
    loadState();
  }, [loadState]);

  // Subscribe to tick events. Sounds live HERE and nowhere else in the app
  // shell: working in Questify with the external window closed, this is the
  // only cauldron surface still mounted, so it is the only one that can promise
  // the session never ends in silence.
  useEffect(() => {
    const cleanup = window.api.onCauldronTick((state) => {
      setTimerState(state);
      if (state.remainingMs <= 10000 && !warningFiredRef.current) {
        warningFiredRef.current = true;
        // Ten-second heads-up — deliberately a different sound from the one that
        // marks a segment actually ending.
        if (!externalWindowOpenRef.current) playCauldronWarning();
      }
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
      warningFiredRef.current = false;
      const muted = externalWindowOpenRef.current;

      // An extension is a prolongation of an already-rewarded cycle. The backend
      // excludes it from every statistic; paying XP for it would be paying twice.
      const isRealPomodoro = result.sessionType === 'work' && result.completed && !result.isExtension;

      if (!muted) {
        if (result.completed && result.nextType === null) {
          playCauldronCycleEnd();
        } else if (result.completed) {
          // Segment boundary — distinct from the 10 s warning above.
          playCauldronPause();
        }
      }

      if (isRealPomodoro) {
        window.api
          .processRpgEvent({
            type: 'POMODORO_COMPLETED',
            moduleId: 'cauldron',
            payload: { xp: 8, hp: 0 },
            timestamp: Date.now(),
          })
          .then((rpgResult) => {
            // The RPG engine applies a combo multiplier and a random bonus, so
            // the awarded amount is never a flat 8 — show what was actually paid.
            toast({ type: 'xp', message: `+${rpgResult.xpGained} XP` });
            window.dispatchEvent(new Event('rpg:statsChanged'));
            window.dispatchEvent(new Event('cauldron:dataChanged'));
          });
      }
      loadState();
    });
    return cleanup;
  }, [loadState, toast]);

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

  // Follow the external window in BOTH directions. It only listened for "closed",
  // so starting a brew left the page controls, this chip and the PiP window all
  // on screen at once.
  useEffect(() => {
    const onOpened = window.api.onCauldronWindowOpened(() => {
      externalWindowOpenRef.current = true;
      setHidden(true);
    });
    const onClosed = window.api.onCauldronWindowClosed(() => {
      externalWindowOpenRef.current = false;
      setHidden(false);
    });
    return () => { onOpened(); onClosed(); };
  }, []);

  // Broadcast hidden state for sidebar indicator.
  // Depends on a derived boolean: keyed on `timerState` this fired a CustomEvent
  // the sidebar had to process once per second, forever.
  const isTimerActive = !!timerState && timerState.status !== 'idle';
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('cauldron:floating-visibility', {
        detail: { hidden, active: isTimerActive },
      }),
    );
  }, [hidden, isTimerActive]);

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

  const handleSkip = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await window.api.cauldronSkip();
  };

  const handleStop = async (e: React.MouseEvent) => {
    e.stopPropagation();
    // A 24 px button next to Pause used to end a 22-minute session on one
    // mis-click. Same confirmation as the Cauldron page.
    const confirmed = await confirm({
      message: t('cauldron.stopConfirm', '¿Detener la sesión? Se perderá el progreso actual.'),
      confirmText: t('cauldron.stop', 'Detener'),
      danger: true,
    });
    if (!confirmed) return;
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
              className="cauldron-ft-btn"
              onClick={handleSkip}
              title={t('cauldron.skip', 'Skip')}
              aria-label={t('cauldron.skip', 'Skip')}
            >
              <SkipForwardIcon width={12} height={12} />
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
