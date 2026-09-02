import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { Subtask } from '../types';
import { XP_MAP, type TaskTier } from '../types';
import { TierBadge, TIER_LABEL } from '../utils';

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
      {/* Same tier vocabulary + XP hint as the quest form, so the two never disagree. */}
      <div className="subtask-tier-buttons">
        {([1, 2, 3] as TaskTier[]).map((tierVal) => (
          <button
            key={tierVal}
            type="button"
            className={`quest-tier-btn${tier === tierVal ? ' quest-tier-btn--active' : ''}`}
            onClick={() => setTier(tierVal)}
          >
            <TierBadge tier={tierVal} size={14} active={tier === tierVal} /> {t(TIER_LABEL[tierVal])}
            <span style={{ fontSize: 'var(--fs-label)', marginLeft: 2 }}>({XP_MAP[tierVal]})</span>
          </button>
        ))}
      </div>
      <div className="subtask-form-actions">
        <button className="rpg-button" onClick={handleSubmit}>{t('questify.save')}</button>
        <button className="rpg-button" onClick={onCancel} style={{ opacity: 0.7 }}>{t('questify.cancel')}</button>
      </div>
    </div>
  );
}
