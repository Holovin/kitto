import fs from 'node:fs';
import path from 'node:path';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serveStatic } from '@hono/node-server/serve-static';
import type { AppEnv } from './env.js';
import { logServerError, toPublicErrorPayload } from './errors/publicError.js';
import { createConfigRoutes } from './routes/config.js';
import { createHealthRoutes } from './routes/health.js';
import { createLlmOpenUiRoutes } from './routes/llm-openui.js';

function jsonRouteNotFound(context: Context) {
  return context.json(
    {
      error: 'Route not found.',
    },
    404,
  );
}

function isApiRoute(pathname: string) {
  return pathname === '/api' || pathname.startsWith('/api/');
}

function isStaticAssetRoute(pathname: string) {
  return pathname.startsWith('/assets/') || pathname === '/favicon.svg' || pathname === '/icons.svg';
}

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
  app.all('/config', jsonRouteNotFound);
  app.all('/health', jsonRouteNotFound);
  app.all('/llm', jsonRouteNotFound);
  app.all('/llm/*', jsonRouteNotFound);

  const frontendDistDir = env.frontendDistDir;
  const frontendRoot = path.relative(process.cwd(), frontendDistDir);
  const indexHtmlPath = path.join(frontendDistDir, 'index.html');

  if (fs.existsSync(indexHtmlPath)) {
    app.use('/assets/*', serveStatic({ root: frontendRoot }));
    app.use('/favicon.svg', serveStatic({ root: frontendRoot }));
    app.use('/icons.svg', serveStatic({ root: frontendRoot }));

    app.get('*', async (context, next) => {
      if (isApiRoute(context.req.path) || isStaticAssetRoute(context.req.path)) {
        await next();
        return;
      }

      return serveStatic({
        root: frontendRoot,
        path: 'index.html',
      })(context, next);
    });
  }

  app.notFound(jsonRouteNotFound);

  app.onError((error, context) => {
    logServerError(error, `${context.req.method} ${context.req.path}`);
    const publicError = toPublicErrorPayload(error);

    return context.json(publicError, publicError.status);
  });

  return app;
}
