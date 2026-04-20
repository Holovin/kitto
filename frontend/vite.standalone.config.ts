import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

function escapeForRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createScopedReactCompilerPreset(sourceRoot: string) {
  const preset = reactCompilerPreset();

  preset.rolldown ??= {};
  preset.rolldown.filter ??= {};
  preset.rolldown.filter.id = {
    include: [new RegExp(`^${escapeForRegExp(path.resolve(sourceRoot, 'src'))}[\\\\/].*\\.[jt]sx?$`)],
  };

  return preset;
}

export default defineConfig({
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  plugins: [
    tailwindcss(),
    react(),
    babel({ presets: [createScopedReactCompilerPreset(rootDir)] }),
  ],
  publicDir: false,
  resolve: {
    alias: {
      '@api': path.resolve(rootDir, 'src/api'),
      '@components': path.resolve(rootDir, 'src/components'),
      '@features': path.resolve(rootDir, 'src/features'),
      '@helpers': path.resolve(rootDir, 'src/helpers'),
      '@layouts': path.resolve(rootDir, 'src/layouts'),
      '@lib': path.resolve(rootDir, 'src/lib'),
      '@pages': path.resolve(rootDir, 'src/pages'),
      '@router': path.resolve(rootDir, 'src/router'),
      '@src': path.resolve(rootDir, 'src'),
      '@store': path.resolve(rootDir, 'src/store'),
      '@types': path.resolve(rootDir, 'src/types'),
    },
  },
  build: {
    cssCodeSplit: false,
    emptyOutDir: true,
    lib: {
      entry: path.resolve(rootDir, 'src/standalone/player.tsx'),
      fileName: () => 'player.js',
      formats: ['iife'],
      name: 'KittoStandalonePlayer',
    },
    outDir: path.resolve(rootDir, 'dist-standalone-player'),
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) {
            return 'style.css';
          }

          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
});
