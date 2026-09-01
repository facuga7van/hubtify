import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '../../../../shared/components/ConfirmDialog';
import { useToast } from '../../../../shared/components/useToast';
import { useModalA11y } from '../../../../shared/hooks/useModalA11y';
import { CrossMark, Pencil, Checkmark } from '../../../../shared/components/icons';
import RpgNumberInput from '../../../../shared/components/RpgNumberInput';
import { AccountKindGlyph } from './AccountGlyphs';
import { formatCurrency } from '../../utils/format';
import {
  deleteAccount,
  getAccounts,
  hasTransferSupport,
  saveAccount,
  transferBetweenAccounts,
  failureMessage,
} from '../../utils/api-ext';
import type { AccountKind, Currency, FinanceAccount } from '../../types';

interface Props {
  onClose: () => void;
  /** Fired after every successful write so the caller can refresh its own numbers. */
  onSaved: () => void;
}

const KINDS: AccountKind[] = ['cash', 'bank', 'wallet'];

/**
 * Create / edit / soft-delete accounts, plus the "Transferir" mini-form —
 * the same modal pattern as `CreditCardManager`. Deleting is a soft delete:
 * the account's transactions keep their history, only the row disappears
 * from the chest.
 */
export default function AccountManager({ onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const { toast } = useToast();

  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);

  // New-account form
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<AccountKind>('bank');
  const [newCurrency, setNewCurrency] = useState<Currency>('ARS');
  const [newInitial, setNewInitial] = useState('');

  // Inline edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editKind, setEditKind] = useState<AccountKind>('bank');
  const [editInitial, setEditInitial] = useState('');

  // Transfer mini-form
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferFrom, setTransferFrom] = useState('');
  const [transferTo, setTransferTo] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferring, setTransferring] = useState(false);

  const { dialogProps, stopPropagation } = useModalA11y({ onClose });

  const loadAccounts = useCallback(() => {
    getAccounts().then((rows) => setAccounts(rows ?? []));
  }, []);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  useEffect(() => {
    const handler = () => loadAccounts();
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
  }, [loadAccounts]);

  const notifySaved = () => {
    loadAccounts();
    window.dispatchEvent(new Event('finance:accountsChanged'));
    onSaved();
  };

  const kindLabel = (kind: AccountKind) =>
    kind === 'cash'
      ? t('coinify.accountKind_cash', 'Efectivo')
      : kind === 'bank'
        ? t('coinify.accountKind_bank', 'Banco')
        : t('coinify.accountKind_wallet', 'Billetera virtual');

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const initial = parseFloat(newInitial);
    const result = await saveAccount({
      name: newName.trim(),
      kind: newKind,
      currency: newCurrency,
      initialBalance: Number.isFinite(initial) ? initial : 0,
    });
    if (result && result.ok === false) {
      toast({ type: 'warning', message: failureMessage(result.reason, t) });
      return;
    }
    setNewName('');
    setNewInitial('');
    notifySaved();
  };

  const startEdit = (account: FinanceAccount) => {
    setEditingId(account.id);
    setEditName(account.name);
    setEditKind(account.kind);
    setEditInitial(String(account.initialBalance));
  };

  const handleUpdate = async () => {
    if (!editingId || !editName.trim()) return;
    const account = accounts.find((a) => a.id === editingId);
    if (!account) return;
    const initial = parseFloat(editInitial);
    const result = await saveAccount({
      id: editingId,
      name: editName.trim(),
      kind: editKind,
      // The currency of an account with history must not flip — its balance
      // would silently change unit. Not offered in the edit row.
      currency: account.currency,
      initialBalance: Number.isFinite(initial) ? initial : 0,
      order: account.accountOrder,
    });
    if (result && result.ok === false) {
      toast({ type: 'warning', message: failureMessage(result.reason, t) });
      return;
    }
    setEditingId(null);
    notifySaved();
  };

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      message: t('coinify.deleteAccountConfirm', '¿Eliminar esta cuenta? Sus movimientos conservan el historial.'),
      danger: true,
      confirmText: t('coinify.delete'),
    });
    if (!ok) return;
    const result = await deleteAccount(id);
    if (result && result.ok === false) {
      toast({ type: 'warning', message: failureMessage(result.reason, t) });
      return;
    }
    notifySaved();
  };

  const handleTransfer = async () => {
    const amount = parseFloat(transferAmount);
    if (!transferFrom || !transferTo || !Number.isFinite(amount) || amount <= 0 || transferring) return;
    if (transferFrom === transferTo) {
      toast({ type: 'warning', message: t('coinify.transferSameAccount', 'Elegí dos cuentas distintas') });
      return;
    }
    setTransferring(true);
    try {
      const result = await transferBetweenAccounts({ fromId: transferFrom, toId: transferTo, amount });
      if (!result || result.ok === false) {
        toast({ type: 'warning', message: failureMessage(result?.reason ?? 'ipc_error', t) });
        return;
      }
      toast({ type: 'success', message: t('coinify.transferSuccess', 'Transferencia registrada') });
      setTransferAmount('');
      setShowTransfer(false);
      notifySaved();
      window.dispatchEvent(new Event('finance:dataChanged'));
    } finally {
      setTransferring(false);
    }
  };

  const canTransfer = hasTransferSupport() && accounts.length >= 2;

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
        aria-label={t('coinify.manageAccounts', 'Gestionar cuentas')}
        onClick={stopPropagation}
      >
        <div className="coin-modal__header">
          <div className="rpg-card-title" style={{ margin: 0 }}>{t('coinify.manageAccounts', 'Gestionar cuentas')}</div>
          <button
            className="rpg-button tap-target"
            aria-label={t('coinify.close', 'Cerrar')}
            title={t('coinify.close', 'Cerrar')}
            onClick={onClose}
            style={{ padding: '2px 8px' }}
          ><CrossMark style={{ width: '0.7em', height: '0.7em' }} /></button>
        </div>

        {accounts.map((account) => (
          <div key={account.id} className="coin-account-manager__row">
            {editingId === account.id ? (
              <div style={{ display: 'flex', gap: 4, alignItems: 'center', flex: 1, flexWrap: 'wrap' }}>
                <input className="rpg-input" value={editName}
                  aria-label={t('coinify.accountName', 'Nombre de cuenta')}
                  onChange={(e) => setEditName(e.target.value)} style={{ flex: 1, minWidth: 90 }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleUpdate();
                    if (e.key === 'Escape') setEditingId(null);
                  }} />
                <select className="rpg-select" value={editKind}
                  aria-label={t('coinify.accountKindLabel', 'Tipo de cuenta')}
                  onChange={(e) => setEditKind(e.target.value as AccountKind)}>
                  {KINDS.map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}
                </select>
                <RpgNumberInput value={editInitial}
                  onChange={setEditInitial}
                  aria-label={t('coinify.accountInitialBalance', 'Saldo inicial')}
                  style={{ width: 100 }} step={0.01} />
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
                <span className="coin-account-manager__icon" title={kindLabel(account.kind)}>
                  <AccountKindGlyph kind={account.kind} />
                </span>
                <span style={{ flex: 1, fontWeight: 'bold', minWidth: 0 }}>
                  {account.name}{' '}
                  <span style={{ fontSize: 'var(--fs-label)', opacity: 0.6 }}>
                    ({kindLabel(account.kind)} · {account.currency})
                  </span>
                </span>
                <span className="qb-numeral" style={{ fontSize: 'var(--fs-label)' }}>
                  {formatCurrency(account.balance, { currency: account.currency })}
                </span>
                <button className="rpg-button coin-action-btn coin-action-btn--muted" onClick={() => startEdit(account)}
                  aria-label={t('coinify.editAccount', 'Editar cuenta')}
                  title={t('coinify.editAccount', 'Editar cuenta')}>
                  <Pencil style={{ width: '0.75em', height: '0.75em' }} />
                </button>
                <button className="rpg-button coin-manager__delete" onClick={() => handleDelete(account.id)}>
                  {t('coinify.delete')}
                </button>
              </>
            )}
          </div>
        ))}

        {/* New account */}
        <div className="coin-account-manager__create">
          <input className="rpg-input" placeholder={t('coinify.accountName', 'Nombre de cuenta')} value={newName}
            aria-label={t('coinify.accountName', 'Nombre de cuenta')}
            onChange={(e) => setNewName(e.target.value)} style={{ flex: 1, minWidth: 90 }}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()} />
          <select className="rpg-select" value={newKind}
            aria-label={t('coinify.accountKindLabel', 'Tipo de cuenta')}
            onChange={(e) => setNewKind(e.target.value as AccountKind)}>
            {KINDS.map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}
          </select>
          <select className="rpg-select" value={newCurrency}
            aria-label="ARS / USD"
            onChange={(e) => setNewCurrency(e.target.value as Currency)} style={{ width: 70 }}>
            <option value="ARS">ARS</option>
            <option value="USD">USD</option>
          </select>
          <RpgNumberInput value={newInitial}
            onChange={setNewInitial}
            aria-label={t('coinify.accountInitialBalance', 'Saldo inicial')}
            placeholder={t('coinify.accountInitialBalance', 'Saldo inicial')}
            style={{ width: 110 }} step={0.01} />
          <button className="rpg-button" onClick={handleCreate} disabled={!newName.trim()}>
            + {t('coinify.newAccount', 'Nueva cuenta')}
          </button>
        </div>
        <p className="qb-hand" style={{ fontSize: 'var(--fs-label)', opacity: 0.6, margin: '6px 0 0' }}>
          {t('coinify.accountInitialHint', 'Saldo inicial: lo que la cuenta tiene HOY. Desde acá, cada movimiento con cuenta lo actualiza solo.')}
        </p>

        {/* Transfer between accounts */}
        {canTransfer && (
          <div className="coin-account-manager__transfer">
            <button
              type="button"
              className="rpg-button"
              style={{ fontSize: 'var(--fs-label)' }}
              aria-expanded={showTransfer}
              onClick={() => setShowTransfer((v) => !v)}
            >
              {t('coinify.transferBetween', 'Transferir entre cuentas')}
            </button>
            {showTransfer && (
              <div className="coin-transfer-form">
                <select className="rpg-select" value={transferFrom}
                  aria-label={t('coinify.transferFrom', 'Desde')}
                  onChange={(e) => setTransferFrom(e.target.value)}>
                  <option value="">{t('coinify.transferFrom', 'Desde')}</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
                </select>
                <select className="rpg-select" value={transferTo}
                  aria-label={t('coinify.transferTo', 'Hacia')}
                  onChange={(e) => setTransferTo(e.target.value)}>
                  <option value="">{t('coinify.transferTo', 'Hacia')}</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
                </select>
                <RpgNumberInput value={transferAmount}
                  onChange={setTransferAmount}
                  aria-label={t('coinify.amount', 'Monto')}
                  placeholder={t('coinify.amount', 'Monto')}
                  style={{ width: 110 }} min={0} step={0.01} />
                <button
                  className="rpg-button"
                  onClick={handleTransfer}
                  disabled={transferring || !transferFrom || !transferTo || !(parseFloat(transferAmount) > 0)}
                >
                  {transferring ? '...' : t('coinify.transferSubmit', 'Transferir')}
                </button>
                <p className="qb-hand coin-transfer-form__hint">
                  {t('coinify.transferHint', 'Mueve plata entre tus cuentas: no cuenta como gasto ni como ingreso del mes.')}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
