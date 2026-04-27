import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@api': path.resolve(rootDir, 'src/api'),
      '@components': path.resolve(rootDir, 'src/components'),
      '@helpers': path.resolve(rootDir, 'src/helpers'),
      '@layouts': path.resolve(rootDir, 'src/layouts'),
      '@pages': path.resolve(rootDir, 'src/pages'),
      '@router': path.resolve(rootDir, 'src/router'),
      '@src': path.resolve(rootDir, 'src'),
      '@store': path.resolve(rootDir, 'src/store'),
    },
  },
  test: {
    environment: 'node',
    exclude: ['dist/**', 'node_modules/**'],
    globals: false,
    include: ['src/tests/**/*.test.ts'],
    restoreMocks: true,
  },
});
