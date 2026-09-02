import { useTranslation } from 'react-i18next';

interface Props {
  mode: string;
  onChange: (mode: string) => void;
}

/**
 * Settings section that controls how updates are delivered:
 * 'auto' (download in background), 'notify' (announce, user downloads),
 * 'off' (don't check). Presentational — SettingsPage owns persistence.
 */
export default function UpdateSettings({ mode, onChange }: Props) {
  const { t } = useTranslation();

  return (
    <div className="rpg-card settings-section">
      <div className="rpg-card-title">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--gold-dark)" strokeWidth="1.3" strokeLinecap="round">
          <path d="M8 2v8M5 7l3 3 3-3M3 13h10" />
        </svg>
        {t('settings.updates', 'Actualizaciones')}
      </div>
      <div className="settings-row">
        <div>
          <div className="settings-row__label">{t('settings.updateMode', 'Modo de actualización')}</div>
          <div className="settings-row__desc">{t('settings.updateModeDesc', 'Cómo querés recibir las nuevas versiones')}</div>
        </div>
      </div>
      <div className="settings-row__buttons" style={{ marginTop: 8 }}>
        {([
          ['auto', t('settings.updateAuto', 'Automático')],
          ['notify', t('settings.updateNotify', 'Avisar')],
          ['off', t('settings.updateOff', 'Manual')],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            className={`rpg-button${mode === value ? '' : ' settings-btn--dim'}`}
            onClick={() => onChange(value)}
            style={{ flex: 1 }}
          >
            {label}
          </button>
        ))}
      </div>
      {/* Esta línea es la que EXPLICA qué hace el modo elegido, y venía con un
          `opacity: .7` inline encima de un color ya apagado (--ink-faded):
          3.71:1, por debajo de AA. Sin la opacidad son 4.86:1. */}
      <div className="settings-row__desc" style={{ marginTop: 8 }}>
        {mode === 'auto' && t('settings.updateAutoDesc', 'Descarga las nuevas versiones en segundo plano y te avisa cuando están listas para instalar')}
        {mode === 'notify' && t('settings.updateNotifyDesc', 'Te avisa cuando hay una nueva versión y vos elegís cuándo descargar')}
        {mode === 'off' && t('settings.updateOffDesc', 'No busca actualizaciones automáticamente')}
      </div>
    </div>
  );
}
