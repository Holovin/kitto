import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './env.js';
import { configRoute } from './routes/config.js';
import { healthRoute } from './routes/health.js';
import { llmJsonRenderRoute } from './routes/llm-json-render.js';

const currentDir = dirname(fileURLToPath(import.meta.url));
const frontendDistDir = resolve(currentDir, '../../frontend/dist');
const frontendIndexFile = resolve(frontendDistDir, 'index.html');
let cachedIndexHtml: string | null = null;

export const app = new Hono();

app.use(
  '*',
  cors({
    origin: env.FRONTEND_ORIGIN,
    allowHeaders: ['Content-Type'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    exposeHeaders: [
      'Retry-After',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
      'X-Kitto-Request-Compacted',
      'X-Kitto-Request-Compaction-Actions',
      'X-Kitto-Request-Bytes',
      'X-Kitto-Request-Dropped-Messages',
      'X-Kitto-Request-Dropped-Raw-Lines',
    ],
  }),
);

app.route('/api', healthRoute);
app.route('/api', configRoute);
app.route('/api', llmJsonRenderRoute);

if (existsSync(frontendDistDir)) {
  app.use(
    '*',
    serveStatic({
      root: frontendDistDir,
      onNotFound: () => {
        return;
      },
    }),
  );

  app.get('*', async (c) => {
    if (!cachedIndexHtml) {
      cachedIndexHtml = await readFile(frontendIndexFile, 'utf8');
    }

    return c.html(cachedIndexHtml);
  });
}

app.notFound((c) => c.json({ message: 'Not found' }, 404));
