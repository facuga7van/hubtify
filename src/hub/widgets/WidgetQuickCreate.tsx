import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  /** Placeholder for the single field. The name IS the whole form. */
  placeholder: string;
  /** Saves and resolves. Throwing keeps the text so nothing is lost. */
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
}

/**
 * The smallest form that can create the first thing.
 *
 * A widget's empty state has room for one field, not for the module's real
 * form. Everything else (tier, project, dates, frequency) has a sane default
 * and can be edited afterwards on the module page — the point is that the
 * user's first quest exists before they have to learn where anything lives.
 */
export default function WidgetQuickCreate({ placeholder, onSubmit, onCancel }: Props) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = async () => {
    const name = value.trim();
    if (!name || saving) return;
    setSaving(true);
    try {
      await onSubmit(name);
      setValue('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="widget-quick-create">
      <input
        ref={inputRef}
        className="rpg-input widget-quick-create__input"
        type="text"
        value={value}
        placeholder={placeholder}
        disabled={saving}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); submit(); }
          if (e.key === 'Escape') onCancel();
        }}
      />
      <button
        type="button"
        className="rpg-button widget-quick-create__save"
        onClick={submit}
        disabled={saving || !value.trim()}
      >
        {t('common.save', 'Guardar')}
      </button>
      <button
        type="button"
        className="widget-quick-create__cancel"
        onClick={onCancel}
        aria-label={t('common.cancel', 'Cancelar')}
        title={t('common.cancel', 'Cancelar')}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"
          fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="M2 2l8 8M10 2l-8 8" />
        </svg>
      </button>
    </div>
  );
}
