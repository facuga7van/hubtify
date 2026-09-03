import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../../../shared/components/useToast';
import { AccountSelect, NO_ACCOUNT, accountIdForSubmit, rememberLastAccountId } from './AccountSelect';
import { formatCurrency } from '../../utils/format';
import { CATEGORIES } from '../../types';

type Field = 'date' | 'description' | 'amount' | 'currency' | 'category' | 'ignore';

interface ParsedTable {
  fileName: string;
  delimiter: string;
  decimalSeparator: ',' | '.';
  headers: string[];
  rows: string[][];
  suggested: Record<number, string>;
}

interface Draft {
  date: string;
  description: string;
  amount: number;
  currency: 'ARS' | 'USD';
  category: string;
  raw: number;
}

const FIELDS: Field[] = ['date', 'description', 'amount', 'currency', 'category', 'ignore'];

/**
 * El mapeo de columnas se recuerda por FIRMA DE ENCABEZADO, en `localStorage`.
 *
 * Es conveniencia de dispositivo, no dato del usuario: perderlo cuesta cuatro
 * clics. Meterlo en una tabla sincronizada costaría alta en `USER_DATA_TABLES`,
 * get, merge y tombstones para algo que nunca va a divergir entre dispositivos.
 */
const MAPPING_KEY = 'hubtify_finance_table_mappings';

function signatureOf(headers: string[]): string {
  return headers.map((h) => h.trim().toLowerCase()).join('|');
}

function readRememberedMapping(headers: string[]): Record<number, Field> | null {
  try {
    const store = JSON.parse(localStorage.getItem(MAPPING_KEY) ?? '{}') as Record<string, Record<number, Field>>;
    return store[signatureOf(headers)] ?? null;
  } catch { return null; }
}

function rememberMapping(headers: string[], mapping: Record<number, Field>): void {
  try {
    const store = JSON.parse(localStorage.getItem(MAPPING_KEY) ?? '{}') as Record<string, unknown>;
    store[signatureOf(headers)] = mapping;
    localStorage.setItem(MAPPING_KEY, JSON.stringify(store));
  } catch { /* cuota llena: el mapeo se vuelve a elegir, no se rompe nada */ }
}

interface Props {
  onImported?: (count: number) => void;
}

/**
 * **Importar un extracto de billetera o banco (CSV / TSV).**
 *
 * El resumen de tarjeta resuelve el setup y las cuotas, pero no trae ni una
 * transferencia — y ahí está el 67 % de lo que el usuario cargaba a mano, mes a
 * mes. Esta es la pieza que baja el costo de RÉGIMEN, no el de setup.
 *
 * Y a diferencia del PDF, **funciona en Android hoy**: `pickTextFile` ya está
 * implementado con `<input type="file">` en `platform-host.ts`.
 */
export default function TableImport({ onImported }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();

  const [table, setTable] = useState<ParsedTable | null>(null);
  const [mapping, setMapping] = useState<Record<number, Field>>({});
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [skipped, setSkipped] = useState<Array<{ line: number; reason: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [account, setAccount] = useState('');
  const [accountsSupported, setAccountsSupported] = useState(false);
  const [negativeIsExpense, setNegativeIsExpense] = useState(true);
  const [done, setDone] = useState<number | null>(null);

  const supported = typeof (window.api as unknown as Record<string, unknown>)
    .financeImportSelectAndParseTable === 'function';

  const reset = useCallback(() => {
    setTable(null); setMapping({}); setDrafts([]); setSkipped([]); setDone(null);
  }, []);

  // Otra cuenta, otro extracto: nada de la anterior sobrevive al cambio.
  useEffect(() => {
    window.addEventListener('account:switched', reset);
    return () => window.removeEventListener('account:switched', reset);
  }, [reset]);

  const applyMapping = useCallback(async (parsed: ParsedTable, next: Record<number, Field>) => {
    const api = window.api as unknown as {
      financeImportApplyTableMapping: (
        table: Record<string, unknown>, mapping: Record<number, string>, defaults?: Record<string, unknown>,
      ) => Promise<{ rows: Draft[]; skipped: Array<{ line: number; reason: string }> }>;
    };
    // El parseo vive UNA sola vez, en el backend: el mapeo cambia por acción del
    // usuario (un select), no por tecla, así que el viaje IPC no cuesta nada.
    const result = await api.financeImportApplyTableMapping(
      { headers: parsed.headers, rows: parsed.rows, decimalSeparator: parsed.decimalSeparator, delimiter: parsed.delimiter },
      next as unknown as Record<number, string>,
    );
    setDrafts(result.rows ?? []);
    setSkipped(result.skipped ?? []);
  }, []);

  const handlePick = async () => {
    reset();
    setBusy(true);
    try {
      const api = window.api as unknown as {
        financeImportSelectAndParseTable: () => Promise<ParsedTable | { ok: false; reason: string } | null>;
      };
      const result = await api.financeImportSelectAndParseTable();
      if (!result) return;
      if ('ok' in result) {
        toast({ type: 'warning', message: t('coinify.tableUnreadable', 'No pude leer ese archivo como una tabla. Tiene que tener una fila de encabezados y al menos dos columnas.') });
        return;
      }
      setTable(result);
      // El mapeo que el usuario ya confirmó para este mismo encabezado gana
      // sobre el sugerido: la segunda importación del mismo origen es un clic.
      const next = readRememberedMapping(result.headers)
        ?? (result.suggested as unknown as Record<number, Field>);
      setMapping(next);
      await applyMapping(result, next);
    } catch (err) {
      console.error('[TableImport] no se pudo leer la tabla:', err);
      toast({ type: 'warning', message: t('coinify.tableError', 'No se pudo leer el archivo') });
    } finally {
      setBusy(false);
    }
  };

  const changeField = async (index: number, field: Field) => {
    if (!table) return;
    const next = { ...mapping, [index]: field };
    setMapping(next);
    await applyMapping(table, next);
  };

  const totals = useMemo(() => {
    let out = 0;
    let inflow = 0;
    for (const d of drafts) {
      const isExpense = negativeIsExpense ? d.raw < 0 : d.raw > 0;
      if (d.currency !== 'ARS') continue;
      if (isExpense) out += d.amount; else inflow += d.amount;
    }
    return { out, inflow };
  }, [drafts, negativeIsExpense]);

  const handleConfirm = async () => {
    if (!table || drafts.length === 0) return;
    setBusy(true);
    try {
      if (accountsSupported) rememberLastAccountId(account === '' ? NO_ACCOUNT : account);
      const api = window.api as unknown as {
        financeImportConfirmTable: (rows: unknown[], options: Record<string, unknown>) => Promise<
          { count: number; duplicateCount: number; skipped: number } | { ok: false; reason: string }
        >;
      };
      const result = await api.financeImportConfirmTable(drafts, {
        fileName: table.fileName,
        accountId: accountsSupported ? accountIdForSubmit(account) : null,
        negativeIsExpense,
      });
      if ('ok' in result) {
        toast({ type: 'warning', message: t('coinify.tableImportError', 'No se pudo importar el extracto') });
        return;
      }
      // El mapeo se recuerda recién al CONFIRMAR: si no llegó a importarse,
      // tampoco vale la pena recordar cómo se pensaba mapear.
      rememberMapping(table.headers, mapping);
      setDone(result.count);
      setTable(null); setDrafts([]);
      onImported?.(result.count);
      window.dispatchEvent(new Event('finance:dataChanged'));
      toast({ type: 'coin', message: t('coinify.tableImported', '{{count}} movimientos importados', { count: result.count }) });
      if (result.duplicateCount > 0) {
        toast({ type: 'info', message: t('coinify.importDuplicatesSkipped', { count: result.duplicateCount }) });
      }
    } finally {
      setBusy(false);
    }
  };

  if (!supported) return null;

  return (
    <div className="coin-table-import">
      <h3 className="coin-table-import__title">
        {t('coinify.tableTitle', 'Extracto de billetera o banco')}
      </h3>
      <p className="coin-table-import__lede">
        {t('coinify.tableLede', 'Un CSV de tu billetera (Mercado Pago, Belo, Cuenta DNI…) o del homebanking. Coinify adivina las columnas y vos corregís lo que haga falta — la próxima vez ya se acuerda.')}
      </p>

      <button className="rpg-button" onClick={handlePick} disabled={busy}>
        {t('coinify.tablePick', 'Elegir archivo CSV')}
      </button>

      {table && (
        <>
          <p className="coin-table-import__file">{table.fileName}</p>

          <div className="coin-table-import__mapping">
            {table.headers.map((headerLabel, index) => (
              <label key={index} className="coin-table-import__col">
                <span className="coin-table-import__col-name" title={headerLabel}>{headerLabel || `#${index + 1}`}</span>
                <select
                  className="rpg-select"
                  value={mapping[index] ?? 'ignore'}
                  onChange={(e) => changeField(index, e.target.value as Field)}
                  aria-label={t('coinify.tableColumnRole', 'Qué es la columna «{{name}}»', { name: headerLabel || index + 1 })}
                >
                  {FIELDS.map((f) => (
                    <option key={f} value={f}>{t(`coinify.tableField_${f}`, f)}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <label className="coin-table-import__sign">
            <input
              type="checkbox"
              checked={negativeIsExpense}
              onChange={(e) => setNegativeIsExpense(e.target.checked)}
            />
            {/* Cada proveedor firma los importes al revés del otro; adivinarlo
                da un mes entero de ingresos donde había gastos. */}
            {t('coinify.tableNegativeIsExpense', 'Los importes negativos son gastos')}
          </label>

          {accountsSupported !== false && (
            <div className="coin-table-import__account">
              <span className="coin-import-card__label">{t('coinify.importAccount', 'Cuenta de los movimientos')}</span>
              <AccountSelect value={account} onChange={setAccount} onSupported={setAccountsSupported} />
            </div>
          )}

          <p className="coin-table-import__summary">
            {t('coinify.tableSummary', '{{count}} movimientos leídos', { count: drafts.length })}
            {drafts.length > 0 && (
              <>
                {' · '}
                {t('coinify.tableSummaryOut', 'sale {{amount}}', { amount: formatCurrency(totals.out, { currency: 'ARS' }) })}
                {' · '}
                {t('coinify.tableSummaryIn', 'entra {{amount}}', { amount: formatCurrency(totals.inflow, { currency: 'ARS' }) })}
              </>
            )}
          </p>

          {/* Lo que no se pudo leer se MUESTRA con su línea: lo que un
              importador descarta en silencio se descubre tres meses después. */}
          {skipped.length > 0 && (
            <p className="coin-table-import__skipped">
              {t('coinify.tableSkipped', '{{count}} filas sin fecha o sin importe reconocible (líneas {{lines}}). No se van a importar.', {
                count: skipped.length,
                lines: skipped.slice(0, 8).map((s) => s.line).join(', '),
              })}
            </p>
          )}

          <button
            className="rpg-button"
            onClick={handleConfirm}
            disabled={busy || drafts.length === 0}
          >
            {t('coinify.tableConfirm', 'Importar {{count}} movimientos', { count: drafts.length })}
          </button>
        </>
      )}

      {done !== null && (
        <p className="coin-table-import__done">
          {t('coinify.tableImported', '{{count}} movimientos importados', { count: done })}
        </p>
      )}

      {/* Categorías disponibles, para que el select de columna «categoría»
          tenga sentido aun cuando el archivo traiga nombres propios. */}
      <datalist id="coin-table-categories">
        {CATEGORIES.map((c) => <option key={c} value={c} />)}
      </datalist>
    </div>
  );
}
