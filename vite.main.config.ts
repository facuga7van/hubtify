import { defineConfig } from 'vite';
import { config } from 'dotenv';

// Load .env file for local development
config();

export default defineConfig({
  define: {
    'process.env.GEMINI_API_KEY': JSON.stringify(process.env.GEMINI_API_KEY ?? ''),
  },
  build: {
    rollupOptions: {
      external: ['better-sqlite3', 'adm-zip', 'electron-updater'],
    },
  },
});
