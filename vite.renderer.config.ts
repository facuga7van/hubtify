import { defineConfig } from 'vite';
import pkg from './package.json';

// Note: Tailwind CSS is handled via PostCSS (postcss.config.mjs)
// @tailwindcss/vite is ESM-only and incompatible with Electron Forge's require()-based config loading
export default defineConfig({
  define: {
    APP_VERSION: JSON.stringify(pkg.version),
  },
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
});
