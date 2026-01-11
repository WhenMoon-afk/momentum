import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'], // Exclude main entry (tested via integration)
    },
    testTimeout: 60000,
    hookTimeout: 60000,
    pool: 'forks',  // Use forks for better isolation with native modules
  },
});
