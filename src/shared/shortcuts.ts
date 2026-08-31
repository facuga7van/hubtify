/**
 * Single source of truth for the app's keyboard shortcuts.
 *
 * There used to be two hand-maintained lists — one in SettingsPage (7 items) and
 * one in ShortcutModal (8 items) — and neither documented the quick-add.
 */
export interface ShortcutEntry {
  keys: string;
  i18nKey: string;
  fallback: string;
}

export const SHORTCUTS: ShortcutEntry[] = [
  { keys: 'Ctrl+1', i18nKey: 'shortcuts.goHome', fallback: 'Ir al Tablero' },
  { keys: 'Ctrl+2', i18nKey: 'shortcuts.goQuests', fallback: 'Ir a Questify' },
  { keys: 'Ctrl+3', i18nKey: 'shortcuts.goNutrition', fallback: 'Ir a Nutrify' },
  { keys: 'Ctrl+4', i18nKey: 'shortcuts.goFinance', fallback: 'Ir a Coinify' },
  { keys: 'Ctrl+5', i18nKey: 'shortcuts.goCharacter', fallback: 'Ir al Héroe' },
  { keys: 'Ctrl+6', i18nKey: 'shortcuts.goCauldron', fallback: 'Ir al Caldero' },
  { keys: 'Ctrl+K', i18nKey: 'shortcuts.quickAdd', fallback: 'Añadido rápido' },
  { keys: 'Ctrl+,', i18nKey: 'shortcuts.goSettings', fallback: 'Abrir Ajustes' },
  { keys: 'Ctrl+?', i18nKey: 'shortcuts.showShortcuts', fallback: 'Ver esta lista' },
];
