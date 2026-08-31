/**
 * One normalization, two runtimes.
 *
 * "Milanesa con Puré" and "milanesa con pure" are the SAME meal, and the whole
 * of phase 2 leans on that: the history autocomplete groups by it, and the AI
 * cache uses it as a PRIMARY KEY. If JavaScript and SQLite disagreed about what
 * a description normalises to — even for one character — a cached estimate would
 * be written under one key and looked up under another, and the cache would
 * silently never hit.
 *
 * So there is exactly one algorithm here, expressed twice:
 *
 *   - `normalizeDescription()` runs it in JS (queries, cache keys, tests).
 *   - `sqlNormalizeExpr()` EMITS the same algorithm as a SQLite expression,
 *     which migration v12 embeds in the `description_norm` generated columns.
 *
 * Both are generated from the same `FOLD_PAIRS` table, and a test asserts they
 * agree character by character over a corpus. That parity is the reason the
 * algorithm looks deliberately primitive:
 *
 *   1. Fold accents via an explicit table (SQLite has no Unicode normalisation).
 *      Uppercase accented letters fold straight to the lowercase ASCII letter,
 *      because step 2 cannot lower them.
 *   2. Lowercase ASCII A-Z ONLY. SQLite's `lower()` is ASCII-only; JS
 *      `toLowerCase()` is Unicode-aware, so using it here would diverge on any
 *      letter outside the fold table (Ł, Ø, Cyrillic…).
 *   3. Turn tab / CR / LF into spaces, then collapse runs of spaces with five
 *      rounds of `'  ' -> ' '`. SQLite has no regex; five halvings flatten any
 *      run up to 32 spaces, which is far past anything a human types. JS does
 *      the identical five rounds rather than a regex, so the two cannot drift.
 *   4. Trim.
 */

/**
 * Accented character -> ASCII replacement, applied before lowercasing.
 *
 * Uppercase entries map directly to the LOWERCASE ascii letter: step 2 only
 * lowercases A-Z, so 'É' has to arrive at 'e' in a single hop.
 *
 * `ñ` folds to `n` and `ç` to `c`: someone typing "noquis" or "nino" should find
 * "ñoquis" and "niño". The theoretical cost is collapsing pairs like año/ano,
 * which as FOOD DESCRIPTIONS never collide.
 */
export const FOLD_PAIRS: ReadonlyArray<readonly [string, string]> = (() => {
  const groups: Array<[string, string]> = [
    ['a', 'áàäâãå'],
    ['e', 'éèëê'],
    ['i', 'íìïî'],
    ['o', 'óòöôõ'],
    ['u', 'úùüû'],
    ['n', 'ñ'],
    ['c', 'ç'],
  ];
  const pairs: Array<[string, string]> = [];
  for (const [ascii, accents] of groups) {
    for (const ch of accents) {
      pairs.push([ch, ascii]);
      // The uppercase form maps to the same LOWERCASE ascii letter.
      pairs.push([ch.toUpperCase(), ascii]);
    }
  }
  return pairs;
})();

/** How many `'  ' -> ' '` rounds both implementations run. Five flattens 32 spaces. */
export const SPACE_COLLAPSE_ROUNDS = 5;

/**
 * The canonical key for a food description: lower, unaccented, single-spaced.
 *
 * Must stay byte-identical to `sqlNormalizeExpr()`; see the file header.
 */
export function normalizeDescription(input: string | null | undefined): string {
  if (!input) return '';
  let s = String(input);

  // 1. Accents, via the shared table.
  for (const [from, to] of FOLD_PAIRS) {
    if (s.includes(from)) s = s.split(from).join(to);
  }

  // 2. ASCII lowercase only — SQLite's lower() cannot do more than this.
  s = s.replace(/[A-Z]/g, (c) => c.toLowerCase());

  // 3. Whitespace to spaces, then collapse.
  s = s.split('\t').join(' ').split('\n').join(' ').split('\r').join(' ');
  for (let i = 0; i < SPACE_COLLAPSE_ROUNDS; i++) s = s.split('  ').join(' ');

  // 4. Trim.
  return s.trim();
}

/**
 * The same algorithm as a SQLite scalar expression over `col`.
 *
 * Used by migration v12 to define the `description_norm` GENERATED columns. It
 * is built here, from `FOLD_PAIRS`, precisely so nobody can "fix" one side and
 * forget the other.
 */
export function sqlNormalizeExpr(col: string): string {
  // 1. Accents.
  let expr = col;
  for (const [from, to] of FOLD_PAIRS) {
    expr = `replace(${expr}, '${from}', '${to}')`;
  }

  // 2. ASCII lowercase (SQLite lower() is ASCII-only, which is exactly step 2).
  expr = `lower(${expr})`;

  // 3. Whitespace to spaces, then collapse.
  expr = `replace(replace(replace(${expr}, char(9), ' '), char(10), ' '), char(13), ' ')`;
  for (let i = 0; i < SPACE_COLLAPSE_ROUNDS; i++) {
    expr = `replace(${expr}, '  ', ' ')`;
  }

  // 4. Trim.
  return `trim(${expr})`;
}
