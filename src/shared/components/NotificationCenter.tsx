import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import type { AppNotification } from '../../../shared/types';
import { useModalA11y } from '../hooks/useModalA11y';
import '../styles/notifications.css';

interface NotificationCenterProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (route: string) => void;
}

const MODULE_LABELS: Record<string, string> = {
  quests: 'Questify',
  nutrition: 'Nutrify',
  finance: 'Coinify',
};

function timeAgo(createdAt: string, t: (key: string, fallback: string, opts?: Record<string, unknown>) => string): string {
  const utcDate = createdAt.endsWith('Z') ? createdAt : createdAt + 'Z';
  const diff = Date.now() - new Date(utcDate).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return t('notifications.justNow', 'recién');
  if (minutes < 60) return t('notifications.minutesAgo', `hace ${minutes} min`, { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('notifications.hoursAgo', `hace ${hours}h`, { count: hours });
  const days = Math.floor(hours / 24);
  return t('notifications.daysAgo', `hace ${days}d`, { count: days });
}

export default function NotificationCenter({ open, onClose, onNavigate }: NotificationCenterProps) {
  const { t } = useTranslation();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const drawerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const loadNotifications = useCallback(async () => {
    try {
      await window.api.notificationsRunCheck();
      const all = await window.api.notificationsGetAll();
      setNotifications(all);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (open) loadNotifications();
  }, [open, loadNotifications]);

  useEffect(() => {
    const handler = () => { if (open) loadNotifications(); };
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
  }, [open, loadNotifications]);

  useGSAP(() => {
    if (!drawerRef.current || !overlayRef.current) return;
    if (open) {
      gsap.fromTo(overlayRef.current, { opacity: 0 }, { opacity: 1, duration: 0.2 });
      gsap.fromTo(drawerRef.current, { x: '100%' }, { x: '0%', duration: 0.3, ease: 'power2.out' });
    }
  }, [open]);

  const handleClose = useCallback(() => {
    if (!drawerRef.current || !overlayRef.current) { onClose(); return; }
    gsap.to(overlayRef.current, { opacity: 0, duration: 0.2 });
    gsap.to(drawerRef.current, { x: '100%', duration: 0.25, ease: 'power2.in', onComplete: onClose });
  }, [onClose]);

  const handleDismiss = useCallback(async (id: string) => {
    await window.api.notificationsDismiss(id);
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  /** Con 8 notificaciones habia que descartarlas de a una. */
  const handleDismissAll = useCallback(async () => {
    const ids = notifications.map(n => n.id);
    setNotifications([]);
    await Promise.all(ids.map(id => window.api.notificationsDismiss(id)));
  }, [notifications]);

  const handleSnooze = useCallback(async (id: string) => {
    await window.api.notificationsSnooze(id);
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const handleGo = useCallback((route: string) => {
    onNavigate(route);
    handleClose();
  }, [onNavigate, handleClose]);

  // Escape, focus trap, initial focus and focus restore.
  const { dialogProps } = useModalA11y<HTMLDivElement>({ onClose: handleClose, active: open });

  if (!open) return null;

  const grouped = notifications.reduce<Record<string, AppNotification[]>>((acc, n) => {
    (acc[n.module] ??= []).push(n);
    return acc;
  }, {});

  return (
    <>
      <div className="notif-overlay" ref={overlayRef} onClick={handleClose} />
      <div
        {...dialogProps}
        ref={(el) => {
          drawerRef.current = el;
          dialogProps.ref.current = el;
        }}
        aria-label={t('notifications.title', 'Notificaciones')}
        className="notif-drawer"
      >
        <div className="notif-drawer-header">
          <span>{t('notifications.title', 'Notificaciones')}</span>
          {/* La X va PRIMERA en el DOM a proposito: useModalA11y enfoca el primer
              elemento focusable, y "Descartar todas" borra todo sin confirmacion ni
              undo. El orden visual se recompone con flex-direction: row-reverse. */}
          <div className="notif-drawer-header-actions">
          <button className="notif-drawer-close" onClick={handleClose}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M2 2l8 8M10 2l-8 8"/></svg>
          </button>
            {notifications.length > 0 && (
              <button className="notif-dismiss-all" onClick={handleDismissAll}>
                {t('notifications.dismissAll', 'Descartar todas')}
              </button>
            )}
          </div>
        </div>

        <div className="notif-drawer-list">
          {notifications.length === 0 ? (
            <div className="notif-empty">
              <svg width="40" height="40" viewBox="0 0 16 16" fill="none"
                stroke="var(--gold-dark)" strokeWidth="1" strokeLinecap="round">
                <path d="M8 1a4 4 0 00-4 4v3l-1 2h10l-1-2V5a4 4 0 00-4-4z" />
                <path d="M6 12a2 2 0 004 0" />
                <path d="M4 4l8 8" />
              </svg>
              <div className="notif-empty-title">{t('notifications.allCaughtUp', 'Todo al día')}</div>
              <div className="notif-empty-desc">{t('notifications.allCaughtUpDesc', 'No tenés notificaciones pendientes.')}</div>
            </div>
          ) : (
            Object.entries(grouped).map(([mod, items]) => (
              <div key={mod} className="notif-module-group">
                <div className="notif-module-label">{MODULE_LABELS[mod] ?? mod}</div>
                {items.map(n => (
                  <div key={n.id} className="notif-item">
                    <div className="notif-item-title">{n.title}</div>
                    <div className="notif-item-body">{n.body}</div>
                    <div className="notif-item-time">{timeAgo(n.createdAt, t)}</div>
                    <div className="notif-item-actions">
                      <button className="notif-action-go" onClick={() => handleGo(n.actionRoute)}>
                        {t('notifications.go', 'Ir')}
                      </button>
                      <button onClick={() => handleSnooze(n.id)}>
                        {t('notifications.snooze', 'Silenciar 6h')}
                      </button>
                      <button onClick={() => handleDismiss(n.id)}>
                        {t('notifications.dismiss', 'Descartar')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
