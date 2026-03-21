import { useState, useEffect, useCallback } from 'react';
import type { Transaction, Loan } from '../types';
import { CATEGORIES } from '../types';

export default function FinanceDashboard() {
  const [month, setMonth] = useState(() => new Date().toLocaleDateString('en-CA').slice(0, 7));
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [categories, setCategories] = useState<string[]>(CATEGORIES);
  const [monthlyTotal, setMonthlyTotal] = useState(0);

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
      <h2 style={{ marginBottom: 16 }}>Finance</h2>

      {/* Monthly total */}
      <div className="rpg-card" style={{ marginBottom: 16 }}>
        <div className="rpg-card-title">Monthly Expenses — {month}</div>
        <p style={{ fontSize: '2rem', fontFamily: 'Fira Code, monospace', color: 'var(--rpg-wood)' }}>
          ${monthlyTotal.toLocaleString()} <span style={{ fontSize: '0.85rem', opacity: 0.6 }}>ARS</span>
        </p>
        <div style={{ marginTop: 8 }}>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            style={{ background: 'var(--rpg-dark)', color: 'var(--rpg-parchment)', border: '1px solid var(--rpg-wood)', padding: '4px 8px', borderRadius: 4 }}
          />
        </div>
      </div>

      {/* Quick-add transaction */}
      <div className="rpg-card" style={{ marginBottom: 16 }}>
        <div className="rpg-card-title">Quick Add</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <select
            value={txType}
            onChange={(e) => setTxType(e.target.value as 'expense' | 'income')}
            className="rpg-input"
            style={{ width: 100 }}
          >
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
          <input
            type="number"
            placeholder="Amount"
            value={txAmount}
            onChange={(e) => setTxAmount(e.target.value)}
            className="rpg-input"
            style={{ width: 100 }}
            min="0"
            step="0.01"
          />
          <input
            type="text"
            placeholder="Description"
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
          <button className="rpg-btn" onClick={addTransaction}>+ Add</button>
        </div>
      </div>

      {/* Transaction list */}
      <div className="rpg-card" style={{ marginBottom: 16 }}>
        <div className="rpg-card-title">Transactions ({transactions.length})</div>
        {transactions.length === 0 ? (
          <p style={{ opacity: 0.5, fontStyle: 'italic' }}>No transactions this month</p>
        ) : (
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            {transactions.map((tx) => (
              <div key={tx.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.05)',
              }}>
                <div>
                  <span style={{ color: tx.type === 'expense' ? '#e57373' : '#81c784', fontWeight: 600 }}>
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
                  style={{ background: 'none', border: 'none', color: '#e57373', cursor: 'pointer', fontSize: '0.85rem' }}
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
          <span>Loans ({activeLoans.length} active)</span>
          <button className="rpg-btn" style={{ fontSize: '0.75rem', padding: '2px 8px' }} onClick={() => setShowLoanForm(!showLoanForm)}>
            {showLoanForm ? 'Cancel' : '+ Loan'}
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
              <option value="lent">I lent</option>
              <option value="borrowed">I borrowed</option>
            </select>
            <input
              type="text"
              placeholder="Person"
              value={loanPerson}
              onChange={(e) => setLoanPerson(e.target.value)}
              className="rpg-input"
              style={{ width: 120 }}
            />
            <input
              type="number"
              placeholder="Amount"
              value={loanAmount}
              onChange={(e) => setLoanAmount(e.target.value)}
              className="rpg-input"
              style={{ width: 100 }}
              min="0"
            />
            <input
              type="text"
              placeholder="Note"
              value={loanDesc}
              onChange={(e) => setLoanDesc(e.target.value)}
              className="rpg-input"
              style={{ flex: 1, minWidth: 100 }}
            />
            <button className="rpg-btn" onClick={addLoan}>Add</button>
          </div>
        )}

        {activeLoans.length === 0 && !showLoanForm ? (
          <p style={{ opacity: 0.5, fontStyle: 'italic' }}>No active loans</p>
        ) : (
          activeLoans.map((loan) => (
            <div key={loan.id} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.05)',
            }}>
              <div>
                <span style={{ fontWeight: 600, color: loan.type === 'lent' ? '#81c784' : '#e57373' }}>
                  {loan.type === 'lent' ? 'Lent to' : 'Borrowed from'} {loan.personName}
                </span>
                <span style={{ marginLeft: 8 }}>${loan.amount.toLocaleString()}</span>
                {loan.description && <span style={{ opacity: 0.5, marginLeft: 8, fontSize: '0.85rem' }}>({loan.description})</span>}
              </div>
              <button
                className="rpg-btn"
                style={{ fontSize: '0.75rem', padding: '2px 8px' }}
                onClick={() => settleLoan(loan.id)}
              >
                Settle
              </button>
            </div>
          ))
        )}

        {settledLoans.length > 0 && (
          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: 'pointer', opacity: 0.6, fontSize: '0.85rem' }}>
              {settledLoans.length} settled loan{settledLoans.length !== 1 ? 's' : ''}
            </summary>
            {settledLoans.map((loan) => (
              <div key={loan.id} style={{ padding: '4px 0', opacity: 0.5, fontSize: '0.85rem' }}>
                {loan.type === 'lent' ? 'Lent to' : 'Borrowed from'} {loan.personName} — ${loan.amount.toLocaleString()}
                {loan.settledDate && <span> (settled {loan.settledDate})</span>}
              </div>
            ))}
          </details>
        )}
      </div>
    </div>
  );
}
