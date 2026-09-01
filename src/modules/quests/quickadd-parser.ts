import type { TaskTier } from './types';

/**
 * Natural-language parsing for the Ctrl+Q quick-add box (Questify — Fase 2).
 *
 * Pure logic on purpose: no React, no i18n, no `window`, no new dependencies.
 * Everything the modal needs to *paint* what it understood (offsets) and to
 * *undo* it (the escape marker) is part of the returned value.
 *
 * ── The golden rule ────────────────────────────────────────────────────────
 * If nothing is recognised, `title === input.trim()` and every other field is
 * null. Someone who types plain prose must get exactly today's behaviour, byte
 * for byte — whitespace is only collapsed where a token was actually cut out.
 *
 * ── The escape hatch ───────────────────────────────────────────────────────
 * A backslash immediately before a word suppresses that word's token:
 * `\mañana` keeps "mañana" in the title. The backslash is stripped from the
 * title, and — this matters for the no-regression rule — it is stripped ONLY
 * when the word it precedes would really have been a token. `C:\Users` and
 * `\hola` survive untouched.
 *
 * The modal's confirmation line uses the same mechanism: clicking a fragment
 * inserts the backslash into the raw text (see `escapeTokens`), so the manual
 * prefix and the click are literally one feature.
 */

/* ── Public shapes ─────────────────────────────────────────────────────── */

export interface QuickAddProjectRef {
  id: string;
  name: string;
}

export type QuickAddTokenKind = 'date' | 'time' | 'tier' | 'project';

export interface QuickAddToken {
  kind: QuickAddTokenKind;
  /** The matched source text, exactly as typed. */
  text: string;
  /** Offset into the raw input where the match starts. */
  start: number;
  /** Exclusive end offset. */
  end: number;
}

export interface QuickAddParseResult {
  /** What goes into `task.name`. Never empty unless the input was blank. */
  title: string;
  /** 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm' — the shape `tasks.due_date` stores. */
  dueDate: string | null;
  /** Day part of `dueDate`, for rendering. */
  dueDay: string | null;
  /** 'HH:mm' when a time was recognised, else null. */
  dueTime: string | null;
  /** null means "leave the picker on whatever the user chose". */
  tier: TaskTier | null;
  projectId: string | null;
  projectName: string | null;
  /** Accepted tokens, in source order. */
  tokens: QuickAddToken[];
}

export interface QuickAddParseOptions {
  projects?: QuickAddProjectRef[];
  /** Injectable clock — the whole module is deterministic under test. */
  now?: Date;
}

/* ── Normalisation ─────────────────────────────────────────────────────── */

const COMBINING_MARKS = /[\u0300-\u036f]/g;

/** Lowercase + accent-stripped. `Miércoles`, `MIERCOLES` and `miercoles` agree. */
export function normalizeWord(word: string): string {
  return word.normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase();
}

/* ── Vocabulary ────────────────────────────────────────────────────────── */

/** ISO-ish JS weekday numbers (0 = Sunday), keyed by the accent-free name. */
const WEEKDAY_NUMBER: Record<string, number> = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3,
  jueves: 4, viernes: 5, sabado: 6,
};

const TIER_WORD: Record<string, TaskTier> = {
  rapida: 1, normal: 2, epica: 3,
};

const DAY_NOUNS = new Set(['dia', 'dias']);

const WEEK_NOUNS = new Set(['semana', 'semanas']);

const HOUR_MARKERS = new Set(['hs', 'h']);

const MERIDIEM = new Set(['am', 'pm']);

/**
 * Determiners that introduce a date without adding meaning: "el lunes",
 * "este viernes", "la próxima semana".
 *
 * They are consumed WITH the date they introduce — leaving "Reunión el" as the
 * title reads like a bug. They never form a date on their own, and because the
 * lookahead re-enters `matchAt` the `NOUN_GUARD` still fires from inside it, so
 * "por la mañana" stays plain text.
 */
const DETERMINERS = new Set(['el', 'la', 'este', 'esta', 'proximo', 'proxima']);

/**
 * Words that turn `mañana` / `pasado` into ordinary nouns.
 *
 * "por la mañana" is a time of day, "el año pasado" is history — neither is a
 * due date. Deliberately NOT applied to weekdays: "el lunes" is a date and
 * blocking it would be worse than the false positives it prevents.
 */
const NOUN_GUARD = new Set([
  'la', 'las', 'un', 'una', 'el', 'los',
  'ano', 'mes', 'semana', 'fin', 'siglo',
]);

/* ── Date helpers (all local time, no UTC round-trips) ─────────────────── */

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toDayString(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(now: Date, n: number): string {
  return toDayString(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));
}

/** The NEXT occurrence, strictly in the future: "lunes" on a Monday is +7. */
function nextWeekday(now: Date, target: number): string {
  const delta = ((target - now.getDay() + 7) % 7) || 7;
  return addDays(now, delta);
}

/**
 * `DD/MM` or `DD-MM` in the current year, rolled to the next one when the day
 * has already gone by. A year part is deliberately not accepted (see the
 * "not supported" list in the module docs).
 */
function matchDayMonth(norm: string, now: Date): string | null {
  const m = /^(\d{1,2})[/-](\d{1,2})$/.exec(norm);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;

  const build = (year: number) => new Date(year, month - 1, day);
  let d = build(now.getFullYear());
  // 31/02 rolls into March — reject instead of silently moving the quest.
  if (d.getMonth() !== month - 1 || d.getDate() !== day) return null;

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (d < todayStart) {
    d = build(now.getFullYear() + 1);
    if (d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  }
  return toDayString(d);
}

/**
 * `HH:MM`, `HHhs`, `HHh`, `HH:MMhs` — and, when `allowBare`, a naked `HH`.
 *
 * A naked number is only a time behind an explicit marker (`a las 15`,
 * `15 hs`). "Comprar 3 panes" must never become a 3 a.m. quest.
 */
function parseClock(norm: string, allowBare: boolean): string | null {
  let m = /^(\d{1,2}):(\d{2})(?:hs?)?$/.exec(norm);
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return `${pad(h)}:${pad(min)}`;
  }
  m = /^(\d{1,2})hs?$/.exec(norm);
  if (m) {
    const h = Number(m[1]);
    return h > 23 ? null : `${pad(h)}:00`;
  }
  if (allowBare) {
    m = /^(\d{1,2})$/.exec(norm);
    if (m) {
      const h = Number(m[1]);
      return h > 23 ? null : `${pad(h)}:00`;
    }
  }
  return null;
}

/**
 * `5pm`, `5:30pm`, `12am` → 24-hour. Returns null when there is no meridiem,
 * so the caller can fall through to the 24-hour rules.
 */
function parseMeridiem(norm: string): string | null {
  const m = /^(\d{1,2})(?::(\d{2}))?(am|pm)$/.exec(norm);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (h < 1 || h > 12 || min > 59) return null;
  if (m[3] === 'pm' && h !== 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  return `${pad(h)}:${pad(min)}`;
}

/**
 * `#token` against the existing projects: exact name wins, otherwise a single
 * prefix candidate wins. Several candidates and no exact hit is an ambiguity,
 * and an ambiguous token stays plain text — quick-add never creates projects,
 * and never guesses which one you meant.
 */
function matchProject(query: string, projects: QuickAddProjectRef[]): QuickAddProjectRef | null {
  if (!query) return null;
  const exact = projects.find((p) => normalizeWord(p.name) === query);
  if (exact) return exact;
  const prefixed = projects.filter((p) => normalizeWord(p.name).startsWith(query));
  return prefixed.length === 1 ? prefixed[0] : null;
}

/* ── Scanner ───────────────────────────────────────────────────────────── */

interface Word {
  /** Source text with the escape backslash (if any) removed. */
  text: string;
  /** Offset of `text` in the raw input (after the backslash). */
  start: number;
  end: number;
  norm: string;
  /** Offset of the escaping backslash, or -1. */
  escapeAt: number;
}

function splitWords(input: string): Word[] {
  const out: Word[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    const raw = m[0];
    const escaped = raw.startsWith('\\') && raw.length > 1;
    const text = escaped ? raw.slice(1) : raw;
    const start = escaped ? m.index + 1 : m.index;
    out.push({
      text,
      start,
      end: start + text.length,
      norm: normalizeWord(text),
      escapeAt: escaped ? m.index : -1,
    });
  }
  return out;
}

type RawMatch =
  | { kind: 'date'; consumed: number; day: string }
  | { kind: 'time'; consumed: number; time: string }
  | { kind: 'tier'; consumed: number; tier: TaskTier }
  | { kind: 'project'; consumed: number; project: QuickAddProjectRef };

function guardedByNoun(words: Word[], i: number, ignoreGuard: boolean): boolean {
  if (ignoreGuard) return false;
  const prev = words[i - 1];
  return !!prev && NOUN_GUARD.has(prev.norm);
}

/**
 * The one match starting at `words[i]`, or null.
 *
 * Slot availability is NOT considered here — the caller owns "first one wins",
 * which keeps this function a pure lookup and makes the escape probe (which
 * must match regardless of what is already filled) reuse the same code.
 *
 * `ignoreGuard` is for that probe: someone who typed `\mañana` has already said
 * what they mean, so the "is this a noun?" heuristic must not second-guess them
 * and leave a stray backslash in the title.
 */
function matchAt(
  words: Word[], i: number, projects: QuickAddProjectRef[], now: Date, ignoreGuard = false,
): RawMatch | null {
  const w = words[i];
  const n = w.norm;
  const next = words[i + 1];
  const third = words[i + 2];

  // !rapida / !normal / !epica (accents optional)
  if (n.startsWith('!')) {
    const tier = TIER_WORD[n.slice(1)];
    if (tier) return { kind: 'tier', consumed: 1, tier };
  }

  // #proyecto
  if (n.startsWith('#') && n.length > 1) {
    const project = matchProject(n.slice(1), projects);
    if (project) return { kind: 'project', consumed: 1, project };
  }

  // el lunes · este viernes · el próximo martes · la próxima semana
  if (DETERMINERS.has(n) && next) {
    const inner = matchAt(words, i + 1, projects, now, ignoreGuard);
    if (inner && inner.kind === 'date') {
      return { ...inner, consumed: inner.consumed + 1 };
    }
  }

  // en N días
  if (n === 'en' && next && third && DAY_NOUNS.has(third.norm)) {
    if (/^\d{1,3}$/.test(next.norm)) {
      return { kind: 'date', consumed: 3, day: addDays(now, Number(next.norm)) };
    }
  }

  // en una semana · en N semanas
  if (n === 'en' && next && third && WEEK_NOUNS.has(third.norm)) {
    if (next.norm === 'una') return { kind: 'date', consumed: 3, day: addDays(now, 7) };
    if (/^\d{1,3}$/.test(next.norm)) {
      return { kind: 'date', consumed: 3, day: addDays(now, 7 * Number(next.norm)) };
    }
  }

  // próxima semana (the article, if any, is eaten by the DETERMINERS rule above)
  if ((n === 'proxima' || n === 'proximo') && next && WEEK_NOUNS.has(next.norm)) {
    return { kind: 'date', consumed: 2, day: addDays(now, 7) };
  }

  // semana que viene — "semana" alone is never a date ("Planificar la semana").
  if (n === 'semana' && next && next.norm === 'que' && third && third.norm === 'viene') {
    return { kind: 'date', consumed: 3, day: addDays(now, 7) };
  }

  // pasado mañana / pasado
  if (n === 'pasado' && !guardedByNoun(words, i, ignoreGuard)) {
    const consumed = next && next.norm === 'manana' ? 2 : 1;
    return { kind: 'date', consumed, day: addDays(now, 2) };
  }

  if (n === 'hoy') return { kind: 'date', consumed: 1, day: addDays(now, 0) };

  if (n === 'manana' && !guardedByNoun(words, i, ignoreGuard)) {
    return { kind: 'date', consumed: 1, day: addDays(now, 1) };
  }

  if (Object.prototype.hasOwnProperty.call(WEEKDAY_NUMBER, n)) {
    // "el lunes que viene" resolves to the same day as "el lunes" — the phrase
    // is emphasis, not a second week — but it has to be eaten off the title.
    const queViene = next && next.norm === 'que' && third && third.norm === 'viene';
    return { kind: 'date', consumed: queViene ? 3 : 1, day: nextWeekday(now, WEEKDAY_NUMBER[n]) };
  }

  // DD/MM · DD-MM  (before the clock rules: the separators never collide)
  const dayMonth = matchDayMonth(n, now);
  if (dayMonth) return { kind: 'date', consumed: 1, day: dayMonth };

  // a las HH · a la HH · a las HH pm
  if (n === 'a' && next && (next.norm === 'las' || next.norm === 'la') && third) {
    const fourth = words[i + 3];
    if (fourth && MERIDIEM.has(fourth.norm)) {
      const split = parseMeridiem(third.norm + fourth.norm);
      if (split) return { kind: 'time', consumed: 4, time: split };
    }
    const joined = parseMeridiem(third.norm);
    if (joined) return { kind: 'time', consumed: 3, time: joined };
    const time = parseClock(third.norm, true);
    if (time) return { kind: 'time', consumed: 3, time };
  }

  // HH hs · HH h
  if (next && HOUR_MARKERS.has(next.norm)) {
    const time = parseClock(n, true);
    if (time) return { kind: 'time', consumed: 2, time };
  }

  // 5pm · 5:30pm · 5 pm
  const meridiem = parseMeridiem(n);
  if (meridiem) return { kind: 'time', consumed: 1, time: meridiem };
  if (next && MERIDIEM.has(next.norm)) {
    const split = parseMeridiem(n + next.norm);
    if (split) return { kind: 'time', consumed: 2, time: split };
  }

  // HH:MM · HHhs · HHh
  const time = parseClock(n, false);
  if (time) return { kind: 'time', consumed: 1, time };

  return null;
}

/* ── Parse ─────────────────────────────────────────────────────────────── */

const EMPTY = (input: string): QuickAddParseResult => ({
  title: input.trim(),
  dueDate: null,
  dueDay: null,
  dueTime: null,
  tier: null,
  projectId: null,
  projectName: null,
  tokens: [],
});

export function parseQuickAdd(input: string, options: QuickAddParseOptions = {}): QuickAddParseResult {
  const projects = options.projects ?? [];
  const now = options.now ?? new Date();
  const words = splitWords(input);
  if (words.length === 0) return EMPTY(input);

  const tokens: QuickAddToken[] = [];
  /** Offsets of backslashes that really did suppress a token. */
  const escapes: number[] = [];
  let day: string | null = null;
  let time: string | null = null;
  let tier: TaskTier | null = null;
  let project: QuickAddProjectRef | null = null;

  const slotFree = (kind: QuickAddTokenKind) => {
    if (kind === 'date') return day === null;
    if (kind === 'time') return time === null;
    if (kind === 'tier') return tier === null;
    return project === null;
  };

  let i = 0;
  while (i < words.length) {
    const escaped = words[i].escapeAt >= 0;
    const match = matchAt(words, i, projects, now, escaped);
    if (!match) { i++; continue; }

    // An escaped word never fills a slot; it only tells us the backslash was
    // meant as an escape (and is therefore safe to strip from the title).
    if (escaped) {
      escapes.push(words[i].escapeAt);
      i += match.consumed;
      continue;
    }

    // First one wins. A second date/time/tier/project stays plain text, in
    // full view, instead of silently overriding the first.
    if (!slotFree(match.kind)) { i++; continue; }

    const last = words[i + match.consumed - 1];
    tokens.push({
      kind: match.kind,
      text: input.slice(words[i].start, last.end),
      start: words[i].start,
      end: last.end,
    });

    if (match.kind === 'date') day = match.day;
    else if (match.kind === 'time') time = match.time;
    else if (match.kind === 'tier') tier = match.tier;
    else project = match.project;

    i += match.consumed;
  }

  if (tokens.length === 0 && escapes.length === 0) return EMPTY(input);

  // A bare time implies a day: today, or tomorrow when the hour is already gone.
  if (time && !day) {
    const nowClock = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    day = addDays(now, time > nowClock ? 0 : 1);
  }

  const title = buildTitle(input, tokens, escapes);

  // Everything the user typed turned out to be tokens. A quest needs a name
  // more than it needs a due date, so we hand the whole string back as text.
  if (!title) return EMPTY(input);

  return {
    title,
    dueDate: day ? (time ? `${day}T${time}` : day) : null,
    dueDay: day,
    dueTime: time,
    tier,
    projectId: project?.id ?? null,
    projectName: project?.name ?? null,
    tokens,
  };
}

/** Cuts the token ranges out, drops the escaping backslashes, tidies the seams. */
function buildTitle(input: string, tokens: QuickAddToken[], escapes: number[]): string {
  const cuts = [
    ...tokens.map((t) => ({ start: t.start, end: t.end })),
    // The backslash itself, one character.
    ...escapes.map((at) => ({ start: at, end: at + 1 })),
  ].sort((a, b) => a.start - b.start);

  let out = '';
  let cursor = 0;
  for (const cut of cuts) {
    if (cut.start < cursor) continue;
    out += input.slice(cursor, cut.start);
    cursor = cut.end;
  }
  out += input.slice(cursor);

  return out.replace(/\s{2,}/g, ' ').trim();
}

/* ── Escape helpers (used by the confirmation line) ────────────────────── */

/**
 * Inserts the escape backslash before every given token, so the next parse
 * reads them as plain title text. Applied back-to-front: earlier offsets stay
 * valid while later ones are edited.
 */
export function escapeTokens(input: string, tokens: QuickAddToken[]): string {
  return [...tokens]
    .sort((a, b) => b.start - a.start)
    .reduce((text, token) => `${text.slice(0, token.start)}\\${text.slice(token.start)}`, input);
}

/** The tokens of a given kind, for wiring one confirmation fragment to them. */
export function tokensOfKind(tokens: QuickAddToken[], ...kinds: QuickAddTokenKind[]): QuickAddToken[] {
  return tokens.filter((t) => kinds.includes(t.kind));
}
