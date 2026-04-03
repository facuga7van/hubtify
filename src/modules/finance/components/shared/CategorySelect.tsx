import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import CategoryManager from './CategoryManager';

interface CategorySelectProps {
  value: string;
  onChange: (category: string) => void;
  className?: string;
}

export function CategorySelect({ value, onChange, className }: CategorySelectProps) {
  const { t } = useTranslation();
  const [categories, setCategories] = useState<string[]>([]);
  const [showManager, setShowManager] = useState(false);

  const loadCategories = useCallback(() => {
    window.api.financeGetCategories().then((cats: string[]) => {
      setCategories(cats);
    });
  }, []);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === '__manage__') {
      setShowManager(true);
      return;
    }
    onChange(val);
  };

  const handleSaved = () => {
    loadCategories();
  };

  return (
    <>
      <select
        value={value}
        onChange={handleChange}
        className={`rpg-select coin-category-select ${className ?? ''}`}
      >
        {categories.map((cat) => (
          <option key={cat} value={cat}>{cat}</option>
        ))}
        <option disabled>───────────</option>
        <option value="__manage__">{t('coinify.manageCategories')}...</option>
      </select>

      {showManager && (
        <CategoryManager
          categories={categories}
          onClose={() => setShowManager(false)}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}
