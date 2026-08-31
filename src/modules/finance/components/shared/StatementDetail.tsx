import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { CreditCardStatement } from '../../types';
import RpgNumberInput from '../../../../shared/components/RpgNumberInput';
import { useModalA11y } from '../../../../shared/hooks/useModalA11y';
import { useToast } from '../../../../shared/components/useToast';
import { CrossMark } from '../../../../shared/components/icons';
import { formatCurrency } from '../../utils/format';
import { unwrap, failureMessage, payStatement } from '../../utils/api-ext';

interface StatementDetailRow {
  id: string;
  amount: number;
  currency: 'ARS' | 'USD';
  category: string;
  description: string;
  date: string;
}

interface Props {
  statement: CreditCardStatement;
  onClose: () => void;
  onPaid: () => void;
}

export default function StatementDetail({ statement, onClose, onPaid }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [detail, setDetail] = useState<{ statement: unknown; transactions: StatementDetailRow[] } | null>(null);
  const [payAmount, setPayAmount] = useState(statement.calculatedAmount);
  const [payAmountUsd, setPayAmountUsd] = useState(statement.calculatedAmountUsd ?? 0);
  const [paying, setPaying] = useState(false);

  const { dialogProps, stopPropagation } = useModalA11y({ onClose });

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

  const hasUsd = (statement.calculatedAmountUsd ?? 0) > 0 || payAmountUsd > 0;

  const handlePay = async () => {
    setPaying(true);
    // The handler rejects a zero/negative pair with `{ ok: false, reason }`.
    const result = await unwrap(
      payStatement(statement.id, payAmount, hasUsd ? payAmountUsd : undefined),
    );
    setPaying(false);
    if (!result.ok) {
      toast({ type: 'warning', message: failureMessage(result.reason, t) });
      return;
    }
    onPaid();
  };

  return (
    <div className="coin-modal-overlay" onClick={onClose}>
      <div
        {...dialogProps}
        className="rpg-card coin-modal"
        aria-label={`${t('coinify.statementFor')} ${statement.creditCardName}`}
        onClick={stopPropagation}
      >
        {/* An explicit close button: the only visible action used to be
            "Pagar resumen", so the obvious way out was a financial write. */}
        <div className="coin-modal__header">
          <div className="rpg-card-title" style={{ margin: 0 }}>
            {t('coinify.statementFor')} {statement.creditCardName} — {statement.periodMonth}
          </div>
          <button
            className="rpg-button tap-target"
            aria-label={t('coinify.close', 'Cerrar')}
            title={t('coinify.close', 'Cerrar')}
            onClick={onClose}
            style={{ padding: '2px 8px' }}
          ><CrossMark style={{ width: '0.7em', height: '0.7em' }} /></button>
        </div>

        <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
          <div>
            <span style={{ fontSize: 'var(--fs-label)', opacity: 0.8 }}>{t('coinify.calculated')}</span>
            <div style={{ fontWeight: 'bold', fontSize: 'var(--fs-nav)' }}>
              {formatCurrency(statement.calculatedAmount, { currency: 'ARS' })}
            </div>
            {(statement.calculatedAmountUsd ?? 0) > 0 && (
              <div style={{ fontSize: 'var(--fs-label)', opacity: 0.8 }}>
                {formatCurrency(statement.calculatedAmountUsd ?? 0, { currency: 'USD' })}
              </div>
            )}
          </div>
          {statement.status === 'paid' && statement.paidAmount != null && (
            <div>
              <span style={{ fontSize: 'var(--fs-label)', opacity: 0.8 }}>{t('coinify.paid')}</span>
              <div style={{ fontWeight: 'bold', fontSize: 'var(--fs-nav)' }}>
                {formatCurrency(statement.paidAmount, { currency: 'ARS' })}
              </div>
              {(statement.paidAmountUsd ?? 0) > 0 && (
                <div style={{ fontSize: 'var(--fs-label)', opacity: 0.8 }}>
                  {formatCurrency(statement.paidAmountUsd ?? 0, { currency: 'USD' })}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ borderTop: '1px solid var(--parch-1)', paddingTop: 8 }}>
          {detail?.transactions.map((tx) => (
            <div key={tx.id} style={{
              display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 0',
              fontSize: 'var(--fs-label)', borderBottom: '1px solid var(--parch-1)',
            }}>
              <span title={tx.description || tx.category}>{tx.date} — {tx.description || tx.category}</span>
              <span style={{ fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                {formatCurrency(tx.amount, { currency: tx.currency === 'USD' ? 'USD' : 'ARS' })}
              </span>
            </div>
          ))}
        </div>

        {statement.status === 'pending' && (
          <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 'var(--fs-label)' }}>{t('coinify.paidAmount')}:</span>
            <RpgNumberInput value={String(payAmount)}
              onChange={(v) => setPayAmount(parseFloat(v) || 0)}
              style={{ width: 130 }} step={0.01} min={0} />
            {hasUsd && (
              <>
                <span style={{ fontSize: 'var(--fs-label)' }}>USD:</span>
                <RpgNumberInput value={String(payAmountUsd)}
                  onChange={(v) => setPayAmountUsd(parseFloat(v) || 0)}
                  style={{ width: 110 }} step={0.01} min={0} />
              </>
            )}
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
