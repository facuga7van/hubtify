import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useCoinToast } from './CoinToastProvider';
import type { ParsedRow } from '../../../../shared/types';
import { CATEGORIES } from '../types';

interface RowState extends ParsedRow {
  included: boolean;
  category: string;
}

export default function Import() {
  const { t } = useTranslation();
  const { showToast } = useCoinToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const [fileName, setFileName] = useState('');
  const [filePath, setFilePath] = useState('');
  const [rows, setRows] = useState<RowState[]>([]);
  const [statementMonth, setStatementMonth] = useState(defaultMonth);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [successCount, setSuccessCount] = useState<number | null>(null);
  const [showSeal, setShowSeal] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const path = (file as File & { path: string }).path;
    setFileName(file.name);
    setFilePath(path);
    setRows([]);
    setParseError('');
    setSuccessCount(null);
    setShowSeal(false);

    setParsing(true);
    try {
      const parsed = await window.api.financeImportParsePDF(path);
      const rowStates: RowState[] = parsed.map((r) => ({
        ...r,
        included: !r.isExcluded,
        category: r.suggestedCategory,
      }));
      setRows(rowStates);
    } catch {
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
      setFilePath('');
      if (fileInputRef.current) fileInputRef.current.value = '';

      // Seal animation + toast
      setShowSeal(true);
      setTimeout(() => setShowSeal(false), 600);
      showToast('imported', t('coinify.importSuccess', { count: result.count }));
    } catch {
      setImportError(t('coinify.importErrorConfirm'));
    } finally {
      setImporting(false);
    }
  };

  const formatAmount = (row: RowState) => {
    if (row.amountUSD != null) return `$${row.amountUSD.toLocaleString('en-US')}`;
    if (row.amountARS != null) return `$${row.amountARS.toLocaleString('es-AR')}`;
    return '-';
  };

  const formatCurrency = (row: RowState) => {
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
    <div>
      <h2 style={{ color: 'var(--rpg-wood)', fontSize: '1.1rem', fontFamily: 'Cinzel, serif', margin: 0, marginBottom: 16 }}>
        {t('coinify.importTitle')}
      </h2>

      {/* File picker — styled drop zone */}
      <div className="coin-import-drop">
        <label className="rpg-button coin-import-drop__label">
          {t('coinify.importSelectFile')}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            className="coin-import-drop__input"
            onChange={handleFileChange}
          />
        </label>
        <span className="coin-import-drop__filename">
          {fileName || t('coinify.importNoFile')}
        </span>
        {parsing && (
          <span className="coin-import-drop__parsing">{t('coinify.importParsing')}</span>
        )}
      </div>

      {/* Parse error */}
      {parseError && (
        <p style={{ fontSize: '0.85rem', color: 'var(--rpg-hp-red)', marginBottom: 12 }}>{parseError}</p>
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
                    <td className="coin-import-row__amount">{formatAmount(row)}</td>
                    <td className="coin-import-row__currency">{formatCurrency(row)}</td>
                    <td>
                      <select
                        value={row.category}
                        onChange={(e) => setCategory(idx, e.target.value)}
                        className="rpg-select"
                        style={{ fontSize: '0.75rem' }}
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

          {/* Month selector + confirm */}
          <div className="coin-import-confirm-row">
            <div className="coin-import-confirm-row__month">
              <label className="coin-import-confirm-row__month-label">{t('coinify.importStatementMonth')}</label>
              <input
                type="month"
                value={statementMonth}
                onChange={(e) => setStatementMonth(e.target.value)}
                className="rpg-input"
                style={{ fontSize: '0.85rem' }}
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
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--rpg-gold)" strokeWidth="2" strokeLinecap="round">
                    <circle cx="12" cy="12" r="10" /><path d="M9 12l2 2 4-4" />
                  </svg>
                </span>
              )}
            </button>
          </div>

          {importError && (
            <p style={{ fontSize: '0.85rem', color: 'var(--rpg-hp-red)' }}>{importError}</p>
          )}
        </div>
      )}

      {/* Success message */}
      {successCount !== null && (
        <div className="rpg-card coin-import-success">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--rpg-xp-green)" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="10" /><path d="M9 12l2 2 4-4" />
          </svg>
          {t('coinify.importSuccess', { count: successCount })}
        </div>
      )}
    </div>
  );
}
