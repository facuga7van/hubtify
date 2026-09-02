/**
 * The reserved category names exist twice on purpose: the main process cannot
 * import renderer code and the renderer must not import main-process code. The
 * duplication is only safe while a test refuses to let the copies drift — a
 * mismatch would silently split the imported taxes into two categories, one of
 * which the UI would never group or hide.
 */
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { financeMigrations } from '@modules/finance/finance.schema';
import {
  CARD_PAYMENT_CATEGORY,
  CARD_TAX_CATEGORY,
  RESERVED_CATEGORIES,
} from '../../../shared-logic/modules/finance.balance';
import {
  CARD_PAYMENT_CATEGORY as UI_CARD_PAYMENT_CATEGORY,
  CARD_TAX_CATEGORY as UI_CARD_TAX_CATEGORY,
  RESERVED_CATEGORIES as UI_RESERVED_CATEGORIES,
  CATEGORIES,
} from '@modules/finance/types';

describe('reserved finance categories', () => {
  it('are spelled identically in the main process and the renderer', () => {
    expect(UI_CARD_PAYMENT_CATEGORY).toBe(CARD_PAYMENT_CATEGORY);
    expect(UI_CARD_TAX_CATEGORY).toBe(CARD_TAX_CATEGORY);
    expect([...UI_RESERVED_CATEGORIES]).toEqual([...RESERVED_CATEGORIES]);
  });

  it('are never offered as a plain pick-from-the-list category', () => {
    for (const reserved of RESERVED_CATEGORIES) {
      expect(CATEGORIES as readonly string[]).not.toContain(reserved);
    }
  });

  it('exist in the categories table, so reports can name them', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    for (const m of financeMigrations) db.exec(m.up);
    const names = (db.prepare('SELECT name FROM finance_categories').all() as Array<{ name: string }>)
      .map((r) => r.name);
    db.close();
    for (const reserved of RESERVED_CATEGORIES) {
      expect(names).toContain(reserved);
    }
  });
});
