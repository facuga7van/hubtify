import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '../../../shared/components/ConfirmDialog';
import type { HabitWithStreak, HabitFrequency } from '../types';
import { playTaskComplete } from '../../../shared/audio';
import { formatDateString } from '../../../../shared/date-utils';

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
  const confirm = useConfirm();
  const [habits, setHabits] = useState<HabitWithStreak[]>([]);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newFreq, setNewFreq] = useState<HabitFrequency>('daily');
  const [newTimes, setNewTimes] = useState(1);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editFreq, setEditFreq] = useState<HabitFrequency>('daily');
  const [editTimes, setEditTimes] = useState(1);
  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem('questify_habits_collapsed') === 'true';
  });

  const loadHabits = useCallback(async () => {
    const result = await window.api.questsGetHabits();
    setHabits(result as HabitWithStreak[]);
  }, []);

  useEffect(() => { loadHabits(); }, [loadHabits]);

  // Refresh when remote sync brings new data
  useEffect(() => {
    const handler = () => loadHabits();
    window.addEventListener('sync:questsUpdated', handler);
    return () => window.removeEventListener('sync:questsUpdated', handler);
  }, [loadHabits]);

  const toggleCollapsed = () => {
    setCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('questify_habits_collapsed', String(next));
      return next;
    });
  };

  const handleCheck = async (habitId: string) => {
    const habit = habits.find(h => h.id === habitId);
    if (!habit) return;
    const result = await window.api.questsCheckHabit(habitId);

    if (result.checked) {
      // XP only when this check completes the period target
      const justCompletedPeriod = habit.checksThisPeriod + 1 >= habit.targetThisPeriod
        && habit.checksThisPeriod < habit.targetThisPeriod;
      if (justCompletedPeriod) {
        const streak = habit.streak + 1;
        const xp = 5 + Math.min(streak, 10);
        await window.api.processRpgEvent({
          type: 'HABIT_CHECKED', moduleId: 'quests',
          payload: { xp, hp: 0, habitId },
          timestamp: Date.now(),
        });
        onXpGained();
        window.dispatchEvent(new Event('rpg:statsChanged'));
      }
      playTaskComplete();
    } else {
      // Remove XP only if unchecking drops below the target
      const droppedBelowTarget = habit.checksThisPeriod === habit.targetThisPeriod;
      if (droppedBelowTarget) {
        await window.api.processRpgEvent({
          type: 'HABIT_UNCHECKED', moduleId: 'quests',
          payload: { xp: -5, hp: 0, habitId },
          timestamp: Date.now(),
        });
        window.dispatchEvent(new Event('rpg:statsChanged'));
      }
    }
    await loadHabits();
    window.dispatchEvent(new Event('quests:dataChanged'));
  };

  const isDuplicateName = (name: string, excludeId?: string) => {
    return habits.some(h => h.name.toLowerCase() === name.toLowerCase() && h.id !== excludeId);
  };

  const handleAdd = async () => {
    if (!newName.trim() || isDuplicateName(newName.trim())) return;
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
    // monthly
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

  if (habits.length === 0 && !adding) {
    return (
      <div style={{ marginBottom: 16 }}>
        <button className="rpg-button" onClick={() => setAdding(true)}
          style={{ fontSize: '0.8rem', padding: '4px 10px', opacity: 0.6 }}>
          + {t('questify.addHabit')}
        </button>
      </div>
    );
  }

  return (
    <div className="rpg-card" style={{ marginBottom: 16 }}>
      {/* Header — collapsible */}
      <div onClick={toggleCollapsed}
        style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
          style={{ transition: 'transform 0.2s', transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)', opacity: 0.4 }}>
          <path d="M3 1l4 4-4 4"/>
        </svg>
        <div className="rpg-card-title" style={{ margin: 0, flex: 1 }}>
          {t('questify.habits')}
        </div>
        <span style={{ fontSize: '0.75rem', opacity: 0.4, fontFamily: 'Fira Code, monospace' }}>
          {habits.filter(h => isPeriodComplete(h)).length}/{habits.length}
        </span>
        <button className="rpg-button" onClick={(e) => { e.stopPropagation(); setAdding(!adding); }}
          style={{ padding: '2px 8px', fontSize: '0.75rem' }}>
          +
        </button>
      </div>

      {/* Habit list */}
      {!collapsed && habits.map((h) => (
        <div key={h.id} style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0',
          borderBottom: '1px solid var(--rpg-parchment-dark)',
        }}>
          {editingId === h.id ? (
            <>
              <input className="rpg-input" value={editName} onChange={(e) => setEditName(e.target.value)}
                style={{ flex: 1, fontSize: '0.85rem' }} autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') handleEditSave(); if (e.key === 'Escape') setEditingId(null); }} />
              <select value={editFreq} onChange={(e) => setEditFreq(e.target.value as HabitFrequency)}
                className="rpg-select" style={{ fontSize: '0.75rem' }}>
                {Object.entries(FREQ_LABEL_KEYS).map(([k, v]) => (
                  <option key={k} value={k}>{t(v)}</option>
                ))}
              </select>
              {editFreq === 'weekly' && (
                <input type="number" min={1} max={7} value={editTimes}
                  onChange={(e) => setEditTimes(Math.min(7, Math.max(1, parseInt(e.target.value) || 1)))}
                  className="rpg-input" style={{ width: 36, textAlign: 'center', fontSize: '0.8rem' }} />
              )}
              <button className="rpg-button" onClick={handleEditSave}
                disabled={!editName.trim() || isDuplicateName(editName.trim(), editingId)}
                style={{ padding: '2px 8px', fontSize: '0.75rem' }}>OK</button>
              <button className="rpg-button" onClick={() => setEditingId(null)}
                style={{ padding: '2px 6px', fontSize: '0.75rem', opacity: 0.6 }}>
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M1 1l6 6M7 1l-6 6"/>
                </svg>
              </button>
            </>
          ) : (
            <>
              <span onClick={() => startEdit(h)} style={{
                flex: 1, fontWeight: isPeriodComplete(h) ? 'normal' : 'bold',
                opacity: isPeriodComplete(h) ? 0.6 : 1,
                textDecoration: isPeriodComplete(h) ? 'line-through' : 'none',
                cursor: 'pointer',
              }} title={t('questify.edit')}>
                {h.name}
              </span>

              {/* Frequency label */}
              <span style={{
                fontSize: '0.65rem', padding: '1px 5px', borderRadius: 3,
                background: 'var(--rpg-parchment-dark)', color: 'var(--rpg-ink-light)',
              }}>
                {getFreqLabel(h)}
              </span>

              {/* Progress for weekly/monthly */}
              {getProgressLabel(h) && (
                <span style={{ fontSize: '0.7rem', fontFamily: 'Fira Code, monospace', opacity: 0.6, cursor: 'default' }}
                  title={getResetDate(h) ? t('questify.resetsOn', { date: getResetDate(h) }) : undefined}>
                  {getProgressLabel(h)}
                </span>
              )}

              {/* Streak */}
              {h.streak > 0 && (
                <span style={{
                  fontSize: '0.7rem', fontFamily: 'Fira Code, monospace',
                  color: h.streak >= 10 ? 'var(--rpg-gold)' : 'var(--rpg-ink-light)',
                  opacity: 0.7, display: 'flex', alignItems: 'center', gap: 2,
                }}>
                  <svg width="10" height="10" viewBox="0 0 14 14" fill={h.streak >= 10 ? 'var(--rpg-gold)' : '#e67e22'} style={{ flexShrink: 0 }}>
                    <path d="M7 1c-1 1.5-3.5 3.5-3.5 6a3.5 3.5 0 007 0c0-1-.5-1.8-1.3-2.6.4.8.4 1.7-.4 2.6-.9-.9-.9-2.6-1.8-3.5-.4 1.3-.9 2.2-.9 3a1.3 1.3 0 002.6 0c0-.4-.3-1.3-.9-2.2z"/>
                  </svg>
                  {h.streak}
                </span>
              )}

              {/* Check button */}
              <button onClick={() => handleCheck(h.id)}
                style={{
                  width: 24, height: 24, borderRadius: 4, cursor: 'pointer',
                  border: `2px solid ${h.checkedToday ? 'var(--rpg-gold)' : 'var(--rpg-wood)'}`,
                  background: h.checkedToday ? 'var(--rpg-gold)' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.15s ease',
                }}>
                {h.checkedToday && (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--rpg-ink)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 7l3 3 5-6"/>
                  </svg>
                )}
              </button>

              {/* Delete */}
              <svg onClick={() => handleDelete(h.id)} width="12" height="12" viewBox="0 0 14 14"
                style={{ cursor: 'pointer', opacity: 0.3, transition: 'opacity 0.2s', flexShrink: 0 }}
                onMouseOver={(e) => (e.currentTarget.style.opacity = '0.7')}
                onMouseOut={(e) => (e.currentTarget.style.opacity = '0.3')}
                fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
                <path d="M2 4h10M5 4V2.5h4V4M3.5 4l.7 8h5.6l.7-8"/>
              </svg>
            </>
          )}
        </div>
      ))}

      {/* Add form */}
      {!collapsed && adding && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t('questify.habitName')}
            className="rpg-input"
            style={{ flex: 1, minWidth: 120 }}
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          />
          <select value={newFreq} onChange={(e) => setNewFreq(e.target.value as HabitFrequency)}
            className="rpg-select" style={{ fontSize: '0.85rem' }}>
            {Object.entries(FREQ_LABEL_KEYS).map(([k, v]) => (
              <option key={k} value={k}>{t(v)}</option>
            ))}
          </select>
          {newFreq === 'weekly' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="number" min={1} max={7} value={newTimes}
                onChange={(e) => setNewTimes(Math.min(7, Math.max(1, parseInt(e.target.value) || 1)))}
                className="rpg-input" style={{ width: 40, textAlign: 'center' }} />
              <span style={{ fontSize: '0.8rem', opacity: 0.6 }}>{t('questify.timesPerWeek')}</span>
            </div>
          )}
          <button className="rpg-button" onClick={handleAdd} disabled={!newName.trim()}
            style={{ padding: '4px 10px', fontSize: '0.8rem' }}>
            OK
          </button>
          <button className="rpg-button" onClick={() => setAdding(false)}
            style={{ padding: '4px 8px', fontSize: '0.8rem', opacity: 0.6 }}>
            {t('questify.cancel')}
          </button>
        </div>
      )}
    </div>
  );
}
