import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import PageHeader from '../shared/components/PageHeader';

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem('hubtify_sound') !== 'false');
  const [authUser, setAuthUser] = useState<{ uid: string; email: string | null } | null>(null);
  const [syncStatus, setSyncStatus] = useState('');

  useEffect(() => {
    window.api.authGetUser().then((u) => setAuthUser(u)).catch(console.error);
  }, []);

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    localStorage.setItem('hubtify_sound', next ? 'true' : 'false');
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
        ? await window.api.syncPush(authUser.uid)
        : await window.api.syncPull(authUser.uid);
      setSyncStatus(result.success ? t('auth.synced') : `${t('auth.syncFailed')}: ${result.error}`);
    } catch {
      setSyncStatus(t('auth.syncFailed'));
    }
    setTimeout(() => setSyncStatus(''), 3000);
  };

  const resetOnboarding = () => {
    if (window.confirm(t('settings.resetOnboardingConfirm'))) {
      localStorage.removeItem('hubtify_onboarded');
      window.location.reload();
    }
  };

  const resetAllData = () => {
    if (window.confirm(t('settings.resetAllConfirm'))) {
      if (window.confirm(t('settings.resetAllConfirm2'))) {
        localStorage.clear();
        window.location.reload();
      }
    }
  };

  const sectionStyle = { marginBottom: 24 };
  const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 0', borderBottom: '1px solid var(--rpg-parchment-dark)',
  };
  const labelStyle: React.CSSProperties = { fontSize: '0.95rem' };
  const descStyle: React.CSSProperties = { fontSize: '0.8rem', opacity: 0.5, marginTop: 2 };

  return (
    <div>
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />

      {/* Language */}
      <div className="rpg-card" style={sectionStyle}>
        <div className="rpg-card-title">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--rpg-gold-dark)" strokeWidth="1.3" strokeLinecap="round">
            <circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c-2 2-2 4-2 6s0 4 2 6M8 2c2 2 2 4 2 6s0 4-2 6"/>
          </svg>
          {t('settings.language')}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="rpg-button" onClick={() => changeLanguage('es')}
            style={{ opacity: i18n.language === 'es' ? 1 : 0.5, flex: 1 }}>
            Español
          </button>
          <button className="rpg-button" onClick={() => changeLanguage('en')}
            style={{ opacity: i18n.language === 'en' ? 1 : 0.5, flex: 1 }}>
            English
          </button>
        </div>
      </div>

      {/* Sound */}
      <div className="rpg-card" style={sectionStyle}>
        <div className="rpg-card-title">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--rpg-gold-dark)" strokeWidth="1.3" strokeLinecap="round">
            <path d="M3 6h2l3-3v10l-3-3H3V6z"/>{soundEnabled && <><path d="M11 5a3 3 0 010 6"/><path d="M13 3a6 6 0 010 10"/></>}
          </svg>
          {t('settings.sound')}
        </div>
        <div style={rowStyle}>
          <div>
            <div style={labelStyle}>{t('settings.soundEffects')}</div>
            <div style={descStyle}>{t('settings.soundDesc')}</div>
          </div>
          <button className="rpg-button" onClick={toggleSound}
            style={{ minWidth: 60 }}>
            {soundEnabled ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      {/* Cloud Sync */}
      <div className="rpg-card" style={sectionStyle}>
        <div className="rpg-card-title">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--rpg-gold-dark)" strokeWidth="1.3" strokeLinecap="round">
            <path d="M4 12a4 4 0 01-.5-7.97A5.5 5.5 0 0114 6a4 4 0 01-1 7.9H4z"/>
          </svg>
          {t('settings.cloudSync')}
        </div>
        {authUser ? (
          <div>
            <div style={rowStyle}>
              <div>
                <div style={labelStyle}>{authUser.email}</div>
                <div style={descStyle}>{t('settings.loggedIn')}</div>
              </div>
              <button className="rpg-button" onClick={() => window.api.authLogout().then(() => setAuthUser(null))}
                style={{ fontSize: '0.8rem' }}>
                {t('auth.logout')}
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="rpg-button" onClick={() => handleSync('push')} style={{ flex: 1 }}>
                {t('settings.uploadData')}
              </button>
              <button className="rpg-button" onClick={() => handleSync('pull')} style={{ flex: 1 }}>
                {t('settings.downloadData')}
              </button>
            </div>
            {syncStatus && (
              <p style={{ fontSize: '0.85rem', marginTop: 8, textAlign: 'center',
                color: syncStatus.includes('fail') || syncStatus.includes('Fall') ? 'var(--rpg-hp-red)' : 'var(--rpg-xp-green)' }}>
                {syncStatus}
              </p>
            )}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: 12 }}>
            <p style={{ fontSize: '0.9rem', opacity: 0.7, marginBottom: 12 }}>{t('settings.notLoggedIn')}</p>
            <a href="#/login" className="rpg-button" style={{ textDecoration: 'none', display: 'inline-block' }}>
              {t('auth.loginForSync')}
            </a>
          </div>
        )}
      </div>

      {/* Backup */}
      <div className="rpg-card" style={sectionStyle}>
        <div className="rpg-card-title">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--rpg-gold-dark)" strokeWidth="1.3" strokeLinecap="round">
            <path d="M2 10v3h12v-3M8 2v8M5 7l3 3 3-3"/>
          </svg>
          {t('settings.backup')}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="rpg-button" onClick={async () => {
            const result = await window.api.backupExport();
            if (result.success) alert(t('settings.exportSuccess'));
            else if (!result.canceled) alert(`${t('settings.exportFailed')}: ${result.error}`);
          }} style={{ flex: 1 }}>
            {t('settings.exportBackup')}
          </button>
          <button className="rpg-button" onClick={async () => {
            if (!window.confirm(t('settings.importConfirm'))) return;
            const result = await window.api.backupImport();
            if (result.success) {
              alert(t('settings.importSuccess'));
              window.location.reload();
            } else if (!result.canceled) {
              alert(`${t('settings.importFailed')}: ${result.error}`);
            }
          }} style={{ flex: 1 }}>
            {t('settings.importBackup')}
          </button>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="rpg-card" style={{ borderColor: 'var(--rpg-hp-red)' }}>
        <div className="rpg-card-title" style={{ color: 'var(--rpg-hp-red)' }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--rpg-hp-red)" strokeWidth="1.3" strokeLinecap="round">
            <path d="M8 1l7 13H1L8 1z"/><path d="M8 6v3M8 11h.01"/>
          </svg>
          {t('settings.dangerZone')}
        </div>
        <div style={rowStyle}>
          <div>
            <div style={labelStyle}>{t('settings.resetOnboarding')}</div>
            <div style={descStyle}>{t('settings.resetOnboardingDesc')}</div>
          </div>
          <button className="rpg-button" onClick={resetOnboarding}
            style={{ background: 'var(--rpg-hp-red)', fontSize: '0.8rem' }}>
            {t('settings.reset')}
          </button>
        </div>
        <div style={{ ...rowStyle, borderBottom: 'none' }}>
          <div>
            <div style={labelStyle}>{t('settings.resetAll')}</div>
            <div style={descStyle}>{t('settings.resetAllDesc')}</div>
          </div>
          <button className="rpg-button" onClick={resetAllData}
            style={{ background: 'var(--rpg-hp-red)', fontSize: '0.8rem' }}>
            {t('settings.reset')}
          </button>
        </div>
      </div>
    </div>
  );
}
