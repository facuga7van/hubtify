import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import fs from 'fs';
import path from 'path';

// Native/external modules that Vite can't bundle and must be copied to the package
const EXTERNAL_MODULES = [
  'better-sqlite3',
  'bindings',
  'file-uri-to-path',
  'prebuild-install',
  'node-addon-api',
  'adm-zip',
];

function copyExternalModules(buildPath: string): void {
  const nodeModulesSrc = path.resolve(__dirname, 'node_modules');
  const nodeModulesDst = path.join(buildPath, 'node_modules');
  const copied = new Set<string>();

  const copyModule = (modName: string) => {
    if (copied.has(modName)) return;
    copied.add(modName);

    const src = path.join(nodeModulesSrc, modName);
    const dst = path.join(nodeModulesDst, modName);
    if (!fs.existsSync(src)) return;
    if (!fs.existsSync(dst)) fs.cpSync(src, dst, { recursive: true });

    // Recursively copy all dependencies
    const modPkgPath = path.join(src, 'package.json');
    if (fs.existsSync(modPkgPath)) {
      const modPkg = JSON.parse(fs.readFileSync(modPkgPath, 'utf-8'));
      const deps = { ...modPkg.dependencies, ...modPkg.optionalDependencies };
      for (const dep of Object.keys(deps || {})) {
        copyModule(dep);
      }
    }
  };

  fs.mkdirSync(nodeModulesDst, { recursive: true });
  for (const mod of EXTERNAL_MODULES) {
    copyModule(mod);
  }
}

const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'));

const config: ForgeConfig = {
  packagerConfig: {
    asar: {
      unpack: '**/node_modules/{better-sqlite3,bindings,file-uri-to-path}/**',
    },
    icon: path.resolve(__dirname, 'assets/icon'),
    extraResource: ['./assets/icon.ico'],
    appVersion: pkg.version,
    appCopyright: 'Hubtify',
    win32metadata: {
      CompanyName: 'Hubtify',
      FileDescription: 'Hubtify - Gamified Life Hub',
      ProductName: 'Hubtify',
    },
    afterCopy: [
      (buildPath: string, _electronVersion: string, _platform: string, _arch: string, callback: (err?: Error) => void) => {
        try {
          copyExternalModules(buildPath);
          callback();
        } catch (err) {
          callback(err as Error);
        }
      },
    ],
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      name: 'Hubtify',
      setupIcon: './assets/icon.ico',
      // Ícono REMOTO que Squirrel baja como `app.ico` y registra como DisplayIcon
      // en Agregar o quitar programas. Sin esta línea, electron-winstaller cae a
      // su default (`electron.ico`, el átomo) — lib/index.js:162 — y todo usuario
      // nuevo veía el logo de Electron en el panel de control (verificado por
      // hash en docs/superpowers/plans/2026-09-03-windows-shortcut-icon.md).
      // `setupIcon` es otra cosa: el ícono embebido en el Setup.exe.
      // La URL apunta al repo (no a la landing) para que el ícono viva junto al
      // archivo que lo genera: `assets/icon.ico` cambia y la URL sirve el nuevo
      // sin depender de un deploy de GitHub Pages. raw.githubusercontent devuelve
      // HTTP 200 con Content-Type: image/vnd.microsoft.icon (idéntico al que
      // sirve la landing), así que Windows lo trata como ICO sin ambigüedad.
      iconUrl: 'https://raw.githubusercontent.com/facuga7van/hubtify/master/assets/icon.ico',
    }),
    new MakerZIP({}),
  ],
  publishers: [
    {
      name: '@electron-forge/publisher-github',
      config: {
        repository: { owner: 'facuga7van', name: 'hubtify' },
        prerelease: false,
        draft: false,
      },
    },
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        {
          entry: 'electron/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'electron/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
