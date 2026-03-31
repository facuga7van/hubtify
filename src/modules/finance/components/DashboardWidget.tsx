import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatedNumber } from './shared/AnimatedNumber';

export default function DashboardWidget() {
  const { t } = useTranslation();
  const [total, setTotal] = useState<number | null>(null);
  const [loansCount, setLoansCount] = useState(0);

  useEffect(() => {
    window.api.financeGetMonthlyTotal().then(setTotal);
    window.api.financeGetActiveLoansCount().then(setLoansCount);
  }, []);

  return (
    <div>
      <div className="coin-stat__number coin-stat__number--gold">
        {total !== null ? (
          <AnimatedNumber value={total} />
        ) : (
          <span className="coin-skeleton coin-skeleton--number" />
        )}
      </div>
      <div className="rpg-stat-label">
        {t('coinify.thisMonth')} · {loansCount} {t('coinify.activeLoans')}
      </div>
    </div>
  );
}
