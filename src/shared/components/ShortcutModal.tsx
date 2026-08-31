import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useModalA11y } from '../hooks/useModalA11y';
import { SHORTCUTS } from '../shortcuts';

interface ShortcutModalProps {
  open: boolean;
  onClose: () => void;
}


export default function ShortcutModal({ open, onClose }: ShortcutModalProps) {
  const { t } = useTranslation();
  const overlayRef = useRef<HTMLDivElement>(null);
  // Escape, focus trap, initial focus and focus restore.
  const { dialogProps } = useModalA11y<HTMLDivElement>({ onClose, active: open });

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(42, 29, 14, 0.55)',
        zIndex: 'var(--z-modal)' as unknown as number,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        {...dialogProps}
        aria-label={t('shortcuts.title', 'Atajos de teclado')}
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
