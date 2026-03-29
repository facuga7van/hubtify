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
    <div className="space-y-1">
      <p className="font-mono text-lg">
        {total !== null ? `$${total.toLocaleString('es-AR')}` : '...'}
      </p>
      <p className="text-xs opacity-40">
        {t('coinify.thisMonth')} · {loansCount} {t('coinify.activeLoans')}
      </p>
    </div>
  );
}
