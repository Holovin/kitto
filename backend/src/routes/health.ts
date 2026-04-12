import { Hono } from 'hono';
import { env, isOpenAIConfigured } from '../env.js';

export const healthRoute = new Hono();

healthRoute.get('/health', (c) => {
  return c.json({
    status: 'ok',
    model: env.OPENAI_MODEL,
    openaiConfigured: isOpenAIConfigured(),
    timestamp: new Date().toISOString(),
  });
});
