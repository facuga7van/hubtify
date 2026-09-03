import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { WarningTriangle } from './icons/CodexIcons';
import '../styles/states.css';

interface Props {
  /** Qué falló, en palabras de persona. Por defecto, la frase del sistema. */
  message?: ReactNode;
  /** El detalle técnico, en voz baja. Para el que sepa leerlo. */
  detail?: string | null;
  /** La puerta de vuelta. Sin esto no se dibuja ningún botón muerto. */
  onRetry?: () => void;
  /** Texto del botón, si «Intentar de nuevo» no encaja. */
  retryLabel?: string;
  /** Para tarjetas del tablero y desplegables. */
  compact?: boolean;
  className?: string;
}

/**
 * El error compartido.
 *
 * El peor pecado de C8 en esta app era que el ERROR se disfrazaba de VACÍO: el
 * widget de rituales hacía `console.error` y después pintaba «Sin rituales
 * configurados», o sea le decía al usuario que no tenía hábitos cuando lo que
 * había pasado es que la consulta se cayó. Un vacío dice «todavía no hay»; esto
 * dice «lo pedí y no vino», y ofrece pedirlo de nuevo.
 */
export default function ErrorState({
  message,
  detail,
  onRetry,
  retryLabel,
  compact = false,
  className,
}: Props) {
  const { t } = useTranslation();
  const cls = [
    'hub-error',
    compact ? 'hub-error--compact' : '',
    className ?? '',
  ].filter(Boolean).join(' ');

  return (
    <div className={cls} role="alert">
      <span className="hub-error__icon" aria-hidden="true">
        <WarningTriangle width={compact ? 18 : 28} height={compact ? 18 : 28} />
      </span>
      <p className="hub-error__text">
        {message ?? t('common.loadFailed', 'No se pudo cargar esta parte.')}
      </p>
      {detail && <p className="hub-error__detail">{detail}</p>}
      {onRetry && (
        <button type="button" className="rpg-button hub-error__retry" onClick={onRetry}>
          {retryLabel ?? t('common.tryAgain', 'Intentar de nuevo')}
        </button>
      )}
    </div>
  );
}
