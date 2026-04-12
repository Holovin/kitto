import { Hono } from 'hono';
import { env } from '../env.js';

export const configRoute = new Hono();

configRoute.get('/config', (c) => {
  return c.json({
    limits: {
      promptMaxChars: env.LLM_PROMPT_MAX_CHARS,
      chatHistoryMaxItems: env.LLM_CHAT_HISTORY_MAX_ITEMS,
      requestMaxBytes: env.LLM_REQUEST_MAX_BYTES,
    },
  });
});
