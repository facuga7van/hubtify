import type { ReactNode } from 'react';
import type { PlayerStats } from '../../shared/types';

/** Lo que Layout le pasa a DesktopShell y a MobileShell por igual. */
export interface ShellProps {
  stats: PlayerStats | null;
  onBellClick: () => void;
  onToggleInn: () => void;
  children: ReactNode;
}
