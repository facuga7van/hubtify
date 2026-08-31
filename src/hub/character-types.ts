/** Shared between Character (UI/state) and CharacterCanvas (the lazy Pixi chunk),
 *  so importing the type never drags pixi.js into the startup bundle. */
export interface CharacterData {
  backHairIndex: number;
  frontColorIndex: number;
  backColorIndex: number;
  frontHairIndex: number;
}

export const FIELD_MAX: Record<keyof CharacterData, number> = {
  frontHairIndex: 18, frontColorIndex: 25,
  backHairIndex: 22, backColorIndex: 24,
};

export const DEFAULT_CHAR: CharacterData = {
  backHairIndex: 1,
  frontColorIndex: 1,
  backColorIndex: 1,
  frontHairIndex: 1,
};

/** Stable identity for a look — used to skip redundant spritesheet reloads. */
export function charKey(d: CharacterData): string {
  return `${d.backHairIndex}-${d.backColorIndex}-${d.frontHairIndex}-${d.frontColorIndex}`;
}
