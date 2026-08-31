import { useRef } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { useTranslation } from 'react-i18next'
import {
  Sword, Coin, Apple, Checkmark, WarningTriangle, Scroll, Gear, ArrowUp, ArrowDown,
} from './icons'
import type { ToastData } from './useToast'

// ── Border accent colours per type (codex palette) ───────────────────────────
const BORDER: Record<ToastData['type'], string> = {
  xp:      'var(--moss)',
  coin:    'var(--gold)',
  nutri:   'var(--rubric)',
  success: 'var(--moss)',
  warning: 'var(--gold)',
  info:    'var(--ink-soft)',
}

// ── Default icons per type ────────────────────────────────────────────────────
// Codex SVGs, not Unicode glyphs: the old text glyphs had no stroke control
// and could fall back to colour emoji in some Windows fonts.
type IconComponent = (props: React.SVGProps<SVGSVGElement>) => React.ReactElement

const DEFAULT_ICON: Record<ToastData['type'], IconComponent> = {
  xp:      Sword,
  coin:    Coin,
  nutri:   Apple,
  success: Checkmark,
  warning: WarningTriangle,
  info:    Scroll,
}

type TransactionType = NonNullable<NonNullable<ToastData['details']>['transactionType']>
const TRANSACTION_ICON: Record<TransactionType, IconComponent> = {
  expense:   ArrowDown,
  income:    ArrowUp,
  settled:   Checkmark,
  imported:  Scroll,
  generated: Gear,
}

interface Props {
  data: ToastData
  onDismiss: () => void
  style?: React.CSSProperties
}

export default function Toast({ data, onDismiss, style }: Props) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)

  // Enter animation: slide from right (+40px), fade in, scale 0.95 → 1
  useGSAP(() => {
    gsap.fromTo(
      ref.current,
      { x: 40, opacity: 0, scale: 0.95 },
      { x: 0, opacity: 1, scale: 1, duration: 0.25, ease: 'power2.out' }
    )
  }, { scope: ref })

  // Resolve the icon to show
  const Icon: IconComponent = (() => {
    if (data.type === 'coin' && data.details?.transactionType) {
      return TRANSACTION_ICON[data.details.transactionType] ?? DEFAULT_ICON.coin
    }
    return DEFAULT_ICON[data.type]
  })()

  const borderColor = BORDER[data.type]
  const tier = data.details?.bonusTier
  // 'normal' means "no bonus" — showing it was pure noise.
  const tierLabel = tier && tier !== 'normal' ? t(`toast.${tier}`, tier) : null

  return (
    <div
      ref={ref}
      onClick={onDismiss}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') onDismiss()
      }}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '10px 14px',
        background: 'linear-gradient(135deg, var(--parch-0) 0%, var(--parch-1) 100%)',
        border: `1px solid var(--gold-dark)`,
        borderLeft: `3px solid ${borderColor}`,
        borderRadius: '6px',
        boxShadow: '0 2px 8px rgba(42, 29, 14, 0.35)',
        cursor: 'pointer',
        minWidth: 240,
        maxWidth: 320,
        userSelect: 'none',
        fontFamily: "'IM Fell English', serif",
        ...style,
      }}
    >
      {/* Icon */}
      <span aria-hidden="true" style={{ lineHeight: 1, flexShrink: 0, marginTop: 2, color: borderColor }}>
        {data.icon
          ? <span style={{ fontSize: 'var(--fs-nav)' }}>{data.icon}</span>
          : <Icon width={18} height={18} />}
      </span>

      {/* Content */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{
          fontFamily: "'IM Fell English', serif",
          fontSize: 'var(--fs-quote)',
          color: 'var(--ink)',
          lineHeight: 1.3,
        }}>
          {data.message}
        </span>

        {/* XP detail line */}
        {data.type === 'xp' && data.details && (
          <span style={{
            fontFamily: 'Fira Code, monospace',
            fontSize: 'var(--fs-label)',
            color: 'var(--ink-faded)',
          }}>
            {data.details.comboMultiplier != null && `×${data.details.comboMultiplier} ${t('toast.combo', 'Combo')}`}
            {data.details.comboMultiplier != null && tierLabel && '  '}
            {tierLabel}
          </span>
        )}
      </div>
    </div>
  )
}
