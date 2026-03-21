import { useState, useEffect } from 'react';
import type { TaskTier, Subtask } from '../types';

interface Props {
  editing?: Subtask | null;
  onSave: (data: { name: string; description: string; tier: TaskTier }) => void;
  onCancel: () => void;
}

export default function SubtaskInlineForm({ editing, onSave, onCancel }: Props) {
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
        placeholder="Subtask name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={handleKeyDown}
        autoFocus
      />
      <input
        type="text"
        className="subtask-input subtask-input--desc"
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <div className="subtask-tier-buttons">
        <button type="button" className={`subtask-tier-btn ${tier === 1 ? 'tierActive' : ''}`} onClick={() => setTier(1)}>&#x26A1;</button>
        <button type="button" className={`subtask-tier-btn ${tier === 2 ? 'tierActive' : ''}`} onClick={() => setTier(2)}>&#x2694;&#xFE0F;</button>
        <button type="button" className={`subtask-tier-btn ${tier === 3 ? 'tierActive' : ''}`} onClick={() => setTier(3)}>&#x1F409;</button>
      </div>
      <div className="subtask-form-actions">
        <button className="rpg-button" onClick={handleSubmit}>Save</button>
        <button className="rpg-button" onClick={onCancel} style={{ opacity: 0.7 }}>Cancel</button>
      </div>
    </div>
  );
}
