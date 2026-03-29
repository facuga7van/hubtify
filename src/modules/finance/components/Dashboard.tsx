import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { MonthNavigator } from './shared/MonthNavigator';
import { DollarChip } from './shared/DollarChip';

interface CurrencyBalance {
  income: number;
  expenses: number;
  balance: number;
}

interface MonthlyBalance {
  ARS: CurrencyBalance;
  USD: CurrencyBalance;
}

interface CategoryBreakdown {
  category: string;
  ARS: number;
  USD: number;
}

interface ProjectionMonth {
  month: string;
  installments: number;
  recurring: number;
  total: number;
}

interface LoanSummary {
  lent: number;
  borrowed: number;
}

export default function Dashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [balance, setBalance] = useState<MonthlyBalance | null>(null);
  const [categories, setCategories] = useState<CategoryBreakdown[]>([]);
  const [projection, setProjection] = useState<ProjectionMonth[]>([]);
  const [loans, setLoans] = useState<LoanSummary>({ lent: 0, borrowed: 0 });

  useEffect(() => {
    window.api.financeGetMonthlyBalance(month).then(setBalance);
    window.api.financeGetCategoryBreakdown(month).then(setCategories);
  }, [month]);

  useEffect(() => {
    window.api.financeGetProjection(3).then(setProjection);
    window.api.financeGetActiveLoanSummary().then(setLoans);
  }, []);

  const COLORS = ['#C9A84C', '#A68A3E', '#5C3A1E', '#3B2314', '#6B3A2A', '#4A2D1A', '#E0C068', '#8B6F47', '#cd853f', '#bc8f8f'];

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <MonthNavigator month={month} onChange={setMonth} />
        <DollarChip />
      </div>

      {/* Balance Cards */}
      {balance && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: (balance.USD.income > 0 || balance.USD.expenses > 0) ? '1fr 1fr' : '1fr',
          gap: 12,
          marginBottom: 16,
        }}>
          <div className="rpg-card">
            <div className="rpg-card-title" style={{ marginBottom: 6 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--rpg-gold-dark)" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v12M8 10h8M8 14h8"/></svg>
              ARS
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                <span style={{ opacity: 0.6 }}>{t('coinify.income')}</span>
                <span style={{ fontFamily: 'Fira Code, monospace', color: 'var(--rpg-xp-green)' }}>+${balance.ARS.income.toLocaleString('es-AR')}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                <span style={{ opacity: 0.6 }}>{t('coinify.expense')}</span>
                <span style={{ fontFamily: 'Fira Code, monospace', color: 'var(--rpg-hp-red)' }}>-${balance.ARS.expenses.toLocaleString('es-AR')}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--rpg-parchment-dark)', paddingTop: 4, fontSize: '0.9rem' }}>
                <span style={{ fontWeight: 'bold' }}>{t('coinify.balance')}</span>
                <span style={{ fontFamily: 'Fira Code, monospace', fontWeight: 'bold', color: balance.ARS.balance >= 0 ? 'var(--rpg-xp-green)' : 'var(--rpg-hp-red)' }}>
                  ${balance.ARS.balance.toLocaleString('es-AR')}
                </span>
              </div>
            </div>
          </div>

          {(balance.USD.income > 0 || balance.USD.expenses > 0) && (
            <div className="rpg-card">
              <div className="rpg-card-title" style={{ marginBottom: 6 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--rpg-gold-dark)" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v12M9 9h6M9 15h6"/></svg>
                USD
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                  <span style={{ opacity: 0.6 }}>{t('coinify.income')}</span>
                  <span style={{ fontFamily: 'Fira Code, monospace', color: 'var(--rpg-xp-green)' }}>+${balance.USD.income.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                  <span style={{ opacity: 0.6 }}>{t('coinify.expense')}</span>
                  <span style={{ fontFamily: 'Fira Code, monospace', color: 'var(--rpg-hp-red)' }}>-${balance.USD.expenses.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--rpg-parchment-dark)', paddingTop: 4, fontSize: '0.9rem' }}>
                  <span style={{ fontWeight: 'bold' }}>{t('coinify.balance')}</span>
                  <span style={{ fontFamily: 'Fira Code, monospace', fontWeight: 'bold', color: balance.USD.balance >= 0 ? 'var(--rpg-xp-green)' : 'var(--rpg-hp-red)' }}>
                    ${balance.USD.balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Category Breakdown */}
      {categories.length > 0 && (
        <div className="rpg-card" style={{ marginBottom: 16 }}>
          <div className="rpg-card-title" style={{ marginBottom: 6 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--rpg-gold-dark)" strokeWidth="1.5" strokeLinecap="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
            {t('coinify.byCategory')}
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={categories} layout="vertical">
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="category" width={100} tick={{ fill: 'var(--rpg-ink-light)', fontSize: 12 }} />
              <Tooltip contentStyle={{ background: 'var(--rpg-parchment-light)', border: '1px solid var(--rpg-gold-dark)', borderRadius: 'var(--rpg-radius)' }} />
              <Bar dataKey="ARS" fill="var(--rpg-gold)" radius={[0, 4, 4, 0]}>
                {categories.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Projection + Loans */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div className="rpg-card">
          <div className="rpg-card-title" style={{ marginBottom: 6 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--rpg-gold-dark)" strokeWidth="1.5" strokeLinecap="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            {t('coinify.projection')}
          </div>
          {projection.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {projection.map((p) => (
                <div key={p.month} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                  <span style={{ opacity: 0.6 }}>
                    {new Date(p.month + '-01').toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}
                  </span>
                  <span style={{ fontFamily: 'Fira Code, monospace' }}>${p.total.toLocaleString('es-AR')}</span>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ opacity: 0.5, fontStyle: 'italic' }}>{t('coinify.noData')}</p>
          )}
        </div>

        <div className="rpg-card" style={{ cursor: 'pointer' }} onClick={() => navigate('/finance/loans')}>
          <div className="rpg-card-title" style={{ marginBottom: 6 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--rpg-gold-dark)" strokeWidth="1.5" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            {t('coinify.loans')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ opacity: 0.6 }}>{t('coinify.owed')}</span>
              <span style={{ fontFamily: 'Fira Code, monospace', color: 'var(--rpg-xp-green)' }}>${loans.lent.toLocaleString('es-AR')}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ opacity: 0.6 }}>{t('coinify.owing')}</span>
              <span style={{ fontFamily: 'Fira Code, monospace', color: 'var(--rpg-hp-red)' }}>${loans.borrowed.toLocaleString('es-AR')}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="rpg-button" style={{ flex: 1 }} onClick={() => navigate('/finance/transactions?type=expense')}>
          + {t('coinify.expense')}
        </button>
        <button className="rpg-button" style={{ flex: 1 }} onClick={() => navigate('/finance/transactions?type=income')}>
          + {t('coinify.income')}
        </button>
      </div>
    </div>
  );
}
