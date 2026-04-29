import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
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
} from './limits.js';

const DEFAULT_OPENAI_MODEL = 'gpt-5.4-mini';
const DEFAULT_FRONTEND_ORIGIN = 'http://localhost:5555';
const DEFAULT_PORT = 8787;
const LOG_LEVELS = ['debug', 'error', 'info', 'silent', 'warn'] as const;
const REPAIR_PROMPT_RESERVED_CHARS = 10_000;

type LogLevel = (typeof LOG_LEVELS)[number];
const DEFAULT_LOG_LEVEL: LogLevel = 'info';

export interface BackendConfig {
  currentSourceEmergencyMaxChars: number;
  frontendDistDir: string;
  frontendOrigin: string;
  logLevel: LogLevel;
  maxRepairAttempts: number;
  modelPromptMaxChars: number;
  openAiApiKey: string;
  openAiModel: string;
  openAiRequestTimeoutMs: number;
  outputMaxBytes: number;
  port: number;
  promptIoLog: boolean;
  rateLimitMaxRequests: number;
  rateLimitWindowMs: number;
  requestBodyLimitBytes: number;
  requestMaxBytes: number;
  streamIdleTimeoutMs: number;
  userPromptMaxChars: number;
}

export type AppEnv = BackendConfig;

function readStringEnv(name: string, fallback: string) {
  return process.env[name] ?? fallback;
}

export function readIntEnv(name: string, fallback: number, { max, min }: { max?: number; min?: number } = {}) {
  const rawValue = process.env[name];

  if (rawValue === undefined || rawValue === '') {
    return fallback;
  }

  const parsedValue = Number(rawValue);

  if (!Number.isInteger(parsedValue)) {
    throw new Error(`${name} must be an integer.`);
  }

  if (min !== undefined && parsedValue < min) {
    throw new Error(`${name} must be greater than or equal to ${min}.`);
  }

  if (max !== undefined && parsedValue > max) {
    throw new Error(`${name} must be less than or equal to ${max}.`);
  }

  return parsedValue;
}

function readBoolEnv(name: string, fallback: boolean) {
  const rawValue = process.env[name];

  if (rawValue === undefined || rawValue === '') {
    return fallback;
  }

  const normalizedValue = rawValue.trim().toLowerCase();

  if (['1', 'true', 'yes', 'on'].includes(normalizedValue)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalizedValue)) {
    return false;
  }

  throw new Error(`${name} must be a boolean.`);
}

function readLogLevelEnv(name: string, fallback: LogLevel): LogLevel {
  const value = readStringEnv(name, fallback);

  if (LOG_LEVELS.some((level) => level === value)) {
    return value as LogLevel;
  }

  throw new Error(`${name} must be one of ${LOG_LEVELS.join(', ')}.`);
}

export function resolveBackendEnvPath(moduleUrl: string | URL) {
  return path.resolve(path.dirname(fileURLToPath(moduleUrl)), '../.env');
}

export function resolveFrontendDistDir(moduleUrl: string | URL) {
  return path.resolve(path.dirname(fileURLToPath(moduleUrl)), '../../frontend/dist');
}

function expectAtLeast({
  actual,
  actualName,
  expected,
  expectedDescription,
}: {
  actual: number;
  actualName: string;
  expected: number;
  expectedDescription: string;
}) {
  if (actual >= expected) {
    return undefined;
  }

  return `${actualName} must be at least ${expected} (${expectedDescription}); received ${actual}.`;
}

function expectAtMost({
  actual,
  actualName,
  expected,
  expectedDescription,
}: {
  actual: number;
  actualName: string;
  expected: number;
  expectedDescription: string;
}) {
  if (actual <= expected) {
    return undefined;
  }

  return `${actualName} must be at most ${expected} (${expectedDescription}); received ${actual}.`;
}

export function validateBackendConfig(config: BackendConfig) {
  const repairPromptMinChars =
    config.currentSourceEmergencyMaxChars * 2 + config.userPromptMaxChars + REPAIR_PROMPT_RESERVED_CHARS;
  const requestMinBytes = config.currentSourceEmergencyMaxChars * 2;
  const issues = [
    expectAtLeast({
      actual: config.modelPromptMaxChars,
      actualName: 'LLM_MODEL_PROMPT_MAX_CHARS',
      expected: repairPromptMinChars,
      expectedDescription:
        'CURRENT_SOURCE_EMERGENCY_MAX_CHARS * 2 + LLM_USER_PROMPT_MAX_CHARS + 10000 repair overhead',
    }),
    expectAtLeast({
      actual: config.requestBodyLimitBytes,
      actualName: 'REQUEST_BODY_LIMIT_BYTES',
      expected: config.requestMaxBytes,
      expectedDescription: 'LLM_REQUEST_MAX_BYTES',
    }),
    expectAtLeast({
      actual: config.requestMaxBytes,
      actualName: 'LLM_REQUEST_MAX_BYTES',
      expected: requestMinBytes,
      expectedDescription: 'CURRENT_SOURCE_EMERGENCY_MAX_CHARS * 2',
    }),
    expectAtLeast({
      actual: config.outputMaxBytes,
      actualName: 'LLM_OUTPUT_MAX_BYTES',
      expected: config.currentSourceEmergencyMaxChars,
      expectedDescription: 'CURRENT_SOURCE_EMERGENCY_MAX_CHARS',
    }),
    expectAtMost({
      actual: config.streamIdleTimeoutMs,
      actualName: 'STREAM_IDLE_TIMEOUT_MS',
      expected: config.openAiRequestTimeoutMs,
      expectedDescription: 'OPENAI_REQUEST_TIMEOUT_MS',
    }),
    expectAtLeast({
      actual: config.maxRepairAttempts,
      actualName: 'LLM_MAX_REPAIR_ATTEMPTS',
      expected: 1,
      expectedDescription: 'at least one automatic repair attempt',
    }),
    expectAtLeast({
      actual: config.rateLimitWindowMs,
      actualName: 'RATE_LIMIT_WINDOW_MS',
      expected: 1,
      expectedDescription: 'positive rate-limit window',
    }),
    expectAtLeast({
      actual: config.rateLimitMaxRequests,
      actualName: 'RATE_LIMIT_MAX_REQUESTS',
      expected: 1,
      expectedDescription: 'positive rate-limit capacity',
    }),
  ].filter((issue): issue is string => Boolean(issue));

  if (issues.length > 0) {
    throw new Error(`Invalid backend configuration:\n- ${issues.join('\n- ')}`);
  }
}

const backendEnvPath = resolveBackendEnvPath(import.meta.url);
const frontendDistDir = resolveFrontendDistDir(import.meta.url);

export function loadEnv(): AppEnv {
  dotenv.config({ path: backendEnvPath, quiet: true });

  const config: BackendConfig = {
    currentSourceEmergencyMaxChars: readIntEnv(
      'CURRENT_SOURCE_EMERGENCY_MAX_CHARS',
      DEFAULT_CURRENT_SOURCE_EMERGENCY_MAX_CHARS,
      { min: 1 },
    ),
    frontendDistDir,
    frontendOrigin: readStringEnv('FRONTEND_ORIGIN', DEFAULT_FRONTEND_ORIGIN),
    logLevel: readLogLevelEnv('LOG_LEVEL', DEFAULT_LOG_LEVEL),
    maxRepairAttempts: readIntEnv('LLM_MAX_REPAIR_ATTEMPTS', DEFAULT_LLM_MAX_REPAIR_ATTEMPTS, { min: 1 }),
    modelPromptMaxChars: readIntEnv('LLM_MODEL_PROMPT_MAX_CHARS', DEFAULT_LLM_MODEL_PROMPT_MAX_CHARS, { min: 1 }),
    openAiApiKey: readStringEnv('OPENAI_API_KEY', ''),
    openAiModel: readStringEnv('OPENAI_MODEL', DEFAULT_OPENAI_MODEL),
    openAiRequestTimeoutMs: readIntEnv('OPENAI_REQUEST_TIMEOUT_MS', DEFAULT_OPENAI_REQUEST_TIMEOUT_MS, { min: 1 }),
    outputMaxBytes: readIntEnv('LLM_OUTPUT_MAX_BYTES', DEFAULT_LLM_OUTPUT_MAX_BYTES, { min: 1 }),
    port: readIntEnv('PORT', DEFAULT_PORT, { max: 65_535, min: 1 }),
    promptIoLog: readBoolEnv('PROMPT_IO_LOG', false),
    rateLimitMaxRequests: readIntEnv('RATE_LIMIT_MAX_REQUESTS', DEFAULT_RATE_LIMIT_MAX_REQUESTS, { min: 1 }),
    rateLimitWindowMs: readIntEnv('RATE_LIMIT_WINDOW_MS', DEFAULT_RATE_LIMIT_WINDOW_MS, { min: 1 }),
    requestBodyLimitBytes: readIntEnv('REQUEST_BODY_LIMIT_BYTES', DEFAULT_REQUEST_BODY_LIMIT_BYTES, { min: 1 }),
    requestMaxBytes: readIntEnv('LLM_REQUEST_MAX_BYTES', DEFAULT_LLM_REQUEST_MAX_BYTES, { min: 1 }),
    streamIdleTimeoutMs: readIntEnv('STREAM_IDLE_TIMEOUT_MS', DEFAULT_STREAM_IDLE_TIMEOUT_MS, { min: 1 }),
    userPromptMaxChars: readIntEnv('LLM_USER_PROMPT_MAX_CHARS', DEFAULT_LLM_USER_PROMPT_MAX_CHARS, { min: 1 }),
  };

  validateBackendConfig(config);

  return config;
}
