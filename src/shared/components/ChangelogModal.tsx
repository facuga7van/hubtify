import { useEffect, useRef, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { changelog } from '../changelog';
import type { ChangelogEntry, ChangelogChange } from '../changelog';
import { Sparkle, Shield, Quill } from './icons/CodexIcons';
import { Flourish } from './icons/Ornaments';
import './ChangelogModal.css';

interface ChangelogModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  entries?: ChangelogEntry[];
}

interface ChangeGroup {
  kind: string;
  icon: React.ReactNode;
  color: string;
  items: ChangelogChange[];
}

function groupChanges(changes: ChangelogChange[], t: (k: string, fb: string) => string): ChangeGroup[] {
  const feat: ChangelogChange[] = [];
  const fix: ChangelogChange[] = [];
  const improve: ChangelogChange[] = [];

  for (const c of changes) {
    if (c.category === 'feat') feat.push(c);
    else if (c.category === 'fix') fix.push(c);
    else improve.push(c);
  }

  const groups: ChangeGroup[] = [];
  if (feat.length) groups.push({
    kind: t('settings.changelogNew', 'Nuevo'),
    icon: <Sparkle width={16} height={16} />,
    color: 'var(--moss)',
    items: feat,
  });
  if (improve.length) groups.push({
    kind: t('settings.changelogImprovements', 'Mejoras'),
    icon: <Quill width={16} height={16} />,
    color: 'var(--gold-dark)',
    items: improve,
  });
  if (fix.length) groups.push({
    kind: t('settings.changelogFixes', 'Correcciones'),
    icon: <Shield width={16} height={16} />,
    color: 'var(--rubric)',
    items: fix,
  });

  return groups;
}

export default function ChangelogModal({ open, onClose, title, entries }: ChangelogModalProps) {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language === 'en' ? 'en' : 'es') as 'es' | 'en';
  const overlayRef = useRef<HTMLDivElement>(null);
  const [animOpen, setAnimOpen] = useState(false);
  const displayEntries = entries ?? changelog;
  const isSingleVersion = displayEntries.length === 1;

  // Grouped data for single-version view
  const singleGroups = useMemo(() => {
    if (!isSingleVersion || !displayEntries[0]) return [];
    return groupChanges(displayEntries[0].changes, t);
  }, [displayEntries, isSingleVersion, t]);

  // Multi-version grouped data
  const multiGroups = useMemo(() => {
    if (isSingleVersion) return [];
    return displayEntries.map(entry => ({
      entry,
      groups: groupChanges(entry.changes, t),
    }));
  }, [displayEntries, isSingleVersion, t]);

  // Open animation
  useEffect(() => {
    if (open) requestAnimationFrame(() => setAnimOpen(true));
    else setAnimOpen(false);
  }, [open]);

  // Escape key + scroll lock
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

  const versionLabel = isSingleVersion ? displayEntries[0].version : displayEntries[0]?.version;
  const displayTitle = title ?? t('settings.changelog', 'Changelog');

  return createPortal(
    <div
      ref={overlayRef}
      className="changelog-overlay"
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div
        className={`changelog-card ${animOpen ? 'changelog-card--open' : 'changelog-card--entering'}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top scroll roller */}
        <div className="changelog-roller changelog-roller--top">
          <div className="changelog-roller__knob" />
          <div className="changelog-roller__knob" />
        </div>

        {/* Parchment body */}
        <div className="changelog-parchment">
          {/* Close X */}
          <button className="changelog-close-x" onClick={onClose}>×</button>

          {/* Header */}
          <div className="changelog-header">
            <div className="changelog-header__eyebrow">
              ✠ {displayTitle.toUpperCase()} ✠
            </div>
            <h1 className="changelog-header__title">
              {displayTitle}
            </h1>
            {versionLabel && (
              <div className="changelog-header__version">
                v{versionLabel}
              </div>
            )}
            <div className="changelog-header__flourish">
              <Flourish width={140} height={12} />
            </div>
          </div>

          {/* Scrollable body */}
          <div className="changelog-body">
            {isSingleVersion ? (
              /* Single version: groups only */
              singleGroups.map((g, gi) => (
                <GroupSection key={gi} group={g} lang={lang} />
              ))
            ) : (
              /* Multi-version: version headers + groups */
              multiGroups.map(({ entry, groups }) => (
                <div key={entry.version} className="changelog-version-section">
                  <div className="changelog-version-divider">
                    <span className="changelog-version-divider__tag">v{entry.version}</span>
                    <span className="changelog-version-divider__date">{entry.date}</span>
                    <span className="changelog-version-divider__line" />
                  </div>
                  {groups.map((g, gi) => (
                    <GroupSection key={gi} group={g} lang={lang} />
                  ))}
                </div>
              ))
            )}
          </div>

          {/* Footer — close button only */}
          <div className="changelog-footer">
            <button className="rpg-button" onClick={onClose}>
              {t('common.close', 'Cerrar')}
            </button>
          </div>
        </div>

        {/* Bottom scroll roller */}
        <div className="changelog-roller changelog-roller--bottom">
          <div className="changelog-roller__knob" />
          <div className="changelog-roller__knob" />
        </div>
      </div>
    </div>,
    document.body,
  );
}

function GroupSection({ group, lang }: { group: ChangeGroup; lang: 'es' | 'en' }) {
  return (
    <div className="changelog-group">
      <div className="changelog-group__header">
        <span className="changelog-group__icon" style={{ color: group.color }}>
          {group.icon}
        </span>
        <span className="changelog-group__label" style={{ color: group.color }}>
          {group.kind}
        </span>
        <span className="changelog-group__line" style={{ background: `linear-gradient(90deg, ${group.color}55, transparent)` }} />
        <span className="changelog-group__count">
          {group.items.length}
        </span>
      </div>
      <div className="changelog-items">
        {group.items.map((item, i) => (
          <div key={i} className="changelog-item">
            <span
              className="changelog-item__diamond"
              style={{ background: group.color }}
            />
            <div className="changelog-item__text">
              {item.scope && (
                <span className="changelog-item__scope">[{item.scope}]</span>
              )}
              {item.text[lang]}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
