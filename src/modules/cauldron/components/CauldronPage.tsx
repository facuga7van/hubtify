import { useState, useEffect, useCallback, useRef, useMemo, useId } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../../shared/components/useToast';
import { useConfirm } from '../../../shared/components/ConfirmDialog';
import { ambientOrbs, brewComplete, statsShimmer } from '../../../shared/animations/cauldron';
import {
  playCauldronStart,
  playCauldronPause,
  playCauldronResume,
} from '../../../shared/audio';
import HelpBubble from '../../../shared/components/HelpBubble';
import { BookPage } from '../../../shared/components/codex/BookPage';
import {
  Section,
  Rune,
  Gauge,
  Cartouche,
} from '../../../shared/components/codex/CodexPrimitives';
import { Cauldron as CauldronIcon, Flame, Potion, ChevronUp, ChevronDown } from '../../../shared/components/icons/CodexIcons';
import { CastleBarChart } from '../../../shared/components/charts/CastleBarChart';
import CauldronSVG from './CauldronSVG';
import MissionPicker, { useOpenMissions } from './MissionPicker';
import PotionShelf from './PotionShelf';
import { formatTime } from '../utils';
import { useCauldronLabels, usePresetName, rememberLastPreset, POPOUT_ON_START_KEY } from '../hooks';
import {
  cancelAutoStart,
  getWeekByProject,
  isRetroLogWired,
  isTaskLinkWired,
  logPastSession,
  setSessionTask,
  startBrew,
} from '../api';
import {
  autoStartSecondsLeft,
  UNLABELED_POTION_COLOR,
  type CauldronTimerStateEx,
  type CauldronPresetEx,
  type CauldronShelfSession,
  type CauldronWeekTaskRow,
} from '../types';
// Completar la misión desde el caldero DEBE pagar exactamente lo mismo que
// tildarla en Questify: mismos XP por tier, mismo combo, mismo toast. Por eso se
// reusan los helpers de quests en vez de reimplementar la tabla acá.
import { tierXp, bonusMultiplierToTier } from '../../quests/utils';
import type {
  CauldronPreset,
  CauldronStats,
  CauldronSessionEndResult,
  CauldronWeeklyFocusDay,
  CauldronInterruptedSession,
} from '../../../../shared/types';

/* -- Flavor / ingredient array sizes (used to cycle with %) -- */

const FLAVOR_SIZES = { work: 7, break: 5, longBreak: 4, idle: 3, paused: 2 };

/* -- Inline Sub-Components ----------------------------------- */

function CyclePreviewBar({ preset }: { preset: CauldronPreset | Partial<CauldronPreset> }) {
  const cycles = preset.cyclesBeforeLong || 4;
  const segments: { type: 'work' | 'break' | 'long-break'; minutes: number }[] = [];
  for (let i = 0; i < cycles; i++) {
    segments.push({ type: 'work', minutes: preset.workMinutes || 25 });
    if (i < cycles - 1) {
      segments.push({ type: 'break', minutes: preset.breakMinutes || 5 });
    } else {
      segments.push({ type: 'long-break', minutes: preset.longBreakMinutes || 15 });
    }
  }
  const totalMinutes = segments.reduce((sum, s) => sum + s.minutes, 0);

  return (
    <div className="cauldron-cycle-preview">
      {segments.map((seg, i) => (
        <div
          key={i}
          className={`cauldron-cycle-segment ${seg.type}`}
          style={{ flex: seg.minutes / totalMinutes }}
        />
      ))}
    </div>
  );
}


/* -- Main Component ------------------------------------------ */

export default function CauldronPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const confirm = useConfirm();
  const clipId = useId();

  /* -- State -- */
  const [presets, setPresets] = useState<CauldronPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [timerState, setTimerState] = useState<CauldronTimerStateEx | null>(null);
  const [stats, setStats] = useState<CauldronStats>({ today: 0, week: 0, total: 0, streak: 0 });
  const [actionPending, setActionPending] = useState(false);
  const [editingPreset, setEditingPreset] = useState<Partial<CauldronPresetEx> | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [flavorIdx, setFlavorIdx] = useState(0);
  const [sessions, setSessions] = useState<CauldronShelfSession[]>([]);
  const [sessionsHasMore, setSessionsHasMore] = useState(false);
  const [sessionsOffset, setSessionsOffset] = useState(0);
  // Collapsed by default made the section look broken — a title with an empty body.
  const [historyOpen, setHistoryOpen] = useState(true);
  const [weeklyFocus, setWeeklyFocus] = useState<CauldronWeeklyFocusDay[]>([]);
  const [weekByProject, setWeekByProject] = useState<CauldronWeekTaskRow[]>([]);
  /**
   * La misión elegida ANTES de encender. Vive en el renderer a propósito: el
   * main no guarda una misión "pendiente" porque en `idle` no hay a qué
   * adjuntarla — y porque elegir nunca es requisito para arrancar.
   */
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  /**
   * El vínculo con Questify necesita canales que preload todavía no expone (ver
   * `api.ts`). Mientras no estén, las afordancias de misión se esconden: un
   * enlace que no hace nada es peor que ninguno.
   */
  const taskLinkWired = useMemo(() => isTaskLinkWired(), []);
  const { missions, reloadMissions } = useOpenMissions(taskLinkWired);
  /**
   * «¿Trabajaste sin el caldero?» — registrar una sesión pasada. Cuenta para el
   * registro (estante, stats), no para la recompensa: cero XP. Mientras preload
   * no exponga el canal, el enlace no se muestra (patrón `api.ts`).
   */
  const retroWired = useMemo(() => isRetroLogWired(), []);
  const [retroOpen, setRetroOpen] = useState(false);
  const [retroMinutes, setRetroMinutes] = useState('');
  const [retroTaskId, setRetroTaskId] = useState<string | null>(null);
  const [interrupted, setInterrupted] = useState<CauldronInterruptedSession | null>(null);
  const [popoutOnStart, setPopoutOnStart] = useState(() => {
    try { return localStorage.getItem(POPOUT_ON_START_KEY) === 'true'; } catch { return false; }
  });
  const presetLabel = usePresetName();

  // System notification copy comes from the renderer now — keep it in sync with i18n.
  useCauldronLabels();

  /* -- Refs -- */
  const timerContainerRef = useRef<HTMLDivElement>(null);
  const orbsTimelineRef = useRef<gsap.core.Timeline | null>(null);
  const prevTodayRef = useRef(0);
  const statsRef = useRef<HTMLDivElement>(null);

  /* -- Data loaders -- */
  const loadPresets = useCallback(() => {
    window.api.cauldronGetPresets().then((p) => {
      setPresets(p);
      setSelectedPresetId((prev) => {
        if (!prev && p.length > 0) return p[0].id;
        return prev;
      });
    });
  }, []);

  const loadStats = useCallback(() => {
    window.api.cauldronGetStats().then((s) => setStats(s));
  }, []);

  const loadState = useCallback(() => {
    window.api.cauldronGetState().then((s) => {
      setTimerState(s);
      if (s.presetId) setSelectedPresetId(s.presetId);
    });
  }, []);

  /** Los frascos del estante, paginados hacia atrás. Nunca se vacía. */
  const loadSessions = useCallback((offset = 0) => {
    window.api.cauldronGetSessions(offset, 20).then((result) => {
      const page = result.sessions as unknown as CauldronShelfSession[];
      if (offset === 0) {
        setSessions(page);
      } else {
        setSessions((prev) => [...prev, ...page]);
      }
      setSessionsHasMore(result.hasMore);
      setSessionsOffset(offset + result.sessions.length);
    });
  }, []);

  const loadWeeklyFocus = useCallback(() => {
    window.api.cauldronGetWeeklyFocusTime().then((data) => setWeeklyFocus(data));
  }, []);

  /** El resumen de una línea sobre el estante: en qué se fue el foco esta semana. */
  const loadWeekByProject = useCallback(() => {
    getWeekByProject().then(setWeekByProject).catch(() => setWeekByProject([]));
  }, []);

  /** A session the app was killed in the middle of — offer it back instead of losing it. */
  const loadInterrupted = useCallback(() => {
    window.api.cauldronGetInterruptedSession()
      .then((session) => setInterrupted(session))
      .catch(() => setInterrupted(null));
  }, []);

  /* -- Mount: load everything -- */
  useEffect(() => {
    loadPresets();
    loadStats();
    loadState();
    loadSessions(0);
    loadWeeklyFocus();
    loadWeekByProject();
    loadInterrupted();
  }, [loadPresets, loadStats, loadState, loadSessions, loadWeeklyFocus, loadWeekByProject, loadInterrupted]);

  /* -- Account switch reload -- */
  useEffect(() => {
    const handler = () => {
      loadPresets();
      loadStats();
      loadState();
      loadSessions(0);
      loadWeeklyFocus();
      loadWeekByProject();
      loadInterrupted();
    };
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
  }, [loadPresets, loadStats, loadState, loadSessions, loadWeeklyFocus, loadWeekByProject, loadInterrupted]);

  /* -- Subscribe to tick events -- */
  /* Sounds live in CauldronFloatingTimer: it is the only surface mounted no
     matter which module you are looking at, so it is the only one that can
     guarantee the session never ends in silence. */
  useEffect(() => {
    const cleanup = window.api.onCauldronTick((state) => setTimerState(state));
    return cleanup;
  }, []);

  /* -- Subscribe to session end events -- */
  /* Purely visual here. XP, the toast and the sounds belong to
     CauldronFloatingTimer, so they fire wherever the user happens to be. */
  useEffect(() => {
    const cleanup = window.api.onCauldronSessionEnd((result: CauldronSessionEndResult) => {
      // An extension is not a pomodoro — the backend excludes it from every
      // statistic, so it must not get the completion flourish either.
      if (result.sessionType === 'work' && result.completed && !result.isExtension) {
        if (timerContainerRef.current) brewComplete(timerContainerRef.current);
      }
      loadStats();
      loadSessions(0);
      loadWeeklyFocus();
      loadWeekByProject();
      loadInterrupted();
    });
    return cleanup;
  }, [loadStats, loadSessions, loadWeeklyFocus, loadWeekByProject, loadInterrupted]);

  /* -- Derived state -- */
  const isIdle = !timerState || timerState.status === 'idle';
  const isRunning = timerState?.status === 'work' || timerState?.status === 'on_break';
  const isPaused = timerState?.status === 'work_paused' || timerState?.status === 'break_paused';
  const isAwaiting = timerState?.status === 'awaiting_next';
  /**
   * The 5 s grace before the queued segment starts on its own. The deadline lives
   * in the main process; this only reflects the broadcast.
   */
  const autoSeconds = autoStartSecondsLeft(timerState);
  const isAutoStarting = autoSeconds !== null;

  /* -- Timer display calculations -- */
  const remainingSeconds = timerState ? Math.ceil(timerState.remainingMs / 1000) : 0;
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const timeDisplay = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  const progress =
    timerState && timerState.totalMs > 0 ? 1 - timerState.remainingMs / timerState.totalMs : 0;

  const sessionType: 'work' | 'break' | 'long_break' | 'idle' =
    timerState && !isIdle ? timerState.sessionType : 'idle';

  const segmentLabel = isIdle
    ? t('cauldron.readyToBrew', 'Ready to Brew')
    : sessionType === 'work'
      ? t('cauldron.brewing', 'Brewing\u2026')
      : sessionType === 'break'
        ? t('cauldron.resting', 'Resting\u2026')
        : t('cauldron.grandRest', 'Grand Rest\u2026');

  const selectedPreset = presets.find((p) => p.id === selectedPresetId) || null;

  /* -- GSAP: ambient orbs when timer active -- */
  useEffect(() => {
    if (!isIdle && timerContainerRef.current && !orbsTimelineRef.current) {
      orbsTimelineRef.current = ambientOrbs(timerContainerRef.current);
    } else if (isIdle && orbsTimelineRef.current) {
      orbsTimelineRef.current.kill();
      orbsTimelineRef.current = null;
    }
    return () => {
      orbsTimelineRef.current?.kill();
      orbsTimelineRef.current = null;
    };
  }, [isIdle]);

  /* -- GSAP: stats shimmer on today change -- */
  useEffect(() => {
    if (stats.today > prevTodayRef.current && statsRef.current) {
      statsShimmer(statsRef.current);
    }
    prevTodayRef.current = stats.today;
  }, [stats.today]);

  /* -- Flavor text rotation -- */
  useEffect(() => {
    if (isIdle) return;
    if (isPaused) return;
    const id = setInterval(() => setFlavorIdx((i) => i + 1), 4500);
    return () => clearInterval(id);
  }, [isIdle, isPaused, sessionType]);

  const flavorText = useMemo(() => {
    if (isIdle) return t(`cauldron.flavor.idle.${flavorIdx % FLAVOR_SIZES.idle}`);
    if (isPaused) return t(`cauldron.flavor.paused.${flavorIdx % FLAVOR_SIZES.paused}`);
    const key =
      sessionType === 'work' ? 'work' : sessionType === 'break' ? 'break' : 'longBreak';
    return t(`cauldron.flavor.${key}.${flavorIdx % FLAVOR_SIZES[key]}`);
  }, [isIdle, isPaused, sessionType, flavorIdx, t]);

  /* -- Timer control handlers -- */
  /** Guard wrapper — prevents double-clicks during async IPC calls */
  const guarded = <T,>(fn: () => Promise<T>): (() => Promise<void>) => {
    return async () => {
      if (actionPending) return;
      setActionPending(true);
      try { await fn(); } finally { setActionPending(false); }
    };
  };

  const handleStart = guarded(async () => {
    if (!selectedPresetId) return;
    setEditingPreset(null);
    try {
      // La misión viaja SI se eligió una. Si no, se enciende igual: el botón
      // grande nunca depende del enlace tenue de abajo.
      const state = await startBrew(selectedPresetId, pendingTaskId);
      // Se recuerda para el arranque de un click desde afuera (ver
      // `quickStartPresetId`): el atajo tiene que respetar la última elección.
      rememberLastPreset(selectedPresetId);
      setTimerState(state);
      playCauldronStart();
      setFlavorIdx(0);
      setInterrupted(null);
      // Opt-in: the external window used to land on top of whatever you were doing.
      if (popoutOnStart) window.api.cauldronOpenWindow();
    } catch (err) {
      toast({ type: 'warning', message: String(err) });
    }
  });

  /**
   * Vincular / cambiar / desvincular la misión SIN tocar el timer.
   *
   * En `idle` la elección es local (viaja al encender). Con el caldero andando o
   * en `awaiting_next` va al main, que la escribe en la fila que corresponde y
   * la difunde: todas las superficies la reflejan sin consultar nada.
   */
  const handlePickMission = async (taskId: string | null) => {
    if (isIdle) {
      setPendingTaskId(taskId);
      return;
    }
    const state = await setSessionTask(taskId);
    if (state) setTimerState(state);
  };

  /**
   * «Completar misión» — el tercer botón de `awaiting_next`, y SOLO cuando hubo
   * una misión vinculada. Si no lo tocás, no pasa nada: el enfoque ya se cobró
   * solo, la misión sigue abierta.
   *
   * Va por el flujo normal de Questify (`questsSetTaskStatus` + TASK_COMPLETED)
   * para que XP, combo, racha y toast salgan idénticos a tildarla en la lista.
   */
  const handleCompleteMission = guarded(async () => {
    const taskId = timerState?.taskId;
    if (!taskId) return;

    // Se relee la tarea en el momento del click: pudo borrarse o completarse en
    // Questify mientras el pomodoro corría. Vincularse no es adueñarse.
    const tasks = (await window.api.questsGetTasks()) as Array<{ id: string; status: number; tier: number }>;
    const task = tasks.find((x) => x.id === taskId);
    if (!task || task.status) {
      toast({
        type: 'warning',
        message: t('cauldron.mission.gone', 'Esa misión ya no está disponible.'),
      });
      reloadMissions();
      return;
    }

    const xp = tierXp(task.tier);
    const [, result] = await Promise.all([
      window.api.questsSetTaskStatus(task.id, true),
      window.api.processRpgEvent({
        type: 'TASK_COMPLETED', moduleId: 'quests',
        payload: { xp, hp: 0, taskId: task.id, tier: task.tier },
        timestamp: Date.now(),
      }),
    ]);
    toast({
      type: 'xp',
      message: `+${result.xpGained} XP`,
      details: {
        xp: result.xpGained,
        bonusTier: bonusMultiplierToTier(result.bonusMultiplier),
        comboMultiplier: result.comboMultiplier,
        streakMilestone: result.milestoneXp || undefined,
      },
    });
    window.dispatchEvent(new Event('rpg:statsChanged'));
    window.dispatchEvent(new Event('quests:dataChanged'));
    reloadMissions();
  });

  const handlePause = guarded(async () => {
    const state = await window.api.cauldronPause();
    setTimerState(state);
    playCauldronPause();
  });

  const handleResume = guarded(async () => {
    const state = await window.api.cauldronResume();
    setTimerState(state);
    playCauldronResume();
  });

  const handleSkip = guarded(async () => {
    const state = await window.api.cauldronSkip();
    setTimerState(state);
  });

  const handleConfirmNext = guarded(async () => {
    const state = await window.api.cauldronConfirmNext();
    setTimerState(state);
  });

  /** «Esperá» — disarms the countdown and leaves the segment queued. */
  const handleWait = guarded(async () => {
    const state = await cancelAutoStart();
    setTimerState(state);
  });

  const extMin = timerState?.extensionMinutes ?? 5;

  const handleExtend = guarded(async () => {
    const state = await window.api.cauldronExtend(extMin);
    setTimerState(state);
  });

  const handleStop = async () => {
    const confirmed = await confirm({
      message: t('cauldron.stopConfirm', '¿Detener la sesión? Se perderá el progreso actual.'),
      danger: true,
    });
    if (!confirmed) return;
    if (actionPending) return;
    setActionPending(true);
    try {
      await window.api.cauldronStop();
      setTimerState(null);
      playCauldronPause();
    } finally {
      setActionPending(false);
    }
  };

  /**
   * Retoma la sesion interrumpida DONDE QUEDO, reusando la fila existente. Si el
   * backend no puede (receta borrada, timer ya activo), cae en reiniciar la receta
   * para no dejar al usuario sin salida.
   */
  const handleResumeInterrupted = guarded(async () => {
    if (!interrupted?.presetId) return;
    try {
      const res = await window.api.cauldronResumeInterruptedSession();
      if (res?.success && res.state) {
        setTimerState(res.state);
      } else {
        await window.api.cauldronDiscardInterruptedSession();
        setTimerState(await window.api.cauldronStart(interrupted.presetId));
      }
      setSelectedPresetId(interrupted.presetId);
      setInterrupted(null);
      playCauldronStart();
      setFlavorIdx(0);
      if (popoutOnStart) window.api.cauldronOpenWindow();
    } catch (err) {
      toast({ type: 'warning', message: String(err) });
    }
  });

  const handleDiscardInterrupted = guarded(async () => {
    await window.api.cauldronDiscardInterruptedSession();
    setInterrupted(null);
  });

  /**
   * Registrar la sesión pasada. Sin XP, sin evento RPG, sin toast dorado: el
   * frasco aparece en el estante con borde punteado y listo. La recompensa es
   * que el registro no mienta.
   */
  const handleLogPastSession = guarded(async () => {
    const minutes = parseInt(retroMinutes, 10);
    if (!Number.isFinite(minutes) || minutes < 1) return;
    try {
      const logged = await logPastSession({
        minutes: Math.min(600, minutes),
        taskId: retroTaskId,
      });
      if (!logged) return; // canal no expuesto todavía
      toast({
        type: 'info',
        message: t('cauldron.retro.logged', 'Sesión registrada en el estante — sin XP'),
      });
      setRetroOpen(false);
      setRetroMinutes('');
      setRetroTaskId(null);
      loadSessions(0);
      loadStats();
      loadWeeklyFocus();
      loadWeekByProject();
    } catch (err) {
      toast({ type: 'warning', message: String(err) });
    }
  });

  /* -- Preset handlers -- */
  const handleCreatePreset = () => {
    setEditingPreset({
      workMinutes: 25,
      breakMinutes: 5,
      longBreakMinutes: 15,
      cyclesBeforeLong: 4,
      extensionMinutes: 5,
      autoStartBreak: true,
      autoStartWork: false,
      name: '',
    });
    setIsCreating(true);
  };

  const handleEditPreset = (preset: CauldronPreset) => {
    setEditingPreset({ ...preset });
    setIsCreating(false);
  };

  /**
   * Built-in recipes are read-only in the backend, so "25 -> 30 minutes" used to
   * mean building a recipe from scratch. Clone it into an editable copy instead.
   */
  const handleDuplicatePreset = (preset: CauldronPreset) => {
    setEditingPreset({
      name: t('cauldron.presets.copyOf', '{{name}} (copia)', { name: presetLabel(preset) }),
      workMinutes: preset.workMinutes,
      breakMinutes: preset.breakMinutes,
      longBreakMinutes: preset.longBreakMinutes,
      cyclesBeforeLong: preset.cyclesBeforeLong,
      extensionMinutes: preset.extensionMinutes ?? 5,
      autoStartBreak: (preset as CauldronPresetEx).autoStartBreak ?? true,
      autoStartWork: (preset as CauldronPresetEx).autoStartWork ?? false,
    });
    setIsCreating(true);
  };

  const handleDeletePreset = async (id: string) => {
    const confirmed = await confirm({
      message: t('cauldron.presets.deleteConfirm', 'Delete this recipe? This cannot be undone.'),
      danger: true,
    });
    if (!confirmed) return;
    await window.api.cauldronDeletePreset(id);
    if (selectedPresetId === id) setSelectedPresetId(null);
    setEditingPreset(null);
    loadPresets();
  };

  const handleSavePreset = async () => {
    if (!editingPreset || !editingPreset.name?.trim()) return;
    const payload: Record<string, unknown> = {
      name: editingPreset.name.trim(),
      workMinutes: editingPreset.workMinutes,
      breakMinutes: editingPreset.breakMinutes,
      longBreakMinutes: editingPreset.longBreakMinutes,
      cyclesBeforeLong: editingPreset.cyclesBeforeLong,
      extensionMinutes: editingPreset.extensionMinutes ?? 5,
      autoStartBreak: !!(editingPreset.autoStartBreak ?? true),
      autoStartWork: !!(editingPreset.autoStartWork ?? false),
    };
    if (editingPreset.id) payload.id = editingPreset.id;
    try {
      await window.api.cauldronUpsertPreset(payload);
      loadPresets();
      setEditingPreset(null);
    } catch (err) {
      toast({ type: 'warning', message: String(err) });
    }
  };

  /* -- Weekly chart data: rebuilt inline it was a new array on every 1 s tick -- */
  const weeklyChartData = useMemo(
    () => weeklyFocus.map((d) => ({ label: d.label, value: d.value, status: 'ok' as const })),
    [weeklyFocus],
  );

  /* -- Phase Rune tone -- */
  const phaseTone: 'rubric' | 'sage' | 'gold' | 'ink' =
    sessionType === 'work'
      ? 'rubric'
      : sessionType === 'break'
        ? 'sage'
        : sessionType === 'long_break'
          ? 'gold'
          : 'ink';

  /* What is queued behind the current pause, for the auto-start countdown copy. */
  const nextSegmentLabel = useMemo(() => {
    if (!timerState || !isAwaiting) return '';
    if (timerState.sessionType !== 'work') return t('cauldron.work', 'Enfoque');
    return timerState.currentCycle >= timerState.totalCycles
      ? t('cauldron.longBreak', 'Descanso largo')
      : t('cauldron.break', 'Descanso');
  }, [timerState, isAwaiting, t]);

  /* One name per phase. `segmentLabel` ("Preparando…") and this used to be on
     screen at the same time, saying two different things about one state. */
  const phaseRuneLabel = segmentLabel;

  /* -- La misión vinculada, en las dos vidas del timer ---------------------- */

  /* En `idle` la elección es local; con el caldero andando manda el estado del
     main, que ya trae nombre y color en el broadcast. */
  const pendingMission = useMemo(
    () => missions.find((m) => m.id === pendingTaskId) ?? null,
    [missions, pendingTaskId],
  );
  const activeTaskId = isIdle ? pendingTaskId : (timerState?.taskId ?? null);
  const activeTaskName = isIdle ? (pendingMission?.name ?? null) : (timerState?.taskName ?? null);
  const activeTaskColor = isIdle
    ? (pendingMission?.projectColor ?? UNLABELED_POTION_COLOR)
    : (timerState?.taskProjectColor ?? UNLABELED_POTION_COLOR);

  /* Una misión borrada entre medio conserva el vínculo pero pierde el nombre. */
  const missionTriggerLabel = activeTaskId
    ? (activeTaskName ?? t('cauldron.mission.deleted', 'Misión ya no disponible'))
    : t('cauldron.mission.prompt', '¿Sobre qué misión?');

  /* El tercer botón de `awaiting_next`: solo tras un ENFOQUE y solo si hubo
     misión. Es una oferta, nunca un trámite. */
  const canCompleteMission =
    isAwaiting && timerState?.sessionType === 'work' && !!timerState?.taskId;

  /* -- Render -- */
  return (
    <BookPage
      eyebrow={t('cauldron.eyebrow', 'CALDERO')}
      title={t('cauldron.title', 'The Cauldron')}
      subtitle={t(
        'cauldron.subtitle',
        'Brew focus. Rest deliberately. Earn experience for every potion completed.'
      )}
      className="cauldron-book"
    >
      {/* === Interrupted session — offer it back instead of losing it === */}
      {interrupted && isIdle && (
        <div className="cauldron-resume-banner">
          <Flame width={16} height={16} />
          <span className="cauldron-resume-text">
            {t('cauldron.interrupted.prompt', 'Quedó una poción a medio preparar: {{name}}.', {
              name: interrupted.presetName ?? t('cauldron.history.unknownPreset', 'Receta desconocida'),
            })}{' '}
            <span className="cauldron-resume-time">{formatTime(interrupted.remainingMs)}</span>{' '}
            {t('cauldron.interrupted.remaining', 'restantes')}
          </span>
          <button
            className="cauldron-btn cauldron-btn--primary"
            onClick={handleResumeInterrupted}
            disabled={actionPending || !interrupted.presetId}
            title={t('cauldron.interrupted.resumeHelp', 'Continúa desde el tiempo que quedaba.')}
          >
            {t('cauldron.interrupted.resume', 'Retomar')}
          </button>
          <button className="cauldron-btn" onClick={handleDiscardInterrupted} disabled={actionPending}>
            {t('cauldron.interrupted.discard', 'Descartar')}
          </button>
        </div>
      )}

      {/* === Preset pills === */}
      <div className="cauldron-presets" role="tablist" aria-label={t('cauldron.presets.title', 'Presets')}>
        <HelpBubble variant="inline" text={t('cauldron.presetsHelp', 'Recetas definen tiempos de trabajo, descanso y ciclos. Podés crear recetas personalizadas.')} />
        {presets.map((p) => (
          <button
            key={p.id}
            className={`cauldron-preset-pill${selectedPresetId === p.id ? ' selected' : ''}`}
            onClick={() => setSelectedPresetId(p.id)}
            role="tab"
            aria-selected={selectedPresetId === p.id}
          >
            <span className="cauldron-preset-name">{presetLabel(p)}</span>
            <span className="cauldron-preset-config">
              {p.workMinutes}m &middot; {p.breakMinutes}m &middot; {p.cyclesBeforeLong}&times;
            </span>
          </button>
        ))}
        <button className="cauldron-preset-pill add" onClick={handleCreatePreset}>
          + {t('cauldron.presets.createRecipe', 'New Recipe')}
        </button>
        {selectedPreset && (
          selectedPreset.isDefault ? (
            <button
              className="cauldron-edit-btn"
              onClick={() => handleDuplicatePreset(selectedPreset)}
              title={t('cauldron.presets.duplicateHelp', 'Las recetas por defecto no se editan: esto crea una copia tuya que sí podés ajustar.')}
            >
              {t('cauldron.presets.duplicate', 'Duplicar y editar')}
            </button>
          ) : (
            <button
              className="cauldron-edit-btn"
              onClick={() => handleEditPreset(selectedPreset)}
            >
              {t('cauldron.presets.editRecipe', 'Edit Recipe')}
            </button>
          )
        )}
      </div>

      {/* === Timer Hero (2-column grid) === */}
      <section className="cauldron-timer-hero" data-tour="cauldron">
        {/* -- Left Column: Cauldron Stage -- */}
        <div
          ref={timerContainerRef}
          className={`cauldron-stage${!isIdle ? ' active' : ''}`}
        >
          {/* Visual wrapper — positions particles relative to cauldron */}
          <div className="cauldron-visual">
            <CauldronSVG
              progress={isIdle ? 0 : progress}
              sessionType={sessionType}
              paused={!!isPaused}
              clipId={clipId}
            />

            {/* Embers float up from under cauldron */}
            <div className="cauldron-embers">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="cauldron-ember" />
              ))}
            </div>

            {/* Steam rises from cauldron rim */}
            {isRunning && (
              <div className="cauldron-steam-wrap">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="cauldron-steam" />
                ))}
              </div>
            )}
          </div>

          {/* Session label as Rune tag */}
          <Rune tone={phaseTone}>{segmentLabel}</Rune>

          {/* Time remaining in Fraktur */}
          <div className="cauldron-time-remaining">{timeDisplay}</div>

          {/* Cycle dots */}
          {timerState && !isIdle && (
            <div className="cauldron-cycles">
              {Array.from({ length: timerState.totalCycles }).map((_, i) => {
                const isDone = i + 1 < timerState.currentCycle;
                const isCurrent = i + 1 === timerState.currentCycle;
                const workMin = selectedPreset?.workMinutes ?? 25;
                const dotTitle = isDone
                  ? `${String(workMin).padStart(2, '0')}:00`
                  : isCurrent
                    ? segmentLabel
                    : undefined;
                return (
                  <div
                    key={i}
                    className={`cauldron-cycle-dot${isDone ? ' done' : isCurrent ? ' current' : ''}`}
                    title={dotTitle}
                  />
                );
              })}
              <span className="cauldron-cycle-cap">
                {timerState.currentCycle}/{timerState.totalCycles}
                {/* The loop no longer stops after the long break, so say which lap
                    this is — but only once there is more than one. */}
                {(timerState.round ?? 1) > 1 && (
                  <span className="cauldron-cycle-round">
                    {' · '}
                    {t('cauldron.round', '{{round}}ª ronda', { round: timerState.round })}
                  </span>
                )}
              </span>
            </div>
          )}

          {/* Flavor text */}
          <div className="cauldron-flavor" key={`${flavorIdx}-${sessionType}`}>
            {flavorText}
          </div>

          {/* Primary action — one click, next to the thing it acts on. */}
          {isIdle && (
            <div className="cauldron-stage-actions">
              <button
                className="cauldron-btn cauldron-btn--primary"
                onClick={handleStart}
                disabled={!selectedPresetId || actionPending}
              >
                <Flame width={16} height={16} /> {t('cauldron.startBrew', 'Start Brew')}
              </button>
              {/* Secundario y tenue, DEBAJO del botón grande: elegir misión no es
                  un peaje previo al play. Se puede saltear siempre. */}
              {taskLinkWired && (
                <div className="cauldron-mission-row">
                  {activeTaskId && (
                    <span
                      className="cauldron-mission-swatch"
                      style={{ background: activeTaskColor }}
                      aria-hidden="true"
                    />
                  )}
                  <MissionPicker
                    missions={missions}
                    selectedId={activeTaskId}
                    onPick={handlePickMission}
                    label={missionTriggerLabel}
                  />
                </div>
              )}
              <label className="cauldron-popout-toggle">
                <input
                  type="checkbox"
                  checked={popoutOnStart}
                  onChange={(e) => {
                    setPopoutOnStart(e.target.checked);
                    try { localStorage.setItem(POPOUT_ON_START_KEY, String(e.target.checked)); } catch { /* private mode */ }
                  }}
                />
                {t('cauldron.popOutOnStart', 'Abrir ventana flotante al iniciar')}
              </label>
            </div>
          )}
        </div>

        {/* -- Right Column: the live brew -- */}
        <div className="cauldron-right-panel">
          <Section
            title={isIdle
              ? t('cauldron.selectedRecipe', 'Receta seleccionada')
              : t('cauldron.nowBrewing', 'Now Brewing')}
            icon={<CauldronIcon width={16} height={16} />}
            rightSlot={<><HelpBubble variant="inline" text={t('cauldron.nowBrewingHelp', 'Sesión activa de pomodoro. Muestra el temporizador, la receta y el ciclo actual.')} /><Rune tone={phaseTone}>{phaseRuneLabel}</Rune></>}
          >
            {/* Controls are driven by the TIMER, not by the selected recipe:
                deleting the recipe mid-session used to leave the timer running
                with no Pause and no Stop. */}
            {selectedPreset && isIdle && (
              <>
                <div className="cauldron-kv-row">
                  <span className="cauldron-kv-key">{t('cauldron.work', 'Focus')}</span>
                  <span className="cauldron-kv-value rubric">{selectedPreset.workMinutes}:00</span>
                </div>
                <div className="cauldron-kv-row">
                  <span className="cauldron-kv-key">{t('cauldron.break', 'Break')}</span>
                  <span className="cauldron-kv-value sage">{selectedPreset.breakMinutes}:00</span>
                </div>
                <div className="cauldron-kv-row">
                  <span className="cauldron-kv-key">{t('cauldron.longBreak', 'Long Break')}</span>
                  <span className="cauldron-kv-value gold">{selectedPreset.longBreakMinutes}:00</span>
                </div>
              </>
            )}

            {!isIdle && timerState && (
              <>
                <div className="cauldron-kv-row">
                  <span className="cauldron-kv-key">{t('cauldron.recipe', 'Recipe')}</span>
                  <span className="cauldron-kv-value">
                    {timerState.presetName ?? presetLabel(selectedPreset)}
                  </span>
                </div>
                {/* La misión vinculada, visible durante el foco Y en
                    `awaiting_next` — que es justo cuando el usuario sabe qué
                    hizo y puede etiquetar tarde. */}
                {taskLinkWired && (
                  <div className="cauldron-kv-row cauldron-mission-kv">
                    <span className="cauldron-kv-key">
                      {t('cauldron.mission.label', 'Misión')}
                    </span>
                    <span className="cauldron-mission-value">
                      {activeTaskId && (
                        <span
                          className="cauldron-mission-swatch"
                          style={{ background: activeTaskColor }}
                          aria-hidden="true"
                        />
                      )}
                      <span className="cauldron-mission-name">
                        {activeTaskId
                          ? (activeTaskName ?? t('cauldron.shelf.unlabeled', 'sin etiqueta'))
                          : t('cauldron.mission.none', 'Sin misión')}
                      </span>
                      <MissionPicker
                        missions={missions}
                        selectedId={activeTaskId}
                        onPick={handlePickMission}
                        label={activeTaskId
                          ? t('cauldron.mission.change', 'cambiar')
                          : t('cauldron.mission.prompt', '¿Sobre qué misión?')}
                      />
                    </span>
                  </div>
                )}
                <div className="cauldron-progress-row">
                  <Gauge
                    value={Math.round(progress * 100)}
                    max={100}
                    tone={phaseTone}
                    label={`${Math.round(progress * 100)}%`}
                    showPips
                  />
                </div>
              </>
            )}

            {isIdle && !selectedPreset && (
              <div className="cauldron-kv-value">
                {t('cauldron.noBrewInProgress', 'No brew in progress')}
              </div>
            )}

            <div className="cauldron-controls">
              {isRunning && (
                <>
                  <button className="cauldron-btn" onClick={handlePause} disabled={actionPending}>
                    {t('cauldron.pause', 'Pause')}
                  </button>
                  <button
                    className="cauldron-btn"
                    onClick={handleSkip}
                    disabled={actionPending}
                    title={sessionType === 'work'
                      ? t('cauldron.skipWorkHelp', 'Termina este enfoque ya y pasa al descanso. El ciclo no cuenta y no otorga XP.')
                      : t('cauldron.skipBreakHelp', 'Termina el descanso ya y arranca el próximo enfoque.')}
                  >
                    {t('cauldron.skip', 'Skip')}
                  </button>
                  <button className="cauldron-btn cauldron-btn--danger" onClick={handleStop} disabled={actionPending}>
                    {t('cauldron.stop', 'Stop')}
                  </button>
                </>
              )}
              {isPaused && (
                <>
                  <button className="cauldron-btn cauldron-btn--primary" onClick={handleResume} disabled={actionPending}>
                    {t('cauldron.resume', 'Resume')}
                  </button>
                  <button className="cauldron-btn cauldron-btn--danger" onClick={handleStop} disabled={actionPending}>
                    {t('cauldron.stop', 'Stop')}
                  </button>
                </>
              )}
              {isAutoStarting && (
                <div className="cauldron-autostart-row">
                  <span className="cauldron-autostart-countdown">
                    {t('cauldron.autoStart.countdown', '{{next}} en {{seconds}} s', {
                      next: nextSegmentLabel,
                      seconds: autoSeconds,
                    })}
                  </span>
                  <button
                    className="cauldron-btn"
                    onClick={handleWait}
                    disabled={actionPending}
                    title={t(
                      'cauldron.autoStart.waitHelp',
                      'Cancela el arranque automático: el siguiente segmento espera a que le des Continuar.',
                    )}
                  >
                    {t('cauldron.autoStart.wait', 'Esperá')}
                  </button>
                </div>
              )}
              {isAwaiting && (
                <>
                  <button className="cauldron-btn cauldron-btn--primary" onClick={handleConfirmNext} disabled={actionPending}>
                    {t('cauldron.confirmNext', 'Continuar')}
                  </button>
                  {canCompleteMission && (
                    <button
                      className="cauldron-btn"
                      onClick={handleCompleteMission}
                      disabled={actionPending}
                      title={t(
                        'cauldron.mission.completeHelp',
                        'Marca la misión como completada en Questify, con su XP. Si no lo tocás, no pasa nada.',
                      )}
                    >
                      {t('cauldron.mission.complete', 'Completar misión')}
                    </button>
                  )}
                  <button
                    className="cauldron-btn"
                    onClick={handleExtend}
                    disabled={actionPending}
                    title={sessionType === 'work'
                      ? t('cauldron.extendWorkHelp', 'Suma {{min}} min al enfoque que acaba de terminar. Es prórroga: no cuenta como otro pomodoro ni da XP.', { min: extMin })
                      : t('cauldron.extendBreakHelp', 'Suma {{min}} min al descanso antes de volver al enfoque.', { min: extMin })}
                  >
                    {t('cauldron.extend', '+{{min}} min', { min: extMin })}
                  </button>
                  <button className="cauldron-btn cauldron-btn--danger" onClick={handleStop} disabled={actionPending}>
                    {t('cauldron.stop', 'Stop')}
                  </button>
                </>
              )}
            </div>
          </Section>
        </div>
      </section>

      {/* === Statistics === */}
      <Section title={t('cauldron.stats.title', 'Brewing Log')} icon={<Flame width={14} height={14} />} rightSlot={<HelpBubble variant="inline" text={t('cauldron.statsHelp', 'Sesiones completadas: hoy, esta semana y total histórico. Cada ciclo completado otorga XP.')} />}>
        <div className="cauldron-stats-grid" ref={statsRef}>
          <Cartouche
            label={t('cauldron.stats.today', 'Today')}
            value={stats.today}
            foot={t('cauldron.stats.todaySub', 'pociones completadas')}
            icon={<CauldronIcon width={14} height={14} />}
          />
          <Cartouche
            label={t('cauldron.stats.week', 'This Week')}
            value={stats.week}
            foot={t('cauldron.stats.weekSub', 'sesiones esta semana')}
          />
          <Cartouche
            label={t('cauldron.stats.total', 'Total')}
            value={stats.total}
            foot={t('cauldron.stats.totalSub', 'desde que te uniste al gremio')}
          />
          <Cartouche
            label={t('cauldron.stats.streak', 'Streak')}
            value={`${stats.streak}`}
            foot={t('cauldron.stats.streakSub', 'días seguidos')}
            icon={stats.streak > 0 ? <Flame width={14} height={14} /> : undefined}
          />
        </div>
      </Section>

      {/* === Weekly Focus Chart === */}
      <Section
        title={t('cauldron.weeklyFocus.title', 'Weekly Focus')}
        icon={<CauldronIcon width={14} height={14} />}
        rightSlot={<HelpBubble variant="inline" text={t('cauldron.weeklyFocusHelp2', 'Minutos de enfoque por día en la última semana. Visualizá tu consistencia.')} />}
      >
        {weeklyChartData.length > 0 && weeklyChartData.some((d) => d.value > 0) ? (
          <CastleBarChart data={weeklyChartData} height={200} themed />
        ) : (
          <div className="cauldron-empty-state">
            {t('cauldron.weeklyFocus.empty', 'Todavía no hay minutos de enfoque esta semana.')}
          </div>
        )}
      </Section>

      {/* === El Estante de Pociones =============================
           Reemplaza al viejo «Historial de sesiones» (una lista de texto plano).
           Cada enfoque completado deposita un frasco; cada enfoque abandonado
           pasado el umbral deja uno roto en el mismo lugar. Solo crece. */}
      <Section
        title={t('cauldron.shelf.title', 'Estante de Pociones')}
        icon={<Potion width={14} height={14} />}
        rightSlot={
          <>
            <HelpBubble variant="inline" text={t('cauldron.shelfHelp', 'Cada enfoque completado deja un frasco, del color del proyecto de la misión. Un enfoque cortado a mano después de 5 minutos deja un frasco roto. El estante nunca se vacía.')} />
            <button
              className="cauldron-collapse-toggle"
              onClick={() => setHistoryOpen((prev) => !prev)}
              aria-expanded={historyOpen}
            >
              {t('cauldron.shelf.count', '{{count}} frascos', { count: sessions.length })}
              {historyOpen ? <ChevronUp width={12} height={12} /> : <ChevronDown width={12} height={12} />}
            </button>
          </>
        }
      >
        {historyOpen && (
          <PotionShelf
            sessions={sessions}
            week={weekByProject}
            hasMore={sessionsHasMore}
            onLoadMore={() => loadSessions(sessionsOffset)}
          />
        )}

        {/* «¿Trabajaste sin el caldero?» — sesión pasada, a mano. Enlace tenue,
            nunca un botón que compita con el play: es un trámite de honestidad,
            no una función estrella. Cuenta para el registro, cero XP. */}
        {retroWired && !retroOpen && (
          <button
            type="button"
            className="cauldron-mission-trigger cauldron-retro-link"
            onClick={() => setRetroOpen(true)}
          >
            {t('cauldron.retro.link', '¿Trabajaste sin el caldero?')}
          </button>
        )}
        {retroWired && retroOpen && (
          <form
            className="cauldron-retro-form"
            onSubmit={(e) => { e.preventDefault(); handleLogPastSession(); }}
          >
            <label className="cauldron-retro-field">
              <span className="cauldron-kv-key">
                {t('cauldron.retro.minutes', 'Minutos')}
              </span>
              <input
                className="cauldron-input cauldron-mono cauldron-retro-input"
                type="number"
                min="1"
                max="600"
                value={retroMinutes}
                onChange={(e) => setRetroMinutes(e.target.value)}
                autoFocus
              />
            </label>
            {taskLinkWired && (
              <MissionPicker
                missions={missions}
                selectedId={retroTaskId}
                onPick={setRetroTaskId}
                label={retroTaskId
                  ? (missions.find((m) => m.id === retroTaskId)?.name
                      ?? t('cauldron.mission.deleted', 'Misión ya no disponible'))
                  : t('cauldron.mission.prompt', '¿Sobre qué misión?')}
              />
            )}
            <button
              type="submit"
              className="cauldron-btn"
              disabled={actionPending || !(parseInt(retroMinutes, 10) >= 1)}
            >
              {t('cauldron.retro.submit', 'Registrar')}
            </button>
            <button
              type="button"
              className="cauldron-btn"
              onClick={() => { setRetroOpen(false); setRetroMinutes(''); setRetroTaskId(null); }}
            >
              {t('common.cancel', 'Cancelar')}
            </button>
            <p className="cauldron-retro-hint">
              {t(
                'cauldron.retro.hint',
                'Entra al estante con borde punteado. Cuenta para el registro, no da XP.',
              )}
            </p>
          </form>
        )}
      </Section>

      {/* === Preset Editor Modal === */}
      {editingPreset && createPortal(
        <div
          className="cauldron-modal-overlay"
          onClick={() => setEditingPreset(null)}
          onKeyDown={(e) => { if (e.key === 'Escape') setEditingPreset(null); }}
        >
          <div
            className="cauldron-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="cauldron-modal-head">
              <h2 className="cauldron-modal-title">
                {isCreating
                  ? t('cauldron.presets.createRecipe', 'Forge New Brew')
                  : t('cauldron.presets.editRecipe', 'Edit Brew')}
              </h2>
              <HelpBubble text={t('cauldron.editPresetHelp', 'Ciclos antes del descanso largo: tras N ciclos seguidos, se activa el descanso largo.')} />
              <button
                className="cauldron-modal-close"
                onClick={() => setEditingPreset(null)}
                aria-label={t('common.close', 'Close')}
              >
                {'\u2715'}
              </button>
            </div>
            <div className="cauldron-form-grid">
              <div className="full">
                <label className="cauldron-kv-key">
                  {t('cauldron.presets.name', 'Brew Name')}
                </label>
                <input
                  className="cauldron-input"
                  value={editingPreset.name || ''}
                  onChange={(e) =>
                    setEditingPreset({ ...editingPreset, name: e.target.value })
                  }
                  maxLength={32}
                />
              </div>
              <div>
                <label className="cauldron-kv-key">
                  {t('cauldron.presets.workMin', 'Work (min)')}
                </label>
                <input
                  className="cauldron-input cauldron-mono"
                  type="number"
                  min="1"
                  max="180"
                  value={editingPreset.workMinutes || 25}
                  onChange={(e) =>
                    setEditingPreset({
                      ...editingPreset,
                      workMinutes: Math.max(1, parseInt(e.target.value, 10) || 1),
                    })
                  }
                />
              </div>
              <div>
                <label className="cauldron-kv-key">
                  {t('cauldron.presets.breakMin', 'Break (min)')}
                </label>
                <input
                  className="cauldron-input cauldron-mono"
                  type="number"
                  min="1"
                  max="60"
                  value={editingPreset.breakMinutes || 5}
                  onChange={(e) =>
                    setEditingPreset({
                      ...editingPreset,
                      breakMinutes: Math.max(1, parseInt(e.target.value, 10) || 1),
                    })
                  }
                />
              </div>
              <div>
                <label className="cauldron-kv-key">
                  {t('cauldron.presets.longBreakMin', 'Long Break (min)')}
                </label>
                <input
                  className="cauldron-input cauldron-mono"
                  type="number"
                  min="1"
                  max="120"
                  value={editingPreset.longBreakMinutes || 15}
                  onChange={(e) =>
                    setEditingPreset({
                      ...editingPreset,
                      longBreakMinutes: Math.max(1, parseInt(e.target.value, 10) || 1),
                    })
                  }
                />
              </div>
              <div>
                <label className="cauldron-kv-key">
                  {t('cauldron.presets.cycles', 'Cycles')}
                </label>
                <select
                  className="cauldron-select cauldron-mono"
                  value={editingPreset.cyclesBeforeLong || 4}
                  onChange={(e) =>
                    setEditingPreset({
                      ...editingPreset,
                      cyclesBeforeLong: parseInt(e.target.value, 10),
                    })
                  }
                >
                  {[2, 3, 4, 5, 6, 8].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="cauldron-kv-key">
                  {t('cauldron.presets.extensionMin', 'Prórroga (min)')}
                </label>
                <input
                  className="cauldron-input cauldron-mono"
                  type="number"
                  min="1"
                  max="60"
                  value={editingPreset.extensionMinutes || 5}
                  onChange={(e) =>
                    setEditingPreset({
                      ...editingPreset,
                      extensionMinutes: Math.max(1, parseInt(e.target.value, 10) || 1),
                    })
                  }
                />
              </div>
              {/* Auto-chaining: the whole point of the technique is that the rest
                  arrives whether or not you are at the keyboard. */}
              <div className="full cauldron-autostart-field">
                <label className="cauldron-autostart-toggle">
                  <input
                    type="checkbox"
                    checked={!!(editingPreset.autoStartBreak ?? true)}
                    onChange={(e) =>
                      setEditingPreset({ ...editingPreset, autoStartBreak: e.target.checked })
                    }
                  />
                  <span className="cauldron-kv-key">
                    {t('cauldron.autoStart.breakLabel', 'Arrancar el descanso solo')}
                  </span>
                </label>
                <p className="cauldron-autostart-hint">
                  {t(
                    'cauldron.autoStart.breakHelp',
                    'Al terminar un enfoque, el descanso empieza solo tras 5 segundos. Podés cancelarlo con «Esperá».',
                  )}
                </p>
              </div>
              <div className="full cauldron-autostart-field">
                <label className="cauldron-autostart-toggle">
                  <input
                    type="checkbox"
                    checked={!!(editingPreset.autoStartWork ?? false)}
                    onChange={(e) =>
                      setEditingPreset({ ...editingPreset, autoStartWork: e.target.checked })
                    }
                  />
                  <span className="cauldron-kv-key">
                    {t('cauldron.autoStart.workLabel', 'Arrancar el enfoque solo')}
                  </span>
                </label>
                <p className="cauldron-autostart-hint">
                  {t(
                    'cauldron.autoStart.workHelp',
                    'Al terminar un descanso, el próximo enfoque empieza solo tras 5 segundos. Podés cancelarlo con «Esperá».',
                  )}
                </p>
              </div>
            </div>
            <CyclePreviewBar preset={editingPreset as CauldronPreset} />
            <div className="cauldron-modal-actions">
              {!isCreating && editingPreset.id && !editingPreset.isDefault && (
                <button
                  className="cauldron-btn cauldron-btn--danger"
                  onClick={() => handleDeletePreset(editingPreset.id!)}
                >
                  {t('cauldron.presets.delete', 'Discard Recipe')}
                </button>
              )}
              <div style={{ flex: 1 }} />
              <button className="cauldron-btn" onClick={() => setEditingPreset(null)}>
                {t('common.cancel', 'Cancel')}
              </button>
              <button
                className="cauldron-btn cauldron-btn--primary"
                onClick={handleSavePreset}
                disabled={!editingPreset.name?.trim()}
              >
                {t('common.save', 'Save Brew')}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </BookPage>
  );
}
