import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import { getPromptInfoSnapshot } from '../prompts/openui.js';

export function createPromptRoutes(env: AppEnv) {
  const promptRoutes = new Hono();

  promptRoutes.get('/prompts/info', (context) => context.json(getPromptInfoSnapshot(env)));

  return promptRoutes;
}
