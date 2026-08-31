import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import HelpBubble from '../../../shared/components/HelpBubble';
import { useToast } from '../../../shared/components/useToast';
import { useConfirm } from '../../../shared/components/ConfirmDialog';
import RpgNumberInput from '../../../shared/components/RpgNumberInput';
import type { LoanDirection, LoanType, Currency } from '../types';
import { loanPaidOff } from '../../../shared/animations/epic';
import { CategorySelect } from './shared/CategorySelect';
import { Gauge, Rune } from '../../../shared/components/codex/CodexPrimitives';
import { Checkmark, ChevronUp } from '../../../shared/components/icons';
import { formatCurrency } from '../utils/format';
import { unwrap, failureMessage } from '../utils/api-ext';
import { todayDateString } from '../../../../shared/date-utils';

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

export default function Loans() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const confirm = useConfirm();
  // Local date, not UTC: `toISOString()` rolled anything logged after 21:00 in
  // Argentina into the next day.
  const today = todayDateString();

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
  const [submitting, setSubmitting] = useState(false);

  const loadLoans = useCallback(async () => {
    const [active, settled] = await Promise.all([
      window.api.financeGetLoans({ direction, settled: false }) as Promise<LoanRow[]>,
      window.api.financeGetLoans({ direction, settled: true }) as Promise<LoanRow[]>,
    ]);
    setActiveLoans(active);
    setSettledLoans(settled);

    // Partial payments were fetched but never rendered — you could not tell a
    // loan half repaid from one untouched. Load them up front for active loans
    // so every row can show what is actually left.
    const singles = active.filter((l) => !l.installmentGroupId);
    const entries = await Promise.all(
      singles.map(async (loan) => {
        try {
          const rows = await window.api.financeGetLoanPayments(loan.id);
          return [loan.id, rows as LoanPaymentRow[]] as const;
        } catch {
          return [loan.id, [] as LoanPaymentRow[]] as const;
        }
      }),
    );
    setPayments((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
  }, [direction]);

  useEffect(() => { loadLoans(); }, [loadLoans]);

  useEffect(() => {
    const handler = () => loadLoans();
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
  }, [loadLoans]);

  const handleAddLoan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const parsed = parseFloat(formAmount);
    if (!formPerson.trim()) {
      toast({ message: t('coinify.validationPerson', 'Ingresá el nombre de la persona'), type: 'warning' });
      return;
    }
    if (parsed <= 0 || isNaN(parsed)) {
      toast({ message: t('coinify.validationAmount', 'Ingresá un monto válido'), type: 'warning' });
      return;
    }
    if (parsed > 999_999_999) {
      toast({ message: t('coinify.validationAmountTooLarge', 'El monto es demasiado grande'), type: 'warning' });
      return;
    }

    setSubmitting(true);
    try {
      // Both handlers now reject bad input with `{ ok: false, reason }` rather
      // than throwing, so a silent no-op would otherwise look like a save.
      const result = formType === 'installments'
        ? await unwrap(window.api.financeCreateThirdPartyPurchase({
          description: formDescription || formCategory,
          installmentCount: formInstallments,
          installmentAmount: parsed,
          currency: formCurrency,
          category: formCategory,
          startDate: formDate,
          personName: formPerson.trim(),
          direction: formDirection,
        }))
        : await unwrap(window.api.financeAddLoan({
          personName: formPerson.trim(),
          direction: formDirection,
          type: 'single',
          amount: parsed,
          currency: formCurrency,
          date: formDate,
          description: formDescription,
        }));

      if (!result.ok) {
        toast({ message: failureMessage(result.reason, t), type: 'warning' });
        return;
      }

      setFormPerson(''); setFormAmount(''); setFormDescription('');
      setFormInstallments(1); setShowForm(false);
      loadLoans();
      window.dispatchEvent(new Event('finance:dataChanged'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSettle = async (id: string) => {
    const ok = await confirm({ message: t('coinify.settleConfirm'), confirmText: t('coinify.settle') });
    if (!ok) return;
    setSettlingId(id);
    try {
      await window.api.financeSettleLoan(id);
      toast({ type: 'coin', message: t('coinify.loanSettled'), details: { transactionType: 'settled' } });

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
    } catch (err) {
      console.error('[Loans] handleSettle failed:', err);
      setSettlingId(null);
      toast({ type: 'warning', message: t('coinify.saveError', 'Error al guardar') });
    }
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
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast({ type: 'warning', message: t('coinify.validationAmount', 'Ingresá un monto válido') });
      return;
    }
    const result = await unwrap(window.api.financeAddLoanPayment(loanId, { amount: parsed, date: paymentDate }));
    if (!result.ok) {
      toast({ type: 'warning', message: failureMessage(result.reason, t) });
      return;
    }
    const rows = await window.api.financeGetLoanPayments(loanId);
    setPayments((prev) => ({ ...prev, [loanId]: rows as LoanPaymentRow[] }));
    setPayingLoanId(null);
    loadLoans();
    window.dispatchEvent(new Event('finance:dataChanged'));
  };

  const isSettled = (loan: LoanRow) => loan.settled === true || loan.settled === 1;

  const renderLoanGroups = (loans: LoanRow[]) => {
    const groups = groupByPerson(loans);
    if (Object.keys(groups).length === 0) {
      return (
        <div className="coin-empty-codex">
          <p>{t('coinify.noLoans', 'Sin préstamos activos')}</p>
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
          className={`coin-loan-card ${settlingId && personLoans.some((l) => l.id === settlingId) ? 'coin-loan-card--settling' : ''}`}
        >
          <div className="coin-loan-card__person">
            <div className="coin-loan-card__avatar">{person.charAt(0).toUpperCase()}</div>
            <span className="qb-hand">{person}</span>
          </div>

          {/* Single loans. Fixed grid columns so amounts line up between rows
              of different kinds inside one person's card. */}
          {singleLoans.map((loan) => {
            const paidSoFar = (payments[loan.id] ?? []).reduce((sum, p) => sum + p.amount, 0);
            const remaining = Math.max(loan.amount - paidSoFar, 0);
            return (
              <div
                key={loan.id}
                className="coin-loan-card__row"
                ref={(el) => {
                  if (el) loanRowRefs.current.set(loan.id, el);
                  else loanRowRefs.current.delete(loan.id);
                }}
              >
                <Rune>{t('coinify.singlePayment')}</Rune>
                <span className="qb-hand coin-loan-card__desc" title={loan.description || loan.date}>
                  {loan.description || loan.date}
                  <span className="coin-loan-card__date">{loan.date.slice(0, 10)}</span>
                </span>
                <span className="coin-loan-card__progress">
                  {paidSoFar > 0 && !isSettled(loan) && (
                    <Rune tone="sage">
                      {t('coinify.loanRemaining', 'resta {{amount}}', {
                        amount: formatCurrency(remaining, { currency: loan.currency }),
                      })}
                    </Rune>
                  )}
                </span>
                <span className="qb-numeral coin-loan-card__amount">{formatCurrency(loan.amount, { currency: loan.currency })}</span>
                <span className="coin-loan-card__action">
                  {!isSettled(loan) ? (
                    <button className="rpg-button" style={{ fontSize: 'var(--fs-label)', padding: '2px 8px' }}
                      aria-label={t('coinify.settleLoan', 'Saldar préstamo')}
                      title={t('coinify.settleLoan', 'Saldar préstamo')}
                      onClick={() => handleSettle(loan.id)}>
                      {t('coinify.settle')}
                    </button>
                  ) : (
                    <span className="coin-loan-card__settled"><Checkmark style={{ width: '0.8em', height: '0.8em' }} /> {t('coinify.settledSingular', 'Saldado')}</span>
                  )}
                </span>
              </div>
            );
          })}

          {/* Installment groups */}
          {Object.entries(installmentGroups).map(([groupId, groupLoans]) => {
            const total = groupLoans.length;
            const paid = groupLoans.filter(isSettled).length;
            const firstLoan = groupLoans[0];
            const allSettled = paid === total;
            const totalAmount = groupLoans.reduce((sum, l) => sum + l.amount, 0);

            return (
              <div key={groupId} className="coin-loan-card__row">
                <Rune tone="gold">{t('coinify.installmentsLabel')}</Rune>
                <span className="qb-hand coin-loan-card__desc" title={firstLoan.description || firstLoan.date}>
                  {firstLoan.description || firstLoan.date}
                  <span className="coin-loan-card__date">{firstLoan.date.slice(0, 10)}</span>
                </span>
                <span className="coin-loan-card__progress">
                  <Gauge value={paid} max={total} tone={allSettled ? 'sage' : 'gold'} showPips={false} label={`${paid}/${total}`} />
                </span>
                <span className="qb-numeral coin-loan-card__amount">{formatCurrency(totalAmount, { currency: firstLoan.currency })}</span>
                <span className="coin-loan-card__action">
                  {!allSettled ? (
                    <button className="rpg-button" style={{ fontSize: 'var(--fs-label)', padding: '2px 8px' }}
                      aria-label={t('coinify.markPayment')}
                      title={t('coinify.markPayment')}
                      onClick={() => openPayment(firstLoan.id)}>
                      {t('coinify.markPayment')}
                    </button>
                  ) : (
                    <span className="coin-loan-card__settled"><Checkmark style={{ width: '0.8em', height: '0.8em' }} /> {t('coinify.settledSingular', 'Saldado')}</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      );
    });
  };

  return (
    <div>
      {/* Header. The help bubble is inline next to the tabs — as a sealed bubble
          it was absolutely positioned right on top of "+ Agregar Préstamo". */}
      <div className="coin-loan-header">
        <div className="coin-loan-tabs">
          <button
            className={`rpg-button coin-loan-tab ${direction === 'lent' ? 'coin-loan-tab--active' : 'coin-loan-tab--inactive'}`}
            onClick={() => { setDirection('lent'); setFormDirection('lent'); }}
          >
            {t('coinify.lent')}
          </button>
          <button
            className={`rpg-button coin-loan-tab ${direction === 'borrowed' ? 'coin-loan-tab--active' : 'coin-loan-tab--inactive'}`}
            onClick={() => { setDirection('borrowed'); setFormDirection('borrowed'); }}
          >
            {t('coinify.borrowed')}
          </button>
          <HelpBubble variant="inline" text={t('coinify.loansPageHelp', 'Prestado: dinero que diste. Tomado prestado: dinero que debés. Podés registrar pagos parciales y saldar.')} />
        </div>
        <button className="rpg-button coin-toggle-btn" style={{ padding: '4px 12px', fontSize: 'var(--fs-label)' }}
          aria-expanded={showForm}
          onClick={() => setShowForm(!showForm)}>
          <ChevronUp
            className={`coin-toggle-btn__chevron ${showForm ? '' : 'coin-toggle-btn__chevron--collapsed'}`}
            style={{ width: '0.65em', height: '0.65em' }}
          />
          {t('coinify.addLoan')}
        </button>
      </div>

      {/* Add Loan Form */}
      {showForm && (
        <form onSubmit={handleAddLoan}>
          <div className="coin-codex-form">
            <div className="coin-codex-form__title">
              {t('coinify.addLoan')}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <input type="text" value={formPerson} onChange={(e) => setFormPerson(e.target.value)}
                  placeholder={t('coinify.personName')} className="rpg-input" style={{ flex: 1 }} required />
                <button type="button" onClick={() => setFormDirection('lent')}
                  className={`rpg-button ${formDirection === 'lent' ? 'rpg-btn-active' : ''}`}>
                  {t('coinify.lent')}
                </button>
                <button type="button" onClick={() => setFormDirection('borrowed')}
                  className={`rpg-button ${formDirection === 'borrowed' ? 'rpg-btn-active' : ''}`}>
                  {t('coinify.borrowed')}
                </button>
              </div>

              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" onClick={() => setFormType('single')}
                  className={`rpg-button ${formType === 'single' ? 'rpg-btn-active' : ''}`} style={{ flex: 1 }}>
                  {t('coinify.singlePayment')}
                </button>
                <button type="button" onClick={() => setFormType('installments')}
                  className={`rpg-button ${formType === 'installments' ? 'rpg-btn-active' : ''}`} style={{ flex: 1 }}>
                  {t('coinify.installmentsLabel')}
                </button>
              </div>

              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <RpgNumberInput value={formAmount} onChange={setFormAmount}
                  placeholder={t('coinify.amount')} style={{ flex: 1 }} min={0} step={0.01} required />
                <select value={formCurrency} onChange={(e) => setFormCurrency(e.target.value as Currency)}
                  className="rpg-select" style={{ width: 70 }}>
                  <option value="ARS">ARS</option>
                  <option value="USD">USD</option>
                </select>
                {formType === 'installments' && (
                  <>
                    <label style={{ fontSize: 'var(--fs-label)', opacity: 0.6, whiteSpace: 'nowrap' }}>{t('coinify.installments')}</label>
                    <RpgNumberInput value={String(formInstallments)}
                      onChange={(v) => setFormInstallments(Math.max(1, parseInt(v) || 1))}
                      style={{ width: 60 }} min={1} />
                  </>
                )}
              </div>

              {formType === 'installments' && (
                <CategorySelect value={formCategory} onChange={setFormCategory} />
              )}

              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <input type="text" value={formDescription} onChange={(e) => setFormDescription(e.target.value)}
                  placeholder={t('coinify.description')} className="rpg-input" style={{ flex: 1 }} />
                <input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} className="rpg-input" />
              </div>

              <button type="submit" className="rpg-button" style={{ width: '100%' }} disabled={submitting}>
                {submitting ? '...' : t('coinify.add')}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Payment Modal */}
      {payingLoanId && (
        <div className="coin-codex-form">
          <div className="coin-codex-form__title">
            {t('coinify.markPayment')}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <RpgNumberInput value={paymentAmount} onChange={setPaymentAmount}
              placeholder={t('coinify.amount')} style={{ flex: 1 }} min={0} step={0.01} />
            <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className="rpg-input" />
            <button className="rpg-button" style={{ flex: 'none' }} onClick={() => handleAddPayment(payingLoanId)}>
              {t('coinify.saveTransaction')}
            </button>
            <button className="rpg-button" style={{ opacity: 0.6 }} onClick={() => setPayingLoanId(null)}>
              {t('coinify.cancelEdit')}
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
        <button className="rpg-button" style={{ fontSize: 'var(--fs-label)', opacity: 0.75, padding: '4px 12px', marginBottom: 8 }}
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
