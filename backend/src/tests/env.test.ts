import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse as parseDotEnv } from 'dotenv';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppEnv } from '#backend/env.js';
import { readIntEnv, resolveBackendEnvPath, resolveFrontendDistDir, validateBackendConfig } from '#backend/env.js';
import { createTestEnv } from './createTestEnv.js';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const backendEnvExamplePath = path.resolve(currentDirectory, '../../.env.example');

function readRequiredEnvExampleNumber(name: string, values: Record<string, string>) {
  const rawValue = values[name];

  if (rawValue === undefined) {
    throw new Error(`backend/.env.example is missing ${name}.`);
  }

  const parsedValue = Number(rawValue);

  if (!Number.isInteger(parsedValue)) {
    throw new Error(`backend/.env.example ${name} must be an integer.`);
  }

  return parsedValue;
}

describe('env path resolution', () => {
  const workspaceRoot = path.join(path.sep, 'workspace');

  it.each([
    ['src', path.join(workspaceRoot, 'backend', 'src', 'env.ts')],
    ['dist', path.join(workspaceRoot, 'backend', 'dist', 'env.js')],
  ])('resolves backend/.env from %s module paths', (_label, modulePath) => {
    const moduleUrl = pathToFileURL(modulePath);

    expect(resolveBackendEnvPath(moduleUrl)).toBe(path.join(workspaceRoot, 'backend', '.env'));
  });

  it.each([
    ['src', path.join(workspaceRoot, 'backend', 'src', 'env.ts')],
    ['dist', path.join(workspaceRoot, 'backend', 'dist', 'env.js')],
  ])('resolves frontend/dist from %s module paths', (_label, modulePath) => {
    const moduleUrl = pathToFileURL(modulePath);

    expect(resolveFrontendDistDir(moduleUrl)).toBe(path.join(workspaceRoot, 'frontend', 'dist'));
  });
});

describe('readIntEnv', () => {
  afterEach(() => {
    delete process.env.KITTO_TEST_INT;
  });

  it('uses the fallback when the variable is unset', () => {
    expect(readIntEnv('KITTO_TEST_INT', 42, { min: 1 })).toBe(42);
  });

  it('parses integer values inside the configured range', () => {
    process.env.KITTO_TEST_INT = '1200000';

    expect(readIntEnv('KITTO_TEST_INT', 42, { min: 1, max: 2_000_000 })).toBe(1_200_000);
  });

  it('fails fast for invalid integer values', () => {
    process.env.KITTO_TEST_INT = '12.5';

    expect(() => readIntEnv('KITTO_TEST_INT', 42, { min: 1 })).toThrow('KITTO_TEST_INT must be an integer.');
  });

  it('fails fast for out-of-range values', () => {
    process.env.KITTO_TEST_INT = '0';

    expect(() => readIntEnv('KITTO_TEST_INT', 42, { min: 1 })).toThrow(
      'KITTO_TEST_INT must be greater than or equal to 1.',
    );
  });
});

describe('validateBackendConfig', () => {
  it('accepts the default backend config', () => {
    expect(() => validateBackendConfig(createTestEnv())).not.toThrow();
  });

  it('accepts the checked-in backend env example limits', () => {
    const envExample = parseDotEnv(readFileSync(backendEnvExamplePath));
    const configFromExample = createTestEnv({
      currentSourceEmergencyMaxChars: readRequiredEnvExampleNumber('CURRENT_SOURCE_EMERGENCY_MAX_CHARS', envExample),
      maxRepairAttempts: readRequiredEnvExampleNumber('LLM_MAX_REPAIR_ATTEMPTS', envExample),
      modelPromptMaxChars: readRequiredEnvExampleNumber('LLM_MODEL_PROMPT_MAX_CHARS', envExample),
      openAiRequestTimeoutMs: readRequiredEnvExampleNumber('OPENAI_REQUEST_TIMEOUT_MS', envExample),
      outputMaxBytes: readRequiredEnvExampleNumber('LLM_OUTPUT_MAX_BYTES', envExample),
      rateLimitMaxRequests: readRequiredEnvExampleNumber('RATE_LIMIT_MAX_REQUESTS', envExample),
      rateLimitWindowMs: readRequiredEnvExampleNumber('RATE_LIMIT_WINDOW_MS', envExample),
      requestBodyLimitBytes: readRequiredEnvExampleNumber('REQUEST_BODY_LIMIT_BYTES', envExample),
      requestMaxBytes: readRequiredEnvExampleNumber('LLM_REQUEST_MAX_BYTES', envExample),
      streamIdleTimeoutMs: readRequiredEnvExampleNumber('STREAM_IDLE_TIMEOUT_MS', envExample),
      userPromptMaxChars: readRequiredEnvExampleNumber('LLM_USER_PROMPT_MAX_CHARS', envExample),
    });

    expect(() => validateBackendConfig(configFromExample)).not.toThrow();
  });

  it('rejects model prompt budgets that cannot hold repair context', () => {
    const invalidConfig = createTestEnv({
      currentSourceEmergencyMaxChars: 80_000,
      modelPromptMaxChars: 174_095,
      userPromptMaxChars: 4_096,
    });

    expect(() => validateBackendConfig(invalidConfig)).toThrow(
      'LLM_MODEL_PROMPT_MAX_CHARS must be at least 174096',
    );
  });

  it.each([
    [
      'request body limit below request payload limit',
      { requestBodyLimitBytes: 119_999, requestMaxBytes: 120_000 },
      'REQUEST_BODY_LIMIT_BYTES must be at least 120000',
    ],
    [
      'request payload limit below two source snapshots',
      { currentSourceEmergencyMaxChars: 80_000, requestMaxBytes: 159_999 },
      'LLM_REQUEST_MAX_BYTES must be at least 160000',
    ],
    [
      'output limit below the source cap',
      { currentSourceEmergencyMaxChars: 80_000, outputMaxBytes: 79_999 },
      'LLM_OUTPUT_MAX_BYTES must be at least 80000',
    ],
    [
      'stream idle timeout above upstream request timeout',
      { openAiRequestTimeoutMs: 10_000, streamIdleTimeoutMs: 10_001 },
      'STREAM_IDLE_TIMEOUT_MS must be at most 10000',
    ],
    ['repair attempts below one', { maxRepairAttempts: 0 }, 'LLM_MAX_REPAIR_ATTEMPTS must be at least 1'],
    ['rate-limit window below one', { rateLimitWindowMs: 0 }, 'RATE_LIMIT_WINDOW_MS must be at least 1'],
    ['rate-limit capacity below one', { rateLimitMaxRequests: 0 }, 'RATE_LIMIT_MAX_REQUESTS must be at least 1'],
  ] satisfies Array<[string, Partial<AppEnv>, string]>)('rejects %s', (_label, overrides, expectedMessage) => {
    expect(() => validateBackendConfig(createTestEnv(overrides))).toThrow(expectedMessage);
  });
});
