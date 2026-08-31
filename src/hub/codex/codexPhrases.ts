import type { TFunction } from 'i18next';
import type { DaySummary } from './codexApi';

/**
 * The closing line of the day's page.
 *
 * Rules on purpose, not an LLM and not randomness alone: the phrase has to be
 * TRUE about the day you just had, and it must never scold. A day with two
 * entries gets a kind line, not "you barely showed up" — the codex records
 * days lived, and a quiet day was still lived.
 *
 * Five moods, two variants each (ten per language), picked deterministically
 * from the date so re-renders and reopening the same day never reshuffle it.
 */
export type CodexMood = 'focus' | 'constancy' | 'variety' | 'gentle' | 'steady';

const MOOD_FALLBACKS: Record<CodexMood, string[]> = {
  focus: [
    'Hoy el fuego del caldero ardió parejo. Eso es concentración.',
    'Largos ratos en una sola cosa. El oficio se construye así.',
  ],
  constancy: [
    'Otro día encadenado al anterior. La constancia ya es tuya.',
    'La racha no se sostiene sola: la sostuviste vos.',
  ],
  variety: [
    'Tocaste varios frentes y ninguno quedó a medias.',
    'Día de muchas manos: el códice lo anota con gusto.',
  ],
  gentle: [
    'Un día tranquilo también se escribe. Acá queda.',
    'Poco y bueno. El códice registra días vividos, no días perfectos.',
  ],
  steady: [
    'Un día honesto, de los que suman sin hacer ruido.',
    'Nada extraordinario, nada perdido. Así se avanza.',
  ],
};

/** Which mood the day earned. First rule that fits wins. */
export function moodFor(summary: DaySummary): CodexMood {
  const cauldronEvents = summary.events.filter((e) => e.moduleId === 'cauldron').length;
  if (cauldronEvents >= 3) return 'focus';
  if (summary.streak >= 7) return 'constancy';
  if (summary.eventsCount <= 2) return 'gentle';
  if (summary.maxCombo >= 4) return 'variety';
  return 'steady';
}

/** Stable index from the date, so the same day always reads the same line. */
function pick(date: string, length: number): number {
  if (length <= 0) return 0;
  let h = 0;
  for (let i = 0; i < date.length; i++) h = (h * 31 + date.charCodeAt(i)) | 0;
  return Math.abs(h) % length;
}

export function closingPhrase(summary: DaySummary, t: TFunction): string {
  const mood = moodFor(summary);
  const pool = t(`rpg.codexPhrases.${mood}`, {
    returnObjects: true,
    defaultValue: MOOD_FALLBACKS[mood],
  }) as unknown;
  const list = Array.isArray(pool) && pool.length > 0
    ? (pool as string[])
    : MOOD_FALLBACKS[mood];
  return list[pick(summary.date, list.length)];
}
