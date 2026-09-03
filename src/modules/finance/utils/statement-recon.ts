import type { StatementHeaderDto } from '../../../../shared/types';

/**
 * La conciliación, del lado del renderer.
 *
 * Existe acá además de en `shared-logic/modules/finance-statement.ts` porque
 * tiene que recalcularse EN VIVO mientras el usuario marca y desmarca filas del
 * preview: pedírselo al backend en cada clic sería un viaje por checkbox.
 *
 * La fórmula es la misma, y `tests/modules/finance/finance.statement-recon.test.ts`
 * corre las dos implementaciones sobre la misma fixture y compara los números,
 * así que no pueden derivar en silencio.
 */

export interface ReconRow {
  amountARS?: number;
  amountUSD?: number;
}

export interface ReconSide {
  imported: number;
  expected: number | null;
  difference: number | null;
  /** `true` cierra · `false` no cierra · `null` faltan totales: no hay checksum. */
  ok: boolean | null;
}

export interface Recon {
  ars: ReconSide;
  usd: ReconSide;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function side(
  imported: number,
  totalDue: number | null,
  previous: number | null,
  paid: number | null,
): ReconSide {
  const rounded = round2(imported);
  if (totalDue === null || totalDue === undefined) {
    return { imported: rounded, expected: null, difference: null, ok: null };
  }
  // `paid` viene en magnitud positiva: canceló arrastre, no consumo del período.
  const expected = round2(totalDue - (previous ?? 0) + (paid ?? 0));
  const difference = round2(rounded - expected);
  return { imported: rounded, expected, difference, ok: Math.abs(difference) <= 0.01 };
}

/**
 *     Σ(filas del detalle)  =  TOTAL A PAGAR − SALDO ANTERIOR + SU PAGO
 *
 * Medido contra los dos resúmenes reales del usuario: da exactamente cero en
 * las dos monedas, a 6 decimales. La primera vez que se corrió, la única
 * diferencia que apareció era una fila que el parser estaba perdiendo.
 */
export function reconcile(rows: ReconRow[], header: StatementHeaderDto | null | undefined): Recon | null {
  if (!header) return null;
  let ars = 0;
  let usd = 0;
  for (const row of rows) {
    if (typeof row.amountUSD === 'number' && Number.isFinite(row.amountUSD)) {
      usd += row.amountUSD;
      if (typeof row.amountARS === 'number' && Number.isFinite(row.amountARS)) ars += row.amountARS;
    } else if (typeof row.amountARS === 'number' && Number.isFinite(row.amountARS)) {
      ars += row.amountARS;
    }
  }
  return {
    ars: side(ars, header.totalDue?.ars ?? null, header.previousBalance?.ars ?? null, header.payments?.ars ?? null),
    usd: side(usd, header.totalDue?.usd ?? null, header.previousBalance?.usd ?? null, header.payments?.usd ?? null),
  };
}

/** Cuántas monedas tienen checksum, y si TODAS las que lo tienen cierran. */
export function reconStatus(recon: Recon | null): 'ok' | 'off' | 'none' {
  if (!recon) return 'none';
  const sides = [recon.ars, recon.usd].filter((s) => s.ok !== null);
  if (sides.length === 0) return 'none';
  return sides.every((s) => s.ok === true) ? 'ok' : 'off';
}
