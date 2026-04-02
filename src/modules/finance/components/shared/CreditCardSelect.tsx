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
      if (typed.length > 0 && !value) {
        onChange(typed[0].id);
      }
    });
  }, []);

  useEffect(() => {
    loadCards();
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
        >
          <option value="">{t('coinify.selectCard')}</option>
          {cards.map((card) => (
            <option key={card.id} value={card.id}>
              {card.name} ({t('coinify.closingDay')}: {card.closingDay})
            </option>
          ))}
          <option disabled>───────────</option>
          <option value="__manage__">{t('coinify.manageCreditCards')}</option>
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
