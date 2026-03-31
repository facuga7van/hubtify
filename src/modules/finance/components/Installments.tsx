import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import PageHeader from '../../../shared/components/PageHeader';
import { MonthNavigator } from './shared/MonthNavigator';
import { AnimatedNumber } from './shared/AnimatedNumber';
import { CoinStatCard } from './shared/CoinStatCard';

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
  const raw = row as InstallmentRow & { installmentNumber?: number };
  const current = raw.installmentNumber ?? 1;
  return { current, total: row.installments };
}

// Chain icon SVG
const ChainIcon = ({ broken }: { broken: boolean }) => (
  <svg
    width="16" height="16" viewBox="0 0 24 24" fill="none"
    stroke={broken ? 'var(--rpg-xp-green)' : 'var(--rpg-gold-dark)'}
    strokeWidth="1.5" strokeLinecap="round"
    className={broken ? 'coin-installment__chain-icon' : ''}
  >
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

export default function Installments() {
  const { t } = useTranslation();
  const currentMonth = todayMonth();
  const [month, setMonth] = useState(currentMonth);
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
      // non-critical
    }
  }, []);

  useEffect(() => { loadRows(month); }, [month, loadRows]);
  useEffect(() => { loadProjection(); }, [loadProjection]);

  const ownRows = rows.filter((r) => !r.forThirdParty);
  const thirdPartyRows = rows.filter((r) => !!r.forThirdParty);
  const totalOwn = ownRows.reduce((acc, r) => acc + r.amount, 0);
  const totalThirdParty = thirdPartyRows.reduce((acc, r) => acc + r.amount, 0);
  const net = totalOwn + totalThirdParty;

  const projectionLabel = (m: string) => {
    const [y, mo] = m.split('-').map(Number);
    return new Date(y, mo - 1).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
  };

  // RPG gold color for chart bars
  const GOLD = 'var(--rpg-gold)';
  const GOLD_HIGHLIGHT = 'var(--rpg-gold-light)';

  return (
    <div>
      <PageHeader title={t('coinify.installments')} subtitle={t('coinify.installmentsSubtitle', 'Cuotas del mes')} />

      <div style={{ marginBottom: 16 }}>
        <MonthNavigator month={month} onChange={setMonth} />
      </div>

      {error && (
        <div className="rpg-card" style={{ marginBottom: 16, textAlign: 'center' }}>
          <p style={{ color: 'var(--rpg-hp-red)', marginBottom: 8 }}>{t('common.somethingWentWrong')}</p>
          <button className="rpg-button" onClick={() => loadRows(month)}>{t('common.tryAgain')}</button>
        </div>
      )}

      {/* Installment list */}
      <div className="rpg-card" style={{ marginBottom: 16 }}>
        <div className="rpg-card-title">
          <ChainIcon broken={false} />
          {t('coinify.installments', 'Cuotas')} ({rows.length})
        </div>

        {loading ? (
          <div className="coin-skeleton coin-skeleton--card" />
        ) : rows.length === 0 ? (
          <p className="coin-empty">{t('coinify.noInstallments', 'No hay cuotas este mes')}</p>
        ) : (
          <div className="coin-installment-list">
            {rows.map((row) => {
              const { current, total } = parseInstallmentNumber(row);
              const isComplete = current === total;
              const progressPct = (current / total) * 100;

              return (
                <div
                  key={row.id}
                  className={`coin-installment ${isComplete ? 'coin-installment--complete' : ''}`}
                >
                  <div className="coin-installment__desc">
                    <ChainIcon broken={isComplete} />
                    {' '}{row.description}
                    <span className="coin-installment__counter">
                      {t('coinify.installmentCounter', `Cuota ${current}/${total}`, { current, total })}
                    </span>
                  </div>
                  <div className="coin-installment__right">
                    {row.forThirdParty && (
                      <span className="coin-tx__badge coin-tx__badge--third-party">
                        {'\u2192'} {row.forThirdParty}
                      </span>
                    )}
                    <div className="coin-installment__progress">
                      <div
                        className="coin-installment__progress-fill"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                    <span className="coin-installment__amount">
                      ${row.amount.toLocaleString('es-AR')}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Month summary stat cards */}
      {rows.length > 0 && (
        <div className="coin-installment-summary">
          <CoinStatCard
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="m11 19-6-6" /><path d="m5 21-2-2" /><path d="m8 16-4 4" /><path d="M9.5 17.5 21 6V3h-3L6.5 14.5" />
              </svg>
            }
            label={t('coinify.ownInstallments', 'Cuotas propias')}
            value={totalOwn}
            color="red"
          />
          <CoinStatCard
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
              </svg>
            }
            label={t('coinify.thirdPartyInstallments', 'Cuotas de terceros')}
            value={totalThirdParty}
            color="gold"
          />
          <CoinStatCard
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <circle cx="12" cy="12" r="10" /><path d="M12 6v12M8 10h8" />
              </svg>
            }
            label={t('coinify.netInstallments', 'Total neto')}
            value={net}
            color={net > 0 ? 'red' : 'gold'}
          />
        </div>
      )}

      {/* 12-month projection chart */}
      {projection.length > 0 && (
        <div className="rpg-card coin-installment__chart">
          <div className="rpg-card-title">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--rpg-gold-dark)" strokeWidth="1.3" strokeLinecap="round">
              <path d="M2 13L5 9l3 2 3-5 3 3" />
            </svg>
            {t('coinify.installmentProjection', 'Proyeccion 12 meses')}
          </div>
          <div style={{ marginTop: 12 }}>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={projection.map((p) => ({
                  name: projectionLabel(p.month),
                  total: p.total,
                  month: p.month,
                }))}
                margin={{ top: 4, right: 8, left: 0, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--rpg-parchment-dark)" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--rpg-ink-light)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--rpg-ink-light)' }} axisLine={false} tickLine={false}
                  width={60} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  contentStyle={{
                    background: 'var(--rpg-parchment)',
                    border: '1px solid var(--rpg-gold-dark)',
                    borderRadius: 6,
                    fontSize: '0.85rem',
                  }}
                  formatter={(value) => [`$${(value as number).toLocaleString('es-AR')}`, t('coinify.netInstallments', 'Total')]}
                  labelStyle={{ color: 'var(--rpg-gold)', marginBottom: 2 }}
                />
                <Bar dataKey="total" radius={[3, 3, 0, 0]}>
                  {projection.map((p, i) => (
                    <Cell
                      key={i}
                      fill={p.month === currentMonth ? GOLD_HIGHLIGHT : GOLD}
                      stroke={p.month === currentMonth ? 'var(--rpg-gold)' : 'none'}
                      strokeWidth={p.month === currentMonth ? 2 : 0}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
