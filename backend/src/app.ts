import fs from 'node:fs';
import path from 'node:path';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serveStatic } from '@hono/node-server/serve-static';
import type { AppEnv } from './env.js';
import { createRequestBodyTooLargeError, logServerError, toPublicErrorPayload } from '#backend/errors/publicError.js';
import { getRawRequestMaxBytes } from './limits.js';
import { getRequestBytesFromContext, getRequestIdFromContext } from './requestMetadata.js';
import { isFrontendRoute } from './frontendRoutes.js';
import { createConfigRoutes } from '#backend/routes/config.js';
import { createHealthRoutes } from '#backend/routes/health.js';
import { createLlmOpenUiRoutes } from '#backend/routes/llm-openui.js';
import { createPromptRoutes } from '#backend/routes/prompts.js';
import { writePromptIoIntakeFailureSafely } from '#backend/services/openai/logging.js';

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

export function createApp(env: AppEnv) {
  const app = new Hono();

  if (env.LOG_LEVEL !== 'silent') {
    app.use('*', logger());
  }

  app.use('/api/*', cors({ origin: env.FRONTEND_ORIGIN }));

  const rawRequestMaxBytes = getRawRequestMaxBytes(env);
  app.use(
    '/api/llm/*',
    bodyLimit({
      maxSize: rawRequestMaxBytes,
      async onError(context) {
        const requestId = getRequestIdFromContext(context);
        const requestBytes = getRequestBytesFromContext(context) ?? rawRequestMaxBytes + 1;

        await writePromptIoIntakeFailureSafely(env, {
          errorCode: 'validation_error',
          errorMessage: `Request body exceeded the raw request limit of ${rawRequestMaxBytes} bytes.`,
          requestBytes,
          requestId,
        });

        const publicError = toPublicErrorPayload(
          createRequestBodyTooLargeError(
            `Request body exceeded the raw request limit of ${rawRequestMaxBytes} bytes.`,
          ),
        );

        return context.json(publicError, publicError.status);
      },
    }),
  );

  const configRoutes = createConfigRoutes(env);
  const healthRoutes = createHealthRoutes(env);
  const llmRoutes = createLlmOpenUiRoutes(env);
  const promptRoutes = createPromptRoutes(env);

  app.route('/api', configRoutes);
  app.route('/api', healthRoutes);
  app.route('/api', llmRoutes);
  app.route('/api', promptRoutes);

  const frontendDistDir = env.frontendDistDir;
  const indexHtmlPath = path.join(frontendDistDir, 'index.html');

  if (fs.existsSync(indexHtmlPath)) {
    const serveFrontendStatic = serveStatic({ root: frontendDistDir });
    const serveFrontendIndex = serveStatic({ root: frontendDistDir, path: 'index.html' });

    app.use('*', async (context, next) => {
      if (isApiRoute(context.req.path)) {
        await next();
        return;
      }

      return serveFrontendStatic(context, next);
    });

    app.get('*', async (context, next) => {
      if (isApiRoute(context.req.path) || !isFrontendRoute(context.req.path)) {
        await next();
        return;
      }

      return serveFrontendIndex(context, next);
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
