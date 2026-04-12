import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serveStatic } from '@hono/node-server/serve-static';
import type { AppEnv } from './env.js';
import { createConfigRoutes } from './routes/config.js';
import { createHealthRoutes } from './routes/health.js';
import { createLlmOpenUiRoutes } from './routes/llm-openui.js';

export function createApp(env: AppEnv) {
  const app = new Hono();

  if (env.LOG_LEVEL !== 'silent') {
    app.use('*', logger());
  }

  app.use('/api/*', cors({ origin: env.FRONTEND_ORIGIN }));

  const configRoutes = createConfigRoutes(env);
  const healthRoutes = createHealthRoutes(env);
  const llmRoutes = createLlmOpenUiRoutes(env);

  app.route('/api', configRoutes);
  app.route('/api', healthRoutes);
  app.route('/api', llmRoutes);

  const frontendDistDir = env.frontendDistDir;
  const frontendRoot = path.relative(process.cwd(), frontendDistDir);
  const indexHtmlPath = path.join(frontendDistDir, 'index.html');

  if (fs.existsSync(indexHtmlPath)) {
    app.use('/assets/*', serveStatic({ root: frontendRoot }));
    app.use('/favicon.svg', serveStatic({ root: frontendRoot }));
    app.use('/icons.svg', serveStatic({ root: frontendRoot }));

    app.get('*', async (context, next) => {
      if (
        context.req.path === '/api' ||
        context.req.path.startsWith('/api/') ||
        context.req.path === '/health' ||
        context.req.path === '/llm' ||
        context.req.path.startsWith('/llm/')
      ) {
        await next();
        return;
      }

      return serveStatic({
        root: frontendRoot,
        path: 'index.html',
      })(context, next);
    });
  }

  app.notFound((context) =>
    context.json(
      {
        error: 'Route not found.',
      },
      404,
    ),
  );

  app.onError((error, context) =>
    context.json(
      {
        error: error.message,
      },
      500,
    ),
  );

  return app;
}
