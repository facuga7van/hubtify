import { useState, useEffect } from 'react';

export default function FinanceDashboardWidget() {
  const [monthlyTotal, setMonthlyTotal] = useState(0);
  const [activeLoans, setActiveLoans] = useState(0);

  useEffect(() => {
    Promise.all([
      window.api.financeGetMonthlyTotal(),
      window.api.financeGetActiveLoansCount(),
    ]).then(([total, loans]) => {
      setMonthlyTotal(total);
      setActiveLoans(loans);
    });
  }, []);

  return (
    <div>
      <p style={{ fontSize: '1.5rem', fontFamily: 'Fira Code, monospace', color: 'var(--rpg-wood)' }}>
        ${monthlyTotal.toLocaleString()} <span style={{ fontSize: '0.75rem', opacity: 0.6 }}>ARS this month</span>
      </p>
      <p style={{ fontSize: '0.85rem', opacity: 0.7, marginTop: 4 }}>
        {activeLoans} active loan{activeLoans !== 1 ? 's' : ''}
      </p>
    </div>
  );
}
