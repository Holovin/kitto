import type { AppEnv } from '../../env.js';
import { openUiEnvelopeFormat } from '../../services/openai/envelope.js';
import { getOpenUiMaxOutputTokens, getOpenUiTemperature } from './requestConfig.js';
import {
  OPENUI_SYSTEM_PROMPT_CACHE_KEY_PREFIX,
  buildOpenUiSystemPrompt,
  getOpenUiSystemPromptCacheKey,
  getOpenUiSystemPromptHash,
} from './systemPrompt.js';
import { getPromptIntentCacheVector } from './promptIntents.js';
import { getPromptToolSpecSummaries, type PromptToolSpecSummary } from './toolSpecs.js';
import { buildOpenUiIntentContextPrompt, buildOpenUiUserPromptTemplate } from './userPrompt.js';
import { buildOpenUiRepairPromptTemplate } from './repairPrompt.js';

export interface PromptInfoSystemPromptVariant {
  cacheKey: string;
  hash: string;
  id: string;
  intentVector: string;
  label: string;
  sampleRequest: string | null;
  text: string;
}

export interface PromptInfoIntentContextVariant {
  id: string;
  intentVector: string;
  label: string;
  sampleRequest: string | null;
  text: string;
}

export interface PromptInfoSnapshot {
  config: {
    cacheKeyPrefix: string;
    maxOutputTokens: number;
    model: string;
    modelPromptMaxChars: number;
    outputMaxBytes: number;
    repairTemperature: number;
    requestMaxBytes: number;
    temperature: number;
    userPromptMaxChars: number;
  };
  envelopeSchema: Record<string, unknown>;
  intentContext: PromptInfoIntentContextVariant;
  intentContextVariants: PromptInfoIntentContextVariant[];
  repairPromptTemplate: string;
  systemPrompt: PromptInfoSystemPromptVariant;
  systemPromptVariants: PromptInfoSystemPromptVariant[];
  toolSpecs: PromptToolSpecSummary[];
  requestPromptTemplate: string;
}

let cachedPromptInfoSnapshot: { cacheKey: string; snapshot: PromptInfoSnapshot } | null = null;

const SYSTEM_PROMPT_INTENT_VARIANT_DEFINITIONS = [
  {
    id: 'base',
    label: 'Base',
    prompt: null,
  },
] as const;

const INTENT_CONTEXT_VARIANT_DEFINITIONS = [
  {
    id: 'base',
    label: 'Base',
    prompt: null,
  },
  {
    id: 'todo',
    label: 'Todo',
    prompt: 'Create a todo list.',
  },
  {
    id: 'theme',
    label: 'Theme',
    prompt: 'Create a dark mode profile form.',
  },
  {
    id: 'filtering',
    label: 'Filter',
    prompt: 'Create a searchable catalog.',
  },
  {
    id: 'validation',
    label: 'Validation',
    prompt: 'Create a signup form with required email validation.',
  },
  {
    id: 'compute',
    label: 'Compute',
    prompt: 'Create a calculator that computes totals.',
  },
  {
    id: 'random',
    label: 'Random',
    prompt: 'Roll a dice.',
  },
  {
    id: 'multi-screen',
    label: 'Multi-screen',
    prompt: 'Create a three-screen quiz.',
  },
] as const;

function buildPromptInfoSnapshotCacheKey(env: AppEnv) {
  return JSON.stringify({
    model: env.OPENAI_MODEL,
    modelPromptMaxChars: env.LLM_MODEL_PROMPT_MAX_CHARS,
    outputMaxBytes: env.LLM_OUTPUT_MAX_BYTES,
    requestMaxBytes: env.LLM_REQUEST_MAX_BYTES,
    userPromptMaxChars: env.LLM_USER_PROMPT_MAX_CHARS,
  });
}

function buildSystemPromptVariant(
  definition: (typeof SYSTEM_PROMPT_INTENT_VARIANT_DEFINITIONS)[number],
): PromptInfoSystemPromptVariant {
  const prompt = definition.prompt ?? undefined;
  const options = { prompt };

  return {
    cacheKey: getOpenUiSystemPromptCacheKey(options),
    hash: getOpenUiSystemPromptHash(options),
    id: definition.id,
    intentVector: getPromptIntentCacheVector(prompt),
    label: definition.label,
    sampleRequest: definition.prompt,
    text: buildOpenUiSystemPrompt(options),
  };
}

function buildIntentContextVariant(
  definition: (typeof INTENT_CONTEXT_VARIANT_DEFINITIONS)[number],
): PromptInfoIntentContextVariant {
  const prompt = definition.prompt ?? '';

  return {
    id: definition.id,
    intentVector: getPromptIntentCacheVector(definition.prompt ?? undefined),
    label: definition.label,
    sampleRequest: definition.prompt,
    text: buildOpenUiIntentContextPrompt({
      chatHistory: [],
      currentSource: '',
      mode: 'initial',
      prompt,
    }),
  };
}

export function getPromptInfoSnapshot(env: AppEnv): PromptInfoSnapshot {
  const cacheKey = buildPromptInfoSnapshotCacheKey(env);

  if (cachedPromptInfoSnapshot?.cacheKey === cacheKey) {
    return cachedPromptInfoSnapshot.snapshot;
  }

  const systemPromptVariants = SYSTEM_PROMPT_INTENT_VARIANT_DEFINITIONS.map(buildSystemPromptVariant);
  const baseSystemPrompt = systemPromptVariants[0];
  const intentContextVariants = INTENT_CONTEXT_VARIANT_DEFINITIONS.map(buildIntentContextVariant);
  const baseIntentContext = intentContextVariants[0];

  if (!baseSystemPrompt) {
    throw new Error('Prompt diagnostics must include a base system prompt variant.');
  }

  if (!baseIntentContext) {
    throw new Error('Prompt diagnostics must include a base intent context variant.');
  }

  const snapshot: PromptInfoSnapshot = {
    config: {
      cacheKeyPrefix: OPENUI_SYSTEM_PROMPT_CACHE_KEY_PREFIX,
      maxOutputTokens: getOpenUiMaxOutputTokens(env),
      model: env.OPENAI_MODEL,
      modelPromptMaxChars: env.LLM_MODEL_PROMPT_MAX_CHARS,
      outputMaxBytes: env.LLM_OUTPUT_MAX_BYTES,
      repairTemperature: getOpenUiTemperature('repair'),
      requestMaxBytes: env.LLM_REQUEST_MAX_BYTES,
      temperature: getOpenUiTemperature('initial'),
      userPromptMaxChars: env.LLM_USER_PROMPT_MAX_CHARS,
    },
    envelopeSchema: structuredClone(openUiEnvelopeFormat.schema) as Record<string, unknown>,
    intentContext: baseIntentContext,
    intentContextVariants,
    repairPromptTemplate: buildOpenUiRepairPromptTemplate(env.LLM_MAX_REPAIR_ATTEMPTS),
    systemPrompt: baseSystemPrompt,
    systemPromptVariants,
    toolSpecs: [...getPromptToolSpecSummaries()],
    requestPromptTemplate: buildOpenUiUserPromptTemplate(),
  };

  cachedPromptInfoSnapshot = {
    cacheKey,
    snapshot,
  };

  return snapshot;
}
