import { createContext, useContext, useState, useCallback, useRef } from 'react';
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

  const handleResult = (result: boolean) => {
    resolveRef.current?.(result);
    resolveRef.current = null;
    setState(null);
  };

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {state?.visible && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(44,24,16,0.75)', zIndex: 99999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'contentFadeIn 0.15s ease',
        }} onClick={() => handleResult(false)}>
          <div style={{
            backgroundImage: `url(${new URL('../../assets/bg.jpg', import.meta.url).href})`,
            backgroundSize: '400px', backgroundRepeat: 'repeat',
            borderRadius: 6, padding: '20px 24px',
            boxShadow: '0 12px 40px rgba(44,24,16,0.6), 0 0 0 1px rgba(201,168,76,0.3)',
            border: '3px solid var(--rpg-gold-dark)',
            maxWidth: 380, width: '90%',
            position: 'relative',
          }} onClick={(e) => e.stopPropagation()}>
            {/* Top gold edge */}
            <div style={{
              position: 'absolute', top: -3, left: 20, right: 20, height: 3,
              background: 'linear-gradient(90deg, transparent, var(--rpg-gold) 30%, var(--rpg-gold) 70%, transparent)',
            }} />

            <p style={{
              fontFamily: 'Crimson Text, serif', fontSize: '1rem',
              color: 'var(--rpg-ink)', lineHeight: 1.5, marginBottom: 16,
              textAlign: 'center',
            }}>
              {state.message}
            </p>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button className="rpg-button" onClick={() => handleResult(true)}
                style={{
                  padding: '6px 20px', fontSize: '0.9rem', fontWeight: 'bold',
                  background: state.danger ? 'var(--rpg-hp-red)' : undefined,
                  color: state.danger ? 'var(--rpg-parchment)' : undefined,
                }}>
                {state.confirmText ?? 'OK'}
              </button>
              <button className="rpg-button" onClick={() => handleResult(false)}
                style={{ padding: '6px 20px', fontSize: '0.9rem', opacity: 0.7 }}>
                {state.cancelText ?? 'Cancelar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
