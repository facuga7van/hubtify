import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { XP_MAP, PROJECT_COLORS, type TaskTier, type Task, type Project } from '../types';
import { TierBadge, TIER_LABEL } from '../utils';
import {
  parseRepeatRule, buildRepeatRule, jsToIsoDay, parseRepeatAnchor, serializeRepeatAnchor,
  clampRepeatInterval, repeatUnitLabel, MAX_REPEAT_INTERVAL,
  type RepeatFreq, type RepeatAnchor,
} from '../repeat';
// One parser for the whole app: `quickadd-parser` is a superset of the old
// `parseQuickTask` (dates + time + !tier + #project, with an escape hatch), so
// the form and the Ctrl+Q modal understand exactly the same language.
import { parseQuickAdd, type QuickAddProjectRef } from '../quickadd-parser';
import RpgDateTimePicker from '../../../shared/components/RpgDateTimePicker';
import Checkbox from '../../../shared/components/Checkbox';
import HabitDayPicker from './HabitDayPicker';
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
  const [repeatFreq, setRepeatFreq] = useState<RepeatFreq | 'never'>('never');
  /** Chosen weekdays for freq 'days', in the picker's ISO numbering (1 = Monday). */
  const [repeatDays, setRepeatDays] = useState<number[]>([]);
  /**
   * The interval box holds TEXT, not a number: a number state forces the field
   * back to 1 the instant you clear it to type "12", which makes it unusable.
   * It is clamped to 1..30 on blur and again on save.
   */
  const [repeatInterval, setRepeatInterval] = useState('1');
  const [repeatAnchor, setRepeatAnchor] = useState<RepeatAnchor>('due');
  const [dismissedQuick, setDismissedQuick] = useState(false);
  /**
   * El proyecto que sugiere el historial, SOLO como respaldo.
   *
   * El contexto explícito manda: si el usuario está parado en un proyecto,
   * `activeProjectId` gana siempre. Esto contesta el otro caso —la vista «Todos»,
   * donde `activeProjectId` es `null`— que antes creaba misiones sin proyecto
   * aunque 28 de las 37 vivas de la base real tengan uno.
   */
  const inferredProjectId = useRef<string | null>(null);

  const projectRefs = useMemo<QuickAddProjectRef[]>(
    () => projects.map((p) => ({ id: p.id, name: p.name })),
    [projects],
  );

  // Natural-language quick-add, as you type. Only while CREATING: re-parsing the
  // name of an existing quest would quietly reschedule "Reunión lunes" every
  // time you opened it to fix a typo.
  const quick = useMemo(
    () => parseQuickAdd(editingTask ? '' : name, { projects: projectRefs }),
    [name, projectRefs, editingTask],
  );
  const quickActive = quick.tokens.length > 0 && !dismissedQuick;
  const quickDateLabel = quick.dueDay
    ? new Date(quick.dueDay + 'T12:00:00').toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })
    : '';
  /** Everything the parser took out of the name, so nothing is stripped silently. */
  const quickParts = [
    quickDateLabel && `${quickDateLabel}${quick.dueTime ? ` ${quick.dueTime}` : ''}`,
    quick.tier && t(TIER_LABEL[quick.tier]),
    quick.projectName,
  ].filter(Boolean) as string[];

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

  // Se pide una sola vez al montar: mientras el formulario está abierto el
  // historial no cambia lo suficiente como para justificar mover el select
  // debajo de los dedos de nadie.
  useEffect(() => {
    // Canal nuevo: en un binding viejo simplemente no está, y el default vale.
    const api = window.api as Partial<typeof window.api>;
    if (typeof api.questsGetEntryDefaults !== 'function') return;
    let cancelled = false;
    api.questsGetEntryDefaults()
      .then((d) => {
        if (cancelled || !d) return;
        inferredProjectId.current = d.projectId;
        // Sólo rellena el hueco: nunca pisa una elección ni un contexto activo,
        // y nunca toca el formulario de edición de una misión que ya existe.
        setProjectId((prev) => (prev === null && !editingTask && activeProjectId == null ? d.projectId : prev));
      })
      .catch(() => { /* el default ya está puesto */ });
    return () => { cancelled = true; };
  }, [editingTask, activeProjectId]);

  useEffect(() => {
    setDismissedQuick(false);
    if (editingTask) {
      setName(editingTask.name);
      setDescription(editingTask.description);
      setTier(editingTask.tier);
      setCategory(editingTask.category);
      setProjectId(editingTask.projectId ?? null);
      setDueDate(editingTask.dueDate ?? '');
      setUseDate(!!editingTask.dueDate);
      const rule = parseRepeatRule(editingTask.repeatRule);
      setRepeatFreq(rule?.freq ?? 'never');
      setRepeatDays(rule?.days ? rule.days.map(jsToIsoDay).sort((a, b) => a - b) : []);
      setRepeatInterval(String(rule?.interval ?? 1));
      setRepeatAnchor(parseRepeatAnchor(editingTask.repeatAnchor));
    } else {
      // Suggested, never imposed: the picker opens already on today, so putting
      // a quest in "Hoy" costs one tick and zero typing — but the checkbox stays
      // off, so nothing gets a date the user did not ask for.
      setName(''); setDescription(''); setTier(2); setCategory(''); setDueDate(todayDateString()); setUseDate(false);
      setRepeatFreq('never'); setRepeatDays([]); setRepeatInterval('1'); setRepeatAnchor('due');
      // El contexto explícito gana; el historial sólo contesta cuando no hay.
      setProjectId(activeProjectId ?? inferredProjectId.current);
    }
  }, [editingTask, activeProjectId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const resolvedCategory = category === '__new__' ? newCategory.trim() : category;

    // Quick-add: whatever the parser CUT OUT of the name has to be applied, or
    // typing "!épica" would delete the word and silently keep tier 2.
    const resolvedName = quickActive ? quick.title : name.trim();
    const resolvedDueDate = quickActive && quick.dueDate
      ? quick.dueDate
      : (useDate && dueDate ? dueDate : null);
    const resolvedTier = quickActive && quick.tier ? quick.tier : tier;
    if (!resolvedName) return;

    // Resolve the project: if the user chose "new project", create it first and use its id.
    let resolvedProjectId: string | null = projectId === '__new__' ? null : projectId;
    if (projectId === '__new__' && newProject.trim()) {
      const color = PROJECT_COLORS[projects.length % PROJECT_COLORS.length];
      resolvedProjectId = await window.api.questsUpsertProject({ name: newProject.trim(), color });
    }
    if (quickActive && quick.projectId) resolvedProjectId = quick.projectId;

    const resolvedRule = buildRepeatRule(repeatFreq, repeatDays, clampRepeatInterval(repeatInterval));

    const task = {
      id: editingTask?.id,
      name: resolvedName,
      description: description.trim(),
      tier: resolvedTier,
      category: resolvedCategory,
      projectId: resolvedProjectId,
      dueDate: resolvedDueDate,
      order: editingTask?.order ?? 0,
      status: editingTask?.status ?? false,
      repeatRule: resolvedRule,
      // No rule → no anchor; the backend enforces the same, this just keeps the
      // payload honest.
      repeatAnchor: resolvedRule ? serializeRepeatAnchor(repeatAnchor) : null,
    };

    await window.api.questsUpsertTask(task as Record<string, unknown>);

    // No `questsEnsureCategory` call any more: categories are derived from
    // `tasks.category` (the handler is a no-op), so saving the task registers it.
    setName(''); setDescription(''); setTier(2); setNewCategory(''); setNewProject(''); setCategory(''); setDueDate(todayDateString()); setUseDate(false);
    setRepeatFreq('never'); setRepeatDays([]); setRepeatInterval('1'); setRepeatAnchor('due');
    setDismissedQuick(false);
    setProjectId(activeProjectId ?? inferredProjectId.current);
    onSaved();
  };

  return (
    <form onSubmit={handleSubmit} className="rpg-card" style={{ marginBottom: 16 }}>
      <div className="quest-form-head" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
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
          className="rpg-input quest-form-name"
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

      {/* Quick-add: live hint for everything recognized in the name */}
      {quickActive && quickParts.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 'var(--fs-label)', color: 'var(--gold-dark)' }}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" style={{ flexShrink: 0 }}>
            <rect x="2" y="3" width="12" height="11" rx="1.5" />
            <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" />
          </svg>
          <span>
            {t('questify.quickDateHint', 'Se agenda para')} <strong>{quickParts.join(' · ')}</strong>
            <span style={{ color: 'var(--ink-soft)' }}>{` · "${quick.title}"`}</span>
          </span>
          <button
            type="button"
            onClick={() => setDismissedQuick(true)}
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
              <span style={{ fontSize: 'var(--fs-label)', marginLeft: 2 }}>({XP_MAP[tierVal]})</span>
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

        {/* Recurrence: completing spawns the next instance with the due date
            shifted by the rule (backend, quests migrations v13 and v14). */}
        <div className="quest-repeat-field">
          <label className="quest-repeat-label" htmlFor="quest-repeat-select">
            {t('questify.repeatLabel', 'Repetir')}
          </label>
          <select
            id="quest-repeat-select"
            className="rpg-select"
            value={repeatFreq}
            onChange={(e) => setRepeatFreq(e.target.value as RepeatFreq | 'never')}
          >
            <option value="never">{t('questify.repeatNever', 'Nunca')}</option>
            <option value="daily">{t('questify.repeatDaily', 'Diaria')}</option>
            <option value="weekly">{t('questify.repeatWeekly', 'Semanal')}</option>
            <option value="monthly">{t('questify.repeatMonthly', 'Mensual')}</option>
            <option value="days">{t('questify.repeatDays', 'Días específicos')}</option>
          </select>
          {/* Interval. Deliberately absent for "specific days": "every 2 weeks
              on Mon and Thu" has no unambiguous meaning in this model — see the
              DECISION note in repeat.ts and quests migration v14. */}
          {repeatFreq !== 'never' && repeatFreq !== 'days' && (
            <>
              <label className="quest-repeat-label" htmlFor="quest-repeat-interval">
                {t('questify.repeatEvery', 'cada')}
              </label>
              <input
                id="quest-repeat-interval"
                type="number"
                min={1}
                max={MAX_REPEAT_INTERVAL}
                step={1}
                className="rpg-input quest-repeat-interval"
                value={repeatInterval}
                onChange={(e) => setRepeatInterval(e.target.value)}
                onBlur={() => setRepeatInterval(String(clampRepeatInterval(repeatInterval)))}
              />
              <span className="quest-repeat-unit">
                {repeatUnitLabel(repeatFreq, clampRepeatInterval(repeatInterval), t)}
              </span>
            </>
          )}
          {repeatFreq === 'days' && (
            <HabitDayPicker value={repeatDays} onChange={setRepeatDays} />
          )}
          {/* Anchor. Off = the default: the next date is measured from THIS
              due date (rent due the 1st, paid the 3rd, is due the 1st again). */}
          {repeatFreq !== 'never' && (
            <div
              className="quest-repeat-anchor"
              onClick={() => setRepeatAnchor(repeatAnchor === 'completion' ? 'due' : 'completion')}
              title={t('questify.repeatFromCompletionHelp', 'Cuenta el próximo vencimiento desde el día en que la marco, no desde el vencimiento anterior')}
            >
              <Checkbox
                checked={repeatAnchor === 'completion'}
                onChange={() => setRepeatAnchor(repeatAnchor === 'completion' ? 'due' : 'completion')}
                size={16}
              />
              <span>{t('questify.repeatFromCompletion', 'Desde que la completo')}</span>
            </div>
          )}
        </div>
      </div>
    </form>
  );
}
