import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { CategorySelect } from './shared/CategorySelect';
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
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const [items, setItems] = useState<RecurringRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateMsg, setGenerateMsg] = useState('');

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
    window.api.financeGetRecurring().then((rows: RecurringRow[]) => setItems(rows));
  };

  useEffect(() => {
    load();
  }, []);

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseFloat(formAmount);
    if (isNaN(parsed) || parsed <= 0) return;
    setFormSubmitting(true);
    try {
      await window.api.financeAddRecurring({
        name: formName,
        type: formType,
        amount: parsed,
        currency: formCurrency,
        category: formCategory,
      });
      setFormName('');
      setFormAmount('');
      setFormType('expense');
      setFormCurrency('ARS');
      setFormCategory('Otros');
      setShowForm(false);
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
      const rows: AmountHistoryRow[] = await window.api.financeGetRecurringAmountHistory(id);
      setHistory((prev) => ({ ...prev, [id]: rows }));
    }
    setExpandedHistory(id);
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setGenerateMsg('');
    try {
      await window.api.financeGenerateRecurringForMonth(currentMonth);
      setGenerateMsg(t('coinify.recurringGenerated'));
    } catch {
      setGenerateMsg(t('coinify.recurringGenerateError'));
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ color: 'var(--rpg-gold)', fontSize: '1.1rem', fontFamily: 'Cinzel, serif', margin: 0 }}>
          {t('coinify.recurringLabel')}
        </h2>
        <button
          className="rpg-button"
          style={{ fontSize: '0.85rem', padding: '4px 12px' }}
          onClick={() => setShowForm((v) => !v)}
        >
          {showForm ? t('coinify.cancel') : `+ ${t('coinify.addRecurring')}`}
        </button>
      </div>

      {/* Add Form */}
      {showForm && (
        <form onSubmit={handleAddSubmit} className="rpg-card" style={{ padding: 16, marginBottom: 16 }}>
          <div className="rpg-card-title" style={{ fontSize: '0.85rem', marginBottom: 12 }}>
            {t('coinify.addRecurring')}
          </div>

          <input
            type="text"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            placeholder={t('coinify.name')}
            className="rpg-input"
            style={{ width: '100%', marginBottom: 10, boxSizing: 'border-box' }}
            required
          />

          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <button
              type="button"
              onClick={() => setFormType('expense')}
              className="rpg-button"
              style={{
                flex: 1,
                fontSize: '0.85rem',
                padding: '4px 8px',
                background: formType === 'expense' ? 'var(--rpg-gold-dark)' : undefined,
                color: formType === 'expense' ? 'var(--rpg-ink)' : undefined,
              }}
            >
              {t('coinify.expense')}
            </button>
            <button
              type="button"
              onClick={() => setFormType('income')}
              className="rpg-button"
              style={{
                flex: 1,
                fontSize: '0.85rem',
                padding: '4px 8px',
                background: formType === 'income' ? 'var(--rpg-gold-dark)' : undefined,
                color: formType === 'income' ? 'var(--rpg-ink)' : undefined,
              }}
            >
              {t('coinify.income')}
            </button>
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <input
              type="number"
              value={formAmount}
              onChange={(e) => setFormAmount(e.target.value)}
              placeholder={t('coinify.amount')}
              className="rpg-input"
              style={{ flex: 1 }}
              min="0"
              step="0.01"
              required
            />
            <select
              value={formCurrency}
              onChange={(e) => setFormCurrency(e.target.value as Currency)}
              className="rpg-select"
              style={{ width: 80 }}
            >
              <option value="ARS">ARS</option>
              <option value="USD">USD</option>
            </select>
          </div>

          <div style={{ marginBottom: 12 }}>
            <CategorySelect value={formCategory} onChange={setFormCategory} />
          </div>

          <button
            type="submit"
            className="rpg-button"
            style={{ width: '100%' }}
            disabled={formSubmitting}
          >
            {formSubmitting ? t('coinify.saving') : t('coinify.save')}
          </button>
        </form>
      )}

      {/* Generate Button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button
          className="rpg-button"
          onClick={handleGenerate}
          disabled={generating}
        >
          {generating ? t('coinify.generating') : t('coinify.generateForMonth')}
        </button>
        {generateMsg && (
          <span style={{ fontSize: '0.85rem', color: 'var(--rpg-gold)' }}>{generateMsg}</span>
        )}
      </div>

      {/* List */}
      {items.length === 0 ? (
        <p style={{ opacity: 0.5, fontStyle: 'italic', textAlign: 'center', padding: 24 }}>
          {t('coinify.noRecurring')}
        </p>
      ) : (
        <div>
          {items.map((item) => (
            <div key={item.id} className="rpg-card" style={{ padding: 12, marginBottom: 8 }}>
              {/* Main Row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                {/* Active Toggle */}
                <button
                  className="rpg-button"
                  onClick={() => handleToggle(item.id)}
                  title={isActive(item) ? t('coinify.pause') : t('coinify.activate')}
                  style={{
                    width: 30,
                    height: 30,
                    padding: 0,
                    fontSize: '0.75rem',
                    opacity: isActive(item) ? 1 : 0.3,
                    color: isActive(item) ? 'var(--rpg-xp-green)' : undefined,
                  }}
                >
                  {isActive(item) ? '>' : '||'}
                </button>

                {/* Name */}
                <span style={{ flex: 1, fontSize: '0.9rem', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.name}
                </span>

                {/* Type Badge */}
                <span style={{
                  fontSize: '0.75rem',
                  padding: '1px 8px',
                  borderRadius: 3,
                  fontWeight: 600,
                  background: item.type === 'income' ? 'rgba(45,90,39,0.15)' : 'rgba(139,32,32,0.15)',
                  color: item.type === 'income' ? 'var(--rpg-xp-green)' : 'var(--rpg-hp-red)',
                }}>
                  {item.type === 'income' ? t('coinify.income') : t('coinify.expense')}
                </span>

                {/* Category */}
                <span style={{ fontSize: '0.75rem', opacity: 0.5 }}>
                  {item.category}
                </span>

                {/* Amount -- click to edit inline */}
                {editingId === item.id ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input
                      type="number"
                      value={editingAmount}
                      onChange={(e) => setEditingAmount(e.target.value)}
                      className="rpg-input"
                      style={{ width: 100, fontSize: '0.85rem' }}
                      min="0"
                      step="0.01"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveEdit(item.id);
                        if (e.key === 'Escape') cancelEdit();
                      }}
                    />
                    <button
                      className="rpg-button"
                      onClick={() => saveEdit(item.id)}
                      style={{ padding: '2px 8px', fontSize: '0.8rem', color: 'var(--rpg-xp-green)' }}
                    >
                      ok
                    </button>
                    <button
                      className="rpg-button"
                      onClick={cancelEdit}
                      style={{ padding: '2px 8px', fontSize: '0.8rem', opacity: 0.4 }}
                    >
                      x
                    </button>
                  </div>
                ) : (
                  <button
                    className="rpg-button"
                    onClick={() => startEdit(item)}
                    style={{ fontFamily: 'Fira Code, monospace', fontSize: '0.85rem', padding: '2px 8px', background: 'transparent', border: 'none' }}
                    title={t('coinify.editAmount')}
                  >
                    {formatAmount(item.amount, item.currency)}
                    <span style={{ marginLeft: 4, fontSize: '0.7rem', opacity: 0.3 }}>{item.currency}</span>
                  </button>
                )}

                {/* History Toggle */}
                <button
                  className="rpg-button"
                  onClick={() => toggleHistory(item.id)}
                  style={{ padding: '2px 8px', fontSize: '0.75rem', opacity: 0.5 }}
                  title={t('coinify.amountHistory')}
                >
                  hist
                </button>

                {/* Delete */}
                {deletingId === item.id ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--rpg-hp-red)' }}>{t('coinify.confirmDelete')}</span>
                    <button
                      className="rpg-button"
                      onClick={() => handleDelete(item.id)}
                      style={{ padding: '2px 8px', fontSize: '0.75rem', color: 'var(--rpg-hp-red)' }}
                    >
                      {t('coinify.yes')}
                    </button>
                    <button
                      className="rpg-button"
                      onClick={() => setDeletingId(null)}
                      style={{ padding: '2px 8px', fontSize: '0.75rem', opacity: 0.4 }}
                    >
                      {t('coinify.no')}
                    </button>
                  </div>
                ) : (
                  <button
                    className="rpg-button"
                    onClick={() => setDeletingId(item.id)}
                    style={{ padding: '2px 8px', fontSize: '0.75rem', color: 'var(--rpg-hp-red)', opacity: 0.6 }}
                    title={t('coinify.delete')}
                  >
                    x
                  </button>
                )}
              </div>

              {/* Amount History */}
              {expandedHistory === item.id && (
                <div style={{ paddingTop: 8, marginTop: 8, borderTop: '1px solid var(--rpg-parchment-dark)' }}>
                  <p style={{ fontSize: '0.8rem', opacity: 0.5, margin: 0, marginBottom: 6 }}>
                    {t('coinify.amountHistory')}
                  </p>
                  {(history[item.id] ?? []).length === 0 ? (
                    <p style={{ fontSize: '0.8rem', opacity: 0.3, margin: 0 }}>{t('coinify.noHistory')}</p>
                  ) : (
                    <div>
                      {history[item.id].map((h) => (
                        <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem', opacity: 0.7, marginBottom: 2 }}>
                          <span style={{ fontFamily: 'Fira Code, monospace', color: 'var(--rpg-hp-red)' }}>
                            {formatAmount(h.previousAmount, item.currency)}
                          </span>
                          <span style={{ opacity: 0.3 }}>-&gt;</span>
                          <span style={{ fontFamily: 'Fira Code, monospace', color: 'var(--rpg-xp-green)' }}>
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
