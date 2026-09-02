import { useState, useMemo, useRef, useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import PageHeader from '../shared/components/PageHeader';
import { useAuthContext } from '../shared/AuthContext';
import { syncPush, syncPull } from '../shared/sync';
import { useConfirm } from '../shared/components/ConfirmDialog';
import { useToast } from '../shared/components/useToast';
import { isSoundEnabled, setSoundEnabled as setGlobalSound } from '../shared/audio';
import { useTour } from '../shared/components/tour';
import { PAGE_ANIMATIONS_KEY } from '../shared/components/AnimatedOutlet';
import FeedbackDialog from './FeedbackDialog';
import UpdateSettings from './UpdateSettings';
import ChangelogModal from '../shared/components/ChangelogModal';
import { changelog } from '../shared/changelog';
import { SHORTCUTS } from '../shared/shortcuts';
import './styles/shell.css';

const LAST_PULL_KEY = 'hubtify_last_pull_at';

/* ── little building blocks ──────────────────────────────── */

function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-group">
      <h2 className="settings-group__title">{title}</h2>
      {children}
    </section>
  );
}

function SettingsCard({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="rpg-card settings-section">
      <div className="rpg-card-title">{icon}{title}</div>
      {children}
    </div>
  );
}

function Toggle({ on, onToggle, labels }: { on: boolean; onToggle: () => void; labels: [string, string] }) {
  return (
    <button className={`settings-toggle${on ? ' settings-toggle--on' : ''}`} onClick={onToggle} aria-pressed={on}>
      <span className="settings-toggle__thumb" />
      <span className="settings-toggle__text">{on ? labels[0] : labels[1]}</span>
    </button>
  );
}

const iconProps = {
  width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none',
  stroke: 'var(--gold-dark)', strokeWidth: 1.3, strokeLinecap: 'round' as const,
};

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const confirm = useConfirm();
  const { toast } = useToast();
  const { startTour } = useTour();
  const { user: authUser } = useAuthContext();
  const [fontScale, setFontScale] = useState(() => localStorage.getItem('hubtify_font_scale') || '1');
  const [updateMode, setUpdateMode] = useState(() => localStorage.getItem('hubtify_update_mode') || 'notify');
  const [soundEnabled, setSoundEnabled] = useState(() => isSoundEnabled());
  const [helpBubbles, setHelpBubbles] = useState(() => localStorage.getItem('hubtify_help_bubbles') !== 'false');
  const [pageAnimations, setPageAnimations] = useState(
    () => localStorage.getItem(PAGE_ANIMATIONS_KEY) !== 'false'
  );
  const [notifInApp, setNotifInApp] = useState(() => localStorage.getItem('hubtify_notifications_inapp') !== 'false');
  const [notifSystem, setNotifSystem] = useState(() => localStorage.getItem('hubtify_notifications_system') !== 'false');
  const [notifQuests, setNotifQuests] = useState(() => localStorage.getItem('hubtify_notifications_module_quests') !== 'false');
  const [notifNutrition, setNotifNutrition] = useState(() => localStorage.getItem('hubtify_notifications_module_nutrition') !== 'false');
  const [notifFinance, setNotifFinance] = useState(() => localStorage.getItem('hubtify_notifications_module_finance') !== 'false');
  const [notifCauldron, setNotifCauldron] = useState(() => localStorage.getItem('hubtify_notifications_module_cauldron') !== 'false');
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
  const [lastPullAt, setLastPullAt] = useState(() => localStorage.getItem(LAST_PULL_KEY));
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => { if (syncTimerRef.current) clearTimeout(syncTimerRef.current); };
  }, []);
  useEffect(() => {
    window.api.notificationsSetHabitReminder?.(habitReminderEnabledRef.current, habitReminderTimeRef.current);
  }, []);

  const toggleLabels: [string, string] = [t('settings.toggleOn'), t('settings.toggleOff')];

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

  const formatLastSync = (iso: string | null): string => {
    if (!iso) return t('settings.lastSyncNever', 'nunca');
    const ms = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(ms) || ms < 0) return t('settings.lastSyncNever', 'nunca');
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return t('dashboard.timeNow', 'ahora');
    if (mins < 60) return t('dashboard.timeMinutes', { n: mins, defaultValue: 'hace {{n}} min' });
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t('dashboard.timeHours', { n: hours, defaultValue: 'hace {{n}} h' });
    return t('dashboard.timeDays', { n: Math.floor(hours / 24), defaultValue: 'hace {{n}} d' });
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
    setLastPullAt(localStorage.getItem(LAST_PULL_KEY));
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => setSyncStatus(''), 3000);
  };

  /**
   * "Repetir onboarding" and "Reiniciar Tour" were two red buttons doing half a
   * job each — the first never cleared `hubtify_toured`, so it did NOT replay
   * the tour. One button now replays the whole introduction.
   */
  const replayIntro = async () => {
    const ok = await confirm({ message: t('settings.replayIntroConfirm', '¿Volver a ver la introducción y el tour guiado?') });
    if (!ok) return;
    localStorage.removeItem('hubtify_onboarded');
    localStorage.removeItem('hubtify_toured');
    window.location.reload();
  };

  /**
   * Used to run `localStorage.clear()` and reload — SQLite (quests, finance,
   * meals, RPG stats) was left completely untouched, and clearing
   * `hubtify_onboarded` sent the user back through onboarding believing they
   * had started fresh.
   */
  const resetAllData = async () => {
    const ok = await confirm({
      title: t('settings.resetAll'),
      message: t('settings.resetAllConfirmFull', 'Se borran para siempre tus misiones, finanzas, comidas y estadísticas de este dispositivo. Esto no se puede deshacer. ¿Continuar?'),
      confirmText: t('settings.deleteEverything', 'Borrar todo'),
      danger: true,
    });
    if (!ok) return;
    try {
      await window.api.syncClearUserData();
    } catch {
      toast({ message: t('common.somethingWentWrong', 'Algo salió mal'), type: 'warning' });
      return;
    }
    localStorage.clear();
    window.location.reload();
  };

  return (
    <div className="settings-page">
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />

      {/* ═══ APARIENCIA ═══════════════════════════════════ */}
      <SettingsGroup title={t('settings.groupAppearance', 'Apariencia')}>
        {/* Language + font size — two one-line button rows used to be two cards */}
        <SettingsCard
          title={t('settings.languageAndSize', 'Idioma y tamaño')}
          icon={<svg {...iconProps}><circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c-2 2-2 4-2 6s0 4 2 6M8 2c2 2 2 4 2 6s0 4-2 6"/></svg>}
        >
          <div className="settings-row settings-row--stack">
            <div className="settings-row__label">{t('settings.language')}</div>
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
          <div className="settings-row settings-row--stack settings-row--last">
            <div>
              <div className="settings-row__label">{t('settings.fontSize')}</div>
              <div className="settings-row__desc">{t('settings.fontSizeDesc')}</div>
            </div>
            <div className="settings-row__buttons">
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
        </SettingsCard>

        <SettingsCard
          title={t('settings.interface', 'Interfaz')}
          icon={<svg {...iconProps}><rect x="1.5" y="3" width="13" height="10" rx="1.5"/><path d="M1.5 6.5h13"/></svg>}
        >
          <div className="settings-row">
            <div>
              <div className="settings-row__label">{t('settings.pageAnimations', 'Animaciones de página')}</div>
              <div className="settings-row__desc">{t('settings.pageAnimationsDesc', 'La transición de pasar página al cambiar de módulo')}</div>
            </div>
            <Toggle
              on={pageAnimations}
              labels={toggleLabels}
              onToggle={() => {
                const next = !pageAnimations;
                setPageAnimations(next);
                localStorage.setItem(PAGE_ANIMATIONS_KEY, next ? 'true' : 'false');
              }}
            />
          </div>
          <div className="settings-row">
            <div>
              <div className="settings-row__label">{t('settings.helpBubblesLabel', 'Mostrar burbujas de ayuda')}</div>
              <div className="settings-row__desc">{t('settings.helpBubblesDesc', 'Íconos de ayuda con información sobre cada sección')}</div>
            </div>
            <Toggle
              on={helpBubbles}
              labels={toggleLabels}
              onToggle={() => {
                const next = !helpBubbles;
                setHelpBubbles(next);
                localStorage.setItem('hubtify_help_bubbles', next ? 'true' : 'false');
                window.dispatchEvent(new Event('helpBubbles:changed'));
              }}
            />
          </div>
          <div className="settings-row settings-row--last">
            <div>
              <div className="settings-row__label">{t('settings.soundEffects')}</div>
              <div className="settings-row__desc">{t('settings.soundDesc')}</div>
            </div>
            <Toggle on={soundEnabled} labels={toggleLabels} onToggle={toggleSound} />
          </div>
        </SettingsCard>
      </SettingsGroup>

      {/* ═══ NOTIFICACIONES ═══════════════════════════════ */}
      <SettingsGroup title={t('settings.notifications')}>
        <SettingsCard
          title={t('settings.notifications')}
          icon={<svg {...iconProps}><path d="M8 1a4 4 0 00-4 4v3l-1 2h10l-1-2V5a4 4 0 00-4-4zM6 12a2 2 0 004 0"/></svg>}
        >
          <div className="settings-row">
            <div>
              <div className="settings-row__label">{t('settings.notificationsInApp', 'Notificaciones en la app')}</div>
              <div className="settings-row__desc">{t('settings.notificationsInAppDesc', 'Centro de notificaciones con items pendientes')}</div>
            </div>
            <Toggle
              on={notifInApp}
              labels={toggleLabels}
              onToggle={() => {
                const next = !notifInApp;
                setNotifInApp(next);
                localStorage.setItem('hubtify_notifications_inapp', next ? 'true' : 'false');
                window.dispatchEvent(new Event('notifications:settingsChanged'));
              }}
            />
          </div>
          <div className="settings-row">
            <div>
              <div className="settings-row__label">{t('settings.notificationsSystem', 'Notificaciones del sistema')}</div>
              <div className="settings-row__desc">{t('settings.notificationsSystemDesc', 'Notificaciones nativas de Windows')}</div>
            </div>
            <Toggle
              on={notifSystem}
              labels={toggleLabels}
              onToggle={() => {
                const next = !notifSystem;
                setNotifSystem(next);
                localStorage.setItem('hubtify_notifications_system', next ? 'true' : 'false');
                window.api.notificationsSetSystemEnabled?.(next);
              }}
            />
          </div>

          <div className="settings-subhead">{t('settings.notifModules', 'Por módulo')}</div>
          {([
            { key: 'quests', state: notifQuests, setter: setNotifQuests, label: t('settings.notifQuests', 'Questify'), desc: t('settings.notifQuestsDesc', 'Tareas vencidas, atrasadas y estancadas') },
            { key: 'nutrition', state: notifNutrition, setter: setNotifNutrition, label: t('settings.notifNutrition', 'Nutrify'), desc: t('settings.notifNutritionDesc', 'Días sin cerrar, comidas sin registrar y peso semanal') },
            { key: 'finance', state: notifFinance, setter: setNotifFinance, label: t('settings.notifFinance', 'Coinify'), desc: t('settings.notifFinanceDesc', 'Cuotas por vencer, cierres de tarjeta y préstamos') },
            // The Cauldron had no toggle at all: its system notifications could
            // not be turned off.
            { key: 'cauldron', state: notifCauldron, setter: setNotifCauldron, label: t('settings.notifCauldron', 'Caldero'), desc: t('settings.notifCauldronDesc', 'Fin de sesión, descansos y sesiones interrumpidas') },
          ] as const).map(({ key, state, setter, label, desc }) => (
            <div className="settings-row" key={key}>
              <div>
                <div className="settings-row__label">{label}</div>
                <div className="settings-row__desc">{desc}</div>
              </div>
              <Toggle
                on={state}
                labels={toggleLabels}
                onToggle={() => {
                  const next = !state;
                  setter(next);
                  localStorage.setItem(`hubtify_notifications_module_${key}`, next ? 'true' : 'false');
                  window.api.notificationsSetModuleEnabled?.(key, next);
                }}
              />
            </div>
          ))}

          <div className="settings-subhead">{t('settings.habitReminder', 'Recordatorio de hábitos')}</div>
          <div className="settings-row settings-row--last">
            <div>
              <div className="settings-row__label">{t('settings.habitReminderLabel', 'Recordatorio diario')}</div>
              <div className="settings-row__desc">{t('settings.habitReminderDesc', 'Notificación si quedan hábitos sin marcar')}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {habitReminderEnabled && (
                <input
                  type="time"
                  value={habitReminderTime}
                  aria-label={t('settings.habitReminderLabel', 'Recordatorio diario')}
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
              <Toggle
                on={habitReminderEnabled}
                labels={toggleLabels}
                onToggle={() => {
                  const next = !habitReminderEnabled;
                  setHabitReminderEnabled(next);
                  localStorage.setItem('hubtify_habit_reminder_enabled', next ? 'true' : 'false');
                  window.api.notificationsSetHabitReminder?.(next, habitReminderTime);
                }}
              />
            </div>
          </div>
        </SettingsCard>
      </SettingsGroup>

      {/* ═══ DATOS Y CUENTA ═══════════════════════════════ */}
      {/* Preferencias de actualización (llegaron con la rama de upstream): el
          rediseño de esta página es de la auditoría UX, así que el componente
          se injerta como una tarjeta más en lugar de su bloque viejo. */}
      <UpdateSettings
        mode={updateMode}
        onChange={(m) => {
          setUpdateMode(m);
          localStorage.setItem('hubtify_update_mode', m);
          window.dispatchEvent(new Event('updateMode:changed'));
        }}
      />

      <SettingsGroup title={t('settings.groupData', 'Datos y cuenta')}>
        <SettingsCard
          title={t('settings.cloudSync')}
          icon={<svg {...iconProps}><path d="M4 12a4 4 0 01-.5-7.97A5.5 5.5 0 0114 6a4 4 0 01-1 7.9H4z"/></svg>}
        >
          {authUser ? (
            <div>
              <div className="settings-row">
                <div>
                  <div className="settings-row__label" title={authUser.email ?? undefined}>{authUser.email}</div>
                  <div className="settings-row__desc">
                    {t('settings.loggedIn')} {'·'} {t('settings.lastSync', 'Última sincronización')}: {formatLastSync(lastPullAt)}
                  </div>
                </div>
                {/* Signing out lives in the account menu only — this page used to
                    offer a second, differently worded button for it. */}
              </div>
              <div className="settings-row settings-row--stack">
                <div className="settings-row__desc">
                  {t('settings.uploadDataDesc', 'Subir datos: pisa la copia de la nube con lo que hay en este dispositivo.')}
                </div>
                <div className="settings-row__desc">
                  {t('settings.downloadDataDesc', 'Descargar datos: trae la copia de la nube y la fusiona con la local.')}
                </div>
                <div className="settings-row__buttons">
                  <button className="rpg-button" onClick={() => handleSync('push')} style={{ flex: 1 }}>
                    {t('settings.uploadData')}
                  </button>
                  <button className="rpg-button" onClick={() => handleSync('pull')} style={{ flex: 1 }}>
                    {t('settings.downloadData')}
                  </button>
                </div>
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
        </SettingsCard>

        <SettingsCard
          title={t('settings.backup')}
          icon={<svg {...iconProps}><path d="M2 10v3h12v-3M8 2v8M5 7l3 3 3-3"/></svg>}
        >
          <div className="settings-row settings-row--stack settings-row--last">
            <div className="settings-row__desc">
              {t('settings.backupDesc', 'Exportar guarda un archivo con toda tu base local. Importar la reemplaza por la del archivo.')}
            </div>
            <div className="settings-row__buttons">
              <button className="rpg-button" onClick={async () => {
                const result = await window.api.backupExport?.();
                if (!result) return;
                if (result.success) toast({ message: t('settings.exportSuccess'), type: 'success' });
                else if (!result.canceled) toast({ message: `${t('settings.exportFailed')}: ${result.error}`, type: 'warning' });
              }} style={{ flex: 1 }}>
                {t('settings.exportBackup')}
              </button>
              <button className="rpg-button" onClick={async () => {
                // Primero el archivo, despues la confirmacion: asi el usuario ve QUE
                // respaldo va a pisar sus datos antes de decidir.
                const picked = await window.api.backupPickImportFile?.();
                if (!picked || picked.canceled || !picked.path) return;
                const ok = await confirm({
                  title: t('settings.importBackup'),
                  message: t('settings.importConfirmFile', 'Importar «{{name}}» REEMPLAZA todos los datos actuales de este dispositivo. Esta acción no se puede deshacer.', { name: picked.name ?? '' }),
                  confirmText: t('settings.importBackup'),
                  danger: true,
                });
                if (!ok) return;
                const result = await window.api.backupImport?.(picked.path);
                if (!result) return;
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
        </SettingsCard>

        <div className="rpg-card settings-section settings-section--danger">
          <div className="rpg-card-title settings-danger-title">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--rubric)" strokeWidth="1.3" strokeLinecap="round">
              <path d="M8 1l7 13H1L8 1z"/><path d="M8 6v3M8 11h.01"/>
            </svg>
            {t('settings.dangerZone')}
          </div>
          <div className="settings-row settings-row--last">
            <div>
              <div className="settings-row__label">{t('settings.resetAll')}</div>
              <div className="settings-row__desc">{t('settings.resetAllDesc')}</div>
            </div>
            <button className="rpg-btn-sm settings-btn--danger" onClick={resetAllData}>
              {t('settings.deleteEverything', 'Borrar todo')}
            </button>
          </div>
        </div>
      </SettingsGroup>

      {/* ═══ AYUDA ════════════════════════════════════════ */}
      <SettingsGroup title={t('settings.groupHelp', 'Ayuda')}>
        <SettingsCard
          title={t('settings.shortcuts')}
          icon={<svg {...iconProps}><rect x="1" y="4" width="14" height="9" rx="2"/><path d="M4 7h1M7 7h2M11 7h1M4 10h8"/></svg>}
        >
          <div className="settings-shortcuts">
            {SHORTCUTS.map((s) => (
              <div key={s.keys} className="settings-shortcut">
                <span className="settings-shortcut__label">{t(s.i18nKey, s.fallback)}</span>
                <kbd className="settings-shortcut__key">{s.keys}</kbd>
              </div>
            ))}
          </div>
        </SettingsCard>

        <SettingsCard
          title={t('settings.guidedTour', 'Introducción y tour')}
          icon={<svg {...iconProps}><circle cx="8" cy="8" r="6"/><path d="M8 5.5v3M8 11h.01"/></svg>}
        >
          <div className="settings-row">
            <div>
              <div className="settings-row__label">{t('settings.restartTour', 'Reiniciar Tour')}</div>
              <div className="settings-row__desc">{t('settings.restartTourDesc', 'Reproducir el tour guiado de todos los módulos')}</div>
            </div>
            {/* Neutral, not red: replaying a tour destroys nothing. */}
            <button className="rpg-btn-sm" onClick={() => {
              localStorage.removeItem('hubtify_toured');
              startTour();
            }}>
              {t('settings.restartTour', 'Reiniciar Tour')}
            </button>
          </div>
          <div className="settings-row settings-row--last">
            <div>
              <div className="settings-row__label">{t('settings.replayIntro', 'Volver a ver la introducción')}</div>
              <div className="settings-row__desc">{t('settings.replayIntroDesc', 'Repite la configuración inicial y el tour guiado')}</div>
            </div>
            <button className="rpg-btn-sm" onClick={replayIntro}>
              {t('settings.replayIntro', 'Volver a ver la introducción')}
            </button>
          </div>
        </SettingsCard>

        <SettingsCard
          title={t('settings.feedback', 'Feedback')}
          icon={<svg {...iconProps}><path d="M2 13h12M4 9l2-6h4l2 6M5.5 9h5M3 13l1.5-4M13 13l-1.5-4"/></svg>}
        >
          <div className="settings-row settings-row--last">
            <div>
              <div className="settings-row__label">{t('settings.feedbackSendButton', 'Enviar Feedback')}</div>
              <div className="settings-row__desc">{t('settings.feedbackDesc', 'Envianos tu opinión, reportá bugs o sugerí features')}</div>
            </div>
            <button className="rpg-btn-sm" onClick={() => setFeedbackOpen(true)}>
              {t('settings.feedbackSendButton', 'Enviar Feedback')}
            </button>
          </div>
        </SettingsCard>

        <SettingsCard
          title={t('settings.about', 'Acerca de')}
          icon={<svg {...iconProps}><circle cx="8" cy="8" r="6"/><path d="M8 5v4M8 11h.01"/></svg>}
        >
          <div className="settings-row settings-row--last">
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
        </SettingsCard>
      </SettingsGroup>

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
