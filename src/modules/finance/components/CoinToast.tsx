import { useState, useEffect, type ReactNode } from 'react';

export type CoinToastType = 'expense' | 'income' | 'settled' | 'imported' | 'generated';

export interface CoinToastData {
  type: CoinToastType;
  message: string;
}

interface CoinToastProps {
  toast: CoinToastData | null;
}

const ICONS: Record<CoinToastType, ReactNode> = {
  expense: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m11 19-6-6" /><path d="m5 21-2-2" /><path d="m8 16-4 4" /><path d="M9.5 17.5 21 6V3h-3L6.5 14.5" />
    </svg>
  ),
  income: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  settled: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v3" />
      <path d="M3 16v3a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3" />
      <path d="M3 8h18v8H3z" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  ),
  imported: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <path d="M9 15l3-3 3 3" />
    </svg>
  ),
  generated: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v6" />
      <path d="M5 8h6" />
      <circle cx="16" cy="16" r="6" />
      <path d="M16 13v6" />
      <path d="M13 16h6" />
    </svg>
  ),
};

export default function CoinToast({ toast }: CoinToastProps) {
  const [visible, setVisible] = useState(false);
  const [current, setCurrent] = useState<CoinToastData | null>(null);

  useEffect(() => {
    if (!toast) return;
    setCurrent(toast);
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 2500);
    return () => clearTimeout(timer);
  }, [toast]);

  if (!current || !visible) return null;

  return (
    <div className={`coin-toast coin-toast--${current.type}`}>
      <span className="coin-toast__icon">{ICONS[current.type]}</span>
      <span className="coin-toast__message">{current.message}</span>
    </div>
  );
}
