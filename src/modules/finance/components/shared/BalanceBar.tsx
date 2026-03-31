import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface BalanceBarProps {
  income: number;
  expenses: number;
}

export function BalanceBar({ income, expenses }: BalanceBarProps) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const total = income + expenses;

  if (total === 0) return null;

  const incomePct = (income / total) * 100;
  const expensePct = (expenses / total) * 100;

  return (
    <div
      className="coin-balance-bar"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className="coin-balance-bar__segment coin-balance-bar__segment--income"
        style={{ width: `${incomePct}%` }}
      />
      <div
        className="coin-balance-bar__segment coin-balance-bar__segment--expense"
        style={{ width: `${expensePct}%` }}
      />
      {hovered && (
        <div className="coin-balance-bar__tooltip">
          {t('coinify.income')}: ${income.toLocaleString('es-AR')} &nbsp;|&nbsp;
          {t('coinify.expense')}: ${expenses.toLocaleString('es-AR')}
        </div>
      )}
    </div>
  );
}
