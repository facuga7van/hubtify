/**
 * UNA SOLA PALABRA POR CONCEPTO — guardia del vocabulario (C11 recorrido / C12 diseño)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 * ---------------------------
 * El commit `b8bc72f` se tituló «una sola palabra por concepto (Vigor, Hábito,
 * Misión)» y la tercera medición de la rúbrica lo desmintió con números: habían
 * quedado «HP» en 11 valores de `es.json`, «tarea» en 11 y «ritual» en 8 cadenas
 * de respaldo del TSX. La limpieza se hizo a ojo, sobre el catálogo, y se olvidó
 * de la capa de respaldo — que es justamente donde vive la definición POR DEFECTO
 * del vocabulario: si falta la clave, eso es lo que lee el usuario.
 *
 * Una limpieza que nadie vigila se degrada en la vuelta siguiente. Este test es
 * la vigilancia: mide las TRES capas (valor en `es.json`, valor en `en.json`, y
 * el respaldo `t('clave', 'RESPALDO')` en cualquier `.ts`/`.tsx` de `src/`) y
 * falla si vuelve a entrar una palabra descartada.
 *
 * LAS DECISIONES, Y POR QUÉ
 * -------------------------
 *  Concepto        │ Español      │ Inglés  │ Descartado
 *  ────────────────┼──────────────┼─────────┼──────────────────────────────────
 *  Barra de vida   │ Vigor        │ Vigor   │ HP (suelto), SALUD, VITA
 *  Unidad de       │ Misión       │ Quest   │ tarea, task
 *   Questify       │              │         │
 *  Sub-unidad      │ paso         │ step    │ subtarea, subtask
 *  Repetición      │ Hábito       │ Habit   │ ritual (como sustantivo-entidad)
 *  Kcal del día    │ objetivo     │ target  │ meta
 *
 * «Misión» y «Quest» son la misma cosa en dos idiomas, y está BIEN: el objetivo
 * es una palabra por concepto DENTRO de cada idioma, no la misma palabra en los
 * dos. Por eso el inglés conserva «Quest» y no se castellaniza.
 *
 * «Subtarea» se reemplazó por «paso» y no por «submisión» porque «subtarea»
 * reintroduce «tarea» —la palabra que estamos sacando— y «submisión» en
 * castellano se lee como «sumisión». Una misión se completa en pasos.
 *
 * «Meta» se plegó a «objetivo» porque el mismo número (las kcal del día) se
 * llamaba «Meta diaria» en 7 valores y «objetivo diario» en otros 25. En inglés
 * NO se toca: ahí «target» (el número) y «goal» (déficit/superávit/mantenimiento)
 * son dos conceptos distintos con dos palabras distintas, que es exactamente lo
 * que este test pide.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');
const SRC = join(ROOT, 'src');

type Entry = { where: string; key: string; text: string };

function flatten(obj: unknown, prefix: string, out: Entry[], where: string): Entry[] {
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.push({ where, key, text: v });
    else if (v && typeof v === 'object') flatten(v, key, out, where);
  }
  return out;
}

function walkTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkTs(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const catalogo = (file: string): Entry[] =>
  flatten(JSON.parse(readFileSync(join(SRC, 'i18n', file), 'utf8')), '', [], file);

const ES = catalogo('es.json');
const EN = catalogo('en.json');

/**
 * Los respaldos: `t('clave', 'texto por defecto')`. Sólo el segundo argumento
 * literal — no interpolaciones ni variables, que no son vocabulario fijo.
 *
 * FUERA DE ALCANCE A PROPÓSITO: `src/shared/changelog.ts`. Sus cadenas no son
 * respaldos de `t()` sino el registro fechado de lo que ya se publicó; corregirle
 * el vocabulario a una nota de la 0.7.3 sería falsificar el historial. La entrada
 * de la versión en curso sí se mantiene a mano, con el vocabulario vigente.
 */
const FALLBACK = /\bt\(\s*(['"])([\w.$-]+)\1\s*,\s*(['"])((?:\\.|(?!\3)[^\\])*)\3/g;
const RESPALDOS: Entry[] = walkTs(SRC).flatMap((file) => {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  return [...readFileSync(file, 'utf8').matchAll(FALLBACK)].map((m) => ({
    where: rel,
    key: m[2],
    text: m[4],
  }));
});

const listar = (entries: Entry[], re: RegExp) =>
  entries.filter((e) => re.test(e.text)).map((e) => `${e.where} → ${e.key}: «${e.text.slice(0, 90)}»`);

/* ── Las palabras descartadas ──────────────────────────────────────────────
 *
 * Cada regex apunta a UNA palabra que perdió, y el mensaje dice cuál ganó.
 * Se aplican a los dos catálogos y a los respaldos, con el idioma que
 * corresponde: el castellano vale para `es.json` y para los respaldos (que
 * son en castellano, porque el español es `fallbackLng`).
 */
const DESCARTADAS_ES: Array<{ palabra: string; re: RegExp; usar: string }> = [
  { palabra: 'ritual/rituales', re: /\brituales?\b/i, usar: 'Hábito' },
  { palabra: 'tarea/subtarea', re: /\b(sub)?tareas?\b/i, usar: 'Misión (y «paso» para la sub-unidad)' },
  { palabra: 'task/subtask (inglés colado en el catálogo español)', re: /\b(sub)?tasks?\b/i, usar: 'Misión' },
  { palabra: 'SALUD / VITA', re: /\b(salud|vita)\b/i, usar: 'Vigor' },
  { palabra: 'meta/metas', re: /\bmetas?\b/i, usar: 'objetivo' },
];

const DESCARTADAS_EN: Array<{ palabra: string; re: RegExp; usar: string }> = [
  { palabra: 'ritual/rituals', re: /\brituals?\b/i, usar: 'Habit' },
  { palabra: 'task/subtask', re: /\b(sub)?tasks?\b/i, usar: 'Quest (y «step» para la sub-unidad)' },
];

describe('vocabulario — una sola palabra por concepto', () => {
  it('el censo lee las tres capas (si esto falla, el arnés se rompió, no el texto)', () => {
    expect(ES.length).toBeGreaterThan(1500);
    expect(EN.length).toBe(ES.length); // paridad de claves entre catálogos
    expect(RESPALDOS.length).toBeGreaterThan(500);
  });

  describe('es.json', () => {
    for (const { palabra, re, usar } of DESCARTADAS_ES) {
      it(`no dice «${palabra}» — se usa «${usar}»`, () => {
        expect(listar(ES, re)).toEqual([]);
      });
    }
  });

  describe('en.json', () => {
    for (const { palabra, re, usar } of DESCARTADAS_EN) {
      it(`no dice «${palabra}» — se usa «${usar}»`, () => {
        expect(listar(EN, re)).toEqual([]);
      });
    }
  });

  describe('respaldos t() en src/**', () => {
    for (const { palabra, re, usar } of DESCARTADAS_ES) {
      it(`ningún respaldo dice «${palabra}» — se usa «${usar}»`, () => {
        expect(listar(RESPALDOS, re)).toEqual([]);
      });
    }
  });

  /* ── LA EXCEPCIÓN DOCUMENTADA: «HP» dentro del par «XP y HP» ────────────
   *
   * En los textos de cierre de Nutrify «HP» no es el rótulo de la barra: es la
   * mitad de un par abreviado, «XP y HP» / «XP and HP», donde las dos siglas
   * viajan juntas. Ahí «HP» es correcto por la misma razón por la que «XP» no
   * se traduce a «experiencia»: es la sigla de la unidad, no el nombre del
   * concepto. Un «HP» SUELTO —una barra, una estadística, una tarjeta— sí es
   * el rótulo, y ése va a «Vigor» (así se corrigieron `hpExplanation`,
   * `scoringBands`, `dayStatus.over` y la ficha del tour).
   *
   * La regla se verifica de dos maneras, y las dos importan:
   *   1. Todo «HP» que sobreviva tiene que estar acompañado de «XP» en la misma
   *      cadena. Es la regla real, y no depende de una lista.
   *   2. El conjunto de claves con «HP» tiene que ser EXACTAMENTE el de abajo.
   *      Sin esto, alguien puede escribir «ganás XP y HP por cada barra de HP»
   *      y pasar la regla 1. La lista obliga a que agregar un «HP» nuevo sea una
   *      decisión consciente que se toma acá, y no un descuido.
   */
  const HP_PERMITIDO = [
    'nutrify.closeDayDesc',
    'nutrify.closeDayHelp',
    'nutrify.closeDayLockWarning',
    'nutrify.closeDayTitle',
    'nutrify.reopenDayConfirm',
    'nutrify.reopenDaySuccess',
    'nutrify.reopenDayWarning',
  ];
  const HP = /\bHP\b/;

  describe('«HP» sólo sobrevive como mitad del par «XP y HP»', () => {
    for (const [nombre, entries] of [['es.json', ES], ['en.json', EN]] as const) {
      it(`${nombre}: cada «HP» viene con su «XP» al lado`, () => {
        const sueltos = entries.filter((e) => HP.test(e.text) && !/\bXP\b/.test(e.text));
        expect(sueltos.map((e) => `${e.key}: «${e.text}»`)).toEqual([]);
      });

      it(`${nombre}: las claves con «HP» son exactamente las ${HP_PERMITIDO.length} exceptuadas`, () => {
        const conHp = entries.filter((e) => HP.test(e.text)).map((e) => e.key).sort();
        expect(conHp).toEqual([...HP_PERMITIDO].sort());
      });
    }

    it('respaldos: cada «HP» viene con su «XP» al lado', () => {
      const sueltos = RESPALDOS.filter((e) => HP.test(e.text) && !/\bXP\b/.test(e.text));
      expect(sueltos.map((e) => `${e.where} → ${e.key}: «${e.text}»`)).toEqual([]);
    });

    it('respaldos: los «HP» que quedan son de claves exceptuadas', () => {
      const claves = [...new Set(RESPALDOS.filter((e) => HP.test(e.text)).map((e) => e.key))];
      expect(claves.filter((k) => !HP_PERMITIDO.includes(k))).toEqual([]);
    });
  });

  /* ── Ojo con lo que NO se prohíbe, para que nadie lo "arregle" de más ──
   *
   *  · `rpg.vita` sigue existiendo COMO NOMBRE DE CLAVE (`es.json`/`en.json`) y
   *    lo consume `CharacterPage.tsx`. El nombre de la clave es interno, el
   *    usuario no lo ve; su VALOR y su respaldo dicen «VIGOR» en los dos
   *    idiomas, que es lo único que se lee en pantalla. Renombrar la clave es un
   *    cambio de código, no de vocabulario.
   *  · El logro `ritualist` / «Ritualista» conserva su nombre propio: es el
   *    título de un logro, emparejado con un id que ya viaja en la base y en el
   *    sync. Como sustantivo-entidad no aparece («Ritualista» no matchea
   *    `\brituales?\b`), así que no contamina el vocabulario.
   *  · «De Ritibus Quotidianis» es el subtítulo latino del tomo de hábitos:
   *    decoración del códice, no vocabulario de producto.
   *  · «gasto» (36 valores) no compite con «egreso»: «egreso» sólo aparece en un
   *    comentario de `finance/types.ts:50`, nunca en la interfaz. No hay par.
   */
  it('el nombre de la barra dice «Vigor» en las dos capas y en los dos idiomas', () => {
    const buscar = (entries: Entry[], key: string) => entries.find((e) => e.key === key)?.text;
    for (const cat of [ES, EN]) {
      expect(buscar(cat, 'rpg.vigor')?.toLowerCase()).toContain('vigor');
      expect(buscar(cat, 'rpg.vita')?.toLowerCase()).toContain('vigor');
      expect(buscar(cat, 'dashboard.cartHp')?.toLowerCase()).toContain('vigor');
      expect(buscar(cat, 'character.statMaxHp')?.toLowerCase()).toContain('vigor');
    }
    for (const key of ['rpg.vigor', 'rpg.vita', 'dashboard.cartHp', 'character.statMaxHp']) {
      const usos = RESPALDOS.filter((e) => e.key === key);
      expect(usos.length, `nadie usa ${key} con respaldo`).toBeGreaterThan(0);
      for (const u of usos) expect(u.text.toLowerCase(), `${u.where} → ${key}`).toContain('vigor');
    }
  });
});
