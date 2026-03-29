import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { ParsedRow } from '../../../../shared/types';
import { CATEGORIES } from '../types';

interface RowState extends ParsedRow {
  included: boolean;
  category: string;
}

export default function Import() {
  const { t } = useTranslation();
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

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const path = (file as File & { path: string }).path;
    setFileName(file.name);
    setFilePath(path);
    setRows([]);
    setParseError('');
    setSuccessCount(null);

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

  const thStyle: React.CSSProperties = {
    textAlign: 'left' as const,
    padding: '6px 8px',
    borderBottom: '2px solid var(--rpg-gold-dark)',
    fontFamily: 'Cinzel, serif',
    fontSize: '0.8rem',
  };

  const tdStyle: React.CSSProperties = {
    padding: '6px 8px',
    borderBottom: '1px solid var(--rpg-parchment-dark)',
  };

  return (
    <div>
      <h2 style={{ color: 'var(--rpg-gold)', fontSize: '1.1rem', fontFamily: 'Cinzel, serif', margin: 0, marginBottom: 16 }}>
        {t('coinify.importTitle')}
      </h2>

      {/* File picker */}
      <div className="rpg-card" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
        <label className="rpg-button" style={{ position: 'relative', overflow: 'hidden' }}>
          {t('coinify.importSelectFile')}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0 }}
            onChange={handleFileChange}
          />
        </label>
        <span style={{ fontSize: '0.85rem', opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {fileName || t('coinify.importNoFile')}
        </span>
        {parsing && (
          <span style={{ fontSize: '0.85rem', color: 'var(--rpg-gold)' }}>{t('coinify.importParsing')}</span>
        )}
      </div>

      {/* Parse error */}
      {parseError && (
        <p style={{ fontSize: '0.85rem', color: 'var(--rpg-hp-red)', marginBottom: 12 }}>{parseError}</p>
      )}

      {/* Preview table */}
      {rows.length > 0 && (
        <div>
          <p style={{ fontSize: '0.85rem', opacity: 0.6, marginBottom: 12 }}>
            {t('coinify.importPreview')} -- {includedCount} / {rows.length}
          </p>

          <div className="rpg-card" style={{ padding: 12, marginBottom: 16, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr>
                  <th style={thStyle}>{t('coinify.importColInclude')}</th>
                  <th style={thStyle}>{t('coinify.importColDate')}</th>
                  <th style={thStyle}>{t('coinify.importColMerchant')}</th>
                  <th style={thStyle}>{t('coinify.importColInstallment')}</th>
                  <th style={thStyle}>{t('coinify.importColAmount')}</th>
                  <th style={thStyle}>{t('coinify.importColCurrency')}</th>
                  <th style={thStyle}>{t('coinify.importColCategory')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => (
                  <tr key={idx} style={!row.included ? { opacity: 0.4 } : undefined}>
                    <td style={tdStyle}>
                      <input
                        type="checkbox"
                        checked={row.included}
                        onChange={() => toggleRow(idx)}
                      />
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap', opacity: 0.7 }}>{row.date}</td>
                    <td style={{ ...tdStyle, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.merchant}>
                      {row.merchant}
                    </td>
                    <td style={{ ...tdStyle, opacity: 0.5 }}>{formatInstallment(row)}</td>
                    <td style={{ ...tdStyle, fontFamily: 'Fira Code, monospace' }}>{formatAmount(row)}</td>
                    <td style={{ ...tdStyle, opacity: 0.5 }}>{formatCurrency(row)}</td>
                    <td style={tdStyle}>
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
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: '0.75rem', opacity: 0.5 }}>{t('coinify.importStatementMonth')}</label>
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
            </button>
          </div>

          {importError && (
            <p style={{ fontSize: '0.85rem', color: 'var(--rpg-hp-red)' }}>{importError}</p>
          )}
        </div>
      )}

      {/* Success message */}
      {successCount !== null && (
        <div className="rpg-card" style={{ padding: 16 }}>
          <p style={{ color: 'var(--rpg-xp-green)', fontSize: '0.85rem', margin: 0 }}>
            {t('coinify.importSuccess', { count: successCount })}
          </p>
        </div>
      )}
    </div>
  );
}
