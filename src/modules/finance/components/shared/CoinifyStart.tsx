import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

interface Props {
  /** «Prefiero cargarlo a mano»: la salida secundaria, siempre disponible. */
  onManual?: () => void;
}

/**
 * El arranque de Coinify. **Un solo camino.**
 *
 * El módulo no tenía ni un paso de onboarding — Nutrify tiene uno entero, con
 * seis campos y cálculo de TDEE. Coinify, el más grande de la app por un factor
 * de dos (13 tablas, 70 canales), arrancaba en un panel de seis gráficos en
 * cero y seis pestañas, sin decir por dónde empezar.
 *
 * Dos patrones de la investigación, aplicados literalmente:
 *  - **Monarch**: tras el alta, un único botón visible y el resto corrido.
 *  - **NN/g**: el estado vacío ES el onboarding, no un vacío; y el aprendizaje
 *    en contexto le gana al tutorial forzado.
 *
 * Y lo que NO se pide, a propósito: categorías, cuentas, tarjetas,
 * presupuestos. Se infieren del resumen o se corrigen después.
 */
export default function CoinifyStart({ onManual }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="rpg-card coin-start">
      <svg className="coin-start__icon" width="40" height="40" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 3h9l4 4v14H6z" />
        <path d="M15 3v4h4" />
        <path d="M9 12h6M9 15h6M9 18h3" />
      </svg>

      <h2 className="coin-start__title">{t('coinify.startTitle', 'Empezá por tu resumen')}</h2>
      <p className="coin-start__lede">
        {t('coinify.startLede', 'Importá el PDF del resumen de tu tarjeta y Coinify saca solo la tarjeta, el período, el cierre, el vencimiento, las cuotas en curso y el total del mes. Vos confirmás.')}
      </p>

      <button
        type="button"
        className="rpg-button coin-start__cta"
        onClick={() => navigate('/finance/import')}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3v12" /><path d="M7 10l5 5 5-5" /><path d="M4 20h16" />
        </svg>
        {t('coinify.startCta', 'Importar mi resumen')}
      </button>

      {/* Nunca un embudo sin salida: el que no tiene resumen a mano igual entra. */}
      <button
        type="button"
        className="coin-start__secondary"
        onClick={() => (onManual ? onManual() : navigate('/finance/transactions'))}
      >
        {t('coinify.startSecondary', 'Prefiero cargar un movimiento a mano')}
      </button>

      <p className="coin-start__note">
        {t('coinify.startNote', 'También podés empezar a mano e importar después. Nada de esto se pierde.')}
      </p>
    </div>
  );
}
