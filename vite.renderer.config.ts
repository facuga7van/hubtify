import { defineConfig } from 'vite';
import pkg from './package.json';
import path from 'path';

// Note: Tailwind CSS is handled via PostCSS (postcss.config.mjs)
// @tailwindcss/vite is ESM-only and incompatible with Electron Forge's require()-based config loading
export default defineConfig({
  resolve: { alias: { '@logic': path.resolve(__dirname, 'shared-logic') } },
  define: {
    APP_VERSION: JSON.stringify(pkg.version),
    __HUBTIFY_PLATFORM__: '"desktop"',
  },
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
});
