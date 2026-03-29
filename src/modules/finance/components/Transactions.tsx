import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MonthNavigator } from './shared/MonthNavigator';
import { QuickAddForm } from './shared/QuickAddForm';
import type { TransactionType, PaymentMethod, Currency } from '../types';

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

export default function Transactions() {
  const { t } = useTranslation();
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

  const loadTransactions = useCallback(() => {
    const filters: Record<string, string> = { month };
    if (filterCategory) filters.category = filterCategory;
    if (filterType) filters.type = filterType;
    if (filterPayment) filters.paymentMethod = filterPayment;
    window.api.financeGetTransactions(filters).then(setTransactions);
  }, [month, filterCategory, filterType, filterPayment]);

  useEffect(() => {
    loadTransactions();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    window.api.financeGenerateRecurringForMonth(currentMonth);
  }, [loadTransactions]);

  const handleAdd = async (data: {
    type: TransactionType; amount: number; category: string; description: string;
    date: string; currency: Currency; paymentMethod: PaymentMethod; installments: number;
  }) => {
    if (data.paymentMethod === 'credit_card' && data.installments > 1) {
      await window.api.financeCreateInstallmentGroup({
        description: data.description || data.category,
        totalAmount: data.amount * data.installments,
        installmentCount: data.installments,
        installmentAmount: data.amount,
        currency: data.currency,
        category: data.category,
        startDate: data.date,
      });
    } else {
      await window.api.financeAddTransaction({
        type: data.type,
        amount: data.amount,
        currency: data.currency,
        category: data.category,
        description: data.description,
        date: data.date,
        paymentMethod: data.paymentMethod,
      });
    }
    loadTransactions();
  };

  const handleDelete = async (id: string) => {
    await window.api.financeDeleteTransaction(id);
    loadTransactions();
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
    await window.api.financeUpdateTransaction(editingId, {
      amount: parseFloat(editFields.amount),
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <MonthNavigator month={month} onChange={setMonth} />
        <button className="rpg-button" style={{ fontSize: '0.8rem', padding: '4px 10px' }}
          onClick={() => setShowForm(!showForm)}>
          {showForm ? '▲' : '+ ' + t('coinify.quickAdd')}
        </button>
      </div>

      {/* Quick Add Form */}
      {showForm && <QuickAddForm onSubmit={handleAdd} defaultType={defaultType} />}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)}
          className="rpg-select" style={{ fontSize: '0.85rem' }}>
          <option value="">{t('coinify.expense')} / {t('coinify.income')}</option>
          <option value="expense">{t('coinify.expense')}</option>
          <option value="income">{t('coinify.income')}</option>
        </select>
        <select value={filterPayment} onChange={(e) => setFilterPayment(e.target.value)}
          className="rpg-select" style={{ fontSize: '0.85rem' }}>
          <option value="">{t('coinify.paymentMethod')}</option>
          <option value="cash">{t('coinify.cash')}</option>
          <option value="debit">{t('coinify.debit')}</option>
          <option value="transfer">{t('coinify.transfer')}</option>
          <option value="credit_card">{t('coinify.creditCard')}</option>
        </select>
      </div>

      {/* Transaction List */}
      <div>
        {transactions.length === 0 ? (
          <p style={{ opacity: 0.5, fontStyle: 'italic', textAlign: 'center', padding: 24 }}>
            {t('coinify.noTransactions')}
          </p>
        ) : (
          transactions.map((tx) => (
            <div key={tx.id} className="rpg-card" style={{ marginBottom: 8, padding: 12 }}>
              {editingId === tx.id ? (
                /* Edit mode */
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="number" value={editFields.amount}
                    onChange={(e) => setEditFields({ ...editFields, amount: e.target.value })}
                    className="rpg-input" style={{ width: 90, fontSize: '0.85rem' }} />
                  <input type="text" value={editFields.description}
                    onChange={(e) => setEditFields({ ...editFields, description: e.target.value })}
                    className="rpg-input" style={{ flex: 1, fontSize: '0.85rem' }} />
                  <button className="rpg-button" style={{ fontSize: '0.8rem', padding: '4px 8px' }}
                    onClick={saveEdit}>{t('coinify.saveTransaction')}</button>
                  <button className="rpg-button" style={{ fontSize: '0.8rem', padding: '4px 8px' }}
                    onClick={() => setEditingId(null)}>{t('coinify.cancelEdit')}</button>
                </div>
              ) : (
                /* View mode */
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ fontSize: '0.8rem', opacity: 0.5, width: 70, flexShrink: 0 }}>{tx.date.slice(5)}</span>
                  <span style={{ flex: 1, fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={tx.description}>
                    {tx.description || tx.category}
                    {tx.forThirdParty && (
                      <span style={{ marginLeft: 8, fontSize: '0.75rem', padding: '1px 6px', borderRadius: 3, background: 'rgba(201, 168, 76, 0.2)', color: 'var(--rpg-gold)' }}>
                        → {tx.forThirdParty}
                      </span>
                    )}
                  </span>
                  <span style={{ fontSize: '0.75rem', background: 'var(--rpg-gold)', color: 'var(--rpg-ink)', padding: '1px 6px', borderRadius: 3 }}>
                    {tx.category}
                  </span>
                  <span style={{ fontSize: '0.75rem', opacity: 0.5 }}>{paymentMethodLabel(tx.paymentMethod)}</span>
                  <span style={{
                    fontFamily: 'Fira Code, monospace',
                    fontSize: '0.85rem',
                    color: tx.type === 'income' ? 'var(--rpg-xp-green)' : 'var(--rpg-hp-red)',
                  }}>
                    {tx.type === 'income' ? '+' : '-'}${tx.amount.toLocaleString(tx.currency === 'USD' ? 'en-US' : 'es-AR')}
                    {tx.currency === 'USD' && ' USD'}
                  </span>
                  <button className="rpg-button" style={{ fontSize: '0.8rem', padding: '2px 6px', opacity: 0.5 }}
                    onClick={() => startEdit(tx)}>✎</button>
                  <button className="rpg-button" style={{ fontSize: '0.8rem', padding: '2px 6px', opacity: 0.5 }}
                    onClick={() => handleDelete(tx.id)}>✕</button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
