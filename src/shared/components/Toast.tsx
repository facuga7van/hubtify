import { useRef } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import type { ToastData } from './useToast'

// ── Border accent colours per type ────────────────────────────────────────────
const BORDER: Record<ToastData['type'], string> = {
  xp:      '#d4a017',
  coin:    '#b87333',
  nutri:   '#27ae60',
  success: '#27ae60',
  warning: '#e67e22',
  info:    '#2980b9',
}

// ── Default icons per type ────────────────────────────────────────────────────
const DEFAULT_ICON: Record<ToastData['type'], string> = {
  xp:      '\u2694',
  coin:    '\u272A',
  nutri:   '\u2663',
  success: '\u2714',
  warning: '\u26A0',
  info:    '\u2139',
}

// ── Transaction-type icon overrides for coin toasts ──────────────────────────
type TransactionType = NonNullable<NonNullable<ToastData['details']>['transactionType']>
const TRANSACTION_ICON: Record<TransactionType, string> = {
  expense:   '\u2212',
  income:    '\u002B',
  settled:   '\u2611',
  imported:  '\u21E9',
  generated: '\u2699',
}

interface Props {
  data: ToastData
  onDismiss: () => void
  style?: React.CSSProperties
}

export default function Toast({ data, onDismiss, style }: Props) {
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
  const resolvedIcon = (() => {
    if (data.icon) return data.icon
    if (data.type === 'coin' && data.details?.transactionType) {
      return TRANSACTION_ICON[data.details.transactionType] ?? DEFAULT_ICON.coin
    }
    return DEFAULT_ICON[data.type]
  })()

  const borderColor = BORDER[data.type]

  return (
    <div
      ref={ref}
      onClick={onDismiss}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '10px 14px',
        background: 'linear-gradient(135deg, var(--rpg-parchment-light) 0%, var(--rpg-parchment) 100%)',
        border: `1px solid ${borderColor}`,
        borderLeft: `4px solid ${borderColor}`,
        borderRadius: 'var(--rpg-radius)',
        boxShadow: 'var(--rpg-shadow)',
        cursor: 'pointer',
        minWidth: 240,
        maxWidth: 320,
        userSelect: 'none',
        ...style,
      }}
    >
      {/* Icon */}
      <span style={{ fontSize: '1.2rem', lineHeight: 1, flexShrink: 0, marginTop: 1 }}>
        {resolvedIcon}
      </span>

      {/* Content */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{
          fontFamily: 'Crimson Text, Georgia, serif',
          fontSize: '0.9rem',
          color: 'var(--rpg-ink)',
          lineHeight: 1.3,
        }}>
          {data.message}
        </span>

        {/* XP detail line */}
        {data.type === 'xp' && data.details && (
          <span style={{
            fontFamily: 'Fira Code, monospace',
            fontSize: '0.72rem',
            color: 'var(--rpg-ink-light)',
            opacity: 0.8,
          }}>
            {data.details.comboMultiplier != null && `×${data.details.comboMultiplier} combo`}
            {data.details.comboMultiplier != null && data.details.bonusTier != null && '  '}
            {data.details.bonusTier != null && `${data.details.bonusTier} bonus`}
          </span>
        )}
      </div>
    </div>
  )
}
