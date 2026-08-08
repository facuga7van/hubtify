import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { XP_MAP, PROJECT_COLORS, type TaskTier, type Task, type Project } from '../types';
import { TierBadge, TIER_LABEL } from '../utils';
import { parseQuickTask } from '../parseQuickTask';
import RpgDateTimePicker from '../../../shared/components/RpgDateTimePicker';
import RpgStepper from '../../../shared/components/RpgStepper';
import Checkbox from '../../../shared/components/Checkbox';
import { buildRecurrenceRule, parseRecurrenceRule, type RecurrenceFreq, type RecurrenceAnchor } from '../../../../shared/recurrence';
import { todayDateString } from '../../../../shared/date-utils';

interface Props {
  editingTask: Task | null;
  projects: Project[];
  activeProjectId: string | null;
  onSaved: () => void;
  onCancel?: () => void;
  shouldFocus?: boolean;
}

export default function TaskForm({ editingTask, projects, activeProjectId, onSaved, onCancel, shouldFocus }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tier, setTier] = useState<TaskTier>(2);
  const [category, setCategory] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState('');
  const [useDate, setUseDate] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [newProject, setNewProject] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [dismissedQuickDate, setDismissedQuickDate] = useState(false);
  const [recurrenceFreq, setRecurrenceFreq] = useState<'' | RecurrenceFreq>('');
  const [recurrenceInterval, setRecurrenceInterval] = useState(1);
  const [recurrenceAnchor, setRecurrenceAnchor] = useState<RecurrenceAnchor>('fixed');

  // Natural-language quick-add: parse a date from the tail of the name as you type.
  const quick = useMemo(() => parseQuickTask(name), [name]);
  const quickActive = !!quick.dueDate && !dismissedQuickDate;
  const quickDateLabel = quick.dueDate
    ? new Date(quick.dueDate + 'T12:00:00').toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })
    : '';

  const loadCategories = useCallback(async (pid: string | null | undefined) => {
    try {
      const cats = await window.api.questsGetCategories(pid === undefined ? undefined : pid);
      setCategories(cats);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    if (projectId === '__new__') { setCategories([]); return; }
    loadCategories(projectId);
  }, [projectId, loadCategories]);

  useEffect(() => {
    setDismissedQuickDate(false);
    if (editingTask) {
      setName(editingTask.name);
      setDescription(editingTask.description);
      setTier(editingTask.tier);
      setCategory(editingTask.category);
      setProjectId(editingTask.projectId ?? null);
      setDueDate(editingTask.dueDate ?? '');
      setUseDate(!!editingTask.dueDate);
      const parsedRec = parseRecurrenceRule(editingTask.recurrenceRule);
      setRecurrenceFreq(parsedRec?.freq ?? '');
      setRecurrenceInterval(parsedRec?.interval ?? 1);
      setRecurrenceAnchor(editingTask.recurrenceAnchor === 'completion' ? 'completion' : 'fixed');
    } else {
      setName(''); setDescription(''); setTier(2); setCategory(''); setDueDate(''); setUseDate(false);
      setRecurrenceFreq(''); setRecurrenceInterval(1); setRecurrenceAnchor('fixed');
      setProjectId(activeProjectId);
    }
  }, [editingTask, activeProjectId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const resolvedCategory = category === '__new__' ? newCategory.trim() : category;

    // Quick-add: when a date was recognized in the name, use the cleaned name and that date;
    // otherwise fall back to the manual name + date-picker value.
    const resolvedName = quickActive ? quick.cleanName : name.trim();
    let resolvedDueDate = quickActive ? quick.dueDate : (useDate && dueDate ? dueDate : null);
    if (!resolvedName) return;

    // Recurrence: a recurring task needs a starting due date — default to today if none given.
    const recurrenceRule = recurrenceFreq ? buildRecurrenceRule(recurrenceFreq, recurrenceInterval) : null;
    if (recurrenceRule && !resolvedDueDate) resolvedDueDate = todayDateString();

    // Resolve the project: if the user chose "new project", create it first and use its id.
    let resolvedProjectId: string | null = projectId === '__new__' ? null : projectId;
    if (projectId === '__new__' && newProject.trim()) {
      const color = PROJECT_COLORS[projects.length % PROJECT_COLORS.length];
      resolvedProjectId = await window.api.questsUpsertProject({ name: newProject.trim(), color });
    }

    const task = {
      id: editingTask?.id,
      name: resolvedName,
      description: description.trim(),
      tier,
      category: resolvedCategory,
      projectId: resolvedProjectId,
      dueDate: resolvedDueDate,
      recurrenceRule,
      recurrenceAnchor: recurrenceRule ? recurrenceAnchor : null,
      order: editingTask?.order ?? 0,
      status: editingTask?.status ?? false,
    };

    await window.api.questsUpsertTask(task as Record<string, unknown>);

    setName(''); setDescription(''); setTier(2); setNewCategory(''); setNewProject(''); setCategory(''); setDueDate(''); setUseDate(false);
    setRecurrenceFreq(''); setRecurrenceInterval(1); setRecurrenceAnchor('fixed');
    setDismissedQuickDate(false);
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
          autoFocus={shouldFocus}
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

      {/* Quick-add: live hint when a date is recognized in the name */}
      {quickActive && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 'var(--fs-label)', color: 'var(--gold-dark)' }}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" style={{ flexShrink: 0 }}>
            <rect x="2" y="3" width="12" height="11" rx="1.5" />
            <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" />
          </svg>
          <span>
            {t('questify.quickDateHint', 'Se agenda para')} <strong>{quickDateLabel}</strong>
            <span style={{ opacity: 0.6 }}>{` · "${quick.cleanName}"`}</span>
          </span>
          <button
            type="button"
            onClick={() => setDismissedQuickDate(true)}
            title={t('questify.cancel', 'Descartar')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-faded)', padding: 0, display: 'inline-flex', alignItems: 'center' }}
          >
            <svg width="10" height="10" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M1 1l6 6M7 1l-6 6" /></svg>
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {/* Tier buttons */}
        <div style={{ display: 'flex', gap: 4 }}>
          {([1, 2, 3] as TaskTier[]).map((tierVal) => (
            <button
              key={tierVal}
              type="button"
              onClick={() => setTier(tierVal)}
              className={`quest-tier-btn${tier === tierVal ? ' quest-tier-btn--active' : ''}`}
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
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <select
            value={projectId === '__new__' ? '__new__' : (projectId ?? '')}
            onChange={(e) => {
              const val = e.target.value;
              setProjectId(val === '' ? null : val);
              setCategory('');
            }}
            className="rpg-select"
          >
            <option value="">{t('questify.noProject')}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
            <option value="__new__">+ {t('questify.newProject', 'Nuevo proyecto')}</option>
          </select>
          {projectId === '__new__' && (
            <input
              type="text"
              placeholder={t('questify.projectName', 'Nombre del proyecto')}
              value={newProject}
              onChange={(e) => setNewProject(e.target.value)}
              className="rpg-input"
              style={{ width: 120 }}
              autoFocus
            />
          )}
        </div>

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

        {/* Recurrence */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-label)', cursor: 'pointer' }}
          onClick={() => setRecurrenceFreq(recurrenceFreq ? '' : 'DAILY')}>
          <Checkbox checked={!!recurrenceFreq} onChange={() => setRecurrenceFreq(recurrenceFreq ? '' : 'DAILY')} size={16} />
          <span>{t('questify.repeat', 'Repetir')}</span>
        </div>
        {recurrenceFreq && (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ fontSize: 'var(--fs-label)', color: 'var(--ink-faded)' }}>{t('questify.every', 'Cada')}</span>
            <RpgStepper value={recurrenceInterval} onChange={setRecurrenceInterval} min={1} max={30} />
            <select value={recurrenceFreq} onChange={(e) => setRecurrenceFreq(e.target.value as RecurrenceFreq)}
              className="rpg-select" style={{ fontSize: 'var(--fs-label)' }}>
              <option value="DAILY">{recurrenceInterval > 1 ? t('questify.unitDays', 'días') : t('questify.unitDay', 'día')}</option>
              <option value="WEEKLY">{recurrenceInterval > 1 ? t('questify.unitWeeks', 'semanas') : t('questify.unitWeek', 'semana')}</option>
              <option value="MONTHLY">{recurrenceInterval > 1 ? t('questify.unitMonths', 'meses') : t('questify.unitMonth', 'mes')}</option>
            </select>
            <select value={recurrenceAnchor} onChange={(e) => setRecurrenceAnchor(e.target.value as RecurrenceAnchor)}
              className="rpg-select" style={{ fontSize: 'var(--fs-label)' }}
              title={t('questify.recurrenceAnchorHint', 'Cómo se calcula la próxima fecha')}>
              <option value="fixed">{t('questify.anchorFixed', 'fecha fija')}</option>
              <option value="completion">{t('questify.anchorCompletion', 'tras completar')}</option>
            </select>
          </div>
        )}
      </div>
    </form>
  );
}
