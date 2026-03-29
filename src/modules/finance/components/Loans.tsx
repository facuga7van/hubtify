import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { CATEGORIES } from '../types';
import type { LoanDirection, LoanType, Currency } from '../types';

interface LoanRow {
  id: string;
  personName: string;
  direction: LoanDirection;
  type: LoanType;
  amount: number;
  currency: Currency;
  date: string;
  description: string;
  settled: boolean | number;
  settledDate?: string;
  installmentGroupId?: string;
}

interface LoanPaymentRow {
  id: string;
  loanId: string;
  amount: number;
  date: string;
  note?: string;
}

// Group loans by person name
function groupByPerson(loans: LoanRow[]): Record<string, LoanRow[]> {
  return loans.reduce<Record<string, LoanRow[]>>((acc, loan) => {
    if (!acc[loan.personName]) acc[loan.personName] = [];
    acc[loan.personName].push(loan);
    return acc;
  }, {});
}

export default function Loans() {
  const { t } = useTranslation();
  const today = new Date().toISOString().split('T')[0];

  const [direction, setDirection] = useState<LoanDirection>('lent');
  const [activeLoans, setActiveLoans] = useState<LoanRow[]>([]);
  const [settledLoans, setSettledLoans] = useState<LoanRow[]>([]);
  const [showSettled, setShowSettled] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [payingLoanId, setPayingLoanId] = useState<string | null>(null);
  const [payments, setPayments] = useState<Record<string, LoanPaymentRow[]>>({});
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(today);

  // Form state
  const [formPerson, setFormPerson] = useState('');
  const [formDirection, setFormDirection] = useState<LoanDirection>('lent');
  const [formType, setFormType] = useState<LoanType>('single');
  const [formAmount, setFormAmount] = useState('');
  const [formCurrency, setFormCurrency] = useState<Currency>('ARS');
  const [formDescription, setFormDescription] = useState('');
  const [formInstallments, setFormInstallments] = useState(1);
  const [formCategory, setFormCategory] = useState('Otros');
  const [formDate, setFormDate] = useState(today);

  const loadLoans = useCallback(() => {
    window.api.financeGetLoans({ direction, settled: false }).then((rows) => {
      setActiveLoans(rows as LoanRow[]);
    });
    window.api.financeGetLoans({ direction, settled: true }).then((rows) => {
      setSettledLoans(rows as LoanRow[]);
    });
  }, [direction]);

  useEffect(() => {
    loadLoans();
  }, [loadLoans]);

  const handleAddLoan = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseFloat(formAmount);
    if (isNaN(parsed) || parsed <= 0 || !formPerson.trim()) return;

    if (formType === 'installments') {
      await window.api.financeCreateThirdPartyPurchase({
        description: formDescription || formCategory,
        installmentCount: formInstallments,
        installmentAmount: parsed,
        currency: formCurrency,
        category: formCategory,
        startDate: formDate,
        personName: formPerson.trim(),
        direction: formDirection,
      });
    } else {
      await window.api.financeAddLoan({
        personName: formPerson.trim(),
        direction: formDirection,
        type: 'single',
        amount: parsed,
        currency: formCurrency,
        date: formDate,
        description: formDescription,
      });
    }

    // Reset form
    setFormPerson('');
    setFormAmount('');
    setFormDescription('');
    setFormInstallments(1);
    setShowForm(false);
    loadLoans();
  };

  const handleSettle = async (id: string) => {
    if (!window.confirm(t('coinify.settleConfirm'))) return;
    await window.api.financeSettleLoan(id);
    loadLoans();
  };

  const openPayment = async (loanId: string) => {
    setPayingLoanId(loanId);
    setPaymentAmount('');
    setPaymentDate(today);
    if (!payments[loanId]) {
      const rows = await window.api.financeGetLoanPayments(loanId);
      setPayments((prev) => ({ ...prev, [loanId]: rows as LoanPaymentRow[] }));
    }
  };

  const handleAddPayment = async (loanId: string) => {
    const parsed = parseFloat(paymentAmount);
    if (isNaN(parsed) || parsed <= 0) return;
    await window.api.financeAddLoanPayment(loanId, { amount: parsed, date: paymentDate });
    // Refresh payments for this loan
    const rows = await window.api.financeGetLoanPayments(loanId);
    setPayments((prev) => ({ ...prev, [loanId]: rows as LoanPaymentRow[] }));
    setPayingLoanId(null);
    loadLoans();
  };

  const formatAmount = (amount: number, currency: Currency) => {
    const locale = currency === 'USD' ? 'en-US' : 'es-AR';
    return `$${amount.toLocaleString(locale)}${currency === 'USD' ? ' USD' : ''}`;
  };

  const isSettled = (loan: LoanRow) =>
    loan.settled === true || loan.settled === 1;

  const renderLoanGroups = (loans: LoanRow[]) => {
    const groups = groupByPerson(loans);
    if (Object.keys(groups).length === 0) {
      return (
        <p className="text-sm text-white/40 text-center py-8">{t('coinify.noLoans')}</p>
      );
    }

    return Object.entries(groups).map(([person, personLoans]) => {
      // For installment groups, calculate progress
      const installmentGroups: Record<string, LoanRow[]> = {};
      const singleLoans: LoanRow[] = [];

      for (const loan of personLoans) {
        if (loan.installmentGroupId) {
          if (!installmentGroups[loan.installmentGroupId]) {
            installmentGroups[loan.installmentGroupId] = [];
          }
          installmentGroups[loan.installmentGroupId].push(loan);
        } else {
          singleLoans.push(loan);
        }
      }

      return (
        <div key={person} className="rpg-card p-4 space-y-3">
          <h3 className="font-semibold text-[var(--rpg-gold)]">{person}</h3>

          {/* Single loans */}
          {singleLoans.map((loan) => (
            <div key={loan.id} className="flex items-center gap-3 py-2 border-t border-white/10">
              <span className="text-xs px-2 py-0.5 rounded bg-purple-500/20 text-purple-300">
                {t('coinify.singlePayment') || 'Pago único'}
              </span>
              <span className="flex-1 text-sm truncate text-white/80" title={loan.description}>
                {loan.description || loan.date}
              </span>
              <span className="text-xs text-white/40">{loan.date.slice(0, 10)}</span>
              <span className="font-mono text-sm text-[var(--rpg-gold)]">
                {formatAmount(loan.amount, loan.currency)}
              </span>
              {!isSettled(loan) && (
                <button
                  className="rpg-btn-sm text-xs"
                  onClick={() => handleSettle(loan.id)}
                >
                  {t('coinify.settle')}
                </button>
              )}
              {isSettled(loan) && (
                <span className="text-xs text-green-400">✓ {t('coinify.settled')}</span>
              )}
            </div>
          ))}

          {/* Installment groups */}
          {Object.entries(installmentGroups).map(([groupId, groupLoans]) => {
            const total = groupLoans.length;
            const paid = groupLoans.filter(isSettled).length;
            const firstLoan = groupLoans[0];
            const allSettled = paid === total;
            const totalAmount = groupLoans.reduce((sum, l) => sum + l.amount, 0);

            return (
              <div key={groupId} className="flex items-center gap-3 py-2 border-t border-white/10">
                <span className="text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-300">
                  {t('coinify.installmentsLabel') || 'Cuotas'}
                </span>
                <span className="flex-1 text-sm truncate text-white/80">
                  {firstLoan.description || firstLoan.date}
                </span>
                <span className="text-xs text-white/40">
                  {paid}/{total} cuotas
                </span>
                <span className="font-mono text-sm text-[var(--rpg-gold)]">
                  {formatAmount(totalAmount, firstLoan.currency)}
                </span>
                {!allSettled && (
                  <button
                    className="rpg-btn-sm text-xs"
                    onClick={() => openPayment(firstLoan.id)}
                  >
                    {t('coinify.markPayment') || 'Pagar cuota'}
                  </button>
                )}
                {allSettled && (
                  <span className="text-xs text-green-400">✓ {t('coinify.settled')}</span>
                )}
              </div>
            );
          })}
        </div>
      );
    });
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          <button
            className={`rpg-btn-sm ${direction === 'lent' ? 'rpg-btn-active' : ''}`}
            onClick={() => setDirection('lent')}
          >
            {t('coinify.lent') || 'Me deben'}
          </button>
          <button
            className={`rpg-btn-sm ${direction === 'borrowed' ? 'rpg-btn-active' : ''}`}
            onClick={() => setDirection('borrowed')}
          >
            {t('coinify.borrowed') || 'Debo'}
          </button>
        </div>
        <button className="rpg-btn-sm" onClick={() => setShowForm(!showForm)}>
          {showForm ? '▲' : `+ ${t('coinify.addLoan')}`}
        </button>
      </div>

      {/* Add Loan Form */}
      {showForm && (
        <form onSubmit={handleAddLoan} className="rpg-card p-4 space-y-3">
          <h3 className="text-sm font-semibold text-[var(--rpg-gold)]">{t('coinify.addLoan')}</h3>

          <div className="flex gap-2">
            <input
              type="text"
              value={formPerson}
              onChange={(e) => setFormPerson(e.target.value)}
              placeholder={t('coinify.personName')}
              className="rpg-input flex-1"
              required
            />
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setFormDirection('lent')}
              className={`rpg-btn-sm flex-1 ${formDirection === 'lent' ? 'rpg-btn-active' : ''}`}
            >
              {t('coinify.lent') || 'Me deben'}
            </button>
            <button
              type="button"
              onClick={() => setFormDirection('borrowed')}
              className={`rpg-btn-sm flex-1 ${formDirection === 'borrowed' ? 'rpg-btn-active' : ''}`}
            >
              {t('coinify.borrowed') || 'Debo'}
            </button>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setFormType('single')}
              className={`rpg-btn-sm flex-1 ${formType === 'single' ? 'rpg-btn-active' : ''}`}
            >
              {t('coinify.singlePayment') || 'Pago único'}
            </button>
            <button
              type="button"
              onClick={() => setFormType('installments')}
              className={`rpg-btn-sm flex-1 ${formType === 'installments' ? 'rpg-btn-active' : ''}`}
            >
              {t('coinify.installmentsLabel') || 'Cuotas'}
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

          {formType === 'installments' && (
            <>
              <div className="flex items-center gap-2">
                <label className="text-sm text-white/60">{t('coinify.installments') || 'Cuotas'}</label>
                <input
                  type="number"
                  value={formInstallments}
                  onChange={(e) => setFormInstallments(Math.max(1, parseInt(e.target.value) || 1))}
                  className="rpg-input w-20"
                  min="1"
                />
              </div>
              <select
                value={formCategory}
                onChange={(e) => setFormCategory(e.target.value)}
                className="rpg-select"
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </>
          )}

          <input
            type="text"
            value={formDescription}
            onChange={(e) => setFormDescription(e.target.value)}
            placeholder={t('coinify.description') || 'Descripción'}
            className="rpg-input"
          />

          <input
            type="date"
            value={formDate}
            onChange={(e) => setFormDate(e.target.value)}
            className="rpg-input"
          />

          <button type="submit" className="rpg-button w-full">
            {t('coinify.add') || 'Agregar'}
          </button>
        </form>
      )}

      {/* Payment Modal */}
      {payingLoanId && (
        <div className="rpg-card p-4 space-y-3 border border-[var(--rpg-gold)]/40">
          <h3 className="text-sm font-semibold text-[var(--rpg-gold)]">
            {t('coinify.markPayment') || 'Registrar pago'}
          </h3>
          <div className="flex gap-2">
            <input
              type="number"
              value={paymentAmount}
              onChange={(e) => setPaymentAmount(e.target.value)}
              placeholder={t('coinify.amount')}
              className="rpg-input flex-1"
              min="0"
              step="0.01"
            />
            <input
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              className="rpg-input"
            />
          </div>
          <div className="flex gap-2">
            <button
              className="rpg-button flex-1"
              onClick={() => handleAddPayment(payingLoanId)}
            >
              {t('coinify.saveTransaction') || 'Guardar'}
            </button>
            <button
              className="rpg-btn-sm"
              onClick={() => setPayingLoanId(null)}
            >
              {t('coinify.cancelEdit') || 'Cancelar'}
            </button>
          </div>
        </div>
      )}

      {/* Active Loans */}
      <div className="space-y-3">
        {renderLoanGroups(activeLoans)}
      </div>

      {/* Settled Section */}
      <div className="space-y-2">
        <button
          className="text-sm text-white/50 hover:text-white/80 transition-colors"
          onClick={() => setShowSettled(!showSettled)}
        >
          {showSettled ? t('coinify.hideSettled') : t('coinify.showSettled')}
          {settledLoans.length > 0 && ` (${settledLoans.length})`}
        </button>
        {showSettled && (
          <div className="space-y-3 opacity-60">
            {renderLoanGroups(settledLoans)}
          </div>
        )}
      </div>
    </div>
  );
}
