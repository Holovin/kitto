import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';
import {
  DEFAULT_LLM_CHAT_HISTORY_MAX_ITEMS,
  DEFAULT_LLM_OUTPUT_MAX_BYTES,
  DEFAULT_LLM_PROMPT_MAX_CHARS,
  DEFAULT_LLM_RATE_LIMIT_MAX_REQUESTS,
  DEFAULT_LLM_RATE_LIMIT_WINDOW_MS,
  DEFAULT_LLM_REQUEST_MAX_BYTES,
  DEFAULT_OPENAI_REQUEST_TIMEOUT_MS,
} from './limits.js';

const envSchema = z.object({
  FRONTEND_ORIGIN: z.string().default('http://localhost:5555'),
  LLM_CHAT_HISTORY_MAX_ITEMS: z.coerce.number().int().positive().default(DEFAULT_LLM_CHAT_HISTORY_MAX_ITEMS),
  LLM_OUTPUT_MAX_BYTES: z.coerce.number().int().positive().default(DEFAULT_LLM_OUTPUT_MAX_BYTES),
  LLM_PROMPT_MAX_CHARS: z.coerce.number().int().positive().default(DEFAULT_LLM_PROMPT_MAX_CHARS),
  LLM_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(DEFAULT_LLM_RATE_LIMIT_MAX_REQUESTS),
  LLM_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(DEFAULT_LLM_RATE_LIMIT_WINDOW_MS),
  LLM_REQUEST_MAX_BYTES: z.coerce.number().int().positive().default(DEFAULT_LLM_REQUEST_MAX_BYTES),
  LOG_LEVEL: z.enum(['debug', 'error', 'info', 'silent', 'warn']).default('info'),
  OPENAI_API_KEY: z.string().optional().default(''),
  OPENAI_MODEL: z.string().default('gpt-5.4-mini'),
  OPENAI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(DEFAULT_OPENAI_REQUEST_TIMEOUT_MS),
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
