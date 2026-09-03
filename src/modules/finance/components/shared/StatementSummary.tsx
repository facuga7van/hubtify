import { useTranslation } from 'react-i18next';
import type { StatementHeaderDto } from '../../../../../shared/types';
import type { Recon } from '../../utils/statement-recon';
import { reconStatus } from '../../utils/statement-recon';
import { formatCurrency } from '../../utils/format';

interface Props {
  header: StatementHeaderDto;
  recon: Recon | null;
  /** Cuántos planes de cuotas se detectaron en el detalle. */
  installmentPlans: number;
  /** El nombre de la tarjeta a la que va a ir, para que se vea antes de confirmar. */
  cardName?: string;
}

/**
 * **«Esto leí de tu resumen.»**
 *
 * El giro entero del rediseño está en esta tarjeta: antes había que TIPEAR el
 * mes, el cierre, el vencimiento y la tarjeta; ahora se muestran leídos y el
 * trabajo del usuario es confirmar o corregir. Todo lo que aparece acá estaba
 * impreso en el papel desde siempre (Ley 25.065 art. 23) y se descartaba.
 */
export default function StatementSummary({ header, recon, installmentPlans, cardName }: Props) {
  const { t } = useTranslation();
  const status = reconStatus(recon);

  const money = (v: number | null | undefined, currency: 'ARS' | 'USD' = 'ARS') =>
    typeof v === 'number' ? formatCurrency(v, { currency }) : '—';

  const facts: Array<{ key: string; label: string; value: string; hint?: string }> = [];

  if (cardName) {
    facts.push({
      key: 'card',
      label: t('coinify.stmtCard', 'Tarjeta'),
      value: header.cardLast4 ? `${cardName} ··${header.cardLast4}` : cardName,
    });
  }
  if (header.period) {
    facts.push({ key: 'period', label: t('coinify.stmtPeriod', 'Período'), value: header.period });
  }
  if (header.closingDate) {
    facts.push({ key: 'closing', label: t('coinify.stmtClosing', 'Cierre'), value: header.closingDate });
  }
  if (header.dueDate) {
    facts.push({ key: 'due', label: t('coinify.stmtDue', 'Vencimiento'), value: header.dueDate });
  }
  if (header.totalDue.ars != null) {
    facts.push({
      key: 'total',
      label: t('coinify.stmtTotal', 'Total a pagar'),
      value: header.totalDue.usd
        ? `${money(header.totalDue.ars)} + ${money(header.totalDue.usd, 'USD')}`
        : money(header.totalDue.ars),
    });
  }
  if (header.minimumPaymentArs != null) {
    facts.push({ key: 'min', label: t('coinify.stmtMinimum', 'Pago mínimo'), value: money(header.minimumPaymentArs) });
  }
  if (header.payments.ars != null || header.payments.usd != null) {
    facts.push({
      key: 'paid',
      // Lo que el usuario pidió textualmente: «el total que pagué en el mes».
      label: t('coinify.stmtPaid', 'Pagaste en el mes'),
      value: header.payments.usd
        ? `${money(header.payments.ars)} + ${money(header.payments.usd, 'USD')}`
        : money(header.payments.ars),
      hint: t('coinify.stmtPaidHint', 'Salda el resumen del mes anterior si todavía figuraba pendiente.'),
    });
  }
  if (installmentPlans > 0) {
    facts.push({
      key: 'plans',
      label: t('coinify.stmtPlans', 'Compras en cuotas'),
      value: String(installmentPlans),
      hint: t('coinify.stmtPlansHint', 'Se crean los planes completos con su posición y las cuotas que faltan.'),
    });
  }

  return (
    <div className="rpg-card coin-stmt">
      <h3 className="coin-stmt__title">
        {t('coinify.stmtTitle', 'Esto leí de tu resumen')}
      </h3>
      <p className="coin-stmt__lede">
        {t('coinify.stmtLede', 'Revisá que esté bien y confirmá. No hace falta que tipees nada.')}
      </p>

      <dl className="coin-stmt__facts">
        {facts.map((fact) => (
          <div key={fact.key} className="coin-stmt__fact" title={fact.hint}>
            <dt className="coin-stmt__fact-label">{fact.label}</dt>
            <dd className="coin-stmt__fact-value">{fact.value}</dd>
          </div>
        ))}
      </dl>

      {/* El cierre sale de dos lugares del papel (la fila de fechas y el código
          de barras). Si no coinciden, se dice — antes no se leía ninguno. */}
      {header.closingDateAgrees === false && (
        <p className="coin-stmt__note coin-stmt__note--warn">
          {t('coinify.stmtClosingMismatch', 'La fecha de cierre del encabezado no coincide con la del pie del resumen. Revisá el período antes de confirmar.')}
        </p>
      )}

      {/* La conciliación: el checksum firmado por el banco. */}
      {status === 'ok' && (
        <p className="coin-stmt__recon coin-stmt__recon--ok">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" /><path d="M8 12.5l3 3 5-6" />
          </svg>
          {t('coinify.stmtReconOk', 'Cierra exacto con el total del banco.')}
        </p>
      )}
      {status === 'off' && recon && (
        <div className="coin-stmt__recon coin-stmt__recon--off">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 4l9 16H3z" /><path d="M12 10v4" /><path d="M12 17.5v.01" />
          </svg>
          <span>
            {t('coinify.stmtReconOff', 'No cierra con el total del banco.')}{' '}
            {recon.ars.ok === false && recon.ars.difference != null && (
              <>{t('coinify.stmtReconDiff', 'Diferencia en pesos: {{diff}}.', { diff: formatCurrency(recon.ars.difference, { currency: 'ARS' }) })} </>
            )}
            {recon.usd.ok === false && recon.usd.difference != null && (
              <>{t('coinify.stmtReconDiffUsd', 'Diferencia en dólares: {{diff}}.', { diff: formatCurrency(recon.usd.difference, { currency: 'USD' }) })} </>
            )}
            {t('coinify.stmtReconOffHint', 'Suele ser por filas desmarcadas. Podés importar igual: queda registrado que no cerró.')}
          </span>
        </div>
      )}
      {status === 'none' && (
        <p className="coin-stmt__note">
          {/* «Sin checksum» no es «cierra». Decir la diferencia es el punto. */}
          {t('coinify.stmtReconNone', 'Este resumen no trae los totales que hacen falta para verificar el import.')}
        </p>
      )}
    </div>
  );
}
