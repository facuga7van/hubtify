import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { CreditCard } from '../../types';

interface Props {
  cards: CreditCard[];
  onClose: () => void;
  onSaved: () => void;
}

export default function CreditCardManager({ cards, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const [newName, setNewName] = useState('');
  const [newClosingDay, setNewClosingDay] = useState(1);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editClosingDay, setEditClosingDay] = useState(1);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await window.api.financeAddCreditCard({ name: newName.trim(), closingDay: newClosingDay });
    setNewName('');
    setNewClosingDay(1);
    onSaved();
  };

  const handleDelete = async (id: string) => {
    await window.api.financeDeleteCreditCard(id);
    setConfirmingDelete(null);
    onSaved();
  };

  const startEdit = (card: CreditCard) => {
    setEditingId(card.id);
    setEditName(card.name);
    setEditClosingDay(card.closingDay);
  };

  const handleUpdate = async () => {
    if (!editingId || !editName.trim()) return;
    await window.api.financeUpdateCreditCard(editingId, { name: editName.trim(), closingDay: editClosingDay });
    setEditingId(null);
    onSaved();
  };

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(44,24,16,0.7)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div className="rpg-card" style={{ width: 420, maxHeight: '80vh', overflow: 'auto' }}
        onClick={(e) => e.stopPropagation()}>
        <div className="rpg-card-title">{t('coinify.manageCreditCards')}</div>

        {cards.map((card) => (
          <div key={card.id} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
            borderBottom: '1px solid var(--rpg-parchment-dark)',
          }}>
            {editingId === card.id ? (
              <div style={{ display: 'flex', gap: 4, alignItems: 'center', flex: 1 }}>
                <input className="rpg-input" value={editName}
                  onChange={(e) => setEditName(e.target.value)} style={{ flex: 1 }}
                  onKeyDown={(e) => e.key === 'Enter' && handleUpdate()} />
                <input type="number" className="rpg-input" value={editClosingDay}
                  onChange={(e) => setEditClosingDay(Math.min(28, Math.max(1, parseInt(e.target.value) || 1)))}
                  style={{ width: 60 }} min={1} max={28} />
                <button className="rpg-button" onClick={handleUpdate}
                  style={{ padding: '2px 8px', fontSize: '0.75rem' }}>
                  OK
                </button>
                <button className="rpg-button" onClick={() => setEditingId(null)}
                  style={{ padding: '2px 8px', fontSize: '0.75rem', opacity: 0.4 }}>
                  {t('coinify.cancel')}
                </button>
              </div>
            ) : (
              <>
                <span style={{ flex: 1, fontWeight: 'bold', cursor: 'pointer' }} onClick={() => startEdit(card)}>
                  {card.name} <span style={{ fontSize: '0.75rem', opacity: 0.6 }}>({t('coinify.closingDay')}: {card.closingDay})</span>
                </span>
                {confirmingDelete === card.id ? (
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--rpg-hp-red)' }}>
                      {t('coinify.confirmDelete')}
                    </span>
                    <button className="rpg-button" onClick={() => handleDelete(card.id)}
                      style={{ padding: '2px 8px', fontSize: '0.75rem', color: 'var(--rpg-hp-red)' }}>
                      {t('coinify.yes')}
                    </button>
                    <button className="rpg-button" onClick={() => setConfirmingDelete(null)}
                      style={{ padding: '2px 8px', fontSize: '0.75rem', opacity: 0.4 }}>
                      {t('coinify.no')}
                    </button>
                  </div>
                ) : (
                  <button className="rpg-button" onClick={() => setConfirmingDelete(card.id)}
                    style={{ padding: '3px 8px', fontSize: '0.75rem', opacity: 0.4 }}>
                    {t('coinify.delete')}
                  </button>
                )}
              </>
            )}
          </div>
        ))}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
          <input className="rpg-input" placeholder={t('coinify.cardName')} value={newName}
            onChange={(e) => setNewName(e.target.value)} style={{ flex: 1 }}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()} />
          <input type="number" className="rpg-input" placeholder={t('coinify.closingDay')}
            value={newClosingDay}
            onChange={(e) => setNewClosingDay(Math.min(28, Math.max(1, parseInt(e.target.value) || 1)))}
            style={{ width: 60 }} min={1} max={28} />
          <button className="rpg-button" onClick={handleCreate} disabled={!newName.trim()}>
            + {t('coinify.newCard')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
