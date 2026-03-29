import { useState, useEffect } from 'react';
import { CATEGORIES } from '../../types';

interface CategorySelectProps {
  value: string;
  onChange: (category: string) => void;
  className?: string;
}

export function CategorySelect({ value, onChange, className }: CategorySelectProps) {
  const [categories, setCategories] = useState<string[]>([...CATEGORIES]);

  useEffect(() => {
    window.api.financeGetCategories().then((cats: string[]) => {
      const merged = [...new Set([...CATEGORIES, ...cats])];
      setCategories(merged);
    });
  }, []);

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`rpg-select ${className ?? ''}`}
    >
      {categories.map((cat) => (
        <option key={cat} value={cat}>{cat}</option>
      ))}
    </select>
  );
}
