import { getOpenUiTemperature } from '#backend/prompts/openui/requestConfig.js';
import {
  DEFAULT_MAX_REPAIR_VALIDATION_ISSUES,
  PREVIOUS_USER_MESSAGES_MAX_ITEMS,
} from '@kitto-openui/shared/builderApiContract.js';

export const DEFAULT_LLM_USER_PROMPT_MAX_CHARS = 4_096;
export const DEFAULT_CURRENT_SOURCE_EMERGENCY_MAX_CHARS = 80_000;
export const DEFAULT_LLM_MODEL_PROMPT_MAX_CHARS = 180_000;
export const DEFAULT_LLM_MAX_REPAIR_ATTEMPTS = 2;
export const DEFAULT_LLM_REQUEST_MAX_BYTES = 1_200_000;
export const DEFAULT_LLM_OUTPUT_MAX_BYTES = 300_000;
export const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 60;
export const RATE_LIMIT_CONTINUATION_MAX_ENTRIES = 10_000;
export const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
export const DEFAULT_REQUEST_BODY_LIMIT_BYTES = 1_200_000;
export const DEFAULT_OPENAI_REQUEST_TIMEOUT_MS = 180_000;
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 60_000;
const RAW_STRUCTURED_OUTPUT_MAX_BYTES_MULTIPLIER = 2;
const textEncoder = new TextEncoder();

interface RuntimeConfigSource {
  currentSourceEmergencyMaxChars: number;
  maxRepairAttempts: number;
  modelPromptMaxChars: number;
  openAiRequestTimeoutMs: number;
  requestMaxBytes: number;
  streamIdleTimeoutMs: number;
  userPromptMaxChars: number;
}

interface RequestBodyLimitSource {
  requestBodyLimitBytes: number;
}

export interface LlmOutputLimitSource {
  outputMaxBytes: number;
}

export function getByteLength(value: string) {
  return textEncoder.encode(value).byteLength;
}

export function getRequestBodyLimitBytes(config: RequestBodyLimitSource) {
  return config.requestBodyLimitBytes;
}

export function getRawStructuredOutputMaxBytes(config: LlmOutputLimitSource) {
  return config.outputMaxBytes * RAW_STRUCTURED_OUTPUT_MAX_BYTES_MULTIPLIER;
}

export function getEffectiveSourceMaxChars(config: RuntimeConfigSource) {
  return config.currentSourceEmergencyMaxChars;
}

export function getPublicRuntimeConfig(config: RuntimeConfigSource) {
  return {
    generation: {
      repairTemperature: getOpenUiTemperature('repair'),
      temperature: getOpenUiTemperature('initial'),
    },
    limits: {
      chatMessageMaxChars: config.userPromptMaxChars,
      chatHistoryMaxItems: PREVIOUS_USER_MESSAGES_MAX_ITEMS,
      modelPromptMaxChars: config.modelPromptMaxChars,
      requestMaxBytes: config.requestMaxBytes,
      sourceMaxChars: getEffectiveSourceMaxChars(config),
      userPromptMaxChars: config.userPromptMaxChars,
    },
    repair: {
      maxRepairAttempts: config.maxRepairAttempts,
      maxValidationIssues: DEFAULT_MAX_REPAIR_VALIDATION_ISSUES,
    },
    timeouts: {
      streamIdleTimeoutMs: config.streamIdleTimeoutMs,
      streamMaxDurationMs: config.openAiRequestTimeoutMs,
    },
  };
}
