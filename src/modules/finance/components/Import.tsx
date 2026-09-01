import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import HelpBubble from '../../../shared/components/HelpBubble';
import { useToast } from '../../../shared/components/useToast';
import { useConfirm } from '../../../shared/components/ConfirmDialog';
import { CARD_TAX_CATEGORY, CATEGORIES, type CreditCard, type ImportParsedRow } from '../types';
import { rememberCategoryForMerchant } from '../utils/category-mapping';
import CreditCardManager from './shared/CreditCardManager';
import { AccountSelect, NO_ACCOUNT, accountIdForSubmit, rememberLastAccountId } from './shared/AccountSelect';
import { ChevronDown, ChevronRight } from '../../../shared/components/icons';
import { formatCurrency } from '../utils/format';
import {
  getImportBatches,
  importConfirm,
  undoImportBatch,
  hasImportBatchSupport,
  type ImportBatch,
} from '../utils/api-ext';

interface RowState extends ImportParsedRow {
  included: boolean;
  category: string;
}

/**
 * Which card a statement most likely belongs to.
 *
 * The filename usually carries the issuer ("Resumen_Galicia_VISA_2026-01.pdf"),
 * so a card whose name is contained in it wins. Otherwise the first (oldest)
 * card is a better guess than nothing — the user can always change it, and the
 * choice is spelled out right next to the confirm button.
 */
export function pickLikelyCard(cards: CreditCard[], fileName: string): string {
  if (cards.length === 0) return '';
  const norm = (v: string) =>
    v.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '');
  const file = norm(fileName);
  if (file) {
    const full = cards.find((c) => norm(c.name).length >= 3 && file.includes(norm(c.name)));
    if (full) return full.id;
    const byWord = cards.find((c) =>
      c.name.split(/\s+/).some((w) => norm(w).length >= 4 && file.includes(norm(w))),
    );
    if (byWord) return byWord.id;
  }
  return cards[0].id;
}

interface ImportProps {
  /** Rendered inside a modal that already has a heading — suppresses our own. */
  embedded?: boolean;
  /** Fires whenever there is (or is no longer) unsaved parsed work. */
  onDirtyChange?: (dirty: boolean) => void;
  /** "Discard" pressed with nothing left to keep. */
  onDiscard?: () => void;
  /** A batch was confirmed — the host can reload its own data. */
  onImported?: (count: number) => void;
}

export default function Import({ embedded, onDirtyChange, onDiscard, onImported }: ImportProps = {}) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const confirm = useConfirm();

  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<RowState[]>([]);
  const [statementMonth, setStatementMonth] = useState(defaultMonth);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [successCount, setSuccessCount] = useState<number | null>(null);
  const [showSeal, setShowSeal] = useState(false);
  const [skippedLines, setSkippedLines] = useState<string[]>([]);
  const [skippedExpanded, setSkippedExpanded] = useState(false);
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [batchesExpanded, setBatchesExpanded] = useState(false);
  const [undoingId, setUndoingId] = useState<string | null>(null);
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [creditCardId, setCreditCardId] = useState('');
  /** The user explicitly picked "none"; stop re-guessing a card for them. */
  const [cardTouched, setCardTouched] = useState(false);
  const [showCardManager, setShowCardManager] = useState(false);
  // Card-less imports leave a pocket. '' = unresolved (the selector picks the
  // default); hidden and unsent while the accounts bridge is not wired.
  const [importAccount, setImportAccount] = useState('');
  const [accountsSupported, setAccountsSupported] = useState(false);

  const batchSupport = hasImportBatchSupport();

  const resetPreview = useCallback(() => {
    setFileName('');
    setRows([]);
    setSkippedLines([]);
    setSkippedExpanded(false);
    setParseError('');
    setImportError('');
  }, []);

  const loadBatches = useCallback(() => {
    if (!batchSupport) return;
    getImportBatches().then((data) => setBatches(data ?? []));
  }, [batchSupport]);

  useEffect(() => { loadBatches(); }, [loadBatches]);

  const loadCards = useCallback(() => {
    window.api.financeGetCreditCards()
      .then((data) => setCards(data as CreditCard[]))
      .catch((err) => console.error('[Import] financeGetCreditCards failed:', err));
  }, []);

  useEffect(() => { loadCards(); }, [loadCards]);

  // Guess the card for the statement the moment there is something to guess from,
  // but never overrule a choice the user already made.
  useEffect(() => {
    if (cardTouched || rows.length === 0) return;
    setCreditCardId((prev) => (prev ? prev : pickLikelyCard(cards, fileName)));
  }, [cards, fileName, rows.length, cardTouched]);

  // Parsed-but-unconfirmed rows are minutes of work: let the host warn before closing.
  useEffect(() => { onDirtyChange?.(rows.length > 0); }, [rows.length, onDirtyChange]);

  // Reset all state when account is switched
  useEffect(() => {
    const handler = () => {
      resetPreview();
      setSuccessCount(null);
      setShowSeal(false);
      setParsing(false);
      setImporting(false);
      setCreditCardId('');
      setCardTouched(false);
      loadBatches();
      loadCards();
    };
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
  }, [resetPreview, loadBatches, loadCards]);

  const handleSelectFile = async () => {
    resetPreview();
    setSuccessCount(null);
    setShowSeal(false);
    // A different statement may belong to a different card — guess again.
    setCreditCardId('');
    setCardTouched(false);

    setParsing(true);
    try {
      const result = await window.api.financeImportSelectAndParsePDF();
      if (!result) {
        setParsing(false);
        return; // user cancelled dialog
      }
      setFileName(result.fileName);
      setSkippedLines(result.skippedLines ?? []);
      setSkippedExpanded(false);
      const rowStates: RowState[] = (result.rows as ImportParsedRow[]).map((r) => ({
        ...r,
        included: !r.isExcluded,
        category: r.suggestedCategory,
      }));
      setRows(rowStates);
    } catch (err) {
      console.error('[Import] PDF parse failed:', err);
      setParseError(t('coinify.importErrorParse'));
    } finally {
      setParsing(false);
    }
  };

  const toggleRow = (idx: number) => {
    setRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, included: !r.included } : r))
    );
  };

  /**
   * Correcting a category here is the one moment the user tells the app what a
   * merchant means. `finance_category_mappings` has always had a writer and a
   * reader; nobody ever called the writer, so the table stayed empty and every
   * statement had to be re-categorised from scratch. Now the correction sticks.
   */
  const setCategory = (idx: number, category: string) => {
    const row = rows[idx];
    if (row && category !== row.suggestedCategory && !row.isTax) {
      void rememberCategoryForMerchant(row.merchant, category);
    }
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, category } : r)));
  };

  const includedCount = rows.filter((r) => r.included).length;
  const allIncluded = rows.length > 0 && includedCount === rows.length;

  /** One control for "todas / ninguna" — 200 checkboxes was the only option before. */
  const toggleAll = () => {
    const next = !allIncluded;
    setRows((prev) => prev.map((r) => ({ ...r, included: next })));
  };

  /** The currency column is noise when the whole statement is in pesos. */
  const showCurrencyColumn = useMemo(
    () => rows.some((r) => r.amountUSD != null),
    [rows],
  );

  const handleDiscard = async () => {
    if (rows.length > 0) {
      const ok = await confirm({
        message: t('coinify.importDiscardConfirm', '¿Descartar la importación? Se perderán las filas ya procesadas.'),
        danger: true,
        confirmText: t('coinify.importDiscard', 'Descartar'),
      });
      if (!ok) return;
    }
    resetPreview();
    onDiscard?.();
  };

  const handleConfirm = async () => {
    const toImport: ImportParsedRow[] = rows
      .filter((r) => r.included)
      .map(({ included: _included, ...rest }) => ({ ...rest, suggestedCategory: rest.category }));

    setImporting(true);
    setImportError('');
    setSuccessCount(null);

    try {
      // With a card the rows belong to the statement, not to a pocket; without
      // one they leave the chosen account right away.
      const useAccount = accountsSupported && !creditCardId;
      if (useAccount) rememberLastAccountId(importAccount === '' ? NO_ACCOUNT : importAccount);
      const result = await importConfirm(
        toImport, statementMonth, fileName, creditCardId || null,
        useAccount ? accountIdForSubmit(importAccount) : undefined,
      );
      if ('ok' in result) {
        const reason = (result as { reason?: string }).reason;
        const message = reason === 'invalid_statement_month'
          ? t('coinify.importErrorStatementMonth', 'Elegí el mes del resumen antes de importar.')
          : reason === 'account_not_found'
            ? t('coinify.importErrorAccountMissing', 'La cuenta elegida ya no existe. Elegí otra y volvé a intentar.')
            // The chosen card vanished (deleted in another window / another account).
            : t('coinify.importErrorCardMissing', 'La tarjeta elegida ya no existe. Elegí otra y volvé a intentar.');
        setImportError(message);
        toast({ type: 'warning', message });
        if (reason === 'credit_card_not_found' || reason === undefined) {
          setCreditCardId('');
          loadCards();
        }
        return;
      }
      // Record-only (xp 0): imports are deliberately excluded from paying XP
      // (60 rows per PDF would be pure farming — see utils/rpg-events.ts), but
      // the act still feeds the 'scribe_of_accounts' achievement.
      await window.api.processRpgEvent({
        type: 'STATEMENT_IMPORTED', moduleId: 'finance',
        payload: { xp: 0, hp: 0, count: result.count, month: statementMonth }, timestamp: Date.now(),
      }).catch(() => null);
      setSuccessCount(result.count);
      setRows([]);
      setFileName('');
      setSkippedLines([]);
      loadBatches();
      onImported?.(result.count);
      // Card-assigned rows change what the statements and the dashboard owe;
      // the undo path already announced itself, the confirm path never did.
      window.dispatchEvent(new Event('finance:dataChanged'));

      // Seal animation + toast
      setShowSeal(true);
      setTimeout(() => setShowSeal(false), 600);
      toast({ type: 'coin', message: t('coinify.importSuccess', { count: result.count }), details: { transactionType: 'imported' } });
      if (result.duplicateCount > 0) {
        toast({ type: 'warning', message: t('coinify.importDuplicatesSkipped', { count: result.duplicateCount }) });
      }
    } catch (err) {
      console.error('[Import] financeImportConfirm failed:', err);
      setImportError(t('coinify.importErrorConfirm'));
      toast({ type: 'warning', message: t('coinify.importErrorGeneric', 'Error al importar') });
    } finally {
      setImporting(false);
    }
  };

  /** Reverts a confirmed import — soft-deletes every row of that batch. */
  const handleUndoBatch = async (batch: ImportBatch) => {
    const ok = await confirm({
      message: t('coinify.importUndoConfirm', '¿Revertir esta importación? Se eliminarán {{count}} movimientos.', { count: batch.liveCount }),
      danger: true,
      confirmText: t('coinify.importUndo', 'Revertir'),
    });
    if (!ok) return;

    setUndoingId(batch.id);
    try {
      const res = await undoImportBatch(batch.id);
      if (!res || res.ok === false) {
        toast({ type: 'warning', message: t('coinify.importUndoError', 'No se pudo revertir la importación') });
        return;
      }
      toast({ type: 'coin', message: t('coinify.importUndone', '{{count}} movimientos revertidos', { count: res.deleted }) });
      // The green "N imported" banner must not outlive the batch it announced.
      setSuccessCount(null);
      loadBatches();
      onImported?.(0);
      window.dispatchEvent(new Event('finance:dataChanged'));
    } finally {
      setUndoingId(null);
    }
  };

  const formatRowAmount = (row: RowState) => {
    if (row.amountUSD != null) return formatCurrency(row.amountUSD, { currency: 'USD' });
    if (row.amountARS != null) return formatCurrency(row.amountARS, { currency: 'ARS' });
    return '-';
  };

  const formatRowCurrency = (row: RowState) => {
    if (row.amountUSD != null) return 'USD';
    if (row.amountARS != null) return 'ARS';
    return '-';
  };

  const formatInstallment = (row: RowState) => {
    if (row.installmentCurrent != null && row.installmentTotal != null) {
      return `${row.installmentCurrent}/${row.installmentTotal}`;
    }
    return '-';
  };

  const formatBatchDate = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(i18n.language === 'en' ? 'en-US' : 'es-AR');
  };

  return (
    <div style={{ position: 'relative' }}>
      <HelpBubble variant="inline" className="coin-import-help" text={t('coinify.importHelp', 'Importá el PDF de tu resumen de tarjeta. El sistema extrae movimientos y sugiere categorías.')} />
      {!embedded && (
        <h2 style={{ color: 'var(--leather)', fontSize: 'var(--fs-nav)', fontFamily: "'UnifrakturCook', cursive", margin: 0, marginBottom: 16 }}>
          {t('coinify.importTitle')}
        </h2>
      )}

      {/* File picker — styled drop zone */}
      <div className="coin-import-drop">
        <button className="rpg-button coin-import-drop__label" onClick={handleSelectFile} disabled={parsing}>
          {t('coinify.importSelectFile')}
        </button>
        <span className="coin-import-drop__filename">
          {fileName || t('coinify.importNoFile')}
        </span>
        {parsing && (
          <span className="coin-import-drop__parsing">{t('coinify.importParsing')}</span>
        )}
      </div>

      {/* Parse error */}
      {parseError && (
        <p style={{ fontSize: 'var(--fs-label)', color: 'var(--rubric)', marginBottom: 12 }}>{parseError}</p>
      )}

      {/* Preview table */}
      {rows.length > 0 && (
        <div>
          <p className="coin-import-preview-count">
            {t('coinify.importPreview')} -- {includedCount} / {rows.length}
          </p>

          <div className="rpg-card" style={{ padding: 12, marginBottom: 16, overflowX: 'auto' }}>
            <table className="coin-import-table">
              <thead>
                <tr>
                  <th>
                    <label className="coin-import-table__all">
                      <input
                        type="checkbox"
                        checked={allIncluded}
                        // Partially selected reads as neither on nor off.
                        ref={(el) => { if (el) el.indeterminate = includedCount > 0 && !allIncluded; }}
                        onChange={toggleAll}
                        aria-label={t('coinify.importToggleAll', 'Marcar todo / ninguno')}
                        title={t('coinify.importToggleAll', 'Marcar todo / ninguno')}
                      />
                      <span>{t('coinify.importColInclude')}</span>
                    </label>
                  </th>
                  <th>{t('coinify.importColDate')}</th>
                  <th>{t('coinify.importColMerchant')}</th>
                  <th>{t('coinify.importColInstallment')}</th>
                  <th>{t('coinify.importColAmount')}</th>
                  {showCurrencyColumn && <th>{t('coinify.importColCurrency')}</th>}
                  <th>{t('coinify.importColCategory')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => (
                  <tr
                    key={idx}
                    className={[
                      'coin-import-row',
                      !row.included ? 'coin-import-row--excluded' : '',
                      // Included by default — they are what makes the total match
                      // the paper — but visibly not one of the user's purchases.
                      row.isTax ? 'coin-import-row--tax' : '',
                    ].filter(Boolean).join(' ')}
                  >
                    <td>
                      <input type="checkbox" checked={row.included} onChange={() => toggleRow(idx)}
                        aria-label={`${t('coinify.importColInclude')}: ${row.merchant}`} />
                    </td>
                    <td style={{ whiteSpace: 'nowrap', opacity: 0.7 }}>{row.date}</td>
                    <td className="coin-import-row__merchant" title={row.merchant}>
                      {row.merchant}
                      {row.isTax && (
                        <span
                          className="coin-import-row__tax-badge"
                          title={t('coinify.importTaxHint', 'Impuesto o cargo del resumen. Se importa para que el total coincida con el del banco.')}
                        >
                          {t('coinify.importTaxBadge', 'impuesto')}
                        </span>
                      )}
                    </td>
                    <td className="coin-import-row__installment">{formatInstallment(row)}</td>
                    <td className="coin-import-row__amount">{formatRowAmount(row)}</td>
                    {showCurrencyColumn && <td className="coin-import-row__currency">{formatRowCurrency(row)}</td>}
                    <td>
                      <select
                        value={row.category}
                        onChange={(e) => setCategory(idx, e.target.value)}
                        className="rpg-select"
                        style={{ fontSize: 'var(--fs-label)' }}
                        disabled={!row.included}
                        aria-label={`${t('coinify.importColCategory')}: ${row.merchant}`}
                      >
                        {/* A tax row's reserved category is not in CATEGORIES —
                            without this option the select would render blank and
                            the first change would silently re-file the charge.
                            Offered for the whole life of the row, so a change of
                            mind can put it back. */}
                        {(row.isTax || row.category === CARD_TAX_CATEGORY) && (
                          <option value={CARD_TAX_CATEGORY}>{CARD_TAX_CATEGORY}</option>
                        )}
                        {CATEGORIES.map((cat) => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Skipped lines warning */}
          {skippedLines.length > 0 && (
            <div
              className="rpg-card"
              style={{
                padding: 12,
                marginBottom: 16,
                borderColor: 'var(--gold)',
                borderWidth: 2,
                background: 'rgba(255, 193, 7, 0.08)',
              }}
            >
              <div
                style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                onClick={() => setSkippedExpanded((v) => !v)}
              >
                <span style={{ color: 'var(--gold)', fontSize: 'var(--fs-sub)' }}>
                  {skippedExpanded ? <ChevronDown /> : <ChevronRight />}
                </span>
                <span style={{ color: 'var(--gold)', fontWeight: 600, fontSize: 'var(--fs-label)' }}>
                  {t('coinify.importSkippedLines', { count: skippedLines.length })}
                </span>
              </div>
              {skippedExpanded && (
                <div style={{ marginTop: 8 }}>
                  <p style={{ fontSize: 'var(--fs-label)', color: 'var(--leather)', opacity: 0.8, margin: '0 0 6px' }}>
                    {t('coinify.importSkippedLinesHint')}
                  </p>
                  <ul style={{ margin: 0, padding: '0 0 0 8px', listStyle: 'none' }}>
                    {skippedLines.map((line, i) => (
                      <li
                        key={i}
                        style={{
                          fontFamily: 'monospace',
                          fontSize: 'var(--fs-label)',
                          padding: '2px 0',
                          color: 'var(--leather)',
                          opacity: 0.9,
                          wordBreak: 'break-all',
                        }}
                      >
                        {line}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Which card this statement belongs to.
              Without one the rows used to hit the balance immediately AND never
              reach any statement, so paying the statement counted them twice. */}
          <div className="coin-import-card">
            <label className="coin-import-card__label" htmlFor="coin-import-card">
              {t('coinify.importCard', 'Tarjeta del resumen')}
            </label>
            {cards.length > 0 ? (
              <select
                id="coin-import-card"
                className="rpg-select coin-import-card__select"
                value={creditCardId}
                onChange={(e) => { setCardTouched(true); setCreditCardId(e.target.value); }}
              >
                {cards.map((card) => (
                  <option key={card.id} value={card.id}>
                    {card.name} ({t('coinify.closingDay')}: {card.closingDay})
                  </option>
                ))}
                <option value="">{t('coinify.importCardNone', 'Ninguna / efectivo')}</option>
              </select>
            ) : (
              <span className="coin-import-card__empty">
                {t('coinify.importNoCards', 'No tenés ninguna tarjeta cargada.')}
                {' '}
                <button
                  type="button"
                  className="rpg-button coin-import-card__create"
                  onClick={() => setShowCardManager(true)}
                >
                  {t('coinify.importCreateCard', 'Crear tarjeta')}
                </button>
              </span>
            )}
            <p className="coin-import-card__hint">
              {creditCardId
                ? t(
                    'coinify.importCardHint',
                    'Los movimientos entran al resumen de esa tarjeta y no descuentan del saldo hasta que pagues el resumen.',
                  )
                : t(
                    'coinify.importCardHintNone',
                    'Sin tarjeta, los movimientos descuentan del saldo en el acto y no forman parte de ningún resumen. Si además pagás el resumen de la tarjeta, el gasto se cuenta dos veces.',
                  )}
            </p>
            {/* No card → the rows leave a pocket right away: which one? The
                selector renders nothing while the accounts bridge is not wired. */}
            {!creditCardId && (
              <div className="coin-import-card" style={{ marginTop: 8 }}>
                <label className="coin-import-card__label">
                  {t('coinify.importAccount', 'Cuenta de los movimientos')}
                </label>
                <AccountSelect value={importAccount} onChange={setImportAccount} onSupported={setAccountsSupported} />
              </div>
            )}
          </div>

          {/* Month selector + confirm */}
          <div className="coin-import-confirm-row">
            <div className="coin-import-confirm-row__month">
              <label className="coin-import-confirm-row__month-label" htmlFor="coin-import-month">{t('coinify.importStatementMonth')}</label>
              <input
                id="coin-import-month"
                type="month"
                value={statementMonth}
                onChange={(e) => setStatementMonth(e.target.value)}
                className="rpg-input"
                style={{ fontSize: 'var(--fs-label)' }}
              />
            </div>
            <button
              className="rpg-button"
              onClick={handleConfirm}
              disabled={importing || includedCount === 0}
            >
              {importing ? t('coinify.importImporting') : `${t('coinify.importConfirm')} (${includedCount})`}
              {showSeal && (
                <span className="coin-import-seal">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round">
                    <circle cx="12" cy="12" r="10" /><path d="M9 12l2 2 4-4" />
                  </svg>
                </span>
              )}
            </button>
            {/* There was no way out of the importer other than closing the whole modal. */}
            <button className="rpg-button coin-import-discard" onClick={handleDiscard} disabled={importing}>
              {t('coinify.importDiscard', 'Descartar')}
            </button>
          </div>

          {importError && (
            <p style={{ fontSize: 'var(--fs-label)', color: 'var(--rubric)' }}>{importError}</p>
          )}
        </div>
      )}

      {/* Success message */}
      {successCount !== null && (
        <div className="rpg-card coin-import-success">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--moss)" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="10" /><path d="M9 12l2 2 4-4" />
          </svg>
          {t('coinify.importSuccess', { count: successCount })}
        </div>
      )}

      {showCardManager && (
        <CreditCardManager
          cards={cards}
          onClose={() => setShowCardManager(false)}
          onSaved={loadCards}
        />
      )}

      {/* Previous imports — undo a batch that already landed. */}
      {batchSupport && batches.length > 0 && (
        <div className="coin-import-batches">
          <button
            type="button"
            className="coin-import-batches__toggle"
            aria-expanded={batchesExpanded}
            onClick={() => setBatchesExpanded((v) => !v)}
          >
            {batchesExpanded ? <ChevronDown style={{ width: '0.7em', height: '0.7em' }} /> : <ChevronRight style={{ width: '0.7em', height: '0.7em' }} />}
            {' '}{t('coinify.importPreviousBatches', 'Importaciones anteriores')} ({batches.length})
          </button>
          {batchesExpanded && (
            <ul className="coin-import-batches__list">
              {batches.map((batch) => (
                <li key={batch.id} className="coin-import-batches__row">
                  <span className="coin-import-batches__name" title={batch.filename ?? batch.source}>
                    {batch.filename || batch.source}
                  </span>
                  <span className="coin-import-batches__meta">
                    {formatBatchDate(batch.createdAt)}
                    {' · '}
                    {t('coinify.importBatchRows', '{{live}} de {{total}} vigentes', { live: batch.liveCount, total: batch.rowCount })}
                  </span>
                  <button
                    className="rpg-button"
                    style={{ fontSize: 'var(--fs-label)', padding: '2px 8px' }}
                    disabled={batch.liveCount === 0 || undoingId === batch.id}
                    onClick={() => handleUndoBatch(batch)}
                  >
                    {t('coinify.importUndo', 'Revertir')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
