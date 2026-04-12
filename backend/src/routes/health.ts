import { Hono } from 'hono';
import type { AppEnv } from '../env.js';

export function createHealthRoutes(env: AppEnv) {
  const healthRoutes = new Hono();

  healthRoutes.get('/health', (context) =>
    context.json({
      status: 'ok',
      model: env.OPENAI_MODEL,
      timestamp: new Date().toISOString(),
      openaiConfigured: Boolean(env.OPENAI_API_KEY),
    }),
  );

  return healthRoutes;
}
