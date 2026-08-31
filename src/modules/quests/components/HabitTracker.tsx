import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '../../../shared/components/ConfirmDialog';
import { useToast } from '../../../shared/components/useToast';
import { Tick } from '../../../shared/components/codex/CodexPrimitives';
import { HeatmapCalendar, type CellLevel } from '../../../shared/components/charts/HeatmapCalendar';
import { Shield } from '../../../shared/components/icons/CodexIcons';
import type { HabitWithStreak, HabitFrequency } from '../types';
import { MAX_HABIT_SHIELDS } from '../types';
import { processHabitCheck, isHabitPeriodComplete } from '../utils';
import { questsApi } from '../api';
import { formatDateString, daysAgoDateString } from '../../../../shared/date-utils';
import HelpBubble from '../../../shared/components/HelpBubble';
import RpgStepper from '../../../shared/components/RpgStepper';
import HabitDayPicker, { weekdayLetter } from './HabitDayPicker';
import HabitRowMenu from './HabitRowMenu';

interface Props {
  onXpGained: () => void;
}

const FREQ_LABEL_KEYS: Record<HabitFrequency, string> = {
  daily: 'questify.frequency.daily',
  weekly: 'questify.frequency.weekly',
  monthly: 'questify.frequency.monthly',
};

/** ISO weekday (1 = Monday … 7 = Sunday) of today, for highlighting. */
function todayIsoWeekday(): number {
  const d = new Date().getDay();
  return d === 0 ? 7 : d;
}

export default function HabitTracker({ onXpGained }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [habits, setHabits] = useState<HabitWithStreak[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newFreq, setNewFreq] = useState<HabitFrequency>('daily');
  const [newTimes, setNewTimes] = useState(1);
  // A weekly habit is expressed EITHER as "N times" OR as named days, never
  // both — saving one clears the other (see handleAdd / handleEditSave).
  const [newDays, setNewDays] = useState<number[]>([]);
  const [newByDays, setNewByDays] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editFreq, setEditFreq] = useState<HabitFrequency>('daily');
  const [editTimes, setEditTimes] = useState(1);
  const [editDays, setEditDays] = useState<number[]>([]);
  const [editByDays, setEditByDays] = useState(false);
  const HABITS_PER_PAGE = 10;
  const [page, setPage] = useState(0);
  const [heatmapOpen, setHeatmapOpen] = useState(false);
  const [heatmapData, setHeatmapData] = useState<CellLevel[]>([]);
  const [heatmapStart, setHeatmapStart] = useState('');

  const loadHabits = useCallback(async () => {
    try {
      const result = await window.api.questsGetHabits();
      setHabits(result as HabitWithStreak[]);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  const loadHeatmap = useCallback(async () => {
    const { days, totalHabits } = await questsApi().questsGetHabitHeatmap(30);
    if (totalHabits === 0) { setHeatmapData([]); return; }
    const todayStr = formatDateString(new Date());
    if (days.length > 0) setHeatmapStart(days[0].date);
    const cells: CellLevel[] = days.map(d => {
      if (d.date === todayStr) return 'today';
      // A day whose only activity was a skip is neither earned nor missed.
      // 'miss' is the calendar's one spare slot; quests.css re-tints it to a
      // neutral tone inside .quest-habit-heatmap (and the legend is ours).
      if (d.count === 0) return d.skipCount > 0 ? 'miss' : 'l0';
      const ratio = d.count / totalHabits;
      if (ratio >= 1) return 'l4';
      if (ratio >= 0.75) return 'l3';
      if (ratio >= 0.5) return 'l2';
      return 'l1';
    });
    setHeatmapData(cells);
  }, []);

  useEffect(() => { loadHabits(); }, [loadHabits]);
  useEffect(() => { if (heatmapOpen) loadHeatmap(); }, [heatmapOpen, loadHeatmap]);

  useEffect(() => {
    const handler = () => { loadHabits(); if (heatmapOpen) loadHeatmap(); };
    window.addEventListener('sync:questsUpdated', handler);
    return () => window.removeEventListener('sync:questsUpdated', handler);
  }, [loadHabits, loadHeatmap, heatmapOpen]);

  useEffect(() => {
    const handler = () => { loadHabits(); if (heatmapOpen) loadHeatmap(); };
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
  }, [loadHabits, loadHeatmap, heatmapOpen]);

  const handleCheck = async (habitId: string) => {
    await processHabitCheck(habitId, habits, { toast, t, onXpGained });
    await loadHabits();
    if (heatmapOpen) loadHeatmap();
  };

  const canRetroCheck = useCallback((h: HabitWithStreak): boolean => {
    // Only show badge if yesterday was NOT checked (checkedToday is irrelevant)
    if (h.checkedYesterday) return false;
    // Catching up on yesterday is a first-thing-in-the-morning action. Past noon
    // the badge is just noise repeated on nearly every row.
    if (new Date().getHours() >= 12) return false;
    if (h.frequency === 'daily') return true;
    if (h.frequency === 'weekly') {
      // A habit pinned to Mon/Wed/Fri has nothing to catch up on a Wednesday:
      // yesterday was a Tuesday, and a check there would not count anyway.
      if (h.specificDays && h.specificDays.length > 0) {
        const dow = new Date().getDay() || 7;
        const yesterdayDow = dow === 1 ? 7 : dow - 1;
        if (!h.specificDays.includes(yesterdayDow)) return false;
      }
      // Yesterday must be in current week (today is NOT Monday)
      return new Date().getDay() !== 1;
    }
    if (h.frequency === 'monthly') {
      // Yesterday must be in current month (today is NOT the 1st)
      return new Date().getDate() !== 1;
    }
    return false;
  }, []);

  const handleRetroCheck = async (habitId: string) => {
    const yesterday = daysAgoDateString(1);
    await processHabitCheck(habitId, habits, { toast, t, onXpGained }, yesterday);
    await loadHabits();
    if (heatmapOpen) loadHeatmap();
  };

  /**
   * Skipping is the flu/travel escape hatch: the day is bridged, the streak
   * survives, and nothing is awarded — an honest "not today", not a fake check.
   */
  const handleSkip = async (h: HabitWithStreak) => {
    const { skipped } = await questsApi().questsSkipHabit(h.id);
    toast({
      type: 'info',
      message: skipped
        ? t('questify.habitSkippedToast', 'Día salteado — la racha sigue en pie')
        : t('questify.habitUnskippedToast', 'Día ya no salteado'),
    });
    await loadHabits();
    if (heatmapOpen) loadHeatmap();
    window.dispatchEvent(new Event('quests:dataChanged'));
  };

  const isDuplicateName = (name: string, excludeId?: string) => {
    return habits.some(h => h.name.toLowerCase() === name.toLowerCase() && h.id !== excludeId);
  };

  const handleAdd = async () => {
    if (!newName.trim()) return;
    if (isDuplicateName(newName.trim())) {
      toast({ type: 'warning', message: t('questify.habitDuplicate', 'Ya existe un hábito con ese nombre') });
      return;
    }
    const useDays = newFreq === 'weekly' && newByDays && newDays.length > 0;
    await questsApi().questsAddHabit({
      name: newName.trim(),
      frequency: newFreq,
      timesPerWeek: useDays ? newDays.length : (newFreq === 'weekly' ? newTimes : 1),
      specificDays: useDays ? newDays : null,
    });
    setNewName('');
    setNewFreq('daily');
    setNewTimes(1);
    setNewDays([]);
    setNewByDays(false);
    setAdding(false);
    await loadHabits();
    window.dispatchEvent(new Event('quests:dataChanged'));
  };

  const startEdit = (h: HabitWithStreak) => {
    setEditingId(h.id);
    setEditName(h.name);
    setEditFreq(h.frequency);
    setEditTimes(h.timesPerWeek);
    setEditDays(h.specificDays ?? []);
    setEditByDays(!!h.specificDays && h.specificDays.length > 0);
  };

  const handleEditSave = async () => {
    if (!editingId || !editName.trim()) return;
    if (isDuplicateName(editName.trim(), editingId)) {
      toast({ type: 'warning', message: t('questify.habitDuplicate', 'Ya existe un hábito con ese nombre') });
      return;
    }
    const useDays = editFreq === 'weekly' && editByDays && editDays.length > 0;
    await questsApi().questsUpdateHabit(editingId, {
      name: editName.trim(),
      frequency: editFreq,
      timesPerWeek: useDays ? editDays.length : (editFreq === 'weekly' ? editTimes : 1),
      specificDays: useDays ? editDays : null,
    });
    setEditingId(null);
    await loadHabits();
    window.dispatchEvent(new Event('quests:dataChanged'));
  };

  const handleDelete = async (id: string) => {
    const ok = await confirm({ message: t('questify.deleteHabitConfirm'), danger: true, confirmText: t('questify.delete') });
    if (!ok) return;
    await window.api.questsDeleteHabit(id);
    await loadHabits();
    window.dispatchEvent(new Event('quests:dataChanged'));
  };

  const getFreqLabel = (h: HabitWithStreak) => {
    // Chosen days speak for themselves — the row renders the letters instead.
    if (h.specificDays && h.specificDays.length > 0) return null;
    if (h.frequency === 'weekly' && h.timesPerWeek > 1) return `${h.timesPerWeek}${t('questify.timesPerWeek')}`;
    return t(FREQ_LABEL_KEYS[h.frequency]);
  };

  const getResetDate = (h: HabitWithStreak): string | null => {
    if (h.frequency === 'daily') return null;
    const now = new Date();
    if (h.frequency === 'weekly') {
      const dow = now.getDay() || 7;
      const nextMonday = new Date(now);
      nextMonday.setDate(now.getDate() + (8 - dow));
      return formatDateString(nextMonday);
    }
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return formatDateString(nextMonth);
  };

  const getProgressLabel = (h: HabitWithStreak) => {
    if (h.frequency === 'daily') return null;
    return `${h.checksThisPeriod}/${h.targetThisPeriod}`;
  };

  const isPeriodComplete = isHabitPeriodComplete;
  const todayDow = todayIsoWeekday();

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {[1, 2, 3].map(i => (
        <div key={i} className="quest-skeleton" style={{ height: 28, animationDelay: `${i * 80}ms` }} />
      ))}
    </div>
  );

  if (habits.length === 0 && !adding) {
    return (
      <div>
        <p style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', fontSize: 'var(--fs-label)', color: 'var(--ink-faded)', marginBottom: 8 }}>
          {t('questify.habitsEmptyHint', 'Rituales diarios o semanales que querés mantener.')}
        </p>
        <button type="button" className="qb-rune quest-rune-btn" onClick={() => setAdding(true)}>
          + {t('questify.addHabit')}
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Completion summary */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span className="quest-habit-progress">
          {habits.filter(h => isPeriodComplete(h)).length}/{habits.length}
        </span>
        <button
          type="button"
          className="qb-rune quest-rune-btn"
          onClick={() => setAdding(!adding)}
          aria-expanded={adding}
        >
          + {t('questify.addHabit')}
        </button>
      </div>

      {/* Habit list */}
      {habits.slice(page * HABITS_PER_PAGE, (page + 1) * HABITS_PER_PAGE).map((h) => (
        <div key={h.id} className="quest-habit-row">
          {editingId === h.id ? (
            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <input className="rpg-input" value={editName} onChange={(e) => setEditName(e.target.value)}
                style={{ flex: 1, minWidth: 80 }} autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') handleEditSave(); if (e.key === 'Escape') setEditingId(null); }} />
              <select value={editFreq} onChange={(e) => setEditFreq(e.target.value as HabitFrequency)}
                className="rpg-input" style={{ fontSize: 'var(--fs-label)' }}>
                {Object.entries(FREQ_LABEL_KEYS).map(([k, v]) => (
                  <option key={k} value={k}>{t(v)}</option>
                ))}
              </select>
              {editFreq === 'weekly' && (
                <>
                  <button
                    type="button"
                    className={`qb-rune quest-rune-btn${editByDays ? ' qb-rune--active' : ''}`}
                    aria-pressed={editByDays}
                    onClick={() => setEditByDays(v => !v)}
                  >
                    {editByDays ? t('questify.chooseDays', 'Elegir dias') : t('questify.timesMode', 'N veces')}
                  </button>
                  {editByDays
                    ? <HabitDayPicker value={editDays} onChange={setEditDays} />
                    : <RpgStepper value={editTimes} onChange={setEditTimes} min={1} max={7} />}
                </>
              )}
              <button type="button" className="qb-rune qb-rune--sage quest-rune-btn tap-target" onClick={handleEditSave}>
                {t('questify.save')}
              </button>
              <button type="button" className="qb-rune quest-rune-btn tap-target" onClick={() => setEditingId(null)}>
                {t('questify.cancel')}
              </button>
            </div>
          ) : (
            <>
              {/* The biggest target in the row does the most common thing: check it. */}
              <button
                type="button"
                className={`quest-habit-name${isPeriodComplete(h) ? ' quest-habit-name--done' : ''}`}
                onClick={() => handleCheck(h.id)}
                title={h.name}
                aria-pressed={isPeriodComplete(h)}
              >
                {h.name}
              </button>

              <div className="quest-habit-right">
                {/* Frequency label */}
                {getFreqLabel(h) && <span className="quest-habit-freq">{getFreqLabel(h)}</span>}

                {/* Chosen days, with the one that is TODAY picked out */}
                {h.specificDays && h.specificDays.length > 0 && (
                  <span className="quest-habit-daytags" aria-label={t('questify.chooseDays', 'Elegir dias')}>
                    {h.specificDays.map(d => (
                      <span
                        key={d}
                        className={`quest-habit-daytag${d === todayDow ? ' quest-habit-daytag--today' : ''}`}
                      >
                        {weekdayLetter(t, d)}
                      </span>
                    ))}
                  </span>
                )}

                {/* Progress for weekly/monthly */}
                {getProgressLabel(h) && (
                  <span className="quest-habit-progress"
                    title={getResetDate(h) ? t('questify.resetsOn', { date: getResetDate(h) }) : undefined}>
                    {getProgressLabel(h)}
                  </span>
                )}

                {/* Streak */}
                {h.streak > 0 && (
                  <span className={`quest-habit-streak${h.streak >= 10 ? ' quest-habit-streak--hot' : ''}`}>
                    <svg width="10" height="10" viewBox="0 0 14 14" fill={h.streak >= 10 ? 'var(--gold)' : 'var(--rubric)'} style={{ flexShrink: 0 }}>
                      <path d="M7 1c-1 1.5-3.5 3.5-3.5 6a3.5 3.5 0 007 0c0-1-.5-1.8-1.3-2.6.4.8.4 1.7-.4 2.6-.9-.9-.9-2.6-1.8-3.5-.4 1.3-.9 2.2-.9 3a1.3 1.3 0 002.6 0c0-.4-.3-1.3-.9-2.2z"/>
                    </svg>
                    {h.streak}
                  </span>
                )}

                {/* Streak shields in the bank */}
                {h.shieldCount > 0 && (
                  <span
                    className="quest-habit-shields"
                    title={t('questify.habitShieldTitle', 'Escudos de racha: {{count}} de {{max}}. Cubren un dia perdido.', { count: h.shieldCount, max: MAX_HABIT_SHIELDS })}
                  >
                    <Shield width={10} height={10} style={{ color: 'var(--moss)', flexShrink: 0 }} />
                    {h.shieldCount}
                  </span>
                )}

                {/* A shield is currently holding this streak together. Discreet
                    on purpose: reassurance, not a celebration. */}
                {h.shieldUsed && (
                  <span
                    className="quest-habit-shield-used"
                    title={t('questify.habitShieldUsed', 'Un escudo cubrio un dia perdido: la racha sigue')}
                  >
                    <Shield width={10} height={10} style={{ color: 'var(--ink-faded)', flexShrink: 0 }} />
                  </span>
                )}

                {/* Today is excused */}
                {h.skippedToday && (
                  <span className="quest-habit-skipped">
                    {t('questify.habitSkippedLabel', 'Salteado')}
                  </span>
                )}

                {/* Retroactive check badge for yesterday */}
                {canRetroCheck(h) && (
                  <button
                    type="button"
                    className="quest-retro-badge"
                    onClick={(e) => { e.stopPropagation(); handleRetroCheck(h.id); }}
                    title={t('questify.retroCheckTitle', 'Marcar hábito de ayer')}
                  >
                    {t('questify.yesterday', 'Ayer')}
                  </button>
                )}
              </div>

              {/* Check button — using Tick component (own fixed column so every
                  row's tick lands on the same X, whatever badges precede it) */}
              <div className="quest-habit-tick">
                <Tick
                  checked={h.checkedToday}
                  onChange={() => handleCheck(h.id)}
                  label={h.name}
                />
              </div>

              {/* Edit / skip / delete, kept clear of the tick by a divider */}
              <div className="quest-habit-actions">
                <HabitRowMenu
                  skipped={h.skippedToday}
                  onEdit={() => startEdit(h)}
                  onSkip={() => handleSkip(h)}
                  onDelete={() => handleDelete(h.id)}
                />
              </div>
            </>
          )}
        </div>
      ))}

      {/* Pagination */}
      {habits.length > HABITS_PER_PAGE && (() => {
        const totalPages = Math.ceil(habits.length / HABITS_PER_PAGE);
        return (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 6, fontSize: 'var(--fs-label)' }}>
            <button
              type="button"
              className="qb-rune quest-rune-btn tap-target"
              style={{ opacity: page > 0 ? 1 : 0.3 }}
              disabled={page === 0}
              aria-label={t('questify.previousPage', 'Página anterior')}
              onClick={() => page > 0 && setPage(page - 1)}
            >
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M5 1L2 4l3 3"/></svg>
            </button>
            <span className="qb-hand" style={{ color: 'var(--ink-faded)' }}>
              {page + 1}/{totalPages}
            </span>
            <button
              type="button"
              className="qb-rune quest-rune-btn tap-target"
              style={{ opacity: page < totalPages - 1 ? 1 : 0.3 }}
              disabled={page >= totalPages - 1}
              aria-label={t('questify.nextPage', 'Página siguiente')}
              onClick={() => page < totalPages - 1 && setPage(page + 1)}
            >
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M3 1l3 3-3 3"/></svg>
            </button>
          </div>
        );
      })()}

      {/* Add form */}
      {adding && (
        <div className="quest-habit-form">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t('questify.habitName')}
            className="rpg-input"
            style={{ flex: 1, minWidth: 100 }}
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setAdding(false); }}
          />
          <select value={newFreq} onChange={(e) => setNewFreq(e.target.value as HabitFrequency)}
            className="rpg-input" style={{ fontSize: 'var(--fs-label)' }}>
            {Object.entries(FREQ_LABEL_KEYS).map(([k, v]) => (
              <option key={k} value={k}>{t(v)}</option>
            ))}
          </select>
          {newFreq === 'weekly' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {/* Two ways to say the same thing, never both at once. */}
              <button
                type="button"
                className={`qb-rune quest-rune-btn${newByDays ? ' qb-rune--active' : ''}`}
                aria-pressed={newByDays}
                onClick={() => setNewByDays(v => !v)}
              >
                {newByDays ? t('questify.chooseDays', 'Elegir dias') : t('questify.timesMode', 'N veces')}
              </button>
              {newByDays ? (
                <HabitDayPicker value={newDays} onChange={setNewDays} />
              ) : (
                <>
                  <RpgStepper value={newTimes} onChange={setNewTimes} min={1} max={7} />
                  <span style={{ fontSize: 'var(--fs-label)', color: 'var(--ink-faded)' }}>{t('questify.timesPerWeek')}</span>
                </>
              )}
            </div>
          )}
          <button type="button" className="qb-rune qb-rune--sage quest-rune-btn tap-target" onClick={handleAdd}>
            {t('questify.save')}
          </button>
          <button type="button" className="qb-rune quest-rune-btn tap-target" onClick={() => setAdding(false)}>
            {t('questify.cancel')}
          </button>
        </div>
      )}

      {/* Heatmap calendar (collapsible) */}
      {habits.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {/* The help bubble sits OUTSIDE the toggle button — asking for help
              used to collapse the very section you were asking about. */}
          <div className="quest-project-header" style={{ padding: '4px 6px' }}>
            <button
              type="button"
              className="quest-project-header-btn"
              onClick={() => setHeatmapOpen(!heatmapOpen)}
              aria-expanded={heatmapOpen}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
                aria-hidden="true"
                style={{ transition: 'transform 0.2s', transform: heatmapOpen ? 'rotate(90deg)' : 'rotate(0deg)', opacity: 0.5 }}>
                <path d="M3 1l4 4-4 4"/>
              </svg>
              <span className="quest-project-header-name">
                {t('questify.habitHeatmap', 'Activity Map')}
              </span>
            </button>
            <HelpBubble variant="inline" text={t('questify.heatmapHelp', 'Mapa de actividad de los últimos 30 días. Los colores más intensos indican más hábitos completados ese día.')} />
          </div>
          {heatmapOpen && (
            <div style={{ marginTop: 6 }}>
              {heatmapData.length > 0 ? (
                <div className="quest-habit-heatmap">
                  {/* Own legend: the shared one labels the spare slot "missed",
                      and inside this calendar that slot means "skipped". */}
                  <HeatmapCalendar data={heatmapData} startDate={heatmapStart} columns={7} legend={false} />
                  <div className="quest-heatmap-legend">
                    <span>{t('common.less', 'Menos')}</span>
                    <span className="heatmap-cell heatmap-cell--l1 quest-heatmap-swatch" />
                    <span className="heatmap-cell heatmap-cell--l3 quest-heatmap-swatch" />
                    <span className="heatmap-cell heatmap-cell--l4 quest-heatmap-swatch" />
                    <span>{t('common.more', 'Mas')}</span>
                    <span className="heatmap-cell heatmap-cell--miss quest-heatmap-swatch" />
                    <span>{t('questify.habitSkippedLabel', 'Salteado')}</span>
                  </div>
                </div>
              ) : (
                <p className="quest-empty" style={{ padding: 8, fontSize: 'var(--fs-label)' }}>
                  {t('questify.heatmapEmpty', 'Todavía no hay actividad registrada.')}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
