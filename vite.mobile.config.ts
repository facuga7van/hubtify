import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import pkg from './package.json';

// Mismos aliases que vitest.config.ts (absolutos) más `@logic` (spec §5).
const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const alias = {
  '@core': r('./src/core'),
  '@hub': r('./src/hub'),
  '@shared': r('./src/shared'),
  '@modules': r('./src/modules'),
  '@logic': r('./shared-logic'),
};

// Build del renderer para Android (Capacitor). Entrada: index.html.
// - target es2022: el worker usa top-level await.
// - worker.format 'es': el worker es un módulo (import de sqlite-wasm).
// - base './': Capacitor sirve el webDir desde https://localhost/ y los assets
//   se referencian relativos al index.
// - leatherBeforeMount: el index.html es compartido con Electron, así que la
//   regla crítica se inyecta solo acá. theme.css pinta <body> con --parch-0 y,
//   mientras main.tsx espera `installMobileApi()` (worker + VFS + migraciones,
//   ~2 s), #root está vacío y ese pergamino se propaga al viewport: se veía
//   claro entre el splash de cuero y la app. Con fondo en <html>, el de <body>
//   deja de propagarse y el viewport queda cuero hasta que .shell-frame
//   (100dvh) lo cubre. Mismo color que el splash y que capacitor.config.ts.
const leatherBeforeMount = {
  name: 'hubtify:leather-before-mount',
  transformIndexHtml: () => [
    { tag: 'style', injectTo: 'head' as const, children: 'html { background: #2a1d0e; }' },
  ],
};

export default defineConfig({
  base: './',
  plugins: [leatherBeforeMount],
  define: {
    APP_VERSION: JSON.stringify(pkg.version),
    __HUBTIFY_PLATFORM__: '"android"',
  },
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  resolve: { alias },
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  worker: { format: 'es' },
  build: {
    outDir: 'dist/mobile',
    emptyOutDir: true,
    target: 'es2022',
  },
});
