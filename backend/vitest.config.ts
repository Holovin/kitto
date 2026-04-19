import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    exclude: ['dist/**', 'node_modules/**'],
    globals: false,
    include: ['src/tests/**/*.test.ts'],
    restoreMocks: true,
  },
});
