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

  const COLORS = ['#d4a373', '#e6b422', '#c2956e', '#a67b5b', '#8b6f47', '#6d5c3f', '#b8860b', '#cd853f', '#daa520', '#bc8f8f', '#f4a460'];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <MonthNavigator month={month} onChange={setMonth} />
        <DollarChip />
      </div>

      {/* Balance Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {balance && (
          <>
            <div className="rpg-card p-4">
              <h3 className="text-sm text-white/50 mb-2">ARS</h3>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-white/60">{t('coinify.income')}</span>
                  <span className="text-green-400 font-mono">+${balance.ARS.income.toLocaleString('es-AR')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/60">{t('coinify.expense')}</span>
                  <span className="text-red-400 font-mono">-${balance.ARS.expenses.toLocaleString('es-AR')}</span>
                </div>
                <div className="flex justify-between border-t border-white/10 pt-1">
                  <span className="font-semibold">{t('coinify.balance')}</span>
                  <span className={`font-mono font-bold ${balance.ARS.balance >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    ${balance.ARS.balance.toLocaleString('es-AR')}
                  </span>
                </div>
              </div>
            </div>

            {(balance.USD.income > 0 || balance.USD.expenses > 0) && (
              <div className="rpg-card p-4">
                <h3 className="text-sm text-white/50 mb-2">USD</h3>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-white/60">{t('coinify.income')}</span>
                    <span className="text-green-400 font-mono">+${balance.USD.income.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/60">{t('coinify.expense')}</span>
                    <span className="text-red-400 font-mono">-${balance.USD.expenses.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between border-t border-white/10 pt-1">
                    <span className="font-semibold">{t('coinify.balance')}</span>
                    <span className={`font-mono font-bold ${balance.USD.balance >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      ${balance.USD.balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Category Breakdown */}
      {categories.length > 0 && (
        <div className="rpg-card p-4">
          <h3 className="text-sm text-white/50 mb-3">{t('coinify.byCategory')}</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={categories} layout="vertical">
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="category" width={100} tick={{ fill: '#999', fontSize: 12 }} />
              <Tooltip
                contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}
                labelStyle={{ color: '#fff' }}
              />
              <Bar dataKey="ARS" fill="var(--rpg-gold, #d4a373)" radius={[0, 4, 4, 0]}>
                {categories.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Projection + Loans */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Projection */}
        <div className="rpg-card p-4">
          <h3 className="text-sm text-white/50 mb-3">{t('coinify.projection')}</h3>
          {projection.length > 0 ? (
            <div className="space-y-2">
              {projection.map((p) => (
                <div key={p.month} className="flex justify-between text-sm">
                  <span className="text-white/60 capitalize">
                    {new Date(p.month + '-01').toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}
                  </span>
                  <span className="font-mono">${p.total.toLocaleString('es-AR')}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-white/40">{t('coinify.noData')}</p>
          )}
        </div>

        {/* Loans Summary */}
        <div className="rpg-card p-4 cursor-pointer hover:border-[var(--rpg-gold)]/30 transition-colors"
          onClick={() => navigate('/finance/loans')}>
          <h3 className="text-sm text-white/50 mb-3">{t('coinify.loans')}</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-white/60">{t('coinify.owed')}</span>
              <span className="text-green-400 font-mono">${loans.lent.toLocaleString('es-AR')}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/60">{t('coinify.owing')}</span>
              <span className="text-red-400 font-mono">${loans.borrowed.toLocaleString('es-AR')}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="flex gap-3">
        <button className="rpg-btn flex-1" onClick={() => navigate('/finance/transactions?type=expense')}>
          + {t('coinify.expense')}
        </button>
        <button className="rpg-btn flex-1" onClick={() => navigate('/finance/transactions?type=income')}>
          + {t('coinify.income')}
        </button>
      </div>
    </div>
  );
}
