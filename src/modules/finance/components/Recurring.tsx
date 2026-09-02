import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { formatDate } from '../../../shared/format-date';
import { CategorySelect } from './shared/CategorySelect';
import { AccountSelect, NO_ACCOUNT, accountIdForSubmit } from './shared/AccountSelect';
import { useToast } from '../../../shared/components/useToast';
import { useConfirm } from '../../../shared/components/ConfirmDialog';
import RpgNumberInput from '../../../shared/components/RpgNumberInput';
import type { Currency, FinanceAccount, TransactionType } from '../types';
import { Rune } from '../../../shared/components/codex/CodexPrimitives';
import { PlayIcon, PauseIcon, Pencil, CrossMark, Checkmark, Scroll } from '../../../shared/components/icons';
import HelpBubble from '../../../shared/components/HelpBubble';
import { formatCurrency } from '../utils/format';
import { unwrap, failureMessage, getAccounts, hasAccountsSupport } from '../utils/api-ext';
import { todayDateString } from '../../../../shared/date-utils';

interface RecurringRow {
  id: string;
  name: string;
  type: 'expense' | 'income';
  amount: number;
  currency: 'ARS' | 'USD';
  category: string;
  billingDay: number;
  /** monthly | bimonthly | quarterly | four_monthly | semiannual | annual. */
  frequency?: string;
  /** Pocket every generated instance leaves / enters. `null` = none. */
  accountId?: string | null;
  /** `YYYY-MM` the cadence counts from (non-monthly). `null` = creation month. */
  anchorMonth?: string | null;
  active: boolean | number;
}

/** Every cadence the backend generates. Order = how often, descending. */
const FREQUENCIES = ['monthly', 'bimonthly', 'quarterly', 'four_monthly', 'semiannual', 'annual'] as const;

const FREQUENCY_FALLBACKS: Record<string, string> = {
  monthly: 'Mensual',
  bimonthly: 'Bimestral',
  quarterly: 'Trimestral',
  four_monthly: 'Cuatrimestral',
  semiannual: 'Semestral',
  annual: 'Anual',
};

interface AmountHistoryRow {
  id: string;
  previousAmount: number;
  newAmount: number;
  changedAt: string;
}

function daysUntilBilling(billingDay: number): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // Try this month first
  let next = new Date(today.getFullYear(), today.getMonth(), billingDay);
  // If billing day exceeds month length, clamp to last day of month
  if (next.getDate() !== billingDay) {
    next = new Date(today.getFullYear(), today.getMonth() + 1, 0); // last day of month
  }
  if (next < today) {
    // Already passed this month, try next month
    next = new Date(today.getFullYear(), today.getMonth() + 1, billingDay);
    if (next.getDate() !== billingDay) {
      next = new Date(today.getFullYear(), today.getMonth() + 2, 0);
    }
  }
  const diffMs = next.getTime() - today.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

export default function Recurring() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const confirm = useConfirm();
  // Local month: a template created 31/08 22:00 ART is an August template.
  const currentMonth = todayDateString().slice(0, 7);

  const [items, setItems] = useState<RecurringRow[]>([]);
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [showCoinDrop, setShowCoinDrop] = useState(false);

  // Form state
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<TransactionType>('expense');
  const [formAmount, setFormAmount] = useState('');
  const [formCurrency, setFormCurrency] = useState<Currency>('ARS');
  const [formCategory, setFormCategory] = useState('Otros');
  const [formBillingDay, setFormBillingDay] = useState(1);
  const [formFrequency, setFormFrequency] = useState<string>('monthly');
  // '' = unresolved: the AccountSelect picks the default (last used / Efectivo).
  const [formAccount, setFormAccount] = useState('');
  const [accountsSupported, setAccountsSupported] = useState(false);
  // Month the cadence counts from; only meaningful for non-monthly frequencies.
  const [formAnchorMonth, setFormAnchorMonth] = useState(currentMonth);
  const [formSubmitting, setFormSubmitting] = useState(false);

  // Inline edit state (amount)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingAmount, setEditingAmount] = useState('');

  // Inline edit state (fields)
  const [editingRecurringId, setEditingRecurringId] = useState<string | null>(null);
  const [editRecurringFields, setEditRecurringFields] = useState({
    name: '', type: '' as TransactionType, category: '', billingDay: 1, frequency: 'monthly',
    account: NO_ACCOUNT, anchorMonth: currentMonth,
  });

  // History state
  const [expandedHistory, setExpandedHistory] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, AmountHistoryRow[]>>({});

  const load = () => {
    window.api.financeGetRecurring().then((rows) => setItems(rows as RecurringRow[]));
  };

  /** Live accounts, to print the name next to each template. Empty while unwired. */
  const loadAccounts = useCallback(() => {
    if (!hasAccountsSupport()) { setAccounts([]); return; }
    getAccounts().then((rows) => setAccounts(rows ?? []));
  }, []);

  useEffect(() => { load(); loadAccounts(); }, [loadAccounts]);

  useEffect(() => {
    const handler = () => { load(); loadAccounts(); };
    window.addEventListener('account:switched', handler);
    window.addEventListener('finance:accountsChanged', handler);
    return () => {
      window.removeEventListener('account:switched', handler);
      window.removeEventListener('finance:accountsChanged', handler);
    };
  }, [loadAccounts]);

  const accountName = (id: string | null | undefined): string | null =>
    id ? (accounts.find((a) => a.id === id)?.name ?? null) : null;

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseFloat(formAmount);
    if (isNaN(parsed) || parsed <= 0) {
      toast({ type: 'warning', message: t('coinify.validationAmount', 'Ingresá un monto válido') });
      return;
    }
    setFormSubmitting(true);
    try {
      const result = await unwrap(window.api.financeAddRecurring({
        name: formName, type: formType, amount: parsed, currency: formCurrency, category: formCategory, billingDay: formBillingDay,
        frequency: formFrequency,
        // Every generated instance inherits the account, so the chest sees
        // the rent leave. Omitted while the accounts bridge is not wired.
        ...(accountsSupported ? { accountId: accountIdForSubmit(formAccount) } : {}),
        // Monthly templates bill every month; the anchor only steers the others.
        ...(formFrequency !== 'monthly' && /^\d{4}-\d{2}$/.test(formAnchorMonth) ? { anchorMonth: formAnchorMonth } : {}),
      }));
      if (!result.ok) {
        toast({ type: 'warning', message: failureMessage(result.reason, t) });
        return;
      }
      setFormName(''); setFormAmount(''); setFormType('expense');
      setFormCurrency('ARS'); setFormCategory('Otros'); setFormBillingDay(1); setFormFrequency('monthly');
      setFormAnchorMonth(currentMonth); setShowForm(false);
      load();
      window.dispatchEvent(new Event('finance:dataChanged'));
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleToggle = async (id: string) => {
    await window.api.financeToggleRecurring(id);
    load();
    window.dispatchEvent(new Event('finance:dataChanged'));
  };

  const startEdit = (item: RecurringRow) => {
    setEditingId(item.id);
    setEditingAmount(String(item.amount));
  };

  const saveEdit = async (id: string) => {
    const parsed = parseFloat(editingAmount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast({ type: 'warning', message: t('coinify.validationAmount', 'Ingresá un monto válido') });
      return;
    }
    const result = await unwrap(window.api.financeUpdateRecurringAmount(id, parsed));
    if (!result.ok) {
      toast({ type: 'warning', message: failureMessage(result.reason, t) });
      return;
    }
    load();
    window.dispatchEvent(new Event('finance:dataChanged'));
    setEditingId(null);
    setEditingAmount('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingAmount('');
  };

  const startRecurringEdit = (item: RecurringRow) => {
    setEditingRecurringId(item.id);
    setEditRecurringFields({
      name: item.name,
      type: item.type,
      category: item.category,
      billingDay: item.billingDay,
      frequency: item.frequency ?? 'monthly',
      account: item.accountId ?? NO_ACCOUNT,
      anchorMonth: item.anchorMonth ?? currentMonth,
    });
  };

  const saveRecurringEdit = async (id: string) => {
    if (!editRecurringFields.name.trim()) {
      toast({ type: 'warning', message: t('coinify.validationName', 'Ingresá un nombre') });
      return;
    }
    const result = await unwrap(window.api.financeUpdateRecurring(id, {
      name: editRecurringFields.name,
      type: editRecurringFields.type,
      category: editRecurringFields.category,
      billingDay: editRecurringFields.billingDay,
      frequency: editRecurringFields.frequency,
      ...(accountsSupported ? { accountId: accountIdForSubmit(editRecurringFields.account) } : {}),
      ...(editRecurringFields.frequency !== 'monthly' && /^\d{4}-\d{2}$/.test(editRecurringFields.anchorMonth)
        ? { anchorMonth: editRecurringFields.anchorMonth }
        : {}),
    }));
    if (!result.ok) {
      toast({ type: 'warning', message: failureMessage(result.reason, t) });
      return;
    }
    setEditingRecurringId(null);
    load();
    window.dispatchEvent(new Event('finance:dataChanged'));
  };

  const cancelRecurringEdit = () => {
    setEditingRecurringId(null);
  };

  const handleDelete = async (id: string) => {
    const ok = await confirm({ message: t('coinify.confirmDelete'), danger: true, confirmText: t('coinify.delete') });
    if (!ok) return;
    try {
      await window.api.financeDeleteRecurring(id);
      load();
      window.dispatchEvent(new Event('finance:dataChanged'));
    } catch (err) {
      console.error('[Recurring] financeDeleteRecurring failed:', err);
      toast({ type: 'warning', message: t('coinify.deleteError', 'Error al eliminar') });
    }
  };

  const toggleHistory = async (id: string) => {
    if (expandedHistory === id) {
      setExpandedHistory(null);
      return;
    }
    if (!history[id]) {
      const rows = await window.api.financeGetRecurringAmountHistory(id) as AmountHistoryRow[];
      setHistory((prev) => ({ ...prev, [id]: rows }));
    }
    setExpandedHistory(id);
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await window.api.financeGenerateRecurringForMonth(currentMonth);
      toast({ type: 'coin', message: t('coinify.recurringGenerated'), details: { transactionType: 'generated' } });
      window.dispatchEvent(new Event('finance:dataChanged'));
      setShowCoinDrop(true);
      setTimeout(() => setShowCoinDrop(false), 600);
    } catch (err) {
      console.error('[Recurring] financeGenerateRecurringForMonth failed:', err);
      toast({ type: 'warning', message: t('coinify.generateError', 'Error al generar') });
    } finally {
      setGenerating(false);
    }
  };

  const isActive = (item: RecurringRow) => item.active === true || item.active === 1;

  return (
    <div>
      {/* Una sola fila de acciones. Eran tres bloques marrones apilados, de
          anchos distintos, ocupando tres renglones: volver y generar quedan
          como secundarias (fantasma) y crear un recurrente como la principal. */}
      <div className="coin-recurring__actions">
        <button className="rpg-button coin-recurring__action coin-recurring__action--ghost"
          onClick={() => navigate('/finance/transactions')}>
          {'\u25C1'} {t('coinify.transactions')}
        </button>

        <span className="coin-recurring__actions-spacer" aria-hidden="true" />

        <div className="coin-recurring__drop-container">
          <button className="rpg-button coin-recurring__action coin-recurring__action--ghost"
            onClick={handleGenerate} disabled={generating}>
            {generating ? t('coinify.generating') : t('coinify.generateForMonth')}
          </button>
          {showCoinDrop && (
            <>
              <div className="coin-recurring__drop-coin" />
              <div className="coin-recurring__drop-coin" />
              <div className="coin-recurring__drop-coin" />
            </>
          )}
        </div>

        <button className="rpg-button coin-recurring__action coin-recurring__action--primary"
          onClick={() => setShowForm((v) => !v)}>
          {showForm ? t('coinify.cancel') : `+ ${t('coinify.addRecurring')}`}
        </button>
        <HelpBubble variant="inline" text={t('coinify.recurringHelp', 'Gastos e ingresos que se repiten cada mes. Se suman automáticamente al balance mensual.')} />
      </div>

      {/* Add Form */}
      {showForm && (
        <form onSubmit={handleAddSubmit} className="coin-codex-form">
          <div className="coin-codex-form__title">
            {t('coinify.addRecurring')}
          </div>

          <div className="coin-quick-add-form__row">
            <input type="text" value={formName} onChange={(e) => setFormName(e.target.value)}
              placeholder={t('coinify.name')} className="rpg-input" style={{ flex: 1 }} required />
            <button type="button" onClick={() => setFormType('expense')}
              className={`rpg-button ${formType === 'expense' ? 'rpg-btn-active' : ''}`}>
              {t('coinify.expense')}
            </button>
            <button type="button" onClick={() => setFormType('income')}
              className={`rpg-button ${formType === 'income' ? 'rpg-btn-active' : ''}`}>
              {t('coinify.income')}
            </button>
          </div>

          <div className="coin-quick-add-form__row">
            <RpgNumberInput value={formAmount} onChange={setFormAmount}
              placeholder={t('coinify.amount')} style={{ flex: 1 }} min={0} step={0.01} required />
            <select value={formCurrency} onChange={(e) => setFormCurrency(e.target.value as Currency)}
              className="rpg-select" style={{ width: 70 }}>
              <option value="ARS">ARS</option>
              <option value="USD">USD</option>
            </select>
            <CategorySelect value={formCategory} onChange={setFormCategory} />
          </div>

          <div className="coin-quick-add-form__row">
            {/* Tenía 70 px de ancho con 72 px de padding interno (las dos
                flechas): el número directamente no se veía. */}
            <label htmlFor="coin-recurring-add-day"
              style={{ fontSize: 'var(--fs-label)', opacity: 0.7, whiteSpace: 'nowrap' }}>{t('coinify.billingDay')}</label>
            <RpgNumberInput id="coin-recurring-add-day"
              aria-label={t('coinify.billingDayAria', 'Día de cobro, del 1 al 31')}
              value={String(formBillingDay)}
              onChange={(v) => setFormBillingDay(Math.min(31, Math.max(1, parseInt(v) || 1)))}
              style={{ width: 110 }} min={1} max={31} step={1} />
            <label style={{ fontSize: 'var(--fs-label)', opacity: 0.7, whiteSpace: 'nowrap' }}>{t('coinify.frequencyLabel', 'Frecuencia')}</label>
            {/* The aguinaldo at last: semiannual, annual and everything between.
                First charge lands the month the template is created. */}
            <select className="rpg-select" value={formFrequency} onChange={(e) => setFormFrequency(e.target.value)}
              aria-label={t('coinify.frequencyLabel', 'Frecuencia')} style={{ flex: 1 }}>
              {FREQUENCIES.map((f) => (
                <option key={f} value={f}>{t(`coinify.freq_${f}`, FREQUENCY_FALLBACKS[f])}</option>
              ))}
            </select>
          </div>

          {/* Which pocket the generated rows leave, and — for non-monthly
              cadences — the month the cadence counts from: an annual insurance
              due in March, loaded in September, must anchor on March. */}
          <div className="coin-quick-add-form__row">
            <label style={{ fontSize: 'var(--fs-label)', opacity: 0.7, whiteSpace: 'nowrap' }}>{t('coinify.accountLabel', 'Cuenta')}</label>
            <AccountSelect value={formAccount} onChange={setFormAccount} onSupported={setAccountsSupported} />
            {formFrequency !== 'monthly' && (
              <>
                <label style={{ fontSize: 'var(--fs-label)', opacity: 0.7, whiteSpace: 'nowrap' }}
                  htmlFor="coin-recurring-anchor"
                  title={t('coinify.anchorMonthHint', 'Mes desde el que cuenta la cadencia: la primera cuota cae en ese mes y después cada N meses.')}>
                  {t('coinify.anchorMonthLabel', 'Mes ancla')}
                </label>
                <input id="coin-recurring-anchor" type="month" className="rpg-input" value={formAnchorMonth}
                  onChange={(e) => setFormAnchorMonth(e.target.value)} style={{ fontSize: 'var(--fs-label)' }} />
              </>
            )}
          </div>

          <button type="submit" className="rpg-button" style={{ width: '100%' }} disabled={formSubmitting}>
            {formSubmitting ? t('coinify.saving') : t('coinify.save')}
          </button>
        </form>
      )}

      {/* List */}
      {items.length === 0 ? (
        <div className="coin-empty-codex">
          <p>{t('coinify.noRecurring', 'No hay recurrentes configurados')}</p>
          <p style={{ fontSize: 'var(--fs-label)', marginTop: 4 }}>{t('coinify.noRecurringHint', 'Agregá gastos fijos como alquiler, servicios o suscripciones')}</p>
        </div>
      ) : (
        <div className="coin-recurring-list">
          {items.map((item) => (
            <div
              key={item.id}
              className={`coin-recurring-card ${isActive(item) ? 'coin-recurring-card--active' : 'coin-recurring-card--paused'}`}
            >
              <div className="coin-recurring-card__main">
                {/* Active Toggle */}
                <button
                  className={`rpg-button coin-recurring-card__toggle ${isActive(item) ? 'coin-recurring-card__toggle--active' : 'coin-recurring-card__toggle--paused'}`}
                  onClick={() => handleToggle(item.id)}
                  aria-label={isActive(item) ? t('coinify.pause', 'Pausar') : t('coinify.resume', 'Reanudar')}
                  title={isActive(item) ? t('coinify.pause', 'Pausar') : t('coinify.resume', 'Reanudar')}
                >
                  {/* The icon is the ACTION, not the state: an active recurring
                      shows a pause glyph because that is what clicking does. */}
                  {isActive(item) ? <PauseIcon style={{ width: '0.7em', height: '0.7em' }} /> : <PlayIcon style={{ width: '0.7em', height: '0.7em' }} />}
                </button>

                {/* Name, Type, Category, Billing Day */}
                {editingRecurringId === item.id ? (
                  /* Cada control con su rótulo. Antes, entre la categoría y
                     «Mensual», había un número con flechitas y nada que dijera
                     que era el día de cobro; y los anchos iban de 55 a 120 px
                     sin criterio. */
                  <div className="coin-recurring-edit">
                    <label className="coin-field coin-field--grow">
                      <span className="coin-field__label">{t('coinify.name')}</span>
                      <input type="text" value={editRecurringFields.name}
                        onChange={(e) => setEditRecurringFields((f) => ({ ...f, name: e.target.value }))}
                        className="rpg-input" style={{ width: '100%', fontSize: 'var(--fs-label)' }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveRecurringEdit(item.id);
                          if (e.key === 'Escape') cancelRecurringEdit();
                        }}
                      />
                    </label>

                    <div className="coin-field">
                      <span className="coin-field__label">{t('coinify.typeLabel', 'Tipo')}</span>
                      <div className="coin-field__group">
                        <button type="button" onClick={() => setEditRecurringFields((f) => ({ ...f, type: 'expense' }))}
                          className={`rpg-button coin-action-btn ${editRecurringFields.type === 'expense' ? 'rpg-btn-active' : ''}`}>
                          {t('coinify.expense')}
                        </button>
                        <button type="button" onClick={() => setEditRecurringFields((f) => ({ ...f, type: 'income' }))}
                          className={`rpg-button coin-action-btn ${editRecurringFields.type === 'income' ? 'rpg-btn-active' : ''}`}>
                          {t('coinify.income')}
                        </button>
                      </div>
                    </div>

                    <div className="coin-field coin-field--cat">
                      <span className="coin-field__label">{t('coinify.categoryLabel', 'Categoría')}</span>
                      <CategorySelect value={editRecurringFields.category}
                        onChange={(v) => setEditRecurringFields((f) => ({ ...f, category: v }))} />
                    </div>

                    <div className="coin-field coin-field--day">
                      <label className="coin-field__label" htmlFor={`coin-recurring-day-${item.id}`}>
                        {t('coinify.billingDay')}
                      </label>
                      <RpgNumberInput id={`coin-recurring-day-${item.id}`}
                        aria-label={t('coinify.billingDayAria', 'Día de cobro, del 1 al 31')}
                        value={String(editRecurringFields.billingDay)}
                        onChange={(v) => setEditRecurringFields((f) => ({ ...f, billingDay: Math.min(31, Math.max(1, parseInt(v) || 1)) }))}
                        style={{ width: '100%' }} fontSize="0.8rem" min={1} max={31} step={1} />
                    </div>

                    <div className="coin-field coin-field--freq">
                      <label className="coin-field__label" htmlFor={`coin-recurring-freq-${item.id}`}>
                        {t('coinify.frequencyLabel', 'Frecuencia')}
                      </label>
                      <select id={`coin-recurring-freq-${item.id}`} className="rpg-select"
                        value={editRecurringFields.frequency}
                        onChange={(e) => setEditRecurringFields((f) => ({ ...f, frequency: e.target.value }))}
                        aria-label={t('coinify.frequencyLabel', 'Frecuencia')}
                        style={{ width: '100%', fontSize: 'var(--fs-label)' }}>
                        {FREQUENCIES.map((f) => (
                          <option key={f} value={f}>{t(`coinify.freq_${f}`, FREQUENCY_FALLBACKS[f])}</option>
                        ))}
                      </select>
                    </div>

                    {/* AccountSelect se autodetecta y devuelve null si el puente
                        de cuentas no está montado: el rótulo sigue su suerte. */}
                    <div className="coin-field coin-field--account">
                      {accountsSupported && (
                        <span className="coin-field__label">{t('coinify.accountLabel', 'Cuenta')}</span>
                      )}
                      <AccountSelect value={editRecurringFields.account}
                        onChange={(v) => setEditRecurringFields((f) => ({ ...f, account: v }))}
                        onSupported={setAccountsSupported} />
                    </div>

                    {editRecurringFields.frequency !== 'monthly' && (
                      <div className="coin-field coin-field--anchor">
                        <label className="coin-field__label" htmlFor={`coin-recurring-anchor-${item.id}`}
                          title={t('coinify.anchorMonthHint', 'Mes desde el que cuenta la cadencia: la primera cuota cae en ese mes y después cada N meses.')}>
                          {t('coinify.anchorMonthLabel', 'Mes ancla')}
                        </label>
                        <input id={`coin-recurring-anchor-${item.id}`} type="month" className="rpg-input"
                          value={editRecurringFields.anchorMonth}
                          aria-label={t('coinify.anchorMonthLabel', 'Mes ancla')}
                          title={t('coinify.anchorMonthHint', 'Mes desde el que cuenta la cadencia: la primera cuota cae en ese mes y después cada N meses.')}
                          onChange={(e) => setEditRecurringFields((f) => ({ ...f, anchorMonth: e.target.value }))}
                          style={{ width: '100%', fontSize: 'var(--fs-label)' }} />
                      </div>
                    )}

                    <div className="coin-recurring-edit__actions">
                      <button className="rpg-button coin-action-btn coin-action-btn--confirm"
                        aria-label={t('coinify.save', 'Guardar')} title={t('coinify.save', 'Guardar')}
                        onClick={() => saveRecurringEdit(item.id)}><Checkmark style={{ width: '0.8em', height: '0.8em' }} /></button>
                      <button className="rpg-button coin-action-btn coin-action-btn--cancel"
                        aria-label={t('coinify.cancel', 'Cancelar')} title={t('coinify.cancel', 'Cancelar')}
                        onClick={cancelRecurringEdit}><CrossMark style={{ width: '0.7em', height: '0.7em' }} /></button>
                    </div>
                  </div>
                ) : (
                  <>
                    <span className="coin-recurring-card__name qb-hand" title={item.name}>{item.name}</span>
                    <Rune tone={item.type === 'income' ? 'sage' : 'rubric'}>
                      {item.type === 'income' ? t('coinify.income') : t('coinify.expense')}
                    </Rune>
                    <span className="qb-small-caps" style={{ fontSize: 'var(--fs-label)', color: 'var(--ink-soft)' }}>{item.category}</span>
                    <span className="qb-small-caps" style={{ fontSize: 'var(--fs-label)', color: 'var(--ink-soft)' }}>
                      {t('coinify.billingDay')}: {item.billingDay}
                    </span>
                    {accountName(item.accountId) && (
                      <span className="qb-small-caps" style={{ fontSize: 'var(--fs-label)', color: 'var(--ink-soft)' }}
                        title={t('coinify.accountLabel', 'Cuenta')}>
                        {accountName(item.accountId)}
                      </span>
                    )}
                    {(item.frequency ?? 'monthly') !== 'monthly' && (
                      <Rune tone="gold">
                        {t(`coinify.freq_${item.frequency}`, FREQUENCY_FALLBACKS[item.frequency ?? 'monthly'] ?? item.frequency)}
                        {item.anchorMonth ? ` · ${item.anchorMonth}` : ''}
                      </Rune>
                    )}
                    {/* The day counter assumes a monthly cadence; for the other
                        frequencies the rune above already tells the story. */}
                    {isActive(item) && (item.frequency ?? 'monthly') === 'monthly' && (() => {
                      const days = daysUntilBilling(item.billingDay);
                      if (days === 0) return <Rune tone="gold">{t('coinify.recurringToday', 'hoy')}</Rune>;
                      return <Rune tone="ink">{t('coinify.recurringDaysLeft', 'en {{count}} días', { count: days })}</Rune>;
                    })()}
                  </>
                )}

                {/* Amount */}
                {editingId === item.id ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <RpgNumberInput value={editingAmount}
                      onChange={setEditingAmount}
                      style={{ width: 100 }} fontSize="0.85rem"
                      min={0} step={0.01} autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveEdit(item.id);
                        if (e.key === 'Escape') cancelEdit();
                      }}
                    />
                    <button className="rpg-button coin-action-btn coin-action-btn--confirm"
                      aria-label={t('coinify.save', 'Guardar')} title={t('coinify.save', 'Guardar')}
                      onClick={() => saveEdit(item.id)}><Checkmark style={{ width: '0.8em', height: '0.8em' }} /></button>
                    <button className="rpg-button coin-action-btn coin-action-btn--cancel"
                      aria-label={t('coinify.cancel', 'Cancelar')} title={t('coinify.cancel', 'Cancelar')}
                      onClick={cancelEdit}><CrossMark style={{ width: '0.7em', height: '0.7em' }} /></button>
                  </div>
                ) : (
                  /* Dotted underline + pencil on hover: a borderless transparent
                     button gave no hint that the amount was editable at all. */
                  <button className="coin-recurring-card__amount-btn coin-editable-amount" onClick={() => startEdit(item)}
                    title={t('coinify.editAmount')}>
                    {formatCurrency(item.amount, { currency: item.currency })}
                    <Pencil className="coin-editable-amount__pencil" style={{ width: '0.7em', height: '0.7em' }} />
                  </button>
                )}

                {/* Edit fields */}
                {editingRecurringId !== item.id && (
                  <button className="rpg-button coin-action-btn coin-action-btn--muted" onClick={() => startRecurringEdit(item)}
                    aria-label={t('coinify.edit', 'Editar')}
                    title={t('coinify.edit', 'Editar')}>
                    <Pencil style={{ width: '0.75em', height: '0.75em' }} />
                  </button>
                )}

                {/* History Toggle */}
                <button className="rpg-button coin-action-btn coin-action-btn--muted" onClick={() => toggleHistory(item.id)}
                  aria-label={t('coinify.amountHistory')}
                  aria-expanded={expandedHistory === item.id}
                  title={t('coinify.amountHistory')}>
                  <Scroll style={{ width: '0.85em', height: '0.85em' }} />
                </button>

                {/* Delete */}
                <button className="rpg-button coin-action-btn coin-action-btn--danger" onClick={() => handleDelete(item.id)}
                  aria-label={t('coinify.delete', 'Eliminar')}
                  title={t('coinify.delete', 'Eliminar')}><CrossMark style={{ width: '0.65em', height: '0.65em' }} /></button>
              </div>

              {/* Amount History Timeline */}
              {expandedHistory === item.id && (
                <div className="coin-recurring-card__timeline">
                  <p className="qb-small-caps" style={{ fontSize: 'var(--fs-label)', marginBottom: 6 }}>{t('coinify.amountHistory')}</p>
                  {(history[item.id] ?? []).length === 0 ? (
                    <p className="qb-hand" style={{ fontSize: 'var(--fs-label)', color: 'var(--ink-soft)', margin: 0 }}>{t('coinify.noHistory')}</p>
                  ) : (
                    <div>
                      {history[item.id].map((h) => (
                        <div key={h.id} className="coin-recurring-card__timeline-item">
                          <span style={{ color: 'var(--rubric)', textDecoration: 'line-through', opacity: 0.6 }}>
                            {formatCurrency(h.previousAmount, { currency: item.currency })}
                          </span>
                          <span style={{ opacity: 0.5 }}>{'\u2192'}</span>
                          <span style={{ color: 'var(--moss)' }}>
                            {formatCurrency(h.newAmount, { currency: item.currency })}
                          </span>
                          <span style={{ marginLeft: 'auto', opacity: 0.5 }}>
                            {formatDate(h.changedAt, i18n.language)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
