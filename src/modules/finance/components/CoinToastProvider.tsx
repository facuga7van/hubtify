import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import CoinToast, { type CoinToastType, type CoinToastData } from './CoinToast';

interface CoinToastContextValue {
  showToast: (type: CoinToastType, message: string) => void;
}

const CoinToastContext = createContext<CoinToastContextValue | null>(null);

export function useCoinToast(): CoinToastContextValue {
  const ctx = useContext(CoinToastContext);
  if (!ctx) throw new Error('useCoinToast must be used within CoinToastProvider');
  return ctx;
}

interface CoinToastProviderProps {
  children: ReactNode;
}

export function CoinToastProvider({ children }: CoinToastProviderProps) {
  // Using an object reference ensures React sees a new value even for
  // repeated identical toasts (same type + message).
  const [toast, setToast] = useState<CoinToastData | null>(null);

  const showToast = useCallback((type: CoinToastType, message: string) => {
    // Create a new object each time to trigger useEffect in CoinToast
    setToast({ type, message });
  }, []);

  return (
    <CoinToastContext.Provider value={{ showToast }}>
      {children}
      <CoinToast toast={toast} />
    </CoinToastContext.Provider>
  );
}
