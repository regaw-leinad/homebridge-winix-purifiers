import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      HOMEBRIDGE_STORAGE_PATH: '/path/to/storage',
    },
    exclude: [...configDefaults.exclude, '**/integration/**'],
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [...configDefaults.exclude, './src/homebridge-ui/ui/**', '**/tests/**', './src/config.ts'],
    },
  },
});
