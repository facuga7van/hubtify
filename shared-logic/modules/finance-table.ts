/**
 * Lector de tablas delimitadas (CSV / TSV) para extractos de billetera.
 *
 * **Por qué existe.** El import del resumen de tarjeta resuelve el setup y las
 * cuotas, pero el 67 % de lo que el usuario carga a mano son transferencias y
 * billeteras, y eso no está en ningún PDF de tarjeta: son 180 de las 330
 * interacciones de la auditoría, y se pagan TODOS los meses. Sin esta pieza el
 * rediseño mejora el mes de setup y deja intacto el de régimen.
 *
 * **Por qué genérico y no un parser por proveedor.** La investigación midió que
 * el CSV de Mercado Pago no es un formato sino una familia: separador de
 * columnas, separador decimal, idioma de los encabezados y alias de columna son
 * configurables por el usuario. Un parser por emisor envejece en cada cambio de
 * layout; un mapeo de columnas que la persona confirma una vez, no.
 *
 * Función pura: sin DB, sin plataforma. El mapeo elegido lo recuerda el
 * renderer en `localStorage` por firma de encabezado — es conveniencia de
 * dispositivo, no dato del usuario, así que no paga una tabla sincronizada.
 */

export type TableField = 'date' | 'description' | 'amount' | 'currency' | 'category' | 'ignore';

export interface TableColumnMapping {
  /** Índice de columna → qué significa. */
  [columnIndex: number]: TableField;
}

export interface ParsedTable {
  delimiter: string;
  /** `,` o `.` — cómo se escriben los decimales en ESTE archivo. */
  decimalSeparator: ',' | '.';
  headers: string[];
  /** Filas de celdas crudas, sin la de encabezados. */
  rows: string[][];
  /** Mapeo propuesto por nombre de columna; el usuario lo corrige. */
  suggested: TableColumnMapping;
}

const DELIMITERS = [',', ';', '\t', '|'];

/**
 * Encabezados conocidos, en español y en inglés. Deliberadamente cortos y por
 * inclusión: `Fecha de operación`, `Fecha`, `Transaction date` y `date` tienen
 * que caer todos en `date`.
 */
const HEADER_HINTS: Array<{ field: TableField; patterns: string[] }> = [
  { field: 'date', patterns: ['fecha', 'date', 'dia', 'día'] },
  { field: 'description', patterns: ['descripcion', 'descripción', 'detalle', 'concepto', 'comercio', 'description', 'detail', 'merchant', 'memo'] },
  { field: 'amount', patterns: ['monto', 'importe', 'valor', 'amount', 'value', 'total'] },
  { field: 'currency', patterns: ['moneda', 'divisa', 'currency'] },
  { field: 'category', patterns: ['categoria', 'categoría', 'rubro', 'category'] },
];

/** Sin tildes y en minúsculas. La clase del `replace` es el rango de marcas
 *  combinantes U+0300–U+036F que deja `normalize('NFD')`. */
const normalise = (v: string) =>
  v.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/**
 * Parte una línea respetando comillas dobles y el escape `""` de RFC 4180.
 * Un `split(delimiter)` pelado rompe cualquier descripción con una coma adentro
 * y corre TODAS las columnas siguientes — el error se ve tres meses después.
 */
export function splitDelimitedLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += ch;
    }
  }
  cells.push(cell.trim());
  return cells;
}

/**
 * El delimitador: el que produce MÁS columnas de forma CONSISTENTE en las
 * primeras líneas. Contar apariciones a secas elige la coma en un archivo con
 * punto y coma y decimales con coma — el caso argentino más común.
 */
export function sniffDelimiter(lines: string[]): string {
  const sample = lines.slice(0, 10);
  let best = ',';
  let bestScore = -1;
  for (const delimiter of DELIMITERS) {
    const counts = sample.map((l) => splitDelimitedLine(l, delimiter).length);
    const columns = counts[0] ?? 1;
    if (columns < 2) continue;
    const consistent = counts.every((c) => c === columns);
    const score = (consistent ? 100 : 0) + columns;
    if (score > bestScore) { bestScore = score; best = delimiter; }
  }
  return best;
}

/**
 * `,` o `.` como separador decimal: el que deje MÁS celdas leíbles como número.
 * `1.234,56` y `1,234.56` son la misma plata escrita al revés, y adivinarlo mal
 * mueve la coma tres lugares sin avisar.
 */
export function sniffDecimalSeparator(rows: string[][]): ',' | '.' {
  let comma = 0;
  let dot = 0;
  for (const row of rows.slice(0, 50)) {
    for (const cell of row) {
      if (!/\d/.test(cell)) continue;
      // `1.234,56` → decimales con coma. `1,234.56` → decimales con punto.
      if (/^-?\s*\$?\s*\d{1,3}(\.\d{3})+,\d{1,2}\s*$/.test(cell)) comma++;
      else if (/^-?\s*\$?\s*\d{1,3}(,\d{3})+\.\d{1,2}\s*$/.test(cell)) dot++;
      else if (/^-?\s*\$?\s*\d+,\d{1,2}\s*$/.test(cell)) comma++;
      else if (/^-?\s*\$?\s*\d+\.\d{1,2}\s*$/.test(cell)) dot++;
    }
  }
  // Empate (o ningún número reconocible): punto, que es lo que exporta la
  // mayoría de las herramientas cuando no la configuraron.
  return comma > dot ? ',' : '.';
}

/** `$ -1.234,56` → `-1234.56`. `null` si la celda no es un importe. */
export function parseTableAmount(cell: string, decimal: ',' | '.'): number | null {
  if (typeof cell !== 'string') return null;
  // `\s` ya cubre el espacio duro (U+00A0) que meten varios exportadores.
  let text = cell.trim().replace(/[\s$]/g, '');
  if (text === '') return null;
  // Contabilidad: `(1.234,56)` es negativo.
  let negative = false;
  if (/^\(.*\)$/.test(text)) { negative = true; text = text.slice(1, -1); }
  if (text.startsWith('-')) { negative = true; text = text.slice(1); }
  text = decimal === ',' ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const value = parseFloat(text);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

/**
 * Una fecha en cualquiera de las formas que exportan las billeteras argentinas.
 * `DD/MM/YYYY` gana sobre `MM/DD/YYYY` porque es el formato local; cuando el
 * primer número es > 12 no hay ambigüedad y se resuelve solo.
 */
export function parseTableDate(cell: string): string | null {
  if (typeof cell !== 'string') return null;
  const text = cell.trim();
  let m = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = text.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    if (day > 31 || month > 12 || day < 1 || month < 1) return null;
    const yearRaw = m[3];
    const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return null;
}

/** El mapeo propuesto, por nombre de encabezado. Lo que no se reconoce se ignora. */
export function suggestMapping(headers: string[]): TableColumnMapping {
  const mapping: TableColumnMapping = {};
  const taken = new Set<TableField>();
  headers.forEach((header, index) => {
    const key = normalise(header);
    mapping[index] = 'ignore';
    if (key === '') return;
    for (const hint of HEADER_HINTS) {
      if (taken.has(hint.field)) continue;
      if (hint.patterns.some((p) => key.includes(p))) {
        mapping[index] = hint.field;
        taken.add(hint.field);
        return;
      }
    }
  });
  return mapping;
}

export function parseDelimitedTable(text: string): ParsedTable | null {
  if (typeof text !== 'string') return null;
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return null;

  const delimiter = sniffDelimiter(lines);
  const all = lines.map((l) => splitDelimitedLine(l, delimiter));
  const headers = all[0];
  if (headers.length < 2) return null;
  // Filas con menos celdas que encabezados se completan en vez de descartarse:
  // una columna final vacía es normal en estas exportaciones.
  const rows = all.slice(1).map((r) => {
    const padded = r.slice(0, headers.length);
    while (padded.length < headers.length) padded.push('');
    return padded;
  });

  return {
    delimiter,
    decimalSeparator: sniffDecimalSeparator(rows),
    headers,
    rows,
    suggested: suggestMapping(headers),
  };
}

export interface TableRowDraft {
  date: string;
  description: string;
  amount: number;
  currency: 'ARS' | 'USD';
  category: string;
  /** Un importe negativo en el extracto es plata que ENTRÓ o que salió, según
   *  la convención del proveedor. Se decide en la UI, no acá. */
  raw: number;
}

/**
 * Aplica un mapeo y devuelve las filas utilizables y las que no.
 *
 * Las que no se pudieron leer se DEVUELVEN, no se tiran: la lección de la
 * auditoría es que lo que el importador descarta en silencio se descubre tres
 * meses después, con el total mal.
 */
export function applyMapping(
  table: ParsedTable,
  mapping: TableColumnMapping,
  defaults: { currency?: 'ARS' | 'USD'; category?: string } = {},
): { rows: TableRowDraft[]; skipped: Array<{ line: number; reason: 'date' | 'amount' }> } {
  const indexOf = (field: TableField): number => {
    for (const [key, value] of Object.entries(mapping)) {
      if (value === field) return Number(key);
    }
    return -1;
  };
  const dateCol = indexOf('date');
  const descCol = indexOf('description');
  const amountCol = indexOf('amount');
  const currencyCol = indexOf('currency');
  const categoryCol = indexOf('category');

  const rows: TableRowDraft[] = [];
  const skipped: Array<{ line: number; reason: 'date' | 'amount' }> = [];

  table.rows.forEach((cells, i) => {
    const date = dateCol >= 0 ? parseTableDate(cells[dateCol] ?? '') : null;
    if (date === null) { skipped.push({ line: i + 2, reason: 'date' }); return; }
    const raw = amountCol >= 0 ? parseTableAmount(cells[amountCol] ?? '', table.decimalSeparator) : null;
    if (raw === null) { skipped.push({ line: i + 2, reason: 'amount' }); return; }

    const currencyCell = currencyCol >= 0 ? (cells[currencyCol] ?? '').toUpperCase() : '';
    const currency: 'ARS' | 'USD' = currencyCell.includes('USD') || currencyCell.includes('DOLAR') || currencyCell.includes('DÓLAR')
      ? 'USD'
      : currencyCell.includes('ARS') || currencyCell.includes('PESO')
        ? 'ARS'
        : (defaults.currency ?? 'ARS');

    rows.push({
      date,
      description: (descCol >= 0 ? cells[descCol] : '')?.trim() || '',
      amount: Math.abs(raw),
      currency,
      category: (categoryCol >= 0 ? cells[categoryCol] : '')?.trim() || defaults.category || 'Otros',
      raw,
    });
  });

  return { rows, skipped };
}
