import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import CategoryManager from './CategoryManager';
import { RESERVED_CATEGORIES } from '../../types';
import { useToast } from '../../../../shared/components/useToast';

interface CategorySelectProps {
  value: string;
  onChange: (category: string) => void;
  className?: string;
}

export function CategorySelect({ value, onChange, className }: CategorySelectProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [categories, setCategories] = useState<string[]>([]);
  const [showManager, setShowManager] = useState(false);
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value);
  /** ¿Editó el campo? Hasta entonces la lista se muestra entera. */
  const [typed, setTyped] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * Reserved categories are dropped from the list.
   *
   * "Pago Tarjeta" and "Impuestos de tarjeta" are written by the app itself —
   * the statement generator and the PDF importer. Filing a manual expense under
   * one of them corrupts a number the user reads elsewhere: card spend would be
   * counted twice, or a purchase would be reported as a bank charge. They still
   * show up in the category wheel and in reports, which is where they belong.
   *
   * The current value is kept even when reserved, so editing an imported tax row
   * shows its real category instead of an empty field.
   *
   * El `.then()` iba pelado, sin `.catch()`. Con el puente caído —o con un
   * binding viejo, que devuelve `null`— `cats.filter` reventaba DENTRO del
   * `.then()`: una promesa rechazada sin dueño («TypeError: Cannot read
   * properties of null (reading 'filter')»), el campo mudo y nadie avisado.
   * Ahora degrada a lista vacía —se puede seguir escribiendo la categoría a
   * mano— y lo dice con el mismo aviso que usa el resto del módulo.
   */
  const loadCategories = useCallback(() => {
    window.api.financeGetCategories()
      .then((cats: string[]) => {
        if (!Array.isArray(cats)) throw new TypeError('financeGetCategories no devolvió una lista');
        setCategories(cats.filter((c) => !RESERVED_CATEGORIES.includes(c)));
      })
      .catch((err) => {
        console.error('[CategorySelect] financeGetCategories failed:', err);
        setCategories([]);
        toast({ type: 'warning', message: t('coinify.loadError', 'Error al cargar datos') });
      });
  }, [toast, t]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    const handler = () => loadCategories();
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
  }, [loadCategories]);

  // Sync inputValue when value prop changes externally
  useEffect(() => {
    setInputValue(value);
    setTyped(false);
  }, [value]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
        // If the user typed something that doesn't match, revert to current value
        setTyped(false);
        if (!categories.includes(inputValue)) {
          setInputValue(value);
        }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [categories, inputValue, value]);

  /*
   * Sólo se filtra con lo que el usuario TIPEÓ, no con el valor que ya traía.
   *
   * El formulario de cuotas abre con «Otros» puesto, así que `inputValue` valía
   * «Otros» desde el primer render y la lista se filtraba contra sí misma: al
   * abrirla mostraba una sola opción y parecía vacía — no había forma de elegir
   * otra categoría sin borrar el texto a mano primero.
   */
  const filtered = typed
    ? categories.filter((cat) => cat.toLowerCase().includes(inputValue.toLowerCase()))
    : categories;

  const handleSelect = (cat: string) => {
    setInputValue(cat);
    onChange(cat);
    setTyped(false);
    setOpen(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
    setTyped(true);
    setOpen(true);
  };

  const handleInputFocus = () => {
    setOpen(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      setTyped(false);
      setInputValue(value);
      inputRef.current?.blur();
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      // If there's exactly one match or typed value matches a category, select it
      if (filtered.length === 1) {
        handleSelect(filtered[0]);
      } else if (filtered.length > 0) {
        // Select first match
        handleSelect(filtered[0]);
      }
      inputRef.current?.blur();
    }
  };

  const handleSaved = () => {
    loadCategories();
  };

  return (
    <>
      <div ref={wrapperRef} className={`coin-category-autocomplete ${className ?? ''}`}>
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onKeyDown={handleKeyDown}
          placeholder={t('coinify.categoryName', 'Categoría')}
          className="rpg-input coin-category-autocomplete__input"
          autoComplete="off"
        />
        {open && (
          <div className="coin-category-autocomplete__dropdown">
            {filtered.map((cat) => (
              <div
                key={cat}
                className={`coin-category-autocomplete__option ${cat === value ? 'coin-category-autocomplete__option--active' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); handleSelect(cat); }}
              >
                {cat}
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="coin-category-autocomplete__empty">
                {t('coinify.noData', 'Sin resultados')}
              </div>
            )}
            <div
              className="coin-category-autocomplete__manage"
              onMouseDown={(e) => { e.preventDefault(); setShowManager(true); setOpen(false); }}
            >
              {t('coinify.manageCategories')}...
            </div>
          </div>
        )}
      </div>

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
