import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { XP_MAP, type TaskTier, type Task, type Project } from '../types';
import { TierBadge, TIER_LABEL } from '../utils';
import RpgDateTimePicker from '../../../shared/components/RpgDateTimePicker';
import Checkbox from '../../../shared/components/Checkbox';

interface Props {
  editingTask: Task | null;
  categories: string[];
  projects: Project[];
  activeProjectId: string | null;
  onSaved: () => void;
  onCancel?: () => void;
}

export default function TaskForm({ editingTask, categories, projects, activeProjectId, onSaved, onCancel }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tier, setTier] = useState<TaskTier>(2);
  const [category, setCategory] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState('');
  const [useDate, setUseDate] = useState(false);
  const [newCategory, setNewCategory] = useState('');

  useEffect(() => {
    if (editingTask) {
      setName(editingTask.name);
      setDescription(editingTask.description);
      setTier(editingTask.tier);
      setCategory(editingTask.category);
      setProjectId(editingTask.projectId ?? null);
      setDueDate(editingTask.dueDate ?? '');
      setUseDate(!!editingTask.dueDate);
    } else {
      setName(''); setDescription(''); setTier(2); setCategory(''); setDueDate(''); setUseDate(false);
      setProjectId(activeProjectId);
    }
  }, [editingTask, activeProjectId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const resolvedCategory = category === '__new__' ? newCategory.trim() : category;

    const task = {
      id: editingTask?.id,
      name: name.trim(),
      description: description.trim(),
      tier,
      category: resolvedCategory,
      projectId,
      dueDate: useDate && dueDate ? dueDate : null,
      order: editingTask?.order ?? 0,
      status: editingTask?.status ?? false,
    };

    await window.api.questsUpsertTask(task as Record<string, unknown>);

    if (resolvedCategory && resolvedCategory.trim()) {
      await window.api.questsEnsureCategory(resolvedCategory.trim(), projectId);
    }

    setName(''); setDescription(''); setTier(2); setNewCategory(''); setCategory(''); setDueDate(''); setUseDate(false);
    setProjectId(activeProjectId);
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
          onKeyDown={(e) => {
            if (e.key === 'Escape' && onCancel) {
              e.preventDefault();
              onCancel();
            }
          }}
          className="rpg-input"
          style={{ flex: 1 }}
          autoFocus
        />
        <button type="submit" className="rpg-button">
          {editingTask ? t('questify.update') : t('questify.addQuest')}
        </button>
        {editingTask && onCancel && (
          <button
            type="button"
            className="rpg-button"
            onClick={onCancel}
            style={{ opacity: 0.7, fontSize: 'var(--fs-label)' }}
          >
            {t('questify.cancel', 'Cancelar')}
          </button>
        )}
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
                padding: '4px 10px', border: '1px solid var(--leather)',
                borderRadius: '6px', cursor: 'pointer',
                background: tier === tierVal ? 'var(--gold)' : 'var(--parch-0)',
                color: tier === tierVal ? 'var(--ink)' : 'var(--ink-soft)',
                fontWeight: tier === tierVal ? 'bold' : 'normal',
                display: 'inline-flex', alignItems: 'center', gap: 5,
              }}
            >
              <TierBadge tier={tierVal} size={14} active={tier === tierVal} /> {t(TIER_LABEL[tierVal])}
              <span style={{ opacity: 0.7, fontSize: '0.85em', marginLeft: 2 }}>({XP_MAP[tierVal]})</span>
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

        {/* Project */}
        {projects.length > 0 && (
          <select
            value={projectId ?? ''}
            onChange={(e) => {
              const val = e.target.value;
              setProjectId(val || null);
              setCategory('');
            }}
            className="rpg-select"
          >
            <option value="">{t('questify.noProject')}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}

        {/* Category */}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-label)', cursor: 'pointer' }}
          onClick={() => setUseDate(!useDate)}>
          <Checkbox checked={useDate} onChange={() => setUseDate(!useDate)} size={16} />
          <span>{t('questify.dueDate')}</span>
        </div>
        {useDate && (
          <RpgDateTimePicker value={dueDate} onChange={setDueDate} />
        )}
      </div>
    </form>
  );
}
