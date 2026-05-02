import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '../../../shared/components/ConfirmDialog';
import { Rune } from '../../../shared/components/codex/CodexPrimitives';
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

  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Auto-focus first input on mount
    const firstInput = modalRef.current?.querySelector('input') as HTMLInputElement | null;
    firstInput?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'Tab' && modalRef.current) {
      const focusable = modalRef.current.querySelectorAll<HTMLElement>(
        'input, button, select, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  return (
    <div className="quest-project-modal-overlay" onClick={onClose} onKeyDown={handleKeyDown} role="dialog" aria-modal="true" aria-label={t('questify.manageProjects')}>
      <div ref={modalRef} className="quest-project-modal" onClick={(e) => e.stopPropagation()}>
        <div className="quest-project-modal-title">{t('questify.manageProjects')} <HelpBubble variant="inline" text={t('questify.projectsHelp', 'Proyectos agrupan misiones en campañas. Su progreso se muestra en la barra de Campañas.')} /></div>

        {projects.map((p) => (
          <div key={p.id} className="quest-project-modal-row">
            {editingId === p.id ? (
              <>
                <ColorPicker value={editColor} onChange={setEditColor} />
                <input className="subtask-input" value={editName} onChange={(e) => setEditName(e.target.value)}
                  style={{ flex: 1 }} autoFocus onKeyDown={(e) => e.key === 'Enter' && handleUpdate(p.id)} />
                <Rune tone="sage">
                  <span style={{ cursor: 'pointer' }} onClick={() => handleUpdate(p.id)}>OK</span>
                </Rune>
                <Rune>
                  <span style={{ cursor: 'pointer' }} onClick={() => setEditingId(null)}>{t('questify.cancel')}</span>
                </Rune>
              </>
            ) : (
              <>
                <span style={{
                  width: 12, height: 12, borderRadius: '50%', background: p.color, flexShrink: 0,
                }} />
                <span style={{
                  flex: 1, fontFamily: "'IM Fell English', serif", fontSize: 'var(--fs-label)', color: 'var(--ink)',
                }}>{p.name}</span>
                <Rune>
                  <span style={{ cursor: 'pointer' }} onClick={() => startEdit(p)}>{t('questify.edit')}</span>
                </Rune>
                <Rune tone="rubric">
                  <span style={{ cursor: 'pointer' }} onClick={() => handleDelete(p.id)}>{t('questify.delete')}</span>
                </Rune>
              </>
            )}
          </div>
        ))}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
          <ColorPicker value={newColor} onChange={setNewColor} />
          <input className="subtask-input" placeholder={t('questify.projectName')} value={newName}
            onChange={(e) => setNewName(e.target.value)} style={{ flex: 1 }}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()} />
          <Rune tone="sage">
            <span style={{ cursor: 'pointer' }} onClick={handleCreate}>+ {t('questify.newProject')}</span>
          </Rune>
        </div>
      </div>
    </div>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', width: 80 }}>
      {PROJECT_COLORS.map((c) => (
        <button key={c} type="button" onClick={() => onChange(c)} style={{
          width: 14, height: 14, borderRadius: '50%', background: c, border: 'none', cursor: 'pointer',
          outline: c === value ? '2px solid var(--gold)' : '2px solid transparent',
          outlineOffset: 1,
        }} />
      ))}
    </div>
  );
}
