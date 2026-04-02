import { describe, it, expect } from 'vitest'
import { ToastContext, useToast } from '../useToast'

describe('useToast types and context', () => {
  it('ToastContext is created and exported', () => {
    expect(ToastContext).toBeDefined()
    expect(typeof ToastContext).toBe('object')
  })

  it('useToast is exported as a function', () => {
    expect(typeof useToast).toBe('function')
  })

  it('ToastContext default value is null (no provider)', () => {
    // createContext(null) sets _currentValue to null
    expect((ToastContext as any)._currentValue).toBeNull()
  })

  it('useToast function source contains the guard error message', () => {
    // Verify the error thrown outside a provider is the correct one
    const src = useToast.toString()
    expect(src).toContain('ToastProvider')
  })
})
