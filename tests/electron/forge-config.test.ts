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
