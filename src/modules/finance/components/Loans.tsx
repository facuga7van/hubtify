import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../../shared/components/useToast';
import { useConfirm } from '../../../shared/components/ConfirmDialog';
import RpgNumberInput from '../../../shared/components/RpgNumberInput';
import type { LoanDirection, LoanType, Currency } from '../types';
import { loanPaidOff } from '../../../shared/animations/epic';
import { CategorySelect } from './shared/CategorySelect';

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

function groupByPerson(loans: LoanRow[]): Record<string, LoanRow[]> {
  return loans.reduce<Record<string, LoanRow[]>>((acc, loan) => {
    if (!acc[loan.personName]) acc[loan.personName] = [];
    acc[loan.personName].push(loan);
    return acc;
  }, {});
}

// Inline SVG icons
const ShieldIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

const SwordIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="m11 19-6-6" /><path d="m5 21-2-2" /><path d="m8 16-4 4" /><path d="M9.5 17.5 21 6V3h-3L6.5 14.5" />
  </svg>
);

const LargeShieldIcon = () => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

export default function Loans() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const confirm = useConfirm();
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
  const [settlingId, setSettlingId] = useState<string | null>(null);
  const loanRowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

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
    window.api.financeGetLoans({ direction, settled: false }).then((rows) => setActiveLoans(rows as LoanRow[]));
    window.api.financeGetLoans({ direction, settled: true }).then((rows) => setSettledLoans(rows as LoanRow[]));
  }, [direction]);

  useEffect(() => { loadLoans(); }, [loadLoans]);

  useEffect(() => {
    const handler = () => loadLoans();
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
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

    setFormPerson(''); setFormAmount(''); setFormDescription('');
    setFormInstallments(1); setShowForm(false);
    loadLoans();
    window.dispatchEvent(new Event('finance:dataChanged'));
  };

  const handleSettle = async (id: string) => {
    const ok = await confirm({ message: t('coinify.settleConfirm'), confirmText: t('coinify.settle') });
    if (!ok) return;
    setSettlingId(id);
    await window.api.financeSettleLoan(id);
    toast({ type: 'coin', message: t('coinify.loanSettled'), details: { transactionType: 'settled' } });

    // Fire epic animation on the row element if available
    const rowEl = loanRowRefs.current.get(id);
    const animDuration = rowEl ? 1200 : 0;
    if (rowEl) {
      loanPaidOff(rowEl);
    }

    setTimeout(() => {
      setSettlingId(null);
      loadLoans();
      window.dispatchEvent(new Event('finance:dataChanged'));
    }, animDuration + 100);
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
    const rows = await window.api.financeGetLoanPayments(loanId);
    setPayments((prev) => ({ ...prev, [loanId]: rows as LoanPaymentRow[] }));
    setPayingLoanId(null);
    loadLoans();
    window.dispatchEvent(new Event('finance:dataChanged'));
  };

  const formatAmount = (amount: number, currency: Currency) => {
    const locale = currency === 'USD' ? 'en-US' : 'es-AR';
    return `$${amount.toLocaleString(locale)}${currency === 'USD' ? ' USD' : ''}`;
  };

  const isSettled = (loan: LoanRow) => loan.settled === true || loan.settled === 1;

  const renderLoanGroups = (loans: LoanRow[]) => {
    const groups = groupByPerson(loans);
    if (Object.keys(groups).length === 0) {
      return (
        <div className="coin-loan-empty">
          <div className="coin-loan-empty__icon"><LargeShieldIcon /></div>
          <div className="coin-loan-empty__text">{t('coinify.noLoans')}</div>
        </div>
      );
    }

    return Object.entries(groups).map(([person, personLoans]) => {
      const installmentGroups: Record<string, LoanRow[]> = {};
      const singleLoans: LoanRow[] = [];

      for (const loan of personLoans) {
        if (loan.installmentGroupId) {
          if (!installmentGroups[loan.installmentGroupId]) installmentGroups[loan.installmentGroupId] = [];
          installmentGroups[loan.installmentGroupId].push(loan);
        } else {
          singleLoans.push(loan);
        }
      }

      return (
        <div
          key={person}
          className={`rpg-card coin-loan ${settlingId && personLoans.some((l) => l.id === settlingId) ? 'coin-loan--settling' : ''}`}
        >
          <div className="coin-loan__person-header">
            <div className="coin-loan__avatar">{person.charAt(0).toUpperCase()}</div>
            {person}
          </div>

          {/* Single loans */}
          {singleLoans.map((loan) => (
            <div
              key={loan.id}
              className="coin-loan__row"
              ref={(el) => {
                if (el) loanRowRefs.current.set(loan.id, el);
                else loanRowRefs.current.delete(loan.id);
              }}
            >
              <span className="coin-tx__badge coin-tx__badge--category">
                {t('coinify.singlePayment') || 'Pago unico'}
              </span>
              <span className="coin-tx__desc" title={loan.description}>
                {loan.description || loan.date}
              </span>
              <span style={{ fontSize: '0.75rem', opacity: 0.4 }}>{loan.date.slice(0, 10)}</span>
              <span style={{ fontFamily: 'Fira Code, monospace', fontSize: '0.85rem', color: 'var(--rpg-gold)' }}>
                {formatAmount(loan.amount, loan.currency)}
              </span>
              {!isSettled(loan) && (
                <button className="rpg-button" style={{ fontSize: '0.75rem', padding: '2px 8px' }}
                  onClick={() => handleSettle(loan.id)}>
                  {t('coinify.settle')}
                </button>
              )}
              {isSettled(loan) && (
                <span style={{ fontSize: '0.75rem', color: 'var(--rpg-xp-green)' }}>
                  {'\u2713'} {t('coinify.settled')}
                </span>
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
            const progressPct = total > 0 ? (paid / total) * 100 : 0;

            return (
              <div key={groupId} className="coin-loan__row">
                <span className="coin-tx__badge coin-tx__badge--category">
                  {t('coinify.installmentsLabel') || 'Cuotas'}
                </span>
                <span className="coin-tx__desc">{firstLoan.description || firstLoan.date}</span>
                <div className="coin-loan__bar">
                  <div
                    className={`coin-loan__bar-fill ${allSettled ? 'coin-loan__bar-fill--complete' : 'coin-loan__bar-fill--active'}`}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <span style={{ fontSize: '0.75rem', opacity: 0.5, fontFamily: 'Fira Code, monospace' }}>
                  {paid}/{total}
                </span>
                <span style={{ fontFamily: 'Fira Code, monospace', fontSize: '0.85rem', color: 'var(--rpg-gold)' }}>
                  {formatAmount(totalAmount, firstLoan.currency)}
                </span>
                {!allSettled && (
                  <button className="rpg-button" style={{ fontSize: '0.75rem', padding: '2px 8px' }}
                    onClick={() => openPayment(firstLoan.id)}>
                    {t('coinify.markPayment') || 'Pagar cuota'}
                  </button>
                )}
                {allSettled && (
                  <span style={{ fontSize: '0.75rem', color: 'var(--rpg-xp-green)' }}>
                    {'\u2713'} {t('coinify.settled')}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      );
    });
  };

  return (
    <div>
      {/* Header */}
      <div className="coin-loan-header">
        <div className="coin-loan-tabs">
          <button
            className={`rpg-button coin-loan-tab ${direction === 'lent' ? 'coin-loan-tab--active' : 'coin-loan-tab--inactive'}`}
            style={{ padding: '4px 12px', fontSize: '0.85rem' }}
            onClick={() => setDirection('lent')}
          >
            <ShieldIcon /> {t('coinify.lent') || 'Me deben'}
          </button>
          <button
            className={`rpg-button coin-loan-tab ${direction === 'borrowed' ? 'coin-loan-tab--active' : 'coin-loan-tab--inactive'}`}
            style={{ padding: '4px 12px', fontSize: '0.85rem' }}
            onClick={() => setDirection('borrowed')}
          >
            <SwordIcon /> {t('coinify.borrowed') || 'Debo'}
          </button>
        </div>
        <button className="rpg-button" style={{ padding: '4px 12px', fontSize: '0.85rem' }}
          onClick={() => setShowForm(!showForm)}>
          {showForm ? '\u25B2' : `+ ${t('coinify.addLoan')}`}
        </button>
      </div>

      {/* Add Loan Form */}
      {showForm && (
        <form onSubmit={handleAddLoan}>
          <div className="rpg-card coin-quick-add-form" style={{ marginBottom: 12, padding: '10px 12px' }}>
            <div className="coin-quick-add-form__title">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--rpg-gold-dark)" strokeWidth="1.3" strokeLinecap="round">
                <path d="M8 3v10M3 8h10" />
              </svg>
              {t('coinify.addLoan')}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', gap: 6 }}>
                <input type="text" value={formPerson} onChange={(e) => setFormPerson(e.target.value)}
                  placeholder={t('coinify.personName')} className="rpg-input" style={{ flex: 1 }} required />
                <button type="button" onClick={() => setFormDirection('lent')}
                  className={`rpg-button ${formDirection === 'lent' ? 'rpg-btn-active' : ''}`}>
                  {t('coinify.lent') || 'Me deben'}
                </button>
                <button type="button" onClick={() => setFormDirection('borrowed')}
                  className={`rpg-button ${formDirection === 'borrowed' ? 'rpg-btn-active' : ''}`}>
                  {t('coinify.borrowed') || 'Debo'}
                </button>
              </div>

              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" onClick={() => setFormType('single')}
                  className={`rpg-button ${formType === 'single' ? 'rpg-btn-active' : ''}`} style={{ flex: 1 }}>
                  {t('coinify.singlePayment') || 'Pago unico'}
                </button>
                <button type="button" onClick={() => setFormType('installments')}
                  className={`rpg-button ${formType === 'installments' ? 'rpg-btn-active' : ''}`} style={{ flex: 1 }}>
                  {t('coinify.installmentsLabel') || 'Cuotas'}
                </button>
              </div>

              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <RpgNumberInput value={formAmount} onChange={setFormAmount}
                  placeholder={t('coinify.amount')} style={{ flex: 1 }} min={0} step={0.01} required />
                <select value={formCurrency} onChange={(e) => setFormCurrency(e.target.value as Currency)}
                  className="rpg-select" style={{ width: 70 }}>
                  <option value="ARS">ARS</option>
                  <option value="USD">USD</option>
                </select>
                {formType === 'installments' && (
                  <>
                    <label style={{ fontSize: '0.8rem', opacity: 0.6, whiteSpace: 'nowrap' }}>{t('coinify.installments') || 'Cuotas'}</label>
                    <RpgNumberInput value={String(formInstallments)}
                      onChange={(v) => setFormInstallments(Math.max(1, parseInt(v) || 1))}
                      style={{ width: 60 }} min={1} />
                  </>
                )}
              </div>

              {formType === 'installments' && (
                <CategorySelect value={formCategory} onChange={setFormCategory} />
              )}

              <div style={{ display: 'flex', gap: 6 }}>
                <input type="text" value={formDescription} onChange={(e) => setFormDescription(e.target.value)}
                  placeholder={t('coinify.description') || 'Descripcion'} className="rpg-input" style={{ flex: 1 }} />
                <input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} className="rpg-input" />
              </div>

              <button type="submit" className="rpg-button" style={{ width: '100%' }}>
                {t('coinify.add') || 'Agregar'}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Payment Modal */}
      {payingLoanId && (
        <div className="rpg-card coin-quick-add-form" style={{ marginBottom: 12, padding: '10px 12px' }}>
          <div className="coin-quick-add-form__title">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--rpg-gold-dark)" strokeWidth="1.3" strokeLinecap="round">
              <circle cx="8" cy="8" r="5" /><path d="M8 5v3l2 2" />
            </svg>
            {t('coinify.markPayment') || 'Registrar pago'}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <RpgNumberInput value={paymentAmount} onChange={setPaymentAmount}
              placeholder={t('coinify.amount')} style={{ flex: 1 }} min={0} step={0.01} />
            <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className="rpg-input" />
            <button className="rpg-button" style={{ flex: 'none' }} onClick={() => handleAddPayment(payingLoanId)}>
              {t('coinify.saveTransaction') || 'Guardar'}
            </button>
            <button className="rpg-button" style={{ opacity: 0.6 }} onClick={() => setPayingLoanId(null)}>
              {t('coinify.cancelEdit') || 'Cancelar'}
            </button>
          </div>
        </div>
      )}

      {/* Active Loans */}
      <div style={{ marginBottom: 16 }}>
        {renderLoanGroups(activeLoans)}
      </div>

      {/* Settled Section */}
      <div>
        <button className="rpg-button" style={{ fontSize: '0.85rem', opacity: 0.5, padding: '4px 12px', marginBottom: 8 }}
          onClick={() => setShowSettled(!showSettled)}>
          {showSettled ? t('coinify.hideSettled') : t('coinify.showSettled')}
          {settledLoans.length > 0 && ` (${settledLoans.length})`}
        </button>
        {showSettled && (
          <div style={{ opacity: 0.6 }}>
            {renderLoanGroups(settledLoans)}
          </div>
        )}
      </div>
    </div>
  );
}
