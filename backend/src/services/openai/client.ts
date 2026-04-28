import { AsyncLocalStorage } from 'node:async_hooks';
import OpenAI from 'openai';
import type { ResponseInput } from 'openai/resources/responses/responses';
import type { AppEnv } from '#backend/env.js';
import { UpstreamFailureError } from '#backend/errors/publicError.js';
import {
  buildOpenUiAssistantSummaryMessage,
  buildOpenUiIntentContextPrompt,
  buildOpenUiRawUserRequest,
  buildOpenUiRepairRoleMessages,
  buildOpenUiSystemPromptForIntents,
  detectPromptRequestIntent,
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

interface OpenAiRequestIdCapture {
  requestId: string | null;
}

const openAiRequestIdCaptureStorage = new AsyncLocalStorage<OpenAiRequestIdCapture>();
let cachedClient: { apiKey: string; client: OpenAiClient; overrideFactory: OpenAiClientFactory | null } | null = null;
let openAiClientFactoryOverride: OpenAiClientFactory | null = null;

function isOpenAiStreamRequest(init: Parameters<typeof fetch>[1] | undefined) {
  if (!init) {
    return false;
  }

  if (typeof init.body === 'string') {
    try {
      const body = JSON.parse(init.body) as { stream?: unknown };
      if (body.stream === true) {
        return true;
      }
    } catch {
      // Ignore JSON parsing failures in request bodies that do not need content-type stream checks.
    }
  }

  const acceptedStreamContentTypes = new Headers(init.headers).get('accept');
  if (!acceptedStreamContentTypes) {
    return false;
  }

  return acceptedStreamContentTypes
    .split(',')
    .map((headerValue) => {
      const [mediaType = ''] = headerValue.toLowerCase().split(';', 1);
      return mediaType.trim();
    })
    .includes('text/event-stream');
}

function isTextEventStreamContentType(contentType: string | null) {
  if (!contentType) {
    return false;
  }

  const [mediaType = ''] = contentType.toLowerCase().split(';', 1);
  return mediaType.trim() === 'text/event-stream';
}

export function getSystemPromptHash() {
  return getOpenUiSystemPromptHash();
}

export function getSystemPromptHashForRequest(request: PromptBuildRequest) {
  return getOpenUiSystemPromptHash(
    detectPromptRequestIntent(request.prompt, {
      currentSource: request.currentSource,
      mode: request.mode,
    }),
  );
}

async function captureOpenAiRequestIdFetch(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) {
  const response = await fetch(input, init);
  const requestId = response.headers.get('x-request-id');
  const contentType = response.headers.get('content-type');
  const capture = openAiRequestIdCaptureStorage.getStore();

  if (capture && requestId) {
    capture.requestId = requestId;
  }

  if (isOpenAiStreamRequest(init) && !isTextEventStreamContentType(contentType)) {
    const errorMessage = `Unexpected OpenAI streaming content-type: ${contentType ?? 'missing'}`;

    try {
      response.body?.cancel();
    } catch {
      // Ignore cancellation failures while surfacing a structured upstream error.
    }

    throw new UpstreamFailureError(errorMessage);
  }

  return response;
}

export function captureOpenAiRequestId<T>(run: () => T) {
  const capture: OpenAiRequestIdCapture = {
    requestId: null,
  };

  return {
    capture,
    value: openAiRequestIdCaptureStorage.run(capture, run),
  };
}

function createDefaultOpenAiClient(env: AppEnv): OpenAiClient {
  return new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    fetch: captureOpenAiRequestIdFetch,
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
  const requestIntent = detectPromptRequestIntent(request.prompt, {
    currentSource: request.currentSource,
    mode: request.mode,
  });
  const systemPrompt = buildOpenUiSystemPromptForIntents(requestIntent);

  if (request.mode === 'repair') {
    const repairMessages = buildOpenUiRepairRoleMessages({
      attemptNumber: request.repairAttemptNumber ?? 1,
      chatHistory: filterPromptBuildChatHistory(request.chatHistory),
      committedSource: request.currentSource,
      invalidSource: request.invalidDraft ?? '',
      issues: request.validationIssues ?? [],
      maxRepairAttempts: env.LLM_MAX_REPAIR_ATTEMPTS,
      promptMaxChars: env.LLM_MODEL_PROMPT_MAX_CHARS,
      userPrompt: buildOpenUiRawUserRequest(request),
    });

    return [
      createTextInputMessage('system', [systemPrompt, repairMessages.systemInstruction].join('\n\n')),
      createTextInputMessage('user', repairMessages.requestContext),
      createTextInputMessage('assistant', repairMessages.failedDraft),
      createTextInputMessage('user', repairMessages.correctionRequest),
    ];
  }

  const systemMessage = createTextInputMessage('system', systemPrompt);
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
  const requestIntent = detectPromptRequestIntent(request.prompt, {
    currentSource: request.currentSource,
    mode: request.mode,
  });

  return {
    model: env.OPENAI_MODEL,
    input: buildResponseInput(env, request),
    max_output_tokens: getOpenUiMaxOutputTokens(env),
    prompt_cache_key: getOpenUiSystemPromptCacheKey(requestIntent),
    temperature: getOpenUiTemperature(request.mode),
    text: {
      format: openUiEnvelopeFormat,
    },
  };
}

export type OpenUiResponseRequest = ReturnType<typeof buildResponseRequest>;
