/**
 * Los dos botones de «Respaldo» de Ajustes en Android (spec §6, fila backup).
 * Mismo flujo que los de Electron (SettingsPage): primero el archivo, después
 * la confirmación, así el usuario ve QUÉ va a pisar sus datos.
 */
import { useTranslation } from 'react-i18next';
import { useConfirm } from '../shared/components/ConfirmDialog';
import { useToast } from '../shared/components/useToast';
import { mobileBackup } from './backup';

export default function MobileBackupButtons() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const { toast } = useToast();

  const handleExport = async () => {
    const result = await mobileBackup().exportDb();
    if (result.success) toast({ message: t('settings.exportSuccess', 'Respaldo exportado correctamente'), type: 'success' });
    else if (!result.canceled) toast({ message: `${t('settings.exportFailed', 'Error al exportar')}: ${result.error}`, type: 'warning' });
  };

  const handleImport = async () => {
    const picked = await mobileBackup().pickDbFile();
    if (!picked) return;
    const ok = await confirm({
      title: t('settings.importDb', 'Importar base de datos'),
      message: t('settings.importDbConfirm', 'Importar «{{name}}» REEMPLAZA todos los datos de este teléfono y reinicia la app. Esta acción no se puede deshacer.', { name: picked.name }),
      confirmText: t('settings.importDb', 'Importar base de datos'),
      danger: true,
    });
    if (!ok) return;
    const result = await mobileBackup().importDb(picked.bytes);
    if (result.success) {
      // La DB quedó suspendida en el worker: nada funciona hasta recargar.
      window.location.reload();
      return;
    }
    toast({
      type: 'warning',
      message: result.error === 'not_sqlite'
        ? t('settings.importDbNotSqlite', 'Ese archivo no es una base de datos de Hubtify (.db).')
        : `${t('settings.importFailed', 'Error al importar')}: ${result.error}`,
    });
  };

  return (
    <div className="settings-row__buttons">
      <button className="rpg-button" onClick={handleExport} style={{ flex: 1 }}>
        {t('settings.exportDb', 'Exportar base de datos')}
      </button>
      <button className="rpg-button" onClick={handleImport} style={{ flex: 1 }}>
        {t('settings.importDb', 'Importar base de datos')}
      </button>
    </div>
  );
}
