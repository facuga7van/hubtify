/**
 * Guardia anti-deriva.
 *
 * La conciliación está implementada dos veces a propósito: en `shared-logic`
 * (para el import) y en el renderer (para recalcularla en vivo mientras el
 * usuario marca y desmarca filas, sin un viaje IPC por checkbox). Este test
 * corre las dos sobre la misma fixture y compara los números: si alguien toca
 * una fórmula y no la otra, falla acá y no en la base del usuario.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseGaliciaStatement,
  reconcileStatement,
} from '../../../shared-logic/modules/finance-statement';
import { parseGaliciaLine } from '../../../shared-logic/modules/finance-import.ipc';
import { reconcile, reconStatus } from '@modules/finance/utils/statement-recon';
import type { StatementHeaderDto } from '../../../shared/types';

const FIXTURE = readFileSync(
  join(__dirname, '../../fixtures/statements/galicia-visa-synthetic.txt'),
  'utf8',
);

function parseRows(text: string) {
  const rows = [];
  for (const raw of text.split('\n')) {
    const parsed = parseGaliciaLine(raw.trim(), new Map());
    if (parsed) rows.push(parsed);
  }
  return rows;
}

describe('conciliación: shared-logic y renderer dicen lo mismo', () => {
  const header = parseGaliciaStatement(FIXTURE);
  const rows = parseRows(FIXTURE);
  const dto = header as unknown as StatementHeaderDto;

  it('con el resumen completo', () => {
    expect(reconcile(rows, dto)).toEqual(reconcileStatement(rows, header));
  });

  it('con filas desmarcadas', () => {
    const partial = rows.slice(0, 4);
    expect(reconcile(partial, dto)).toEqual(reconcileStatement(partial, header));
  });

  it('sin ninguna fila', () => {
    expect(reconcile([], dto)).toEqual(reconcileStatement([], header));
  });

  it('sin totales en el papel', () => {
    const noTotals = FIXTURE.replace('TOTAL A PAGAR 18.192,00 10,00', 'TOTAL A PAGAR');
    const h = parseGaliciaStatement(noTotals);
    const r = parseRows(noTotals);
    expect(reconcile(r, h as unknown as StatementHeaderDto)).toEqual(reconcileStatement(r, h));
  });
});

describe('reconStatus — «sin checksum» no es «cierra»', () => {
  const header = parseGaliciaStatement(FIXTURE) as unknown as StatementHeaderDto;

  it('ok cuando todas las monedas con checksum cierran', () => {
    expect(reconStatus(reconcile(parseRows(FIXTURE), header))).toBe('ok');
  });

  it('off cuando falta algo', () => {
    expect(reconStatus(reconcile(parseRows(FIXTURE).slice(0, 3), header))).toBe('off');
  });

  it('none sin encabezado, y none sin totales', () => {
    expect(reconStatus(reconcile(parseRows(FIXTURE), null))).toBe('none');
    const noTotals = parseGaliciaStatement(
      FIXTURE.replace('TOTAL A PAGAR 18.192,00 10,00', 'TOTAL A PAGAR'),
    ) as unknown as StatementHeaderDto;
    expect(reconStatus(reconcile(parseRows(FIXTURE), noTotals))).toBe('none');
  });
});
