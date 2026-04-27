import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import type { ReactNode } from 'react';

interface ConfirmOptions {
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

interface ConfirmContextType {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextType | null>(null);

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider');
  return ctx.confirm;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { visible: boolean }) | null>(null);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setState({ ...options, visible: true });
    });
  }, []);

  const cancelRef = useRef<HTMLButtonElement>(null);

  const handleResult = (result: boolean) => {
    resolveRef.current?.(result);
    resolveRef.current = null;
    setState(null);
  };

  // Escape key closes dialog
  useEffect(() => {
    if (!state?.visible) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleResult(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [state?.visible]);

  // Auto-focus cancel button on open (safer default for destructive dialogs)
  useEffect(() => {
    if (state?.visible) cancelRef.current?.focus();
  }, [state?.visible]);

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {state?.visible && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(42, 29, 14, 0.7)', zIndex: 99999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={() => handleResult(false)}>
          <div
            role="alertdialog"
            aria-modal="true"
            aria-describedby="confirm-dialog-message"
            style={{
            background: 'linear-gradient(135deg, var(--parch-0) 0%, var(--parch-1) 60%, var(--parch-2) 100%)',
            borderRadius: 6, padding: '24px 28px',
            boxShadow: '0 12px 40px rgba(42, 29, 14, 0.6), inset 0 0 40px rgba(90, 60, 30, 0.12)',
            border: '2px solid var(--gold-dark)',
            maxWidth: 380, width: '90%',
            position: 'relative',
          }} onClick={(e) => e.stopPropagation()}>
            {/* Top gold edge */}
            <div style={{
              position: 'absolute', top: -2, left: 20, right: 20, height: 2,
              background: 'linear-gradient(90deg, transparent, var(--gold) 30%, var(--gold) 70%, transparent)',
            }} />
            {/* Inner border */}
            <div style={{
              position: 'absolute', top: 5, left: 5, right: 5, bottom: 5,
              border: '1px solid rgba(168, 138, 60, 0.15)',
              borderRadius: 3, pointerEvents: 'none',
            }} />

            <p id="confirm-dialog-message" style={{
              fontFamily: "'IM Fell English', serif", fontSize: 'var(--fs-sub)',
              color: 'var(--ink)', lineHeight: 1.5, marginBottom: 18,
              textAlign: 'center',
            }}>
              {state.message}
            </p>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button className="rpg-button" onClick={() => handleResult(true)}
                style={{
                  padding: '6px 20px', fontSize: 'var(--fs-quote)', fontWeight: 'bold',
                  background: state.danger
                    ? 'linear-gradient(180deg, var(--rubric-light) 0%, var(--rubric) 100%)'
                    : undefined,
                  color: state.danger ? 'var(--parch-0)' : undefined,
                }}>
                {state.confirmText ?? 'OK'}
              </button>
              <button ref={cancelRef} onClick={() => handleResult(false)}
                style={{
                  padding: '6px 20px', fontSize: 'var(--fs-quote)',
                  background: 'transparent', border: '1px solid var(--gold-dark)',
                  borderRadius: '6px', cursor: 'pointer',
                  fontFamily: "'IM Fell English SC', serif", fontWeight: 700,
                  color: 'var(--ink-soft)', letterSpacing: '0.04em',
                  transition: 'all 0.2s ease',
                }}>
                {state.cancelText ?? 'Cancelar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
