/**
 * Lado TS del plugin LOCAL de Android `ApkInstallerPlugin.java`
 * (android/app/src/main/java/com/hubtify/app/ApkInstallerPlugin.java). Patrón
 * estándar de Capacitor para plugins locales: `registerPlugin<T>(name)`
 * (capacitorjs.com/docs/plugins/android → "Custom Native Android Code").
 * Solo se importa desde AndroidUpdateBanner.tsx, que a su vez solo se carga
 * en build Android (ver el `lazy(() => import(...))` gateado por el literal
 * `__HUBTIFY_PLATFORM__ === 'android'` en Layout.tsx).
 */
import { registerPlugin } from '@capacitor/core';

export interface ApkInstallResult {
  /** true si Android bloqueó la instalación por falta del permiso de
   * "instalar apps desconocidas" — el plugin ya abrió los Ajustes del
   * sistema; hay que pedirle al usuario que vuelva a tocar «Instalar». */
  needsPermission: boolean;
}

export interface ApkCanInstallResult {
  allowed: boolean;
}

export interface ApkInstallerPlugin {
  install(options: { path: string }): Promise<ApkInstallResult>;
  canInstall(): Promise<ApkCanInstallResult>;
}

const ApkInstaller = registerPlugin<ApkInstallerPlugin>('ApkInstaller');

export default ApkInstaller;
