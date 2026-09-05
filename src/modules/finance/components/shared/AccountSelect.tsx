import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_CASH_ACCOUNT_ID, type FinanceAccount } from '../../types';

/**
 * Account picker for the transaction forms.
 *
 * While there are no live accounts (or `finance:getAccounts` fails) the
 * component renders nothing and the forms behave exactly as before — the
 * backend then applies its own default mapping (cash → «Efectivo»).
 *
 * Select values: an account id, or {@link NO_ACCOUNT} for "sin cuenta".
 */

/** Sentinel select value for "sin cuenta" (submitted as `accountId: null`). */
export const NO_ACCOUNT = '__none__';

const LAST_ACCOUNT_KEY = 'coinify_last_account_id';

export function rememberLastAccountId(value: string): void {
  try { localStorage.setItem(LAST_ACCOUNT_KEY, value); } catch { /* ignore */ }
}

function readLastAccountId(): string {
  try { return localStorage.getItem(LAST_ACCOUNT_KEY) ?? ''; } catch { return ''; }
}

/** Select value → the `accountId` the IPC payload wants. */
export function accountIdForSubmit(value: string): string | null {
  return value === NO_ACCOUNT || value === '' ? null : value;
}

interface AccountSelectProps {
  /** '' = not resolved yet — the component picks the default once accounts load. */
  value: string;
  onChange: (value: string) => void;
  /** Reports whether the selector is actually usable (there are live accounts). */
  onSupported?: (supported: boolean) => void;
  /**
   * La cuenta que el historial propone (`finance:getEntryDefaults`), si hay.
   *
   * Entra ANTES del respaldo a «Efectivo»: ese respaldo es la cuenta que el
   * historial dice que la persona NO usa (`account_id` en NULL en las 107 filas
   * de la base real), así que ofrecerla antes que un hecho medido es al revés.
   * Sigue perdiendo contra lo recordado localmente, que es más específico.
   */
  seedAccountId?: string | null;
}

export function AccountSelect({ value, onChange, onSupported, seedAccountId }: AccountSelectProps) {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [supported, setSupported] = useState(false);
  // Latest callbacks without re-running the load effect on every parent render.
  const onChangeRef = useRef(onChange);
  const onSupportedRef = useRef(onSupported);
  onChangeRef.current = onChange;
  onSupportedRef.current = onSupported;
  const valueRef = useRef(value);
  valueRef.current = value;
  const seedRef = useRef(seedAccountId);
  seedRef.current = seedAccountId;
  /**
   * El valor actual salió del respaldo genérico («Efectivo» / «sin cuenta»), no
   * de una elección ni de lo recordado. Es lo ÚNICO que la semilla del historial
   * tiene derecho a pisar cuando llega tarde.
   */
  const usedGenericFallback = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      let live: FinanceAccount[] = [];
      try {
        live = ((await window.api.financeGetAccounts()) as unknown as FinanceAccount[]) ?? [];
      } catch (err) {
        console.error('[AccountSelect] financeGetAccounts failed:', err);
      }
      if (cancelled) return;
      const usable = live.length > 0;
      setAccounts(live);
      setSupported(usable);
      onSupportedRef.current?.(usable);
      if (!usable) return;

      // Resolve the default: the current value if still alive, else the last
      // account used, else the one the ledger infers, else the seeded
      // «Efectivo», else "sin cuenta".
      const alive = new Set(live.map((a) => a.id));
      const current = valueRef.current;
      if (current === NO_ACCOUNT || alive.has(current)) return;
      const last = readLastAccountId();
      if (last === NO_ACCOUNT || alive.has(last)) { usedGenericFallback.current = false; onChangeRef.current(last); return; }
      const seed = seedRef.current;
      if (seed && alive.has(seed)) { usedGenericFallback.current = false; onChangeRef.current(seed); return; }
      usedGenericFallback.current = true;
      onChangeRef.current(alive.has(DEFAULT_CASH_ACCOUNT_ID) ? DEFAULT_CASH_ACCOUNT_ID : NO_ACCOUNT);
    };

    load();
    const handler = () => { load(); };
    window.addEventListener('account:switched', handler);
    window.addEventListener('finance:accountsChanged', handler);
    return () => {
      cancelled = true;
      window.removeEventListener('account:switched', handler);
      window.removeEventListener('finance:accountsChanged', handler);
    };
  }, []);

  /**
   * La semilla llega DESPUÉS de que las cuentas cargaron —es otro viaje de IPC—,
   * así que para cuando aparece el select ya cayó en «Efectivo». Reintentar la
   * carga entera no alcanzaba: el primer paso ya había dejado un valor vivo y el
   * `alive.has(current)` de arriba corta antes de llegar a la semilla.
   *
   * Por eso este efecto es quirúrgico: pisa el respaldo genérico y NADA más.
   */
  useEffect(() => {
    if (!seedAccountId || !usedGenericFallback.current) return;
    if (!accounts.some((a) => a.id === seedAccountId)) return;
    usedGenericFallback.current = false;
    onChangeRef.current(seedAccountId);
  }, [seedAccountId, accounts]);

  if (!supported) return null;

  return (
    <select
      className="rpg-select coin-account-select"
      value={value === '' ? NO_ACCOUNT : value}
      aria-label={t('coinify.accountLabel', 'Cuenta')}
      title={t('coinify.accountLabel', 'Cuenta')}
      onChange={(e) => { usedGenericFallback.current = false; onChange(e.target.value); }}
    >
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>{a.name}</option>
      ))}
      <option value={NO_ACCOUNT}>{t('coinify.accountNone', 'Sin cuenta')}</option>
    </select>
  );
}
