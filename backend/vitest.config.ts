import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const backendSrcDir = fileURLToPath(new URL('./src/', import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^#backend\/(.+)\.js$/,
        replacement: `${backendSrcDir}$1.ts`,
      },
    ],
    conditions: ['tsx'],
  },
  test: {
    environment: 'node',
    exclude: ['dist/**', 'node_modules/**'],
    globals: false,
    include: ['src/tests/**/*.test.ts'],
    restoreMocks: true,
  },
});
