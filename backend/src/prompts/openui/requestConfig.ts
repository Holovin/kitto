import type { AppEnv } from '#backend/env.js';
import type { PromptBuildRequest } from './types.js';

// Structured OpenUI DSL output should stay conservative; repair passes stay tighter.
const INITIAL_OPENUI_TEMPERATURE = 0.4;
const REPAIR_OPENUI_TEMPERATURE = 0.2;
const OPENUI_MAX_OUTPUT_TOKENS_FLOOR = 4_096;

export function getOpenUiTemperature(mode: PromptBuildRequest['mode']) {
  return mode === 'repair' ? REPAIR_OPENUI_TEMPERATURE : INITIAL_OPENUI_TEMPERATURE;
}

export function getOpenUiMaxOutputTokens(env: AppEnv) {
  // Keep an explicit token ceiling instead of inheriting model defaults; the byte limit
  // remains the hard backend guardrail for the returned source/envelope.
  return Math.max(OPENUI_MAX_OUTPUT_TOKENS_FLOOR, Math.ceil(env.LLM_OUTPUT_MAX_BYTES / 4));
}
