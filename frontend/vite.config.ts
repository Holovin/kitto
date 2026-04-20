import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';

function escapeForRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readBackendPort() {
  const backendEnvPath = path.resolve(__dirname, '../backend/.env');

  if (!fs.existsSync(backendEnvPath)) {
    return '8787';
  }

  const envSource = fs.readFileSync(backendEnvPath, 'utf8');
  const portLine = envSource
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('PORT='));

  if (!portLine) {
    return '8787';
  }

  const rawPort = portLine.slice('PORT='.length).trim().replace(/^['"]|['"]$/g, '');
  return rawPort || '8787';
}

function getDevApiTarget(mode: string) {
  const frontendEnv = loadEnv(mode, __dirname, '');
  const configuredDevTarget = frontendEnv.VITE_DEV_API_TARGET?.trim();

  if (configuredDevTarget) {
    return configuredDevTarget.replace(/\/$/, '');
  }

  return `http://localhost:${readBackendPort()}`;
}

function createScopedReactCompilerPreset(rootDir: string) {
  const preset = reactCompilerPreset();
  const sourceDirectoryPattern = new RegExp(`^${escapeForRegExp(path.resolve(rootDir, 'src'))}[\\\\/].*\\.[jt]sx?$`);

  preset.rolldown ??= {};
  preset.rolldown.filter ??= {};
  preset.rolldown.filter.id = {
    include: [sourceDirectoryPattern],
  };

  return preset;
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    tailwindcss(),
    react(),
    babel({ presets: [createScopedReactCompilerPreset(__dirname)] }),
  ],
  resolve: {
    alias: {
      '@api': path.resolve(__dirname, 'src/api'),
      '@components': path.resolve(__dirname, 'src/components'),
      '@features': path.resolve(__dirname, 'src/features'),
      '@helpers': path.resolve(__dirname, 'src/helpers'),
      '@layouts': path.resolve(__dirname, 'src/layouts'),
      '@lib': path.resolve(__dirname, 'src/lib'),
      '@pages': path.resolve(__dirname, 'src/pages'),
      '@router': path.resolve(__dirname, 'src/router'),
      '@src': path.resolve(__dirname, 'src'),
      '@store': path.resolve(__dirname, 'src/store'),
      '@types': path.resolve(__dirname, 'src/types'),
    },
  },
  server: {
    port: 5555,
    strictPort: true,
    proxy: {
      '/api': {
        target: getDevApiTarget(mode),
        changeOrigin: true,
      },
    },
  },
}));
