import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppEnv } from '../env.js';
import {
  DEFAULT_LLM_CHAT_HISTORY_MAX_ITEMS,
  DEFAULT_LLM_OUTPUT_MAX_BYTES,
  DEFAULT_LLM_PROMPT_MAX_CHARS,
  DEFAULT_LLM_RATE_LIMIT_MAX_REQUESTS,
  DEFAULT_LLM_RATE_LIMIT_WINDOW_MS,
  DEFAULT_LLM_REQUEST_MAX_BYTES,
  DEFAULT_OPENAI_REQUEST_TIMEOUT_MS,
} from '../limits.js';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(currentDirectory, '../../..');
const defaultFrontendDistDir = path.resolve(workspaceRoot, 'frontend/dist');

export function createTestEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    FRONTEND_ORIGIN: 'http://localhost:5555',
    LLM_CHAT_HISTORY_MAX_ITEMS: DEFAULT_LLM_CHAT_HISTORY_MAX_ITEMS,
    LLM_OUTPUT_MAX_BYTES: DEFAULT_LLM_OUTPUT_MAX_BYTES,
    LLM_PROMPT_MAX_CHARS: DEFAULT_LLM_PROMPT_MAX_CHARS,
    LLM_RATE_LIMIT_MAX_REQUESTS: DEFAULT_LLM_RATE_LIMIT_MAX_REQUESTS,
    LLM_RATE_LIMIT_WINDOW_MS: DEFAULT_LLM_RATE_LIMIT_WINDOW_MS,
    LLM_REQUEST_MAX_BYTES: DEFAULT_LLM_REQUEST_MAX_BYTES,
    LOG_LEVEL: 'silent',
    OPENAI_API_KEY: '',
    OPENAI_MODEL: 'gpt-5.4-mini',
    OPENAI_REQUEST_TIMEOUT_MS: DEFAULT_OPENAI_REQUEST_TIMEOUT_MS,
    PORT: 8787,
    frontendDistDir: defaultFrontendDistDir,
    ...overrides,
  };
}
