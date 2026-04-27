import { execSync } from 'node:child_process';
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

function readAppVersionPrefix(packageJsonPath: string) {
  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { version?: string };
    const [major = '0'] = (packageJson.version ?? '0.0.0').split('.');
    return major;
  } catch {
    return '0';
  }
}

function readGitCommitCount(rootDir: string) {
  try {
    return execSync('git rev-list --count HEAD', {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || '0';
  } catch {
    return '0';
  }
}

function createAppTitle(rootDir: string, packageJsonPath: string) {
  const versionPrefix = readAppVersionPrefix(packageJsonPath);
  const commitCount = readGitCommitCount(rootDir);
  return `Kitto (${versionPrefix}.${commitCount})`;
}

function versionedTitlePlugin(rootDir: string, packageJsonPath: string) {
  return {
    name: 'kitto-versioned-title',
    transformIndexHtml(html: string) {
      return html.replace(/%KITTO_APP_TITLE%/g, createAppTitle(rootDir, packageJsonPath));
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const repoRoot = path.resolve(__dirname, '..');
  const packageJsonPath = path.resolve(__dirname, 'package.json');

  return {
    plugins: [
      versionedTitlePlugin(repoRoot, packageJsonPath),
      tailwindcss(),
      react(),
      babel({ presets: [createScopedReactCompilerPreset(__dirname)] }),
    ],
    resolve: {
      alias: {
        '@api': path.resolve(__dirname, 'src/api'),
        '@components': path.resolve(__dirname, 'src/components'),
        '@helpers': path.resolve(__dirname, 'src/helpers'),
        '@layouts': path.resolve(__dirname, 'src/layouts'),
        '@pages': path.resolve(__dirname, 'src/pages'),
        '@router': path.resolve(__dirname, 'src/router'),
        '@src': path.resolve(__dirname, 'src'),
        '@store': path.resolve(__dirname, 'src/store'),
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
  };
});
