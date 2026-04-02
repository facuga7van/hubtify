import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MonthNavigator } from './shared/MonthNavigator';
import { QuickAddForm } from './shared/QuickAddForm';
import { useToast } from '../../../shared/components/useToast';
import type { TransactionType, PaymentMethod, Currency } from '../types';
import { addTransaction } from '../../../shared/animations/feedback';
import RpgNumberInput from '../../../shared/components/RpgNumberInput';

interface TransactionRow {
  id: string;
  type: TransactionType;
  amount: number;
  currency: Currency;
  category: string;
  description: string;
  date: string;
  paymentMethod: PaymentMethod;
  source: string;
  installments?: number;
  installmentGroupId?: string;
  forThirdParty?: string;
}

// Source badge icons
const SourceIcon = ({ source }: { source: string }) => {
  if (source === 'recurring') return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
  if (source === 'import') return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
  // manual
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
};

export default function Transactions() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const defaultType = (searchParams.get('type') as TransactionType) || 'expense';

  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [filterCategory, setFilterCategory] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterPayment, setFilterPayment] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState({ amount: '', description: '', category: '' });
  const [showForm, setShowForm] = useState(true);
  const [enteringId, setEnteringId] = useState<string | null>(null);
  const [exitingId, setExitingId] = useState<string | null>(null);
  const [enteringType, setEnteringType] = useState<TransactionType | null>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const loadTransactions = useCallback(() => {
    const filters: Record<string, string> = { month };
    if (filterCategory) filters.category = filterCategory;
    if (filterType) filters.type = filterType;
    if (filterPayment) filters.paymentMethod = filterPayment;
    window.api.financeGetTransactions(filters).then((data) => setTransactions(data as TransactionRow[]));
  }, [month, filterCategory, filterType, filterPayment]);

  useEffect(() => {
    loadTransactions();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    window.api.financeGenerateRecurringForMonth(currentMonth);
  }, [loadTransactions]);

  // Trigger slide-in animation when a new transaction row mounts
  useEffect(() => {
    if (!enteringId) return;
    const el = rowRefs.current.get(enteringId);
    if (!el) return;
    const flashColor = enteringType === 'income' ? '#d4a017' : '#e74c3c';
    addTransaction(el, { el, color: flashColor });
  }, [enteringId, enteringType, transactions]);

  const handleAdd = async (data: {
    type: TransactionType; amount: number; category: string; description: string;
    date: string; currency: Currency; paymentMethod: PaymentMethod; installments: number;
    creditCardId?: string;
  }) => {
    let newId: string;
    if (data.paymentMethod === 'credit_card' && data.installments > 1) {
      newId = await window.api.financeCreateInstallmentGroup({
        description: data.description || data.category,
        totalAmount: data.amount * data.installments,
        installmentCount: data.installments,
        installmentAmount: data.amount,
        currency: data.currency,
        category: data.category,
        startDate: data.date,
        creditCardId: data.creditCardId,
      });
    } else {
      newId = await window.api.financeAddTransaction({
        type: data.type,
        amount: data.amount,
        currency: data.currency,
        category: data.category,
        description: data.description,
        date: data.date,
        paymentMethod: data.paymentMethod,
        creditCardId: data.creditCardId,
      });
    }
    loadTransactions();
    // Brief entering animation
    setEnteringId(newId);
    setEnteringType(data.type);
    setTimeout(() => { setEnteringId(null); setEnteringType(null); }, 600);
    // Toast
    const formatted = `$${data.amount.toLocaleString(data.currency === 'USD' ? 'en-US' : 'es-AR')}`;
    toast({
      type: 'coin',
      message: `${formatted} ${t('coinify.in')} ${data.category}`,
      details: { transactionType: data.type === 'income' ? 'income' : 'expense' },
    });
  };

  const handleDelete = async (id: string) => {
    setExitingId(id);
    // Wait for exit animation
    setTimeout(async () => {
      await window.api.financeDeleteTransaction(id);
      setExitingId(null);
      loadTransactions();
    }, 300);
  };

  const startEdit = (tx: TransactionRow) => {
    setEditingId(tx.id);
    setEditFields({
      amount: String(tx.amount),
      description: tx.description || '',
      category: tx.category,
    });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const amount = parseFloat(editFields.amount);
    if (!isFinite(amount) || amount <= 0) return;
    await window.api.financeUpdateTransaction(editingId, {
      amount,
      description: editFields.description,
      category: editFields.category,
    });
    setEditingId(null);
    loadTransactions();
  };

  const paymentMethodLabel = (pm: string) => {
    const labels: Record<string, string> = {
      cash: t('coinify.cash'), debit: t('coinify.debit'),
      transfer: t('coinify.transfer'), credit_card: t('coinify.creditCard'),
    };
    return labels[pm] || pm;
  };

  return (
    <div>
      {/* Toggle form + Month nav */}
      <div data-anim="stagger-child" className="coin-dashboard__header" style={{ marginBottom: 16 }}>
        <MonthNavigator month={month} onChange={setMonth} />
        <button className="rpg-button coin-month-nav__btn"
          onClick={() => setShowForm(!showForm)}>
          {showForm ? '\u25B2' : `+ ${t('coinify.quickAdd')}`}
        </button>
      </div>

      {/* Quick Add Form with collapse animation */}
      <div className={`coin-quick-add-form ${showForm ? 'coin-quick-add-form--open' : 'coin-quick-add-form--closed'}`}>
        {showForm && <QuickAddForm onSubmit={handleAdd} defaultType={defaultType} />}
      </div>

      {/* Filters */}
      <div className="coin-filters">
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="rpg-select">
          <option value="">{t('coinify.expense')} / {t('coinify.income')}</option>
          <option value="expense">{t('coinify.expense')}</option>
          <option value="income">{t('coinify.income')}</option>
        </select>
        <select value={filterPayment} onChange={(e) => setFilterPayment(e.target.value)} className="rpg-select">
          <option value="">{t('coinify.paymentMethod')}</option>
          <option value="cash">{t('coinify.cash')}</option>
          <option value="debit">{t('coinify.debit')}</option>
          <option value="transfer">{t('coinify.transfer')}</option>
          <option value="credit_card">{t('coinify.creditCard')}</option>
        </select>
      </div>

      {/* Transaction List */}
      <div data-anim="stagger-child" className="coin-tx-list">
        {transactions.length === 0 ? (
          <p className="coin-empty">{t('coinify.noTransactions')}</p>
        ) : (
          transactions.map((tx) => {
            const isEntering = enteringId === tx.id;
            const isExiting = exitingId === tx.id;
            const isEditing = editingId === tx.id;

            return (
              <div
                key={tx.id}
                ref={(el) => {
                  if (el) rowRefs.current.set(tx.id, el);
                  else rowRefs.current.delete(tx.id);
                }}
                className={[
                  'coin-tx',
                  tx.type === 'income' ? 'coin-tx--income' : 'coin-tx--expense',
                  isExiting ? 'coin-tx--exiting' : '',
                  isEditing ? 'coin-tx--editing' : '',
                ].filter(Boolean).join(' ')}
              >
                {isEditing ? (
                  <div className="coin-tx__edit-row">
                    <RpgNumberInput value={editFields.amount}
                      onChange={(v) => setEditFields({ ...editFields, amount: v })}
                      style={{ width: 90 }} fontSize="0.85rem" min={0} step={0.01} />
                    <input type="text" value={editFields.description}
                      onChange={(e) => setEditFields({ ...editFields, description: e.target.value })}
                      className="rpg-input" style={{ flex: 1, fontSize: '0.85rem' }} />
                    <button className="rpg-button" style={{ fontSize: '0.8rem', padding: '4px 8px' }}
                      onClick={saveEdit}>{t('coinify.saveTransaction')}</button>
                    <button className="rpg-button" style={{ fontSize: '0.8rem', padding: '4px 8px' }}
                      onClick={() => setEditingId(null)}>{t('coinify.cancelEdit')}</button>
                  </div>
                ) : (
                  <>
                    <span className="coin-tx__date">{tx.date.slice(5)}</span>
                    <span className="coin-tx__desc" title={tx.description}>
                      {tx.description || tx.category}
                      {!!tx.forThirdParty && (
                        <span className="coin-tx__badge coin-tx__badge--third-party">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          </svg>
                          {' '}{tx.forThirdParty}
                        </span>
                      )}
                    </span>
                    <span className="coin-tx__badge coin-tx__badge--category">{tx.category}</span>
                    <span className="coin-tx__badge coin-tx__badge--source">
                      <SourceIcon source={tx.source} />
                    </span>
                    <span className="coin-tx__payment-method">{paymentMethodLabel(tx.paymentMethod)}</span>
                    <span className={`coin-tx__amount ${tx.type === 'income' ? 'coin-tx__amount--income' : 'coin-tx__amount--expense'}`}>
                      {tx.type === 'income' ? '+' : '-'}${tx.amount.toLocaleString(tx.currency === 'USD' ? 'en-US' : 'es-AR')}
                      {tx.currency === 'USD' && ' USD'}
                    </span>
                    <div className="coin-tx__actions">
                      <button className="rpg-button coin-tx__action-btn" style={{ fontSize: '0.8rem', padding: '2px 6px' }}
                        onClick={() => startEdit(tx)}>{'\u270E'}</button>
                      <button className="rpg-button coin-tx__action-btn" style={{ fontSize: '0.8rem', padding: '2px 6px' }}
                        onClick={() => handleDelete(tx.id)}>{'\u2715'}</button>
                    </div>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
