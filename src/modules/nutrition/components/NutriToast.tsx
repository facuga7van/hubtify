import { useEffect, useState } from 'react';

export type NutriToastType = 'success' | 'info' | 'warning';

export interface NutriToastData {
  type: NutriToastType;
  message: string;
}

const ICONS: Record<NutriToastType, JSX.Element> = {
  success: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--rpg-xp-green)" strokeWidth="2" strokeLinecap="round">
      <path d="M3 8.5l3.5 3.5 6.5-8" />
    </svg>
  ),
  info: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--rpg-gold)" strokeWidth="2" strokeLinecap="round">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v4M8 11h.01" />
    </svg>
  ),
  warning: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#e67e22" strokeWidth="2" strokeLinecap="round">
      <path d="M8 2l6.5 12H1.5L8 2zM8 7v3M8 12h.01" />
    </svg>
  ),
};

interface Props {
  toast: NutriToastData | null;
}

export default function NutriToast({ toast }: Props) {
  const [visible, setVisible] = useState(false);
  const [current, setCurrent] = useState<NutriToastData | null>(null);

  useEffect(() => {
    if (!toast) return;
    setCurrent(toast);
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 2500);
    return () => clearTimeout(timer);
  }, [toast]);

  if (!current || !visible) return null;

  return (
    <div className={`nutri-toast nutri-toast--${current.type}`}>
      <span className="nutri-toast__icon">{ICONS[current.type]}</span>
      <span className="nutri-toast__message">{current.message}</span>
    </div>
  );
}
