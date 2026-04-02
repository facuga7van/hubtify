import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { CategorySelect } from './shared/CategorySelect';
import { useToast } from '../../../shared/components/useToast';
import type { Currency, TransactionType } from '../types';

interface RecurringRow {
  id: string;
  name: string;
  type: 'expense' | 'income';
  amount: number;
  currency: string;
  category: string;
  active: boolean | number;
}

interface AmountHistoryRow {
  id: string;
  previousAmount: number;
  newAmount: number;
  changedAt: string;
}

export default function Recurring() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const [items, setItems] = useState<RecurringRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [showCoinDrop, setShowCoinDrop] = useState(false);

  // Form state
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<TransactionType>('expense');
  const [formAmount, setFormAmount] = useState('');
  const [formCurrency, setFormCurrency] = useState<Currency>('ARS');
  const [formCategory, setFormCategory] = useState('Otros');
  const [formSubmitting, setFormSubmitting] = useState(false);

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingAmount, setEditingAmount] = useState('');

  // History state
  const [expandedHistory, setExpandedHistory] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, AmountHistoryRow[]>>({});

  // Delete confirmation
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = () => {
    window.api.financeGetRecurring().then((rows) => setItems(rows as RecurringRow[]));
  };

  useEffect(() => { load(); }, []);

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseFloat(formAmount);
    if (isNaN(parsed) || parsed <= 0) return;
    setFormSubmitting(true);
    try {
      await window.api.financeAddRecurring({
        name: formName, type: formType, amount: parsed, currency: formCurrency, category: formCategory,
      });
      setFormName(''); setFormAmount(''); setFormType('expense');
      setFormCurrency('ARS'); setFormCategory('Otros'); setShowForm(false);
      load();
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleToggle = async (id: string) => {
    await window.api.financeToggleRecurring(id);
    load();
  };

  const startEdit = (item: RecurringRow) => {
    setEditingId(item.id);
    setEditingAmount(String(item.amount));
  };

  const saveEdit = async (id: string) => {
    const parsed = parseFloat(editingAmount);
    if (!isNaN(parsed) && parsed > 0) {
      await window.api.financeUpdateRecurringAmount(id, parsed);
      load();
    }
    setEditingId(null);
    setEditingAmount('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingAmount('');
  };

  const handleDelete = async (id: string) => {
    await window.api.financeDeleteRecurring(id);
    setDeletingId(null);
    load();
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
      // Trigger coin drop animation
      setShowCoinDrop(true);
      setTimeout(() => setShowCoinDrop(false), 600);
    } catch {
      // error handled silently
    } finally {
      setGenerating(false);
    }
  };

  const isActive = (item: RecurringRow) => item.active === true || item.active === 1;

  const formatAmount = (amount: number, currency: string) => {
    const locale = currency === 'USD' ? 'en-US' : 'es-AR';
    const opts = currency === 'USD' ? { minimumFractionDigits: 2 } : {};
    return `${currency === 'USD' ? 'U$S' : '$'}${amount.toLocaleString(locale, opts)}`;
  };

  return (
    <div>
      {/* Header */}
      <div className="coin-dashboard__header" style={{ marginBottom: 16 }}>
        <h2 style={{ color: 'var(--rpg-wood)', fontSize: '1.1rem', fontFamily: 'Cinzel, serif', margin: 0 }}>
          {t('coinify.recurringLabel')}
        </h2>
        <button className="rpg-button" style={{ fontSize: '0.85rem', padding: '4px 12px' }}
          onClick={() => setShowForm((v) => !v)}>
          {showForm ? t('coinify.cancel') : `+ ${t('coinify.addRecurring')}`}
        </button>
      </div>

      {/* Add Form */}
      {showForm && (
        <form onSubmit={handleAddSubmit} className="rpg-card" style={{ padding: 16, marginBottom: 16 }}>
          <div className="rpg-card-title" style={{ fontSize: '0.85rem', marginBottom: 12 }}>
            {t('coinify.addRecurring')}
          </div>

          <input type="text" value={formName} onChange={(e) => setFormName(e.target.value)}
            placeholder={t('coinify.name')} className="rpg-input coin-quick-add-form__field" required />

          <div className="coin-quick-add-form__type-row">
            <button type="button" onClick={() => setFormType('expense')}
              className={`rpg-button ${formType === 'expense' ? 'rpg-btn-active' : ''}`} style={{ flex: 1 }}>
              {t('coinify.expense')}
            </button>
            <button type="button" onClick={() => setFormType('income')}
              className={`rpg-button ${formType === 'income' ? 'rpg-btn-active' : ''}`} style={{ flex: 1 }}>
              {t('coinify.income')}
            </button>
          </div>

          <div className="coin-quick-add-form__amount-row">
            <input type="number" value={formAmount} onChange={(e) => setFormAmount(e.target.value)}
              placeholder={t('coinify.amount')} className="rpg-input" style={{ flex: 1 }} min="0" step="0.01" required />
            <select value={formCurrency} onChange={(e) => setFormCurrency(e.target.value as Currency)}
              className="rpg-select" style={{ width: 80 }}>
              <option value="ARS">ARS</option>
              <option value="USD">USD</option>
            </select>
          </div>

          <div className="coin-quick-add-form__field">
            <CategorySelect value={formCategory} onChange={setFormCategory} />
          </div>

          <button type="submit" className="rpg-button" style={{ width: '100%' }} disabled={formSubmitting}>
            {formSubmitting ? t('coinify.saving') : t('coinify.save')}
          </button>
        </form>
      )}

      {/* Generate Button */}
      <div className="coin-recurring__generate-row">
        <div className="coin-recurring__drop-container">
          <button className="rpg-button" onClick={handleGenerate} disabled={generating}>
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
      </div>

      {/* List */}
      {items.length === 0 ? (
        <p className="coin-empty">{t('coinify.noRecurring')}</p>
      ) : (
        <div className="coin-recurring-list">
          {items.map((item) => (
            <div
              key={item.id}
              className={`rpg-card coin-recurring ${isActive(item) ? 'coin-recurring--active' : 'coin-recurring--paused'}`}
            >
              <div className="coin-recurring__main-row">
                {/* Active Toggle */}
                <button
                  className={`rpg-button coin-recurring__toggle ${isActive(item) ? 'coin-recurring__toggle--active' : 'coin-recurring__toggle--paused'}`}
                  onClick={() => handleToggle(item.id)}
                  title={isActive(item) ? t('coinify.pause') : t('coinify.activate')}
                >
                  {isActive(item) ? '\u25B6' : '\u23F8'}
                </button>

                {/* Name */}
                <span className="coin-recurring__name">{item.name}</span>

                {/* Type Badge */}
                <span className={`coin-recurring__type-badge ${item.type === 'income' ? 'coin-recurring__type-badge--income' : 'coin-recurring__type-badge--expense'}`}>
                  {item.type === 'income' ? t('coinify.income') : t('coinify.expense')}
                </span>

                {/* Category */}
                <span className="coin-recurring__category">{item.category}</span>

                {/* Amount -- click to edit inline */}
                {editingId === item.id ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input type="number" value={editingAmount}
                      onChange={(e) => setEditingAmount(e.target.value)}
                      className="rpg-input" style={{ width: 100, fontSize: '0.85rem' }}
                      min="0" step="0.01" autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveEdit(item.id);
                        if (e.key === 'Escape') cancelEdit();
                      }}
                    />
                    <button className="rpg-button" onClick={() => saveEdit(item.id)}
                      style={{ padding: '2px 8px', fontSize: '0.8rem', color: 'var(--rpg-xp-green)' }}>ok</button>
                    <button className="rpg-button" onClick={cancelEdit}
                      style={{ padding: '2px 8px', fontSize: '0.8rem', opacity: 0.4 }}>x</button>
                  </div>
                ) : (
                  <button className="coin-recurring__amount-btn" onClick={() => startEdit(item)}
                    title={t('coinify.editAmount')}>
                    {formatAmount(item.amount, item.currency)}
                    <span style={{ marginLeft: 4, fontSize: '0.7rem', opacity: 0.3 }}>{item.currency}</span>
                  </button>
                )}

                {/* History Toggle */}
                <button className="rpg-button" onClick={() => toggleHistory(item.id)}
                  style={{ padding: '2px 8px', fontSize: '0.75rem', opacity: 0.5 }}
                  title={t('coinify.amountHistory')}>
                  hist
                </button>

                {/* Delete */}
                {deletingId === item.id ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--rpg-hp-red)' }}>{t('coinify.confirmDelete')}</span>
                    <button className="rpg-button" onClick={() => handleDelete(item.id)}
                      style={{ padding: '2px 8px', fontSize: '0.75rem', color: 'var(--rpg-hp-red)' }}>
                      {t('coinify.yes')}
                    </button>
                    <button className="rpg-button" onClick={() => setDeletingId(null)}
                      style={{ padding: '2px 8px', fontSize: '0.75rem', opacity: 0.4 }}>
                      {t('coinify.no')}
                    </button>
                  </div>
                ) : (
                  <button className="rpg-button" onClick={() => setDeletingId(item.id)}
                    style={{ padding: '2px 8px', fontSize: '0.75rem', color: 'var(--rpg-hp-red)', opacity: 0.6 }}
                    title={t('coinify.delete')}>x</button>
                )}
              </div>

              {/* Amount History Timeline */}
              {expandedHistory === item.id && (
                <div className="coin-recurring__timeline">
                  <p className="coin-recurring__timeline-title">{t('coinify.amountHistory')}</p>
                  {(history[item.id] ?? []).length === 0 ? (
                    <p style={{ fontSize: '0.8rem', opacity: 0.3, margin: 0 }}>{t('coinify.noHistory')}</p>
                  ) : (
                    <div>
                      {history[item.id].map((h) => (
                        <div key={h.id} className="coin-recurring__timeline-item">
                          <span className="coin-recurring__amount-change coin-recurring__amount-change--old">
                            {formatAmount(h.previousAmount, item.currency)}
                          </span>
                          <span style={{ opacity: 0.3 }}>{'\u2192'}</span>
                          <span className="coin-recurring__amount-change coin-recurring__amount-change--new">
                            {formatAmount(h.newAmount, item.currency)}
                          </span>
                          <span style={{ marginLeft: 'auto', opacity: 0.3 }}>
                            {new Date(h.changedAt).toLocaleDateString()}
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
