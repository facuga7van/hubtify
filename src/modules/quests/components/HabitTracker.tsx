import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '../../../shared/components/ConfirmDialog';
import { useToast } from '../../../shared/components/useToast';
import { Tick } from '../../../shared/components/codex/CodexPrimitives';
import { HeatmapCalendar, type CellLevel } from '../../../shared/components/charts/HeatmapCalendar';
import type { HabitWithStreak, HabitFrequency } from '../types';
import { processHabitCheck } from '../utils';
import { formatDateString, daysAgoDateString } from '../../../../shared/date-utils';
import HelpBubble from '../../../shared/components/HelpBubble';
import RpgStepper from '../../../shared/components/RpgStepper';

interface Props {
  onXpGained: () => void;
}

const FREQ_LABEL_KEYS: Record<HabitFrequency, string> = {
  daily: 'questify.frequency.daily',
  weekly: 'questify.frequency.weekly',
  monthly: 'questify.frequency.monthly',
};

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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editFreq, setEditFreq] = useState<HabitFrequency>('daily');
  const [editTimes, setEditTimes] = useState(1);
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
    const { days, totalHabits } = await window.api.questsGetHabitHeatmap(30);
    if (totalHabits === 0) { setHeatmapData([]); return; }
    const todayStr = formatDateString(new Date());
    if (days.length > 0) setHeatmapStart(days[0].date);
    const cells: CellLevel[] = days.map(d => {
      if (d.date === todayStr) return 'today';
      if (d.count === 0) return 'l0';
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

  const isDuplicateName = (name: string, excludeId?: string) => {
    return habits.some(h => h.name.toLowerCase() === name.toLowerCase() && h.id !== excludeId);
  };

  const handleAdd = async () => {
    if (!newName.trim()) return;
    if (isDuplicateName(newName.trim())) {
      toast({ type: 'warning', message: t('questify.habitDuplicate', 'Ya existe un hábito con ese nombre') });
      return;
    }
    await window.api.questsAddHabit({
      name: newName.trim(),
      frequency: newFreq,
      timesPerWeek: newFreq === 'weekly' ? newTimes : 1,
    });
    setNewName('');
    setNewFreq('daily');
    setNewTimes(1);
    setAdding(false);
    await loadHabits();
    window.dispatchEvent(new Event('quests:dataChanged'));
  };

  const startEdit = (h: HabitWithStreak) => {
    setEditingId(h.id);
    setEditName(h.name);
    setEditFreq(h.frequency);
    setEditTimes(h.timesPerWeek);
  };

  const handleEditSave = async () => {
    if (!editingId || !editName.trim()) return;
    if (isDuplicateName(editName.trim(), editingId)) {
      toast({ type: 'warning', message: t('questify.habitDuplicate', 'Ya existe un hábito con ese nombre') });
      return;
    }
    await window.api.questsUpdateHabit(editingId, {
      name: editName.trim(),
      frequency: editFreq,
      timesPerWeek: editFreq === 'weekly' ? editTimes : 1,
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

  const isPeriodComplete = (h: HabitWithStreak) => {
    if (h.frequency === 'daily') return h.checkedToday;
    return h.checksThisPeriod >= h.targetThisPeriod;
  };

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
                <RpgStepper value={editTimes} onChange={setEditTimes} min={1} max={7} />
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
                <span className="quest-habit-freq">{getFreqLabel(h)}</span>

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

              {/* Edit / delete, kept clear of the tick by a divider */}
              <div className="quest-habit-actions">
                <button
                  type="button"
                  className="quest-icon-btn tap-target"
                  onClick={() => startEdit(h)}
                  aria-label={t('questify.edit', 'Edit')}
                  title={t('questify.edit', 'Edit')}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"
                    fill="none" stroke="var(--ink-faded)" strokeWidth="1.3" strokeLinecap="round">
                    <path d="M11.5 2.5l2 2M4 10l7-7 2 2-7 7H4v-2z"/>
                  </svg>
                </button>
                <button
                  type="button"
                  className="quest-icon-btn tap-target"
                  onClick={() => handleDelete(h.id)}
                  aria-label={t('questify.deleteHabit', 'Delete habit')}
                  title={t('questify.deleteHabit', 'Delete habit')}
                >
                  <svg width="16" height="16" viewBox="0 0 14 14" aria-hidden="true"
                    fill="none" stroke="var(--ink-faded)" strokeWidth="1.3" strokeLinecap="round">
                    <path d="M2 4h10M5 4V2.5h4V4M3.5 4l.7 8h5.6l.7-8"/>
                  </svg>
                </button>
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <RpgStepper value={newTimes} onChange={setNewTimes} min={1} max={7} />
              <span style={{ fontSize: 'var(--fs-label)', color: 'var(--ink-faded)' }}>{t('questify.timesPerWeek')}</span>
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
                <HeatmapCalendar data={heatmapData} startDate={heatmapStart} columns={7} legend />
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
