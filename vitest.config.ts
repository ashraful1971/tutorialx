import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'packages/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/fixtures/**'],
    testTimeout: 15_000,
    restoreMocks: true,
  },
});
