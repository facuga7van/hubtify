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
  /**
   * La categoría más usada. En la base real es un caso degenerado —58 de 60
   * altas manuales están en «Otros»—, así que el `'Otros'` que hardcodeaban los
   * formularios acierta hoy por accidente. Lo que cambia es que deja de ser una
   * constante: el día que la persona separe «Comida» de «Transporte», el
   * formulario la sigue.
   */
  category: string;
  /** Cuántas filas sostienen la inferencia — 0 = se usó el fallback. */
  sampleSize: number;
  /**
   * El medio de pago de un PLAN EN CUOTAS, que es otra pregunta que la de un
   * gasto suelto. En la base real hay 4 planes cargados a mano: 3 con tarjeta,
   * 1 por transferencia, **cero en débito** — que es justo con lo que arrancaba
   * `InstallmentAddForm`. Y la moda general tampoco sirve acá: da `transfer`.
   */
  installmentPaymentMethod: InferredPaymentMethod;
  /** Cuántos PLANES (no filas) sostienen `installmentPaymentMethod`. */
  installmentSampleSize: number;
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

/**
 * Con cero planes previos, un plan en cuotas se paga con tarjeta.
 *
 * Otra decisión de producto explícita: financiar en cuotas es, en Argentina, lo
 * que hace una tarjeta de crédito. El débito —el valor con el que arrancaba el
 * formulario— es el único medio con el que NO se puede comprar en cuotas, y en
 * la base real tiene cero planes.
 */
export const FALLBACK_INSTALLMENT_METHOD: InferredPaymentMethod = 'credit_card';

/** La categoría de arranque cuando no hay ni una alta manual de la que aprender. */
export const FALLBACK_CATEGORY = 'Otros';

/** Cuántos movimientos mira la moda. Suficiente para un mes y medio de uso. */
const SAMPLE = 50;

/** Cuántos PLANES mira la moda de cuotas. Son eventos raros: la ventana es larga. */
const INSTALLMENT_SAMPLE = 20;

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
    SELECT payment_method AS paymentMethod, currency, account_id AS accountId, category
    FROM finance_transactions
    WHERE deleted_at IS NULL AND source = 'manual' AND type = 'expense'
      AND category NOT IN (${placeholders})
    ORDER BY date DESC, created_at DESC
    LIMIT ${SAMPLE}
  `).all(...reservedCategories) as Array<{
    paymentMethod: string | null;
    currency: string | null;
    accountId: string | null;
    category: string | null;
  }>;

  const installment = getInstallmentDefaults(db, reservedCategories);

  if (rows.length === 0) {
    return {
      paymentMethod: FALLBACK_PAYMENT_METHOD,
      currency: 'ARS',
      accountId: null,
      category: FALLBACK_CATEGORY,
      sampleSize: 0,
      ...installment,
    };
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

  // Las reservadas ya quedaron fuera por SQL, así que acá sólo se descartan los
  // vacíos: una fila sin categoría no vota.
  const category = mode(
    rows.map((r) => r.category).filter((c): c is string => typeof c === 'string' && c !== ''),
  ) ?? FALLBACK_CATEGORY;

  return {
    paymentMethod: method,
    currency,
    accountId,
    category,
    sampleSize: rows.length,
    ...installment,
  };
}

/**
 * La moda del medio de pago sobre los últimos PLANES EN CUOTAS cargados a mano.
 *
 * Se cuenta por `installment_group_id`, no por fila, y ahí está el detalle que
 * importa: en la base real un solo plan por transferencia de 36 cuotas produce
 * 36 filas, contra 18 de los tres planes con tarjeta. Contar filas daría
 * `transfer` por goleada; contar planes da `credit_card` 3 a 1, que es lo que la
 * persona efectivamente eligió tres veces de cuatro.
 *
 * Mismos filtros que la moda del gasto suelto y por las mismas razones: sólo
 * `manual` (las filas de `import` traen el medio del resumen, no una elección) y
 * sin categorías reservadas.
 */
function getInstallmentDefaults(
  db: SqlDatabase,
  reservedCategories: readonly string[],
): Pick<EntryDefaults, 'installmentPaymentMethod' | 'installmentSampleSize'> {
  const placeholders = reservedCategories.map(() => '?').join(', ');
  const groups = db.prepare(`
    SELECT payment_method AS paymentMethod
    FROM finance_transactions
    WHERE deleted_at IS NULL AND source = 'manual' AND type = 'expense'
      AND installments > 1 AND installment_group_id IS NOT NULL
      AND category NOT IN (${placeholders})
    GROUP BY installment_group_id
    ORDER BY MAX(date) DESC, MAX(created_at) DESC
    LIMIT ${INSTALLMENT_SAMPLE}
  `).all(...reservedCategories) as Array<{ paymentMethod: string | null }>;

  if (groups.length === 0) {
    return { installmentPaymentMethod: FALLBACK_INSTALLMENT_METHOD, installmentSampleSize: 0 };
  }

  const method = mode(
    groups.map((g) => g.paymentMethod).filter((m): m is InferredPaymentMethod =>
      typeof m === 'string' && (VALID_METHODS as readonly string[]).includes(m)),
  ) ?? FALLBACK_INSTALLMENT_METHOD;

  return { installmentPaymentMethod: method, installmentSampleSize: groups.length };
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
