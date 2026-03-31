import { useState, useEffect, type ReactNode } from 'react';
import Tooltip from '../../../../shared/components/Tooltip';

interface Rate {
  nombre: string;
  compra: number;
  venta: number;
}

const HIDDEN_RATES = ['Contado con liquidación', 'Mayorista'];

const RATE_ICONS: Record<string, (props: { size?: number }) => ReactNode> = {
  Oficial: ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 12h6M12 9v6" />
    </svg>
  ),
  Blue: ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="10" /><path d="M12 6v12M8 10h8M8 14h8" />
    </svg>
  ),
  Bolsa: ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  ),
  Cripto: ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M9 8h6l-3 6h6" /><circle cx="12" cy="12" r="10" />
    </svg>
  ),
  Tarjeta: ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="1" y="4" width="22" height="16" rx="2" /><path d="M1 10h22" />
    </svg>
  ),
};

export function DollarChip() {
  const [rates, setRates] = useState<Rate[]>([]);

  useEffect(() => {
    window.api.dollarGetRates().then((res) => {
      if (res.success && res.rates) {
        setRates((res.rates as Rate[]).filter((r) => !HIDDEN_RATES.includes(r.nombre)));
      }
    });
  }, []);

  if (rates.length === 0) return null;

  return (
    <div className="coin-dollar-strip">
      {rates.map((rate) => {
        const Icon = RATE_ICONS[rate.nombre];
        return (
          <Tooltip key={rate.nombre} text={`${rate.nombre} — Compra: $${rate.compra.toLocaleString('es-AR')} / Venta: $${rate.venta.toLocaleString('es-AR')}`}>
            <div className="coin-dollar-chip">
              {Icon ? <Icon /> : null}
              <span className="coin-dollar-chip__value">${rate.venta.toLocaleString('es-AR')}</span>
            </div>
          </Tooltip>
        );
      })}
    </div>
  );
}
