import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../../../shared/components/useToast';
import { useConfirm } from '../../../../shared/components/ConfirmDialog';
import { useModalA11y } from '../../../../shared/hooks/useModalA11y';
import { CrossMark } from '../../../../shared/components/icons';
import { unwrap, failureMessage } from '../../utils/result';

interface Props {
  categories: string[];
  onClose: () => void;
  onSaved: () => void;
}

export default function CategoryManager({ categories, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [newName, setNewName] = useState('');

  const { dialogProps, stopPropagation } = useModalA11y({ onClose });

  const handleCreate = async () => {
    if (!newName.trim()) return;
    // `addCategory` answers `{ ok: false, reason }` for an invalid name.
    const result = await unwrap(window.api.financeAddCategory(newName.trim()));
    if (!result.ok) {
      toast({ type: 'warning', message: failureMessage(result.reason, t) });
      return;
    }
    setNewName('');
    onSaved();
    window.dispatchEvent(new Event('finance:dataChanged'));
  };

  const handleDelete = async (name: string) => {
    // The module-wide ConfirmDialog, with the copy that actually explains the
    // consequence — the inline yes/no said only "¿Eliminar?".
    const ok = await confirm({
      message: t('coinify.deleteCategoryConfirm', '¿Eliminar esta categoría? Las transacciones existentes no se verán afectadas.'),
      danger: true,
      confirmText: t('coinify.delete'),
    });
    if (!ok) return;
    try {
      const res = await window.api.financeDeleteCategory(name) as
        { ok: boolean; reason?: string; count?: number } | void;
      if (res && res.ok === false) {
        // Decir POR QUÉ no se puede, y con cuántos: «Error al eliminar» a secas
        // dejaba al usuario sin saber qué hacer.
        toast({
          type: 'warning',
          message: res.reason === 'category_in_use'
            ? t('coinify.categoryInUse', 'No se puede borrar «{{name}}»: hay {{count}} movimientos con esa categoría. Cambiáselas primero.', { name, count: res.count ?? 0 })
            : t('coinify.deleteError', 'Error al eliminar'),
        });
        return;
      }
      onSaved();
      window.dispatchEvent(new Event('finance:dataChanged'));
    } catch (err) {
      console.error('[CategoryManager] financeDeleteCategory failed:', err);
      toast({ type: 'warning', message: t('coinify.deleteError', 'Error al eliminar') });
    }
  };

  // Portal clicks bubble up the React tree: stop them here so a host overlay
  // (the importer's) never sees the click that closed this manager.
  return createPortal(
    <div
      className="coin-modal-overlay"
      onClick={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        {...dialogProps}
        className="rpg-card coin-modal coin-modal--narrow"
        aria-label={t('coinify.manageCategories')}
        onClick={stopPropagation}
      >
        <div className="coin-modal__header">
          <div className="rpg-card-title" style={{ margin: 0 }}>{t('coinify.manageCategories')}</div>
          <button
            className="rpg-button tap-target"
            aria-label={t('coinify.close', 'Cerrar')}
            title={t('coinify.close', 'Cerrar')}
            onClick={onClose}
            style={{ padding: '2px 8px' }}
          ><CrossMark style={{ width: '0.7em', height: '0.7em' }} /></button>
        </div>

        {categories.map((cat) => (
          <div key={cat} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
            borderBottom: '1px solid var(--parch-1)',
          }}>
            <span style={{ flex: 1, fontWeight: 'bold' }}>{cat}</span>
            <button className="rpg-button coin-manager__delete" onClick={() => handleDelete(cat)}>
              {t('coinify.delete')}
            </button>
          </div>
        ))}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
          <input className="rpg-input" placeholder={t('coinify.categoryName')} value={newName}
            aria-label={t('coinify.categoryName')}
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
