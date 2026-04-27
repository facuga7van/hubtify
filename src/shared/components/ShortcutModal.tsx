import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

interface ShortcutModalProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { keys: 'Ctrl+1', i18nKey: 'shortcuts.goHome', fallback: 'Go to Dashboard' },
  { keys: 'Ctrl+2', i18nKey: 'shortcuts.goQuests', fallback: 'Go to Questify' },
  { keys: 'Ctrl+3', i18nKey: 'shortcuts.goNutrition', fallback: 'Go to Nutrify' },
  { keys: 'Ctrl+4', i18nKey: 'shortcuts.goFinance', fallback: 'Go to Coinify' },
  { keys: 'Ctrl+5', i18nKey: 'shortcuts.goCharacter', fallback: 'Go to Character' },
  { keys: 'Ctrl+6', i18nKey: 'shortcuts.goCauldron', fallback: 'Go to Cauldron' },
  { keys: 'Ctrl+,', i18nKey: 'shortcuts.goSettings', fallback: 'Open Settings' },
  { keys: 'Ctrl+?', i18nKey: 'shortcuts.showShortcuts', fallback: 'Show this reference' },
];

export default function ShortcutModal({ open, onClose }: ShortcutModalProps) {
  const { t } = useTranslation();
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(42, 29, 14, 0.55)',
        zIndex: 2000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          background: 'linear-gradient(180deg, var(--parch-0) 0%, var(--parch-1) 100%)',
          border: '2px solid var(--gold-dark)',
          borderRadius: 8,
          padding: '24px 28px',
          minWidth: 340,
          maxWidth: 440,
          boxShadow: '0 8px 32px rgba(42, 29, 14, 0.4)',
        }}
      >
        <h2
          style={{
            fontFamily: "'UnifrakturCook', cursive",
            fontSize: '1.2rem',
            color: 'var(--ink)',
            marginTop: 0,
            marginBottom: 16,
            textAlign: 'center',
            letterSpacing: '0.03em',
          }}
        >
          {t('shortcuts.title', 'Keyboard Shortcuts')}
        </h2>

        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {SHORTCUTS.map((s) => (
            <li
              key={s.keys}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '6px 0',
                borderBottom: '1px dotted rgba(74, 55, 32, 0.25)',
                fontFamily: "'IM Fell English', serif",
                fontSize: 'var(--fs-body)',
                color: 'var(--ink)',
              }}
            >
              <span>{t(s.i18nKey, s.fallback)}</span>
              <kbd
                style={{
                  fontFamily: "'IM Fell English SC', serif",
                  fontSize: 'var(--fs-label)',
                  background: 'rgba(168, 138, 60, 0.15)',
                  border: '1px solid var(--gold-dark)',
                  borderRadius: 4,
                  padding: '2px 8px',
                  color: 'var(--ink)',
                  letterSpacing: '0.04em',
                  whiteSpace: 'nowrap',
                }}
              >
                {s.keys}
              </kbd>
            </li>
          ))}
        </ul>

        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <button
            className="rpg-button"
            onClick={onClose}
            style={{ fontSize: 'var(--fs-label)', padding: '6px 20px' }}
          >
            {t('common.close', 'Close')}
          </button>
        </div>
      </div>
    </div>
  );
}
