import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '../../../shared/components/ConfirmDialog';
import { useModalA11y } from '../../../shared/hooks/useModalA11y';
import HelpBubble from '../../../shared/components/HelpBubble';
import type { Project } from '../types';
import { PROJECT_COLORS } from '../types';

interface Props {
  projects: Project[];
  onClose: () => void;
  onSaved: () => void;
}

export default function ProjectManager({ projects, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState<string>(() => {
    const used = new Set(projects.map(p => p.color));
    return PROJECT_COLORS.find(c => !used.has(c)) ?? PROJECT_COLORS[0];
  });

  // Escape at window level + focus trap + focus restore. The old hand-rolled
  // onKeyDown lived on a non-focusable div, so Escape died the moment you
  // clicked anything inside.
  const { dialogProps, stopPropagation } = useModalA11y<HTMLDivElement>({ onClose });

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await window.api.questsUpsertProject({ name: newName.trim(), color: newColor });
    setNewName('');
    const used = new Set([...projects.map(p => p.color), newColor]);
    setNewColor(PROJECT_COLORS.find(c => !used.has(c)) ?? PROJECT_COLORS[0]);
    onSaved();
  };

  const handleUpdate = async (id: string) => {
    if (!editName.trim()) return;
    await window.api.questsUpsertProject({ id, name: editName.trim(), color: editColor });
    setEditingId(null);
    onSaved();
  };

  const handleDelete = async (id: string) => {
    const ok = await confirm({ message: t('questify.deleteProjectConfirm'), danger: true, confirmText: t('questify.delete') });
    if (!ok) return;
    await window.api.questsDeleteProject(id);
    onSaved();
  };

  const startEdit = (p: Project) => {
    setEditingId(p.id);
    setEditName(p.name);
    setEditColor(p.color);
  };

  return (
    <div className="quest-project-modal-overlay" onClick={onClose}>
      <div
        {...dialogProps}
        className="quest-project-modal"
        aria-label={t('questify.manageProjects')}
        onClick={stopPropagation}
      >
        {/* Close first in the DOM: it takes the initial focus and it is the safe action. */}
        <button
          type="button"
          className="quest-modal-close tap-target"
          onClick={onClose}
          aria-label={t('questify.close', 'Cerrar')}
          title={t('questify.close', 'Cerrar')}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <path d="M2 2l10 10M12 2L2 12"/>
          </svg>
        </button>

        <div className="quest-project-modal-title">{t('questify.manageProjects')} <HelpBubble variant="inline" text={t('questify.projectsHelp', 'Proyectos agrupan misiones en campañas. Su progreso se muestra en la barra de Campañas.')} /></div>

        {projects.map((p) => (
          <div key={p.id} className="quest-project-modal-row">
            {editingId === p.id ? (
              <>
                <ColorPicker value={editColor} onChange={setEditColor} />
                <input className="subtask-input" value={editName} onChange={(e) => setEditName(e.target.value)}
                  style={{ flex: 1, minWidth: 0 }} autoFocus onKeyDown={(e) => e.key === 'Enter' && handleUpdate(p.id)} />
                <button type="button" className="qb-rune qb-rune--sage quest-rune-btn" onClick={() => handleUpdate(p.id)}>
                  {t('questify.save')}
                </button>
                <button type="button" className="qb-rune quest-rune-btn" onClick={() => setEditingId(null)}>
                  {t('questify.cancel')}
                </button>
              </>
            ) : (
              <>
                <span style={{
                  width: 12, height: 12, borderRadius: '50%', background: p.color, flexShrink: 0,
                }} aria-hidden="true" />
                <span style={{
                  flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  fontFamily: "'IM Fell English', serif", fontSize: 'var(--fs-label)', color: 'var(--ink)',
                }} title={p.name}>{p.name}</span>
                <button type="button" className="qb-rune quest-rune-btn" onClick={() => startEdit(p)}>
                  {t('questify.edit')}
                </button>
                <button type="button" className="qb-rune qb-rune--rubric quest-rune-btn" onClick={() => handleDelete(p.id)}>
                  {t('questify.delete')}
                </button>
              </>
            )}
          </div>
        ))}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
          <ColorPicker value={newColor} onChange={setNewColor} />
          <input className="subtask-input" placeholder={t('questify.projectName')} value={newName}
            onChange={(e) => setNewName(e.target.value)} style={{ flex: 1, minWidth: 0 }}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()} />
          <button type="button" className="qb-rune qb-rune--sage quest-rune-btn" onClick={handleCreate}>
            + {t('questify.newProject')}
          </button>
        </div>
      </div>
    </div>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const { t } = useTranslation();
  return (
    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', width: 80, flexShrink: 0 }}>
      {PROJECT_COLORS.map((c) => (
        <button key={c} type="button" onClick={() => onChange(c)}
          aria-label={t('questify.projectColor', 'Color del proyecto')}
          aria-pressed={c === value}
          style={{
            width: 14, height: 14, borderRadius: '50%', background: c, border: 'none', cursor: 'pointer',
            outline: c === value ? '2px solid var(--gold)' : '2px solid transparent',
            outlineOffset: 1,
          }} />
      ))}
    </div>
  );
}
