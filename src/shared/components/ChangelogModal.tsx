import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { changelog } from '../changelog';
import type { ChangelogEntry } from '../changelog';
import './ChangelogModal.css';

interface ChangelogModalProps {
  open: boolean;
  onClose: () => void;
}

export default function ChangelogModal({ open, onClose }: ChangelogModalProps) {
  const { t } = useTranslation();
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    const scrollContainer = document.querySelector('.main-content') as HTMLElement | null;
    if (scrollContainer) scrollContainer.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handler);
      if (scrollContainer) scrollContainer.style.overflow = '';
    };
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
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '5vh',
      }}
    >
      <div
        style={{
          background: 'linear-gradient(180deg, var(--parch-0) 0%, var(--parch-1) 100%)',
          border: '2px solid var(--gold-dark)',
          borderRadius: 8,
          padding: '24px 28px',
          minWidth: 420,
          maxWidth: 580,
          boxShadow: '0 8px 32px rgba(42, 29, 14, 0.4)',
        }}
      >
        <h2 className="changelog-title">
          {t('settings.changelog', 'Changelog')}
        </h2>

        <div className="changelog-scroll">
          {changelog.map((entry: ChangelogEntry) => (
            <div className="changelog-version" key={entry.version}>
              <div className="changelog-version__header">
                <span className="changelog-version__tag">v{entry.version}</span>
                <span className="changelog-version__date">{entry.date}</span>
              </div>
              <ul className="changelog-changes">
                {entry.changes.map((change, i) => (
                  <li key={i} className="changelog-change">
                    <span className={`changelog-badge changelog-badge--${change.category}`}>
                      {change.category}
                    </span>
                    {change.scope && <span className="changelog-scope">{change.scope}</span>}
                    <span className="changelog-text">{change.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

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
