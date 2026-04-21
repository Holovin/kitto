import { createHash } from 'node:crypto';
import OpenAI from 'openai';
import type { ResponseInput } from 'openai/resources/responses/responses';
import type { AppEnv } from '../../env.js';
import {
  buildOpenUiSystemPrompt,
  buildOpenUiUserPrompt,
  getOpenUiSystemPromptCacheKey,
  type PromptBuildRequest,
} from '../../prompts/openui.js';
import { openUiEnvelopeFormat } from './envelope.js';

type OpenAiClient = Pick<OpenAI, 'responses'>;
type OpenAiClientFactory = (env: AppEnv) => OpenAiClient;

let cachedClient: { apiKey: string; client: OpenAiClient; overrideFactory: OpenAiClientFactory | null } | null = null;
let openAiClientFactoryOverride: OpenAiClientFactory | null = null;

// Keep initial drafts somewhat creative, but repair passes should stay tighter.
const INITIAL_OPENUI_TEMPERATURE = 0.6;
const REPAIR_OPENUI_TEMPERATURE = 0.2;
const OPENUI_MAX_OUTPUT_TOKENS_FLOOR = 4_096;
const STRUCTURED_SYSTEM_PROMPT = buildOpenUiSystemPrompt();
const PLAIN_TEXT_SYSTEM_PROMPT = buildOpenUiSystemPrompt({ structuredOutput: false });
const STRUCTURED_SYSTEM_PROMPT_HASH = createHash('sha256').update(STRUCTURED_SYSTEM_PROMPT).digest('hex').slice(0, 16);
const PLAIN_TEXT_SYSTEM_PROMPT_HASH = createHash('sha256').update(PLAIN_TEXT_SYSTEM_PROMPT).digest('hex').slice(0, 16);
const STRUCTURED_SYSTEM_PROMPT_CACHE_KEY = getOpenUiSystemPromptCacheKey();
const PLAIN_TEXT_SYSTEM_PROMPT_CACHE_KEY = getOpenUiSystemPromptCacheKey({ structuredOutput: false });

export function getOpenUiTemperature(mode: PromptBuildRequest['mode']) {
  return mode === 'repair' ? REPAIR_OPENUI_TEMPERATURE : INITIAL_OPENUI_TEMPERATURE;
}

export function getOpenUiMaxOutputTokens(env: AppEnv) {
  // Keep an explicit token ceiling instead of inheriting model defaults; the byte limit
  // remains the hard backend guardrail for the returned source/envelope.
  return Math.max(OPENUI_MAX_OUTPUT_TOKENS_FLOOR, Math.ceil(env.LLM_OUTPUT_MAX_BYTES / 4));
}

function getSystemPrompt(structuredOutput: boolean) {
  return structuredOutput ? STRUCTURED_SYSTEM_PROMPT : PLAIN_TEXT_SYSTEM_PROMPT;
}

function getSystemPromptCacheKey(structuredOutput: boolean) {
  return structuredOutput ? STRUCTURED_SYSTEM_PROMPT_CACHE_KEY : PLAIN_TEXT_SYSTEM_PROMPT_CACHE_KEY;
}

export function getSystemPromptHash(structuredOutput: boolean) {
  return structuredOutput ? STRUCTURED_SYSTEM_PROMPT_HASH : PLAIN_TEXT_SYSTEM_PROMPT_HASH;
}

function createDefaultOpenAiClient(env: AppEnv): OpenAiClient {
  return new OpenAI({
    apiKey: env.OPENAI_API_KEY,
  });
}

// Test-only override used by local provokers and integration helpers.
export function setOpenAiClientFactoryForTesting(factory: OpenAiClientFactory | null) {
  openAiClientFactoryOverride = factory;
  cachedClient = null;
}

export function resetOpenAiClientForTesting() {
  setOpenAiClientFactoryForTesting(null);
}

export function getClient(env: AppEnv) {
  if (!env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured.');
  }

  if (
    !cachedClient ||
    cachedClient.apiKey !== env.OPENAI_API_KEY ||
    cachedClient.overrideFactory !== openAiClientFactoryOverride
  ) {
    const clientFactory = openAiClientFactoryOverride ?? createDefaultOpenAiClient;

    cachedClient = {
      apiKey: env.OPENAI_API_KEY,
      client: clientFactory(env),
      overrideFactory: openAiClientFactoryOverride,
    };
  }

  return cachedClient.client;
}

function buildResponseInput(env: AppEnv, request: PromptBuildRequest): ResponseInput {
  const structuredOutput = env.LLM_STRUCTURED_OUTPUT;

  return [
    {
      role: 'system',
      content: [{ type: 'input_text', text: getSystemPrompt(structuredOutput) }],
    },
    {
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: buildOpenUiUserPrompt(request, {
            chatHistoryMaxItems: env.LLM_CHAT_HISTORY_MAX_ITEMS,
            structuredOutput,
          }),
        },
      ],
    },
  ];
}

export function buildResponseRequest(env: AppEnv, request: PromptBuildRequest) {
  const structuredOutput = env.LLM_STRUCTURED_OUTPUT;
  const baseRequest = {
    model: env.OPENAI_MODEL,
    input: buildResponseInput(env, request),
    max_output_tokens: getOpenUiMaxOutputTokens(env),
    prompt_cache_key: getSystemPromptCacheKey(structuredOutput),
    temperature: getOpenUiTemperature(request.mode),
  };

  if (!structuredOutput) {
    return baseRequest;
  }

  return {
    ...baseRequest,
    text: {
      format: openUiEnvelopeFormat,
    },
  };
}

export type OpenUiResponseRequest = ReturnType<typeof buildResponseRequest>;
