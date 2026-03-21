import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'shared/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
  },
  resolve: {
    alias: {
      '@core': './src/core',
      '@hub': './src/hub',
      '@shared': './src/shared',
      '@modules': './src/modules',
    },
  },
});
