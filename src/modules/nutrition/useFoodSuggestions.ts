import { useCallback, useEffect, useRef, useState } from 'react';
import { searchHistory } from './history-api';
import type { HistorySuggestion } from './history-search';

/** Keystrokes settle for this long before the log is queried. */
export const SUGGESTION_DEBOUNCE_MS = 150;

/** Below this, a query is too vague to be worth a dropdown. */
export const MIN_QUERY_LENGTH = 2;

/** How many "your usuals" the empty input offers. */
export const USUALS_LIMIT = 4;

/** How many matches a typed query offers. */
export const SEARCH_LIMIT = 8;

export interface SuggestionKeyHandlers {
  /** Enter (or a click) on a highlighted suggestion — log it. */
  onChoose: (suggestion: HistorySuggestion) => void;
  /** Tab on a highlighted suggestion — fill the input, do NOT log. */
  onComplete: (suggestion: HistorySuggestion) => void;
  /** Enter with nothing highlighted — whatever the input did before. */
  onSubmit: () => void;
}

/**
 * The history dropdown's state machine.
 *
 * Two behaviours here are deliberate and worth defending:
 *
 * NOTHING IS PRESELECTED. `activeIndex` starts at -1 and returns to -1 every
 * time the list changes. Enter therefore means the same thing it has always
 * meant — "estimate this with the AI" — until the user presses Down on purpose.
 * Auto-highlighting the first row would silently redefine the Enter key based on
 * a network result that arrived 150 ms ago, and people would log the wrong meal.
 *
 * ARROW-UP PAST THE TOP RETURNS TO NO SELECTION rather than wrapping to the
 * bottom, so there is always a way back to the AI path without reaching for the
 * mouse or clearing the input.
 */
export function useFoodSuggestions(query: string, enabled: boolean) {
  const [suggestions, setSuggestions] = useState<HistorySuggestion[]>([]);
  const [focused, setFocusedState] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  /** Escape (or `close()`) hides the list until the user types or focuses again. */
  const [dismissed, setDismissed] = useState(false);
  /** Guards against an out-of-order response overwriting a newer one. */
  const requestRef = useRef(0);

  const trimmed = query.trim();
  const mode: 'usuals' | 'search' | 'idle' =
    trimmed.length === 0 ? 'usuals'
      : trimmed.length >= MIN_QUERY_LENGTH ? 'search'
        : 'idle';

  // Typing something un-dismisses; the query going EMPTY does not. Logging a
  // suggestion clears the input and calls close() in the same batch, and the
  // old "any change resets" rule reopened "Tus de siempre" right over the
  // entry that was just added. A fresh focus still answers with the usuals.
  useEffect(() => { if (trimmed.length > 0) setDismissed(false); }, [trimmed]);

  const setFocused = useCallback((next: boolean) => {
    setFocusedState(next);
    if (next) setDismissed(false);
  }, []);

  useEffect(() => {
    if (!enabled || !focused || mode === 'idle') {
      setSuggestions([]);
      return;
    }
    const ticket = ++requestRef.current;
    const run = async () => {
      const results = mode === 'usuals'
        ? await searchHistory('', USUALS_LIMIT)
        : await searchHistory(trimmed, SEARCH_LIMIT);
      if (requestRef.current !== ticket) return; // a newer keystroke won
      setSuggestions(results);
    };
    // "Your usuals" answers a focus, not a keystroke — showing it instantly is
    // the whole point, so only the typed path pays the debounce.
    if (mode === 'usuals') { run(); return; }
    const timer = setTimeout(run, SUGGESTION_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed, mode, enabled, focused]);

  // Any change to the list drops the highlight. See the header.
  useEffect(() => { setActiveIndex(-1); }, [suggestions]);

  const open = enabled && focused && !dismissed && suggestions.length > 0;

  const handleKeyDown = useCallback((
    e: React.KeyboardEvent<HTMLInputElement>,
    handlers: SuggestionKeyHandlers,
  ) => {
    if (!open) {
      if (e.key === 'ArrowDown') { setDismissed(false); return; }
      if (e.key === 'Enter') handlers.onSubmit();
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex(i => Math.min(suggestions.length - 1, i + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex(i => (i <= 0 ? -1 : i - 1));
        break;
      case 'Enter':
        if (activeIndex >= 0 && suggestions[activeIndex]) {
          e.preventDefault();
          handlers.onChoose(suggestions[activeIndex]);
        } else {
          handlers.onSubmit();
        }
        break;
      case 'Tab':
        if (activeIndex >= 0 && suggestions[activeIndex]) {
          e.preventDefault();
          handlers.onComplete(suggestions[activeIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setDismissed(true);
        setActiveIndex(-1);
        break;
      default:
        break;
    }
  }, [open, suggestions, activeIndex]);

  /** Call after a suggestion is logged, so the list does not linger over the input. */
  const close = useCallback(() => {
    setDismissed(true);
    setActiveIndex(-1);
  }, []);

  return {
    suggestions, open, mode, activeIndex, setActiveIndex,
    setFocused, handleKeyDown, close,
  };
}
