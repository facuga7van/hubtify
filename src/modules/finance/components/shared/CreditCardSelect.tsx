import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { CreditCard } from '../../types';
import CreditCardManager from './CreditCardManager';

interface CreditCardSelectProps {
  value: string;
  onChange: (cardId: string) => void;
  className?: string;
}

export function CreditCardSelect({ value, onChange, className }: CreditCardSelectProps) {
  const { t } = useTranslation();
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [showManager, setShowManager] = useState(false);

  const loadCards = useCallback(() => {
    window.api.financeGetCreditCards().then((data) => {
      const typed = data as CreditCard[];
      setCards(typed);
    });
  }, []);

  useEffect(() => {
    loadCards();
  }, [loadCards]);

  // Auto-select first card when cards load and no value selected
  useEffect(() => {
    if (cards.length > 0 && !value) {
      onChange(cards[0].id);
    }
  }, [cards, value, onChange]);

  useEffect(() => {
    const handler = () => loadCards();
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
  }, [loadCards]);

  const handleChange = (val: string) => {
    if (val === '__manage__') {
      setShowManager(true);
      return;
    }
    onChange(val);
  };

  return (
    <>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flex: 1, minWidth: 0 }}>
        <select
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          className={`rpg-select ${className ?? ''}`}
          aria-label={t('coinify.selectCard', 'Seleccionar tarjeta')}
        >
          <option value="">{t('coinify.selectCard')}</option>
          <optgroup label={t('coinify.creditCards', 'Tarjetas')}>
            {cards.map((card) => (
              <option key={card.id} value={card.id}>
                {card.name} ({t('coinify.closingDay')}: {card.closingDay})
              </option>
            ))}
          </optgroup>
          <optgroup label="">
            <option value="__manage__">{t('coinify.manageCreditCards')}</option>
          </optgroup>
        </select>
      </div>

      {showManager && (
        <CreditCardManager
          cards={cards}
          onClose={() => setShowManager(false)}
          onSaved={loadCards}
        />
      )}
    </>
  );
}
