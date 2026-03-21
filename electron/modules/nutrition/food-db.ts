import { getDb } from '../../ipc/db';
import type { FoodDbEntry } from '../../../shared/types';

const STOP_WORDS = new Set([
  'con', 'y', 'de', 'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'al', 'del', 'en', 'por',
  'porcion', 'porciones', 'poco', 'algo', 'bastante',
]);
const QUANTITY_WORDS: Record<string, number> = {
  dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  doble: 2, triple: 3, medio: 0.5, media: 0.5,
};

const COMPOUND_PREFIXES = ['subway', 'mcdonalds', 'mc donalds', 'burger king', 'mostaza', 'big mac', 'whopper', 'mcpollo', 'mcnuggets', 'mc nuggets', 'mcflurry'];

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/** Reduce a Spanish word to a rough stem by stripping common suffixes */
function stemWord(word: string): string {
  // Diminutives: sanguchito→sanguch, pedacito→pedac, galletita→allet
  // Plurals: sanguchitos→sanguchito, milanesas→milanesa
  return word
    .replace(/(cit[oa]s?|cill[oa]s?|it[oa]s?)$/, '')  // diminutives
    .replace(/(es|s)$/, '');                              // plurals
}

/** Normalize a multi-word string by stemming each word */
function stemPhrase(phrase: string): string {
  return phrase.split(/\s+/).map(stemWord).join(' ');
}

export function tokenizeInput(input: string): string[] {
  const normalized = normalizeText(input);

  // Check if the full input matches a compound prefix (chain product)
  for (const prefix of COMPOUND_PREFIXES) {
    if (normalized.includes(prefix)) {
      // For chain products, keep the full string but strip stop words
      const words = normalized.split(/\s+/);
      const filtered = words.filter(w => !STOP_WORDS.has(w));
      return [filtered.join(' ')];
    }
  }

  // Split by separators: "y", "con", ",", "+"
  const parts = normalized.split(/\s*[,+]\s*|\s+(?:y|con)\s+/);

  return parts.map(part => {
    const words = part.trim().split(/\s+/);
    let quantity = 1;
    const filtered: string[] = [];

    for (const word of words) {
      if (QUANTITY_WORDS[word] !== undefined) {
        quantity = QUANTITY_WORDS[word];
      } else if (/^\d+(\.\d+)?$/.test(word)) {
        quantity = parseFloat(word);
      } else if (!STOP_WORDS.has(word)) {
        filtered.push(word);
      }
    }

    if (filtered.length === 0) return '';
    const token = filtered.join(' ');
    return quantity !== 1 ? `${token} x${quantity}` : token;
  }).filter(Boolean);
}

export interface MatchResult {
  matched: Array<{ name: string; calories: number; source: 'database' }>;
  unmatched: string[];
}

export function matchTokensToFoods(tokens: string[], foodEntries: FoodDbEntry[]): MatchResult {
  const matched: MatchResult['matched'] = [];
  const unmatched: string[] = [];

  for (const token of tokens) {
    // Extract quantity suffix
    const qtyMatch = token.match(/^(.+?)\s+x(\d+(?:\.\d+)?)$/);
    const searchToken = qtyMatch ? qtyMatch[1] : token;
    const quantity = qtyMatch ? parseFloat(qtyMatch[2]) : 1;

    const normalizedToken = normalizeText(searchToken);
    const stemmedToken = stemPhrase(normalizedToken);
    let bestMatch: FoodDbEntry | null = null;
    let bestScore = 0;

    for (const entry of foodEntries) {
      const keywords = normalizeText(entry.keywords).split(',').map(k => k.trim());
      const entryName = normalizeText(entry.name);

      // Exact keyword match (with stemming)
      for (const kw of keywords) {
        if (kw === normalizedToken || stemPhrase(kw) === stemmedToken) {
          bestMatch = entry;
          bestScore = 100;
          break;
        }
      }
      if (bestScore === 100) break;

      // Word-level matching against keywords (with stemming)
      const tokenWords = normalizedToken.split(/\s+/);
      const tokenStems = tokenWords.map(stemWord);
      for (const kw of keywords) {
        const kwWords = kw.split(/\s+/);
        const kwStems = kwWords.map(stemWord);
        const matchedWords = tokenStems.filter(ts => kwStems.includes(ts)).length;
        if (matchedWords > 0) {
          const tokenCoverage = matchedWords / tokenWords.length;
          const score = tokenCoverage * 85;
          if (score > bestScore) {
            bestScore = score;
            bestMatch = entry;
          }
        }
      }

      // Word-level matching against entry name (with stemming)
      const nameWords = entryName.split(/\s+/);
      const nameStems = nameWords.map(stemWord);
      const tokenWordsForName = normalizedToken.split(/\s+/);
      const tokenStemsForName = tokenWordsForName.map(stemWord);
      const nameMatchedWords = tokenStemsForName.filter(ts => nameStems.includes(ts)).length;
      if (nameMatchedWords > 0) {
        const score = (nameMatchedWords / tokenWordsForName.length) * 70;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = entry;
        }
      }
    }

    if (bestMatch && bestScore >= 50) {
      matched.push({
        name: bestMatch.name,
        calories: Math.round(bestMatch.calories * quantity),
        source: 'database',
      });
    } else {
      unmatched.push(searchToken);
    }
  }

  return { matched, unmatched };
}

/** Extract base food name (without quantity) and the quantity multiplier */
export function extractBaseAndQuantity(input: string): { baseName: string; quantity: number } {
  const normalized = normalizeText(input);
  const words = normalized.split(/\s+/);
  let quantity = 1;
  const filtered: string[] = [];

  for (const word of words) {
    if (QUANTITY_WORDS[word] !== undefined) {
      quantity = QUANTITY_WORDS[word];
    } else if (/^\d+(\.\d+)?$/.test(word)) {
      quantity = parseFloat(word);
    } else if (!STOP_WORDS.has(word)) {
      filtered.push(word);
    }
  }

  const base = filtered.join(' ') || normalized;
  return {
    baseName: stemPhrase(base),
    quantity,
  };
}

/** Query the food_database table and match user input */
export function searchFoodDatabase(input: string): MatchResult {
  const db = getDb();
  const allFoods = db.prepare('SELECT * FROM food_database').all() as FoodDbEntry[];
  const tokens = tokenizeInput(input);
  return matchTokensToFoods(tokens, allFoods);
}
