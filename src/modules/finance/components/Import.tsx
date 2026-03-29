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

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-[var(--rpg-gold)]">{t('coinify.importTitle')}</h2>

      {/* File picker */}
      <div className="rpg-card p-4 flex items-center gap-4">
        <label className="rpg-button cursor-pointer">
          {t('coinify.importSelectFile')}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={handleFileChange}
          />
        </label>
        <span className="text-sm text-white/60 truncate">
          {fileName || t('coinify.importNoFile')}
        </span>
        {parsing && (
          <span className="text-sm text-yellow-400 animate-pulse">{t('coinify.importParsing')}</span>
        )}
      </div>

      {/* Parse error */}
      {parseError && (
        <p className="text-sm text-red-400">{parseError}</p>
      )}

      {/* Preview table */}
      {rows.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-white/60">
            {t('coinify.importPreview')} — {includedCount} / {rows.length}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-white/40 text-left border-b border-white/10">
                  <th className="pb-2 pr-3">{t('coinify.importColInclude')}</th>
                  <th className="pb-2 pr-3">{t('coinify.importColDate')}</th>
                  <th className="pb-2 pr-3">{t('coinify.importColMerchant')}</th>
                  <th className="pb-2 pr-3">{t('coinify.importColInstallment')}</th>
                  <th className="pb-2 pr-3">{t('coinify.importColAmount')}</th>
                  <th className="pb-2 pr-3">{t('coinify.importColCurrency')}</th>
                  <th className="pb-2">{t('coinify.importColCategory')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => (
                  <tr
                    key={idx}
                    className={`border-b border-white/5 ${!row.included ? 'opacity-40' : ''}`}
                  >
                    <td className="py-1.5 pr-3">
                      <input
                        type="checkbox"
                        checked={row.included}
                        onChange={() => toggleRow(idx)}
                        className="cursor-pointer"
                      />
                    </td>
                    <td className="py-1.5 pr-3 whitespace-nowrap text-white/70">{row.date}</td>
                    <td className="py-1.5 pr-3 max-w-[180px] truncate" title={row.merchant}>
                      {row.merchant}
                    </td>
                    <td className="py-1.5 pr-3 text-white/50">{formatInstallment(row)}</td>
                    <td className="py-1.5 pr-3 font-mono">{formatAmount(row)}</td>
                    <td className="py-1.5 pr-3 text-white/50">{formatCurrency(row)}</td>
                    <td className="py-1.5">
                      <select
                        value={row.category}
                        onChange={(e) => setCategory(idx, e.target.value)}
                        className="rpg-select text-xs"
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
          <div className="flex items-end gap-4 flex-wrap">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-white/50">{t('coinify.importStatementMonth')}</label>
              <input
                type="month"
                value={statementMonth}
                onChange={(e) => setStatementMonth(e.target.value)}
                className="rpg-input text-sm"
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
            <p className="text-sm text-red-400">{importError}</p>
          )}
        </div>
      )}

      {/* Success message */}
      {successCount !== null && (
        <div className="rpg-card p-4">
          <p className="text-green-400 text-sm">
            {t('coinify.importSuccess', { count: successCount })}
          </p>
        </div>
      )}
    </div>
  );
}
