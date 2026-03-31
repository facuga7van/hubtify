import { type ReactNode } from 'react';
import { AnimatedNumber } from './AnimatedNumber';

interface CoinStatCardProps {
  icon: ReactNode;
  label: string;
  value: number;
  color?: 'red' | 'green' | 'gold';
  prefix?: string;
  locale?: string;
}

export function CoinStatCard({
  icon,
  label,
  value,
  color = 'gold',
  prefix = '$',
  locale,
}: CoinStatCardProps) {
  const colorClass = `coin-stat__number--${color}`;

  return (
    <div className="coin-stat">
      <div className="coin-stat__icon">{icon}</div>
      <AnimatedNumber
        value={value}
        prefix={prefix}
        locale={locale}
        className={`coin-stat__number ${colorClass}`}
      />
      <div className="coin-stat__label">{label}</div>
    </div>
  );
}
