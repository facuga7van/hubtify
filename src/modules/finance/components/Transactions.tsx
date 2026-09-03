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
import { CARD_PAYMENT_CATEGORY, TRANSFER_CATEGORY } from '../types';
import { addTransaction } from '../../../shared/animations/feedback';
import RpgNumberInput from '../../../shared/components/RpgNumberInput';
import { useConfirm } from '../../../shared/components/ConfirmDialog';
import { useModalA11y } from '../../../shared/hooks/useModalA11y';
import { CategorySelect } from './shared/CategorySelect';
import { Rune } from '../../../shared/components/codex/CodexPrimitives';
import { ChevronUp, ChevronDown, ArrowRight, WarningTriangle, Pencil, CrossMark, Coin, Scroll, Compass } from '../../../shared/components/icons';
import { formatCurrency } from '../utils/format';
import { unwrap, failureMessage, getAccounts, hasAccountsSupport } from '../utils/api-ext';
import type { FinanceAccount } from '../types';
import { rememberCategoryForMerchant } from '../utils/category-mapping';
import { buildInstallmentGroupPayload, type AmountMode } from '../utils/installment-payload';
import { ensureRecurringGenerated, resetRecurringGuard, realCurrentMonth } from '../utils/ensure-recurring';
import { emitMovementLogged, emitMovementDeleted } from '../utils/rpg-events';
import { checkBudgetOverflow } from '../utils/budget-guards';
import { useValuationContext } from '../utils/display-mode';

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
  /** 0/1 flag straight out of SQLite — never a name. */
  forThirdParty?: number | string;
  /** Resolved from the loan that shares the instalment group. */
  thirdPartyName?: string | null;
  impactsBalance?: number;
  /** Venta rate frozen the day the movement was recorded. NULL = none available. */
  fxRate?: number | null;
  /** `day` | `process` | `backfill` — only `day` reads without the `~`. */
  fxRateSource?: string | null;
  /** Cuenta a la que impacta. NULL = sin cuenta asignada. */
  accountId?: string | null;
}

/** Filter value for "sin cuenta asignada" (distinct from '' = every account). */
const FILTER_NO_ACCOUNT = '__none__';

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

type SortField = 'date' | 'description' | 'category' | 'amount';
type SortDir = 'asc' | 'desc';

/**
 * Ledger section header. Defined at module scope on purpose — nested inside the
 * component it was a brand new component type on every render, so React
 * unmounted and remounted the header (losing focus and replaying transitions)
 * on every keystroke in the search box.
 */
function SectionHeader({
  title,
  count,
  collapsed,
  onToggle,
}: {
  title: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="coin-ledger-section-header" onClick={onToggle}>
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor"
        strokeWidth="1.5" strokeLinecap="round"
        style={{ transition: 'transform 0.2s', transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)' }}>
        <path d="M3 1l4 4-4 4" />
      </svg>
      <span className="coin-ledger-section-header__title">{title}</span>
      <span className="coin-ledger-section-header__count">{count}</span>
    </div>
  );
}

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
  // ARS → USD → ARS de hoy: the DollarChip cycles it, this converts each row.
  const valuation = useValuationContext();
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [filterCategory, setFilterCategory] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterPayment, setFilterPayment] = useState('');
  /** Account drill-down — seeded from `?account=<id>` (the chest's row click). */
  const [filterAccount, setFilterAccount] = useState(() => searchParams.get('account') ?? '');
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(50);
  const [importDirty, setImportDirty] = useState(false);

  // Debounced search: re-filtering + re-sorting the whole ledger on every
  // keystroke made typing visibly laggy on a full month.
  useEffect(() => {
    const id = setTimeout(() => setSearchQuery(searchInput), 200);
    return () => clearTimeout(id);
  }, [searchInput]);

  const hasAnyFilter = !!(filterCategory || filterType || filterPayment || filterAccount || searchQuery);

  const clearFilters = () => {
    setFilterCategory('');
    setFilterType('');
    setFilterPayment('');
    setFilterAccount('');
    setSearchInput('');
    setSearchQuery('');
  };

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

  /**
   * Filters survive month navigation — comparing one category across months was
   * impossible when every arrow press wiped what you had typed.
   */
  const handleMonthChange = (newMonth: string) => {
    setMonth(newMonth);
    setVisibleCount(50);
  };

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState({ amount: '', description: '', category: '', date: '', paymentMethod: '' });
  const [showForm, setShowForm] = useState(true);
  const [enteringId, setEnteringId] = useState<string | null>(null);
  const [exitingId, setExitingId] = useState<string | null>(null);
  const [enteringType, setEnteringType] = useState<TransactionType | null>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const quickAddRef = useRef<HTMLDivElement>(null);

  /**
   * El CTA del hueco: abre la carga rápida Y la trae a la vista. El vacío decía
   * «cargá un movimiento» y el control estaba fuera de pantalla, arriba.
   */
  const openQuickAdd = useCallback(() => {
    setShowForm(true);
    requestAnimationFrame(() => {
      quickAddRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      quickAddRef.current?.querySelector<HTMLInputElement>('input, select')?.focus();
    });
  }, []);

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
  }, [filterCategory, filterType, filterPayment, filterAccount, searchQuery]);

  /** Live accounts for the drill-down filter. Empty while the bridge is not wired. */
  const loadAccounts = useCallback(() => {
    if (!hasAccountsSupport()) { setAccounts([]); return; }
    getAccounts().then((rows) => setAccounts(rows ?? []));
  }, []);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  useEffect(() => {
    const handler = () => loadAccounts();
    window.addEventListener('account:switched', handler);
    window.addEventListener('finance:accountsChanged', handler);
    return () => {
      window.removeEventListener('account:switched', handler);
      window.removeEventListener('finance:accountsChanged', handler);
    };
  }, [loadAccounts]);

  // C7: Category averages for anomaly detection
  const [categoryAverages, setCategoryAverages] = useState<Record<string, number>>({});

  const loadCategoryAverages = useCallback(() => {
    window.api.financeGetCategoryAverages().then((data) => setCategoryAverages(data));
  }, []);

  const loadTransactions = useCallback(() => {
    window.api.financeGetTransactions({ month }).then((data) => setTransactions(data as TransactionRow[]));
  }, [month]);

  /**
   * One memo for the whole split + filter pass. These used to be bare
   * `.filter()` calls in the render body, so `filteredNormalTx` was a brand new
   * array every render and the sort memo below never hit its cache.
   * Recurring rows get the same filters as normal ones — filtering to "income"
   * used to leave expenses on show in the recurring section below.
   */
  const { filteredNormalTx, filteredRecurringTx } = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const matches = (tx: TransactionRow) => {
      if (filterCategory && tx.category !== filterCategory) return false;
      if (filterType && tx.type !== filterType) return false;
      if (filterPayment && tx.paymentMethod !== filterPayment) return false;
      if (filterAccount === FILTER_NO_ACCOUNT) {
        if (tx.accountId) return false;
      } else if (filterAccount && tx.accountId !== filterAccount) {
        return false;
      }
      if (q && !(tx.description?.toLowerCase().includes(q) || tx.category?.toLowerCase().includes(q))) return false;
      return true;
    };
    const normal: TransactionRow[] = [];
    const recurring: TransactionRow[] = [];
    for (const tx of transactions) {
      if (!matches(tx)) continue;
      (tx.source === 'recurring' ? recurring : normal).push(tx);
    }
    return { filteredNormalTx: normal, filteredRecurringTx: recurring };
  }, [transactions, filterCategory, filterType, filterPayment, filterAccount, searchQuery]);

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

    // Same definition as `finance:getCategoryAverages` (the wheel's): every
    // live expense, card purchases included, `Pago Tarjeta` and transfers out.
    // Comparing a "with card" month against a "cash only" average flagged
    // every card-paid category as anomalous, every month.
    const totals: Record<string, number> = {};
    for (const tx of transactions) {
      if (
        tx.type === 'expense' && tx.currency === 'ARS'
        && tx.category !== CARD_PAYMENT_CATEGORY && tx.category !== TRANSFER_CATEGORY
      ) {
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

  useEffect(() => {
    loadTransactions();
    loadCategoryAverages();
  }, [loadTransactions, loadCategoryAverages]);

  const loadCategories = useCallback(() => {
    window.api.financeGetCategories().then(setCategories).catch(() => setCategories([]));
  }, []);

  useEffect(() => { loadCategories(); }, [loadCategories]);

  /**
   * Recurring generation is no longer a per-mount database write. It runs once
   * per month and reloads afterwards, so the ledger never shows a total that is
   * missing rows it just created.
   */
  useEffect(() => {
    let cancelled = false;
    ensureRecurringGenerated(realCurrentMonth()).then((generated) => {
      if (generated && !cancelled) loadTransactions();
    });
    return () => { cancelled = true; };
  }, [loadTransactions]);

  useEffect(() => {
    const handler = () => {
      resetRecurringGuard();
      loadTransactions();
      loadCategoryAverages();
      // The other account has its own categories, and an account filter seeded
      // from `?account=` points at a wallet that no longer exists here.
      loadCategories();
      setFilterAccount('');
    };
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
  }, [loadTransactions, loadCategoryAverages, loadCategories]);

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
    amountMode: AmountMode;
    creditCardId?: string;
    accountId?: string | null;
  }) => {
    try {
      // These handlers now answer `{ ok: false, reason }` for bad input instead
      // of writing garbage, so the result has to be checked before celebrating.
      //
      // El payload del plan se arma en `buildInstallmentGroupPayload`: acá se
      // omitía `paymentMethod`, y sin él el handler evaluaba `isCreditCard` en
      // false aunque el usuario hubiera elegido tarjeta — el plan quedaba sin
      // tarjeta, descontaba del saldo y no llegaba a ningún resumen.
      const result = data.paymentMethod === 'credit_card' && data.installments > 1
        ? await unwrap(window.api.financeCreateInstallmentGroup(
          buildInstallmentGroupPayload(data) as unknown as Record<string, unknown>,
        ))
        : await unwrap(window.api.financeAddTransaction({
          type: data.type,
          amount: data.amount,
          currency: data.currency,
          category: data.category,
          description: data.description,
          date: data.date,
          paymentMethod: data.paymentMethod,
          creditCardId: data.creditCardId,
          // Absent while the accounts bridge is not wired — the backend then
          // applies its own cash→«Efectivo» default.
          ...(data.accountId !== undefined ? { accountId: data.accountId } : {}),
        }));

      if (!result.ok) {
        toast({ type: 'warning', message: failureMessage(result.reason, t) });
        return;
      }
      const newId = result.value;
      loadTransactions();
      window.dispatchEvent(new Event('finance:dataChanged'));
      setEnteringId(newId);
      setEnteringType(data.type);
      setTimeout(() => { setEnteringId(null); setEnteringType(null); }, 600);

      // A movement typed by hand pays XP — one event for the act, including an
      // instalment plan (six instalments are one purchase, not six). See
      // `utils/rpg-events.ts` for the full list of paths that deliberately stay
      // silent (import, recurring generation, statement payments, edits).
      // The row / group id rides along as ref_id so a delete can reverse it.
      const rpg = await emitMovementLogged(data.type, newId);

      // One toast, not two: the success message and the XP are the same event.
      const formatted = formatCurrency(data.amount, { currency: data.currency });
      const xpSuffix = rpg ? ` · +${rpg.xpGained} XP` : '';
      toast({
        type: 'coin',
        message: `${formatted} ${t('coinify.in')} ${data.category}${xpSuffix}`,
        details: { transactionType: data.type === 'income' ? 'income' : 'expense' },
      });

      // Informative, never punitive: no HP damage, and once per category-month.
      if (data.type === 'expense') {
        const blown = await checkBudgetOverflow(data.date.slice(0, 7), data.category);
        if (blown) {
          toast({
            type: 'warning',
            message: t('coinify.budgetOverflow', '{{category}}: te pasaste del límite del mes', { category: blown }),
          });
        }
      }
    } catch (err) {
      console.error('[Transactions] handleAdd failed:', err);
      toast({ type: 'warning', message: t('coinify.saveError', 'Error al guardar') });
    }
  };

  const handleDelete = async (id: string) => {
    const ok = await confirm({ message: t('coinify.deleteTransactionConfirm'), danger: true, confirmText: t('coinify.delete') });
    if (!ok) return;
    const target = transactions.find((tx) => tx.id === id);
    setExitingId(id);
    setTimeout(async () => {
      try {
        await window.api.financeDeleteTransaction(id);
        // Only a manual, non-bookkeeping row ever paid XP (see rpg-events.ts):
        // give it back, so "add, delete, repeat" stops being a faucet. An
        // instalment row is part of a plan whose XP rides on the group id and
        // is refunded when the plan is deleted, not per instalment.
        if (
          target && target.source === 'manual' && !target.installmentGroupId
          && target.category !== CARD_PAYMENT_CATEGORY && target.category !== TRANSFER_CATEGORY
        ) {
          await emitMovementDeleted(id, target.type);
        }
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

    /**
     * Re-categorising an imported row is the user correcting the importer. Teach
     * it, so the same merchant lands in the right place on the next statement
     * instead of being fixed by hand every month.
     */
    const original = transactions.find((tx) => tx.id === editingId);
    if (
      original &&
      original.source === 'import' &&
      editFields.category !== original.category &&
      editFields.description
    ) {
      void rememberCategoryForMerchant(editFields.description, editFields.category);
    }

    const result = await unwrap(window.api.financeUpdateTransaction(editingId, {
      amount,
      description: editFields.description,
      category: editFields.category,
      date: editFields.date,
      paymentMethod: editFields.paymentMethod,
    }));
    if (!result.ok) {
      toast({ type: 'warning', message: failureMessage(result.reason, t) });
      return;
    }
    setEditingId(null);
    loadTransactions();
    window.dispatchEvent(new Event('finance:dataChanged'));
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
              aria-label={t('coinify.save', 'Guardar')}
              title={t('coinify.save', 'Guardar')}
              onClick={saveEdit}>{t('coinify.saveTransaction')}</button>
            <button className="rpg-button" style={{ fontSize: 'var(--fs-label)', padding: '4px 8px' }}
              aria-label={t('coinify.cancel', 'Cancelar')}
              title={t('coinify.cancel', 'Cancelar')}
              onClick={() => setEditingId(null)}>{t('coinify.cancelEdit')}</button>
          </div>
        ) : (
          <>
            {/* Exactly six cells, matching the six columns declared for both the
                header and the row. The origin icon, the payment method and the
                card marker share one cell so the amount can never drift into a
                neighbouring column. */}
            <span className="coin-ledger-row__day qb-small-caps">{day}</span>
            <span className="coin-ledger-row__desc" title={tx.description || tx.category}>
              {tx.description || tx.category}
              {!!tx.forThirdParty && (
                <span className="coin-ledger-row__third-party">
                  {' '}<ArrowRight style={{ width: '0.75em', height: '0.75em' }} />{' '}
                  {tx.thirdPartyName || t('coinify.thirdPartyUnknown', 'tercero')}
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
            <span className="coin-ledger-row__meta">
              <span className="coin-ledger-row__source">
                <SourceIcon source={tx.source} />
              </span>
              {/* «Tarjeta de crédito» no entra en su columna y se recorta a
                  «Tarjeta d…»: el título lo devuelve entero al pasar el mouse. */}
              <span className="coin-ledger-row__payment" title={paymentMethodLabel(tx.paymentMethod)}>
                {paymentMethodLabel(tx.paymentMethod)}
              </span>
              {tx.impactsBalance === 0 && (
                <span
                  className="coin-ledger-row__card-flag"
                  title={t('coinify.cardPendingFlag', 'Compra con tarjeta: no descuenta del saldo hasta que pagues el resumen')}
                  aria-label={t('coinify.cardPendingFlag', 'Compra con tarjeta: no descuenta del saldo hasta que pagues el resumen')}
                >
                  <Coin style={{ width: '0.85em', height: '0.85em' }} />
                </span>
              )}
            </span>
            <span className={`coin-ledger-row__amount qb-numeral ${tx.type === 'income' ? 'coin-ledger-row__amount--income' : 'coin-ledger-row__amount--expense'}`}>
              {(() => {
                // Each historical ARS amount re-expressed with ITS OWN frozen
                // rate (or today's coefficient). A row without a frozen rate
                // uses the current rate and shows `~` (approximate).
                const conv = valuation.convert(tx);
                const converted = conv.currency !== tx.currency;
                return (
                  <>
                    {conv.approx && (
                      <span
                        className="coin-approx"
                        title={t('coinify.approxRateHint', 'Aproximado: convertido con la cotización actual, no la del día del movimiento')}
                      >~</span>
                    )}
                    {formatCurrency(
                      tx.type === 'income' ? conv.value : -conv.value,
                      {
                        currency: conv.currency,
                        showSign: tx.type === 'income',
                        decimals: converted && conv.currency === 'USD' ? 2 : 0,
                      },
                    )}
                  </>
                );
              })()}
            </span>
            <div className="coin-ledger-row__actions">
              <button className="rpg-button coin-ledger-row__action-btn tap-target"
                aria-label={t('coinify.editTransaction', 'Editar transacción')}
                title={t('coinify.editTransaction', 'Editar transacción')}
                onClick={() => startEdit(tx)}><Pencil style={{ width: '0.8em', height: '0.8em' }} /></button>
              <button className="rpg-button coin-ledger-row__action-btn tap-target"
                aria-label={t('coinify.deleteTransaction', 'Eliminar transacción')}
                title={t('coinify.deleteTransaction', 'Eliminar transacción')}
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
    return () => { document.body.style.overflow = ''; };
  }, [showImport]);

  /**
   * Closing the importer discards a preview that can take minutes to prepare,
   * so once there are parsed rows the backdrop and Escape ask first.
   */
  const requestCloseImport = useCallback(async () => {
    if (importDirty) {
      const ok = await confirm({
        message: t('coinify.importDiscardConfirm', '¿Descartar la importación? Se perderán las filas ya procesadas.'),
        danger: true,
        confirmText: t('coinify.importDiscard', 'Descartar'),
      });
      if (!ok) return;
    }
    setImportDirty(false);
    setShowImport(false);
  }, [importDirty, confirm, t]);

  const importModal = useModalA11y({ onClose: requestCloseImport, active: showImport });

  return (
    // El libro se lee como una columna, no como una banda: maximizada, el
    // concepto quedaba contra el borde izquierdo y la categoría, el importe y
    // las acciones contra el derecho, con casi mil píxeles de pergamino vacío
    // en el medio (`.coin-ledger-page` lo acota y lo centra).
    <div className="coin-page-column">
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
          {/* The label stays put and the chevron rotates — the button used to
              collapse to a bare 0.65em glyph with no text at all. */}
          <button className="rpg-button coin-month-nav__btn coin-toggle-btn"
            aria-expanded={showForm}
            onClick={() => setShowForm(!showForm)}>
            <ChevronUp
              className={`coin-toggle-btn__chevron ${showForm ? '' : 'coin-toggle-btn__chevron--collapsed'}`}
              style={{ width: '0.65em', height: '0.65em' }}
            />
            {t('coinify.quickAdd')}
          </button>
        </div>
      </div>

      {/* Quick Add Form */}
      <div ref={quickAddRef} className={`coin-quick-add-form ${showForm ? 'coin-quick-add-form--open' : 'coin-quick-add-form--closed'}`}>
        {showForm && <QuickAddForm onSubmit={handleAdd} defaultType={defaultType} />}
      </div>

      {/* Search */}
      <div style={{ marginBottom: 8 }}>
        <input
          className="rpg-input"
          type="search"
          placeholder={t('coinify.searchTransactions')}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          style={{ width: '100%' }}
        />
      </div>

      {/* Ledger header — one cell per column the row actually emits, so the
          sort arrow always sits over the data it sorts. */}
      <div className="coin-ledger-header">
        <button className="coin-sort-header" onClick={() => toggleSort('date')}>
          {t('coinify.colDate', 'DÍA')} {sortIndicator('date')}
        </button>
        <button className="coin-sort-header" onClick={() => toggleSort('description')}>
          {t('coinify.colDescription', 'CONCEPTO')} {sortIndicator('description')}
        </button>
        <button className="coin-sort-header" onClick={() => toggleSort('category')}>
          {t('coinify.colCategory', 'CATEGORÍA')} {sortIndicator('category')}
        </button>
        {/* La cuarta columna llevaba el medio de pago SIN rótulo: la auditoría
            de diseño marcó que «CATEGORÍA» parecía titular dos columnas. */}
        <span className="coin-ledger-header__label">{t('coinify.colMethod', 'MEDIO')}</span>
        <button className="coin-sort-header coin-sort-header--amount" onClick={() => toggleSort('amount')}>
          {t('coinify.colAmount', 'MONTO')} {sortIndicator('amount')}
        </button>
        <span className="coin-ledger-header__spacer" aria-hidden="true" />
      </div>

      {/* Transactions Section */}
      <SectionHeader
        title={t('coinify.transactions')}
        count={filteredNormalTx.length}
        collapsed={collapsedSections.has('transactions')}
        onToggle={() => toggleSection('transactions')}
      />
      {!collapsedSections.has('transactions') && (
        <>
          {/* Filters */}
          <div className="coin-filters">
            <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="rpg-select"
              aria-label={`${t('coinify.expense')} / ${t('coinify.income')}`}>
              <option value="">{t('coinify.expense')} / {t('coinify.income')}</option>
              <option value="expense">{t('coinify.expense')}</option>
              <option value="income">{t('coinify.income')}</option>
            </select>
            <select value={filterPayment} onChange={(e) => setFilterPayment(e.target.value)} className="rpg-select"
              aria-label={t('coinify.paymentMethod')}>
              <option value="">{t('coinify.paymentMethod')}</option>
              <option value="cash">{t('coinify.cash')}</option>
              <option value="debit">{t('coinify.debit')}</option>
              <option value="transfer">{t('coinify.transfer')}</option>
              <option value="credit_card">{t('coinify.creditCard')}</option>
            </select>
            {/* The category filter used to exist in state and in the empty-state
                copy, but had no control to set it. */}
            <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="rpg-select"
              aria-label={t('coinify.colCategory', 'Categoría')}>
              <option value="">{t('coinify.allCategories', 'Todas las categorías')}</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
            {/* Account drill-down: only once the accounts bridge is wired and
                there is something to drill into. */}
            {accounts.length > 0 && (
              <select value={filterAccount} onChange={(e) => setFilterAccount(e.target.value)} className="rpg-select"
                aria-label={t('coinify.accountLabel', 'Cuenta')}>
                <option value="">{t('coinify.allAccounts', 'Todas las cuentas')}</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
                <option value={FILTER_NO_ACCOUNT}>{t('coinify.accountNone', 'Sin cuenta')}</option>
              </select>
            )}
            {hasAnyFilter && (
              <button className="rpg-button" style={{ fontSize: 'var(--fs-label)' }} onClick={clearFilters}>
                {t('coinify.clearFilters', 'Limpiar filtros')}
              </button>
            )}
          </div>

          <div className="coin-ledger">
            {sortedTx.length === 0 ? (
              <div className="coin-empty-codex">
                {/* "Nothing matched your filters" and "this month is empty" are
                    different problems and need different answers. Los dos huecos
                    llevan ícono, frase y el control ADENTRO: el vacío del mes era
                    una sola línea en itálica y el botón de cargar estaba arriba,
                    fuera del alcance del ojo que acaba de leer «sin movimientos». */}
                {hasAnyFilter ? (
                  <>
                    <Compass width={28} height={28} aria-hidden="true" />
                    <p className="coin-empty-codex__title">{t('coinify.noMatchingTransactions', 'Ningún movimiento coincide con los filtros')}</p>
                    <button className="rpg-button" style={{ fontSize: 'var(--fs-label)' }} onClick={clearFilters}>
                      {t('coinify.clearFilters', 'Limpiar filtros')}
                    </button>
                  </>
                ) : (
                  <>
                    <Coin width={28} height={28} aria-hidden="true" />
                    <p className="coin-empty-codex__title">{t('coinify.noTransactions', 'Sin transacciones este mes')}</p>
                    <p className="coin-empty-codex__desc">
                      {t('coinify.noTransactionsHint', 'Cargá el primer movimiento del mes y el libro empieza a escribirse.')}
                    </p>
                    <button className="rpg-button" style={{ fontSize: 'var(--fs-label)' }} onClick={openQuickAdd}>
                      + {t('coinify.quickAdd', 'Carga rápida')}
                    </button>
                  </>
                )}
              </div>
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
      <SectionHeader
        title={t('coinify.recurringLabel')}
        count={filteredRecurringTx.length}
        collapsed={collapsedSections.has('recurring')}
        onToggle={() => toggleSection('recurring')}
      />
      {!collapsedSections.has('recurring') && (
        <div className="coin-ledger">
          {filteredRecurringTx.length === 0 ? (
            /* El hueco de la sección Recurrentes decía «sin transacciones» y
               nada más: ahora nombra dónde se configuran y lleva hasta ahí. */
            <div className="coin-empty-codex">
              <Scroll width={28} height={28} aria-hidden="true" />
              <p className="coin-empty-codex__title">{t('coinify.noTransactions', 'Sin transacciones este mes')}</p>
              <p className="coin-empty-codex__desc">
                {t('coinify.noRecurringLedgerHint', 'El alquiler, los servicios y las suscripciones se cargan una vez y se generan solos.')}
              </p>
              <button className="rpg-button" style={{ fontSize: 'var(--fs-label)' }} onClick={() => navigate('/finance/recurring')}>
                {t('coinify.manageRecurring', 'Ver recurrentes')}
              </button>
            </div>
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
              defaultValue: `Mostrando ${Math.min(visibleCount, filteredNormalTx.length)} de ${filteredNormalTx.length} movimientos`,
            })}
          </span>
        </div>
      )}

      {showImport && createPortal(
        <div className="coin-import-overlay" onClick={requestCloseImport}>
          <div
            {...importModal.dialogProps}
            className="coin-import-modal"
            aria-label={t('coinify.importTitle', 'Importar Resumen Bancario')}
            onClick={importModal.stopPropagation}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span className="qb-small-caps" style={{ letterSpacing: '.14em', color: 'var(--rubric)' }}>{t('coinify.importTitle', 'Importar Resumen Bancario')}</span>
              <button className="rpg-button tap-target"
                aria-label={t('coinify.close', 'Cerrar')}
                title={t('coinify.close', 'Cerrar')}
                onClick={requestCloseImport} style={{ padding: '2px 8px' }}><CrossMark style={{ width: '0.7em', height: '0.7em' }} /></button>
            </div>
            {/* `embedded` suppresses Import's own <h2>: the modal already has a
                heading, and the two used to stack. */}
            <Import
              embedded
              onDirtyChange={setImportDirty}
              onDiscard={() => { setImportDirty(false); setShowImport(false); }}
              onImported={() => { setImportDirty(false); loadTransactions(); }}
            />
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
