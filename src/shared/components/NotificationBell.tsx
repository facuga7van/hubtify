import { useState, useEffect, useCallback, useRef } from 'react';

interface NotificationBellProps {
  onClick: () => void;
}

export default function NotificationBell({ onClick }: NotificationBellProps) {
  const [count, setCount] = useState(0);
  const prevCountRef = useRef(-1);
  const [pulse, setPulse] = useState(false);

  const refreshCount = useCallback(async () => {
    try {
      const c = await window.api.notificationsGetCount();
      setCount(c);
    } catch { /* ignore in case IPC not ready */ }
  }, []);

  // Detect count increase and trigger pulse (skip initial load via -1 sentinel)
  useEffect(() => {
    if (prevCountRef.current >= 0 && count > prevCountRef.current) {
      setPulse(true);
    }
    prevCountRef.current = count;
  }, [count]);

  // Remove pulse class after animation ends
  const handleAnimationEnd = useCallback(() => {
    setPulse(false);
  }, []);

  useEffect(() => {
    refreshCount();
    const interval = setInterval(refreshCount, 30000);
    return () => clearInterval(interval);
  }, [refreshCount]);

  // Listen for engine updates (via IPC from main process)
  useEffect(() => {
    const cleanup = window.api.onNotificationsUpdated?.(() => refreshCount());
    return () => { cleanup?.(); };
  }, [refreshCount]);

  // Listen for account:switched
  useEffect(() => {
    const handler = () => refreshCount();
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
  }, [refreshCount]);

  return (
    <button
      className={`notif-bell${pulse ? ' notif-bell--pulse' : ''}`}
      onClick={onClick}
      title="Notifications"
      onAnimationEnd={handleAnimationEnd}
    >
      <svg width="18" height="18" viewBox="0 0 16 16" fill="none"
        stroke="var(--gold)" strokeWidth="1.3" strokeLinecap="round">
        <path d="M8 1a4 4 0 00-4 4v3l-1 2h10l-1-2V5a4 4 0 00-4-4z" />
        <path d="M6 12a2 2 0 004 0" />
      </svg>
      {count > 0 && <span className="notif-bell-badge">{count > 9 ? '9+' : count}</span>}
    </button>
  );
}
