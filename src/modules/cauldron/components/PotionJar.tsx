import { memo, useId } from 'react';
import { UNLABELED_POTION_COLOR } from '../types';

/**
 * Cuatro siluetas de frasco. Un estante de un solo molde repetido se lee como
 * una grilla de checkboxes; cuatro moldes se leen como una repisa.
 *
 * La variante sale del hash del id de la sesión: es estable para siempre (el
 * mismo frasco nunca cambia de forma entre renders ni entre dispositivos) y no
 * necesita ninguna columna nueva.
 */
const BODIES = [
  // 0 — matraz redondo
  'M20 21 C29 21 34 29 34 38 C34 47 28 52 20 52 C12 52 6 47 6 38 C6 29 11 21 20 21 Z',
  // 1 — probeta alta
  'M11 22 H29 V47 C29 50 27 52 24 52 H16 C13 52 11 50 11 47 Z',
  // 2 — cónico
  'M17 22 H23 L33 48 C34 50 32 52 30 52 H10 C8 52 6 50 7 48 Z',
  // 3 — panzón con hombros
  'M13 22 H27 L31 30 C33 35 33 44 28 48 C24 51 16 51 12 48 C7 44 7 35 9 30 Z',
];

/** Hash estable de un id a una de las siluetas. */
export function jarVariant(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % BODIES.length;
}

export interface PotionJarProps {
  /** Id de la sesión — determina la silueta. */
  id: string;
  /** Color del proyecto de la misión vinculada. Sin misión: gris-neutro. */
  color?: string | null;
  /** Frasco roto: silueta quebrada y tono apagado. Memoria, no acusación. */
  broken?: boolean;
  /**
   * Registrada a mano, después de ocurrir: borde punteado. Se distingue —
   * el estante no miente — pero no se castiga: mismo color, misma opacidad.
   */
  retroactive?: boolean;
  title?: string;
  size?: number;
}

function PotionJarComponent({ id, color, broken = false, retroactive = false, title, size = 44 }: PotionJarProps) {
  const uid = useId().replace(/:/g, '');
  const variant = jarVariant(id);
  const body = BODIES[variant];
  const tint = color || UNLABELED_POTION_COLOR;

  // El roto NO usa rojo: un frasco roto es memoria, no una acusación. Conserva
  // un rastro del color del proyecto para seguir siendo identificable, sobre una
  // base apagada.
  const fill = broken ? `url(#${uid}-broken)` : `url(#${uid}-liquid)`;

  return (
    <svg
      className={`cauldron-jar${broken ? ' cauldron-jar--broken' : ''}${retroactive ? ' cauldron-jar--retro' : ''}`}
      width={size}
      height={size * 1.4}
      viewBox="0 0 40 56"
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
    >
      {title && <title>{title}</title>}
      <defs>
        <linearGradient id={`${uid}-liquid`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={tint} stopOpacity="0.95" />
          <stop offset="100%" stopColor={tint} stopOpacity="0.6" />
        </linearGradient>
        <linearGradient id={`${uid}-broken`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={tint} stopOpacity="0.3" />
          <stop offset="100%" stopColor="#5c554c" stopOpacity="0.45" />
        </linearGradient>
        {/* El corte: un borde dentado a media altura. Todo lo que quede arriba
            simplemente no se dibuja — el frasco está partido, no manchado. */}
        <clipPath id={`${uid}-shatter`}>
          <path d="M0 33 L6 37 L11 30 L17 36 L23 29 L29 36 L35 31 L40 35 L40 56 L0 56 Z" />
        </clipPath>
      </defs>

      {/* Corcho y cuello — solo en los enteros: lo primero que se pierde. */}
      {!broken && (
        <>
          <rect x="16" y="6" width="8" height="6" rx="1.5" fill="#6b4f2a" />
          <path d="M15 12 H25 L24 22 H16 Z" fill="rgba(60,48,36,0.55)" />
        </>
      )}

      {/* Retroactiva: el vidrio es «de memoria», el contorno va punteado. */}
      <g clipPath={broken ? `url(#${uid}-shatter)` : undefined}>
        <path
          d={body}
          fill={fill}
          stroke="rgba(40,30,20,0.55)"
          strokeWidth="1.2"
          strokeDasharray={retroactive ? '3 2.2' : undefined}
        />
      </g>

      {broken ? (
        <>
          {/* Esquirlas sueltas — lo que saltó del corte. */}
          <path d="M9 26 L13 22 L14 28 Z" fill="#5c554c" opacity="0.55" />
          <path d="M27 24 L31 27 L26 29 Z" fill="#5c554c" opacity="0.45" />
          {/* Una grieta que baja desde el borde. */}
          <path
            d="M20 34 L18 40 L22 44 L20 50"
            fill="none"
            stroke="rgba(40,30,20,0.45)"
            strokeWidth="1"
            strokeLinecap="round"
          />
        </>
      ) : (
        // Brillo del vidrio.
        <path
          d="M12 30 C12 26 14 24 16 24"
          fill="none"
          stroke="rgba(255,255,255,0.5)"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

export default memo(PotionJarComponent);
