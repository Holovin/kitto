import type { AppEnv } from '#backend/env.js';
import { openUiEnvelopeFormat } from '#backend/services/openai/envelope.js';
import type { BuilderPromptContextSection } from '@kitto-openui/shared/builderApiContract.js';
import { getOpenUiMaxOutputTokens, getOpenUiTemperature } from './requestConfig.js';
import {
  OPENUI_SYSTEM_PROMPT_CACHE_KEY_PREFIX,
  buildOpenUiSystemPrompt,
  buildOpenUiSystemPromptForIntents,
  getOpenUiSystemPromptCacheKey,
  getOpenUiSystemPromptHash,
} from './systemPrompt.js';
import { detectPromptRequestIntent, getPromptIntentCacheVector } from './promptIntents.js';
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
  staticPromptContextSections: BuilderPromptContextSection[];
  systemPrompt: PromptInfoSystemPromptVariant;
  systemPromptVariants: PromptInfoSystemPromptVariant[];
  toolSpecs: PromptToolSpecSummary[];
  requestPromptTemplate: string;
}

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
    id: 'control-showcase',
    label: 'Control showcase',
    prompt: 'Build an app with every control you know.',
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
    id: 'delete',
    label: 'Delete',
    prompt: 'Create a todo list where items can be removed.',
  },
  {
    id: 'multi-screen',
    label: 'Multi-screen',
    prompt: 'Create a quiz with three questions on separate screens.',
  },
] as const;

let cachedPromptInfoSnapshot: { cacheKey: string; snapshot: PromptInfoSnapshot } | null = null;

function buildPromptInfoSnapshotCacheKey(env: AppEnv) {
  return JSON.stringify({
    model: env.OPENAI_MODEL,
    modelPromptMaxChars: env.LLM_MODEL_PROMPT_MAX_CHARS,
    outputMaxBytes: env.LLM_OUTPUT_MAX_BYTES,
    requestMaxBytes: env.LLM_REQUEST_MAX_BYTES,
    userPromptMaxChars: env.LLM_USER_PROMPT_MAX_CHARS,
  });
}

function buildBaseSystemPromptVariant(): PromptInfoSystemPromptVariant {
  return {
    cacheKey: getOpenUiSystemPromptCacheKey(),
    hash: getOpenUiSystemPromptHash(),
    id: 'base',
    intentVector: getPromptIntentCacheVector(undefined),
    label: 'Base',
    sampleRequest: null,
    text: buildOpenUiSystemPrompt(),
  };
}

function buildSystemPromptVariant(
  definition: (typeof INTENT_CONTEXT_VARIANT_DEFINITIONS)[number],
): PromptInfoSystemPromptVariant {
  if (definition.prompt === null) {
    return buildBaseSystemPromptVariant();
  }

  const requestIntent = detectPromptRequestIntent(definition.prompt, {
    currentSource: '',
    mode: 'initial',
  });

  return {
    cacheKey: getOpenUiSystemPromptCacheKey(requestIntent),
    hash: getOpenUiSystemPromptHash(requestIntent),
    id: definition.id,
    intentVector: getPromptIntentCacheVector(definition.prompt),
    label: definition.label,
    sampleRequest: definition.prompt,
    text: buildOpenUiSystemPromptForIntents(requestIntent),
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
      currentSource: '',
      mode: 'initial',
      prompt,
    }),
  };
}

function createStaticPromptContextSection(
  priority: number,
  name: string,
  content: string,
  protectedSection: boolean,
  options: {
    unminifiedChars?: number;
  } = {},
): BuilderPromptContextSection {
  return {
    name,
    chars: content.length,
    content,
    included: true,
    priority,
    protected: protectedSection,
    ...(options.unminifiedChars !== undefined && options.unminifiedChars !== content.length
      ? { unminifiedChars: options.unminifiedChars }
      : {}),
  };
}

function buildStaticPromptContextSections(args: {
  baseIntentContext: PromptInfoIntentContextVariant;
  baseSystemPrompt: PromptInfoSystemPromptVariant;
  repairPromptTemplate: string;
  requestPromptTemplate: string;
}) {
  const structuredOutputContract = JSON.stringify(openUiEnvelopeFormat.schema);
  const unminifiedStructuredOutputContract = JSON.stringify(openUiEnvelopeFormat.schema, null, 2);

  return [
    createStaticPromptContextSection(1, 'system/contract', args.baseSystemPrompt.text, true),
    createStaticPromptContextSection(2, 'structuredOutputContract', structuredOutputContract, true, {
      unminifiedChars: unminifiedStructuredOutputContract.length,
    }),
    createStaticPromptContextSection(3, 'intentContext', args.baseIntentContext.text, false),
    createStaticPromptContextSection(6, 'requestPromptTemplate', args.requestPromptTemplate, false),
    createStaticPromptContextSection(7, 'repairPromptTemplate', args.repairPromptTemplate, false),
  ];
}

export function getPromptInfoSnapshot(env: AppEnv): PromptInfoSnapshot {
  const cacheKey = buildPromptInfoSnapshotCacheKey(env);

  if (cachedPromptInfoSnapshot?.cacheKey === cacheKey) {
    return cachedPromptInfoSnapshot.snapshot;
  }

  const baseSystemPrompt = buildBaseSystemPromptVariant();
  const systemPromptVariants = INTENT_CONTEXT_VARIANT_DEFINITIONS.map(buildSystemPromptVariant);
  const intentContextVariants = INTENT_CONTEXT_VARIANT_DEFINITIONS.map(buildIntentContextVariant);
  const baseIntentContext = intentContextVariants[0];

  if (!baseIntentContext) {
    throw new Error('Prompt diagnostics must include a base intent context variant.');
  }

  const requestPromptTemplate = buildOpenUiUserPromptTemplate();
  const repairPromptTemplate = buildOpenUiRepairPromptTemplate(env.LLM_MAX_REPAIR_ATTEMPTS);
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
    repairPromptTemplate,
    staticPromptContextSections: buildStaticPromptContextSections({
      baseIntentContext,
      baseSystemPrompt,
      repairPromptTemplate,
      requestPromptTemplate,
    }),
    systemPrompt: baseSystemPrompt,
    systemPromptVariants,
    toolSpecs: [...getPromptToolSpecSummaries()],
    requestPromptTemplate,
  };

  cachedPromptInfoSnapshot = {
    cacheKey,
    snapshot,
  };

  return snapshot;
}
