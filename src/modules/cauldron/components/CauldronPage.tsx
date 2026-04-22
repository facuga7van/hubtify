import { useState, useEffect, useCallback, useRef, useMemo, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../../shared/components/useToast';
import { useConfirm } from '../../../shared/components/ConfirmDialog';
import { AnimatedNumber } from '../../finance/components/shared/AnimatedNumber';
import { ambientOrbs, brewComplete, statsShimmer } from '../../../shared/animations/cauldron';
import {
  playCauldronStart,
  playCauldronComplete,
  playCauldronBreakEnd,
  playCauldronCycleEnd,
  playCauldronWarning,
  playCauldronPause,
} from '../../../shared/audio';
import PageHeader from '../../../shared/components/PageHeader';
import type {
  CauldronTimerState,
  CauldronPreset,
  CauldronStats,
  CauldronSessionEndResult,
} from '../../../../shared/types';

/* ── Inline Helpers ─────────────────────────────────────────────── */

function CyclePreviewBar({ preset }: { preset: CauldronPreset }) {
  const cycles = preset.cyclesBeforeLong || 4;
  const segments: { type: 'work' | 'break' | 'long-break'; minutes: number }[] = [];
  for (let i = 0; i < cycles; i++) {
    segments.push({ type: 'work', minutes: preset.workMinutes });
    if (i < cycles - 1) {
      segments.push({ type: 'break', minutes: preset.breakMinutes });
    } else {
      segments.push({ type: 'long-break', minutes: preset.longBreakMinutes });
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

function NumberStepper({
  label,
  value,
  onChange,
  min,
  max,
  colorClass,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  colorClass: string;
}) {
  return (
    <div className="cauldron-number-stepper">
      <div className={`cauldron-stepper-label ${colorClass}`}>{label}</div>
      <div className="cauldron-stepper-controls">
        <button
          className="cauldron-stepper-btn"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
        >
          -
        </button>
        <input
          className="cauldron-stepper-input"
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (!isNaN(v)) onChange(Math.min(max, Math.max(min, v)));
          }}
        />
        <button
          className="cauldron-stepper-btn"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
        >
          +
        </button>
      </div>
    </div>
  );
}

/* ── Flavor texts for ticker ────────────────────────────────────── */

const FLAVOR_TEXTS = [
  'Ancient recipe in progress...',
  'The cauldron bubbles softly...',
  'Arcane ingredients fusing...',
  'Essence of focus distilling...',
  'Mana crystals dissolving...',
  'Stirring clockwise thrice...',
];

/* ── Main Component ─────────────────────────────────────────────── */

export default function CauldronPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const confirm = useConfirm();

  /* ── State ── */
  const [presets, setPresets] = useState<CauldronPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [timerState, setTimerState] = useState<CauldronTimerState | null>(null);
  const [stats, setStats] = useState<CauldronStats>({ today: 0, week: 0, total: 0 });
  const [editingPreset, setEditingPreset] = useState<Partial<CauldronPreset> | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  /* ── Refs ── */
  const timerContainerRef = useRef<HTMLDivElement>(null);
  const orbsTimelineRef = useRef<gsap.core.Timeline | null>(null);
  const prevTodayRef = useRef(0);
  const statsRef = useRef<HTMLDivElement>(null);
  const warningFiredRef = useRef(false);
  const clipId = useId();

  /* ── Data loaders ── */
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

  /* ── Mount: load everything ── */
  useEffect(() => {
    loadPresets();
    loadStats();
    loadState();
  }, [loadPresets, loadStats, loadState]);

  /* ── Account switch reload ── */
  useEffect(() => {
    const handler = () => {
      loadPresets();
      loadStats();
      loadState();
    };
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
  }, [loadPresets, loadStats, loadState]);

  /* ── Subscribe to tick events ── */
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

  /* ── Subscribe to session end events ── */
  useEffect(() => {
    const cleanup = window.api.onCauldronSessionEnd((result: CauldronSessionEndResult) => {
      warningFiredRef.current = false;

      if (result.sessionType === 'work' && result.completed) {
        // Brew complete animation
        if (timerContainerRef.current) brewComplete(timerContainerRef.current);

        if (result.nextType === null) {
          playCauldronCycleEnd();
        } else {
          playCauldronComplete();
        }

        window.api
          .processRpgEvent({
            type: 'POMODORO_COMPLETED',
            moduleId: 'cauldron',
            payload: { xp: 20, hp: 0 },
            timestamp: Date.now(),
          })
          .then(() => {
            window.dispatchEvent(new Event('rpg:statsChanged'));
            window.dispatchEvent(new Event('cauldron:dataChanged'));
          });
        toast({ type: 'xp', message: t('cauldron.pomodoroComplete', 'Brew complete!') });
      } else if (result.sessionType !== 'work' && result.completed) {
        playCauldronBreakEnd();
      }
      loadStats();
    });
    return cleanup;
  }, [toast, t, loadStats]);

  /* ── Derived state ── */
  const isIdle = !timerState || timerState.status === 'idle';
  const isRunning = timerState?.status === 'work' || timerState?.status === 'on_break';
  const isPaused = timerState?.status === 'work_paused' || timerState?.status === 'break_paused';

  /* ── Timer display calculations ── */
  const remainingSeconds = timerState ? Math.ceil(timerState.remainingMs / 1000) : 0;
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const timeDisplay = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  const progress =
    timerState && timerState.totalMs > 0 ? 1 - timerState.remainingMs / timerState.totalMs : 0;

  const sessionTypeClass =
    timerState?.sessionType === 'work'
      ? 'cauldron-work'
      : timerState?.sessionType === 'long_break'
        ? 'cauldron-long-break'
        : 'cauldron-break';

  const segmentLabel =
    timerState?.sessionType === 'work'
      ? t('cauldron.work', 'Focus')
      : timerState?.sessionType === 'long_break'
        ? t('cauldron.longBreak', 'Long Break')
        : timerState?.sessionType === 'break'
          ? t('cauldron.break', 'Break')
          : '';

  /* ── GSAP: ambient orbs when timer active ── */
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

  /* ── GSAP: stats shimmer on today change ── */
  useEffect(() => {
    if (stats.today > prevTodayRef.current && statsRef.current) {
      statsShimmer(statsRef.current);
    }
    prevTodayRef.current = stats.today;
  }, [stats.today]);

  /* ── Ticker messages ── */
  const tickerMessages = useMemo(() => {
    const msgs: string[] = [];
    if (timerState?.status === 'work' || timerState?.status === 'work_paused') {
      msgs.push(t('cauldron.ticker.brewing', 'Brewing focus potion...'));
    }
    if (timerState?.status === 'on_break' || timerState?.status === 'break_paused') {
      msgs.push(t('cauldron.ticker.resting', 'Ingredients settling...'));
    }
    if (timerState && timerState.totalCycles > 0) {
      msgs.push(
        t('cauldron.ticker.cycle', 'Cycle {{current}} of {{total}}', {
          current: timerState.currentCycle,
          total: timerState.totalCycles,
        })
      );
    }
    if (stats.today > 0) {
      msgs.push(
        t('cauldron.ticker.today', '{{count}} brews today', { count: stats.today })
      );
    }
    // Random flavor text
    msgs.push(FLAVOR_TEXTS[Math.floor(Math.random() * FLAVOR_TEXTS.length)]);
    return msgs;
  }, [t, timerState?.status, timerState?.currentCycle, timerState?.totalCycles, stats.today]);

  /* ── Timer control handlers ── */
  const handleStart = async () => {
    if (!selectedPresetId) return;
    setEditingPreset(null);
    try {
      const state = await window.api.cauldronStart(selectedPresetId);
      setTimerState(state);
      playCauldronStart();
    } catch (err) {
      toast({ type: 'warning', message: String(err) });
    }
  };

  const handlePause = async () => {
    const state = await window.api.cauldronPause();
    setTimerState(state);
    playCauldronPause();
  };

  const handleResume = async () => {
    const state = await window.api.cauldronResume();
    setTimerState(state);
    playCauldronPause();
  };

  const handleSkip = async () => {
    const state = await window.api.cauldronSkip();
    setTimerState(state);
  };

  const handleStop = async () => {
    await window.api.cauldronStop();
    setTimerState(null);
  };

  /* ── Preset handlers ── */
  const handleCreatePreset = () => {
    setEditingPreset({
      workMinutes: 25,
      breakMinutes: 5,
      longBreakMinutes: 15,
      cyclesBeforeLong: 4,
      name: '',
    });
    setIsCreating(true);
  };

  const handleEditPreset = (preset: CauldronPreset) => {
    setEditingPreset({ ...preset });
    setIsCreating(false);
  };

  const handleDeletePreset = async (id: string) => {
    const confirmed = await confirm({
      message: t('cauldron.presets.deleteConfirm', 'Delete this recipe? This cannot be undone.'),
      danger: true,
    });
    if (!confirmed) return;
    await window.api.cauldronDeletePreset(id);
    if (selectedPresetId === id) setSelectedPresetId(null);
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

  /* ── Render ── */
  return (
    <div className="cauldron-page">
      <PageHeader title={t('cauldron.title', 'The Cauldron')} />

      {/* === PRESETS (compact pills) === */}
      <div className="cauldron-presets">
        {presets.map((p) => (
          <div
            key={p.id}
            className={`cauldron-preset-pill${selectedPresetId === p.id ? ' selected' : ''}`}
            onClick={() => setSelectedPresetId(p.id)}
          >
            <span className="cauldron-preset-pill-name">{p.name}</span>
            <span className="cauldron-preset-pill-time">{p.workMinutes}/{p.breakMinutes}</span>
            {!p.isDefault && (
              <div className="cauldron-preset-pill-actions">
                <button
                  className="cauldron-preset-action-btn"
                  onClick={(e) => { e.stopPropagation(); handleEditPreset(p); }}
                  title="Edit"
                >✎</button>
                <button
                  className="cauldron-preset-action-btn"
                  onClick={(e) => { e.stopPropagation(); handleDeletePreset(p.id); }}
                  title="Delete"
                >✕</button>
              </div>
            )}
          </div>
        ))}
        <button
          className="cauldron-create-pill"
          onClick={handleCreatePreset}
          title={t('cauldron.presets.createRecipe', 'Create Recipe')}
        >+</button>
      </div>

      {/* Inline Editor (expands below pills) */}
      {editingPreset && (
        <div className="cauldron-preset-editor">
          <div className="cauldron-editor-title">
            {isCreating
              ? t('cauldron.presets.createRecipe', 'Create Recipe')
              : t('cauldron.presets.editRecipe', 'Edit Recipe')}
          </div>
          <div className="cauldron-editor-fields">
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="cauldron-stepper-label">
                {t('cauldron.presets.name', 'Name')}
              </label>
              <input
                className="rpg-input"
                style={{ width: '100%', marginTop: 4 }}
                value={editingPreset.name || ''}
                onChange={(e) =>
                  setEditingPreset({ ...editingPreset, name: e.target.value })
                }
              />
            </div>
            <NumberStepper
              label={t('cauldron.presets.workMin', 'Work (min)')}
              value={editingPreset.workMinutes || 25}
              onChange={(v) => setEditingPreset({ ...editingPreset, workMinutes: v })}
              min={1}
              max={120}
              colorClass="stepper-work"
            />
            <NumberStepper
              label={t('cauldron.presets.breakMin', 'Break (min)')}
              value={editingPreset.breakMinutes || 5}
              onChange={(v) => setEditingPreset({ ...editingPreset, breakMinutes: v })}
              min={1}
              max={60}
              colorClass="stepper-break"
            />
            <NumberStepper
              label={t('cauldron.presets.longBreakMin', 'Long Break (min)')}
              value={editingPreset.longBreakMinutes || 15}
              onChange={(v) => setEditingPreset({ ...editingPreset, longBreakMinutes: v })}
              min={1}
              max={60}
              colorClass="stepper-long-break"
            />
            <NumberStepper
              label={t('cauldron.presets.cycles', 'Cycles')}
              value={editingPreset.cyclesBeforeLong || 4}
              onChange={(v) => setEditingPreset({ ...editingPreset, cyclesBeforeLong: v })}
              min={1}
              max={12}
              colorClass="stepper-cycles"
            />
          </div>
          <div className="cauldron-editor-preview">
            <div className="cauldron-editor-preview-label">Preview</div>
            <CyclePreviewBar preset={editingPreset as CauldronPreset} />
          </div>
          <div className="cauldron-editor-actions">
            <button className="rpg-button" onClick={() => setEditingPreset(null)}>
              {t('common.cancel', 'Cancel')}
            </button>
            <button
              className="rpg-button"
              onClick={handleSavePreset}
              disabled={!editingPreset.name?.trim()}
            >
              {t('common.save', 'Save')}
            </button>
          </div>
        </div>
      )}

      {/* === TIMER SECTION (when not idle) === */}
      {!isIdle && timerState && (
        <>
          <div
            ref={timerContainerRef}
            className={`cauldron-timer-container ${sessionTypeClass}`}
          >
            {/* Glow backdrop */}
            <div className="cauldron-glow-backdrop" />

            {/* SVG Cauldron */}
            <svg
              className="cauldron-svg"
              viewBox="0 0 280 320"
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                {/* Clip path for liquid area inside pot */}
                <clipPath id={clipId}>
                  {/* Matches pot body interior — no overflow below pot */}
                  <rect x="50" y="125" width="180" height="120" rx="8" />
                  <ellipse cx="140" cy="248" rx="82" ry="22" />
                </clipPath>
              </defs>

              {/* Tripod legs */}
              <line
                x1="80" y1="260" x2="60" y2="310"
                stroke="#5a3825" strokeWidth="5" strokeLinecap="round"
              />
              <line
                x1="140" y1="270" x2="140" y2="315"
                stroke="#5a3825" strokeWidth="5" strokeLinecap="round"
              />
              <line
                x1="200" y1="260" x2="220" y2="310"
                stroke="#5a3825" strokeWidth="5" strokeLinecap="round"
              />

              {/* Pot body */}
              <path
                d="M55,120 Q45,120 45,140 L45,230 Q45,270 140,270 Q235,270 235,230 L235,140 Q235,120 225,120 Z"
                fill="#3d2b1f" stroke="#5a3825" strokeWidth="3"
              />

              {/* Liquid with clip */}
              <g clipPath={`url(#${clipId})`}>
                {/* Liquid fill — rect rises from bottom based on progress */}
                <rect
                  className="cauldron-liquid-fill"
                  x="45" width="190"
                  y={270 - progress * 150}
                  height={progress * 150}
                />
                {/* Wave surface */}
                <rect
                  className="cauldron-wave"
                  x="0" y={270 - progress * 150 - 4}
                  width="560" height="8" opacity="0.3"
                />
              </g>

              {/* Rim */}
              <ellipse cx="140" cy="120" rx="100" ry="15" fill="#4a3628" stroke="#5a3825" strokeWidth="2" />
              <ellipse cx="140" cy="120" rx="90" ry="12" fill="#3d2b1f" />

              {/* Rim glow (when active) */}
              <ellipse
                className="cauldron-rim-glow"
                cx="140" cy="120" rx="95" ry="14"
                fill="none" stroke="currentColor" strokeWidth="2" opacity="0.5"
              />

              {/* Handles */}
              <path
                d="M45,160 Q20,160 20,185 Q20,210 45,210"
                fill="none" stroke="#5a3825" strokeWidth="5" strokeLinecap="round"
              />
              <path
                d="M235,160 Q260,160 260,185 Q260,210 235,210"
                fill="none" stroke="#5a3825" strokeWidth="5" strokeLinecap="round"
              />
            </svg>

            {/* Time overlay */}
            <span className="cauldron-time-display">{timeDisplay}</span>
            <span className="cauldron-session-label">{segmentLabel}</span>

            {/* Bubbles (6 spans) — only when running (not paused) */}
            {isRunning && (
              <div className="cauldron-bubbles">
                {Array.from({ length: 6 }).map((_, i) => (
                  <span key={i} className="cauldron-bubble" />
                ))}
              </div>
            )}

            {/* Steam (5 spans) — only when running */}
            {isRunning && (
              <div className="cauldron-steam">
                {Array.from({ length: 5 }).map((_, i) => (
                  <span key={i} className="cauldron-steam-puff" />
                ))}
              </div>
            )}
          </div>

          {/* Cycle dots */}
          <div className="cauldron-cycles">
            {Array.from({ length: timerState.totalCycles }).map((_, i) => (
              <div
                key={i}
                className={`cauldron-cycle-dot${
                  i + 1 < timerState.currentCycle
                    ? ' completed'
                    : i + 1 === timerState.currentCycle
                      ? ' active'
                      : ''
                }`}
              />
            ))}
          </div>

          {/* Ticker */}
          <div className="cauldron-ticker">
            <div className="cauldron-ticker-content">
              {tickerMessages.map((msg, i) => (
                <span key={i} className="cauldron-ticker-text">
                  {msg}
                </span>
              ))}
              {/* Duplicate for seamless loop */}
              {tickerMessages.map((msg, i) => (
                <span key={`d-${i}`} className="cauldron-ticker-text">
                  {msg}
                </span>
              ))}
            </div>
          </div>
        </>
      )}

      {/* === CONTROLS === */}
      <div className="cauldron-controls">
        {isIdle && (
          <button className="rpg-button" onClick={handleStart} disabled={!selectedPresetId}>
            {t('cauldron.startBrew', 'Start Brew')}
          </button>
        )}
        {isRunning && (
          <>
            <button className="rpg-button" onClick={handlePause}>
              {t('cauldron.pause', 'Pause')}
            </button>
            <button className="rpg-button" onClick={handleSkip}>
              {t('cauldron.skip', 'Skip')}
            </button>
            <button className="rpg-button" onClick={handleStop}>
              {t('cauldron.stop', 'Stop')}
            </button>
          </>
        )}
        {isPaused && (
          <>
            <button className="rpg-button" onClick={handleResume}>
              {t('cauldron.resume', 'Resume')}
            </button>
            <button className="rpg-button" onClick={handleSkip}>
              {t('cauldron.skip', 'Skip')}
            </button>
            <button className="rpg-button" onClick={handleStop}>
              {t('cauldron.stop', 'Stop')}
            </button>
          </>
        )}
      </div>

      {/* === STATS === */}
      <div className="cauldron-stats" ref={statsRef}>
        <div className="cauldron-stats-title">
          {t('cauldron.stats.title', 'Brewing Log')}
        </div>
        <div className="cauldron-stats-grid">
          <div className="cauldron-stat">
            <div className="cauldron-stat-value">
              <AnimatedNumber value={stats.today} prefix="" />
            </div>
            <div className="cauldron-stat-label">{t('cauldron.stats.today', 'Today')}</div>
          </div>
          <div className="cauldron-stat">
            <div className="cauldron-stat-value">
              <AnimatedNumber value={stats.week} prefix="" />
            </div>
            <div className="cauldron-stat-label">{t('cauldron.stats.week', 'This Week')}</div>
          </div>
          <div className="cauldron-stat">
            <div className="cauldron-stat-value">
              <AnimatedNumber value={stats.total} prefix="" />
            </div>
            <div className="cauldron-stat-label">{t('cauldron.stats.total', 'Total')}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
