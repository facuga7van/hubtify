import { useState, useCallback, useRef } from 'react'
import gsap from 'gsap'
import { ToastContext } from './useToast'
import Toast from './Toast'
import type { ToastData } from './useToast'

const MAX_VISIBLE = 3
const AUTO_DISMISS_MS = 2500

interface Props {
  children: React.ReactNode
}

export default function ToastProvider({ children }: Props) {
  const [queue, setQueue] = useState<ToastData[]>([])
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
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

  const toast = useCallback((data: Omit<ToastData, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const newToast: ToastData = { ...data, id }

    setQueue(prev => {
      const next = [...prev, newToast]
      // If over max, schedule removal of oldest (no animation needed — it's already off-screen or covered)
      if (next.length > MAX_VISIBLE) {
        const overflow = next.shift()!
        const timer = timersRef.current.get(overflow.id)
        if (timer) {
          clearTimeout(timer)
          timersRef.current.delete(overflow.id)
        }
        elementRefs.current.delete(overflow.id)
      }
      return next
    })

    const timer = setTimeout(() => {
      removeToast(id)
      timersRef.current.delete(id)
    }, AUTO_DISMISS_MS)
    timersRef.current.set(id, timer)
  }, [removeToast])

  const handleDismiss = useCallback((id: string) => {
    const timer = timersRef.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(id)
    }
    removeToast(id)
  }, [removeToast])

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}

      {/* Fixed bottom-right container — toasts stack upward */}
      <div
        style={{
          position: 'fixed',
          bottom: 20,
          right: 20,
          display: 'flex',
          flexDirection: 'column-reverse',
          gap: 8,
          zIndex: 10000,
          pointerEvents: 'none',
        }}
      >
        {queue.map((data) => (
          <div
            key={data.id}
            ref={el => { elementRefs.current.set(data.id, el) }}
            style={{ pointerEvents: 'auto' }}
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
