import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  appUserModelIdFor,
  DEVELOPMENT_APP_USER_MODEL_ID,
  PRODUCTION_APP_USER_MODEL_ID,
} from '../../electron/app-identity';

describe('appUserModelIdFor', () => {
  it('empaquetado devuelve EXACTAMENTE el AUMID de producción', () => {
    // Literal a mano, no la constante: si alguien edita app-identity.ts este
    // test tiene que fallar. La cadena es la que Squirrel le puso a los accesos
    // directos ya instalados; cambiarla desancla la app de la barra de tareas.
    expect(appUserModelIdFor(true)).toBe('com.squirrel.Hubtify.Hubtify');
  });

  it('sin empaquetar devuelve un AUMID distinto del de producción', () => {
    expect(appUserModelIdFor(false)).not.toBe(appUserModelIdFor(true));
  });

  it('el AUMID de desarrollo no es vacío (sin AUMID los toasts salen como electron.exe)', () => {
    expect(appUserModelIdFor(false).trim().length).toBeGreaterThan(0);
  });

  it('el AUMID de desarrollo no es prefijo ni sufijo confundible del de producción', () => {
    // `startsWith` está bien (comparte el prefijo), lo que NO puede pasar es que
    // el shell reciba la cadena de producción tal cual desde una corrida de dev.
    expect(DEVELOPMENT_APP_USER_MODEL_ID.startsWith(PRODUCTION_APP_USER_MODEL_ID)).toBe(true);
    expect(DEVELOPMENT_APP_USER_MODEL_ID).not.toBe(PRODUCTION_APP_USER_MODEL_ID);
  });
});

/**
 * El AUMID de producción no es un valor libre: es el que Squirrel.Windows deriva
 * del maker y del ejecutable. Estos tests atan la constante a sus dos fuentes,
 * así que renombrar el paquete o el producto rompe acá y no en la barra de
 * tareas de los usuarios.
 */
describe('PRODUCTION_APP_USER_MODEL_ID — coincide con lo que arma Squirrel', () => {
  const read = (rel: string) =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8');

  it('sigue la forma com.squirrel.<PACKAGE>.<EXE>', () => {
    expect(PRODUCTION_APP_USER_MODEL_ID).toMatch(/^com\.squirrel\.[^.]+\.[^.]+$/);
  });

  it('<PACKAGE> es el name de MakerSquirrel en forge.config.ts', () => {
    // Se lee como TEXTO a propósito (igual que forge-config.test.ts): importar
    // forge.config.ts arrastraría todos los makers de Forge a la suite unitaria.
    const forgeConfig = read('../../forge.config.ts');
    const squirrelName = forgeConfig.match(/new MakerSquirrel\(\{\s*name:\s*'([^']+)'/)?.[1];
    expect(squirrelName).toBe('Hubtify');
    expect(PRODUCTION_APP_USER_MODEL_ID.split('.')[2]).toBe(squirrelName);
  });

  it('<EXE> es el productName de package.json (el .exe que instala Squirrel)', () => {
    const productName = JSON.parse(read('../../package.json')).productName;
    expect(productName).toBe('Hubtify');
    expect(PRODUCTION_APP_USER_MODEL_ID.split('.')[3]).toBe(productName);
  });
});

describe('electron/main.ts — usa la función, no la cadena', () => {
  const main = readFileSync(
    fileURLToPath(new URL('../../electron/main.ts', import.meta.url)),
    'utf-8',
  );

  it('no vuelve a hardcodear el AUMID de producción', () => {
    expect(main).not.toContain(`'${PRODUCTION_APP_USER_MODEL_ID}'`);
  });

  it('resuelve el AUMID con appUserModelIdFor(app.isPackaged)', () => {
    expect(main).toMatch(/setAppUserModelId\(appUserModelIdFor\(app\.isPackaged\)\)/);
  });
});
