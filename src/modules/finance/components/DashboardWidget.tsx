import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

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
      <div className="rpg-stat-number">
        {total !== null ? `$${total.toLocaleString('es-AR')}` : '...'}
      </div>
      <div className="rpg-stat-label">
        {t('coinify.thisMonth')} · {loansCount} {t('coinify.activeLoans')}
      </div>
    </div>
  );
}
