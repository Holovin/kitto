import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';

const currentDir = dirname(fileURLToPath(import.meta.url));

loadEnv({ path: resolve(currentDir, '../.env') });

const envSchema = z.object({
  OPENAI_API_KEY: z.string().trim().optional(),
  OPENAI_MODEL: z.string().trim().default('gpt-5.4-mini'),
  FRONTEND_ORIGIN: z.string().trim().default('http://localhost:5556'),
  LLM_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  LLM_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(10),
  PORT: z.coerce.number().int().positive().default(8787),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export const env = envSchema.parse(process.env);

export function isOpenAIConfigured() {
  return Boolean(env.OPENAI_API_KEY);
}
