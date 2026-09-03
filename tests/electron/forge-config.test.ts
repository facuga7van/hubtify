import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * `iconUrl` es el ícono que Squirrel BAJA en cada `--install` y deja como
 * `app.ico` / DisplayIcon en Agregar o quitar programas. Cuando falta,
 * electron-winstaller cae en silencio a `electron.ico` (el átomo) y nadie se
 * entera hasta que un usuario abre el panel de control — exactamente lo que
 * pasó hasta la 0.9.3.
 *
 * El test lee `forge.config.ts` como TEXTO a propósito: importarlo arrastraría
 * todos los makers y plugins de Forge a la suite unitaria. Y no toca la red:
 * la URL se verifica a mano cuando se cambia, acá solo se valida la forma.
 */
const forgeConfig = readFileSync(
  fileURLToPath(new URL('../../forge.config.ts', import.meta.url)),
  'utf-8',
);

describe('forge.config.ts — MakerSquirrel', () => {
  it('define iconUrl (si no, Windows muestra el átomo de Electron)', () => {
    expect(forgeConfig).toMatch(/iconUrl:\s*'https:\/\//);
  });

  it('el iconUrl es una URL https pública que termina en .ico', () => {
    const match = forgeConfig.match(/iconUrl:\s*'([^']+)'/);
    expect(match).not.toBeNull();
    const url = new URL(match![1]);
    expect(url.protocol).toBe('https:');
    expect(url.pathname.toLowerCase().endsWith('.ico')).toBe(true);
    // Ni localhost ni file:// — Squirrel la resuelve desde la máquina del usuario.
    expect(url.hostname).not.toBe('localhost');
  });

  it('no quedó apuntando al ícono por defecto de Electron', () => {
    const url = forgeConfig.match(/iconUrl:\s*'([^']+)'/)![1];
    expect(url).not.toMatch(/electron\.ico$/);
    expect(url).not.toContain('raw.githubusercontent.com/electron/');
  });

  it('sigue definiendo setupIcon (el ícono embebido en el Setup.exe)', () => {
    expect(forgeConfig).toMatch(/setupIcon:\s*'\.\/assets\/icon\.ico'/);
  });
});

/**
 * Vite deja fuera del bundle del main todo lo que está en `external`, y eso
 * se resuelve con `require()` en runtime. En la app instalada el `require` solo
 * encuentra lo que `copyExternalModules` copió: cada external que falte en
 * `EXTERNAL_MODULES` es un `Cannot find module` que recién aparece EMPAQUETADO
 * (en `npm start` está `node_modules` entero y nadie lo nota).
 *
 * Así estuvo roto el import de PDF desde marzo: `pdf-parse` se externalizó dos
 * días después de crear la lista y nunca se agregó. Esta comparación es lo que
 * lo hubiera atajado.
 */
describe('forge.config.ts — EXTERNAL_MODULES cubre los externals de Vite', () => {
  const viteMain = readFileSync(
    fileURLToPath(new URL('../../vite.main.config.ts', import.meta.url)),
    'utf-8',
  );

  const listOf = (source: string, re: RegExp): string[] => {
    const m = source.match(re);
    expect(m, `no se pudo leer la lista con ${re}`).not.toBeNull();
    return [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  };

  it('todo external del main está en EXTERNAL_MODULES (si no, Cannot find module empaquetado)', () => {
    const externals = listOf(viteMain, /external:\s*\[([^\]]*)\]/);
    const copied = listOf(forgeConfig, /EXTERNAL_MODULES\s*=\s*\[([^\]]*)\]/);
    expect(externals.length).toBeGreaterThan(0);
    const missing = externals.filter((m) => !copied.includes(m));
    expect(missing, `externals sin copiar al paquete: ${missing.join(', ')}`).toEqual([]);
  });
});
