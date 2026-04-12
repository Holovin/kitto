import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import { getPublicRuntimeConfig } from '../limits.js';

export function createConfigRoutes(env: AppEnv) {
  const configRoutes = new Hono();

  configRoutes.get('/config', (context) => context.json(getPublicRuntimeConfig(env)));

  return configRoutes;
}
