import { useState, memo, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { registerFood } from '../../../shared/animations/feedback';

interface FoodEntry {
  id: number; time: string; description: string; calories: number;
  source: string;
}

interface Props {
  entry: FoodEntry;
  onDelete: (id: number) => void;
  onUpdate: (id: number, fields: { description?: string; calories?: number }) => void;
  readOnly?: boolean;
  className?: string;
  isNew?: boolean;
}

export default memo(function FoodLogItem({ entry, onDelete, onUpdate, readOnly, className, isNew }: Props) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editCals, setEditCals] = useState(String(entry.calories));
  const [editDesc, setEditDesc] = useState(entry.description);
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isNew && rowRef.current) {
      registerFood(rowRef.current);
    }
  // Only fire on mount when isNew is true
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sourceIcon = entry.source === 'ai_estimate'
    ? <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--rpg-gold-dark)" strokeWidth="1.2" strokeLinecap="round"><circle cx="7" cy="7" r="5"/><path d="M7 4v3l2 1"/></svg>
    : entry.source === 'frequent'
    ? <svg width="14" height="14" viewBox="0 0 14 14" fill="var(--rpg-gold)" strokeWidth="0"><path d="M7 1l1.8 3.6L13 5.3l-3 2.9.7 4.1L7 10.2 3.3 12.3l.7-4.1-3-2.9 4.2-.7z"/></svg>
    : <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--rpg-gold-dark)" strokeWidth="1.2" strokeLinecap="round"><path d="M10 2l2 2M4 8l6-6 2 2-6 6H4V8z"/></svg>;

  const handleSave = () => {
    const newCals = parseInt(editCals);
    if (isNaN(newCals) || newCals <= 0) return;
    onUpdate(entry.id, { description: editDesc.trim() || entry.description, calories: newCals });
    setEditing(false);
  };

  if (editing) {
    return (
      <div ref={rowRef} className={`nutri-pulse-gold ${className || ''}`} style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0',
        borderBottom: '1px solid var(--rpg-parchment-dark)',
      }}>
        <input value={editDesc} onChange={(e) => setEditDesc(e.target.value)}
          className="rpg-input" style={{ flex: 1, padding: '4px 6px', fontSize: '0.85rem' }} />
        <input type="number" value={editCals} onChange={(e) => setEditCals(e.target.value)}
          className="rpg-input" style={{ width: 60, padding: '4px 6px', fontSize: '0.85rem' }}
          onKeyDown={(e) => e.key === 'Enter' && handleSave()} />
        <button className="rpg-button" onClick={handleSave} style={{ padding: '3px 8px', fontSize: '0.75rem' }}>{t('common.ok')}</button>
        <button className="rpg-button" onClick={() => setEditing(false)} style={{ padding: '3px 8px', fontSize: '0.75rem', opacity: 0.6 }}>
          <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="2" y1="2" x2="8" y2="8"/><line x1="8" y1="2" x2="2" y2="8"/></svg>
        </button>
      </div>
    );
  }

  return (
    <div ref={rowRef} className={className || ''} style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
      borderBottom: '1px solid var(--rpg-parchment-dark)',
    }}>
      <span style={{ fontSize: '0.8rem', opacity: 0.5, minWidth: 45 }}>{entry.time}</span>
      <span>{sourceIcon}</span>
      <span style={{ flex: 1 }}>{entry.description}</span>
      <span style={{ fontFamily: 'Fira Code, monospace', fontWeight: 'bold' }}>{entry.calories}</span>
      <span style={{ fontSize: '0.75rem', opacity: 0.5 }}>kcal</span>
      {!readOnly && <>
      <svg onClick={() => setEditing(true)} width="12" height="12" viewBox="0 0 12 12" fill="none"
        stroke="var(--rpg-gold-dark)" strokeWidth="1.2" strokeLinecap="round"
        style={{ cursor: 'pointer', opacity: 0.4, transition: 'opacity 0.2s' }}
        onMouseOver={(e) => (e.currentTarget.style.opacity = '1')}
        onMouseOut={(e) => (e.currentTarget.style.opacity = '0.4')}>
        <path d="M8.5 1.5l2 2M3 7l5.5-5.5 2 2L5 9H3V7z"/>
      </svg>
      {confirmDelete ? (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '4px 10px', background: 'rgba(139,32,32,0.1)',
          border: '1px solid var(--rpg-hp-red)', borderRadius: 'var(--rpg-radius)',
        }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--rpg-hp-red)', whiteSpace: 'nowrap' }}>
            {t('nutrify.deleteConfirm')}
          </span>
          <button className="rpg-button" onClick={() => onDelete(entry.id)}
            style={{ background: 'var(--rpg-hp-red)', padding: '3px 10px', fontSize: '0.8rem' }}>
            {t('questify.delete')}
          </button>
          <button className="rpg-button" onClick={() => setConfirmDelete(false)}
            style={{ padding: '3px 10px', fontSize: '0.8rem', opacity: 0.7 }}>
            {t('questify.cancel')}
          </button>
        </div>
      ) : (
        <svg onClick={() => setConfirmDelete(true)} width="12" height="12" viewBox="0 0 12 12"
          stroke="var(--rpg-hp-red)" strokeWidth="1.5" strokeLinecap="round"
          style={{ cursor: 'pointer', opacity: 0.4, transition: 'opacity 0.2s' }}
          onMouseOver={(e) => (e.currentTarget.style.opacity = '0.8')}
          onMouseOut={(e) => (e.currentTarget.style.opacity = '0.4')}>
          <line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/>
        </svg>
      )}
      </>}
    </div>
  );
});
