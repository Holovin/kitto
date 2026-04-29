import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppEnv } from '#backend/env.js';
import {
  DEFAULT_CURRENT_SOURCE_EMERGENCY_MAX_CHARS,
  DEFAULT_LLM_MAX_REPAIR_ATTEMPTS,
  DEFAULT_LLM_MODEL_PROMPT_MAX_CHARS,
  DEFAULT_LLM_OUTPUT_MAX_BYTES,
  DEFAULT_LLM_REQUEST_MAX_BYTES,
  DEFAULT_LLM_USER_PROMPT_MAX_CHARS,
  DEFAULT_OPENAI_REQUEST_TIMEOUT_MS,
  DEFAULT_RATE_LIMIT_MAX_REQUESTS,
  DEFAULT_RATE_LIMIT_WINDOW_MS,
  DEFAULT_REQUEST_BODY_LIMIT_BYTES,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
} from '#backend/limits.js';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(currentDirectory, '../../..');
const defaultFrontendDistDir = path.resolve(workspaceRoot, 'frontend/dist');

export function createTestEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    currentSourceEmergencyMaxChars: DEFAULT_CURRENT_SOURCE_EMERGENCY_MAX_CHARS,
    frontendDistDir: defaultFrontendDistDir,
    frontendOrigin: 'http://localhost:5555',
    logLevel: 'silent',
    maxRepairAttempts: DEFAULT_LLM_MAX_REPAIR_ATTEMPTS,
    modelPromptMaxChars: DEFAULT_LLM_MODEL_PROMPT_MAX_CHARS,
    openAiApiKey: '',
    openAiModel: 'gpt-5.4-mini',
    openAiRequestTimeoutMs: DEFAULT_OPENAI_REQUEST_TIMEOUT_MS,
    outputMaxBytes: DEFAULT_LLM_OUTPUT_MAX_BYTES,
    port: 8787,
    promptIoLog: false,
    rateLimitMaxRequests: DEFAULT_RATE_LIMIT_MAX_REQUESTS,
    rateLimitWindowMs: DEFAULT_RATE_LIMIT_WINDOW_MS,
    requestBodyLimitBytes: DEFAULT_REQUEST_BODY_LIMIT_BYTES,
    requestMaxBytes: DEFAULT_LLM_REQUEST_MAX_BYTES,
    streamIdleTimeoutMs: DEFAULT_STREAM_IDLE_TIMEOUT_MS,
    userPromptMaxChars: DEFAULT_LLM_USER_PROMPT_MAX_CHARS,
    ...overrides,
  };
}
