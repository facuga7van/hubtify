import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskTier, Task } from '../types';
import { TierBadge, TIER_LABEL } from '../utils';

interface Props {
  editingTask: Task | null;
  categories: string[];
  onSaved: () => void;
}

export default function TaskForm({ editingTask, categories, onSaved }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tier, setTier] = useState<TaskTier>(2);
  const [category, setCategory] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [useDate, setUseDate] = useState(false);
  const [newCategory, setNewCategory] = useState('');

  useEffect(() => {
    if (editingTask) {
      setName(editingTask.name);
      setDescription(editingTask.description);
      setTier(editingTask.tier);
      setCategory(editingTask.category);
      setDueDate(editingTask.dueDate ?? '');
      setUseDate(!!editingTask.dueDate);
    } else {
      setName(''); setDescription(''); setTier(2); setCategory(''); setDueDate(''); setUseDate(false);
    }
  }, [editingTask]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const resolvedCategory = category === '__new__' ? newCategory.trim() : category;

    const task: Record<string, unknown> = {
      id: editingTask?.id,
      name: name.trim(),
      description: description.trim(),
      tier,
      category: resolvedCategory,
      dueDate: useDate && dueDate ? dueDate : null,
      order: editingTask?.order ?? 0,
      status: editingTask?.status ?? false,
    };

    await window.api.questsUpsertTask(task);

    if (resolvedCategory && resolvedCategory.trim()) {
      await window.api.questsEnsureCategory(resolvedCategory.trim());
    }

    setName(''); setDescription(''); setTier(2); setNewCategory(''); setCategory(''); setDueDate(''); setUseDate(false);
    onSaved();
  };

  return (
    <form onSubmit={handleSubmit} className="rpg-card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input
          type="text"
          placeholder={t('questify.questName')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rpg-input"
          style={{ flex: 1 }}
          autoFocus
        />
        <button type="submit" className="rpg-button">
          {editingTask ? t('questify.update') : t('questify.addQuest')}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {/* Tier buttons */}
        <div style={{ display: 'flex', gap: 4 }}>
          {([1, 2, 3] as TaskTier[]).map((tierVal) => (
            <button
              key={tierVal}
              type="button"
              onClick={() => setTier(tierVal)}
              style={{
                padding: '4px 10px', border: '1px solid var(--rpg-wood)',
                borderRadius: 'var(--rpg-radius)', cursor: 'pointer',
                background: tier === tierVal ? 'var(--rpg-gold)' : 'var(--rpg-parchment)',
                color: tier === tierVal ? 'var(--rpg-ink)' : 'var(--rpg-ink-light)',
                fontWeight: tier === tierVal ? 'bold' : 'normal',
                display: 'inline-flex', alignItems: 'center', gap: 5,
              }}
            >
              <TierBadge tier={tierVal} size={14} active={tier === tierVal} /> {TIER_LABEL[tierVal]}
            </button>
          ))}
        </div>

        {/* Description */}
        <input
          type="text"
          placeholder={t('questify.description')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="rpg-input"
          style={{ flex: 1, minWidth: 150 }}
        />

        {/* Category — select existing or type new */}
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rpg-select"
          >
            <option value="">{t('questify.noCategory')}</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            <option value="__new__">{t('questify.newCategory')}</option>
          </select>
          {category === '__new__' && (
            <input
              type="text"
              placeholder={t('questify.categoryName')}
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              className="rpg-input"
              style={{ width: 120 }}
              autoFocus
            />
          )}
        </div>

        {/* Due date toggle */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.85rem' }}>
          <input type="checkbox" checked={useDate} onChange={(e) => setUseDate(e.target.checked)} />
          {t('questify.dueDate')}
        </label>
        {useDate && (
          <input type="datetime-local" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
            className="rpg-input" />
        )}
      </div>
    </form>
  );
}
