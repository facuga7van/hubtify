import { ipcHandle } from '../ipc/ipc-handle';
import { getDb } from '../ipc/db';
import { dialog, BrowserWindow } from 'electron';
import crypto from 'crypto';
import fs from 'fs';
import { nowIso } from './finance.balance';

// ── Types ───────────────────────────────────────────

export interface ParsedRow {
  date: string;           // YYYY-MM-DD
  merchant: string;
  installmentCurrent?: number;
  installmentTotal?: number;
  /** For a USD line this is the amount the card actually charged in pesos. */
  amountARS?: number;
  amountUSD?: number;
  isExcluded: boolean;
  suggestedCategory: string;
}

// ── Tax/excluded patterns ───────────────────────────

const EXCLUDED_PATTERNS = [
  /IMP DE SELLOS/i,
  /INTERESES FINANCIACION/i,
  /DB IVA/i,
  /IIBB PERCEP/i,
  /IVA RG/i,
  /DB\.?RG 5617/i,
  /DEV\.IMP/i,
];

// ── Parser ──────────────────────────────────────────

/**
 * Parses a single line from a Galicia VISA credit card PDF statement.
 *
 * Line formats:
 *   DD-MM-YY * MERCHANT_NAME [XX/YY] RECEIPT AMOUNT
 *   DD-MM-YY K MERCHANT_NAME [XX/YY] RECEIPT AMOUNT
 *   DD-MM-YY K MERCHANT_NAME [...] USD  AMOUNT_USD RECEIPT AMOUNT_ARS
 */
export function parseGaliciaLine(
  line: string,
  categoryMappings: Map<string, string>
): ParsedRow | null {
  const trimmed = line.trim();

  // Must start with a date: DD-MM-YY
  const dateMatch = trimmed.match(/^(\d{2})-(\d{2})-(\d{2})\s/);
  if (!dateMatch) return null;

  const [, dd, mm, yy] = dateMatch;
  const date = `20${yy}-${mm}-${dd}`;

  // Check excluded tax patterns before the marker check so lines
  // like "27-11-25 IMP DE SELLOS …" (no * or K) are still caught.
  for (const pattern of EXCLUDED_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        date,
        merchant: '',
        isExcluded: true,
        suggestedCategory: '',
      };
    }
  }

  // After the date there must be a marker: * or K
  const afterDate = trimmed.slice(dateMatch[0].length);
  const markerMatch = afterDate.match(/^([*K])\s+/);
  if (!markerMatch) return null;

  const rest = afterDate.slice(markerMatch[0].length);

  // ── Amount parsing ───────────────────────────────
  // Argentine format: -?\d{1,3}(\.\d{3})*,\d{2}
  // The LAST occurrence on the line is the ARS amount.
  const amountPattern = /-?\d{1,3}(?:\.\d{3})*,\d{2}/g;
  const allAmounts = [...rest.matchAll(amountPattern)];
  if (allAmounts.length === 0) return null;

  const lastAmountMatch = allAmounts[allAmounts.length - 1];
  const amountARS = parseArgentineAmount(lastAmountMatch[0]);

  // ── USD detection ────────────────────────────────
  // Pattern: USD  <amount> <receipt> <arsAmount>
  // The USD amount is the first amount that appears AFTER the "USD" keyword.
  let amountUSD: number | undefined;
  const usdMatch = rest.match(/USD\s+([\d,]+(?:\.\d{3})*,\d{2}|-?\d{1,3}(?:\.\d{3})*,\d{2})/);
  if (usdMatch) {
    amountUSD = parseArgentineAmount(usdMatch[1]);
  }

  // ── Merchant extraction ──────────────────────────
  // Everything between the marker and either:
  //   - an installment pattern (XX/YY where both are 2 digits)
  //   - a receipt number (5–7 digit standalone token)
  //   - the USD keyword
  //   - the amount itself (if nothing else precedes it)
  // We strip the last amount and receipt + installment from the right side.

  // Build a working string without the trailing amount
  let merchantSection = rest.slice(0, lastAmountMatch.index!).trim();

  // Remove trailing receipt number (5–7 digits at end)
  merchantSection = merchantSection.replace(/\s+\d{5,7}\s*$/, '').trim();

  // Remove trailing installment XX/YY if present
  merchantSection = merchantSection.replace(/\s+\d{2}\/\d{2}\s*$/, '').trim();

  // If USD line: remove the "USD  <usdAmount>" suffix from the merchant section
  // as pdf-parse may lay out: MERCHANT_NAME [...] USD        4,76
  merchantSection = merchantSection.replace(/\s+USD\b.*$/i, '').trim();

  // Clean up any trailing receipt-like tokens (alphanumeric short codes from USD lines)
  // e.g. "P1fMHM2Z" in "GOOGLE *YouTubeP P1fMHM2Z"
  // Only strip if it looks like a receipt/code (no spaces, 6–10 chars, mixed alnum)
  merchantSection = merchantSection.replace(/\s+[A-Z0-9]{5,10}\s*$/i, '').trim();

  const merchant = merchantSection;
  if (!merchant) return null;

  // ── Installment extraction ───────────────────────
  let installmentCurrent: number | undefined;
  let installmentTotal: number | undefined;

  // Search in the section between merchant and end of rest
  const afterMerchant = rest.slice(merchant.length);
  const installMatch = afterMerchant.match(/\b(\d{2})\/(\d{2})\b/);
  if (installMatch) {
    installmentCurrent = parseInt(installMatch[1], 10);
    installmentTotal = parseInt(installMatch[2], 10);
  }

  // ── Category suggestion ──────────────────────────
  const suggestedCategory = suggestCategory(merchant, categoryMappings);

  const row: ParsedRow = {
    date,
    merchant,
    isExcluded: false,
    suggestedCategory,
    amountARS,
  };

  if (installmentCurrent !== undefined) {
    row.installmentCurrent = installmentCurrent;
    row.installmentTotal = installmentTotal;
  }

  if (amountUSD !== undefined) {
    // Keep amountARS too: it is the real peso amount the card billed, which the
    // statement total needs. The UI displays amountUSD when it is present.
    row.amountUSD = amountUSD;
  }

  return row;
}

function parseArgentineAmount(str: string): number {
  // "1.234,56" → 1234.56
  // "-22.590,00" → -22590
  return parseFloat(str.replace(/\./g, '').replace(',', '.'));
}

function suggestCategory(merchant: string, mappings: Map<string, string>): string {
  for (const [pattern, category] of mappings) {
    if (merchant.toUpperCase().includes(pattern.toUpperCase())) {
      return category;
    }
  }
  return 'Otros';
}

// ── IPC Handlers ────────────────────────────────────

export function registerFinanceImportIpcHandlers(): void {
  ipcHandle('finance:importSelectAndParsePDF', async () => {
    const win = BrowserWindow.getFocusedWindow();
    const { filePaths, canceled } = await dialog.showOpenDialog(win!, {
      title: 'Seleccionar PDF de resumen',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['openFile'],
    });
    if (canceled || filePaths.length === 0) return null;

    const filePath = filePaths[0];
    const fileName = filePath.split(/[/\\]/).pop() || 'unknown.pdf';

    const buffer = fs.readFileSync(filePath);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(buffer), verbosity: 0 });
    await parser.load();
    const data = await parser.getText();

    const db = getDb();
    const mappingsRaw = db
      .prepare('SELECT keyword, category FROM finance_category_mappings')
      .all() as Array<{ keyword: string; category: string }>;
    const mappings = new Map(mappingsRaw.map(r => [r.keyword, r.category]));

    // Add default mappings (only if not already customised)
    const defaults: [string, string][] = [
      ['RAPPI', 'Delivery'],
      ['MERPAGO', 'Compras'],
      ['GOOGLE', 'Suscripciones'],
      ['TWITCH', 'Suscripciones'],
      ['FRAVEGA', 'Compras'],
      ['UBER', 'Transporte'],
      ['TELECENTRO', 'Servicios'],
      ['CRUNCHYROLL', 'Suscripciones'],
      ['OPENAI', 'Suscripciones'],
    ];
    for (const [k, v] of defaults) {
      if (!mappings.has(k)) mappings.set(k, v);
    }

    const lines = data.text.split('\n').filter((l: string) => l.trim());
    const rows: ParsedRow[] = [];
    const skippedLines: string[] = [];
    const datePrefix = /^\d{2}-\d{2}-\d{2}\s/;
    for (const line of lines) {
      const trimmed = line.trim();
      const parsed = parseGaliciaLine(trimmed, mappings);
      if (parsed) {
        rows.push(parsed);
      } else if (datePrefix.test(trimmed)) {
        // Line starts with a date but couldn't be parsed — potentially lost data
        skippedLines.push(trimmed);
      }
    }
    return { rows, fileName, skippedLines };
  });

  ipcHandle(
    'finance:importConfirm',
    (_e, rows: ParsedRow[], statementMonth: string, fileName: string) => {
      const db = getDb();
      const batchId = crypto.randomUUID();
      const now = nowIso();

      const insertBatch = db.prepare(
        `INSERT INTO finance_import_batches (id, source, filename, row_count, created_at)
         VALUES (?, 'galicia_visa', ?, ?, ?)`,
      );

      const dupCheck = db.prepare(
        `SELECT COUNT(*) as cnt FROM finance_transactions
         WHERE deleted_at IS NULL AND date = ? AND description = ? AND amount = ? AND source = 'import'`,
      );

      const insertTx = db.prepare(
        `INSERT INTO finance_transactions
         (id, type, amount, currency, category, description, date, payment_method, source, import_batch_id,
          installments, billed_amount_ars, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'credit_card', 'import', ?, ?, ?, ?, ?)`,
      );

      // One transaction: a failure halfway used to leave a partial import with a
      // batch row that no longer matched what was actually written.
      const run = db.transaction(() => {
        insertBatch.run(batchId, fileName, rows.length, now);

        let duplicateCount = 0;
        let inserted = 0;

        for (const row of rows) {
          if (row.isExcluded) continue;

          const isUsd = row.amountUSD !== undefined;
          const signed = isUsd ? row.amountUSD! : (row.amountARS ?? 0);
          // A negative line is a refund/credit, not a bigger expense.
          const type = signed < 0 ? 'income' : 'expense';
          const amount = Math.abs(signed);
          const currency = isUsd ? 'USD' : 'ARS';
          // USD lines: keep the peso amount the card actually billed.
          const billedArs = isUsd && row.amountARS != null ? Math.abs(row.amountARS) : null;

          const existing = dupCheck.get(row.date, row.merchant, amount) as { cnt: number };
          if (existing.cnt > 0) {
            duplicateCount++;
            continue;
          }

          insertTx.run(
            crypto.randomUUID(),
            type,
            amount,
            currency,
            row.suggestedCategory,
            row.merchant,
            row.date,
            batchId,
            row.installmentTotal ?? 1,
            billedArs,
            now,
            now,
          );
          inserted++;
        }

        return { batchId, count: inserted, duplicateCount };
      });

      return run();
    },
  );

  /** Undo a whole import batch — `import_batch_id` was written but never read. */
  ipcHandle('finance:undoImportBatch', (_e, batchId: string) => {
    if (typeof batchId !== 'string' || batchId.trim() === '') {
      return { ok: false, reason: 'invalid_batch_id' };
    }
    const db = getDb();
    const now = nowIso();
    const result = db
      .prepare(
        `UPDATE finance_transactions
         SET deleted_at = ?, updated_at = ?
         WHERE import_batch_id = ? AND deleted_at IS NULL`,
      )
      .run(now, now, batchId);
    return { ok: true, deleted: result.changes };
  });

  ipcHandle('finance:getImportBatches', () => {
    const db = getDb();
    return db
      .prepare(
        `SELECT b.id, b.source, b.filename, b.row_count AS rowCount, b.created_at AS createdAt,
                (SELECT COUNT(*) FROM finance_transactions t
                  WHERE t.import_batch_id = b.id AND t.deleted_at IS NULL) AS liveCount
         FROM finance_import_batches b
         ORDER BY b.created_at DESC`,
      )
      .all();
  });

  ipcHandle('finance:getCategoryMappings', () => {
    const db = getDb();
    return db
      .prepare(
        'SELECT id, keyword AS merchantPattern, category, created_at AS createdAt FROM finance_category_mappings ORDER BY keyword',
      )
      .all();
  });

  ipcHandle(
    'finance:updateCategoryMapping',
    (_e, merchantPattern: string, category: string) => {
      const db = getDb();
      const existing = db
        .prepare('SELECT id FROM finance_category_mappings WHERE keyword = ?')
        .get(merchantPattern);
      if (existing) {
        db.prepare(
          'UPDATE finance_category_mappings SET category = ? WHERE keyword = ?',
        ).run(category, merchantPattern);
      } else {
        db.prepare(
          `INSERT INTO finance_category_mappings (id, keyword, category, created_at)
           VALUES (?, ?, ?, ?)`,
        ).run(crypto.randomUUID(), merchantPattern, category, nowIso());
      }
    },
  );
}
