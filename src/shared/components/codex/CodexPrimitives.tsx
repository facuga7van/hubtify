import React from 'react';
import { QBDivider } from '../icons';

/* ── Section ──────────────────────────────────────── */

export interface SectionProps {
  title: string;
  icon?: React.ReactNode;
  rightSlot?: React.ReactNode;
  children: React.ReactNode;
}

export function Section({ title, icon, rightSlot, children }: SectionProps) {
  return (
    <div className="qb-section">
      <div className="qb-section-title">
        {icon}
        <span>{title}</span>
        {rightSlot && <span style={{ marginLeft: 'auto' }}>{rightSlot}</span>}
      </div>
      {children}
    </div>
  );
}

/* ── Rune (pill / chip tag) ───────────────────────── */

export interface RuneProps {
  children: React.ReactNode;
  tone?: 'rubric' | 'sage' | 'gold' | 'ink';
}

export function Rune({ children, tone }: RuneProps) {
  const cls = tone ? `qb-rune qb-rune--${tone}` : 'qb-rune';
  return <span className={cls}>{children}</span>;
}

/* ── Tick (quill-tick checkbox) ────────────────────── */

export interface TickProps {
  checked: boolean;
  onChange?: () => void;
  label?: string;
}

export function Tick({ checked, onChange, label }: TickProps) {
  return (
    <span
      className={`qb-check${checked ? ' qb-check--done' : ''}`}
      onClick={onChange}
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      tabIndex={0}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && onChange) {
          e.preventDefault();
          onChange();
        }
      }}
    >
      {checked && (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path
            d="M1 6 L4 9 L11 1"
            stroke="var(--rubric)"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </span>
  );
}

/* ── Gauge (progress bar with hatch fill) ─────────── */

export interface GaugeProps {
  value: number;
  max: number;
  tone?: 'rubric' | 'sage' | 'gold' | 'ink';
  label?: string;
  showPips?: boolean;
}

export function Gauge({ value, max, tone = 'ink', label, showPips = true }: GaugeProps) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));

  return (
    <div className="qb-gauge">
      <div
        className={`qb-gauge-fill qb-gauge-fill--${tone}`}
        style={{ width: `${pct}%` }}
      />
      {showPips &&
        [25, 50, 75].map((p) => (
          <div key={p} className="qb-gauge-pip" style={{ left: `${p}%` }} />
        ))}
      {label && <div className="qb-gauge-label">{label}</div>}
    </div>
  );
}

/* ── Cartouche (stat box with dingbat corners) ────── */

export interface CartoucheProps {
  label: string;
  value: string | number;
  foot?: string;
  icon?: React.ReactNode;
  tone?: 'rubric' | 'sage' | 'gold';
}

export function Cartouche({ label, value, foot, icon, tone }: CartoucheProps) {
  const valueCls = tone
    ? `qb-cartouche-value qb-cartouche-value--${tone}`
    : 'qb-cartouche-value';

  return (
    <div className="qb-cartouche">
      <span className="qb-cartouche-dingbat-tl" aria-hidden="true">&#10021;</span>
      <span className="qb-cartouche-dingbat-br" aria-hidden="true">&#10022;</span>
      <div className="qb-cartouche-header">
        <div className="qb-cartouche-label">{label}</div>
        {icon && <span className="qb-cartouche-icon">{icon}</span>}
      </div>
      <div className={valueCls}>{value}</div>
      {foot && <div className="qb-cartouche-foot">{foot}</div>}
    </div>
  );
}

/* ── StatBox (bordered panel with corner mark) ────── */

export interface StatBoxProps {
  label: string;
  value: string | number;
}

export function StatBox({ label, value }: StatBoxProps) {
  return (
    <div className="qb-stat-box">
      <div className="qb-stat-box-label">{label}</div>
      <div className="qb-stat-box-value">{value}</div>
      {/* corner mark */}
      <svg
        width="10"
        height="10"
        viewBox="0 0 10 10"
        style={{ position: 'absolute', top: 2, right: 2, opacity: 0.4 }}
        aria-hidden="true"
      >
        <path d="M0 0 L6 0 L6 1 L1 1 L1 6 L0 6 Z" fill="var(--ink-faded)" />
      </svg>
    </div>
  );
}

/* ── QBDividerSection ─────────────────────────────── */

export function QBDividerSection() {
  return (
    <div className="qb-divider-section">
      <QBDivider />
    </div>
  );
}

/* ── SmallCount ───────────────────────────────────── */

export interface SmallCountProps {
  label: string;
  value: number;
  tone?: string;
}

export function SmallCount({ label, value, tone }: SmallCountProps) {
  return (
    <div className="qb-small-count">
      <span
        className="qb-small-count-value"
        style={tone ? { color: `var(--${tone})` } : undefined}
      >
        {value}
      </span>
      <span className="qb-small-count-label">{label}</span>
    </div>
  );
}

/* ── ModuleCard ───────────────────────────────────── */

export interface ModuleCardProps {
  title: string;
  tome?: string;
  latin?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}

export function ModuleCard({ title, tome, latin, icon, children }: ModuleCardProps) {
  return (
    <div className="qb-module-card">
      <div className="qb-module-card-header">
        {icon && <span className="qb-module-card-icon">{icon}</span>}
        <div style={{ flex: 1 }}>
          {tome && <div className="qb-module-card-tome">{tome}</div>}
          <div className="qb-module-card-title">{title}</div>
          {latin && <div className="qb-module-card-latin">{latin}</div>}
        </div>
      </div>
      <div className="qb-module-card-body">{children}</div>
    </div>
  );
}

/* ── RingGauge (SVG circle gauge) ─────────────────── */

export interface RingGaugeProps {
  value: number;
  max: number;
  size?: number;
  label?: string;
  tone?: string;
}

export function RingGauge({ value, max, size = 68, label, tone = 'rubric' }: RingGaugeProps) {
  const r = (size / 2) - 6;
  const c = 2 * Math.PI * r;
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const center = size / 2;
  const tickOuter = center + r + 2;
  const tickInner = center + r;

  const toneColor =
    tone === 'sage' ? 'var(--moss)' :
    tone === 'gold' ? 'var(--gold)' :
    tone === 'ink' ? 'var(--ink)' :
    'var(--rubric)';

  return (
    <div className="qb-ring-gauge" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* track */}
        <circle
          cx={center}
          cy={center}
          r={r}
          fill="none"
          stroke="rgba(74, 55, 32, 0.35)"
          strokeWidth="3"
        />
        {/* fill arc */}
        <circle
          cx={center}
          cy={center}
          r={r}
          fill="none"
          stroke={toneColor}
          strokeWidth="4"
          strokeDasharray={c}
          strokeDashoffset={c - (pct / 100) * c}
          transform={`rotate(-90 ${center} ${center})`}
          strokeLinecap="butt"
        />
        {/* 12 tick marks */}
        {Array.from({ length: 12 }).map((_, i) => {
          const a = (i * 30) * Math.PI / 180;
          const x1 = center + Math.cos(a) * tickInner;
          const y1 = center + Math.sin(a) * tickInner;
          const x2 = center + Math.cos(a) * tickOuter;
          const y2 = center + Math.sin(a) * tickOuter;
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="var(--ink-faded)"
              strokeWidth="0.5"
            />
          );
        })}
      </svg>
      <div className="qb-ring-gauge-center">
        <div className="qb-ring-gauge-value">{value}</div>
        {label && <div className="qb-ring-gauge-label">{label}</div>}
      </div>
    </div>
  );
}

/* ── MiniMacro (mini nutrient bar) ────────────────── */

export interface MiniMacroProps {
  label: string;
  value: number;
  max: number;
  tone?: string;
}

export function MiniMacro({ label, value, max, tone = 'ink' }: MiniMacroProps) {
  const gaugeTone = (['rubric', 'sage', 'gold', 'ink'].includes(tone)
    ? tone
    : 'ink') as 'rubric' | 'sage' | 'gold' | 'ink';

  return (
    <div className="qb-mini-macro">
      <div className="qb-mini-macro-header">
        <span className="qb-mini-macro-label">{label}</span>
        <span className="qb-mini-macro-value">{value}</span>
      </div>
      <Gauge value={value} max={max} tone={gaugeTone} showPips={false} />
    </div>
  );
}

/* ── Banner (ribbon with clipped ends) ────────────── */

export interface BannerProps {
  children: React.ReactNode;
  tone?: string;
}

export function Banner({ children, tone }: BannerProps) {
  const cls = tone ? `qb-banner qb-banner--${tone}` : 'qb-banner';
  return <div className={cls}>{children}</div>;
}
