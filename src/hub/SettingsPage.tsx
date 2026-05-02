import { useState, useMemo, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import PageHeader from '../shared/components/PageHeader';
import { useAuthContext } from '../shared/AuthContext';
import { syncPush, syncPull } from '../shared/sync';
import { useConfirm } from '../shared/components/ConfirmDialog';
import { useToast } from '../shared/components/useToast';
import { isSoundEnabled, setSoundEnabled as setGlobalSound } from '../shared/audio';
import { useTour } from '../shared/components/tour';
import FeedbackDialog from './FeedbackDialog';
import ChangelogModal from '../shared/components/ChangelogModal';
import { changelog } from '../shared/changelog';

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const confirm = useConfirm();
  const { toast } = useToast();
  const { startTour } = useTour();
  const { user: authUser, logout } = useAuthContext();
  const [fontScale, setFontScale] = useState(() => localStorage.getItem('hubtify_font_scale') || '1');
  const [soundEnabled, setSoundEnabled] = useState(() => isSoundEnabled());
  const [helpBubbles, setHelpBubbles] = useState(() => localStorage.getItem('hubtify_help_bubbles') !== 'false');
  const [notifInApp, setNotifInApp] = useState(() => localStorage.getItem('hubtify_notifications_inapp') !== 'false');
  const [notifSystem, setNotifSystem] = useState(() => localStorage.getItem('hubtify_notifications_system') !== 'false');
  const [notifQuests, setNotifQuests] = useState(() => localStorage.getItem('hubtify_notifications_module_quests') !== 'false');
  const [notifNutrition, setNotifNutrition] = useState(() => localStorage.getItem('hubtify_notifications_module_nutrition') !== 'false');
  const [notifFinance, setNotifFinance] = useState(() => localStorage.getItem('hubtify_notifications_module_finance') !== 'false');
  const [habitReminderEnabled, setHabitReminderEnabled] = useState(
    () => localStorage.getItem('hubtify_habit_reminder_enabled') !== 'false'
  );
  const [habitReminderTime, setHabitReminderTime] = useState(
    () => localStorage.getItem('hubtify_habit_reminder_time') || '21:00'
  );
  const habitReminderEnabledRef = useRef(habitReminderEnabled);
  const habitReminderTimeRef = useRef(habitReminderTime);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [patchNotesOpen, setPatchNotesOpen] = useState(false);
  const currentVersionEntries = useMemo(() => {
    const match = changelog.filter(e => e.version === APP_VERSION);
    return match.length > 0 ? match : changelog.slice(0, 1);
  }, []);
  const [syncStatus, setSyncStatus] = useState('');
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => { if (syncTimerRef.current) clearTimeout(syncTimerRef.current); };
  }, []);
  useEffect(() => {
    window.api.notificationsSetHabitReminder?.(habitReminderEnabledRef.current, habitReminderTimeRef.current);
  }, []);

  const applyFontScale = (value: string) => {
    setFontScale(value);
    localStorage.setItem('hubtify_font_scale', value);
    document.documentElement.style.setProperty('--font-scale', value);
  };

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    setGlobalSound(next);
  };

  const changeLanguage = (lang: string) => {
    i18n.changeLanguage(lang);
    localStorage.setItem('hubtify_lang', lang);
  };

  const handleSync = async (direction: 'push' | 'pull') => {
    if (!authUser) return;
    setSyncStatus(t('common.loading'));
    try {
      const result = direction === 'push'
        ? await syncPush(authUser.uid)
        : await syncPull(authUser.uid);
      setSyncStatus(result.success ? t('auth.synced') : `${t('auth.syncFailed')}: ${result.error}`);
    } catch {
      setSyncStatus(t('auth.syncFailed'));
    }
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => setSyncStatus(''), 3000);
  };

  const resetOnboarding = async () => {
    const ok = await confirm({ message: t('settings.resetOnboardingConfirm') });
    if (ok) {
      localStorage.removeItem('hubtify_onboarded');
      window.location.reload();
    }
  };

  const resetAllData = async () => {
    const ok1 = await confirm({ message: t('settings.resetAllConfirm'), danger: true });
    if (ok1) {
      const ok2 = await confirm({ message: t('settings.resetAllConfirm2'), danger: true });
      if (ok2) {
        localStorage.clear();
        window.location.reload();
      }
    }
  };

  return (
    <div className="settings-page">
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />

      {/* About */}
      <div className="rpg-card settings-section">
        <div className="rpg-card-title">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--gold-dark)" strokeWidth="1.3" strokeLinecap="round">
            <circle cx="8" cy="8" r="6"/><path d="M8 5v4M8 11h.01"/>
          </svg>
          {t('settings.about', 'Acerca de')}
        </div>
        <div className="settings-row">
          <div>
            <div className="settings-row__label">Hubtify v{APP_VERSION}</div>
            <div className="settings-row__desc">{t('settings.aboutDesc', 'Tu hub de vida gamificado')}</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="rpg-btn-sm" onClick={() => setChangelogOpen(true)}>
              {t('settings.changelog', 'Changelog')}
            </button>
            <button className="rpg-btn-sm" onClick={() => setPatchNotesOpen(true)}>
              {t('settings.patchNotes', 'Notas del Parche')}
            </button>
          </div>
        </div>
      </div>

      {/* Language */}
      <div className="rpg-card settings-section">
        <div className="rpg-card-title">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--gold-dark)" strokeWidth="1.3" strokeLinecap="round">
            <circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c-2 2-2 4-2 6s0 4 2 6M8 2c2 2 2 4 2 6s0 4-2 6"/>
          </svg>
          {t('settings.language')}
        </div>
        <div className="settings-row__buttons">
          <button className={`rpg-button${i18n.language === 'es' ? '' : ' settings-btn--dim'}`}
            onClick={() => changeLanguage('es')} style={{ flex: 1 }}>
            {t('settings.languageEs')}
          </button>
          <button className={`rpg-button${i18n.language === 'en' ? '' : ' settings-btn--dim'}`}
            onClick={() => changeLanguage('en')} style={{ flex: 1 }}>
            {t('settings.languageEn')}
          </button>
        </div>
      </div>

      {/* Font Size */}
      <div className="rpg-card settings-section">
        <div className="rpg-card-title">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--gold-dark)" strokeWidth="1.3" strokeLinecap="round">
            <path d="M3 12h10M5 8h6M7 4h2"/>
          </svg>
          {t('settings.fontSize')}
        </div>
        <div className="settings-row">
          <div>
            <div className="settings-row__label">{t('settings.fontSize')}</div>
            <div className="settings-row__desc">{t('settings.fontSizeDesc')}</div>
          </div>
        </div>
        <div className="settings-row__buttons" style={{ marginTop: 8 }}>
          {([
            ['0.85', t('settings.fontCompact')],
            ['1', t('settings.fontNormal')],
            ['1.15', t('settings.fontLarge')],
            ['1.3', t('settings.fontXLarge')],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              className={`rpg-button${fontScale === value ? '' : ' settings-btn--dim'}`}
              onClick={() => applyFontScale(value)}
              style={{ flex: 1 }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Sound */}
      <div className="rpg-card settings-section">
        <div className="rpg-card-title">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--gold-dark)" strokeWidth="1.3" strokeLinecap="round">
            <path d="M3 6h2l3-3v10l-3-3H3V6z"/>{soundEnabled && <><path d="M11 5a3 3 0 010 6"/><path d="M13 3a6 6 0 010 10"/></>}
          </svg>
          {t('settings.sound')}
        </div>
        <div className="settings-row">
          <div>
            <div className="settings-row__label">{t('settings.soundEffects')}</div>
            <div className="settings-row__desc">{t('settings.soundDesc')}</div>
          </div>
          <button className={`settings-toggle${soundEnabled ? ' settings-toggle--on' : ''}`} onClick={toggleSound}>
            <span className="settings-toggle__thumb" />
            <span className="settings-toggle__text">{soundEnabled ? t('settings.toggleOn') : t('settings.toggleOff')}</span>
          </button>
        </div>
      </div>

      {/* Help Bubbles */}
      <div className="rpg-card settings-section">
        <div className="rpg-card-title">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--gold-dark)" strokeWidth="1.3" strokeLinecap="round">
            <circle cx="8" cy="8" r="6"/><path d="M6 6a2 2 0 013.5 1.5c0 1-1.5 1-1.5 2.5M8 12h.01"/>
          </svg>
          {t('settings.helpBubbles', 'Burbujas de ayuda')}
        </div>
        <div className="settings-row">
          <div>
            <div className="settings-row__label">{t('settings.helpBubblesLabel', 'Mostrar burbujas de ayuda')}</div>
            <div className="settings-row__desc">{t('settings.helpBubblesDesc', 'Íconos de ayuda con información sobre cada sección')}</div>
          </div>
          <button className={`settings-toggle${helpBubbles ? ' settings-toggle--on' : ''}`} onClick={() => {
            const next = !helpBubbles;
            setHelpBubbles(next);
            localStorage.setItem('hubtify_help_bubbles', next ? 'true' : 'false');
            window.dispatchEvent(new Event('helpBubbles:changed'));
          }}>
            <span className="settings-toggle__thumb" />
            <span className="settings-toggle__text">{helpBubbles ? t('settings.toggleOn') : t('settings.toggleOff')}</span>
          </button>
        </div>
      </div>

      {/* Notifications */}
      <div className="rpg-card settings-section">
        <div className="rpg-card-title">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--gold-dark)" strokeWidth="1.3" strokeLinecap="round">
            <path d="M8 1a4 4 0 00-4 4v3l-1 2h10l-1-2V5a4 4 0 00-4-4zM6 12a2 2 0 004 0"/>
          </svg>
          {t('settings.notifications')}
        </div>
        <div className="settings-row">
          <div>
            <div className="settings-row__label">{t('settings.notificationsInApp', 'Notificaciones en la app')}</div>
            <div className="settings-row__desc">{t('settings.notificationsInAppDesc', 'Centro de notificaciones con items pendientes')}</div>
          </div>
          <button className={`settings-toggle${notifInApp ? ' settings-toggle--on' : ''}`} onClick={() => {
            const next = !notifInApp;
            setNotifInApp(next);
            localStorage.setItem('hubtify_notifications_inapp', next ? 'true' : 'false');
            window.dispatchEvent(new Event('notifications:settingsChanged'));
          }}>
            <span className="settings-toggle__thumb" />
            <span className="settings-toggle__text">{notifInApp ? t('settings.toggleOn') : t('settings.toggleOff')}</span>
          </button>
        </div>
        <div className="settings-row">
          <div>
            <div className="settings-row__label">{t('settings.notificationsSystem', 'Notificaciones del sistema')}</div>
            <div className="settings-row__desc">{t('settings.notificationsSystemDesc', 'Notificaciones nativas de Windows')}</div>
          </div>
          <button className={`settings-toggle${notifSystem ? ' settings-toggle--on' : ''}`} onClick={() => {
            const next = !notifSystem;
            setNotifSystem(next);
            localStorage.setItem('hubtify_notifications_system', next ? 'true' : 'false');
            window.api.notificationsSetSystemEnabled?.(next);
          }}>
            <span className="settings-toggle__thumb" />
            <span className="settings-toggle__text">{notifSystem ? t('settings.toggleOn') : t('settings.toggleOff')}</span>
          </button>
        </div>
        <div className="settings-row__separator" style={{ borderTop: '1px solid rgba(212,160,23,0.15)', margin: '8px 0', paddingTop: 8 }}>
          <div className="settings-row__label" style={{ fontSize: 'var(--fs-label)', opacity: 0.75, marginBottom: 6 }}>{t('settings.notifModules', 'Por módulo')}</div>
        </div>
        {([
          { key: 'quests', state: notifQuests, setter: setNotifQuests, label: t('settings.notifQuests', 'Questify'), desc: t('settings.notifQuestsDesc', 'Tareas vencidas, atrasadas y estancadas') },
          { key: 'nutrition', state: notifNutrition, setter: setNotifNutrition, label: t('settings.notifNutrition', 'Nutrify'), desc: t('settings.notifNutritionDesc', 'Días sin cerrar, comidas sin registrar y peso semanal') },
          { key: 'finance', state: notifFinance, setter: setNotifFinance, label: t('settings.notifFinance', 'Coinify'), desc: t('settings.notifFinanceDesc', 'Cuotas por vencer, cierres de tarjeta y préstamos') },
        ] as const).map(({ key, state, setter, label, desc }) => (
          <div className="settings-row" key={key}>
            <div>
              <div className="settings-row__label">{label}</div>
              <div className="settings-row__desc">{desc}</div>
            </div>
            <button className={`settings-toggle${state ? ' settings-toggle--on' : ''}`} onClick={() => {
              const next = !state;
              setter(next);
              localStorage.setItem(`hubtify_notifications_module_${key}`, next ? 'true' : 'false');
              window.api.notificationsSetModuleEnabled?.(key, next);
            }}>
              <span className="settings-toggle__thumb" />
              <span className="settings-toggle__text">{state ? t('settings.toggleOn') : t('settings.toggleOff')}</span>
            </button>
          </div>
        ))}
        {/* Habit reminder */}
        <div className="settings-row__separator" style={{ borderTop: '1px solid rgba(212,160,23,0.15)', margin: '8px 0', paddingTop: 8 }}>
          <div className="settings-row__label" style={{ fontSize: 'var(--fs-label)', opacity: 0.75, marginBottom: 6 }}>
            {t('settings.habitReminder', 'Recordatorio de hábitos')}
          </div>
        </div>
        <div className="settings-row">
          <div>
            <div className="settings-row__label">{t('settings.habitReminderLabel', 'Recordatorio diario')}</div>
            <div className="settings-row__desc">{t('settings.habitReminderDesc', 'Notificación si quedan hábitos sin marcar')}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {habitReminderEnabled && (
              <input
                type="time"
                value={habitReminderTime}
                onChange={(e) => {
                  const next = e.target.value;
                  setHabitReminderTime(next);
                  localStorage.setItem('hubtify_habit_reminder_time', next);
                  window.api.notificationsSetHabitReminder?.(habitReminderEnabled, next);
                }}
                className="rpg-input"
                style={{ width: 100, fontSize: 'var(--fs-label)' }}
              />
            )}
            <button
              className={`settings-toggle${habitReminderEnabled ? ' settings-toggle--on' : ''}`}
              onClick={() => {
                const next = !habitReminderEnabled;
                setHabitReminderEnabled(next);
                localStorage.setItem('hubtify_habit_reminder_enabled', next ? 'true' : 'false');
                window.api.notificationsSetHabitReminder?.(next, habitReminderTime);
              }}
            >
              <span className="settings-toggle__thumb" />
              <span className="settings-toggle__text">
                {habitReminderEnabled ? t('settings.toggleOn') : t('settings.toggleOff')}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Cloud Sync */}
      <div className="rpg-card settings-section">
        <div className="rpg-card-title">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--gold-dark)" strokeWidth="1.3" strokeLinecap="round">
            <path d="M4 12a4 4 0 01-.5-7.97A5.5 5.5 0 0114 6a4 4 0 01-1 7.9H4z"/>
          </svg>
          {t('settings.cloudSync')}
        </div>
        {authUser ? (
          <div>
            <div className="settings-row">
              <div>
                <div className="settings-row__label">{authUser.email}</div>
                <div className="settings-row__desc">{t('settings.loggedIn')}</div>
              </div>
              <button className="rpg-btn-sm" onClick={() => logout()}>
                {t('auth.logout')}
              </button>
            </div>
            <div className="settings-row__buttons" style={{ marginTop: 12 }}>
              <button className="rpg-button" onClick={() => handleSync('push')} style={{ flex: 1 }}>
                {t('settings.uploadData')}
              </button>
              <button className="rpg-button" onClick={() => handleSync('pull')} style={{ flex: 1 }}>
                {t('settings.downloadData')}
              </button>
            </div>
            {syncStatus && (
              <p className={`settings-sync-status${syncStatus.includes('fail') || syncStatus.includes('Fall') ? ' settings-sync-status--error' : ''}`}>
                {syncStatus}
              </p>
            )}
          </div>
        ) : (
          <div className="settings-empty">
            <p className="settings-empty__text">{t('settings.notLoggedIn')}</p>
            <a href="#/login" className="rpg-button" style={{ textDecoration: 'none', display: 'inline-block' }}>
              {t('auth.loginRequired')}
            </a>
          </div>
        )}
      </div>

      {/* Backup */}
      <div className="rpg-card settings-section">
        <div className="rpg-card-title">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--gold-dark)" strokeWidth="1.3" strokeLinecap="round">
            <path d="M2 10v3h12v-3M8 2v8M5 7l3 3 3-3"/>
          </svg>
          {t('settings.backup')}
        </div>
        <div className="settings-row__buttons">
          <button className="rpg-button" onClick={async () => {
            const result = await window.api.backupExport();
            if (result.success) toast({ message: t('settings.exportSuccess'), type: 'success' });
            else if (!result.canceled) toast({ message: `${t('settings.exportFailed')}: ${result.error}`, type: 'warning' });
          }} style={{ flex: 1 }}>
            {t('settings.exportBackup')}
          </button>
          <button className="rpg-button" onClick={async () => {
            const ok = await confirm({ message: t('settings.importConfirm') });
            if (!ok) return;
            const result = await window.api.backupImport();
            if (result.success) {
              toast({ message: t('settings.importSuccess'), type: 'success' });
              window.location.reload();
            } else if (!result.canceled) {
              toast({ message: `${t('settings.importFailed')}: ${result.error}`, type: 'warning' });
            }
          }} style={{ flex: 1 }}>
            {t('settings.importBackup')}
          </button>
        </div>
      </div>

      {/* Keyboard Shortcuts */}
      <div className="rpg-card settings-section">
        <div className="rpg-card-title">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--gold-dark)" strokeWidth="1.3" strokeLinecap="round">
            <rect x="1" y="4" width="14" height="9" rx="2"/><path d="M4 7h1M7 7h2M11 7h1M4 10h8"/>
          </svg>
          {t('settings.shortcuts')}
        </div>
        <div className="settings-shortcuts">
          {[
            ['Ctrl+1', t('nav.home')],
            ['Ctrl+2', 'Questify'],
            ['Ctrl+3', 'Nutrify'],
            ['Ctrl+4', 'Coinify'],
            ['Ctrl+5', t('nav.character')],
            ['Ctrl+6', t('nav.cauldron')],
            ['Ctrl+,', t('nav.settings')],
          ].map(([key, label]) => (
            <div key={key} className="settings-shortcut">
              <span className="settings-shortcut__label">{label}</span>
              <kbd className="settings-shortcut__key">{key}</kbd>
            </div>
          ))}
        </div>
      </div>

      {/* Feedback */}
      <div className="rpg-card settings-section">
        <div className="rpg-card-title">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--gold-dark)" strokeWidth="1.3" strokeLinecap="round">
            <path d="M2 13h12M4 9l2-6h4l2 6M5.5 9h5M3 13l1.5-4M13 13l-1.5-4"/>
          </svg>
          {t('settings.feedback', 'Feedback')}
        </div>
        <div className="settings-row">
          <div>
            <div className="settings-row__label">{t('settings.feedbackSendButton', 'Enviar Feedback')}</div>
            <div className="settings-row__desc">{t('settings.feedbackDesc', 'Envianos tu opinión, reportá bugs o sugerí features')}</div>
          </div>
          <button className="rpg-btn-sm" onClick={() => setFeedbackOpen(true)}>
            {t('settings.feedbackSendButton', 'Enviar Feedback')}
          </button>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="rpg-card settings-section settings-section--danger">
        <div className="rpg-card-title settings-danger-title">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--rubric)" strokeWidth="1.3" strokeLinecap="round">
            <path d="M8 1l7 13H1L8 1z"/><path d="M8 6v3M8 11h.01"/>
          </svg>
          {t('settings.dangerZone')}
        </div>
        <div className="settings-row">
          <div>
            <div className="settings-row__label">{t('settings.resetOnboarding')}</div>
            <div className="settings-row__desc">{t('settings.resetOnboardingDesc')}</div>
          </div>
          <button className="rpg-btn-sm settings-btn--danger" onClick={resetOnboarding}>
            {t('settings.reset')}
          </button>
        </div>
        <div className="settings-row">
          <div>
            <div className="settings-row__label">{t('settings.restartTour', 'Reiniciar Tour')}</div>
            <div className="settings-row__desc">{t('settings.restartTourDesc', 'Reproducir el tour guiado de todos los módulos')}</div>
          </div>
          <button className="rpg-btn-sm settings-btn--danger" onClick={() => {
            localStorage.removeItem('hubtify_toured');
            startTour();
          }}>
            {t('settings.reset')}
          </button>
        </div>
        <div className="settings-row settings-row--last">
          <div>
            <div className="settings-row__label">{t('settings.resetAll')}</div>
            <div className="settings-row__desc">{t('settings.resetAllDesc')}</div>
          </div>
          <button className="rpg-btn-sm settings-btn--danger" onClick={resetAllData}>
            {t('settings.reset')}
          </button>
        </div>
      </div>

      <FeedbackDialog
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        onSent={() => {
          setFeedbackOpen(false);
          toast({ message: t('settings.feedbackSent', '¡Feedback enviado!'), type: 'success' });
        }}
      />
      <ChangelogModal open={changelogOpen} onClose={() => setChangelogOpen(false)} />
      <ChangelogModal
        open={patchNotesOpen}
        onClose={() => setPatchNotesOpen(false)}
        title={t('settings.patchNotes', 'Notas del Parche')}
        entries={currentVersionEntries}
      />
    </div>
  );
}
