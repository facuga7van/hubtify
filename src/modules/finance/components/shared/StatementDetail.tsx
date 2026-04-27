import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { CreditCardStatement } from '../../types';
import RpgNumberInput from '../../../../shared/components/RpgNumberInput';
import { formatCurrency } from '../../utils/format';

interface Props {
  statement: CreditCardStatement;
  onClose: () => void;
  onPaid: () => void;
}

export default function StatementDetail({ statement, onClose, onPaid }: Props) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<{ statement: unknown; transactions: Array<{
    id: string; amount: number; currency: string; category: string;
    description: string; date: string;
  }> } | null>(null);
  const [payAmount, setPayAmount] = useState(statement.calculatedAmount);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    window.api.financeGetStatementDetail(statement.id).then((d) => setDetail(d as typeof detail));
  }, [statement.id]);

  useEffect(() => {
    const handler = () => {
      window.api.financeGetStatementDetail(statement.id).then((d) => setDetail(d as typeof detail));
    };
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
  }, [statement.id]);

  const handlePay = async () => {
    setPaying(true);
    await window.api.financePayStatement(statement.id, payAmount);
    setPaying(false);
    onPaid();
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(44,24,16,0.7)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div className="rpg-card" style={{ width: 520, maxHeight: '80vh', overflow: 'auto' }}
        onClick={(e) => e.stopPropagation()}>
        <div className="rpg-card-title">
          {t('coinify.statementFor')} {statement.creditCardName} — {statement.periodMonth}
        </div>

        <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
          <div>
            <span style={{ fontSize: 'var(--fs-label)', opacity: 0.8 }}>{t('coinify.calculated')}</span>
            <div style={{ fontWeight: 'bold', fontSize: 'var(--fs-nav)' }}>
              {formatCurrency(statement.calculatedAmount)}
            </div>
          </div>
          {statement.status === 'paid' && statement.paidAmount != null && (
            <div>
              <span style={{ fontSize: 'var(--fs-label)', opacity: 0.8 }}>{t('coinify.paid')}</span>
              <div style={{ fontWeight: 'bold', fontSize: 'var(--fs-nav)' }}>
                {formatCurrency(statement.paidAmount)}
              </div>
            </div>
          )}
        </div>

        <div style={{ borderTop: '1px solid var(--parch-1)', paddingTop: 8 }}>
          {detail?.transactions.map((tx) => (
            <div key={tx.id} style={{
              display: 'flex', justifyContent: 'space-between', padding: '4px 0',
              fontSize: 'var(--fs-label)', borderBottom: '1px solid var(--parch-1)',
            }}>
              <span>{tx.date} — {tx.description || tx.category}</span>
              <span style={{ fontWeight: 'bold' }}>{formatCurrency(tx.amount)}</span>
            </div>
          ))}
        </div>

        {statement.status === 'pending' && (
          <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={{ fontSize: 'var(--fs-label)' }}>{t('coinify.paidAmount')}:</label>
            <RpgNumberInput value={String(payAmount)}
              onChange={(v) => setPayAmount(parseFloat(v) || 0)}
              style={{ width: 130 }} step={0.01} min={0} />
            <button className="rpg-button" onClick={handlePay} disabled={paying}>
              {t('coinify.payStatement')}
            </button>
          </div>
        )}

        {statement.status === 'paid' && (
          <div style={{ marginTop: 12, textAlign: 'center', opacity: 0.8, fontStyle: 'italic' }}>
            {t('coinify.statementPaid')} — {statement.paidDate}
          </div>
        )}
      </div>
    </div>
  );
}
