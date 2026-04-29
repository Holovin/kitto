import type { AppEnv } from '#backend/env.js';

export function buildGlobalLimitLabels(env: AppEnv) {
  return [
    `optional context target LLM_MODEL_PROMPT_MAX_CHARS ${env.modelPromptMaxChars}`,
    `global LLM_REQUEST_MAX_BYTES ${env.requestMaxBytes}`,
    `global LLM_OUTPUT_MAX_BYTES ${env.outputMaxBytes}`,
  ];
}

export function buildPromptSectionLimitLabels(limits: {
  hardLimitChars?: number;
  softLimitChars?: number;
}) {
  if (limits.softLimitChars === undefined && limits.hardLimitChars === undefined) {
    return undefined;
  }

  if (limits.softLimitChars !== undefined && limits.hardLimitChars !== undefined) {
    return [`HARD ${limits.hardLimitChars}`, `SOFT ${limits.softLimitChars}`];
  }

  if (limits.softLimitChars !== undefined) {
    return [`SOFT ${limits.softLimitChars}`];
  }

  return [`HARD ${limits.hardLimitChars ?? 0}`];
}
