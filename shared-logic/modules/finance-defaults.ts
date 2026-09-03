import type { SqlDatabase } from '../db';

/**
 * El default del alta manual, INFERIDO del historial.
 *
 * Evidencia de la base real del usuario (auditoría §5): 41 filas por
 * transferencia cargadas a mano, 18 con tarjeta, 2 con débito y **cero en
 * efectivo**. El formulario arrancaba en `cash` (`QuickAddForm.tsx:66`), o sea
 * que cada alta empezaba corrigiendo el medio de pago. Las 17 filas `cash` que
 * hay en la base no las cargó nadie: las escribe el motor de recurrentes, que
 * hardcodeaba `'cash'` porque la plantilla no tenía dónde guardar el medio.
 *
 * Así que el default deja de ser una constante y pasa a ser un hecho: la MODA
 * de lo que la persona viene eligiendo.
 */

export type InferredPaymentMethod = 'cash' | 'debit' | 'transfer' | 'credit_card';

export interface EntryDefaults {
  paymentMethod: InferredPaymentMethod;
  currency: 'ARS' | 'USD';
  /** La cuenta más usada, o `null` si nunca se eligió ninguna. */
  accountId: string | null;
  /** Cuántas filas sostienen la inferencia — 0 = se usó el fallback. */
  sampleSize: number;
}

const VALID_METHODS: readonly InferredPaymentMethod[] = ['cash', 'debit', 'transfer', 'credit_card'];

/**
 * Con cero historial el default es `transfer`, no `cash`.
 *
 * Es una decisión de producto explícita, no una elección al azar: el usuario
 * dijo que sus gastos son digitales, y la investigación de mercado encontró que
 * el denominador común argentino son transferencias, billeteras y QR — el
 * efectivo quedó en segundo plano. Alguien que sí usa efectivo lo corrige una
 * vez y la moda lo aprende a partir de la segunda alta.
 */
export const FALLBACK_PAYMENT_METHOD: InferredPaymentMethod = 'transfer';

/** Cuántos movimientos mira la moda. Suficiente para un mes y medio de uso. */
const SAMPLE = 50;

/**
 * La moda del medio de pago sobre las últimas altas MANUALES de gasto.
 *
 * Filtros y por qué:
 * - `source = 'manual'`: las filas de `import`, `recurring` y las que escribe la
 *   app llevan el medio del mecanismo que las creó, no una elección de nadie.
 *   Contarlas sería aprender del propio default fantasma.
 * - `type = 'expense'`: los ingresos tienen otra forma (sueldo por
 *   transferencia) y no son el caso que se está por cargar.
 * - Sin categorías reservadas: «Pago Tarjeta» y las patas de «Transferencia»
 *   las escribe la app.
 * - Empate: gana la fila más reciente, porque es la que el usuario acaba de
 *   confirmar con sus dedos.
 *
 * `reservedCategories` llega por parámetro y no importado a propósito: a este
 * módulo lo usa `finance.balance.ts` (el generador de recurrentes), y traer las
 * constantes desde ahí crearía un ciclo de imports entre los dos archivos.
 */
export function getEntryDefaults(
  db: SqlDatabase,
  reservedCategories: readonly string[],
): EntryDefaults {
  const placeholders = reservedCategories.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT payment_method AS paymentMethod, currency, account_id AS accountId
    FROM finance_transactions
    WHERE deleted_at IS NULL AND source = 'manual' AND type = 'expense'
      AND category NOT IN (${placeholders})
    ORDER BY date DESC, created_at DESC
    LIMIT ${SAMPLE}
  `).all(...reservedCategories) as Array<{
    paymentMethod: string | null;
    currency: string | null;
    accountId: string | null;
  }>;

  if (rows.length === 0) {
    return { paymentMethod: FALLBACK_PAYMENT_METHOD, currency: 'ARS', accountId: null, sampleSize: 0 };
  }

  const method = mode(
    rows.map((r) => r.paymentMethod).filter((m): m is InferredPaymentMethod =>
      typeof m === 'string' && (VALID_METHODS as readonly string[]).includes(m)),
  ) ?? FALLBACK_PAYMENT_METHOD;

  // La moneda sí puede quedarse en pesos con poca evidencia: equivocarse cuesta
  // un clic, y un default en dólares sobre un historial mixto es peor.
  const currency = mode(rows.map((r) => r.currency).filter((c): c is 'ARS' | 'USD' => c === 'ARS' || c === 'USD')) ?? 'ARS';

  // La cuenta más usada, pero solo entre las filas del medio inferido: la cuenta
  // de una compra con tarjeta no dice nada sobre una transferencia.
  const accountId = mode(
    rows.filter((r) => r.paymentMethod === method)
      .map((r) => r.accountId)
      .filter((a): a is string => typeof a === 'string' && a !== ''),
  ) ?? null;

  return { paymentMethod: method, currency, accountId, sampleSize: rows.length };
}

/** La moda; con empate gana el que apareció primero (= el más reciente). */
function mode<T extends string>(values: T[]): T | null {
  if (values.length === 0) return null;
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | null = null;
  let bestCount = 0;
  for (const v of values) {
    const c = counts.get(v)!;
    if (c > bestCount) { best = v; bestCount = c; }
  }
  return best;
}
