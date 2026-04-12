import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import babel from '@rolldown/plugin-babel';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const frontendEnv = loadEnv(mode, __dirname, '');
  const backendTarget = frontendEnv.VITE_DEV_API_TARGET?.replace(/\/$/, '') ?? 'http://localhost:8787';

  return {
    plugins: [
      tailwindcss(),
      react(),
      babel({ presets: [reactCompilerPreset()] }),
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
      port: 5556,
      strictPort: true,
      proxy: {
        '/api': backendTarget,
      },
    },
    preview: {
      port: 5556,
      strictPort: true,
    },
  };
});
