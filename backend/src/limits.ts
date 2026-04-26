import { getOpenUiTemperature } from '#backend/prompts/openui/requestConfig.js';

export const DEFAULT_LLM_USER_PROMPT_MAX_CHARS = 4_096;
export const DEFAULT_LLM_MODEL_PROMPT_MAX_CHARS = 12_288;
export const DEFAULT_LLM_CHAT_HISTORY_MAX_ITEMS = 40;
export const DEFAULT_LLM_MAX_REPAIR_ATTEMPTS = 2;
export const MAX_REPAIR_VALIDATION_ISSUES = 20;
export const DEFAULT_LLM_REQUEST_MAX_BYTES = 300_000;
export const DEFAULT_LLM_OUTPUT_MAX_BYTES = 100_000;
export const DEFAULT_LLM_RATE_LIMIT_MAX_REQUESTS = 60;
export const DEFAULT_LLM_RATE_LIMIT_MAX_ENTRIES = 10_000;
export const DEFAULT_LLM_RATE_LIMIT_WINDOW_MS = 60_000;
export const DEFAULT_OPENAI_REQUEST_TIMEOUT_MS = 120_000;
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 45_000;
const RAW_REQUEST_MAX_BYTES_MULTIPLIER = 4;
const RAW_STRUCTURED_OUTPUT_MAX_BYTES_MULTIPLIER = 2;
const textEncoder = new TextEncoder();

interface RuntimeConfigSource {
  LLM_CHAT_HISTORY_MAX_ITEMS: number;
  LLM_MAX_REPAIR_ATTEMPTS: number;
  LLM_USER_PROMPT_MAX_CHARS: number;
  LLM_REQUEST_MAX_BYTES: number;
  OPENAI_REQUEST_TIMEOUT_MS: number;
}

interface RawRequestLimitSource {
  LLM_REQUEST_MAX_BYTES: number;
}

export interface LlmOutputLimitSource {
  LLM_OUTPUT_MAX_BYTES: number;
}

export function getByteLength(value: string) {
  return textEncoder.encode(value).byteLength;
}

export function getRawRequestMaxBytes(env: RawRequestLimitSource) {
  return env.LLM_REQUEST_MAX_BYTES * RAW_REQUEST_MAX_BYTES_MULTIPLIER;
}

export function getRawStructuredOutputMaxBytes(env: LlmOutputLimitSource) {
  return env.LLM_OUTPUT_MAX_BYTES * RAW_STRUCTURED_OUTPUT_MAX_BYTES_MULTIPLIER;
}

export function getPublicRuntimeConfig(env: RuntimeConfigSource) {
  return {
    generation: {
      repairTemperature: getOpenUiTemperature('repair'),
      temperature: getOpenUiTemperature('initial'),
    },
    limits: {
      chatHistoryMaxItems: env.LLM_CHAT_HISTORY_MAX_ITEMS,
      promptMaxChars: env.LLM_USER_PROMPT_MAX_CHARS,
      requestMaxBytes: env.LLM_REQUEST_MAX_BYTES,
    },
    repair: {
      maxRepairAttempts: env.LLM_MAX_REPAIR_ATTEMPTS,
      maxValidationIssues: MAX_REPAIR_VALIDATION_ISSUES,
    },
    timeouts: {
      streamIdleTimeoutMs: DEFAULT_STREAM_IDLE_TIMEOUT_MS,
      streamMaxDurationMs: env.OPENAI_REQUEST_TIMEOUT_MS,
    },
  };
}
