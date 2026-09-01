import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getAccounts, hasAccountsSupport } from '../../utils/api-ext';
import { DEFAULT_CASH_ACCOUNT_ID, type FinanceAccount } from '../../types';

/**
 * Account picker for the transaction forms.
 *
 * Feature-detected end to end: while `finance:getAccounts` is not on the
 * context bridge (or there are no live accounts) the component renders nothing
 * and the forms behave exactly as before — the backend then applies its own
 * default mapping (cash → «Efectivo»).
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
  /** Reports whether the selector is actually usable (bridge + accounts). */
  onSupported?: (supported: boolean) => void;
}

export function AccountSelect({ value, onChange, onSupported }: AccountSelectProps) {
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

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!hasAccountsSupport()) {
        if (!cancelled) { setSupported(false); onSupportedRef.current?.(false); }
        return;
      }
      const rows = await getAccounts();
      if (cancelled) return;
      const live = rows ?? [];
      const usable = live.length > 0;
      setAccounts(live);
      setSupported(usable);
      onSupportedRef.current?.(usable);
      if (!usable) return;

      // Resolve the default: the current value if still alive, else the last
      // account used, else the seeded «Efectivo», else "sin cuenta".
      const alive = new Set(live.map((a) => a.id));
      const current = valueRef.current;
      if (current === NO_ACCOUNT || alive.has(current)) return;
      const last = readLastAccountId();
      if (last === NO_ACCOUNT || alive.has(last)) { onChangeRef.current(last); return; }
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

  if (!supported) return null;

  return (
    <select
      className="rpg-select coin-account-select"
      value={value === '' ? NO_ACCOUNT : value}
      aria-label={t('coinify.accountLabel', 'Cuenta')}
      title={t('coinify.accountLabel', 'Cuenta')}
      onChange={(e) => onChange(e.target.value)}
    >
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>{a.name}</option>
      ))}
      <option value={NO_ACCOUNT}>{t('coinify.accountNone', 'Sin cuenta')}</option>
    </select>
  );
}
