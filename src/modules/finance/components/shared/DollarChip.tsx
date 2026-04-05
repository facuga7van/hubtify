import { useState, useEffect, useRef, type ReactNode } from 'react';

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

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (rates.length === 0) return null;

  // Find the "Blue" rate as the featured one (most commonly used in Argentina)
  const featured = rates.find((r) => r.nombre === 'Blue') || rates[0];

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="rpg-button"
        onClick={() => setOpen(!open)}
        style={{ fontSize: '0.75rem', padding: '3px 8px', display: 'flex', alignItems: 'center', gap: 4 }}
      >
        <span style={{ fontFamily: "'Fira Code', monospace", fontWeight: 600 }}>
          USD ${featured.venta.toLocaleString('es-AR')}
        </span>
        <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d={open ? 'M2 7l3-3 3 3' : 'M2 3l3 3 3-3'} />
        </svg>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 100,
          background: 'var(--rpg-parchment)', border: '2px solid var(--rpg-gold-dark)',
          borderRadius: 'var(--rpg-radius)', boxShadow: 'var(--rpg-shadow)', padding: 8,
          minWidth: 180,
        }}>
          {rates.map((rate) => {
            const Icon = RATE_ICONS[rate.nombre];
            return (
              <div key={rate.nombre} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0',
                fontSize: '0.78rem', borderBottom: '1px solid var(--rpg-parchment-dark)',
              }}>
                {Icon && <Icon size={12} />}
                <span style={{ flex: 1, opacity: 0.7 }}>{rate.nombre}</span>
                <span style={{ fontFamily: "'Fira Code', monospace", fontWeight: 600 }}>
                  ${rate.venta.toLocaleString('es-AR')}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
