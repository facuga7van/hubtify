import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { CreditCard, CreditCardStatement } from '../types';
import CreditCardManager from './shared/CreditCardManager';
import StatementDetail from './shared/StatementDetail';
import { MonthNavigator } from './shared/MonthNavigator';
import { Section, Rune } from '../../../shared/components/codex/CodexPrimitives';
import { Coin } from '../../../shared/components/icons';
import HelpBubble from '../../../shared/components/HelpBubble';
import { formatCurrency } from '../utils/format';

function getStatementPeriodRange(month: string, closingDay: number): { from: string; to: string } {
  const [year, mon] = month.split('-').map(Number);
  const daysInPrev = new Date(year, mon - 1, 0).getDate();
  const daysInCurr = new Date(year, mon, 0).getDate();
  const clampedPrev = Math.min(closingDay + 1, daysInPrev);
  const clampedCurr = Math.min(closingDay, daysInCurr);
  const prevDate = new Date(year, mon - 2, clampedPrev);
  const toDate = new Date(year, mon - 1, clampedCurr);

  const fmt = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  return { from: fmt(prevDate), to: fmt(toDate) };
}

export default function CreditCards() {
  const { t } = useTranslation();
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [statements, setStatements] = useState<CreditCardStatement[]>([]);
  const [showManager, setShowManager] = useState(false);
  const [selectedStatement, setSelectedStatement] = useState<CreditCardStatement | null>(null);
  // «Todavía no cargaste ninguna tarjeta» se pintaba desde el primer frame, y
  // si la lectura fallaba (promesa sin `catch`) se quedaba diciendo eso.
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  const loadCards = useCallback(() => {
    setLoadError(false);
    window.api.financeGetCreditCards()
      .then((data) => setCards(data as CreditCard[]))
      .catch((err) => {
        console.error('[CreditCards] financeGetCreditCards failed:', err);
        setLoadError(true);
      })
      .finally(() => setLoading(false));
  }, []);

  const loadStatements = useCallback(() => {
    window.api.financeGetCreditCardStatements({ periodMonth: month })
      .then((data) => setStatements(data as CreditCardStatement[]))
      .catch((err) => console.error('[CreditCards] financeGetCreditCardStatements failed:', err));
  }, [month]);

  useEffect(() => { loadCards(); }, [loadCards]);
  useEffect(() => { loadStatements(); }, [loadStatements]);

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
    <div className="coin-page-column">
      <div className="coin-dashboard__header" style={{ marginBottom: 16 }}>
        <button className="rpg-button" onClick={() => setShowManager(true)}>
          {t('coinify.manageCreditCards')}
        </button>
      </div>

      <MonthNavigator month={month} onChange={setMonth} />

      <div style={{ marginTop: 16 }}>
        <Section title={t('coinify.statements').toUpperCase()} rightSlot={<HelpBubble variant="inline" text={t('coinify.statementsHelp', 'Resumen por tarjeta: período de facturación, gastos del ciclo actual y estado de cierre.')} />}>
          {loading && <div className="coin-skeleton coin-skeleton--card" />}

          {!loading && loadError && (
            <div className="coin-load-error">
              <p className="coin-load-error__text">{t('coinify.cardsLoadError', 'No se pudieron cargar las tarjetas')}</p>
              <button className="rpg-button" onClick={() => { setLoading(true); loadCards(); loadStatements(); }}>
                {t('common.tryAgain', 'Intentar de nuevo')}
              </button>
            </div>
          )}

          {!loading && !loadError && cards.map((card) => {
            const stmt = statements.find((s) => s.creditCardId === card.id);
            const range = getStatementPeriodRange(month, card.closingDay);

            return (
              <div key={card.id} className="coin-cc-card">
                <div className="coin-cc-card__header">
                  <div>
                    <span className="qb-hand" style={{ fontWeight: 'bold' }}>{card.name}</span>
                    <span className="qb-small-caps coin-cc-card__period">
                      {t('coinify.closingDay')}: {card.closingDay}
                      {' \u00B7 '}
                      {`${range.from} \u2192 ${range.to}`}
                    </span>
                  </div>

                  {stmt ? (
                    <div className="coin-cc-card__stmt">
                      <span className="qb-numeral" style={{ fontWeight: 'bold', fontSize: 'var(--fs-sub)' }}>
                        {formatCurrency(stmt.calculatedAmount, { currency: 'ARS' })}
                      </span>
                      {(stmt.calculatedAmountUsd ?? 0) > 0 && (
                        <span className="qb-numeral" style={{ fontSize: 'var(--fs-label)', color: 'var(--ink-soft)' }}>
                          {formatCurrency(stmt.calculatedAmountUsd ?? 0, { currency: 'USD' })}
                        </span>
                      )}
                      <Rune tone={stmt.status === 'paid' ? 'sage' : 'rubric'}>
                        {stmt.status === 'paid' ? t('coinify.statementPaid') : t('coinify.statementPending')}
                      </Rune>
                      <button className="rpg-button" onClick={() => setSelectedStatement(stmt)}
                        style={{ padding: '3px 8px', fontSize: 'var(--fs-label)' }}>
                        {t('coinify.details')}
                      </button>
                    </div>
                  ) : (
                    <button className="rpg-button" onClick={() => handleGenerate(card.id)}
                      style={{ fontSize: 'var(--fs-label)' }}>
                      {t('coinify.generateStatement')}
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {/* The condition is "no cards", so say that: the old copy claimed
              there were no statements for the period, sending new users off to
              hunt through months for something that could not exist yet. */}
          {!loading && !loadError && cards.length === 0 && (
            <div className="coin-empty-codex">
              <Coin width={28} height={28} aria-hidden="true" />
              <p className="coin-empty-codex__title">{t('coinify.noCardsYet', 'Todavía no cargaste ninguna tarjeta')}</p>
              <p className="coin-empty-codex__desc">
                {t('coinify.noCardsYetHint', 'Agregá una tarjeta para ver sus resúmenes mes a mes')}
              </p>
              <button className="rpg-button" onClick={() => setShowManager(true)}>
                + {t('coinify.newCard', 'Nueva tarjeta')}
              </button>
            </div>
          )}

          {!loading && !loadError && cards.length > 0 && statements.length === 0 && (
            <p className="coin-empty-codex__desc" style={{ textAlign: 'center', padding: 12 }}>
              {t('coinify.noStatements')}
            </p>
          )}
        </Section>
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
