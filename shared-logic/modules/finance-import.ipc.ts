import { registerHandler as ipcHandle } from '../registry';
import { getDb } from '../db';
import { genId } from '../ids';
import { platform } from '../platform';
import { parseGaliciaStatement } from './finance-statement';
import {
  applyMapping,
  parseDelimitedTable,
  type TableColumnMapping,
  type ParsedTable,
} from './finance-table';
import {
  addMonthsClamped,
  addMonthsToMonth,
  CARD_TAX_CATEGORY,
  dateInMonthClamped,
  DEFAULT_CASH_ACCOUNT_ID,
  getCurrentRate,
  getFxHouse,
  isValidMonthString,
  MAX_INSTALLMENTS,
  nowIso,
  round2,
} from './finance.balance';

// ── Types ───────────────────────────────────────────

export interface ParsedRow {
  date: string;           // YYYY-MM-DD
  merchant: string;
  installmentCurrent?: number;
  installmentTotal?: number;
  /** For a USD line this is the amount the card actually charged in pesos. */
  amountARS?: number;
  amountUSD?: number;
  isExcluded: boolean;
  suggestedCategory: string;
  /**
   * Tax, perception or financing-interest line (or the refund of one). These
   * are included in the import like any other row — they are what makes the
   * imported total match the paper — but the preview marks them so the user can
   * tell them apart from their own purchases.
   */
  isTax?: boolean;
}

// ── Tax patterns ────────────────────────────────────

/**
 * Lines the statement charges on top of the purchases: stamp tax, VAT debits,
 * gross-income perceptions, the AFIP RG perception, financing interest — and
 * the `DEV.*` refunds of any of them.
 *
 * These used to be dropped on the floor (`isExcluded: true`), which is why the
 * imported total never matched the bank's paper. They are now parsed as ordinary
 * rows under the reserved `CARD_TAX_CATEGORY`.
 *
 * Order matters: `DEV.IMP DE SELLOS` contains `IMP DE SELLOS`, so the refund
 * patterns have to be tested first.
 *
 * Anchored and word-bounded on purpose, and matched against the line body (the
 * date and any `*`/`K` marker already stripped). The old unanchored `/IVA RG/i`
 * would have swallowed a merchant called `IVA RGB STORE`.
 */
const TAX_PATTERNS: Array<{ pattern: RegExp; label: string; refund?: boolean }> = [
  { pattern: /^DEV\.\s*IMP\b/i, label: 'Devolución de impuestos', refund: true },
  { pattern: /^IMP DE SELLOS\b/i, label: 'Impuesto de sellos' },
  { pattern: /^INTERESES FINANCIACION\b/i, label: 'Intereses de financiación' },
  { pattern: /^DB IVA\b/i, label: 'IVA débito' },
  { pattern: /^IIBB PERCEP\b/i, label: 'Percepción IIBB' },
  { pattern: /^IVA RG\b/i, label: 'IVA RG' },
  { pattern: /^DB\.?RG 5617\b/i, label: 'Percepción RG 5617' },
];

/** Argentine money format: `-1.234,56`. */
const AMOUNT_PATTERN = /-?\d{1,3}(?:\.\d{3})*,\d{2}/g;

/**
 * A readable name for a tax line: the leading words, stopping before the base
 * amount, the `$` sign or the parenthesised taxable base.
 *
 * `IIBB PERCEP-CABA 2,00%(   14171,62) 283,43` → `IIBB PERCEP-CABA`
 */
function taxLabel(rest: string, fallback: string): string {
  const match = rest.match(/^([A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ./-]*(?:\s+[A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ./-]*)*)/);
  const label = match ? match[1].replace(/\s+/g, ' ').trim() : '';
  return label || fallback;
}

/**
 * Parses a tax/perception/interest line into a normal row.
 *
 * The amount is the LAST money-shaped token on the line: every one of these
 * formats prints the taxable base first and the charge last.
 *
 *   `27-11-25 DB IVA $ 21%   341,67 71,75`            → 71,75
 *   `27-11-25 IVA RG 4240 21%(  14171,62) 2.976,04`   → 2.976,04
 *
 * A `DEV.*` line is a refund, so the amount comes back negative — exactly how
 * the parser already reports a `-22.590,00` purchase reversal, and what
 * `finance:importConfirm` turns into an `income` row.
 */
function parseTaxLine(
  body: string,
  date: string,
  entry: { label: string; refund?: boolean },
): ParsedRow | null {
  const amounts = [...body.matchAll(AMOUNT_PATTERN)];
  if (amounts.length === 0) return null;

  const raw = parseArgentineAmount(amounts[amounts.length - 1][0]);
  if (!Number.isFinite(raw)) return null;

  // A refund never adds to what the statement owes, whichever sign the PDF used.
  const amountARS = entry.refund ? -Math.abs(raw) : raw;

  return {
    date,
    merchant: taxLabel(body, entry.label),
    amountARS,
    isExcluded: false,
    isTax: true,
    suggestedCategory: CARD_TAX_CATEGORY,
  };
}

// ── Parser ──────────────────────────────────────────

/**
 * Parses a single line from a Galicia VISA credit card PDF statement.
 *
 * Line formats:
 *   DD-MM-YY * MERCHANT_NAME [XX/YY] RECEIPT AMOUNT
 *   DD-MM-YY K MERCHANT_NAME [XX/YY] RECEIPT AMOUNT
 *   DD-MM-YY K MERCHANT_NAME [...] USD  AMOUNT_USD RECEIPT AMOUNT_ARS
 */
export function parseGaliciaLine(
  line: string,
  categoryMappings: Map<string, string>
): ParsedRow | null {
  const trimmed = line.trim();

  // Must start with a date: DD-MM-YY
  const dateMatch = trimmed.match(/^(\d{2})-(\d{2})-(\d{2})\s/);
  if (!dateMatch) return null;

  const [, dd, mm, yy] = dateMatch;
  const date = `20${yy}-${mm}-${dd}`;

  const afterDate = trimmed.slice(dateMatch[0].length);

  // After the date there may be a marker: * or K
  const markerMatch = afterDate.match(/^([*K])\s+/);
  const body = markerMatch ? afterDate.slice(markerMatch[0].length) : afterDate;

  // Tax lines are recognised before the marker is required: they carry no
  // `*`/`K`, so "27-11-25 IMP DE SELLOS …" would otherwise be unparseable.
  for (const entry of TAX_PATTERNS) {
    if (entry.pattern.test(body)) {
      return parseTaxLine(body, date, entry);
    }
  }

  /**
   * Líneas del consolidado que llevan fecha pero NO son consumos. `SU PAGO` es
   * la única medida en resúmenes reales; el encabezado
   * (`finance-statement.ts`) la lee como «lo que pagué en el mes», que es su
   * verdadero significado. Acá solo hay que no confundirla con una compra.
   */
  if (/^SU\s+PAGO\b/i.test(body)) return null;

  /**
   * El marcador `*` / `K` no está garantizado.
   *
   * Medido contra los resúmenes reales: hay filas de consumo impresas SIN
   * marcador, y el `return null` de antes las tiraba enteras — ni siquiera
   * llegaban a «líneas salteadas» de forma accionable. Se detectó porque el
   * checksum del resumen no cerraba en dólares por exactamente esa fila.
   *
   * Sin marcador se exige la columna COMPROBANTE (un token suelto de 5 a 7
   * dígitos): es lo que distingue una línea del detalle de cualquier otro
   * renglón con fecha e importe. Sin esa señal no se adivina.
   */
  if (!markerMatch && !/\b\d{5,7}\b/.test(body)) return null;

  const rest = body;

  // ── Amount parsing ───────────────────────────────
  // Argentine format: -?\d{1,3}(\.\d{3})*,\d{2}
  // The LAST occurrence on the line is the ARS amount.
  const allAmounts = [...rest.matchAll(AMOUNT_PATTERN)];
  if (allAmounts.length === 0) return null;

  const lastAmountMatch = allAmounts[allAmounts.length - 1];
  let amountARS: number | undefined = parseArgentineAmount(lastAmountMatch[0]);

  // ── USD detection ────────────────────────────────
  // The USD amount is the first amount that appears AFTER the "USD" keyword.
  let amountUSD: number | undefined;
  const usdMatch = rest.match(/USD\s+([\d,]+(?:\.\d{3})*,\d{2}|-?\d{1,3}(?:\.\d{3})*,\d{2})/);
  if (usdMatch) {
    amountUSD = parseArgentineAmount(usdMatch[1]);

    /**
     * En un consumo en dólares la columna PESOS del resumen viene VACÍA y la
     * última columna de la línea es la de DÓLARES. Tomar «el último monto» como
     * el importe en pesos guardaba dólares en `billed_amount_ars` (medido: 5 de
     * 5 filas USD de los resúmenes reales tenían `amountARS === amountUSD`), y
     * `computeStatementTotals` los sumaba al total EN PESOS del resumen.
     *
     * Un importe en pesos de un consumo en dólares es siempre bastante MAYOR que
     * el importe en dólares; nunca igual. Con eso alcanza para distinguir la
     * columna real de la repetición, sin depender del layout exacto.
     */
    if (!(Math.abs(amountARS) > Math.abs(amountUSD))) {
      amountARS = undefined;
    }
  }

  // ── Merchant extraction ──────────────────────────
  // Everything between the marker and either:
  //   - an installment pattern (XX/YY where both are 2 digits)
  //   - a receipt number (5–7 digit standalone token)
  //   - the USD keyword
  //   - the amount itself (if nothing else precedes it)
  // We strip the last amount and receipt + installment from the right side.

  // Build a working string without the trailing amount
  let merchantSection = rest.slice(0, lastAmountMatch.index!).trim();

  // Remove trailing receipt number (5–7 digits at end)
  merchantSection = merchantSection.replace(/\s+\d{5,7}\s*$/, '').trim();

  // Remove trailing installment XX/YY if present
  merchantSection = merchantSection.replace(/\s+\d{2}\/\d{2}\s*$/, '').trim();

  // If USD line: remove the "USD  <usdAmount>" suffix from the merchant section
  // as pdf-parse may lay out: MERCHANT_NAME [...] USD        4,76
  merchantSection = merchantSection.replace(/\s+USD\b.*$/i, '').trim();

  // Clean up any trailing receipt-like tokens (alphanumeric short codes from USD lines)
  // e.g. "P1fMHM2Z" in "GOOGLE *YouTubeP P1fMHM2Z"
  //
  // El token tiene que LLEVAR AL MENOS UN DÍGITO para ser un código. Sin esa
  // condición la regla se comía la última palabra de cualquier comercio cuyo
  // nombre terminara en una palabra de 5 a 10 letras («TIENDA SIN MARCADOR» →
  // «TIENDA SIN»), que es parte de por qué 47 de 61 nombres importados quedaban
  // con forma sospechosa y la detección de recurrentes por nombre no servía.
  merchantSection = merchantSection.replace(/\s+(?=[A-Za-z0-9]{5,10}$)(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{5,10}\s*$/, '').trim();

  const merchant = merchantSection;
  if (!merchant) return null;

  // ── Installment extraction ───────────────────────
  let installmentCurrent: number | undefined;
  let installmentTotal: number | undefined;

  // Search in the section between merchant and end of rest
  const afterMerchant = rest.slice(merchant.length);
  const installMatch = afterMerchant.match(/\b(\d{2})\/(\d{2})\b/);
  if (installMatch) {
    installmentCurrent = parseInt(installMatch[1], 10);
    installmentTotal = parseInt(installMatch[2], 10);
  }

  // ── Category suggestion ──────────────────────────
  const suggestedCategory = suggestCategory(merchant, categoryMappings);

  const row: ParsedRow = {
    date,
    merchant,
    isExcluded: false,
    suggestedCategory,
  };

  // Ausente en una línea en dólares donde el resumen no imprime la columna de
  // pesos: pesos y dólares no se mezclan ni siquiera por omisión.
  if (amountARS !== undefined) row.amountARS = amountARS;

  if (installmentCurrent !== undefined) {
    row.installmentCurrent = installmentCurrent;
    row.installmentTotal = installmentTotal;
  }

  if (amountUSD !== undefined) {
    // `amountARS` sobrevive solo si el resumen SÍ trae el importe que la tarjeta
    // cobró en pesos: eso es lo que necesita el total del resumen.
    row.amountUSD = amountUSD;
  }

  return row;
}

function parseArgentineAmount(str: string): number {
  // "1.234,56" → 1234.56
  // "-22.590,00" → -22590
  return parseFloat(str.replace(/\./g, '').replace(',', '.'));
}

function suggestCategory(merchant: string, mappings: Map<string, string>): string {
  for (const [pattern, category] of mappings) {
    if (merchant.toUpperCase().includes(pattern.toUpperCase())) {
      return category;
    }
  }
  return 'Otros';
}

// ── IPC Handlers ────────────────────────────────────

export function registerFinanceImportIpcHandlers(): void {
  /**
   * Paso 1 del import de PDF: solo elegir el archivo y devolver sus bytes.
   *
   * El texto NO se extrae acá. Se hacía con `pdf-parse` en el main, que es
   * node-only y arrastra un canvas nativo de 35 MB; el paquete instalado nunca
   * lo incluyó y el import falló en toda versión desde marzo. El renderer
   * (escritorio y Android por igual) lo lee con pdfjs, que ya tiene, y manda el
   * texto a `finance:importParsePdfText`.
   */
  ipcHandle('finance:importPickPdf', async () => {
    return platform().pickBinaryFile([{ name: 'PDF', extensions: ['pdf'] }]);
  });

  /** Paso 2: el texto plano del resumen, línea por línea, a filas. */
  ipcHandle('finance:importParsePdfText', async (_e, fileName: string, text: string) => {
    // Los dos llegan por IPC como `unknown` y el tipo de arriba es solo una
    // promesa del renderer: un `undefined` acá reventaba adentro con un
    // `.split of undefined` que no dice nada de dónde vino.
    if (typeof fileName !== 'string') throw new Error('Invalid fileName');
    if (typeof text !== 'string' || text.trim() === '') throw new Error('Invalid PDF text');

    const data = { text };

    const db = getDb();
    const mappingsRaw = db
      .prepare('SELECT keyword, category FROM finance_category_mappings')
      .all() as Array<{ keyword: string; category: string }>;
    const mappings = new Map(mappingsRaw.map(r => [r.keyword, r.category]));

    // Add default mappings (only if not already customised)
    const defaults: [string, string][] = [
      ['RAPPI', 'Delivery'],
      ['MERPAGO', 'Compras'],
      ['GOOGLE', 'Suscripciones'],
      ['TWITCH', 'Suscripciones'],
      ['FRAVEGA', 'Compras'],
      ['UBER', 'Transporte'],
      ['TELECENTRO', 'Servicios'],
      ['CRUNCHYROLL', 'Suscripciones'],
      ['OPENAI', 'Suscripciones'],
    ];
    for (const [k, v] of defaults) {
      if (!mappings.has(k)) mappings.set(k, v);
    }

    const lines = data.text.split('\n').filter((l: string) => l.trim());
    const rows: ParsedRow[] = [];
    const skippedLines: string[] = [];
    const datePrefix = /^\d{2}-\d{2}-\d{2}\s/;
    for (const line of lines) {
      const trimmed = line.trim();
      const parsed = parseGaliciaLine(trimmed, mappings);
      if (parsed) {
        rows.push(parsed);
      } else if (datePrefix.test(trimmed) && !/^\d{2}-\d{2}-\d{2}\s+SU\s+PAGO\b/i.test(trimmed)) {
        // Line starts with a date but couldn't be parsed — potentially lost data.
        // `SU PAGO` sale de acá: dejó de ser una línea incomprendida y pasó a ser
        // «lo que pagué en el mes», que el encabezado lee y el preview muestra.
        skippedLines.push(trimmed);
      }
    }

    // El 85 % del documento que se tiraba sin mirar: período, cierre,
    // vencimiento, últimos 4, totales, pago mínimo, límites y la proyección de
    // cuotas que el banco YA imprimió. Nada de esto se le vuelve a preguntar.
    const header = parseGaliciaStatement(data.text);

    return { rows, fileName, skippedLines, header };
  });

  /**
   * Writes a parsed statement.
   *
   * `statementMonth` (`YYYY-MM`, the month the user picked for the PDF) is the
   * period every card row is filed under — persisted as `statement_period`, and
   * preferred over the closing-day math by `computeStatementTotals` /
   * `getStatementDetail`. Galicia prints the ORIGINAL purchase date on every
   * instalment line, so deriving the period from the line date sent a `04/12`
   * paid in September into May's (paid, frozen) statement, where it never
   * reached any `Pago Tarjeta` and never left the balance.
   *
   * `accountId` (optional, card-less imports only) is the pocket the rows come
   * out of; with a card they belong to no account until the statement is paid.
   */
  ipcHandle(
    'finance:importConfirm',
    async (
      _e,
      rows: ParsedRow[],
      statementMonth: string,
      fileName: string,
      creditCardId?: string | null,
      accountId?: string | null,
    ) => {
      const db = getDb();
      const batchId = genId();
      // Imported rows freeze the rate of the day they are IMPORTED (best data
      // available) — a PROCESS rate, never the line's own day, hence the `~`;
      // offline with no cache leaves NULL for the backfill.
      const fxRate = await getCurrentRate(db, getFxHouse(db));
      const now = nowIso();

      // A card statement belongs to a card. Rows written without one used to keep
      // `payment_method = 'credit_card'` while still impacting the balance and
      // belonging to no statement — the purchase was counted once on import and
      // again when the statement was paid. Now the flow is explicit:
      //   - a real card  → `impacts_balance = 0`, rolls into that card's statement
      //   - no card      → `payment_method = 'cash'`, impacts the balance right away
      const cardId = typeof creditCardId === 'string' && creditCardId.trim() !== ''
        ? creditCardId.trim()
        : null;
      const card = cardId
        ? db.prepare('SELECT id FROM finance_credit_cards WHERE id = ? AND deleted_at IS NULL').get(cardId)
        : undefined;
      if (cardId && !card) return { ok: false, reason: 'credit_card_not_found' };
      if (cardId && !isValidMonthString(statementMonth)) return { ok: false, reason: 'invalid_statement_month' };

      const paymentMethod = cardId ? 'credit_card' : 'cash';
      const impactsBalance = cardId ? 0 : 1;
      const statementPeriod = cardId ? statementMonth : null;

      // Card-less rows leave a pocket. Explicit id (must be alive), `null` =
      // "sin cuenta", omitted = the seeded «Efectivo» if it still exists — the
      // same default mapping as a manual cash entry.
      let rowAccountId: string | null = null;
      if (!cardId) {
        if (typeof accountId === 'string' && accountId.trim() !== '') {
          const alive = db.prepare('SELECT id FROM finance_accounts WHERE id = ? AND deleted_at IS NULL').get(accountId.trim());
          if (!alive) return { ok: false, reason: 'account_not_found' };
          rowAccountId = accountId.trim();
        } else if (accountId === undefined) {
          const def = db.prepare('SELECT id FROM finance_accounts WHERE id = ? AND deleted_at IS NULL').get(DEFAULT_CASH_ACCOUNT_ID);
          rowAccountId = def ? DEFAULT_CASH_ACCOUNT_ID : null;
        }
      }

      const insertBatch = db.prepare(
        `INSERT INTO finance_import_batches (id, source, filename, row_count, created_at)
         VALUES (?, 'galicia_visa', ?, ?, ?)`,
      );

      // Duplicate = the same line already imported by a PREVIOUS batch. The
      // key carries the instalment number: the parser strips `04/12` from the
      // merchant, so without it every instalment 2..N of a plan collided with
      // instalment 1 (same purchase date, same merchant, same amount) and was
      // silently dropped — $275.000 of a 12-instalment fridge never entered.
      // The current batch is excluded so two identical lines in ONE PDF (two
      // `DB IVA 21%` of 71,75 the same day) both land.
      // The key compares the date printed ON THE PAPER, which since v20 lives
      // in `purchase_date` (`date` moved to the statement month). `COALESCE`
      // covers rows synced from a device that has not migrated yet.
      const dupCheck = db.prepare(
        `SELECT COUNT(*) as cnt FROM finance_transactions
         WHERE deleted_at IS NULL AND source = 'import'
           AND COALESCE(purchase_date, date) = ? AND description = ? AND amount = ? AND currency = ?
           AND installment_number IS ?
           AND (import_batch_id IS NULL OR import_batch_id <> ?)`,
      );

      const insertTx = db.prepare(
        `INSERT INTO finance_transactions
         (id, type, amount, currency, category, description, date, purchase_date, payment_method, source, import_batch_id,
          installments, installment_number, billed_amount_ars, credit_card_id, impacts_balance,
          statement_period, fx_rate, fx_rate_source, account_id, installment_group_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'import', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );

      // ── Planes de cuotas ────────────────────────────
      //
      // El parser ya leía «CUOTA N/M» y el INSERT lo tiraba: la fila quedaba sin
      // `installment_group_id` y la pestaña Cuotas —igual que la proyección y
      // «próximas batallas»— hace `JOIN finance_installment_groups`. Una compra
      // importada en 12 cuotas no existía para ninguna de las tres, y las cuotas
      // que faltaban no aparecían hasta el resumen siguiente.
      //
      // Identidad del plan: comercio + fecha de compra + moneda + total de
      // cuotas + tarjeta. Galicia imprime la fecha ORIGINAL de la compra en cada
      // cuota, así que la clave es estable entre resúmenes consecutivos y el
      // segundo import encuentra el plan del primero en vez de duplicarlo. El
      // monto NO es identidad (el banco lo ajusta entre resúmenes): es DESEMPATE.
      // Los candidatos se ordenan por cercanía entre el monto de la línea y el de
      // la cuota n ya proyectada en el plan (o el promedio del plan si esa cuota
      // no existe todavía, resúmenes desordenados), y se toma el primero que no
      // haya absorbido una línea de ESTE lote: un plan absorbe a lo sumo una
      // línea por resumen (invariante 2). Dos artículos distintos de la misma
      // tienda, el mismo día y en la misma cantidad de cuotas → dos planes, y en
      // el resumen siguiente cada cuota vuelve al suyo por monto.
      // La tarjeta no vive en el grupo, así que se mira en sus filas.
      const findGroup = db.prepare(
        `SELECT g.id AS id, g.category AS category FROM finance_installment_groups g
          WHERE g.deleted_at IS NULL AND g.description = ? AND g.currency = ?
            AND g.total_installments = ? AND g.date = ?
            AND EXISTS (SELECT 1 FROM finance_transactions t
                         WHERE t.installment_group_id = g.id AND t.deleted_at IS NULL
                           AND t.credit_card_id IS ?)
            AND NOT EXISTS (SELECT 1 FROM finance_transactions t
                             WHERE t.installment_group_id = g.id AND t.import_batch_id = ?)
          ORDER BY abs(
              COALESCE(
                (SELECT t.amount FROM finance_transactions t
                  WHERE t.installment_group_id = g.id AND t.installment_number = ?
                    AND t.deleted_at IS NULL
                  ORDER BY t.created_at ASC LIMIT 1),
                g.total_amount / g.total_installments
              ) - ?
            ) ASC,
            g.created_at ASC
          LIMIT 1`,
      );
      const insertGroup = db.prepare(
        `INSERT INTO finance_installment_groups
           (id, description, total_amount, currency, total_installments, category, date, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      // Nunca materializa sobre una fila de este mismo lote: solo las que vienen
      // de lotes anteriores (o de ninguno) cuentan como «ya existe».
      const findInstallment = db.prepare(
        `SELECT id, category FROM finance_transactions
          WHERE installment_group_id = ? AND installment_number = ? AND deleted_at IS NULL
            AND (import_batch_id IS NULL OR import_batch_id <> ?)
          LIMIT 1`,
      );
      // La cuota proyectada pasa a ser la del papel: monto real, fecha en el mes
      // del resumen, fecha de compra y el resumen al que pertenece. No se agrega otra fila.
      const materialise = db.prepare(
        `UPDATE finance_transactions
            SET type = ?, amount = ?, currency = ?, category = ?, description = ?, date = ?, purchase_date = ?,
                billed_amount_ars = ?, statement_period = ?, import_batch_id = ?,
                fx_rate = ?, fx_rate_source = ?, account_id = ?, updated_at = ?
          WHERE id = ?`,
      );

      // One transaction: a failure halfway used to leave a partial import with a
      // batch row that no longer matched what was actually written.
      const run = db.transaction(() => {
        insertBatch.run(batchId, fileName, rows.length, now);

        let duplicateCount = 0;
        let inserted = 0;

        for (const row of rows) {
          if (row.isExcluded) continue;

          const isUsd = row.amountUSD !== undefined;
          const signed = isUsd ? row.amountUSD! : (row.amountARS ?? 0);
          // A negative line is a refund/credit, not a bigger expense.
          const type = signed < 0 ? 'income' : 'expense';
          const amount = Math.abs(signed);
          const currency = isUsd ? 'USD' : 'ARS';
          // USD lines: keep the peso amount the card actually billed.
          const billedArs = isUsd && row.amountARS != null ? Math.abs(row.amountARS) : null;
          const installmentNumber = Number.isInteger(row.installmentCurrent) ? row.installmentCurrent! : null;

          // Invariante 1: con tarjeta la fila vive en el mes del resumen (mismo día
          // de compra, clampeado); la fecha del papel queda en purchase_date. Sin
          // tarjeta es un gasto en efectivo que ya ocurrió: impacta en su fecha real.
          const rowDate = statementPeriod === null
            ? row.date
            : dateInMonthClamped(statementPeriod, Number(row.date.slice(8, 10)));

          const existing = dupCheck.get(row.date, row.merchant, amount, currency, installmentNumber, batchId) as { cnt: number };
          if (existing.cnt > 0) {
            duplicateCount++;
            continue;
          }

          const totalInstallments = Number.isInteger(row.installmentTotal) ? row.installmentTotal! : 1;
          // Una cuota disparatada (13/12, 0/6, 200/300) no arma ningún plan: la
          // fila entra suelta antes que fabricar un calendario inventado.
          const isPlan = totalInstallments > 1
            && totalInstallments <= MAX_INSTALLMENTS
            && installmentNumber !== null
            && installmentNumber >= 1
            && installmentNumber <= totalInstallments;

          let groupId: string | null = null;
          if (isPlan) {
            const found = findGroup.get(
              row.merchant, currency, totalInstallments, row.date, cardId, batchId, installmentNumber, amount,
            ) as { id: string; category: string } | undefined;

            if (found) {
              groupId = found.id;
              const projected = findInstallment.get(groupId, installmentNumber, batchId) as
                { id: string; category: string } | undefined;
              if (projected) {
                materialise.run(
                  type, amount, currency, row.suggestedCategory, row.merchant, rowDate, row.date,
                  billedArs, statementPeriod, batchId,
                  fxRate, fxRate === null ? null : 'process', rowAccountId, now,
                  projected.id,
                );
                inserted++;
                continue;
              }
            } else {
              groupId = genId();
              insertGroup.run(
                groupId,
                row.merchant,
                round2(amount * totalInstallments),
                currency,
                totalInstallments,
                row.suggestedCategory,
                row.date,
                now,
                now,
              );
            }
          }

          insertTx.run(
            genId(),
            type,
            amount,
            currency,
            row.suggestedCategory,
            row.merchant,
            rowDate,
            row.date,
            paymentMethod,
            batchId,
            totalInstallments,
            installmentNumber,
            billedArs,
            cardId,
            impactsBalance,
            statementPeriod,
            fxRate,
            fxRate === null ? null : 'process',
            rowAccountId,
            groupId,
            now,
            now,
          );
          inserted++;

          // Las cuotas que todavía no llegaron: se proyectan una por resumen a
          // partir del que se está importando. Las ANTERIORES no se escriben —
          // o ya se importaron con su propio resumen, o pertenecen a resúmenes
          // cerrados, y crearlas ahora movería saldos y totales del pasado.
          if (isPlan && groupId !== null) {
            // La cuota importada cae en el resumen que se está cargando; las que
            // siguen, uno por mes desde ahí, conservando el día de la compra.
            const anchorMonth = statementPeriod ?? row.date.slice(0, 7);
            const anchorDate = dateInMonthClamped(anchorMonth, Number(row.date.slice(8, 10)));
            for (let n = installmentNumber! + 1; n <= totalInstallments; n++) {
              // Los resúmenes pueden llegar desordenados (primero agosto, después
              // junio): la cuota que ya existe en el plan no se vuelve a escribir.
              if (findInstallment.get(groupId, n, batchId)) continue;
              const offset = n - installmentNumber!;
              // purchase_date queda NULL hasta que materialise la escriba con la
              // fecha del papel. Si la proyectada la tuviera, dupCheck (que además
              // filtra source='import', amount, installment_number y otro lote) la
              // confundiría con la cuota real del resumen siguiente cuando el banco
              // no ajusta el monto, y esa cuota nunca se materializaría.
              insertTx.run(
                genId(),
                type,
                amount,
                currency,
                row.suggestedCategory,
                row.merchant,
                addMonthsClamped(anchorDate, offset),
                null,
                paymentMethod,
                batchId,
                totalInstallments,
                n,
                billedArs,
                cardId,
                impactsBalance,
                statementPeriod === null ? null : addMonthsToMonth(statementPeriod, offset),
                fxRate,
                fxRate === null ? null : 'process',
                rowAccountId,
                groupId,
                now,
                now,
              );
            }
          }
        }

        return { batchId, count: inserted, duplicateCount, creditCardId: cardId };
      });

      return run();
    },
  );

  /** Undo a whole import batch — `import_batch_id` was written but never read. */
  ipcHandle('finance:undoImportBatch', (_e, batchId: string) => {
    if (typeof batchId !== 'string' || batchId.trim() === '') {
      return { ok: false, reason: 'invalid_batch_id' };
    }
    const db = getDb();
    const now = nowIso();
    const run = db.transaction(() => {
      const result = db
        .prepare(
          `UPDATE finance_transactions
           SET deleted_at = ?, updated_at = ?
           WHERE import_batch_id = ? AND deleted_at IS NULL`,
        )
        .run(now, now, batchId);

      // Un import que crea planes de cuotas también tiene que poder deshacerlos:
      // sin esto quedaba un grupo vivo sin ninguna fila, y la pestaña Cuotas —
      // que hace INNER JOIN— mostraba un plan fantasma de cero movimientos.
      // Solo los grupos que TOCÓ este lote y que quedaron sin cuotas vivas.
      db.prepare(
        `UPDATE finance_installment_groups SET deleted_at = ?, updated_at = ?
          WHERE deleted_at IS NULL
            AND id IN (SELECT DISTINCT installment_group_id FROM finance_transactions
                        WHERE import_batch_id = ? AND installment_group_id IS NOT NULL)
            AND NOT EXISTS (SELECT 1 FROM finance_transactions t
                             WHERE t.installment_group_id = finance_installment_groups.id
                               AND t.deleted_at IS NULL)`,
      ).run(now, now, batchId);

      return result.changes;
    });

    return { ok: true, deleted: run() };
  });

  ipcHandle('finance:getImportBatches', () => {
    const db = getDb();
    return db
      .prepare(
        `SELECT b.id, b.source, b.filename, b.row_count AS rowCount, b.created_at AS createdAt,
                (SELECT COUNT(*) FROM finance_transactions t
                  WHERE t.import_batch_id = b.id AND t.deleted_at IS NULL) AS liveCount
         FROM finance_import_batches b
         ORDER BY b.created_at DESC`,
      )
      .all();
  });

  /**
   * Extracto de billetera / banco en tabla delimitada (CSV, TSV).
   *
   * El resumen de tarjeta resuelve el setup y las cuotas, pero el 67 % de lo
   * que el usuario carga a mano son transferencias y billeteras — 180 de las
   * 330 interacciones de la auditoría, y se pagan todos los meses. Ninguna de
   * esas filas está en un PDF de tarjeta.
   *
   * Genérico y no un parser por proveedor: la investigación midió que el CSV de
   * Mercado Pago es una FAMILIA de formatos (delimitador, separador decimal,
   * idioma de los encabezados y alias de columna son configurables por el
   * usuario). Y `pickTextFile` ya funciona en Android hoy, sin plumbing nuevo.
   */
  ipcHandle('finance:importSelectAndParseTable', async () => {
    const picked = await platform().pickTextFile([
      { name: 'CSV', extensions: ['csv', 'tsv', 'txt'] },
    ]);
    if (picked === null) return null;
    const table = parseDelimitedTable(picked.content);
    if (table === null) return { ok: false as const, reason: 'unreadable_table' as const };
    // Solo una muestra viaja al preview: un extracto anual son miles de filas y
    // el renderer solo necesita mostrar cómo quedó el mapeo.
    return {
      fileName: picked.name,
      delimiter: table.delimiter,
      decimalSeparator: table.decimalSeparator,
      headers: table.headers,
      rows: table.rows,
      suggested: table.suggested,
    };
  });

  /**
   * Aplica un mapeo de columnas y devuelve las filas listas — y las que NO se
   * pudieron leer, con el número de línea y el motivo.
   *
   * Vive en el backend y no en el renderer para que la lógica de parseo exista
   * UNA sola vez: el mapeo cambia por acción del usuario (un select), no por
   * tecla, así que el viaje IPC no cuesta nada.
   */
  ipcHandle(
    'finance:importApplyTableMapping',
    (
      _e,
      table: ParsedTable,
      mapping: TableColumnMapping,
      defaults: { currency?: 'ARS' | 'USD'; category?: string } = {},
    ) => {
      if (!table || !Array.isArray(table.rows) || !Array.isArray(table.headers)) {
        return { rows: [], skipped: [] };
      }
      return applyMapping(table, mapping ?? {}, defaults ?? {});
    },
  );

  /**
   * Escribe las filas de una tabla ya mapeada.
   *
   * A diferencia del resumen de tarjeta, acá NO hay tarjeta ni resumen: son
   * movimientos que ya salieron de una cuenta. Por eso `account_id` **no es
   * opcional** — que estuviera en NULL en las 107 filas de la base real es la
   * razón por la que el cofre nunca se movió.
   */
  ipcHandle(
    'finance:importConfirmTable',
    async (
      _e,
      rawRows: unknown,
      options: {
        fileName?: string;
        accountId?: string | null;
        paymentMethod?: string;
        /** Un importe negativo del extracto es un gasto (`expense`) o un ingreso. */
        negativeIsExpense?: boolean;
      } = {},
    ) => {
      const db = getDb();
      if (!Array.isArray(rawRows) || rawRows.length === 0) return { ok: false, reason: 'no_rows' };

      const accountId = typeof options.accountId === 'string' && options.accountId.trim() !== ''
        ? options.accountId.trim() : null;
      if (accountId) {
        const alive = db.prepare('SELECT id FROM finance_accounts WHERE id = ? AND deleted_at IS NULL').get(accountId);
        if (!alive) return { ok: false, reason: 'account_not_found' };
      }

      const paymentMethod = typeof options.paymentMethod === 'string' && options.paymentMethod.trim() !== ''
        ? options.paymentMethod.trim()
        // Nunca `cash`: el default del módulo pasó a ser digital, y un extracto
        // de billetera es, por definición, dinero digital.
        : 'transfer';
      const negativeIsExpense = options.negativeIsExpense !== false;

      const batchId = genId();
      const fxRate = await getCurrentRate(db, getFxHouse(db));
      const now = nowIso();

      const insertBatch = db.prepare(
        `INSERT INTO finance_import_batches (id, source, filename, row_count, created_at)
         VALUES (?, 'delimited_table', ?, ?, ?)`,
      );
      // Mismo dedupe que el PDF: una fila ya importada por OTRO lote no se
      // duplica al reimportar un extracto que se solapa con el anterior.
      const dupCheck = db.prepare(
        `SELECT COUNT(*) as cnt FROM finance_transactions
         WHERE deleted_at IS NULL AND source = 'import'
           AND date = ? AND description = ? AND amount = ? AND currency = ?
           AND (import_batch_id IS NULL OR import_batch_id <> ?)`,
      );
      // Sin tarjeta ni resumen no hay mes al que mover la fila: `date` es la del
      // extracto y `purchase_date` la acompaña, la misma invariante que el PDF
      // («toda fila importada guarda su fecha de compra»).
      const insertTx = db.prepare(
        `INSERT INTO finance_transactions
         (id, type, amount, currency, category, description, date, purchase_date, payment_method, source, import_batch_id,
          installments, impacts_balance, fx_rate, fx_rate_source, account_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'import', ?, 1, 1, ?, ?, ?, ?, ?)`,
      );

      const run = db.transaction(() => {
        insertBatch.run(batchId, typeof options.fileName === 'string' ? options.fileName : '', rawRows.length, now);
        let inserted = 0;
        let duplicateCount = 0;
        let skipped = 0;

        for (const row of rawRows as Array<Record<string, unknown>>) {
          const date = typeof row.date === 'string' ? row.date : '';
          const amount = Number(row.amount);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(amount) || amount <= 0) {
            skipped++;
            continue;
          }
          const raw = Number(row.raw);
          const isNegative = Number.isFinite(raw) ? raw < 0 : false;
          const type = negativeIsExpense
            ? (isNegative ? 'expense' : 'income')
            : (isNegative ? 'income' : 'expense');
          const currency = row.currency === 'USD' ? 'USD' : 'ARS';
          const description = typeof row.description === 'string' ? row.description : '';
          const category = typeof row.category === 'string' && row.category.trim() !== ''
            ? row.category.trim() : 'Otros';

          const existing = dupCheck.get(date, description, round2(amount), currency, batchId) as { cnt: number };
          if (existing.cnt > 0) { duplicateCount++; continue; }

          insertTx.run(
            genId(), type, round2(amount), currency, category, description, date, date,
            paymentMethod, batchId, fxRate, fxRate === null ? null : 'process',
            accountId, now, now,
          );
          inserted++;
        }
        return { batchId, count: inserted, duplicateCount, skipped };
      });

      return run();
    },
  );

  ipcHandle('finance:getCategoryMappings', () => {
    const db = getDb();
    return db
      .prepare(
        'SELECT id, keyword AS merchantPattern, category, created_at AS createdAt FROM finance_category_mappings ORDER BY keyword',
      )
      .all();
  });

  ipcHandle(
    'finance:updateCategoryMapping',
    (_e, merchantPattern: string, category: string) => {
      const db = getDb();
      const existing = db
        .prepare('SELECT id FROM finance_category_mappings WHERE keyword = ?')
        .get(merchantPattern);
      if (existing) {
        db.prepare(
          'UPDATE finance_category_mappings SET category = ? WHERE keyword = ?',
        ).run(category, merchantPattern);
      } else {
        db.prepare(
          `INSERT INTO finance_category_mappings (id, keyword, category, created_at)
           VALUES (?, ?, ?, ?)`,
        ).run(genId(), merchantPattern, category, nowIso());
      }
    },
  );
}
