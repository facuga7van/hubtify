import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import HelpBubble from '../../../shared/components/HelpBubble';
import { useToast } from '../../../shared/components/useToast';
import type { ParsedRow } from '../../../../shared/types';
import { CATEGORIES } from '../types';
import { formatCurrency } from '../utils/format';

interface RowState extends ParsedRow {
  included: boolean;
  category: string;
}

export default function Import() {
  const { t } = useTranslation();
  const { toast } = useToast();

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

  // Reset all state when account is switched
  useEffect(() => {
    const handler = () => {
      setFileName('');
      setRows([]);
      setSkippedLines([]);
      setSkippedExpanded(false);
      setParseError('');
      setImportError('');
      setSuccessCount(null);
      setShowSeal(false);
      setParsing(false);
      setImporting(false);
    };
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
  }, []);

  const handleSelectFile = async () => {
    setRows([]);
    setSkippedLines([]);
    setSkippedExpanded(false);
    setParseError('');
    setSuccessCount(null);
    setShowSeal(false);

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
      const rowStates: RowState[] = result.rows.map((r) => ({
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

  const setCategory = (idx: number, category: string) => {
    setRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, category } : r))
    );
  };

  const handleConfirm = async () => {
    const toImport: ParsedRow[] = rows
      .filter((r) => r.included)
      .map(({ included: _included, ...rest }) => ({ ...rest, suggestedCategory: rest.category }));

    setImporting(true);
    setImportError('');
    setSuccessCount(null);

    try {
      const result = await window.api.financeImportConfirm(toImport, statementMonth, fileName);
      setSuccessCount(result.count);
      setRows([]);
      setFileName('');
      setSkippedLines([]);

      // Seal animation + toast
      setShowSeal(true);
      setTimeout(() => setShowSeal(false), 600);
      toast({ type: 'coin', message: t('coinify.importSuccess', { count: result.count }), details: { transactionType: 'imported' } });
      if (result.duplicateCount > 0) {
        toast({ type: 'warning', message: t('coinify.importDuplicatesSkipped', { count: result.duplicateCount }) });
      }
    } catch {
      setImportError(t('coinify.importErrorConfirm'));
    } finally {
      setImporting(false);
    }
  };

  const formatRowAmount = (row: RowState) => {
    if (row.amountUSD != null) return formatCurrency(row.amountUSD, { currency: 'USD' });
    if (row.amountARS != null) return formatCurrency(row.amountARS);
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

  const includedCount = rows.filter((r) => r.included).length;

  return (
    <div style={{ position: 'relative' }}>
      <HelpBubble text={t('coinify.importHelp', 'Importá el PDF de tu resumen de tarjeta. El sistema extrae movimientos y sugiere categorías.')} />
      <h2 style={{ color: 'var(--leather)', fontSize: 'var(--fs-nav)', fontFamily: "'UnifrakturCook', cursive", margin: 0, marginBottom: 16 }}>
        {t('coinify.importTitle')}
      </h2>

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
                  <th>{t('coinify.importColInclude')}</th>
                  <th>{t('coinify.importColDate')}</th>
                  <th>{t('coinify.importColMerchant')}</th>
                  <th>{t('coinify.importColInstallment')}</th>
                  <th>{t('coinify.importColAmount')}</th>
                  <th>{t('coinify.importColCurrency')}</th>
                  <th>{t('coinify.importColCategory')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => (
                  <tr
                    key={idx}
                    className={`coin-import-row ${!row.included ? 'coin-import-row--excluded' : ''}`}
                  >
                    <td>
                      <input type="checkbox" checked={row.included} onChange={() => toggleRow(idx)} />
                    </td>
                    <td style={{ whiteSpace: 'nowrap', opacity: 0.7 }}>{row.date}</td>
                    <td className="coin-import-row__merchant" title={row.merchant}>
                      {row.merchant}
                    </td>
                    <td className="coin-import-row__installment">{formatInstallment(row)}</td>
                    <td className="coin-import-row__amount">{formatRowAmount(row)}</td>
                    <td className="coin-import-row__currency">{formatRowCurrency(row)}</td>
                    <td>
                      <select
                        value={row.category}
                        onChange={(e) => setCategory(idx, e.target.value)}
                        className="rpg-select"
                        style={{ fontSize: 'var(--fs-label)' }}
                        disabled={!row.included}
                      >
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
                  {skippedExpanded ? '\u25BC' : '\u25B6'}
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

          {/* Month selector + confirm */}
          <div className="coin-import-confirm-row">
            <div className="coin-import-confirm-row__month">
              <label className="coin-import-confirm-row__month-label">{t('coinify.importStatementMonth')}</label>
              <input
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
    </div>
  );
}
