import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '../../../../shared/components/ConfirmDialog';
import { useToast } from '../../../../shared/components/useToast';
import { useModalA11y } from '../../../../shared/hooks/useModalA11y';
import { CrossMark, Pencil, Checkmark } from '../../../../shared/components/icons';
import type { CreditCard } from '../../types';
import RpgNumberInput from '../../../../shared/components/RpgNumberInput';
import { unwrap, failureMessage } from '../../utils/api-ext';

interface Props {
  cards: CreditCard[];
  onClose: () => void;
  onSaved: () => void;
}

export default function CreditCardManager({ cards, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const { toast } = useToast();
  const [newName, setNewName] = useState('');
  const [newClosingDay, setNewClosingDay] = useState(1);
  /** 0 = "sin vencimiento" — sent as null so the card stays out of the agenda. */
  const [newDueDay, setNewDueDay] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editClosingDay, setEditClosingDay] = useState(1);
  const [editDueDay, setEditDueDay] = useState(0);

  const { dialogProps, stopPropagation } = useModalA11y({ onClose });

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const result = await unwrap(window.api.financeAddCreditCard({
      name: newName.trim(),
      closingDay: newClosingDay,
      dueDay: newDueDay > 0 ? newDueDay : null,
    }));
    if (!result.ok) {
      toast({ type: 'warning', message: failureMessage(result.reason, t) });
      return;
    }
    setNewName('');
    setNewClosingDay(1);
    setNewDueDay(0);
    onSaved();
  };

  const handleDelete = async (id: string) => {
    // Spell out the consequence instead of the bare generic "¿Eliminar?".
    const ok = await confirm({
      message: t('coinify.deleteCardConfirm', '¿Eliminar esta tarjeta? Los gastos asociados no se verán afectados.'),
      danger: true,
      confirmText: t('coinify.delete'),
    });
    if (!ok) return;
    try {
      await window.api.financeDeleteCreditCard(id);
      onSaved();
    } catch (err) {
      console.error('[CreditCardManager] financeDeleteCreditCard failed:', err);
      toast({ type: 'warning', message: t('coinify.deleteError', 'Error al eliminar') });
    }
  };

  const startEdit = (card: CreditCard) => {
    setEditingId(card.id);
    setEditName(card.name);
    setEditClosingDay(card.closingDay);
    setEditDueDay(card.dueDay ?? 0);
  };

  const handleUpdate = async () => {
    if (!editingId || !editName.trim()) return;
    const result = await unwrap(window.api.financeUpdateCreditCard(editingId, {
      name: editName.trim(),
      closingDay: editClosingDay,
      dueDay: editDueDay > 0 ? editDueDay : null,
    }));
    if (!result.ok) {
      toast({ type: 'warning', message: failureMessage(result.reason, t) });
      return;
    }
    setEditingId(null);
    onSaved();
  };

  return createPortal(
    <div className="coin-modal-overlay" onClick={onClose}>
      <div
        {...dialogProps}
        className="rpg-card coin-modal coin-modal--narrow"
        aria-label={t('coinify.manageCreditCards')}
        onClick={stopPropagation}
      >
        <div className="coin-modal__header">
          <div className="rpg-card-title" style={{ margin: 0 }}>{t('coinify.manageCreditCards')}</div>
          <button
            className="rpg-button tap-target"
            aria-label={t('coinify.close', 'Cerrar')}
            title={t('coinify.close', 'Cerrar')}
            onClick={onClose}
            style={{ padding: '2px 8px' }}
          ><CrossMark style={{ width: '0.7em', height: '0.7em' }} /></button>
        </div>

        {cards.map((card) => (
          <div key={card.id} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
            borderBottom: '1px solid var(--parch-1)',
          }}>
            {editingId === card.id ? (
              <div style={{ display: 'flex', gap: 4, alignItems: 'center', flex: 1 }}>
                <input className="rpg-input" value={editName}
                  aria-label={t('coinify.cardName')}
                  onChange={(e) => setEditName(e.target.value)} style={{ flex: 1, minWidth: 0 }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleUpdate();
                    if (e.key === 'Escape') setEditingId(null);
                  }} />
                <RpgNumberInput value={String(editClosingDay)}
                  onChange={(v) => setEditClosingDay(Math.min(31, Math.max(1, parseInt(v) || 1)))}
                  style={{ width: 70 }} min={1} max={31} step={1} />
                {/* Día de vencimiento; 0 = sin agenda. */}
                <RpgNumberInput value={String(editDueDay)}
                  onChange={(v) => setEditDueDay(Math.min(31, Math.max(0, parseInt(v) || 0)))}
                  aria-label={t('coinify.dueDay', 'Día de vencimiento')}
                  style={{ width: 70 }} min={0} max={31} step={1} />
                <button className="rpg-button coin-action-btn coin-action-btn--confirm" onClick={handleUpdate}
                  aria-label={t('coinify.save', 'Guardar')} title={t('coinify.save', 'Guardar')}>
                  <Checkmark style={{ width: '0.8em', height: '0.8em' }} />
                </button>
                <button className="rpg-button coin-action-btn coin-action-btn--cancel" onClick={() => setEditingId(null)}
                  aria-label={t('coinify.cancel', 'Cancelar')} title={t('coinify.cancel', 'Cancelar')}>
                  <CrossMark style={{ width: '0.7em', height: '0.7em' }} />
                </button>
              </div>
            ) : (
              <>
                <span style={{ flex: 1, fontWeight: 'bold', minWidth: 0 }}>
                  {card.name}{' '}
                  <span style={{ fontSize: 'var(--fs-label)', opacity: 0.6 }}>
                    ({t('coinify.closingDay')}: {card.closingDay}
                    {card.dueDay ? <> · {t('coinify.dueDayShort', 'Vto')}: {card.dueDay}</> : null})
                  </span>
                </span>
                {/* Editing used to mean clicking the name — a bare <span> with a
                    pointer cursor and no other hint that it did anything. */}
                <button className="rpg-button coin-action-btn coin-action-btn--muted" onClick={() => startEdit(card)}
                  aria-label={t('coinify.editCard', 'Editar tarjeta')}
                  title={t('coinify.editCard', 'Editar tarjeta')}>
                  <Pencil style={{ width: '0.75em', height: '0.75em' }} />
                </button>
                <button className="rpg-button coin-manager__delete" onClick={() => handleDelete(card.id)}>
                  {t('coinify.delete')}
                </button>
              </>
            )}
          </div>
        ))}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
          <input className="rpg-input" placeholder={t('coinify.cardName')} value={newName}
            aria-label={t('coinify.cardName')}
            onChange={(e) => setNewName(e.target.value)} style={{ flex: 1, minWidth: 0 }}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()} />
          <RpgNumberInput value={String(newClosingDay)}
            onChange={(v) => setNewClosingDay(Math.min(31, Math.max(1, parseInt(v) || 1)))}
            style={{ width: 70 }} min={1} max={31} step={1} />
          <RpgNumberInput value={String(newDueDay)}
            onChange={(v) => setNewDueDay(Math.min(31, Math.max(0, parseInt(v) || 0)))}
            aria-label={t('coinify.dueDay', 'Día de vencimiento')}
            style={{ width: 70 }} min={0} max={31} step={1} />
          <button className="rpg-button" onClick={handleCreate} disabled={!newName.trim()}>
            + {t('coinify.newCard')}
          </button>
        </div>
        <p className="qb-hand" style={{ fontSize: 'var(--fs-label)', opacity: 0.6, margin: '6px 0 0' }}>
          {t('coinify.dueDayHint', 'Cierre / vencimiento del resumen. Vencimiento 0 = sin aviso ni agenda.')}
        </p>
      </div>
    </div>,
    document.body,
  );
}
