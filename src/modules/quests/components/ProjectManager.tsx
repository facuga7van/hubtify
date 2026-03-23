import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '../../../shared/components/ConfirmDialog';
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

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(44,24,16,0.7)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div className="rpg-card" style={{ width: 420, maxHeight: '80vh', overflow: 'auto' }}
        onClick={(e) => e.stopPropagation()}>
        <div className="rpg-card-title">{t('questify.manageProjects')}</div>

        {projects.map((p) => (
          <div key={p.id} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
            borderBottom: '1px solid var(--rpg-parchment-dark)',
          }}>
            {editingId === p.id ? (
              <>
                <ColorPicker value={editColor} onChange={setEditColor} />
                <input className="rpg-input" value={editName} onChange={(e) => setEditName(e.target.value)}
                  style={{ flex: 1 }} autoFocus onKeyDown={(e) => e.key === 'Enter' && handleUpdate(p.id)} />
                <button className="rpg-button" onClick={() => handleUpdate(p.id)}
                  style={{ padding: '3px 8px', fontSize: '0.8rem' }}>OK</button>
                <button className="rpg-button" onClick={() => setEditingId(null)}
                  style={{ padding: '3px 8px', fontSize: '0.8rem', opacity: 0.6 }}>{t('questify.cancel')}</button>
              </>
            ) : (
              <>
                <span style={{
                  width: 12, height: 12, borderRadius: '50%', background: p.color, flexShrink: 0,
                }} />
                <span style={{ flex: 1, fontWeight: 'bold' }}>{p.name}</span>
                <button className="rpg-button" onClick={() => startEdit(p)}
                  style={{ padding: '3px 8px', fontSize: '0.75rem', opacity: 0.6 }}>
                  {t('questify.edit')}
                </button>
                <button className="rpg-button" onClick={() => handleDelete(p.id)}
                  style={{ padding: '3px 8px', fontSize: '0.75rem', opacity: 0.4 }}>
                  {t('questify.delete')}
                </button>
              </>
            )}
          </div>
        ))}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
          <ColorPicker value={newColor} onChange={setNewColor} />
          <input className="rpg-input" placeholder={t('questify.projectName')} value={newName}
            onChange={(e) => setNewName(e.target.value)} style={{ flex: 1 }}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()} />
          <button className="rpg-button" onClick={handleCreate} disabled={!newName.trim()}>
            + {t('questify.newProject')}
          </button>
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
          width: 16, height: 16, borderRadius: '50%', background: c, border: 'none', cursor: 'pointer',
          outline: c === value ? '2px solid var(--rpg-gold)' : '2px solid transparent',
          outlineOffset: 1,
        }} />
      ))}
    </div>
  );
}
