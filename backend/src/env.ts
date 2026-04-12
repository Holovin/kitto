import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const envSchema = z.object({
  FRONTEND_ORIGIN: z.string().default('http://localhost:5555'),
  LLM_CHAT_HISTORY_MAX_ITEMS: z.coerce.number().int().positive().default(40),
  LLM_CHAT_MESSAGE_MAX_CHARS: z.coerce.number().int().positive().default(20_000),
  LLM_CURRENT_SOURCE_MAX_CHARS: z.coerce.number().int().positive().default(200_000),
  LLM_PROMPT_MAX_CHARS: z.coerce.number().int().positive().default(40_000),
  LLM_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(60),
  LLM_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  LLM_REQUEST_MAX_BYTES: z.coerce.number().int().positive().default(1_500_000),
  LOG_LEVEL: z.enum(['debug', 'error', 'info', 'silent', 'warn']).default('info'),
  OPENAI_API_KEY: z.string().optional().default(''),
  OPENAI_MODEL: z.string().default('gpt-5.4-mini'),
  OPENAI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  PORT: z.coerce.number().int().positive().default(8787),
});

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

export type AppEnv = z.infer<typeof envSchema> & {
  frontendDistDir: string;
};

export function loadEnv(): AppEnv {
  dotenv.config();
  const parsedEnv = envSchema.parse(process.env);

  return {
    ...parsedEnv,
    frontendDistDir: path.resolve(currentDirectory, '../../frontend/dist'),
  };
}
