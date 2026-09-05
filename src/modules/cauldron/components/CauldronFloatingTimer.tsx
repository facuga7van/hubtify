import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { isNativeMobile } from '../../../shared/platform-detect';
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
import type { CauldronSessionEndResult } from '../../../../shared/types';
import {
  autoStartSecondsLeft,
  UNLABELED_POTION_COLOR,
  type CauldronTimerStateEx,
  type CauldronSessionEndResultEx,
} from '../types';
import { cancelAutoStart } from '../api';
import { emitLapCompleted, emitPomodoroExtended } from '../rpg-events';
import { formatTime } from '../utils';

export default function CauldronFloatingTimer() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const confirm = useConfirm();
  const animatedNavigate = useAnimatedNavigate();
  const { pathname } = useLocation();
  const onCauldronPage = pathname === '/cauldron' || pathname.startsWith('/cauldron/');
  const [timerState, setTimerState] = useState<CauldronTimerStateEx | null>(null);
  const [hidden, setHidden] = useState(false);
  const warningFiredRef = useRef(false);
  /** True while the last broadcast had an auto-start armed — see the tick handler. */
  const autoStartArmedRef = useRef(false);
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
    const cleanup = window.api.onCauldronTick((next) => {
      const state = next as CauldronTimerStateEx;
      const wasArmed = autoStartArmedRef.current;
      const isArmed = state.status === 'awaiting_next' && state.autoStartAt != null;
      autoStartArmedRef.current = isArmed;

      // The countdown just expired and the next segment started by itself. It gets
      // a quiet cue on purpose: nobody wants the full "start brew" fanfare from an
      // empty room.
      if (wasArmed && !isArmed && (state.status === 'work' || state.status === 'on_break')) {
        if (!externalWindowOpenRef.current) playCauldronResume();
      }

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
    const cleanup = window.api.onCauldronSessionEnd((raw: CauldronSessionEndResult) => {
      const result = raw as CauldronSessionEndResultEx;
      warningFiredRef.current = false;
      const muted = externalWindowOpenRef.current;

      // An extension is a prolongation of an already-rewarded cycle. The backend
      // excludes it from every statistic; paying XP for it would be paying twice.
      const isRealPomodoro = result.sessionType === 'work' && result.completed && !result.isExtension;

      if (!muted) {
        // The loop keeps going past the long break now, so "a lap just closed" is
        // an explicit flag instead of "there is nothing next".
        if (result.completed && (result.cycleComplete || result.nextType === null)) {
          playCauldronCycleEnd();
        } else if (result.completed) {
          // Segment boundary — distinct from the 10 s warning above.
          playCauldronPause();
        }
      }

      // Registro (xp 0) de la vuelta cerrada; mismo punto único que los otros dos.
      void emitLapCompleted(result);

      if (isRealPomodoro) {
        window.api
          .processRpgEvent({
            type: 'POMODORO_COMPLETED',
            moduleId: 'cauldron',
            payload: { xp: 8, hp: 0, taskId: result.taskId ?? null },
            timestamp: Date.now(),
          })
          .then((rpgResult) => {
            // The RPG engine applies a combo multiplier and a random bonus, so
            // the awarded amount is never a flat 8 — show what was actually paid.
            toast({ type: 'xp', message: `+${rpgResult.xpGained} XP` });
            window.dispatchEvent(new Event('rpg:statsChanged'));
            window.dispatchEvent(new Event('cauldron:dataChanged'));
          });
      } else if (result.abandoned) {
        // Un enfoque cortado a mano pasado el umbral. El evento paga CERO: la
        // pérdida es simbólica y legible — el frasco roto que quedó en el
        // estante —, jamás numérica. Esto solo lo deja REGISTRADO.
        //
        // Se emite desde acá y solo desde acá: este componente se monta una vez
        // por ventana principal (la PiP renderiza CauldronFloatingWindow en su
        // lugar), así que un `stop` no puede pagar el evento dos veces. Es el
        // mismo punto único desde el que sale POMODORO_COMPLETED.
        window.api
          .processRpgEvent({
            type: 'POMODORO_ABANDONED',
            moduleId: 'cauldron',
            payload: { xp: 0, hp: 0, elapsedMinutes: result.elapsedMinutes ?? 0, taskId: result.taskId ?? null },
            timestamp: Date.now(),
          })
          .then(() => {
            // Sin toast de XP: no hubo XP. El aviso es el frasco roto, y una
            // línea sobria que dice hasta dónde llegó.
            toast({
              type: 'info',
              message: t('cauldron.abandoned.toast', 'Poción rota — {{minutes}} min quedaron en el estante', {
                minutes: result.elapsedMinutes ?? 0,
              }),
            });
            window.dispatchEvent(new Event('cauldron:dataChanged'));
          })
          .catch(() => { /* el frasco roto ya está en la base; el evento es registro */ });
      }
      loadState();
    });
    return cleanup;
  }, [loadState, toast, t]);

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
  // En el teléfono el chip va de borde a borde: sobre la propia página del
  // Caldero tapaba las stat cards y duplicaba los controles (CAU-01). En
  // escritorio se queda: la página lo deja ver a un costado.
  if (isNativeMobile() && onCauldronPage) return null;

  const isRunning = timerState.status === 'work' || timerState.status === 'on_break';
  const isPaused = timerState.status === 'work_paused' || timerState.status === 'break_paused';
  const isAwaiting = timerState.status === 'awaiting_next';
  const autoSeconds = autoStartSecondsLeft(timerState);
  const isAutoStarting = autoSeconds !== null;
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

  /** «Esperá» — disarms the auto-start, back to waiting for an explicit Continue. */
  const handleWait = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await cancelAutoStart();
  };

  const extMin = timerState.extensionMinutes ?? 5;

  const handleExtend = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await window.api.cauldronExtend(extMin);
    void emitPomodoroExtended(timerState.sessionType, extMin, timerState.taskId);
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
    await window.api.cauldronOpenWindow?.();
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
      <span className="cauldron-ft-time">
        {isAutoStarting ? `${autoSeconds}s` : isAwaiting ? '00:00' : formatTime(timerState.remainingMs)}
      </span>
      {/* La misión vinculada, si la hay: el chip refleja el broadcast, no
          consulta nada. Cambiarla se hace en la página — acá no entra un
          popover de 24 px de alto. */}
      {timerState.taskId && (
        <span className="cauldron-ft-mission" title={timerState.taskName ?? undefined}>
          <span
            className="cauldron-mission-swatch"
            style={{ background: timerState.taskProjectColor ?? UNLABELED_POTION_COLOR }}
            aria-hidden="true"
          />
          {timerState.taskName ?? t('cauldron.shelf.unlabeled', 'sin etiqueta')}
        </span>
      )}
      <div className="cauldron-ft-controls">
        {isAutoStarting && (
          <button
            className="cauldron-ft-btn cauldron-ft-btn--wait"
            onClick={handleWait}
            title={t(
              'cauldron.autoStart.waitHelp',
              'Cancela el arranque automático: el siguiente segmento espera a que le des Continuar.',
            )}
            aria-label={t('cauldron.autoStart.wait', 'Esperá')}
          >
            <PauseIcon width={12} height={12} />
          </button>
        )}
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
        {/* La ventana flotante es una BrowserWindow de Electron: en Android no existe. */}
        {!isNativeMobile() && (
          <button
            className="cauldron-ft-btn cauldron-ft-btn--popout"
            onClick={handlePopOut}
            title={t('cauldron.popOut', 'Floating window')}
            aria-label={t('cauldron.popOut', 'Floating window')}
          >
            <PopOutIcon width={12} height={12} />
          </button>
        )}
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
