import { describe, it, expect } from 'vitest';
import {
  parseQuickAdd,
  escapeTokens,
  tokensOfKind,
  normalizeWord,
  type QuickAddProjectRef,
} from '../../../src/modules/quests/quickadd-parser';

/** Tuesday, 10 March 2026, 09:30 local. Every case is pinned to this clock. */
const NOW = new Date(2026, 2, 10, 9, 30);

const PROJECTS: QuickAddProjectRef[] = [
  { id: 'p-fac', name: 'Facultad' },
  { id: 'p-casa', name: 'Casa' },
  { id: 'p-cas2', name: 'Castillo' },
  { id: 'p-multi', name: 'Mi Proyecto' },
];

const parse = (input: string, projects: QuickAddProjectRef[] = PROJECTS) =>
  parseQuickAdd(input, { projects, now: NOW });

/* ── The golden rule ───────────────────────────────────────────────────── */

describe('plain text is left exactly as it is', () => {
  it('returns the trimmed input and nothing else', () => {
    const r = parse('  comprar pan para la cena  ');
    expect(r.title).toBe('comprar pan para la cena');
    expect(r.dueDate).toBeNull();
    expect(r.tier).toBeNull();
    expect(r.projectId).toBeNull();
    expect(r.tokens).toEqual([]);
  });

  it('does not collapse inner whitespace when nothing was recognised', () => {
    expect(parse('llamar   al   herrero').title).toBe('llamar   al   herrero');
  });

  it('handles an empty and a whitespace-only input', () => {
    expect(parse('').title).toBe('');
    expect(parse('   ').title).toBe('');
    expect(parse('').tokens).toEqual([]);
  });

  it('leaves numbers that are not times alone', () => {
    const r = parse('comprar 3 panes y 25 clavos');
    expect(r.title).toBe('comprar 3 panes y 25 clavos');
    expect(r.dueDate).toBeNull();
  });

  it('never fires on a word that merely contains a keyword', () => {
    const r = parse('cavar un hoyo en el jardin');
    expect(r.dueDate).toBeNull();
    expect(r.title).toBe('cavar un hoyo en el jardin');
  });
});

/* ── Dates ─────────────────────────────────────────────────────────────── */

describe('date words', () => {
  it('hoy', () => {
    const r = parse('forjar espada hoy');
    expect(r.dueDate).toBe('2026-03-10');
    expect(r.title).toBe('forjar espada');
  });

  it('mañana', () => {
    expect(parse('forjar espada mañana').dueDate).toBe('2026-03-11');
  });

  it('mañana without the tilde', () => {
    expect(parse('forjar espada manana').dueDate).toBe('2026-03-11');
  });

  it('is case insensitive', () => {
    expect(parse('forjar espada MAÑANA').dueDate).toBe('2026-03-11');
    expect(parse('forjar espada Hoy').dueDate).toBe('2026-03-10');
  });

  it('pasado mañana, as two words', () => {
    const r = parse('entregar informe pasado mañana');
    expect(r.dueDate).toBe('2026-03-12');
    expect(r.title).toBe('entregar informe');
  });

  it('pasado on its own', () => {
    const r = parse('entregar informe pasado');
    expect(r.dueDate).toBe('2026-03-12');
    expect(r.title).toBe('entregar informe');
  });

  it('a date word in the middle of the sentence', () => {
    const r = parse('reunion mañana con el gremio');
    expect(r.dueDate).toBe('2026-03-11');
    expect(r.title).toBe('reunion con el gremio');
  });

  it('a date word leading the sentence', () => {
    const r = parse('hoy pagar el alquiler');
    expect(r.dueDate).toBe('2026-03-10');
    expect(r.title).toBe('pagar el alquiler');
  });
});

describe('weekdays resolve to the next occurrence', () => {
  const cases: Array<[string, string]> = [
    ['lunes', '2026-03-16'],
    ['martes', '2026-03-17'],   // today is Tuesday: "el próximo" means +7
    ['miercoles', '2026-03-11'],
    ['miércoles', '2026-03-11'],
    ['jueves', '2026-03-12'],
    ['viernes', '2026-03-13'],
    ['sabado', '2026-03-14'],
    ['sábado', '2026-03-14'],
    ['domingo', '2026-03-15'],
  ];

  for (const [word, expected] of cases) {
    it(`${word} → ${expected}`, () => {
      expect(parse(`entrenar ${word}`).dueDate).toBe(expected);
    });
  }

  it('eats the article with the weekday: "el lunes" leaves no dangling "el"', () => {
    const r = parse('entrenar el lunes');
    expect(r.dueDate).toBe('2026-03-16');
    expect(r.title).toBe('entrenar');
  });

  it('eats "este" and "el próximo" too', () => {
    expect(parse('entrenar este lunes').title).toBe('entrenar');
    expect(parse('entrenar el próximo lunes').title).toBe('entrenar');
    expect(parse('entrenar el próximo lunes').dueDate).toBe('2026-03-16');
  });

  it('"lunes que viene" is the same Monday, phrase and all', () => {
    const r = parse('entrenar el lunes que viene');
    expect(r.dueDate).toBe('2026-03-16');
    expect(r.title).toBe('entrenar');
  });
});

describe('en N días', () => {
  it('en 3 días', () => {
    const r = parse('revisar contrato en 3 días');
    expect(r.dueDate).toBe('2026-03-13');
    expect(r.title).toBe('revisar contrato');
  });

  it('en 3 dias, no tilde', () => {
    expect(parse('revisar contrato en 3 dias').dueDate).toBe('2026-03-13');
  });

  it('en 1 dia', () => {
    expect(parse('revisar en 1 dia').dueDate).toBe('2026-03-11');
  });

  it('en 0 dias is today', () => {
    expect(parse('revisar en 0 dias').dueDate).toBe('2026-03-10');
  });

  it('crosses the month boundary', () => {
    expect(parse('revisar en 30 dias').dueDate).toBe('2026-04-09');
  });

  it('ignores "en N" without the day noun', () => {
    const r = parse('llegar en 3 pasos');
    expect(r.dueDate).toBeNull();
    expect(r.title).toBe('llegar en 3 pasos');
  });
});

/* Week phrasings absorbed from the branch's other quick-add parser
   (`parseQuickTask`), which understood these and this one did not. */
describe('week phrasings', () => {
  it('en una semana', () => {
    const r = parse('renovar seguro en una semana');
    expect(r.dueDate).toBe('2026-03-17');
    expect(r.title).toBe('renovar seguro');
  });

  it('en 2 semanas', () => {
    expect(parse('renovar en 2 semanas').dueDate).toBe('2026-03-24');
  });

  it('la próxima semana', () => {
    const r = parse('planificar sprint la próxima semana');
    expect(r.dueDate).toBe('2026-03-17');
    expect(r.title).toBe('planificar sprint');
  });

  it('proxima semana without the article or the accent', () => {
    expect(parse('planificar proxima semana').dueDate).toBe('2026-03-17');
  });

  it('semana que viene', () => {
    const r = parse('planificar sprint la semana que viene');
    expect(r.dueDate).toBe('2026-03-17');
    expect(r.title).toBe('planificar sprint');
  });

  it('a bare "semana" is not a date', () => {
    const r = parse('planificar la semana');
    expect(r.dueDate).toBeNull();
    expect(r.title).toBe('planificar la semana');
  });
});

describe('DD/MM and DD-MM', () => {
  it('a future date stays in the current year', () => {
    expect(parse('pagar impuestos 25/12').dueDate).toBe('2026-12-25');
  });

  it('accepts the dash separator', () => {
    expect(parse('pagar impuestos 15-03').dueDate).toBe('2026-03-15');
  });

  it('accepts a single-digit day and month', () => {
    expect(parse('pagar 5/4').dueDate).toBe('2026-04-05');
  });

  it('a date already gone rolls into next year', () => {
    expect(parse('brindar 01/01').dueDate).toBe('2027-01-01');
  });

  it("today's own date is today, not next year", () => {
    expect(parse('cerrar caja 10/03').dueDate).toBe('2026-03-10');
  });

  it('rejects an impossible day', () => {
    const r = parse('planear 31/02');
    expect(r.dueDate).toBeNull();
    expect(r.title).toBe('planear 31/02');
  });

  it('rejects a month over 12 (so "15-20" stays a range)', () => {
    const r = parse('cargar 15-20 barriles');
    expect(r.dueDate).toBeNull();
    expect(r.title).toBe('cargar 15-20 barriles');
  });

  it('rejects a full year form, which is not supported', () => {
    const r = parse('pagar 25/12/2026');
    expect(r.dueDate).toBeNull();
    expect(r.title).toBe('pagar 25/12/2026');
  });
});

/* ── Times ─────────────────────────────────────────────────────────────── */

describe('times', () => {
  it('HH:MM with a date', () => {
    const r = parse('reunion mañana 15:30');
    expect(r.dueDate).toBe('2026-03-11T15:30');
    expect(r.dueDay).toBe('2026-03-11');
    expect(r.dueTime).toBe('15:30');
    expect(r.title).toBe('reunion');
  });

  it('HHhs glued', () => {
    expect(parse('reunion mañana 15hs').dueDate).toBe('2026-03-11T15:00');
  });

  it('HHh glued', () => {
    expect(parse('reunion mañana 9h').dueDate).toBe('2026-03-11T09:00');
  });

  it('HH hs separated', () => {
    const r = parse('reunion mañana 15 hs');
    expect(r.dueDate).toBe('2026-03-11T15:00');
    expect(r.title).toBe('reunion');
  });

  it('a las HH', () => {
    const r = parse('misa domingo a las 11');
    expect(r.dueDate).toBe('2026-03-15T11:00');
    expect(r.title).toBe('misa');
  });

  it('a las HH:MM', () => {
    expect(parse('misa domingo a las 11:45').dueDate).toBe('2026-03-15T11:45');
  });

  it('a la HH, singular', () => {
    expect(parse('almuerzo mañana a la 1').dueDate).toBe('2026-03-11T01:00');
  });

  it('a time before a date still pairs with it', () => {
    const r = parse('guardia a las 22 viernes');
    expect(r.dueDate).toBe('2026-03-13T22:00');
    expect(r.title).toBe('guardia');
  });

  it('a bare future time means today', () => {
    expect(parse('llamar al herrero 15:00').dueDate).toBe('2026-03-10T15:00');
  });

  it('a bare time already gone means tomorrow', () => {
    expect(parse('llamar al herrero 08:00').dueDate).toBe('2026-03-11T08:00');
  });

  it('rejects an impossible clock', () => {
    const r = parse('contar 25:00 monedas');
    expect(r.dueDate).toBeNull();
    expect(r.title).toBe('contar 25:00 monedas');
  });

  it('rejects an impossible minute', () => {
    expect(parse('contar 12:75 monedas').dueDate).toBeNull();
  });

  it('never reads a naked number as a time', () => {
    const r = parse('comprar 15 manzanas rojas');
    expect(r.dueDate).toBeNull();
    expect(r.title).toBe('comprar 15 manzanas rojas');
  });

  /* am/pm came from `parseQuickTask`, which stripped it from the name without
     storing it. Here it actually lands on the quest. */
  it('5pm glued', () => {
    const r = parse('reunion mañana 5pm');
    expect(r.dueDate).toBe('2026-03-11T17:00');
    expect(r.title).toBe('reunion');
  });

  it('5 pm separated', () => {
    expect(parse('reunion mañana 5 pm').dueDate).toBe('2026-03-11T17:00');
  });

  it('5:30pm', () => {
    expect(parse('reunion mañana 5:30pm').dueDate).toBe('2026-03-11T17:30');
  });

  it('a las 5 pm', () => {
    const r = parse('misa domingo a las 5 pm');
    expect(r.dueDate).toBe('2026-03-15T17:00');
    expect(r.title).toBe('misa');
  });

  it('12am is midnight and 12pm is noon', () => {
    expect(parse('x mañana 12am').dueDate).toBe('2026-03-11T00:00');
    expect(parse('x mañana 12pm').dueDate).toBe('2026-03-11T12:00');
  });

  it('rejects a meridiem hour out of range', () => {
    const r = parse('contar 15pm monedas');
    expect(r.dueDate).toBeNull();
    expect(r.title).toBe('contar 15pm monedas');
  });
});

/* ── Tier ──────────────────────────────────────────────────────────────── */

describe('tier', () => {
  it('!rapida', () => {
    const r = parse('barrer el patio !rapida');
    expect(r.tier).toBe(1);
    expect(r.title).toBe('barrer el patio');
  });

  it('!normal', () => {
    expect(parse('barrer !normal').tier).toBe(2);
  });

  it('!epica', () => {
    expect(parse('matar al dragon !epica').tier).toBe(3);
  });

  it('accepts the accented spellings', () => {
    expect(parse('barrer !rápida').tier).toBe(1);
    expect(parse('matar !épica').tier).toBe(3);
  });

  it('is case insensitive', () => {
    expect(parse('matar !EPICA').tier).toBe(3);
  });

  it('leaves an unknown tier word as text', () => {
    const r = parse('gritar !fuerte');
    expect(r.tier).toBeNull();
    expect(r.title).toBe('gritar !fuerte');
  });

  it('null tier means "keep whatever the picker says"', () => {
    expect(parse('barrer el patio').tier).toBeNull();
  });
});

/* ── Project ───────────────────────────────────────────────────────────── */

describe('project', () => {
  it('matches by exact name', () => {
    const r = parse('estudiar #Facultad');
    expect(r.projectId).toBe('p-fac');
    expect(r.projectName).toBe('Facultad');
    expect(r.title).toBe('estudiar');
  });

  it('matches by prefix', () => {
    expect(parse('estudiar #fac').projectId).toBe('p-fac');
  });

  it('ignores case and accents', () => {
    expect(parse('estudiar #FACULTAD').projectId).toBe('p-fac');
  });

  it('matches the first word of a multi-word project name', () => {
    expect(parse('planear #mi').projectId).toBe('p-multi');
  });

  it('an ambiguous prefix stays plain text', () => {
    // "cas" prefixes both Casa and Castillo.
    const r = parse('barrer #cas');
    expect(r.projectId).toBeNull();
    expect(r.title).toBe('barrer #cas');
  });

  it('an exact name beats the ambiguity', () => {
    const r = parse('barrer #casa');
    expect(r.projectId).toBe('p-casa');
    expect(r.title).toBe('barrer');
  });

  it('an unknown project stays plain text and creates nothing', () => {
    const r = parse('estudiar #Alquimia');
    expect(r.projectId).toBeNull();
    expect(r.title).toBe('estudiar #Alquimia');
    expect(r.tokens).toEqual([]);
  });

  it('a lone hash is just a hash', () => {
    expect(parse('contar # de barriles').title).toBe('contar # de barriles');
  });

  it('matches nothing when there are no projects', () => {
    const r = parse('estudiar #Facultad', []);
    expect(r.projectId).toBeNull();
    expect(r.title).toBe('estudiar #Facultad');
  });
});

/* ── Combinations ──────────────────────────────────────────────────────── */

describe('combinations', () => {
  it('date + time + tier + project', () => {
    const r = parse('rendir final mañana 15:00 !epica #Facultad');
    expect(r.title).toBe('rendir final');
    expect(r.dueDate).toBe('2026-03-11T15:00');
    expect(r.tier).toBe(3);
    expect(r.projectId).toBe('p-fac');
    expect(r.tokens.map((t) => t.kind)).toEqual(['date', 'time', 'tier', 'project']);
  });

  it('tokens interleaved with the title', () => {
    const r = parse('!epica rendir #Facultad final el viernes a las 8');
    expect(r.title).toBe('rendir final');
    expect(r.dueDate).toBe('2026-03-13T08:00');
    expect(r.tier).toBe(3);
    expect(r.projectId).toBe('p-fac');
  });

  it('collapses the gap a removed token leaves behind', () => {
    expect(parse('rendir mañana final').title).toBe('rendir final');
  });

  it('the first date wins and the second stays as text', () => {
    const r = parse('mover del lunes al martes');
    expect(r.dueDate).toBe('2026-03-16');
    expect(r.title).toBe('mover del al martes');
  });

  it('the first tier wins', () => {
    const r = parse('tarea !rapida y no !epica');
    expect(r.tier).toBe(1);
    expect(r.title).toBe('tarea y no !epica');
  });

  it('the first project wins', () => {
    const r = parse('tarea #Facultad no #Casa');
    expect(r.projectId).toBe('p-fac');
    expect(r.title).toBe('tarea no #Casa');
  });

  it('reports token offsets that map back onto the raw input', () => {
    const input = 'rendir final mañana !epica';
    const r = parse(input);
    for (const token of r.tokens) {
      expect(input.slice(token.start, token.end)).toBe(token.text);
    }
    expect(r.tokens.map((t) => t.text)).toEqual(['mañana', '!epica']);
  });
});

/* ── Ambiguity ─────────────────────────────────────────────────────────── */

describe('ambiguity: mañana / pasado as ordinary nouns', () => {
  it('"por la mañana" is a time of day, not a date', () => {
    const r = parse('correr por la mañana');
    expect(r.dueDate).toBeNull();
    expect(r.title).toBe('correr por la mañana');
  });

  it('"esta mañana" — guarded by the article', () => {
    expect(parse('escribir una mañana').dueDate).toBeNull();
  });

  it('"el año pasado" is history, not a due date', () => {
    const r = parse('revisar el balance del año pasado');
    expect(r.dueDate).toBeNull();
    expect(r.title).toBe('revisar el balance del año pasado');
  });

  it('"el mes pasado" too', () => {
    expect(parse('cerrar el mes pasado').dueDate).toBeNull();
  });

  it('but a bare "mañana" at the end is still a date', () => {
    expect(parse('correr mañana').dueDate).toBe('2026-03-11');
  });

  it('and "pasado mañana" survives the guard when it reads as a date', () => {
    expect(parse('comprar pan pasado mañana').dueDate).toBe('2026-03-12');
  });
});

/* ── Escape hatch ──────────────────────────────────────────────────────── */

describe('the \\ escape prefix', () => {
  it('keeps an escaped date word in the title', () => {
    const r = parse('planear el \\mañana');
    expect(r.dueDate).toBeNull();
    expect(r.title).toBe('planear el mañana');
    expect(r.tokens).toEqual([]);
  });

  it('escapes only the word it precedes', () => {
    const r = parse('planear el \\mañana para el viernes');
    expect(r.dueDate).toBe('2026-03-13');
    expect(r.title).toBe('planear el mañana para');
  });

  it('escapes a multi-word token from its first word', () => {
    const r = parse('charla \\a las 5 de la tarde');
    expect(r.dueDate).toBeNull();
    expect(r.title).toBe('charla a las 5 de la tarde');
  });

  it('escapes a tier and a project token', () => {
    const r = parse('nota \\!epica sobre \\#Facultad');
    expect(r.tier).toBeNull();
    expect(r.projectId).toBeNull();
    expect(r.title).toBe('nota !epica sobre #Facultad');
  });

  it('leaves a backslash that was not escaping a token alone', () => {
    const r = parse('abrir C:\\Users y \\hola');
    expect(r.title).toBe('abrir C:\\Users y \\hola');
    expect(r.tokens).toEqual([]);
  });
});

describe('escapeTokens', () => {
  it('inserts the marker so the next parse gives up the token', () => {
    const input = 'rendir final mañana !epica';
    const first = parse(input);
    const next = escapeTokens(input, tokensOfKind(first.tokens, 'date', 'time'));
    expect(next).toBe('rendir final \\mañana !epica');

    const second = parse(next);
    expect(second.dueDate).toBeNull();
    expect(second.tier).toBe(3);
    expect(second.title).toBe('rendir final mañana');
  });

  it('escapes several tokens at once without shifting the offsets', () => {
    const input = 'reunion mañana 15:00 !epica';
    const first = parse(input);
    const next = escapeTokens(input, tokensOfKind(first.tokens, 'date', 'time'));
    expect(next).toBe('reunion \\mañana \\15:00 !epica');
    const second = parse(next);
    expect(second.dueDate).toBeNull();
    expect(second.title).toBe('reunion mañana 15:00');
    expect(second.tier).toBe(3);
  });

  it('is a no-op with no tokens', () => {
    expect(escapeTokens('hola mundo', [])).toBe('hola mundo');
  });
});

/* ── Degenerate input ──────────────────────────────────────────────────── */

describe('a title made only of tokens falls back to plain text', () => {
  it('a lone date word is the quest name', () => {
    const r = parse('mañana');
    expect(r.title).toBe('mañana');
    expect(r.dueDate).toBeNull();
    expect(r.tokens).toEqual([]);
  });

  it('a lone tier word too', () => {
    const r = parse('!epica');
    expect(r.title).toBe('!epica');
    expect(r.tier).toBeNull();
  });

  it('several tokens and nothing else', () => {
    const r = parse('mañana 15:00 !epica #Facultad');
    expect(r.title).toBe('mañana 15:00 !epica #Facultad');
    expect(r.dueDate).toBeNull();
    expect(r.tier).toBeNull();
    expect(r.projectId).toBeNull();
  });
});

/* ── normalizeWord ─────────────────────────────────────────────────────── */

describe('normalizeWord', () => {
  it('strips accents and the enye, and lowercases', () => {
    expect(normalizeWord('Miércoles')).toBe('miercoles');
    expect(normalizeWord('MAÑANA')).toBe('manana');
    expect(normalizeWord('Épica')).toBe('epica');
    expect(normalizeWord('sábado')).toBe('sabado');
  });
});
