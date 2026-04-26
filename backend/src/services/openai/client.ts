import OpenAI from 'openai';
import type { ResponseInput } from 'openai/resources/responses/responses';
import type { AppEnv } from '#backend/env.js';
import {
  buildOpenUiAssistantSummaryMessage,
  buildOpenUiIntentContextPrompt,
  buildOpenUiRawUserRequest,
  buildOpenUiRepairRoleMessages,
  buildOpenUiSystemPrompt,
  filterPromptBuildChatHistory,
  getOpenUiSystemPromptHash,
  buildOpenUiUserPrompt,
  getOpenUiSystemPromptCacheKey,
  type PromptBuildRequest,
} from '#backend/prompts/openui.js';
import { getOpenUiMaxOutputTokens, getOpenUiTemperature } from '#backend/prompts/openui/requestConfig.js';
import { openUiEnvelopeFormat } from './envelope.js';

type OpenAiClient = Pick<OpenAI, 'responses'>;
type OpenAiClientFactory = (env: AppEnv) => OpenAiClient;

let cachedClient: { apiKey: string; client: OpenAiClient; overrideFactory: OpenAiClientFactory | null } | null = null;
let openAiClientFactoryOverride: OpenAiClientFactory | null = null;

export function getSystemPromptHash(prompt?: string) {
  return getOpenUiSystemPromptHash({
    prompt,
  });
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
  if (role === 'assistant') {
    return {
      role,
      content: text,
      phase: 'final_answer',
    };
  }

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
  if (request.mode === 'repair') {
    const repairMessages = buildOpenUiRepairRoleMessages({
      attemptNumber:
        typeof request.repairAttemptNumber === 'number' && request.repairAttemptNumber > 0
          ? Math.floor(request.repairAttemptNumber)
          : 1,
      chatHistory: filterPromptBuildChatHistory(request.chatHistory),
      committedSource: typeof request.currentSource === 'string' ? request.currentSource : '',
      invalidSource: typeof request.invalidDraft === 'string' ? request.invalidDraft : '',
      issues: Array.isArray(request.validationIssues) ? request.validationIssues : [],
      maxRepairAttempts: env.LLM_MAX_REPAIR_ATTEMPTS,
      promptMaxChars: env.LLM_MODEL_PROMPT_MAX_CHARS,
      userPrompt: buildOpenUiRawUserRequest(request),
    });

    return [
      createTextInputMessage('system', [buildOpenUiSystemPrompt(), repairMessages.systemInstruction].join('\n\n')),
      createTextInputMessage('user', repairMessages.requestContext),
      createTextInputMessage('assistant', repairMessages.failedDraft),
      createTextInputMessage('user', repairMessages.correctionRequest),
    ];
  }

  const systemMessage = createTextInputMessage('system', buildOpenUiSystemPrompt());
  const intentContextMessage = createTextInputMessage('user', buildOpenUiIntentContextPrompt(request));
  const recentHistory = request.chatHistory;

  return [
    systemMessage,
    ...recentHistory.map((message) =>
      message.role === 'assistant'
        ? createTextInputMessage('assistant', buildOpenUiAssistantSummaryMessage(message.content))
        : createTextInputMessage('user', message.content),
    ),
    intentContextMessage,
    createTextInputMessage('user', buildOpenUiUserPrompt(request)),
  ];
}

export function buildResponseRequest(env: AppEnv, request: PromptBuildRequest) {
  return {
    model: env.OPENAI_MODEL,
    input: buildResponseInput(env, request),
    max_output_tokens: getOpenUiMaxOutputTokens(env),
    prompt_cache_key: getOpenUiSystemPromptCacheKey({ prompt: request.prompt }),
    temperature: getOpenUiTemperature(request.mode),
    text: {
      format: openUiEnvelopeFormat,
    },
  };
}

export type OpenUiResponseRequest = ReturnType<typeof buildResponseRequest>;
