import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';

const currentDir = dirname(fileURLToPath(import.meta.url));

loadEnv({ path: resolve(currentDir, '../.env') });

const envSchema = z.object({
  OPENAI_API_KEY: z.string().trim().default(''),
  OPENAI_MODEL: z.string().trim().default('gpt-5.4-mini'),
  OPENAI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  FRONTEND_ORIGIN: z.string().trim().default('http://localhost:5556'),
  LLM_PROMPT_MAX_CHARS: z.coerce.number().int().positive().default(4_096),
  LLM_CHAT_HISTORY_MAX_ITEMS: z.coerce.number().int().positive().default(40),
  LLM_REQUEST_MAX_BYTES: z.coerce.number().int().positive().default(300_000),
  LLM_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  LLM_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(60),
  PORT: z.coerce.number().int().positive().default(8787),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export const env = envSchema.parse(process.env);

export function isOpenAIConfigured() {
  return Boolean(env.OPENAI_API_KEY);
}
