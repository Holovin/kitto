import { Hono } from 'hono';
import type { AppEnv } from '#backend/env.js';

export function createHealthRoutes(env: AppEnv) {
  const healthRoutes = new Hono();

  healthRoutes.get('/health', (context) =>
    context.json({
      status: 'ok',
      model: env.openAiModel,
      timestamp: new Date().toISOString(),
      openaiConfigured: Boolean(env.openAiApiKey),
    }),
  );

  return healthRoutes;
}
