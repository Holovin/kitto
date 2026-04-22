import OpenAI from 'openai';
import type { ResponseInput } from 'openai/resources/responses/responses';
import type { AppEnv } from '../../env.js';
import {
  buildOpenUiAssistantSummaryMessage,
  buildOpenUiSystemPrompt,
  filterPromptBuildChatHistory,
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

function getSystemPrompt(structuredOutput: boolean, prompt?: string) {
  return buildOpenUiSystemPrompt({
    prompt,
    structuredOutput,
  });
}

function getSystemPromptCacheKey(structuredOutput: boolean, prompt?: string) {
  return getOpenUiSystemPromptCacheKey({
    prompt,
    structuredOutput,
  });
}

export function getSystemPromptHash(structuredOutput: boolean, prompt?: string) {
  return getOpenUiSystemPromptHash({
    prompt,
    structuredOutput,
  });
}

export type OpenUiResponseInputShape = 'flat-text' | 'role-based';

export function getResponseInputShape(request: PromptBuildRequest): OpenUiResponseInputShape {
  return request.mode === 'repair' ? 'flat-text' : 'role-based';
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

function createTextInputMessage(role: 'system' | 'user' | 'assistant', text: string): ResponseInput[number] {
  return {
    role,
    content: [
      {
        type: 'input_text',
        text,
      },
    ],
  };
}

function buildResponseInput(env: AppEnv, request: PromptBuildRequest): ResponseInput {
  const structuredOutput = env.LLM_STRUCTURED_OUTPUT;
  const systemMessage = createTextInputMessage('system', getSystemPrompt(structuredOutput, request.prompt));

  if (request.mode === 'repair') {
    return [
      systemMessage,
      createTextInputMessage(
        'user',
        buildOpenUiUserPrompt(request, {
          chatHistoryMaxItems: env.LLM_CHAT_HISTORY_MAX_ITEMS,
          maxRepairAttempts: env.LLM_MAX_REPAIR_ATTEMPTS,
          promptMaxChars: env.LLM_PROMPT_MAX_CHARS,
          structuredOutput,
        }),
      ),
    ];
  }

  const recentHistory = filterPromptBuildChatHistory(request.chatHistory);

  return [
    systemMessage,
    ...recentHistory.map((message) =>
      message.role === 'assistant'
        ? createTextInputMessage('assistant', buildOpenUiAssistantSummaryMessage(message.content))
        : createTextInputMessage('user', message.content),
    ),
    createTextInputMessage(
      'user',
      buildOpenUiUserPrompt(request, {
        chatHistoryMaxItems: env.LLM_CHAT_HISTORY_MAX_ITEMS,
        maxRepairAttempts: env.LLM_MAX_REPAIR_ATTEMPTS,
        promptMaxChars: env.LLM_PROMPT_MAX_CHARS,
        structuredOutput,
      }),
    ),
  ];
}

export function buildResponseRequest(env: AppEnv, request: PromptBuildRequest) {
  const structuredOutput = env.LLM_STRUCTURED_OUTPUT;
  const baseRequest = {
    model: env.OPENAI_MODEL,
    input: buildResponseInput(env, request),
    max_output_tokens: getOpenUiMaxOutputTokens(env),
    prompt_cache_key: getSystemPromptCacheKey(structuredOutput, request.prompt),
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
