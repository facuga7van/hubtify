import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskTier, Subtask } from '../types';
import { TierBadge } from '../utils';

interface Props {
  editing?: Subtask | null;
  onSave: (data: { name: string; description: string; tier: TaskTier }) => void;
  onCancel: () => void;
}

export default function SubtaskInlineForm({ editing, onSave, onCancel }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tier, setTier] = useState<TaskTier>(2);

  useEffect(() => {
    if (editing) {
      setName(editing.name);
      setDescription(editing.description);
      setTier(editing.tier);
    } else {
      setName('');
      setDescription('');
      setTier(2);
    }
  }, [editing]);

  const handleSubmit = () => {
    if (!name.trim()) return;
    onSave({ name: name.trim(), description: description.trim(), tier });
    if (!editing) {
      setName('');
      setDescription('');
      setTier(2);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); handleSubmit(); }
    if (e.key === 'Escape') onCancel();
  };

  return (
    <div className="subtask-inline-form">
      <input
        type="text"
        className="subtask-input subtask-input--name"
        placeholder={t('questify.subtaskName')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={handleKeyDown}
        autoFocus
      />
      <input
        type="text"
        className="subtask-input subtask-input--desc"
        placeholder={t('questify.description')}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <div className="subtask-tier-buttons">
        <button type="button" className={`subtask-tier-btn ${tier === 1 ? 'tierActive' : ''}`} onClick={() => setTier(1)}><TierBadge tier={1} size={14} /></button>
        <button type="button" className={`subtask-tier-btn ${tier === 2 ? 'tierActive' : ''}`} onClick={() => setTier(2)}><TierBadge tier={2} size={14} /></button>
        <button type="button" className={`subtask-tier-btn ${tier === 3 ? 'tierActive' : ''}`} onClick={() => setTier(3)}><TierBadge tier={3} size={14} /></button>
      </div>
      <div className="subtask-form-actions">
        <button className="rpg-button" onClick={handleSubmit}>{t('questify.save')}</button>
        <button className="rpg-button" onClick={onCancel} style={{ opacity: 0.7 }}>{t('questify.cancel')}</button>
      </div>
    </div>
  );
}
