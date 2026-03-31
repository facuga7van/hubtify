import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import NutriToast, { type NutriToastData, type NutriToastType } from './NutriToast';

interface NutriToastContextValue {
  showToast: (type: NutriToastType, message: string) => void;
}

const NutriToastContext = createContext<NutriToastContextValue | null>(null);

export function useNutriToast(): NutriToastContextValue {
  const ctx = useContext(NutriToastContext);
  if (!ctx) throw new Error('useNutriToast must be used within NutriToastProvider');
  return ctx;
}

export default function NutriToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<NutriToastData | null>(null);

  const showToast = useCallback((type: NutriToastType, message: string) => {
    setToast({ type, message });
  }, []);

  return (
    <NutriToastContext.Provider value={{ showToast }}>
      {children}
      <NutriToast toast={toast} />
    </NutriToastContext.Provider>
  );
}
