import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import PageHeader from '../../../shared/components/PageHeader';
import { MonthNavigator } from './shared/MonthNavigator';

interface InstallmentRow {
  id: string;
  description: string;
  amount: number;
  currency: string;
  category: string;
  installments: number;
  installmentGroupId: string;
  forThirdParty?: string;
  date: string;
}

interface ProjectionMonth {
  month: string;
  total: number;
}

function todayMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function parseInstallmentNumber(row: InstallmentRow): { current: number; total: number } {
  // date is 'YYYY-MM-DD', startDate is in installment group — derive current number from month diff
  // The API returns the cuota number embedded in the description or we infer from date vs group start.
  // Since the shape only gives us `date` (the cuota's payment date) and `installments` (total count),
  // we fall back to showing just the total count unless a cuotaNumber field is present.
  const raw = row as InstallmentRow & { installmentNumber?: number };
  const current = raw.installmentNumber ?? 1;
  return { current, total: row.installments };
}

export default function Installments() {
  const { t } = useTranslation();
  const [month, setMonth] = useState(todayMonth);
  const [rows, setRows] = useState<InstallmentRow[]>([]);
  const [projection, setProjection] = useState<ProjectionMonth[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const loadRows = useCallback(async (m: string) => {
    setLoading(true);
    setError(false);
    try {
      const data = await window.api.financeGetInstallmentsForMonth(m);
      setRows(data as InstallmentRow[]);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadProjection = useCallback(async () => {
    try {
      const data = await window.api.financeGetInstallmentProjection(12);
      setProjection(data as ProjectionMonth[]);
    } catch {
      // projection is non-critical, silently ignore
    }
  }, []);

  useEffect(() => {
    loadRows(month);
  }, [month, loadRows]);

  useEffect(() => {
    loadProjection();
  }, [loadProjection]);

  const ownRows = rows.filter((r) => !r.forThirdParty);
  const thirdPartyRows = rows.filter((r) => !!r.forThirdParty);
  const totalOwn = ownRows.reduce((acc, r) => acc + r.amount, 0);
  const totalThirdParty = thirdPartyRows.reduce((acc, r) => acc + r.amount, 0);
  const net = totalOwn + totalThirdParty;

  const fmt = (n: number) => `$${n.toLocaleString('es-AR')}`;

  const projectionLabel = (m: string) => {
    const [y, mo] = m.split('-').map(Number);
    return new Date(y, mo - 1).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
  };

  return (
    <div>
      <PageHeader title={t('coinify.installments')} subtitle={t('coinify.installmentsSubtitle', 'Cuotas del mes')} />

      {/* Month navigator */}
      <div style={{ marginBottom: 16 }}>
        <MonthNavigator month={month} onChange={setMonth} />
      </div>

      {/* Error state */}
      {error && (
        <div className="rpg-card" style={{ marginBottom: 16, textAlign: 'center' }}>
          <p style={{ color: 'var(--rpg-hp-red)', marginBottom: 8 }}>{t('common.somethingWentWrong')}</p>
          <button className="rpg-button" onClick={() => loadRows(month)}>{t('common.tryAgain')}</button>
        </div>
      )}

      {/* Installment list */}
      <div className="rpg-card" style={{ marginBottom: 16 }}>
        <div className="rpg-card-title">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--rpg-gold-dark)" strokeWidth="1.3" strokeLinecap="round">
            <rect x="2" y="3" width="12" height="10" rx="1" />
            <path d="M5 7h6M5 10h4" />
          </svg>
          {t('coinify.installments', 'Cuotas')} ({rows.length})
        </div>

        {loading ? (
          <p style={{ opacity: 0.5, fontStyle: 'italic' }}>{t('common.loading')}</p>
        ) : rows.length === 0 ? (
          <p style={{ opacity: 0.5, fontStyle: 'italic' }}>
            {t('coinify.noInstallments', 'No hay cuotas este mes')}
          </p>
        ) : (
          <div>
            {rows.map((row) => {
              const { current, total } = parseInstallmentNumber(row);
              return (
                <div
                  key={row.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 0',
                    borderBottom: '1px solid rgba(255,255,255,0.05)',
                    gap: 8,
                  }}
                >
                  {/* Left: description + cuota label */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                      {row.description}
                    </span>
                    <span
                      style={{
                        marginLeft: 8,
                        fontSize: '0.78rem',
                        opacity: 0.6,
                        fontFamily: 'Fira Code, monospace',
                      }}
                    >
                      Cuota {current}/{total}
                    </span>
                  </div>

                  {/* Right: third-party badge + amount */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    {row.forThirdParty && (
                      <span
                        style={{
                          fontSize: '0.72rem',
                          padding: '2px 7px',
                          borderRadius: 999,
                          background: 'rgba(var(--rpg-gold-rgb, 184,144,64), 0.15)',
                          border: '1px solid var(--rpg-gold-dark)',
                          color: 'var(--rpg-gold)',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        → {row.forThirdParty}
                      </span>
                    )}
                    <span
                      style={{
                        fontFamily: 'Fira Code, monospace',
                        fontSize: '0.9rem',
                        color: 'var(--rpg-hp-red-light)',
                        minWidth: 70,
                        textAlign: 'right',
                      }}
                    >
                      {fmt(row.amount)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Month summary */}
      {rows.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 12,
            marginBottom: 16,
          }}
        >
          <div className="rpg-card rpg-stat-card">
            <div className="rpg-stat-number" style={{ color: 'var(--rpg-hp-red-light)', fontSize: '1.1rem' }}>
              {fmt(totalOwn)}
            </div>
            <div className="rpg-stat-label">
              {t('coinify.ownInstallments', 'Cuotas propias')}
            </div>
          </div>
          <div className="rpg-card rpg-stat-card">
            <div className="rpg-stat-number" style={{ color: 'var(--rpg-gold)', fontSize: '1.1rem' }}>
              {fmt(totalThirdParty)}
            </div>
            <div className="rpg-stat-label">
              {t('coinify.thirdPartyInstallments', 'Cuotas de terceros')}
            </div>
          </div>
          <div className="rpg-card rpg-stat-card">
            <div className="rpg-stat-number" style={{ fontSize: '1.1rem' }}>
              {fmt(net)}
            </div>
            <div className="rpg-stat-label">
              {t('coinify.netInstallments', 'Total neto')}
            </div>
          </div>
        </div>
      )}

      {/* 12-month projection */}
      {projection.length > 0 && (
        <div className="rpg-card">
          <div className="rpg-card-title">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--rpg-gold-dark)" strokeWidth="1.3" strokeLinecap="round">
              <path d="M2 13L5 9l3 2 3-5 3 3" />
            </svg>
            {t('coinify.installmentProjection', 'Proyección 12 meses')}
          </div>
          <div style={{ marginTop: 12 }}>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={projection.map((p) => ({
                  name: projectionLabel(p.month),
                  total: p.total,
                }))}
                margin={{ top: 4, right: 8, left: 0, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fill: 'rgba(255,255,255,0.5)' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: 'rgba(255,255,255,0.5)' }}
                  axisLine={false}
                  tickLine={false}
                  width={60}
                  tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--rpg-parchment-dark, #1a1a2e)',
                    border: '1px solid var(--rpg-gold-dark)',
                    borderRadius: 6,
                    fontSize: '0.85rem',
                  }}
                  formatter={(value: number) => [fmt(value), t('coinify.netInstallments', 'Total')]}
                  labelStyle={{ color: 'var(--rpg-gold)', marginBottom: 2 }}
                />
                <Bar
                  dataKey="total"
                  fill="var(--rpg-gold-dark, #b89040)"
                  radius={[3, 3, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
