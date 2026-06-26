import { formatDateString } from '../../../shared/date-utils';

/**
 * Natural-language quick-add parser (Spanish / Rioplatense).
 *
 * Extracts a due date from the TAIL of a task string so the user can type
 * "Comprar pan mañana" and get the date agendada automatically. Parsing is
 * anchored at the end of the string to avoid false positives in the middle of
 * a name ("Mañana es otro día" keeps "mañana" as part of the name).
 *
 * v1 handles dates only (due_date is a YYYY-MM-DD field). An optional trailing
 * time ("mañana 17h", "el lunes a las 5pm") is stripped from the name but not
 * yet stored — kept here so the name comes out clean for a future time feature.
 */
export interface QuickParseResult {
  /** The task name with the recognized date phrase removed. */
  cleanName: string;
  /** YYYY-MM-DD, or null when nothing was recognized. */
  dueDate: string | null;
  /** The exact phrase that was matched (for the live hint), or null. */
  matchedText: string | null;
}

const WEEKDAYS: Record<string, number> = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6,
};

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/** Next occurrence of a weekday; same-weekday resolves to next week (not today). */
function nextWeekday(now: Date, target: number): Date {
  let diff = (target - now.getDay() + 7) % 7;
  if (diff === 0) diff = 7;
  return addDays(now, diff);
}

function normalizeWeekday(s: string): string {
  return s.toLowerCase().replace(/é/g, 'e').replace(/á/g, 'a');
}

// Optional trailing time, e.g. " 17h", " a las 5pm", " 17:30" — stripped from the name.
const TIME = '(?:\\s+(?:a\\s+las\\s+)?\\d{1,2}(?:[:.]\\d{2})?\\s*(?:am|pm|hs|h)?)?';

const PATTERNS: Array<{ re: RegExp; resolve: (m: RegExpMatchArray, now: Date) => Date | null }> = [
  { re: new RegExp(`\\bpasado\\s+ma[ñn]ana${TIME}\\s*$`, 'i'), resolve: (_m, now) => addDays(now, 2) },
  { re: new RegExp(`\\bma[ñn]ana${TIME}\\s*$`, 'i'), resolve: (_m, now) => addDays(now, 1) },
  { re: new RegExp(`\\bhoy${TIME}\\s*$`, 'i'), resolve: (_m, now) => now },
  { re: new RegExp(`\\ben\\s+(\\d+)\\s+d[íi]as?${TIME}\\s*$`, 'i'), resolve: (m, now) => addDays(now, parseInt(m[1], 10)) },
  { re: new RegExp(`\\ben\\s+una\\s+semana${TIME}\\s*$`, 'i'), resolve: (_m, now) => addDays(now, 7) },
  { re: new RegExp(`\\ben\\s+(\\d+)\\s+semanas${TIME}\\s*$`, 'i'), resolve: (m, now) => addDays(now, 7 * parseInt(m[1], 10)) },
  { re: new RegExp(`\\b(?:la\\s+)?(?:pr[óo]xima\\s+semana|semana\\s+que\\s+viene)${TIME}\\s*$`, 'i'), resolve: (_m, now) => addDays(now, 7) },
  {
    re: new RegExp(`\\b(?:el\\s+|este\\s+|pr[óo]ximo\\s+|el\\s+pr[óo]ximo\\s+)?(domingo|lunes|martes|mi[ée]rcoles|jueves|viernes|s[áa]bado)(\\s+que\\s+viene)?${TIME}\\s*$`, 'i'),
    resolve: (m, now) => {
      const target = WEEKDAYS[normalizeWeekday(m[1])];
      return target === undefined ? null : nextWeekday(now, target);
    },
  },
];

export function parseQuickTask(input: string, now: Date = new Date()): QuickParseResult {
  const noMatch: QuickParseResult = { cleanName: input.trim(), dueDate: null, matchedText: null };
  if (!input.trim()) return noMatch;

  for (const { re, resolve } of PATTERNS) {
    const m = input.match(re);
    if (m && m.index !== undefined) {
      const date = resolve(m, now);
      if (!date) continue;
      const cleanName = input.slice(0, m.index).trim();
      // Don't strip if it would leave an empty name (the date phrase IS the whole text).
      if (!cleanName) continue;
      return { cleanName, dueDate: formatDateString(date), matchedText: m[0].trim() };
    }
  }
  return noMatch;
}
