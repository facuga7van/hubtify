import { useState, useCallback, useRef } from 'react'
import gsap from 'gsap'
import { ToastContext } from './useToast'
import Toast from './Toast'
import type { ToastData } from './useToast'

const MAX_VISIBLE = 3
const AUTO_DISMISS_MS = 2500

interface TimerState {
  timeout: ReturnType<typeof setTimeout>
  startedAt: number
  remaining: number
}

interface Props {
  children: React.ReactNode
}

export default function ToastProvider({ children }: Props) {
  const [queue, setQueue] = useState<ToastData[]>([])
  const timersRef = useRef<Map<string, TimerState>>(new Map())
  const elementRefs = useRef<Map<string, HTMLDivElement | null>>(new Map())

  const removeToast = useCallback((id: string) => {
    const el = elementRefs.current.get(id)
    if (el) {
      gsap.to(el, {
        x: 40,
        opacity: 0,
        scale: 0.95,
        duration: 0.2,
        ease: 'power2.in',
        onComplete: () => {
          setQueue(prev => prev.filter(t => t.id !== id))
          elementRefs.current.delete(id)
        },
      })
    } else {
      setQueue(prev => prev.filter(t => t.id !== id))
    }
  }, [])

  const startTimer = useCallback((id: string, duration: number) => {
    const timeout = setTimeout(() => {
      removeToast(id)
      timersRef.current.delete(id)
    }, duration)
    timersRef.current.set(id, { timeout, startedAt: Date.now(), remaining: duration })
  }, [removeToast])

  const toast = useCallback((data: Omit<ToastData, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const newToast: ToastData = { ...data, id }

    setQueue(prev => {
      const next = [...prev, newToast]
      // If over max, schedule removal of oldest (no animation needed — it's already off-screen or covered)
      if (next.length > MAX_VISIBLE) {
        const overflow = next.shift()!
        const state = timersRef.current.get(overflow.id)
        if (state) {
          clearTimeout(state.timeout)
          timersRef.current.delete(overflow.id)
        }
        elementRefs.current.delete(overflow.id)
      }
      return next
    })

    startTimer(id, AUTO_DISMISS_MS)
  }, [removeToast, startTimer])

  const handleDismiss = useCallback((id: string) => {
    const state = timersRef.current.get(id)
    if (state) {
      clearTimeout(state.timeout)
      timersRef.current.delete(id)
    }
    removeToast(id)
  }, [removeToast])

  const pauseTimer = useCallback((id: string) => {
    const state = timersRef.current.get(id)
    if (!state) return
    clearTimeout(state.timeout)
    const elapsed = Date.now() - state.startedAt
    state.remaining = Math.max(state.remaining - elapsed, 0)
  }, [])

  const resumeTimer = useCallback((id: string) => {
    const state = timersRef.current.get(id)
    if (!state) return
    const timeout = setTimeout(() => {
      removeToast(id)
      timersRef.current.delete(id)
    }, state.remaining)
    state.timeout = timeout
    state.startedAt = Date.now()
  }, [removeToast])

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}

      {/* Fixed bottom-right container — toasts stack upward */}
      <div
        role="status"
        aria-live="polite"
        style={{
          position: 'fixed',
          bottom: 20,
          right: 20,
          display: 'flex',
          flexDirection: 'column-reverse',
          gap: 8,
          zIndex: 10003,
          pointerEvents: 'none',
        }}
      >
        {queue.map((data) => (
          <div
            key={data.id}
            ref={el => { elementRefs.current.set(data.id, el) }}
            style={{ pointerEvents: 'auto' }}
            onMouseEnter={() => pauseTimer(data.id)}
            onMouseLeave={() => resumeTimer(data.id)}
          >
            <Toast
              data={data}
              onDismiss={() => handleDismiss(data.id)}
            />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
