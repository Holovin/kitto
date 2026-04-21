import OpenAI from 'openai';
import type { ResponseInput } from 'openai/resources/responses/responses';
import type { AppEnv } from '../../env.js';
import {
  buildOpenUiSystemPrompt,
  getOpenUiSystemPromptHash,
  buildOpenUiUserPrompt,
  getOpenUiSystemPromptCacheKey,
  type PromptBuildRequest,
} from '../../prompts/openui.js';
import { getOpenUiMaxOutputTokens, getOpenUiTemperature } from '../../prompts/openui/requestConfig.js';
import { openUiEnvelopeFormat } from './envelope.js';

type OpenAiClient = Pick<OpenAI, 'responses'>;
type OpenAiClientFactory = (env: AppEnv) => OpenAiClient;

let cachedClient: { apiKey: string; client: OpenAiClient; overrideFactory: OpenAiClientFactory | null } | null = null;
let openAiClientFactoryOverride: OpenAiClientFactory | null = null;

const STRUCTURED_SYSTEM_PROMPT = buildOpenUiSystemPrompt();
const PLAIN_TEXT_SYSTEM_PROMPT = buildOpenUiSystemPrompt({ structuredOutput: false });
const STRUCTURED_SYSTEM_PROMPT_HASH = getOpenUiSystemPromptHash();
const PLAIN_TEXT_SYSTEM_PROMPT_HASH = getOpenUiSystemPromptHash({ structuredOutput: false });
const STRUCTURED_SYSTEM_PROMPT_CACHE_KEY = getOpenUiSystemPromptCacheKey();
const PLAIN_TEXT_SYSTEM_PROMPT_CACHE_KEY = getOpenUiSystemPromptCacheKey({ structuredOutput: false });

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
