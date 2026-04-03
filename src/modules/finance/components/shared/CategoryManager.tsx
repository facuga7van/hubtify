import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

interface Props {
  categories: string[];
  onClose: () => void;
  onSaved: () => void;
}

export default function CategoryManager({ categories, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const [newName, setNewName] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await window.api.financeAddCategory(newName.trim());
    setNewName('');
    onSaved();
  };

  const handleDelete = async (name: string) => {
    await window.api.financeDeleteCategory(name);
    setConfirmingDelete(null);
    onSaved();
  };

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(44,24,16,0.7)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div className="rpg-card" style={{ width: 420, maxHeight: '80vh', overflow: 'auto' }}
        onClick={(e) => e.stopPropagation()}>
        <div className="rpg-card-title">{t('coinify.manageCategories')}</div>

        {categories.map((cat) => (
          <div key={cat} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
            borderBottom: '1px solid var(--rpg-parchment-dark)',
          }}>
            <span style={{ flex: 1, fontWeight: 'bold' }}>{cat}</span>
            {confirmingDelete === cat ? (
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--rpg-hp-red)' }}>
                  {t('coinify.confirmDelete')}
                </span>
                <button className="rpg-button" onClick={() => handleDelete(cat)}
                  style={{ padding: '2px 8px', fontSize: '0.75rem', color: 'var(--rpg-hp-red)' }}>
                  {t('coinify.yes')}
                </button>
                <button className="rpg-button" onClick={() => setConfirmingDelete(null)}
                  style={{ padding: '2px 8px', fontSize: '0.75rem', opacity: 0.4 }}>
                  {t('coinify.no')}
                </button>
              </div>
            ) : (
              <button className="rpg-button" onClick={() => setConfirmingDelete(cat)}
                style={{ padding: '3px 8px', fontSize: '0.75rem', opacity: 0.4 }}>
                {t('coinify.delete')}
              </button>
            )}
          </div>
        ))}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
          <input className="rpg-input" placeholder={t('coinify.categoryName')} value={newName}
            onChange={(e) => setNewName(e.target.value)} style={{ flex: 1 }}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()} />
          <button className="rpg-button" onClick={handleCreate} disabled={!newName.trim()}>
            + {t('coinify.newCategory')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
