/**
 * Reparte un total financiado en N cuotas.
 *
 * Una compra en cuotas se piensa por el total («la heladera salió 900 mil en
 * 12»), no por el precio de la cuota, y hasta ahora había que hacer la división
 * a mano antes de cargarla. El detalle que importa: la suma de las cuotas tiene
 * que dar EXACTAMENTE el total tipeado. 100.000 en 3 no son tres cuotas de
 * 33.333,33 (eso da 99.999,99): son dos de 33.333,33 y una de 33.333,34.
 *
 * Las primeras cuotas van redondeadas a dos decimales y la última absorbe la
 * diferencia — el mismo criterio con el que un comercio arma un plan.
 */
export interface TotalSplit {
  /** Lo que sale cada cuota menos la última. */
  per: number;
  /** La última, que se lleva el resto del redondeo. */
  last: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function splitTotalIntoInstallments(total: number, count: number): TotalSplit | null {
  if (!Number.isFinite(total) || !Number.isFinite(count)) return null;
  if (total <= 0 || count < 1 || !Number.isInteger(count)) return null;

  const per = round2(total / count);
  const last = round2(total - per * (count - 1));
  return { per, last };
}

/** La lista completa de montos, para mandarla al plan. */
export function installmentAmountsFromTotal(total: number, count: number): number[] | null {
  const split = splitTotalIntoInstallments(total, count);
  if (!split) return null;
  return [...Array(Math.max(0, count - 1)).fill(split.per), split.last];
}
