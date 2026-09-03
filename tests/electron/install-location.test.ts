import { describe, it, expect } from 'vitest';
import { checkInstallLocation, installRootOf } from '../../electron/install-location';

const LOCAL_APP_DATA = 'C:\\Users\\Facu\\AppData\\Local';

/** Instalación sana de Squirrel: stub en la raíz, exe versionado un nivel abajo. */
const packagedWin = (execPath: string) => ({
  execPath,
  localAppData: LOCAL_APP_DATA,
  platform: 'win32',
  isPackaged: true,
});

describe('installRootOf', () => {
  it('sube un nivel cuando el exe vive en app-X.Y.Z', () => {
    expect(installRootOf('C:\\Users\\Facu\\AppData\\Local\\Hubtify\\app-0.9.4\\Hubtify.exe'))
      .toBe('C:\\Users\\Facu\\AppData\\Local\\Hubtify');
  });

  it('devuelve el directorio del stub tal cual', () => {
    expect(installRootOf('C:\\Users\\Facu\\AppData\\Local\\Hubtify\\Hubtify.exe'))
      .toBe('C:\\Users\\Facu\\AppData\\Local\\Hubtify');
  });

  it('normaliza barras mixtas', () => {
    expect(installRootOf('C:/Users/Facu/AppData/Local/Hubtify/app-1.0.0/Hubtify.exe'))
      .toBe('C:\\Users\\Facu\\AppData\\Local\\Hubtify');
  });
});

describe('checkInstallLocation', () => {
  it('no avisa desde %LOCALAPPDATA%\\Hubtify\\app-X.Y.Z (instalación normal)', () => {
    const res = checkInstallLocation(packagedWin('C:\\Users\\Facu\\AppData\\Local\\Hubtify\\app-0.9.4\\Hubtify.exe'));
    expect(res.suspicious).toBe(false);
    expect(res.root).toBe('C:\\Users\\Facu\\AppData\\Local\\Hubtify');
  });

  it('no avisa desde el stub de %LOCALAPPDATA%\\Hubtify', () => {
    expect(checkInstallLocation(packagedWin('C:\\Users\\Facu\\AppData\\Local\\Hubtify\\Hubtify.exe')).suspicious)
      .toBe(false);
  });

  it('no le importa el case de la unidad ni de las carpetas', () => {
    expect(checkInstallLocation(packagedWin('c:\\users\\facu\\appdata\\local\\Hubtify\\app-0.9.4\\Hubtify.exe')).suspicious)
      .toBe(false);
  });

  it('AVISA desde C:\\ProgramData\\<usuario>\\Hubtify (la copia duplicada)', () => {
    const res = checkInstallLocation(packagedWin('C:\\ProgramData\\Facu\\Hubtify\\app-0.9.4\\Hubtify.exe'));
    expect(res.suspicious).toBe(true);
    expect(res.root).toBe('C:\\ProgramData\\Facu\\Hubtify');
  });

  it('AVISA desde Archivos de programa', () => {
    expect(checkInstallLocation(packagedWin('C:\\Program Files\\Hubtify\\Hubtify.exe')).suspicious).toBe(true);
  });

  it('no avisa en desarrollo (app.isPackaged === false)', () => {
    const res = checkInstallLocation({
      ...packagedWin('D:\\code\\hubtify\\node_modules\\electron\\dist\\electron.exe'),
      isPackaged: false,
    });
    expect(res.suspicious).toBe(false);
  });

  it('no avisa desde node_modules\\electron aunque isPackaged mienta', () => {
    expect(checkInstallLocation(packagedWin('D:\\code\\hubtify\\node_modules\\electron\\dist\\electron.exe')).suspicious)
      .toBe(false);
  });

  it('no avisa desde out/ (npm run package, el árbol del repo)', () => {
    expect(checkInstallLocation(packagedWin('D:\\code\\hubtify\\out\\Hubtify-win32-x64\\Hubtify.exe')).suspicious)
      .toBe(false);
  });

  it('no avisa en macOS', () => {
    expect(checkInstallLocation({
      execPath: '/Applications/Hubtify.app/Contents/MacOS/Hubtify',
      localAppData: '',
      platform: 'darwin',
      isPackaged: true,
    }).suspicious).toBe(false);
  });

  it('no avisa en Linux', () => {
    expect(checkInstallLocation({
      execPath: '/opt/Hubtify/hubtify',
      localAppData: '',
      platform: 'linux',
      isPackaged: true,
    }).suspicious).toBe(false);
  });

  it('no avisa si no sabemos dónde está LocalAppData (mejor callarse que mentir)', () => {
    expect(checkInstallLocation({
      ...packagedWin('C:\\ProgramData\\Facu\\Hubtify\\app-0.9.4\\Hubtify.exe'),
      localAppData: '',
    }).suspicious).toBe(false);
  });

  it('tolera una barra final en LocalAppData', () => {
    expect(checkInstallLocation({
      ...packagedWin('C:\\Users\\Facu\\AppData\\Local\\Hubtify\\app-0.9.4\\Hubtify.exe'),
      localAppData: 'C:\\Users\\Facu\\AppData\\Local\\',
    }).suspicious).toBe(false);
  });

  it('no confunde un hermano con prefijo parecido (LocalLow, no Local)', () => {
    expect(checkInstallLocation({
      ...packagedWin('C:\\Users\\Facu\\AppData\\LocalLow\\Hubtify\\app-0.9.4\\Hubtify.exe'),
      localAppData: 'C:\\Users\\Facu\\AppData\\Local',
    }).suspicious).toBe(true);
  });
});
