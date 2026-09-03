import { useTranslation } from 'react-i18next';
import '../styles/states.css';

export type SkeletonVariant = 'line' | 'block' | 'card';

interface Props {
  /** Forma del hueco: renglón de texto, bloque de contenido o tarjeta entera. */
  variant?: SkeletonVariant;
  /** Cuántas barras. Cada una entra escalonada, como una lista que se llena. */
  count?: number;
  /** Ancho del grupo (por defecto ocupa lo que le den). */
  width?: number | string;
  /** Alto de cada barra, si la variante no alcanza. */
  height?: number | string;
  /** Lo que el lector de pantalla anuncia. Por defecto, «Cargando…». */
  label?: string;
  /** Última barra al 62 %, como el último renglón de un párrafo. */
  text?: boolean;
  className?: string;
}

/** Retardo entre barras: el mismo escalón de 100 ms que usa `TaskList`. */
const STEP_MS = 100;

/**
 * El esqueleto compartido.
 *
 * Un spinner dice «esperá»; un esqueleto dice «esperá, y lo que viene tiene
 * ESTA forma». La diferencia se nota justo cuando la carga tarda: el ojo ya
 * ubicó dónde va a estar cada cosa antes de que llegue.
 *
 * El shimmer sale de `.quest-skeleton`, el mejor de los cuatro dialectos que
 * había sueltos en el repo (ver `shared/styles/states.css`). No reemplaza a los
 * otros tres —eso tocaría cuatro módulos de una— pero es el único que se usa
 * donde antes no había NADA.
 */
export default function Skeleton({
  variant = 'line',
  count = 1,
  width,
  height,
  label,
  text = false,
  className,
}: Props) {
  const { t } = useTranslation();
  const cls = [
    'hub-skeleton-group',
    text ? 'hub-skeleton-group--text' : '',
    className ?? '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={cls}
      role="status"
      aria-busy="true"
      aria-live="polite"
      style={width !== undefined ? { width } : undefined}
    >
      {Array.from({ length: Math.max(1, count) }, (_, i) => (
        <span
          key={i}
          className={`hub-skeleton hub-skeleton--${variant}`}
          style={{
            animationDelay: `${i * STEP_MS}ms`,
            ...(height !== undefined ? { height } : null),
          }}
        />
      ))}
      <span className="hub-sr-only">{label ?? t('common.loading', 'Cargando...')}</span>
    </div>
  );
}
