import type { AppEnv } from '../../env.js';
import { openUiEnvelopeFormat } from '../../services/openai/envelope.js';
import { getOpenUiMaxOutputTokens, getOpenUiTemperature } from './requestConfig.js';
import {
  OPENUI_SYSTEM_PROMPT_CACHE_KEY_PREFIX,
  buildOpenUiSystemPrompt,
  getOpenUiSystemPromptHash,
} from './systemPrompt.js';
import { getPromptToolSpecSummaries, type PromptToolSpecSummary } from './toolSpecs.js';
import { buildOpenUiUserPromptTemplate } from './userPrompt.js';
import { buildOpenUiRepairPromptTemplate } from './repairPrompt.js';

export interface PromptInfoSnapshot {
  config: {
    cacheKeyPrefix: string;
    maxOutputTokens: number;
    model: string;
    outputMaxBytes: number;
    repairTemperature: number;
    requestMaxBytes: number;
    structuredOutput: boolean;
    temperature: number;
  };
  envelopeSchema: Record<string, unknown>;
  repairPromptTemplate: string;
  systemPrompt: {
    hash: string;
    text: string;
  };
  toolSpecs: PromptToolSpecSummary[];
  requestPromptTemplate: string;
}

let cachedPromptInfoSnapshot: { cacheKey: string; snapshot: PromptInfoSnapshot } | null = null;

function buildPromptInfoSnapshotCacheKey(env: AppEnv) {
  return JSON.stringify({
    model: env.OPENAI_MODEL,
    outputMaxBytes: env.LLM_OUTPUT_MAX_BYTES,
    requestMaxBytes: env.LLM_REQUEST_MAX_BYTES,
    structuredOutput: env.LLM_STRUCTURED_OUTPUT,
  });
}

export function getPromptInfoSnapshot(env: AppEnv): PromptInfoSnapshot {
  const cacheKey = buildPromptInfoSnapshotCacheKey(env);

  if (cachedPromptInfoSnapshot?.cacheKey === cacheKey) {
    return cachedPromptInfoSnapshot.snapshot;
  }

  const structuredOutput = env.LLM_STRUCTURED_OUTPUT;
  const snapshot: PromptInfoSnapshot = {
    config: {
      cacheKeyPrefix: OPENUI_SYSTEM_PROMPT_CACHE_KEY_PREFIX,
      maxOutputTokens: getOpenUiMaxOutputTokens(env),
      model: env.OPENAI_MODEL,
      outputMaxBytes: env.LLM_OUTPUT_MAX_BYTES,
      repairTemperature: getOpenUiTemperature('repair'),
      requestMaxBytes: env.LLM_REQUEST_MAX_BYTES,
      structuredOutput,
      temperature: getOpenUiTemperature('initial'),
    },
    envelopeSchema: structuredClone(openUiEnvelopeFormat.schema) as Record<string, unknown>,
    repairPromptTemplate: buildOpenUiRepairPromptTemplate(env.LLM_MAX_REPAIR_ATTEMPTS, { structuredOutput }),
    systemPrompt: {
      hash: getOpenUiSystemPromptHash({ structuredOutput }),
      text: buildOpenUiSystemPrompt({ structuredOutput }),
    },
    toolSpecs: [...getPromptToolSpecSummaries()],
    requestPromptTemplate: buildOpenUiUserPromptTemplate({ structuredOutput }),
  };

  cachedPromptInfoSnapshot = {
    cacheKey,
    snapshot,
  };

  return snapshot;
}
