import { createContext, useContext } from 'react'

export type ToastType = 'xp' | 'coin' | 'nutri' | 'success' | 'warning' | 'info'

export interface ToastDetails {
  xp?: number
  bonusTier?: string
  comboMultiplier?: number
  streakMilestone?: number
  transactionType?: 'expense' | 'income' | 'settled' | 'imported' | 'generated'
}

export interface ToastData {
  id: string
  type: ToastType
  message: string
  icon?: string
  details?: ToastDetails
}

export interface ToastContextValue {
  toast: (data: Omit<ToastData, 'id'>) => void
}

export const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
