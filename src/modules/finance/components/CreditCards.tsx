import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { CreditCard, CreditCardStatement } from '../types';
import CreditCardManager from './shared/CreditCardManager';
import StatementDetail from './shared/StatementDetail';
import { MonthNavigator } from './shared/MonthNavigator';

function getStatementPeriodRange(month: string, closingDay: number): { from: string; to: string } {
  const [year, mon] = month.split('-').map(Number);
  // Period covers: previous month (closingDay+1) to current month (closingDay)
  const prevDate = new Date(year, mon - 2, closingDay + 1); // mon-2 because Date is 0-based and we want previous month
  const toDate = new Date(year, mon - 1, closingDay);

  const fmt = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  return { from: fmt(prevDate), to: fmt(toDate) };
}

export default function CreditCards() {
  const { t } = useTranslation();
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [statements, setStatements] = useState<CreditCardStatement[]>([]);
  const [showManager, setShowManager] = useState(false);
  const [selectedStatement, setSelectedStatement] = useState<CreditCardStatement | null>(null);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  const loadCards = useCallback(() => {
    window.api.financeGetCreditCards().then((data) => setCards(data as CreditCard[]));
  }, []);

  const loadStatements = useCallback(() => {
    window.api.financeGetCreditCardStatements({ periodMonth: month })
      .then((data) => setStatements(data as CreditCardStatement[]));
  }, [month]);

  useEffect(() => { loadCards(); }, [loadCards]);
  useEffect(() => { loadStatements(); }, [loadStatements]);

  // Reload data when account is switched
  useEffect(() => {
    const handler = () => { loadCards(); loadStatements(); };
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
  }, [loadCards, loadStatements]);

  const handleGenerate = async (cardId: string) => {
    await window.api.financeGenerateStatement(cardId, month);
    loadStatements();
    window.dispatchEvent(new Event('finance:dataChanged'));
  };

  const handlePaid = () => {
    setSelectedStatement(null);
    loadStatements();
    window.dispatchEvent(new Event('finance:dataChanged'));
  };

  return (
    <div className="coin-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 className="rpg-heading">{t('coinify.creditCards')}</h2>
        <button className="rpg-button" onClick={() => setShowManager(true)}>
          {t('coinify.manageCreditCards')}
        </button>
      </div>

      <MonthNavigator month={month} onChange={setMonth} />

      <div style={{ marginTop: 16 }}>
        <h3 className="rpg-heading" style={{ fontSize: '1rem' }}>{t('coinify.statements')}</h3>

        {cards.map((card) => {
          const stmt = statements.find((s) => s.creditCardId === card.id);

          return (
            <div key={card.id} className="rpg-card" style={{ marginBottom: 8, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <span style={{ fontWeight: 'bold' }}>{card.name}</span>
                  <span style={{ fontSize: '0.75rem', opacity: 0.7, marginLeft: 8 }}>
                    {t('coinify.closingDay')}: {card.closingDay}
                    {' · '}
                    {(() => {
                      const range = getStatementPeriodRange(month, card.closingDay);
                      return `${range.from} → ${range.to}`;
                    })()}
                  </span>
                </div>

                {stmt ? (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 'bold' }}>
                      ${stmt.calculatedAmount.toLocaleString('es-AR')}
                    </span>
                    <span style={{
                      fontSize: '0.75rem', padding: '2px 6px', borderRadius: 4,
                      background: stmt.status === 'paid' ? 'var(--rpg-success, #4a7)' : 'var(--rpg-warning, #c84)',
                      color: '#fff',
                    }}>
                      {stmt.status === 'paid' ? t('coinify.statementPaid') : t('coinify.statementPending')}
                    </span>
                    <button className="rpg-button" onClick={() => setSelectedStatement(stmt)}
                      style={{ padding: '3px 8px', fontSize: '0.8rem' }}>
                      {t('coinify.details')}
                    </button>
                  </div>
                ) : (
                  <button className="rpg-button" onClick={() => handleGenerate(card.id)}
                    style={{ fontSize: '0.8rem' }}>
                    {t('coinify.generateStatement')}
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {cards.length === 0 && (
          <p style={{ opacity: 0.6, fontStyle: 'italic' }}>{t('coinify.noStatements')}</p>
        )}
      </div>

      {showManager && (
        <CreditCardManager cards={cards} onClose={() => setShowManager(false)} onSaved={() => { loadCards(); loadStatements(); window.dispatchEvent(new Event('finance:dataChanged')); }} />
      )}

      {selectedStatement && (
        <StatementDetail statement={selectedStatement} onClose={() => setSelectedStatement(null)} onPaid={handlePaid} />
      )}
    </div>
  );
}
