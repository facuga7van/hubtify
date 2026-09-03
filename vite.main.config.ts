import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: { alias: { '@logic': path.resolve(__dirname, 'shared-logic') } },
  build: {
    rollupOptions: {
      external: ['better-sqlite3', 'adm-zip'],
    },
  },
});
