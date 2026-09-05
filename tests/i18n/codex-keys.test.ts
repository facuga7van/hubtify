/**
 * Claves `rpg.codex*` sin dueño.
 *
 * El rediseño «un solo veredicto» (2026-09-05) dejó trece claves huérfanas de
 * golpe: cartuchos, bolsa, desglose de vigor. Una clave que nadie lee es texto
 * que se traduce, se revisa y se mantiene para nadie. Este guardia pide que
 * toda clave `rpg.codex*` de valor string sea leída por algún `.ts`/`.tsx`
 * de `src/` como `'rpg.<clave>'` literal (las `_one`/`_other` se leen por su
 * base, con `count`). `codexPhrases` es un objeto y se lee por template
 * literal en `codexPhrases.ts`: queda fuera por construcción.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');
const SRC = join(ROOT, 'src');

function walkTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkTs(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const SOURCE = walkTs(SRC).map((f) => readFileSync(f, 'utf8')).join('\n');

function codexKeys(file: string): string[] {
  const rpg = JSON.parse(readFileSync(join(SRC, 'i18n', file), 'utf8')).rpg as Record<string, unknown>;
  return Object.entries(rpg)
    .filter(([k, v]) => k.startsWith('codex') && typeof v === 'string')
    .map(([k]) => k);
}

const base = (k: string) => k.replace(/_(one|other)$/, '');

describe('rpg.codex* — ninguna clave sin dueño', () => {
  for (const file of ['es.json', 'en.json']) {
    it(`${file}: toda clave rpg.codex* se lee desde src/`, () => {
      const huerfanas = codexKeys(file).filter((k) => !SOURCE.includes(`'rpg.${base(k)}'`));
      expect(huerfanas).toEqual([]);
    });
  }

  it('los dos catálogos tienen las mismas claves rpg.codex*', () => {
    expect(codexKeys('es.json').sort()).toEqual(codexKeys('en.json').sort());
  });
});
