import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../../shared/components/Tooltip';
import HelpBubble from '../../../shared/components/HelpBubble';
import Import from './Import';
import { MonthNavigator } from './shared/MonthNavigator';
import { QuickAddForm } from './shared/QuickAddForm';
import { useToast } from '../../../shared/components/useToast';
import type { TransactionType, PaymentMethod, Currency } from '../types';
import { addTransaction } from '../../../shared/animations/feedback';
import RpgNumberInput from '../../../shared/components/RpgNumberInput';
import { useConfirm } from '../../../shared/components/ConfirmDialog';
import { CategorySelect } from './shared/CategorySelect';
import { Rune } from '../../../shared/components/codex/CodexPrimitives';
import { ChevronUp, ChevronDown, ArrowRight, WarningTriangle, Pencil, CrossMark } from '../../../shared/components/icons';
import { formatCurrency } from '../utils/format';

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
  impactsBalance?: number;
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
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
};

function toRoman(n: number): string {
  const numerals: [number, string][] = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let result = '';
  for (const [val, sym] of numerals) {
    while (n >= val) { result += sym; n -= val; }
  }
  return result;
}

type SortField = 'date' | 'description' | 'category' | 'amount';
type SortDir = 'asc' | 'desc';

export default function Transactions() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [showImport, setShowImport] = useState(false);
  const defaultType = (searchParams.get('type') as TransactionType) || 'expense';

  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [filterCategory, setFilterCategory] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterPayment, setFilterPayment] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(50);

  // Sort state
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir(field === 'date' ? 'desc' : 'asc');
    }
  };

  const handleMonthChange = (newMonth: string) => {
    setMonth(newMonth);
    setFilterCategory('');
    setFilterType('');
    setFilterPayment('');
    setSearchQuery('');
    setVisibleCount(50);
  };

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState({ amount: '', description: '', category: '', date: '', paymentMethod: '' });
  const [showForm, setShowForm] = useState(true);
  const [enteringId, setEnteringId] = useState<string | null>(null);
  const [exitingId, setExitingId] = useState<string | null>(null);
  const [enteringType, setEnteringType] = useState<TransactionType | null>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Accordion collapsed state
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('coinify_collapsed_sections');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });

  const toggleSection = (key: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      localStorage.setItem('coinify_collapsed_sections', JSON.stringify([...next]));
      return next;
    });
  };

  // Reset pagination when filters change
  useEffect(() => {
    setVisibleCount(50);
  }, [filterCategory, filterType, filterPayment, searchQuery]);

  // C7: Category averages for anomaly detection
  const [categoryAverages, setCategoryAverages] = useState<Record<string, number>>({});

  const loadCategoryAverages = useCallback(() => {
    window.api.financeGetCategoryAverages().then((data) => setCategoryAverages(data));
  }, []);

  const loadTransactions = useCallback(() => {
    window.api.financeGetTransactions({ month }).then((data) => setTransactions(data as TransactionRow[]));
  }, [month]);

  const recurringTx = transactions.filter((tx) => tx.source === 'recurring');
  const normalTx = transactions.filter((tx) => tx.source !== 'recurring');
  const filteredNormalTx = normalTx.filter((tx) => {
    if (filterCategory && tx.category !== filterCategory) return false;
    if (filterType && tx.type !== filterType) return false;
    if (filterPayment && tx.paymentMethod !== filterPayment) return false;
    if (searchQuery && !(tx.description?.toLowerCase().includes(searchQuery.toLowerCase()) || tx.category?.toLowerCase().includes(searchQuery.toLowerCase()))) return false;
    return true;
  });

  // Sorted transactions
  const sortedTx = useMemo(() => {
    const sorted = [...filteredNormalTx].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'date': cmp = a.date.localeCompare(b.date); break;
        case 'description': cmp = (a.description || '').localeCompare(b.description || ''); break;
        case 'category': cmp = (a.category || '').localeCompare(b.category || ''); break;
        case 'amount': cmp = a.amount - b.amount; break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [filteredNormalTx, sortField, sortDir]);

  // C7: Compute anomalous categories for current month
  const anomalousCategories = useMemo(() => {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    if (month !== currentMonth || Object.keys(categoryAverages).length === 0) return new Set<string>();

    const totals: Record<string, number> = {};
    for (const tx of transactions) {
      if (tx.type === 'expense' && tx.currency === 'ARS') {
        totals[tx.category] = (totals[tx.category] || 0) + tx.amount;
      }
    }

    const result = new Set<string>();
    for (const [cat, total] of Object.entries(totals)) {
      const avg = categoryAverages[cat];
      if (avg && avg > 0 && total > avg * 1.5) {
        result.add(cat);
      }
    }
    return result;
  }, [month, transactions, categoryAverages]);

  const filteredRecurringTx = recurringTx.filter((tx) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return tx.description?.toLowerCase().includes(q) || tx.category?.toLowerCase().includes(q);
  });

  // Ledger section header
  const SectionHeader = ({ sectionKey, title, count }: { sectionKey: string; title: string; count: number }) => {
    const isCollapsed = collapsedSections.has(sectionKey);
    return (
      <div className="coin-ledger-section-header" onClick={() => toggleSection(sectionKey)}>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor"
          strokeWidth="1.5" strokeLinecap="round"
          style={{ transition: 'transform 0.2s', transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)' }}>
          <path d="M3 1l4 4-4 4" />
        </svg>
        <span className="coin-ledger-section-header__title">{title}</span>
        <span className="coin-ledger-section-header__count">{count}</span>
      </div>
    );
  };

  useEffect(() => {
    loadTransactions();
    loadCategoryAverages();
    const freshNow = new Date();
    const currentMonth = `${freshNow.getFullYear()}-${String(freshNow.getMonth() + 1).padStart(2, '0')}`;
    window.api.financeGenerateRecurringForMonth(currentMonth);
  }, [loadTransactions, loadCategoryAverages]);

  useEffect(() => {
    const handler = () => { loadTransactions(); loadCategoryAverages(); };
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
  }, [loadTransactions, loadCategoryAverages]);

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
    try {
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
      window.dispatchEvent(new Event('finance:dataChanged'));
      setEnteringId(newId);
      setEnteringType(data.type);
      setTimeout(() => { setEnteringId(null); setEnteringType(null); }, 600);
      const formatted = formatCurrency(data.amount, { currency: data.currency });
      toast({
        type: 'coin',
        message: `${formatted} ${t('coinify.in')} ${data.category}`,
        details: { transactionType: data.type === 'income' ? 'income' : 'expense' },
      });
    } catch (err) {
      console.error('[Transactions] handleAdd failed:', err);
      toast({ type: 'warning', message: t('coinify.saveError', 'Error al guardar') });
    }
  };

  const handleDelete = async (id: string) => {
    const ok = await confirm({ message: t('coinify.deleteTransactionConfirm'), danger: true, confirmText: t('coinify.delete') });
    if (!ok) return;
    setExitingId(id);
    setTimeout(async () => {
      try {
        await window.api.financeDeleteTransaction(id);
        setExitingId(null);
        loadTransactions();
        window.dispatchEvent(new Event('finance:dataChanged'));
      } catch (err) {
        console.error('[Transactions] financeDeleteTransaction failed:', err);
        setExitingId(null);
        toast({ type: 'warning', message: t('coinify.deleteError', 'Error al eliminar') });
      }
    }, 300);
  };

  const startEdit = (tx: TransactionRow) => {
    setEditingId(tx.id);
    setEditFields({
      amount: String(tx.amount),
      description: tx.description || '',
      category: tx.category,
      date: tx.date,
      paymentMethod: tx.paymentMethod,
    });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const amount = parseFloat(editFields.amount);
    if (!isFinite(amount) || amount <= 0) {
      toast({ type: 'warning', message: t('coinify.validationAmount', 'Ingresá un monto válido') });
      return;
    }
    try {
      await window.api.financeUpdateTransaction(editingId, {
        amount,
        description: editFields.description,
        category: editFields.category,
        date: editFields.date,
        paymentMethod: editFields.paymentMethod,
      });
      setEditingId(null);
      loadTransactions();
      window.dispatchEvent(new Event('finance:dataChanged'));
    } catch (err) {
      console.error('[Transactions] financeUpdateTransaction failed:', err);
      toast({ type: 'warning', message: t('coinify.saveError', 'Error al guardar') });
    }
  };

  const paymentMethodLabel = (pm: string) => {
    const labels: Record<string, string> = {
      cash: t('coinify.cash'), debit: t('coinify.debit'),
      transfer: t('coinify.transfer'), credit_card: t('coinify.creditCard'),
    };
    return labels[pm] || pm;
  };

  const sortIndicator = (field: SortField) => {
    if (sortField !== field) return null;
    return <span className="coin-sort-arrow">{sortDir === 'asc' ? <ChevronUp style={{ width: '0.65em', height: '0.65em' }} /> : <ChevronDown style={{ width: '0.65em', height: '0.65em' }} />}</span>;
  };

  const renderTxRow = (tx: TransactionRow) => {
    const isExiting = exitingId === tx.id;
    const isEditing = editingId === tx.id;
    const day = parseInt(tx.date.slice(8, 10), 10);

    return (
      <div
        key={tx.id}
        ref={(el) => {
          if (el) rowRefs.current.set(tx.id, el);
          else rowRefs.current.delete(tx.id);
        }}
        className={[
          'coin-ledger-row',
          tx.type === 'income' ? 'coin-ledger-row--income' : 'coin-ledger-row--expense',
          isExiting ? 'coin-ledger-row--exiting' : '',
          isEditing ? 'coin-ledger-row--editing' : '',
        ].filter(Boolean).join(' ')}
      >
        {isEditing ? (
          <div className="coin-ledger-row__edit">
            <RpgNumberInput value={editFields.amount}
              onChange={(v) => setEditFields({ ...editFields, amount: v })}
              style={{ width: 90 }} fontSize="0.85rem" min={0} step={0.01} />
            <input type="text" value={editFields.description}
              onChange={(e) => setEditFields({ ...editFields, description: e.target.value })}
              className="rpg-input" style={{ flex: 1, fontSize: 'var(--fs-label)' }} />
            <CategorySelect value={editFields.category}
              onChange={(cat) => setEditFields({ ...editFields, category: cat })} />
            <input type="date" className="rpg-input" value={editFields.date}
              onChange={(e) => setEditFields({ ...editFields, date: e.target.value })}
              style={{ width: 130, fontSize: 'var(--fs-label)' }} />
            <select className="rpg-select" value={editFields.paymentMethod}
              onChange={(e) => setEditFields({ ...editFields, paymentMethod: e.target.value })}
              style={{ fontSize: 'var(--fs-label)' }}>
              <option value="cash">{t('coinify.cash')}</option>
              <option value="debit">{t('coinify.debit')}</option>
              <option value="transfer">{t('coinify.transfer')}</option>
              <option value="credit_card">{t('coinify.creditCard')}</option>
            </select>
            <button className="rpg-button" style={{ fontSize: 'var(--fs-label)', padding: '4px 8px' }}
              onClick={saveEdit}>{t('coinify.saveTransaction')}</button>
            <button className="rpg-button" style={{ fontSize: 'var(--fs-label)', padding: '4px 8px' }}
              onClick={() => setEditingId(null)}>{t('coinify.cancelEdit')}</button>
          </div>
        ) : (
          <>
            <span className="coin-ledger-row__day qb-small-caps">{day}</span>
            <span className="coin-ledger-row__desc">
              {tx.description || tx.category}
              {!!tx.forThirdParty && (
                <span className="coin-ledger-row__third-party">
                  {' '}<ArrowRight style={{ width: '0.75em', height: '0.75em' }} />{' '}{tx.forThirdParty}
                </span>
              )}
            </span>
            <span className="coin-ledger-row__cat">
              <Rune tone={tx.type === 'income' ? 'sage' : undefined}>{tx.category}</Rune>
              {anomalousCategories.has(tx.category) && tx.type === 'expense' && (
                <Tooltip text={t('coinify.spendingAboveAverage', 'Gasto por encima del promedio')}>
                  <Rune tone="rubric"><WarningTriangle style={{ width: '0.8em', height: '0.8em', color: 'var(--rpg-hp-red)' }} /></Rune>
                </Tooltip>
              )}
            </span>
            <span className="coin-ledger-row__source">
              <SourceIcon source={tx.source} />
            </span>
            <span className="coin-ledger-row__payment">{paymentMethodLabel(tx.paymentMethod)}</span>
            {tx.impactsBalance === 0 && (
              <Rune tone="gold">TC</Rune>
            )}
            <span className={`coin-ledger-row__amount qb-numeral ${tx.type === 'income' ? 'coin-ledger-row__amount--income' : 'coin-ledger-row__amount--expense'}`}>
              {formatCurrency(
                tx.type === 'income' ? tx.amount : -tx.amount,
                { currency: tx.currency, showSign: tx.type === 'income' },
              )}
            </span>
            <div className="coin-ledger-row__actions">
              <button className="rpg-button coin-ledger-row__action-btn"
                onClick={() => startEdit(tx)}><Pencil style={{ width: '0.8em', height: '0.8em' }} /></button>
              <button className="rpg-button coin-ledger-row__action-btn"
                onClick={() => handleDelete(tx.id)}><CrossMark style={{ width: '0.7em', height: '0.7em' }} /></button>
            </div>
          </>
        )}
      </div>
    );
  };

  useEffect(() => {
    if (!showImport) return;
    document.body.style.overflow = 'hidden';
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowImport(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', handleKey);
    };
  }, [showImport]);

  return (
    <div>
      {/* Header with Month Nav */}
      <div className="coin-dashboard__header" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <MonthNavigator month={month} onChange={handleMonthChange} />
          <HelpBubble variant="inline" text={t('coinify.transactionsHelp', 'Movimientos del mes agrupados por tipo. Los gastos en cuotas muestran el número de cuota actual.')} />
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className="rpg-button coin-month-nav__btn" onClick={() => navigate('/finance/recurring')}>
            {t('coinify.recurringLabel')}
          </button>
          <button className="rpg-button coin-month-nav__btn" onClick={() => setShowImport(true)}>
            {t('coinify.import')}
          </button>
          <button className="rpg-button coin-month-nav__btn"
            onClick={() => setShowForm(!showForm)}>
            {showForm ? <ChevronUp style={{ width: '0.65em', height: '0.65em' }} /> : `+ ${t('coinify.quickAdd')}`}
          </button>
        </div>
      </div>

      {/* Quick Add Form */}
      <div className={`coin-quick-add-form ${showForm ? 'coin-quick-add-form--open' : 'coin-quick-add-form--closed'}`}>
        {showForm && <QuickAddForm onSubmit={handleAdd} defaultType={defaultType} />}
      </div>

      {/* Search */}
      <div style={{ marginBottom: 8 }}>
        <input
          className="rpg-input"
          placeholder={t('coinify.searchTransactions')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ width: '100%' }}
        />
      </div>

      {/* Ledger header */}
      <div className="coin-ledger-header">
        <span className="coin-sort-header" onClick={() => toggleSort('date')}>
          {t('coinify.colDate', 'DÍA')} {sortIndicator('date')}
        </span>
        <span className="coin-sort-header" onClick={() => toggleSort('description')}>
          {t('coinify.colDescription', 'CONCEPTO')} {sortIndicator('description')}
        </span>
        <span className="coin-sort-header" onClick={() => toggleSort('category')}>
          {t('coinify.colCategory', 'CATEGORÍA')} {sortIndicator('category')}
        </span>
        <span className="coin-sort-header" onClick={() => toggleSort('amount')} style={{ textAlign: 'right' }}>
          {t('coinify.colAmount', 'MONEDAS')} {sortIndicator('amount')}
        </span>
      </div>

      {/* Transactions Section */}
      <SectionHeader sectionKey="transactions" title={t('coinify.transactions')} count={filteredNormalTx.length} />
      {!collapsedSections.has('transactions') && (
        <>
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

          <div className="coin-ledger">
            {sortedTx.length === 0 ? (
              <p className="coin-empty-codex">{t('coinify.noTransactions')}</p>
            ) : (
              sortedTx.slice(0, visibleCount).map((tx) => renderTxRow(tx))
            )}
          </div>
          {visibleCount < sortedTx.length && (
            <button
              className="rpg-button"
              onClick={() => setVisibleCount(prev => prev + 50)}
              style={{ width: '100%', marginTop: '8px' }}
            >
              {t('coinify.loadMore', { remaining: sortedTx.length - visibleCount, defaultValue: `Show more (${sortedTx.length - visibleCount} remaining)` })}
            </button>
          )}
        </>
      )}

      {/* Recurring Section */}
      <SectionHeader sectionKey="recurring" title={t('coinify.recurringLabel')} count={filteredRecurringTx.length} />
      {!collapsedSections.has('recurring') && (
        <div className="coin-ledger">
          {filteredRecurringTx.length === 0 ? (
            <p className="coin-empty-codex">{t('coinify.noTransactions')}</p>
          ) : (
            filteredRecurringTx.map((tx) => renderTxRow(tx))
          )}
        </div>
      )}

      {/* Pagination hint */}
      {filteredNormalTx.length > 0 && (
        <div className="coin-ledger-footer">
          <span className="qb-hand">
            {t('coinify.showingOf', {
              visible: Math.min(visibleCount, filteredNormalTx.length),
              total: filteredNormalTx.length,
              defaultValue: `Showing ${Math.min(visibleCount, filteredNormalTx.length)} of ${filteredNormalTx.length} entries`,
            })}
          </span>
        </div>
      )}

      {showImport && createPortal(
        <div className="coin-import-overlay" onClick={() => setShowImport(false)}>
          <div className="coin-import-modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span className="qb-small-caps" style={{ letterSpacing: '.14em', color: 'var(--rubric)' }}>{t('coinify.import')}</span>
              <button className="rpg-button" onClick={() => setShowImport(false)} style={{ padding: '2px 8px' }}><CrossMark style={{ width: '0.7em', height: '0.7em' }} /></button>
            </div>
            <Import />
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
