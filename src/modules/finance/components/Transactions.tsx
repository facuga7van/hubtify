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
    // Auto-generate recurring for current month on page load
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    window.api.financeGenerateRecurringForMonth(currentMonth);
  }, [loadTransactions]);

  const handleAdd = async (data: {
    type: TransactionType; amount: number; category: string; description: string;
    date: string; currency: Currency; paymentMethod: PaymentMethod; installments: number;
  }) => {
    if (data.paymentMethod === 'credit_card' && data.installments > 1) {
      // Create installment group + transactions
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
    <div className="space-y-4">
      {/* Toggle form + Month nav */}
      <div className="flex items-center justify-between">
        <MonthNavigator month={month} onChange={setMonth} />
        <button className="rpg-btn-sm" onClick={() => setShowForm(!showForm)}>
          {showForm ? '▲' : '+ ' + t('coinify.quickAdd')}
        </button>
      </div>

      {/* Quick Add Form */}
      {showForm && <QuickAddForm onSubmit={handleAdd} defaultType={defaultType} />}

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="rpg-select text-sm">
          <option value="">{t('coinify.expense')} / {t('coinify.income')}</option>
          <option value="expense">{t('coinify.expense')}</option>
          <option value="income">{t('coinify.income')}</option>
        </select>
        <select value={filterPayment} onChange={(e) => setFilterPayment(e.target.value)} className="rpg-select text-sm">
          <option value="">{t('coinify.paymentMethod')}</option>
          <option value="cash">{t('coinify.cash')}</option>
          <option value="debit">{t('coinify.debit')}</option>
          <option value="transfer">{t('coinify.transfer')}</option>
          <option value="credit_card">{t('coinify.creditCard')}</option>
        </select>
      </div>

      {/* Transaction List */}
      <div className="space-y-1">
        {transactions.length === 0 ? (
          <p className="text-sm opacity-40 text-center py-8">{t('coinify.noTransactions')}</p>
        ) : (
          transactions.map((tx) => (
            <div key={tx.id} className="rpg-card p-3 flex items-center gap-3">
              {editingId === tx.id ? (
                /* Edit mode */
                <div className="flex-1 flex gap-2 items-center">
                  <input type="number" value={editFields.amount}
                    onChange={(e) => setEditFields({ ...editFields, amount: e.target.value })}
                    className="rpg-input w-24 text-sm" />
                  <input type="text" value={editFields.description}
                    onChange={(e) => setEditFields({ ...editFields, description: e.target.value })}
                    className="rpg-input flex-1 text-sm" />
                  <button className="rpg-btn-sm" onClick={saveEdit}>{t('coinify.saveTransaction')}</button>
                  <button className="rpg-btn-sm" onClick={() => setEditingId(null)}>{t('coinify.cancelEdit')}</button>
                </div>
              ) : (
                /* View mode */
                <>
                  <span className="text-xs opacity-40 w-20">{tx.date.slice(5)}</span>
                  <span className="flex-1 text-sm truncate" title={tx.description}>
                    {tx.description || tx.category}
                    {tx.forThirdParty && (
                      <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-[#C9A84C]/20 text-[#C9A84C]">
                        → {tx.forThirdParty}
                      </span>
                    )}
                  </span>
                  <span className="text-xs opacity-30">{tx.category}</span>
                  <span className="text-xs opacity-30">{paymentMethodLabel(tx.paymentMethod)}</span>
                  <span className={`font-mono text-sm ${tx.type === 'income' ? 'text-[#2D5A27]' : 'text-[#8B2020]'}`}>
                    {tx.type === 'income' ? '+' : '-'}${tx.amount.toLocaleString(tx.currency === 'USD' ? 'en-US' : 'es-AR')}
                    {tx.currency === 'USD' && ' USD'}
                  </span>
                  <button className="opacity-30 hover:opacity-60 text-sm" onClick={() => startEdit(tx)}>✎</button>
                  <button className="opacity-30 hover:text-[#8B2020] text-sm" onClick={() => handleDelete(tx.id)}>✕</button>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
