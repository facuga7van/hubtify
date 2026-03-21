import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import PageHeader from '../../../shared/components/PageHeader';
import type { Transaction, Loan } from '../types';
import { CATEGORIES } from '../types';

export default function FinanceDashboard() {
  const { t } = useTranslation();
  const [month, setMonth] = useState(() => new Date().toLocaleDateString('en-CA').slice(0, 7));
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [categories, setCategories] = useState<string[]>(CATEGORIES);
  const [monthlyTotal, setMonthlyTotal] = useState(0);

  // Dollar rates
  const [dollarRates, setDollarRates] = useState<Array<{ nombre: string; compra: number; venta: number }>>([]);
  const [dollarCached, setDollarCached] = useState(false);

  // Add transaction form
  const [txAmount, setTxAmount] = useState('');
  const [txDesc, setTxDesc] = useState('');
  const [txCategory, setTxCategory] = useState('Otros');
  const [txType, setTxType] = useState<'expense' | 'income'>('expense');

  // Add loan form
  const [showLoanForm, setShowLoanForm] = useState(false);
  const [loanPerson, setLoanPerson] = useState('');
  const [loanAmount, setLoanAmount] = useState('');
  const [loanType, setLoanType] = useState<'lent' | 'borrowed'>('lent');
  const [loanDesc, setLoanDesc] = useState('');

  const loadData = useCallback(async (m: string) => {
    const [txList, loanList, cats, total] = await Promise.all([
      window.api.financeGetTransactions(m),
      window.api.financeGetLoans(),
      window.api.financeGetCategories(),
      window.api.financeGetMonthlyTotal(),
    ]);
    setTransactions(txList as Transaction[]);
    setLoans((loanList as Array<Record<string, unknown>>).map((l) => ({
      ...l,
      settled: Boolean(l.settled),
      isVariable: Boolean(l.isVariable),
    })) as unknown as Loan[]);
    setCategories(cats as string[]);
    setMonthlyTotal(total as number);
  }, []);

  useEffect(() => { loadData(month); }, [month, loadData]);

  useEffect(() => {
    window.api.dollarGetRates().then((result) => {
      if (result.success && result.rates) {
        setDollarRates(result.rates as typeof dollarRates);
        setDollarCached(!!result.cached);
      }
    }).catch(console.error);
  }, []);

  const addTransaction = async () => {
    const amount = parseFloat(txAmount);
    if (!amount || amount <= 0) return;
    const today = new Date().toLocaleDateString('en-CA');
    await window.api.financeAddTransaction({
      type: txType, amount, category: txCategory,
      description: txDesc, date: today,
    });
    setTxAmount(''); setTxDesc('');
    loadData(month);
  };

  const deleteTransaction = async (id: string) => {
    await window.api.financeDeleteTransaction(id);
    loadData(month);
  };

  const addLoan = async () => {
    const amount = parseFloat(loanAmount);
    if (!amount || !loanPerson.trim()) return;
    const today = new Date().toLocaleDateString('en-CA');
    await window.api.financeAddLoan({
      personName: loanPerson.trim(), type: loanType,
      amount, date: today, description: loanDesc,
    });
    setLoanPerson(''); setLoanAmount(''); setLoanDesc('');
    setShowLoanForm(false);
    loadData(month);
  };

  const settleLoan = async (id: string) => {
    await window.api.financeSettleLoan(id);
    loadData(month);
  };

  const activeLoans = loans.filter((l) => !l.settled);
  const settledLoans = loans.filter((l) => l.settled);

  return (
    <div>
      <PageHeader title={t('coinify.title')} subtitle={t('coinify.subtitle')} />

      {/* Dollar rates */}
      {dollarRates.length > 0 && (
        <div className="rpg-card" style={{ marginBottom: 16 }}>
          <div className="rpg-card-title">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--rpg-gold-dark)" strokeWidth="1.3" strokeLinecap="round">
              <circle cx="8" cy="8" r="6"/><path d="M8 4v8M6 5.5h3.5a1.5 1.5 0 010 3H5.5a1.5 1.5 0 000 3H11"/>
            </svg>
            {t('coinify.dollarRates')} {dollarCached && <span style={{ fontSize: '0.7rem', opacity: 0.5 }}>(cache)</span>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
            {dollarRates.filter(r => ['Blue', 'Oficial', 'Tarjeta', 'Cripto'].includes(r.nombre)).map((rate) => (
              <div key={rate.nombre} style={{ padding: 8, background: 'var(--rpg-parchment-dark)', borderRadius: 'var(--rpg-radius)', textAlign: 'center' }}>
                <div style={{ fontSize: '0.75rem', opacity: 0.6 }}>{rate.nombre}</div>
                <div style={{ fontFamily: 'Fira Code, monospace', fontSize: '0.9rem' }}>
                  ${rate.venta}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Monthly total */}
      <div className="rpg-card" style={{ marginBottom: 16 }}>
        <div className="rpg-card-title">{t('coinify.monthlyExpenses')} — {month}</div>
        <p style={{ fontSize: '2rem', fontFamily: 'Fira Code, monospace', color: 'var(--rpg-wood)' }}>
          ${monthlyTotal.toLocaleString()} <span style={{ fontSize: '0.85rem', opacity: 0.6 }}>ARS</span>
        </p>
        <div style={{ marginTop: 8 }}>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rpg-input"
          />
        </div>
      </div>

      {/* Quick-add transaction */}
      <div className="rpg-card" style={{ marginBottom: 16 }}>
        <div className="rpg-card-title">{t('coinify.quickAdd')}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <select
            value={txType}
            onChange={(e) => setTxType(e.target.value as 'expense' | 'income')}
            className="rpg-input"
            style={{ width: 100 }}
          >
            <option value="expense">{t('coinify.expense')}</option>
            <option value="income">{t('coinify.income')}</option>
          </select>
          <input
            type="number"
            placeholder={t('coinify.amount')}
            value={txAmount}
            onChange={(e) => setTxAmount(e.target.value)}
            className="rpg-input"
            style={{ width: 100 }}
            min="0"
            step="0.01"
          />
          <input
            type="text"
            placeholder={t('coinify.description')}
            value={txDesc}
            onChange={(e) => setTxDesc(e.target.value)}
            className="rpg-input"
            style={{ flex: 1, minWidth: 120 }}
          />
          <select
            value={txCategory}
            onChange={(e) => setTxCategory(e.target.value)}
            className="rpg-input"
            style={{ width: 140 }}
          >
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button className="rpg-button" onClick={addTransaction}>+ {t('coinify.add')}</button>
        </div>
      </div>

      {/* Transaction list */}
      <div className="rpg-card" style={{ marginBottom: 16 }}>
        <div className="rpg-card-title">{t('coinify.transactions')} ({transactions.length})</div>
        {transactions.length === 0 ? (
          <p style={{ opacity: 0.5, fontStyle: 'italic' }}>{t('coinify.noTransactions')}</p>
        ) : (
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            {transactions.map((tx) => (
              <div key={tx.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.05)',
              }}>
                <div>
                  <span style={{ color: tx.type === 'expense' ? 'var(--rpg-hp-red-light)' : 'var(--rpg-xp-green-light)', fontWeight: 600 }}>
                    {tx.type === 'expense' ? '-' : '+'}${tx.amount.toLocaleString()}
                  </span>
                  <span style={{ opacity: 0.6, marginLeft: 8, fontSize: '0.85rem' }}>
                    {tx.description || tx.category}
                  </span>
                  <span style={{ opacity: 0.4, marginLeft: 8, fontSize: '0.75rem' }}>
                    {tx.date}
                  </span>
                </div>
                <button
                  onClick={() => deleteTransaction(tx.id)}
                  style={{ background: 'none', border: 'none', color: 'var(--rpg-hp-red-light)', cursor: 'pointer', fontSize: '0.85rem' }}
                >
                  x
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Loans */}
      <div className="rpg-card" style={{ marginBottom: 16 }}>
        <div className="rpg-card-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>{t('coinify.loans')} ({activeLoans.length} {t('coinify.active')})</span>
          <button className="rpg-button" style={{ fontSize: '0.75rem', padding: '2px 8px' }} onClick={() => setShowLoanForm(!showLoanForm)}>
            {showLoanForm ? t('coinify.cancel') : `+ ${t('coinify.loan')}`}
          </button>
        </div>

        {showLoanForm && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'flex-end' }}>
            <select
              value={loanType}
              onChange={(e) => setLoanType(e.target.value as 'lent' | 'borrowed')}
              className="rpg-input"
              style={{ width: 110 }}
            >
              <option value="lent">{t('coinify.iLent')}</option>
              <option value="borrowed">{t('coinify.iBorrowed')}</option>
            </select>
            <input
              type="text"
              placeholder={t('coinify.person')}
              value={loanPerson}
              onChange={(e) => setLoanPerson(e.target.value)}
              className="rpg-input"
              style={{ width: 120 }}
            />
            <input
              type="number"
              placeholder={t('coinify.amount')}
              value={loanAmount}
              onChange={(e) => setLoanAmount(e.target.value)}
              className="rpg-input"
              style={{ width: 100 }}
              min="0"
            />
            <input
              type="text"
              placeholder={t('coinify.note')}
              value={loanDesc}
              onChange={(e) => setLoanDesc(e.target.value)}
              className="rpg-input"
              style={{ flex: 1, minWidth: 100 }}
            />
            <button className="rpg-button" onClick={addLoan}>{t('coinify.add')}</button>
          </div>
        )}

        {activeLoans.length === 0 && !showLoanForm ? (
          <p style={{ opacity: 0.5, fontStyle: 'italic' }}>{t('coinify.noLoans')}</p>
        ) : (
          activeLoans.map((loan) => (
            <div key={loan.id} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.05)',
            }}>
              <div>
                <span style={{ fontWeight: 600, color: loan.type === 'lent' ? 'var(--rpg-xp-green-light)' : 'var(--rpg-hp-red-light)' }}>
                  {loan.type === 'lent' ? t('coinify.lentTo') : t('coinify.borrowedFrom')} {loan.personName}
                </span>
                <span style={{ marginLeft: 8 }}>${loan.amount.toLocaleString()}</span>
                {loan.description && <span style={{ opacity: 0.5, marginLeft: 8, fontSize: '0.85rem' }}>({loan.description})</span>}
              </div>
              <button
                className="rpg-button"
                style={{ fontSize: '0.75rem', padding: '2px 8px' }}
                onClick={() => settleLoan(loan.id)}
              >
                {t('coinify.settle')}
              </button>
            </div>
          ))
        )}

        {settledLoans.length > 0 && (
          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: 'pointer', opacity: 0.6, fontSize: '0.85rem' }}>
              {settledLoans.length} {t('coinify.settledLoans')}
            </summary>
            {settledLoans.map((loan) => (
              <div key={loan.id} style={{ padding: '4px 0', opacity: 0.5, fontSize: '0.85rem' }}>
                {loan.type === 'lent' ? t('coinify.lentTo') : t('coinify.borrowedFrom')} {loan.personName} — ${loan.amount.toLocaleString()}
                {loan.settledDate && <span> ({t('coinify.settled')} {loan.settledDate})</span>}
              </div>
            ))}
          </details>
        )}
      </div>
    </div>
  );
}
