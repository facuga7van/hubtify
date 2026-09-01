import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Dos agujeros que se abrieron solos y que nadie iba a ver hasta usar la app:
 *
 * 1. La Crónica del panel imprime el tipo crudo cuando no hay traducción, así
 *    que un evento nuevo aparece como `ACHIEVEMENT_UNLOCKED` en el medio de
 *    una lista en castellano. Pasó con siete tipos a la vez.
 * 2. Un logro puede quedar esperando un tipo de evento que ya nadie emite —
 *    `second_chance` esperaba NUTRITION_DAY_REOPENED después de que la
 *    reapertura pasara a emitir DAY_REOPENED. Ese logro no se podía
 *    desbloquear nunca, y en verde: ningún test lo tocaba.
 *
 * Estos guards leen el código, no una lista paralela que también se puede
 * desactualizar.
 */

const ROOT = path.join(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf-8');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

/** Every type handed to processRpgEvent from anywhere, plus the engine's own. */
function emittedTypes(): Set<string> {
  const types = new Set<string>();
  for (const file of [...walk('src'), ...walk('electron')]) {
    // Por línea, no por literal suelto: el tipo puede venir de un ternario
    // (`type: kind === 'income' ? 'INCOME_LOGGED' : 'EXPENSE_LOGGED'`), y un
    // scan de `type: 'X'` a secas se lo pierde y reporta logros muertos falsos.
    for (const line of read(file).split(/\r?\n/)) {
      if (!line.includes('type:')) continue;
      for (const m of line.matchAll(/'([A-Z][A-Z_]{3,})'/g)) types.add(m[1]);
    }
  }
  // The engine writes these two itself, never through a caller.
  types.add('ACHIEVEMENT_UNLOCKED');
  types.add('DAY_SEALED');
  return types;
}

const labels = (lang: 'es' | 'en'): Record<string, string> =>
  JSON.parse(read(`src/i18n/${lang}.json`)).events;

describe('la Crónica sabe nombrar todo lo que el motor escribe', () => {
  it('cada tipo de evento emitido tiene etiqueta en los dos idiomas', () => {
    const es = labels('es');
    const en = labels('en');
    const missing: string[] = [];
    for (const type of emittedTypes()) {
      if (!es[type]) missing.push(`es.${type}`);
      if (!en[type]) missing.push(`en.${type}`);
    }
    expect(missing, `sin traducir: ${missing.join(', ')}`).toEqual([]);
  });

  it('no sobran etiquetas de tipos que ya nadie emite', () => {
    const emitted = emittedTypes();
    // Etiquetas que se conservan a propósito aunque hoy nadie emita el tipo:
    // LEVEL_UP nunca fue una fila de rpg_events, EXPENSE_TRACKED es el nombre
    // legacy que el motor todavía acepta, y RECURRING_UPDATED está declarado
    // como handler de Coinify pero ningún camino lo emite todavía.
    const historical = new Set(['LEVEL_UP', 'EXPENSE_TRACKED', 'RECURRING_UPDATED']);
    const orphans = Object.keys(labels('es')).filter((t) => !emitted.has(t) && !historical.has(t));
    expect(orphans, `etiquetas huérfanas: ${orphans.join(', ')}`).toEqual([]);
  });
});

describe('ningún logro espera un evento que nadie emite', () => {
  it('todo tipo nombrado por un matcher del catálogo se emite en algún lado', () => {
    const src = read('shared/achievements.ts');
    const referenced = new Set<string>();
    // `n(c.countByType, 'X')` y `c.byType['X']` son las dos formas de mirar tipos.
    for (const m of src.matchAll(/countByType,\s*'([A-Z][A-Z_]{3,})'/g)) referenced.add(m[1]);
    for (const m of src.matchAll(/byType\[\s*'([A-Z][A-Z_]{3,})'\s*\]/g)) referenced.add(m[1]);

    expect(referenced.size, 'el scan no encontró ningún matcher por tipo').toBeGreaterThan(0);

    const emitted = emittedTypes();
    const dead = [...referenced].filter((t) => !emitted.has(t));
    expect(dead, `logros imposibles, esperan: ${dead.join(', ')}`).toEqual([]);
  });
});
