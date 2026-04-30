import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronUp, ChevronDown } from '../../../../shared/components/icons';

interface Rate {
  casa: string;
  nombre: string;
  compra: number;
  venta: number;
}

const RATE_ICONS: Record<string, (props: { size?: number }) => ReactNode> = {
  oficial: ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 12h6M12 9v6" />
    </svg>
  ),
  blue: ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="10" /><path d="M12 6v12M8 10h8M8 14h8" />
    </svg>
  ),
  bolsa: ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  ),
  cripto: ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M9 8h6l-3 6h6" /><circle cx="12" cy="12" r="10" />
    </svg>
  ),
  tarjeta: ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="1" y="4" width="22" height="16" rx="2" /><path d="M1 10h22" />
    </svg>
  ),
  contadoconliqui: ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M2 20l4-4m0 0l4-8 4 4 8-10" /><path d="M18 2h4v4" />
    </svg>
  ),
  mayorista: ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a4 4 0 0 0-8 0v2" />
    </svg>
  ),
};

const GearIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

export function DollarChip() {
  const { t } = useTranslation();
  const [allRates, setAllRates] = useState<Rate[]>([]);
  const [visibleTypes, setVisibleTypes] = useState<string[]>([]);
  const [configMode, setConfigMode] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const loadData = useCallback(async () => {
    try {
      const [ratesRes, visible] = await Promise.all([
        window.api.dollarGetRates(),
        window.api.dollarGetVisibleTypes(),
      ]);
      if (ratesRes.success && ratesRes.rates) {
        setAllRates(ratesRes.rates as Rate[]);
      }
      setVisibleTypes(visible);
    } catch (err) {
      console.warn('[DollarChip] loadData failed:', err);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    const handler = () => loadData();
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
  }, [loadData]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setConfigMode(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const visibleRates = allRates.filter((r) => visibleTypes.includes(r.casa));

  if (allRates.length === 0) return null;

  const featured = visibleRates.find((r) => r.casa === 'blue') || visibleRates[0];
  if (!featured) return null;

  const toggleType = async (casa: string) => {
    let next: string[];
    if (visibleTypes.includes(casa)) {
      if (visibleTypes.length <= 1) return;
      next = visibleTypes.filter((t) => t !== casa);
    } else {
      next = [...visibleTypes, casa];
    }
    setVisibleTypes(next);
    await window.api.dollarSetVisibleTypes(next);
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="rpg-button"
        onClick={() => { setOpen(!open); if (open) setConfigMode(false); }}
        style={{ fontSize: 'var(--fs-label)', padding: '3px 8px', display: 'flex', alignItems: 'center', gap: 4 }}
      >
        <span style={{ fontFamily: "'Fira Code', monospace", fontWeight: 600 }}>
          USD ${featured.venta.toLocaleString('es-AR')}
        </span>
        {open ? <ChevronUp style={{ width: 8, height: 8 }} /> : <ChevronDown style={{ width: 8, height: 8 }} />}
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 100,
          background: 'var(--parch-0)', border: '2px solid var(--gold-dark)',
          borderRadius: '6px', boxShadow: '0 2px 8px rgba(42, 29, 14, 0.35)', padding: 8,
          minWidth: 200,
        }}>
          {/* Header with gear toggle */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 4, paddingBottom: 4, borderBottom: '1px solid var(--gold-dark)',
          }}>
            <span style={{ fontSize: 'var(--fs-label)', fontWeight: 600, opacity: 0.7 }}>
              {configMode ? t('coinify.dollarConfigTitle', 'Configurar tipos') : t('coinify.dollarRatesTitle', 'Cotizaciones')}
            </span>
            <button
              onClick={() => setConfigMode(!configMode)}
              style={{
                background: configMode ? 'var(--gold-dark)' : 'none', border: 'none', cursor: 'pointer',
                color: configMode ? 'var(--parch-0)' : 'currentColor', opacity: configMode ? 1 : 0.5,
                borderRadius: 4, padding: 2, display: 'flex', alignItems: 'center',
              }}
              title={t('coinify.dollarConfigTitle', 'Configurar tipos')}
            >
              <GearIcon />
            </button>
          </div>

          {configMode ? (
            /* ── Config mode: checkboxes for all types ── */
            allRates.map((rate) => {
              const checked = visibleTypes.includes(rate.casa);
              const isLast = checked && visibleTypes.length === 1;
              const Icon = RATE_ICONS[rate.casa];
              return (
                <label
                  key={rate.casa}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0',
                    fontSize: 'var(--fs-label)', cursor: isLast ? 'not-allowed' : 'pointer',
                    borderBottom: '1px solid var(--parch-1)', opacity: isLast ? 0.5 : 1,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={isLast}
                    onChange={() => toggleType(rate.casa)}
                    style={{ accentColor: 'var(--rpg-gold)' }}
                  />
                  {Icon && <Icon size={12} />}
                  <span>{rate.nombre}</span>
                </label>
              );
            })
          ) : (
            /* ── Normal mode: visible rates ── */
            visibleRates.map((rate) => {
              const Icon = RATE_ICONS[rate.casa];
              return (
                <div key={rate.casa} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0',
                  fontSize: 'var(--fs-label)', borderBottom: '1px solid var(--parch-1)',
                }}>
                  {Icon && <Icon size={12} />}
                  <span style={{ flex: 1, opacity: 0.8 }}>{rate.nombre}</span>
                  <span style={{ fontFamily: "'Fira Code', monospace", fontWeight: 600 }}>
                    ${rate.venta.toLocaleString('es-AR')}
                  </span>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
