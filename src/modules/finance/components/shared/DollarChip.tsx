import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronUp, ChevronDown } from '../../../../shared/components/icons';
import { useToast } from '../../../../shared/components/useToast';
import type { DisplayMode } from '../../utils/valuation';
import {
  DEFAULT_FX_HOUSE,
  backfillFxRates,
  cycleDisplayMode,
  getFxHouse,
  getInflationSeries,
  hasBackfillSupport,
  setFxHouse,
  useDisplayMode,
} from '../../utils/display-mode';

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
  const { toast } = useToast();
  const [allRates, setAllRates] = useState<Rate[]>([]);
  const [visibleTypes, setVisibleTypes] = useState<string[]>([]);
  const [configMode, setConfigMode] = useState(false);
  const [open, setOpen] = useState(false);
  const [fxHouse, setFxHouseState] = useState(DEFAULT_FX_HOUSE);
  /** Gates the "ARS de hoy" leg of the cycle: no IPC series, no lies. */
  const [inflationAvailable, setInflationAvailable] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const mode = useDisplayMode();
  const ref = useRef<HTMLDivElement>(null);

  const loadData = useCallback(async () => {
    try {
      const [ratesRes, visible, house] = await Promise.all([
        window.api.dollarGetRates(),
        window.api.dollarGetVisibleTypes(),
        getFxHouse(),
      ]);
      if (ratesRes.success && ratesRes.rates) {
        setAllRates(ratesRes.rates as Rate[]);
      }
      setVisibleTypes(visible);
      setFxHouseState(house);
    } catch (err) {
      console.warn('[DollarChip] loadData failed:', err);
    }
    getInflationSeries().then((series) => setInflationAvailable(series !== null && series.length > 0));
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

  const featured = allRates.find((r) => r.casa === fxHouse)
    || visibleRates.find((r) => r.casa === 'blue')
    || visibleRates[0]
    || allRates[0];
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

  const pickHouse = async (casa: string) => {
    setFxHouseState(casa);
    await setFxHouse(casa);
  };

  const handleBackfill = async () => {
    setBackfilling(true);
    try {
      const res = await backfillFxRates();
      if (res === null || res.ok === false) {
        toast({ type: 'warning', message: t('coinify.backfillFxError', 'No hay cotización disponible para completar') });
        return;
      }
      toast({
        type: 'success',
        message: t('coinify.backfillFxDone', '{{count}} movimientos con cotización congelada', { count: res.updated }),
      });
    } finally {
      setBackfilling(false);
    }
  };

  const MODE_LABELS: Record<DisplayMode, string> = {
    'ars': t('coinify.modeArs', 'ARS'),
    'usd': t('coinify.modeUsd', 'USD'),
    'ars-today': t('coinify.modeArsToday', 'ARS hoy'),
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div className="coin-mode-chip">
        {/* Master control: the chip stopped being an ornament. One click cycles
            how EVERY amount in Coinify reads: ARS → USD → ARS de hoy. */}
        <button
          className={`rpg-button coin-mode-chip__mode${mode !== 'ars' ? ' coin-mode-chip__mode--active' : ''}`}
          onClick={() => cycleDisplayMode(inflationAvailable)}
          title={t('coinify.modeToggleTitle', 'Cambiar moneda de lectura: ARS → USD → ARS de hoy')}
          aria-label={t('coinify.modeToggleTitle', 'Cambiar moneda de lectura: ARS → USD → ARS de hoy')}
        >
          <span style={{ fontFamily: "'Fira Code', monospace", fontWeight: 600 }}>
            {MODE_LABELS[mode]} · ${featured.venta.toLocaleString('es-AR')}
          </span>
        </button>
        <button
          className="rpg-button coin-mode-chip__menu-btn"
          onClick={() => { setOpen(!open); if (open) setConfigMode(false); }}
          aria-expanded={open}
          aria-label={t('coinify.dollarRatesTitle', 'Cotizaciones')}
          title={t('coinify.dollarRatesTitle', 'Cotizaciones')}
        >
          {open ? <ChevronUp style={{ width: 8, height: 8 }} /> : <ChevronDown style={{ width: 8, height: 8 }} />}
        </button>
      </div>
      {open && (
        <div className="coin-dollar-menu">
          {/* Header with gear toggle */}
          <div className="coin-dollar-menu__header">
            <span className="coin-dollar-menu__title">
              {configMode ? t('coinify.dollarConfigTitle', 'Configurar tipos') : t('coinify.dollarRatesTitle', 'Cotizaciones')}
            </span>
            <button
              onClick={() => setConfigMode(!configMode)}
              className={`coin-dollar-menu__config-btn${configMode ? ' coin-dollar-menu__config-btn--active' : ''}`}
              title={t('coinify.dollarConfigTitle', 'Configurar tipos')}
            >
              <GearIcon />
            </button>
          </div>

          {configMode ? (
            /* ── Config mode: visibility checkboxes + fx-house pick ── */
            <>
              {allRates.map((rate) => {
                const checked = visibleTypes.includes(rate.casa);
                const isLast = checked && visibleTypes.length === 1;
                const isHouse = rate.casa === fxHouse;
                const Icon = RATE_ICONS[rate.casa];
                return (
                  <label
                    key={rate.casa}
                    className={`coin-dollar-menu__row coin-dollar-menu__row--checkbox${isLast ? ' coin-dollar-menu__row--disabled' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={isLast}
                      onChange={() => toggleType(rate.casa)}
                      style={{ accentColor: 'var(--gold)' }}
                    />
                    {Icon && <Icon size={12} />}
                    <span style={{ flex: 1 }}>{rate.nombre}</span>
                    {/* Which casa freezes onto every new movement (fx_rate). */}
                    <button
                      type="button"
                      className={`coin-fx-house-pick${isHouse ? ' coin-fx-house-pick--active' : ''}`}
                      onClick={(e) => { e.preventDefault(); pickHouse(rate.casa); }}
                      title={t('coinify.fxHouseLabel', 'Usar esta cotización para convertir')}
                      aria-label={t('coinify.fxHouseLabel', 'Usar esta cotización para convertir')}
                      aria-pressed={isHouse}
                    >
                      {isHouse ? '◈' : '◇'}
                    </button>
                  </label>
                );
              })}
              {hasBackfillSupport() && (
                <button
                  type="button"
                  className="rpg-button coin-dollar-menu__backfill"
                  onClick={handleBackfill}
                  disabled={backfilling}
                >
                  {backfilling
                    ? t('coinify.generating', 'Generando...')
                    : t('coinify.backfillFx', 'Completar cotizaciones faltantes')}
                </button>
              )}
            </>
          ) : (
            /* ── Normal mode: visible rates ── */
            visibleRates.map((rate) => {
              const Icon = RATE_ICONS[rate.casa];
              return (
                <div key={rate.casa} className="coin-dollar-menu__row">
                  {Icon && <Icon size={12} />}
                  <span className="coin-dollar-menu__rate-label">{rate.nombre}</span>
                  <span className="coin-dollar-menu__rate-value">
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
