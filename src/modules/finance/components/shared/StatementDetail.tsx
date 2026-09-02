import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CARD_TAX_CATEGORY, type CreditCardStatement } from '../../types';
import RpgNumberInput from '../../../../shared/components/RpgNumberInput';
import { useModalA11y } from '../../../../shared/hooks/useModalA11y';
import { useToast } from '../../../../shared/components/useToast';
import { CrossMark } from '../../../../shared/components/icons';
import { formatCurrency } from '../../utils/format';
import { unwrap, failureMessage, payStatement } from '../../utils/api-ext';
import { AccountSelect, NO_ACCOUNT, accountIdForSubmit, rememberLastAccountId } from './AccountSelect';

interface StatementDetailRow {
  id: string;
  type: 'expense' | 'income';
  amount: number;
  currency: 'ARS' | 'USD';
  category: string;
  description: string;
  date: string;
}

/** Signed contribution of a row to what the statement owes: a refund subtracts. */
function signedAmount(tx: StatementDetailRow): number {
  return tx.type === 'income' ? -tx.amount : tx.amount;
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
  // Which pocket pays the statement. '' = unresolved: the AccountSelect picks
  // the default (last account used, else «Efectivo»). Hidden while the
  // accounts bridge is not wired, in which case no account is sent at all.
  const [accountValue, setAccountValue] = useState('');
  const [accountsSupported, setAccountsSupported] = useState(false);

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

  /**
   * Card taxes are a dozen tiny lines the user did not choose to spend — stamp
   * tax, VAT debits, perceptions, financing interest and their refunds. Listing
   * them one by one buries the purchases they are meant to sit beside, so they
   * collapse into a single figure per currency.
   */
  const { purchases, taxTotals, taxCount } = useMemo(() => {
    const all = detail?.transactions ?? [];
    const kept: StatementDetailRow[] = [];
    const totals = { ARS: 0, USD: 0 };
    let count = 0;
    for (const tx of all) {
      if (tx.category === CARD_TAX_CATEGORY) {
        totals[tx.currency === 'USD' ? 'USD' : 'ARS'] += signedAmount(tx);
        count++;
      } else {
        kept.push(tx);
      }
    }
    return { purchases: kept, taxTotals: totals, taxCount: count };
  }, [detail]);

  const handlePay = async () => {
    setPaying(true);
    if (accountsSupported) rememberLastAccountId(accountValue === '' ? NO_ACCOUNT : accountValue);
    // The handler rejects a zero/negative pair with `{ ok: false, reason }`.
    // The account makes the `Pago Tarjeta` row move a real balance — until now
    // the chest only ever saw manual entries.
    const result = await unwrap(
      payStatement(
        statement.id,
        payAmount,
        hasUsd ? payAmountUsd : undefined,
        accountsSupported ? accountIdForSubmit(accountValue) : undefined,
      ),
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
        aria-label={`${t('coinify.statementFor')} ${statement.creditCardName ?? ''} ${statement.periodMonth}`.replace(/\s+/g, ' ').trim()}
        onClick={stopPropagation}
      >
        {/* An explicit close button: the only visible action used to be
            "Pagar resumen", so the obvious way out was a financial write. */}
        <div className="coin-modal__header">
          {/* `creditCardName` es opcional en el tipo: sin él el título quedaba
              como «Resumen de  — 2026-09», con la raya colgando de la nada. */}
          <div className="rpg-card-title" style={{ margin: 0 }}>
            {t('coinify.statementFor')}{statement.creditCardName ? ` ${statement.creditCardName}` : ''}
            {' — '}{statement.periodMonth}
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
            <span style={{ fontSize: 'var(--fs-label)', color: 'var(--ink-soft)' }}>{t('coinify.calculated')}</span>
            <div style={{ fontWeight: 'bold', fontSize: 'var(--fs-nav)' }}>
              {formatCurrency(statement.calculatedAmount, { currency: 'ARS' })}
            </div>
            {(statement.calculatedAmountUsd ?? 0) > 0 && (
              <div style={{ fontSize: 'var(--fs-label)', color: 'var(--ink-soft)' }}>
                {formatCurrency(statement.calculatedAmountUsd ?? 0, { currency: 'USD' })}
              </div>
            )}
          </div>
          {statement.status === 'paid' && statement.paidAmount != null && (
            <div>
              <span style={{ fontSize: 'var(--fs-label)', color: 'var(--ink-soft)' }}>{t('coinify.paid')}</span>
              <div style={{ fontWeight: 'bold', fontSize: 'var(--fs-nav)' }}>
                {formatCurrency(statement.paidAmount, { currency: 'ARS' })}
              </div>
              {(statement.paidAmountUsd ?? 0) > 0 && (
                <div style={{ fontSize: 'var(--fs-label)', color: 'var(--ink-soft)' }}>
                  {formatCurrency(statement.paidAmountUsd ?? 0, { currency: 'USD' })}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ borderTop: '1px solid var(--parch-1)', paddingTop: 8 }}>
          {purchases.map((tx) => (
            <div key={tx.id} style={{
              display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 0',
              fontSize: 'var(--fs-label)', borderBottom: '1px solid var(--parch-1)',
            }}>
              <span title={tx.description || tx.category}>{tx.date} — {tx.description || tx.category}</span>
              <span style={{ fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                {formatCurrency(signedAmount(tx), { currency: tx.currency === 'USD' ? 'USD' : 'ARS' })}
              </span>
            </div>
          ))}

          {taxCount > 0 && (
            <div
              className="coin-statement-taxes"
              title={t('coinify.statementTaxesHint', '{{count}} líneas de impuestos, percepciones e intereses del resumen', { count: taxCount })}
            >
              <span>{t('coinify.statementTaxes', 'Impuestos y cargos')}</span>
              <span className="coin-statement-taxes__amount">
                {formatCurrency(taxTotals.ARS, { currency: 'ARS' })}
                {taxTotals.USD !== 0 && (
                  <span className="coin-statement-taxes__usd">
                    {formatCurrency(taxTotals.USD, { currency: 'USD' })}
                  </span>
                )}
              </span>
            </div>
          )}
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
            {/* Renders nothing while the accounts bridge is not wired.
                El rótulo y su selector viajan juntos: sueltos en una fila que
                envuelve, «Pagar desde:» terminaba solo al final de un renglón y
                el desplegable arrancaba el siguiente. */}
            <span className="coin-statement-pay__field">
              <span style={{ fontSize: 'var(--fs-label)' }}>{t('coinify.accountPaidFrom', 'Pagar desde')}:</span>
              <AccountSelect value={accountValue} onChange={setAccountValue} onSupported={setAccountsSupported} />
            </span>
            <button className="rpg-button" onClick={handlePay} disabled={paying}>
              {t('coinify.payStatement')}
            </button>
          </div>
        )}

        {statement.status === 'paid' && (
          <div style={{ marginTop: 12, textAlign: 'center', color: 'var(--ink-soft)', fontStyle: 'italic' }}>
            {t('coinify.statementPaid')}{statement.paidDate ? ` — ${statement.paidDate}` : ''}
          </div>
        )}
      </div>
    </div>
  );
}
