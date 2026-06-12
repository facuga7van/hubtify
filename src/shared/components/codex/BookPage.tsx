import React from 'react';
import { CornerBracket, TopRule } from '../icons';
import './codex.css';

export interface BookPageTab {
  id: string;
  label: string;
  active?: boolean;
  onClick?: () => void;
}

export interface BookPageProps extends React.HTMLAttributes<HTMLDivElement> {
  eyebrow?: React.ReactNode;
  title: string;
  subtitle?: string;
  headerExtra?: React.ReactNode;
  tabs?: BookPageTab[];
  children: React.ReactNode;
  className?: string;
}

export function BookPage({
  eyebrow,
  title,
  subtitle,
  headerExtra,
  tabs = [],
  children,
  className,
  ...rest
}: BookPageProps) {
  return (
    <div className={`qb-page${className ? ` ${className}` : ''}`} {...rest}>
      {/* subtle iron corners */}
      <div className="qb-corner qb-corner--tl">
        <CornerBracket position="tl" />
      </div>
      <div className="qb-corner qb-corner--tr">
        <CornerBracket position="tr" />
      </div>
      <div className="qb-corner qb-corner--bl">
        <CornerBracket position="bl" />
      </div>
      <div className="qb-corner qb-corner--br">
        <CornerBracket position="br" />
      </div>

      {/* header area */}
      <div className="qb-header">
        <div className="qb-header-text">
          {eyebrow && <div className="qb-eyebrow">{eyebrow}</div>}
          <div className="qb-title">{title}</div>
          {subtitle && <div className="qb-subtitle">{subtitle}</div>}
        </div>
        {headerExtra && <div className="qb-header-extra">{headerExtra}</div>}
      </div>

      {/* top rule ornament */}
      <div className="qb-rule">
        <TopRule />
      </div>

      {/* thumb tabs */}
      {tabs.length > 0 && (
        <div className="qb-tabs">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`qb-tab${tab.active ? ' qb-tab--active' : ''}`}
              onClick={tab.onClick}
              role="tab"
              aria-selected={tab.active}
            >
              {tab.label}
            </div>
          ))}
        </div>
      )}

      {/* content flows naturally — no separate scroll */}
      <div className="qb-content">{children}</div>
    </div>
  );
}
