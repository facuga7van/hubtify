/**
 * Lectura del ENCABEZADO y el PIE de un resumen de tarjeta.
 *
 * El parser de líneas (`finance-import.ipc.ts`) lee el detalle del consumo y
 * descarta el resto del documento: el 85 % del papel, donde están impresos —por
 * la Ley 25.065 art. 23— todos los datos que hoy la app le pide tipeados al
 * usuario. Este módulo lee ese 85 %.
 *
 * Es una función PURA sobre el texto extraído: sin DB, sin plataforma, sin
 * estado. Todo campo es opcional; la ausencia de cualquiera degrada al flujo
 * manual de siempre y NUNCA corrompe una fila. Un cambio de layout del banco
 * quita automatismo, no datos.
 */

// ── Tipos ───────────────────────────────────────────

export interface StatementMoney {
  ars: number | null;
  usd: number | null;
}

export interface StatementForecastEntry {
  /** `YYYY-MM` */
  month: string;
  amount: number;
}

export interface StatementHeader {
  /** `VI00000000012345678` — identidad del documento, útil para el dedupe de lotes. */
  statementNumber: string | null;
  /** Últimos 4 de la tarjeta titular, de la fila «TARJETA NNNN Total Consumos de …». */
  cardLast4: string | null;
  /** `YYYY-MM-DD`. */
  previousClosingDate: string | null;
  previousDueDate: string | null;
  closingDate: string | null;
  dueDate: string | null;
  nextClosingDate: string | null;
  nextDueDate: string | null;
  /** `YYYY-MM` del cierre: el período al que pertenece TODO el resumen. */
  period: string | null;
  previousBalance: StatementMoney;
  /** Lo que el usuario PAGÓ durante el período (magnitud positiva). */
  payments: StatementMoney;
  /** «Total Consumos de <titular>»: las compras, sin impuestos ni saldo anterior. */
  consumos: StatementMoney;
  /** «TOTAL A PAGAR». */
  totalDue: StatementMoney;
  minimumPaymentArs: number | null;
  purchaseLimitArs: number | null;
  financingLimitArs: number | null;
  /** Bloque «Cuotas a vencer»: los próximos 6 meses, firmados por el banco. */
  forecast: StatementForecastEntry[];
  /** «A partir de <Mes>/<AA> $X» — la cola de todo lo que viene después. */
  forecastTail: StatementForecastEntry | null;
  /**
   * La fecha de cierre de la fila de fechas coincide con la del código de
   * barras del pie. `null` = no había alguna de las dos para comparar.
   */
  closingDateAgrees: boolean | null;
}

export interface ReconciliationSide {
  /** Σ de las filas que se van a importar. */
  imported: number;
  /** `totalDue − previousBalance − payments`, los tres del papel. */
  expected: number | null;
  difference: number | null;
  /** `true` cierra · `false` no cierra · `null` faltan totales, no hay checksum. */
  ok: boolean | null;
}

export interface Reconciliation {
  ars: ReconciliationSide;
  usd: ReconciliationSide;
}

/** Una fila del detalle, en lo mínimo que la conciliación necesita saber. */
export interface ReconcilableRow {
  amountARS?: number;
  amountUSD?: number;
}

// ── Léxico ──────────────────────────────────────────

/** Formato argentino: `-1.234,56`. Igual que en el parser de líneas. */
const MONEY = /-?\d{1,3}(?:\.\d{3})*,\d{2}/g;

/** `DD-Mes-AA` de la fila de fechas del encabezado. */
const MONTH_ABBR: Record<string, number> = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
  jul: 7, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12,
};

/** `Diciembre/25` del bloque de cuotas a vencer. «Setiembre» es el que imprime Galicia. */
const MONTH_FULL: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9,
  octubre: 10, noviembre: 11, diciembre: 12,
};

function parseArgentineAmount(str: string): number {
  return parseFloat(str.replace(/\./g, '').replace(',', '.'));
}

/** Todos los importes de una línea, en orden de aparición. */
function amountsOf(line: string): number[] {
  return [...line.matchAll(MONEY)]
    .map((m) => parseArgentineAmount(m[0]))
    .filter((n) => Number.isFinite(n));
}

/**
 * En las filas de dos importes la primera columna es PESOS y la segunda
 * DÓLARES. Es posicional, y por eso existe el checksum: una asignación
 * equivocada rompe la conciliación en vez de guardarse en silencio.
 */
function moneyPair(line: string): StatementMoney {
  const a = amountsOf(line);
  return { ars: a.length > 0 ? a[0] : null, usd: a.length > 1 ? a[1] : null };
}

/** `07-Nov-25` → `2025-11-07`. Devuelve null si el mes no se reconoce. */
function parseAbbrDate(token: string): string | null {
  const m = token.match(/^(\d{1,2})-([A-Za-zÁ-úÀ-ÿ]{3,4})-(\d{2})$/);
  if (!m) return null;
  const month = MONTH_ABBR[m[2].toLowerCase().slice(0, 3)];
  if (!month) return null;
  return `20${m[3]}-${String(month).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/** `Diciembre/25` → `2025-12`. */
function parseFullMonth(name: string, yy: string): string | null {
  const month = MONTH_FULL[name.toLowerCase()];
  if (!month) return null;
  return `20${yy}-${String(month).padStart(2, '0')}`;
}

const EMPTY_MONEY = (): StatementMoney => ({ ars: null, usd: null });

function emptyHeader(): StatementHeader {
  return {
    statementNumber: null,
    cardLast4: null,
    previousClosingDate: null,
    previousDueDate: null,
    closingDate: null,
    dueDate: null,
    nextClosingDate: null,
    nextDueDate: null,
    period: null,
    previousBalance: EMPTY_MONEY(),
    payments: EMPTY_MONEY(),
    consumos: EMPTY_MONEY(),
    totalDue: EMPTY_MONEY(),
    minimumPaymentArs: null,
    purchaseLimitArs: null,
    financingLimitArs: null,
    forecast: [],
    forecastTail: null,
    closingDateAgrees: null,
  };
}

// ── Parser ──────────────────────────────────────────

/**
 * La fila de SEIS fechas del encabezado, en orden:
 *   cierre anterior · vencimiento anterior · CIERRE · VENCIMIENTO · próximo cierre · próximo venc.
 *
 * Ese orden se verifica solo: el código de barras del pie (`YYYYMMDD…H`) trae la
 * fecha de cierre del resumen, y tiene que coincidir con la tercera. Cuando no
 * coincide, `closingDateAgrees` queda en `false` y la UI lo muestra en vez de
 * confiar a ciegas.
 */
const SIX_DATES = /^(\d{1,2}-[A-Za-zÁ-úÀ-ÿ]{3,4}-\d{2})(?:\s+(\d{1,2}-[A-Za-zÁ-úÀ-ÿ]{3,4}-\d{2})){5}$/;

export function parseGaliciaStatement(text: string): StatementHeader {
  const header = emptyHeader();
  if (typeof text !== 'string' || text.trim() === '') return header;

  const lines = text.split('\n').map((l) => l.trim());
  let barcodeClosing: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === '') continue;

    // `Resumen N° VI00000000012345678`
    if (header.statementNumber === null) {
      const m = line.match(/^Resumen\s+N[°º]\s*([A-Z0-9]+)\b/i);
      if (m) header.statementNumber = m[1];
    }

    // Código de barras del pie: los 8 primeros dígitos son la fecha de cierre.
    if (barcodeClosing === null) {
      const m = line.match(/^(\d{4})(\d{2})(\d{2})\d{6,}[A-Z]$/);
      if (m) {
        const month = Number(m[2]);
        const day = Number(m[3]);
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
          barcodeClosing = `${m[1]}-${m[2]}-${m[3]}`;
        }
      }
    }

    if (header.closingDate === null && SIX_DATES.test(line)) {
      const parts = line.split(/\s+/).map(parseAbbrDate);
      if (parts.every((p) => p !== null)) {
        header.previousClosingDate = parts[0];
        header.previousDueDate = parts[1];
        header.closingDate = parts[2];
        header.dueDate = parts[3];
        header.nextClosingDate = parts[4];
        header.nextDueDate = parts[5];
      }
    }

    if (/^SALDO ANTERIOR\b/i.test(line)) {
      header.previousBalance = moneyPair(line);
    }

    // «SU PAGO» viene con signo negativo en el papel: acá se guarda la MAGNITUD,
    // porque la pregunta del usuario es «cuánto pagué», no «cuánto restó».
    if (/\bSU PAGO EN PESOS\b/i.test(line)) {
      const a = amountsOf(line);
      if (a.length > 0) header.payments.ars = Math.abs(a[a.length - 1]);
    }
    if (/\bSU PAGO EN (?:USD|D[OÓ]LARES)\b/i.test(line)) {
      const a = amountsOf(line);
      if (a.length > 0) header.payments.usd = Math.abs(a[a.length - 1]);
    }

    // `TARJETA 1234 Total Consumos de <titular> <ars> <usd>`
    const consumos = line.match(/^TARJETA\s+(\d{4})\b.*?\bTotal\s+Consumos\b/i);
    if (consumos) {
      header.cardLast4 = consumos[1];
      header.consumos = moneyPair(line);
    } else if (header.consumos.ars === null && /\bTotal\s+Consumos\b/i.test(line)) {
      // Sin el prefijo TARJETA (layout de adicionales) todavía sirve el total.
      header.consumos = moneyPair(line);
    }

    if (/^TOTAL A PAGAR\b/i.test(line)) {
      header.totalDue = moneyPair(line);
    }

    // `PAGO MINIMO LÍMITES` / `En pesos` / `$ 1.234,56`
    if (header.minimumPaymentArs === null && /^PAGO\s+M[IÍ]NIMO\b/i.test(line)) {
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const a = amountsOf(lines[j]);
        if (a.length > 0) { header.minimumPaymentArs = a[0]; break; }
      }
    }
    if (header.purchaseLimitArs === null && /^De compras en un pago/i.test(line)) {
      const a = amountsOf(lines[i + 1] ?? '');
      if (a.length > 0) header.purchaseLimitArs = a[0];
    }
    if (header.financingLimitArs === null && /^De financiaci[oó]n\b/i.test(line)) {
      const a = amountsOf(lines[i + 1] ?? '');
      if (a.length > 0) header.financingLimitArs = a[0];
    }

    // El bloque que hace innecesario proyectar nada: el banco ya proyectó.
    //   Cuotas a vencer:
    //   Diciembre/25 Enero/26 Febrero/26 Marzo/26 Abril/26 Mayo/26
    //   $1,00 $2,00 $3,00 $4,00 $5,00 $6,00
    //   A partir de Junio/26 $7,00
    if (header.forecast.length === 0 && /^Cuotas\s+a\s+vencer:?$/i.test(line)) {
      const months = [...(lines[i + 1] ?? '').matchAll(/([A-Za-zÁ-úÀ-ÿ]+)\/(\d{2})/g)]
        .map((m) => parseFullMonth(m[1], m[2]));
      const amounts = amountsOf(lines[i + 2] ?? '');
      // Solo si las dos filas tienen el mismo largo: un desfasaje significa que
      // el layout cambió, y una proyección mal alineada es peor que ninguna.
      if (months.length > 0 && months.length === amounts.length && months.every((m) => m !== null)) {
        header.forecast = months.map((month, k) => ({ month: month as string, amount: amounts[k] }));
      }
      const tail = (lines[i + 3] ?? '').match(
        /A partir de\s+([A-Za-zÁ-úÀ-ÿ]+)\/(\d{2})\s*\$?\s*(-?\d{1,3}(?:\.\d{3})*,\d{2})/i,
      );
      if (tail) {
        const month = parseFullMonth(tail[1], tail[2]);
        if (month) header.forecastTail = { month, amount: parseArgentineAmount(tail[3]) };
      }
    }
  }

  // Sin la fila de fechas, el código de barras alcanza para el cierre.
  if (header.closingDate === null && barcodeClosing !== null) {
    header.closingDate = barcodeClosing;
  } else if (header.closingDate !== null && barcodeClosing !== null) {
    header.closingDateAgrees = header.closingDate === barcodeClosing;
  }

  if (header.closingDate !== null) header.period = header.closingDate.slice(0, 7);

  return header;
}

// ── Conciliación ────────────────────────────────────

const CENT = 0.01;

function side(imported: number, totalDue: number | null, previous: number | null, paid: number | null): ReconciliationSide {
  const rounded = Math.round(imported * 100) / 100;
  // El checksum necesita los TRES números del papel. Con uno solo ausente no
  // existe, y decirlo es distinto de decir que cierra.
  if (totalDue === null) {
    return { imported: rounded, expected: null, difference: null, ok: null };
  }
  // `paid` viene en MAGNITUD positiva (el papel lo imprime negativo), así que
  // acá SUMA: el pago canceló arrastre, no consumo del período.
  const expected = Math.round((totalDue - (previous ?? 0) + (paid ?? 0)) * 100) / 100;
  const difference = Math.round((rounded - expected) * 100) / 100;
  return { imported: rounded, expected, difference, ok: Math.abs(difference) <= CENT };
}

/**
 * ¿Lo que estamos por importar coincide con lo que dice el banco?
 *
 * En los dos resúmenes reales medidos, y en las dos monedas, esta identidad da
 * exactamente cero a 6 decimales:
 *
 *     Σ(filas del detalle)  =  TOTAL A PAGAR − SALDO ANTERIOR − SU PAGO
 *
 * El saldo anterior y el pago se restan porque no son consumos del período: son
 * el arrastre y su cancelación. Todo lo demás —compras, impuestos, percepciones,
 * intereses y devoluciones— son filas del detalle y están de los dos lados.
 */
export function reconcileStatement(rows: ReconcilableRow[], header: StatementHeader): Reconciliation {
  let ars = 0;
  let usd = 0;
  for (const row of rows) {
    // Una línea en dólares aporta a la columna USD; si además trae el importe en
    // pesos que la tarjeta cobró, ese va a la columna ARS. Nunca se mezclan.
    if (typeof row.amountUSD === 'number' && Number.isFinite(row.amountUSD)) {
      usd += row.amountUSD;
      if (typeof row.amountARS === 'number' && Number.isFinite(row.amountARS)) ars += row.amountARS;
    } else if (typeof row.amountARS === 'number' && Number.isFinite(row.amountARS)) {
      ars += row.amountARS;
    }
  }
  return {
    ars: side(ars, header.totalDue.ars, header.previousBalance.ars, header.payments.ars),
    usd: side(usd, header.totalDue.usd, header.previousBalance.usd, header.payments.usd),
  };
}
