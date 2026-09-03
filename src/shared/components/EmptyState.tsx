import type { ReactNode } from 'react';
import { Scroll } from './icons/CodexIcons';
import '../styles/states.css';

interface Action {
  label: string;
  onClick: () => void;
}

interface Props {
  /** Ícono del hueco. Por defecto, un pergamino en blanco. */
  icon?: ReactNode;
  /** Título corto, en Fraktur. Opcional: en un hueco chico sobra. */
  title?: string;
  /** Qué falta y por qué. Una frase, no un párrafo. */
  message: ReactNode;
  /** La salida. Vive DENTRO del hueco, siempre. */
  action?: Action;
  /** Segunda salida, tenue (limpiar filtros, ver todos). */
  secondaryAction?: Action;
  /** Para tarjetas del tablero y desplegables: la mitad del aire. */
  compact?: boolean;
  className?: string;
}

/**
 * El hueco vacío compartido.
 *
 * La rúbrica C8 pide tres cosas y las pide JUNTAS: ilustración, frase y una
 * salida a mano. La app tenía doce clases `*-empty` y casi todas eran una frase
 * en itálica flotando sola —el vacío de Questify decía «¡Agregá una arriba!» con
 * el botón 120 px arriba y 240 a la izquierda—. Por eso el botón es hijo del
 * mismo `<div>` que la frase: la salida no se puede alejar del hueco.
 */
export default function EmptyState({
  icon,
  title,
  message,
  action,
  secondaryAction,
  compact = false,
  className,
}: Props) {
  const cls = [
    'hub-empty',
    compact ? 'hub-empty--compact' : '',
    className ?? '',
  ].filter(Boolean).join(' ');

  return (
    <div className={cls}>
      <span className="hub-empty__icon" aria-hidden="true">
        {icon ?? <Scroll width={compact ? 20 : 32} height={compact ? 20 : 32} />}
      </span>
      {title && <div className="hub-empty__title">{title}</div>}
      <p className="hub-empty__text">{message}</p>
      {action && (
        <button type="button" className="rpg-button hub-empty__cta" onClick={action.onClick}>
          {action.label}
        </button>
      )}
      {secondaryAction && (
        <button type="button" className="rpg-button hub-empty__cta" onClick={secondaryAction.onClick}>
          {secondaryAction.label}
        </button>
      )}
    </div>
  );
}
