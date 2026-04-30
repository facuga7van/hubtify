import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronUp, ChevronDown } from '../../../../shared/components/icons';

interface CryptoRate {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  price_change_percentage_24h: number | null;
  image: string;
}

const GearIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

function formatPrice(price: number): string {
  if (price >= 1) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 0.01) return price.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  return price.toLocaleString('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 6 });
}

export function CryptoChip() {
  const { t } = useTranslation();
  const [allRates, setAllRates] = useState<CryptoRate[]>([]);
  const [visibleTypes, setVisibleTypes] = useState<string[]>([]);
  const [configMode, setConfigMode] = useState(false);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const loadData = useCallback(async () => {
    try {
      const [ratesRes, visible] = await Promise.all([
        window.api.cryptoGetRates(),
        window.api.cryptoGetVisibleTypes(),
      ]);
      if (ratesRes.success && ratesRes.rates) {
        setAllRates(ratesRes.rates as CryptoRate[]);
      }
      setVisibleTypes(visible);
    } catch (err) {
      console.warn('[CryptoChip] loadData failed:', err);
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
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const visibleRates = allRates.filter((r) => visibleTypes.includes(r.id));

  if (allRates.length === 0) return null;

  const featured = visibleRates.find((r) => r.id === 'bitcoin') || visibleRates[0];
  if (!featured) return null;

  const toggleType = async (id: string) => {
    let next: string[];
    if (visibleTypes.includes(id)) {
      if (visibleTypes.length <= 1) return;
      next = visibleTypes.filter((t) => t !== id);
    } else {
      next = [...visibleTypes, id];
    }
    setVisibleTypes(next);
    await window.api.cryptoSetVisibleTypes(next);
  };

  const filteredRates = search
    ? allRates.filter(
        (r) =>
          r.name.toLowerCase().includes(search.toLowerCase()) ||
          r.symbol.toLowerCase().includes(search.toLowerCase()),
      )
    : allRates;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="rpg-button"
        onClick={() => { setOpen(!open); if (open) { setConfigMode(false); setSearch(''); } }}
        style={{ fontSize: 'var(--fs-label)', padding: '3px 8px', display: 'flex', alignItems: 'center', gap: 4 }}
      >
        <img src={featured.image} alt="" width={14} height={14} style={{ borderRadius: '50%' }} />
        <span style={{ fontFamily: "'Fira Code', monospace", fontWeight: 600 }}>
          {featured.symbol.toUpperCase()} ${formatPrice(featured.current_price)}
        </span>
        {open ? <ChevronUp style={{ width: 8, height: 8 }} /> : <ChevronDown style={{ width: 8, height: 8 }} />}
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 100,
          background: 'var(--parch-0)', border: '2px solid var(--gold-dark)',
          borderRadius: '6px', boxShadow: '0 2px 8px rgba(42, 29, 14, 0.35)', padding: 8,
          minWidth: 240,
        }}>
          {/* Header with gear toggle */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 4, paddingBottom: 4, borderBottom: '1px solid var(--gold-dark)',
          }}>
            <span style={{ fontSize: 'var(--fs-label)', fontWeight: 600, opacity: 0.7 }}>
              {configMode
                ? t('coinify.cryptoConfigTitle', 'Configurar cryptos')
                : t('coinify.cryptoRatesTitle', 'Cotizaciones crypto')}
            </span>
            <button
              onClick={() => { setConfigMode(!configMode); setSearch(''); }}
              style={{
                background: configMode ? 'var(--gold-dark)' : 'none', border: 'none', cursor: 'pointer',
                color: configMode ? 'var(--parch-0)' : 'currentColor', opacity: configMode ? 1 : 0.5,
                borderRadius: 4, padding: 2, display: 'flex', alignItems: 'center',
              }}
              title={t('coinify.cryptoConfigTitle', 'Configurar cryptos')}
            >
              <GearIcon />
            </button>
          </div>

          {configMode ? (
            /* ── Config mode: search + checkboxes ── */
            <>
              <input
                type="text"
                className="rpg-input"
                placeholder={t('coinify.cryptoSearch', 'Buscar crypto...')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  width: '100%', marginBottom: 4, padding: '3px 6px',
                  fontSize: 'var(--fs-label)', boxSizing: 'border-box',
                }}
                autoFocus
              />
              <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                {filteredRates.map((rate) => {
                  const checked = visibleTypes.includes(rate.id);
                  const isLast = checked && visibleTypes.length === 1;
                  return (
                    <label
                      key={rate.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0',
                        fontSize: 'var(--fs-label)', cursor: isLast ? 'not-allowed' : 'pointer',
                        borderBottom: '1px solid var(--parch-1)', opacity: isLast ? 0.5 : 1,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={isLast}
                        onChange={() => toggleType(rate.id)}
                        style={{ accentColor: 'var(--rpg-gold)' }}
                      />
                      <img src={rate.image} alt="" width={14} height={14} style={{ borderRadius: '50%' }} />
                      <span style={{ flex: 1 }}>{rate.name}</span>
                      <span style={{ opacity: 0.5, textTransform: 'uppercase', fontSize: '0.85em' }}>
                        {rate.symbol}
                      </span>
                    </label>
                  );
                })}
              </div>
            </>
          ) : (
            /* ── Normal mode: visible rates ── */
            visibleRates.map((rate) => {
              const change = rate.price_change_percentage_24h;
              return (
                <div key={rate.id} style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0',
                  fontSize: 'var(--fs-label)', borderBottom: '1px solid var(--parch-1)',
                }}>
                  <img src={rate.image} alt="" width={14} height={14} style={{ borderRadius: '50%' }} />
                  <span style={{ flex: 1, opacity: 0.8 }}>
                    {rate.symbol.toUpperCase()}
                  </span>
                  <span style={{ fontFamily: "'Fira Code', monospace", fontWeight: 600 }}>
                    ${formatPrice(rate.current_price)}
                  </span>
                  {change != null && (
                    <span style={{
                      fontFamily: "'Fira Code', monospace",
                      fontSize: '0.85em',
                      color: change >= 0 ? 'var(--rpg-xp-green)' : 'var(--rpg-hp-red)',
                      minWidth: 52,
                      textAlign: 'right',
                    }}>
                      {change >= 0 ? '+' : ''}{change.toFixed(1)}%
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
