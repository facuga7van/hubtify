import { defineConfig } from 'vite';

// Note: Tailwind CSS is handled via PostCSS (postcss.config.mjs)
// @tailwindcss/vite is ESM-only and incompatible with Electron Forge's require()-based config loading
export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
});
