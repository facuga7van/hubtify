import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '../../../shared/components/ConfirmDialog';
import { useToast } from '../../../shared/components/useToast';
import { Tick } from '../../../shared/components/codex/CodexPrimitives';
import { HeatmapCalendar, type CellLevel } from '../../../shared/components/charts/HeatmapCalendar';
import type { HabitWithStreak, HabitFrequency } from '../types';
import { bonusMultiplierToTier } from '../utils';
import { playTaskComplete } from '../../../shared/audio';
import { formatDateString } from '../../../../shared/date-utils';
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
    const habit = habits.find(h => h.id === habitId);
    if (!habit) return;
    const result = await window.api.questsCheckHabit(habitId);

    if (result.checked) {
      const justCompletedPeriod = habit.checksThisPeriod + 1 >= habit.targetThisPeriod
        && habit.checksThisPeriod < habit.targetThisPeriod;
      if (justCompletedPeriod) {
        const streak = habit.streak + 1;
        const xp = 5 + Math.min(streak, 10);
        const rpgResult = await window.api.processRpgEvent({
          type: 'HABIT_CHECKED', moduleId: 'quests',
          payload: { xp, hp: 0, habitId },
          timestamp: Date.now(),
        });
        toast({ type: 'xp', message: `+${rpgResult.xpGained} XP`, details: { xp: rpgResult.xpGained, bonusTier: bonusMultiplierToTier(rpgResult.bonusMultiplier), comboMultiplier: rpgResult.comboMultiplier, streakMilestone: rpgResult.milestoneXp || undefined } });
        onXpGained();
        window.dispatchEvent(new Event('rpg:statsChanged'));
      }
      playTaskComplete();
    } else {
      const droppedBelowTarget = habit.checksThisPeriod === habit.targetThisPeriod;
      if (droppedBelowTarget) {
        await window.api.processRpgEvent({
          type: 'HABIT_UNCHECKED', moduleId: 'quests',
          payload: { xp: -5, hp: 0, habitId },
          timestamp: Date.now(),
        });
        toast({ type: 'warning', message: t('questify.habitUnchecked', 'Habit unchecked — XP deducted') });
        window.dispatchEvent(new Event('rpg:statsChanged'));
      }
    }
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
    if (!editingId || !editName.trim() || isDuplicateName(editName.trim(), editingId)) return;
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

  if (loading) return null;

  if (habits.length === 0 && !adding) {
    return (
      <div>
        <p style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', fontSize: 'var(--fs-label)', color: 'var(--ink-faded)', marginBottom: 8 }}>
          {t('questify.habitsEmptyHint', 'Rituales diarios o semanales que querés mantener.')}
        </p>
        <span className="qb-rune" style={{ cursor: 'pointer' }} onClick={() => setAdding(true)}>
          + {t('questify.addHabit')}
        </span>
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
        <span className="qb-rune" style={{ cursor: 'pointer', fontSize: 'var(--fs-label)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, minWidth: 22, minHeight: 22 }} onClick={() => setAdding(!adding)}>+</span>
      </div>

      {/* Habit list */}
      {habits.slice(page * HABITS_PER_PAGE, (page + 1) * HABITS_PER_PAGE).map((h) => (
        <div key={h.id} className="quest-habit-row">
          {editingId === h.id ? (
            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <input className="subtask-input" value={editName} onChange={(e) => setEditName(e.target.value)}
                style={{ flex: 1, minWidth: 80 }} autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') handleEditSave(); if (e.key === 'Escape') setEditingId(null); }} />
              <select value={editFreq} onChange={(e) => setEditFreq(e.target.value as HabitFrequency)}
                className="subtask-input" style={{ fontSize: 'var(--fs-label)' }}>
                {Object.entries(FREQ_LABEL_KEYS).map(([k, v]) => (
                  <option key={k} value={k}>{t(v)}</option>
                ))}
              </select>
              {editFreq === 'weekly' && (
                <RpgStepper value={editTimes} onChange={setEditTimes} min={1} max={7} />
              )}
              <span className="qb-rune qb-rune--sage" style={{ cursor: 'pointer' }} onClick={handleEditSave}>OK</span>
              <span className="qb-rune" style={{ cursor: 'pointer' }} onClick={() => setEditingId(null)}>
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M1 1l6 6M7 1l-6 6"/>
                </svg>
              </span>
            </div>
          ) : (
            <>
              <span
                className={`quest-habit-name${isPeriodComplete(h) ? ' quest-habit-name--done' : ''}`}
                onClick={() => startEdit(h)}
                title={t('questify.edit')}
              >
                {h.name}
              </span>

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

                {/* Check button — using Tick component */}
                <Tick
                  checked={h.checkedToday}
                  onChange={() => handleCheck(h.id)}
                  label={h.name}
                />

                {/* Edit */}
                <svg onClick={() => startEdit(h)} width="10" height="10" viewBox="0 0 16 16"
                  className="quest-icon-hover"
                  style={{ cursor: 'pointer', opacity: 0.25, flexShrink: 0 }}
                  fill="none" stroke="var(--ink-faded)" strokeWidth="1.3" strokeLinecap="round"
                  role="button" tabIndex={0} aria-label={t('questify.edit', 'Edit')}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startEdit(h); } }}>
                  <path d="M11.5 2.5l2 2M4 10l7-7 2 2-7 7H4v-2z"/>
                </svg>

                {/* Delete */}
                <svg onClick={() => handleDelete(h.id)} width="10" height="10" viewBox="0 0 14 14"
                  className="quest-icon-hover"
                  style={{ cursor: 'pointer', opacity: 0.25, flexShrink: 0 }}
                  fill="none" stroke="var(--ink-faded)" strokeWidth="1.3" strokeLinecap="round"
                  role="button" tabIndex={0} aria-label={t('questify.deleteHabit', 'Delete habit')}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleDelete(h.id); } }}>
                  <path d="M2 4h10M5 4V2.5h4V4M3.5 4l.7 8h5.6l.7-8"/>
                </svg>
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
            <span
              className="qb-rune"
              style={{ cursor: page > 0 ? 'pointer' : 'default', opacity: page > 0 ? 1 : 0.3 }}
              onClick={() => page > 0 && setPage(page - 1)}
            >
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M5 1L2 4l3 3"/></svg>
            </span>
            <span className="qb-hand" style={{ color: 'var(--ink-faded)' }}>
              {page + 1}/{totalPages}
            </span>
            <span
              className="qb-rune"
              style={{ cursor: page < totalPages - 1 ? 'pointer' : 'default', opacity: page < totalPages - 1 ? 1 : 0.3 }}
              onClick={() => page < totalPages - 1 && setPage(page + 1)}
            >
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 1l3 3-3 3"/></svg>
            </span>
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
            className="subtask-input"
            style={{ flex: 1, minWidth: 100 }}
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setAdding(false); }}
          />
          <select value={newFreq} onChange={(e) => setNewFreq(e.target.value as HabitFrequency)}
            className="subtask-input" style={{ fontSize: 'var(--fs-label)' }}>
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
          <span className="qb-rune qb-rune--sage" style={{ cursor: 'pointer' }} onClick={handleAdd}>OK</span>
          <span className="qb-rune" style={{ cursor: 'pointer' }} onClick={() => setAdding(false)}>
            {t('questify.cancel')}
          </span>
        </div>
      )}

      {/* Heatmap calendar (collapsible) */}
      {habits.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div
            className="quest-project-header"
            style={{ padding: '4px 6px', cursor: 'pointer' }}
            onClick={() => setHeatmapOpen(!heatmapOpen)}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
              style={{ transition: 'transform 0.2s', transform: heatmapOpen ? 'rotate(90deg)' : 'rotate(0deg)', opacity: 0.5 }}>
              <path d="M3 1l4 4-4 4"/>
            </svg>
            <span className="quest-project-header-name">
              {t('questify.habitHeatmap', 'Activity Map')}
            </span>
            <HelpBubble variant="inline" text={t('questify.heatmapHelp', 'Mapa de actividad de los últimos 30 días. Los colores más intensos indican más hábitos completados ese día.')} />
          </div>
          {heatmapOpen && heatmapData.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <HeatmapCalendar data={heatmapData} startDate={heatmapStart} columns={7} legend />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
