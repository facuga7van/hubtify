import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  appIcoPathFor,
  bundledIconPathFor,
  healAppIcon,
  shouldReplaceIcon,
} from '../../electron/app-icon';

/** El sha256 del `electron.ico` que Squirrel dejó instalado (evidencia real, 0.9.3). */
const ELECTRON_ICO = 'b5d81c93892f9cceb990beb5088afafd87e3d808197f67d4c5347e5e6299cbec';
/** El sha256 de `assets/icon.ico`, el que queremos (evidencia real). */
const HUBTIFY_ICO = 'a9531dd03307f154021d928b70596840a14bebeb2b9537cb733c85a590d8bcfe';

const packagedWin = (over: Partial<Parameters<typeof shouldReplaceIcon>[0]> = {}) => ({
  platform: 'win32',
  isPackaged: true,
  installedHash: ELECTRON_ICO,
  bundledHash: HUBTIFY_ICO,
  ...over,
});

describe('shouldReplaceIcon', () => {
  it('reemplaza cuando el app.ico instalado no es el nuestro', () => {
    expect(shouldReplaceIcon(packagedWin())).toEqual({ replace: true, reason: 'stale' });
  });

  it('NO reemplaza cuando ya son el mismo archivo (idempotente)', () => {
    expect(shouldReplaceIcon(packagedWin({ installedHash: HUBTIFY_ICO })))
      .toEqual({ replace: false, reason: 'up-to-date' });
  });

  it('reemplaza cuando el app.ico no existe', () => {
    expect(shouldReplaceIcon(packagedWin({ installedHash: null })))
      .toEqual({ replace: true, reason: 'missing' });
  });

  it('NO hace nada si no tenemos ícono empaquetado con qué reemplazar', () => {
    expect(shouldReplaceIcon(packagedWin({ bundledHash: null })))
      .toEqual({ replace: false, reason: 'no-bundled-icon' });
  });

  it('no toca nada aunque falten LOS DOS archivos', () => {
    expect(shouldReplaceIcon(packagedWin({ installedHash: null, bundledHash: null })))
      .toEqual({ replace: false, reason: 'no-bundled-icon' });
  });

  it('NO reemplaza fuera de Windows (Squirrel es exclusivo de win32)', () => {
    for (const platform of ['darwin', 'linux']) {
      expect(shouldReplaceIcon(packagedWin({ platform })))
        .toEqual({ replace: false, reason: 'not-windows' });
    }
  });

  it('NO reemplaza en desarrollo (app.isPackaged === false)', () => {
    expect(shouldReplaceIcon(packagedWin({ isPackaged: false })))
      .toEqual({ replace: false, reason: 'not-packaged' });
  });

  it('compara los hashes sin importar el case del hex', () => {
    expect(shouldReplaceIcon(packagedWin({
      installedHash: HUBTIFY_ICO.toUpperCase(),
      bundledHash: HUBTIFY_ICO,
    }))).toEqual({ replace: false, reason: 'up-to-date' });
  });
});

describe('appIcoPathFor', () => {
  it('apunta a la raíz de la instalación desde el exe versionado', () => {
    expect(appIcoPathFor('C:\\Users\\Facu\\AppData\\Local\\Hubtify\\app-0.9.4\\Hubtify.exe'))
      .toBe('C:\\Users\\Facu\\AppData\\Local\\Hubtify\\app.ico');
  });

  it('da la MISMA raíz arrancando desde el stub', () => {
    expect(appIcoPathFor('C:\\Users\\Facu\\AppData\\Local\\Hubtify\\Hubtify.exe'))
      .toBe('C:\\Users\\Facu\\AppData\\Local\\Hubtify\\app.ico');
  });

  it('cura la copia que se está ejecutando, no una raíz hardcodeada', () => {
    // Instalación duplicada en ProgramData: si la app corre desde ahí, ahí
    // escribimos. No adivinamos %LOCALAPPDATA%.
    expect(appIcoPathFor('C:\\ProgramData\\Facu\\Hubtify\\app-0.9.4\\Hubtify.exe'))
      .toBe('C:\\ProgramData\\Facu\\Hubtify\\app.ico');
  });
});

describe('bundledIconPathFor', () => {
  it('sale de process.resourcesPath, donde forge copia el extraResource', () => {
    expect(bundledIconPathFor('C:\\Users\\Facu\\AppData\\Local\\Hubtify\\app-0.9.4\\resources'))
      .toBe('C:\\Users\\Facu\\AppData\\Local\\Hubtify\\app-0.9.4\\resources\\icon.ico');
  });
});

// El efecto toca el filesystem con rutas de Windows; en otro SO no aplica.
describe.skipIf(process.platform !== 'win32')('healAppIcon (efecto)', () => {
  let root = '';
  let resources = '';
  let appIco = '';
  const GOOD = Buffer.from('ICO-HUBTIFY-BUENO');
  const BAD = Buffer.from('ICO-ELECTRON-ATOMO');

  const execPath = () => path.join(root, 'app-0.9.4', 'Hubtify.exe');
  const sha = (buf: Buffer) => crypto.createHash('sha256').update(buf).digest('hex');

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'hubtify-ico-'));
    resources = path.join(root, 'app-0.9.4', 'resources');
    appIco = path.join(root, 'app.ico');
    fs.mkdirSync(resources, { recursive: true });
    fs.writeFileSync(path.join(resources, 'icon.ico'), GOOD);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const run = () => healAppIcon({
    execPath: execPath(),
    resourcesPath: resources,
    platform: 'win32',
    isPackaged: true,
  });

  it('sobrescribe el app.ico que dejó Squirrel con el nuestro', async () => {
    fs.writeFileSync(appIco, BAD);
    const res = await run();
    expect(res.reason).toBe('stale');
    expect(res.replaced).toBe(true);
    expect(sha(fs.readFileSync(appIco))).toBe(sha(GOOD));
  });

  it('es idempotente: la segunda corrida no escribe nada', async () => {
    fs.writeFileSync(appIco, BAD);
    await run();
    const mtime = fs.statSync(appIco).mtimeMs;
    const res = await run();
    expect(res.reason).toBe('up-to-date');
    expect(res.replaced).toBe(false);
    expect(fs.statSync(appIco).mtimeMs).toBe(mtime);
  });

  it('crea el app.ico si Squirrel nunca lo escribió', async () => {
    expect(fs.existsSync(appIco)).toBe(false);
    const res = await run();
    expect(res.reason).toBe('missing');
    expect(res.replaced).toBe(true);
    expect(sha(fs.readFileSync(appIco))).toBe(sha(GOOD));
  });

  it('no rompe ni borra nada si falta el ícono empaquetado', async () => {
    fs.rmSync(path.join(resources, 'icon.ico'));
    fs.writeFileSync(appIco, BAD);
    const res = await run();
    expect(res.reason).toBe('no-bundled-icon');
    expect(res.replaced).toBe(false);
    expect(sha(fs.readFileSync(appIco))).toBe(sha(BAD));
  });

  it('no lee ni escribe nada en desarrollo', async () => {
    fs.writeFileSync(appIco, BAD);
    const res = await healAppIcon({
      execPath: execPath(),
      resourcesPath: resources,
      platform: 'win32',
      isPackaged: false,
    });
    expect(res.reason).toBe('not-packaged');
    expect(sha(fs.readFileSync(appIco))).toBe(sha(BAD));
  });

  it('no rompe si el destino es de solo lectura (archivo en uso / sin permisos)', async () => {
    // Un directorio con el nombre del archivo es la forma portable de forzar
    // que copyFile falle sin depender de ACLs de Windows.
    fs.mkdirSync(appIco);
    const res = await run();
    expect(res.replaced).toBe(false);
    expect(res.error).toBeTruthy();
  });
});
