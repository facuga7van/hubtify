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
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--rpg-gold)]">
          {t('coinify.recurringLabel')}
        </h2>
        <button
          className="rpg-btn-sm"
          onClick={() => setShowForm((v) => !v)}
        >
          {showForm ? t('coinify.cancel') : `+ ${t('coinify.addRecurring')}`}
        </button>
      </div>

      {/* Add Form */}
      {showForm && (
        <form onSubmit={handleAddSubmit} className="rpg-card p-4 space-y-3">
          <h3 className="text-sm font-semibold text-white/70">{t('coinify.addRecurring')}</h3>

          <input
            type="text"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            placeholder={t('coinify.name')}
            className="rpg-input w-full"
            required
          />

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setFormType('expense')}
              className={`rpg-btn-sm flex-1 ${formType === 'expense' ? 'rpg-btn-active' : ''}`}
            >
              {t('coinify.expense')}
            </button>
            <button
              type="button"
              onClick={() => setFormType('income')}
              className={`rpg-btn-sm flex-1 ${formType === 'income' ? 'rpg-btn-active' : ''}`}
            >
              {t('coinify.income')}
            </button>
          </div>

          <div className="flex gap-2">
            <input
              type="number"
              value={formAmount}
              onChange={(e) => setFormAmount(e.target.value)}
              placeholder={t('coinify.amount')}
              className="rpg-input flex-1"
              min="0"
              step="0.01"
              required
            />
            <select
              value={formCurrency}
              onChange={(e) => setFormCurrency(e.target.value as Currency)}
              className="rpg-select w-20"
            >
              <option value="ARS">ARS</option>
              <option value="USD">USD</option>
            </select>
          </div>

          <CategorySelect value={formCategory} onChange={setFormCategory} />

          <button type="submit" className="rpg-btn w-full" disabled={formSubmitting}>
            {formSubmitting ? t('coinify.saving') : t('coinify.save')}
          </button>
        </form>
      )}

      {/* Generate Button */}
      <div className="flex items-center gap-3">
        <button
          className="rpg-btn"
          onClick={handleGenerate}
          disabled={generating}
        >
          {generating ? t('coinify.generating') : t('coinify.generateForMonth')}
        </button>
        {generateMsg && (
          <span className="text-sm text-[var(--rpg-gold)]">{generateMsg}</span>
        )}
      </div>

      {/* List */}
      {items.length === 0 ? (
        <div className="rpg-card p-6 text-center text-white/40 text-sm">
          {t('coinify.noRecurring')}
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.id} className="rpg-card p-3 space-y-2">
              {/* Main Row */}
              <div className="flex items-center gap-3 flex-wrap">
                {/* Active Toggle */}
                <button
                  onClick={() => handleToggle(item.id)}
                  title={isActive(item) ? t('coinify.pause') : t('coinify.activate')}
                  className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs transition-colors ${
                    isActive(item)
                      ? 'border-green-500 text-green-500 hover:bg-green-500/10'
                      : 'border-white/20 text-white/30 hover:bg-white/5'
                  }`}
                >
                  {isActive(item) ? '▶' : '⏸'}
                </button>

                {/* Name */}
                <span className="flex-1 font-medium text-sm min-w-0 truncate">
                  {item.name}
                </span>

                {/* Type Badge */}
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                    item.type === 'income'
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-red-500/20 text-red-400'
                  }`}
                >
                  {item.type === 'income' ? t('coinify.income') : t('coinify.expense')}
                </span>

                {/* Category */}
                <span className="text-xs text-white/50 hidden sm:inline">
                  {item.category}
                </span>

                {/* Amount — click to edit inline */}
                {editingId === item.id ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      value={editingAmount}
                      onChange={(e) => setEditingAmount(e.target.value)}
                      className="rpg-input w-28 text-sm"
                      min="0"
                      step="0.01"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveEdit(item.id);
                        if (e.key === 'Escape') cancelEdit();
                      }}
                    />
                    <button
                      onClick={() => saveEdit(item.id)}
                      className="rpg-btn-sm text-green-400"
                    >
                      ✓
                    </button>
                    <button onClick={cancelEdit} className="rpg-btn-sm text-white/40">
                      ✕
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => startEdit(item)}
                    className="font-mono text-sm hover:text-[var(--rpg-gold)] transition-colors"
                    title={t('coinify.editAmount')}
                  >
                    {formatAmount(item.amount, item.currency)}
                    <span className="ml-1 text-xs text-white/30">{item.currency}</span>
                  </button>
                )}

                {/* History Toggle */}
                <button
                  onClick={() => toggleHistory(item.id)}
                  className="rpg-btn-sm text-xs text-white/50 hover:text-white/80"
                  title={t('coinify.amountHistory')}
                >
                  ↺
                </button>

                {/* Delete */}
                {deletingId === item.id ? (
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-red-400">{t('coinify.confirmDelete')}</span>
                    <button
                      onClick={() => handleDelete(item.id)}
                      className="rpg-btn-sm text-red-400 text-xs"
                    >
                      {t('coinify.yes')}
                    </button>
                    <button
                      onClick={() => setDeletingId(null)}
                      className="rpg-btn-sm text-white/40 text-xs"
                    >
                      {t('coinify.no')}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setDeletingId(item.id)}
                    className="rpg-btn-sm text-red-400/60 hover:text-red-400 text-xs"
                    title={t('coinify.delete')}
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Amount History */}
              {expandedHistory === item.id && (
                <div className="mt-2 pt-2 border-t border-white/10">
                  <p className="text-xs text-white/50 mb-2">{t('coinify.amountHistory')}</p>
                  {(history[item.id] ?? []).length === 0 ? (
                    <p className="text-xs text-white/30">{t('coinify.noHistory')}</p>
                  ) : (
                    <div className="space-y-1">
                      {history[item.id].map((h) => (
                        <div key={h.id} className="flex items-center gap-2 text-xs text-white/60">
                          <span className="font-mono text-red-400/80">
                            {formatAmount(h.previousAmount, item.currency)}
                          </span>
                          <span className="text-white/30">→</span>
                          <span className="font-mono text-green-400/80">
                            {formatAmount(h.newAmount, item.currency)}
                          </span>
                          <span className="ml-auto text-white/30">
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
