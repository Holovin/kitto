import { AsyncLocalStorage } from 'node:async_hooks';
import OpenAI from 'openai';
import type { ResponseInput } from 'openai/resources/responses/responses';
import type { AppEnv } from '#backend/env.js';
import { RequestValidationError, UpstreamFailureError } from '#backend/errors/publicError.js';
import { CURRENT_SOURCE_EMERGENCY_MAX_CHARS } from '#backend/limits.js';
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
import {
  createEmptyAppMemory,
  CURRENT_SOURCE_TOO_LARGE_PUBLIC_MESSAGE,
  type AppMemory,
  type PromptBuildChatHistoryMessage,
} from '@kitto-openui/shared/builderApiContract.js';
import { openUiEnvelopeFormat } from './envelope.js';

type OpenAiClient = Pick<OpenAI, 'responses'>;
type OpenAiClientFactory = (env: AppEnv) => OpenAiClient;
type DroppedPromptSection =
  | 'appMemory.avoid'
  | 'appMemory.appSummary'
  | 'appMemory.userPreferences'
  | 'currentSourceItems'
  | 'historySummary'
  | 'previousChangeSummaries'
  | 'previousUserMessages'
  | 'selectedExamples';

export interface PromptContextLogMetadata {
  currentSourceChars: number;
  currentSourceIncluded: boolean;
  currentSourceItemsIncluded: boolean;
  currentSourceProtected: boolean;
  droppedSections: DroppedPromptSection[];
}

interface OpenAiRequestIdCapture {
  requestId: string | null;
}

const openAiRequestIdCaptureStorage = new AsyncLocalStorage<OpenAiRequestIdCapture>();
let cachedClient: { apiKey: string; client: OpenAiClient; overrideFactory: OpenAiClientFactory | null } | null = null;
let openAiClientFactoryOverride: OpenAiClientFactory | null = null;
const responseRequestPromptContextMetadata = new WeakMap<object, PromptContextLogMetadata>();

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

function getInputMessageText(message: ResponseInput[number]) {
  if (!message || typeof message !== 'object' || !('content' in message)) {
    return '';
  }

  const content = message.content;

  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((part) => {
      if (!part || typeof part !== 'object' || !('text' in part)) {
        return '';
      }

      const text = (part as { text?: unknown }).text;
      return typeof text === 'string' ? text : '';
    })
    .join('');
}

function getResponseInputChars(input: ResponseInput) {
  return input.reduce((total, message) => total + getInputMessageText(message).length, 0);
}

function assertCurrentSourceWithinEmergencyCap(request: PromptBuildRequest) {
  if (request.currentSource.length <= CURRENT_SOURCE_EMERGENCY_MAX_CHARS) {
    return;
  }

  throw new RequestValidationError(
    `Current source exceeded the emergency prompt cap of ${CURRENT_SOURCE_EMERGENCY_MAX_CHARS} characters.`,
    400,
    {
      publicMessage: CURRENT_SOURCE_TOO_LARGE_PUBLIC_MESSAGE,
    },
  );
}

function createPromptContextMetadata(
  request: PromptBuildRequest,
  input: ResponseInput,
  droppedSections: DroppedPromptSection[],
): PromptContextLogMetadata {
  const fullText = input.map(getInputMessageText).join('\n');

  return {
    currentSourceChars: request.currentSource.length,
    currentSourceIncluded: fullText.includes('<current_source>\n') || fullText.includes('Current committed valid OpenUI source:'),
    currentSourceItemsIncluded: fullText.includes('<current_source_inventory>'),
    currentSourceProtected: request.currentSource.length > 0 && request.currentSource.length <= CURRENT_SOURCE_EMERGENCY_MAX_CHARS,
    droppedSections,
  };
}

function stripAppMemoryUserPreferences(appMemory: AppMemory | undefined): AppMemory {
  return {
    ...(appMemory ?? createEmptyAppMemory()),
    userPreferences: [],
  };
}

function stripAppMemoryAvoid(appMemory: AppMemory | undefined): AppMemory {
  return {
    ...(appMemory ?? createEmptyAppMemory()),
    avoid: [],
  };
}

function cropAppMemorySummary(appMemory: AppMemory | undefined): AppMemory {
  return {
    ...(appMemory ?? createEmptyAppMemory()),
    appSummary: '',
    avoid: [],
    userPreferences: [],
  };
}

function removePreviousUserMessages(messages: PromptBuildChatHistoryMessage[]) {
  return messages.filter((message) => message.role !== 'user');
}

function removePreviousAssistantChangeSummaries(messages: PromptBuildChatHistoryMessage[]) {
  return messages.filter((message) => message.role !== 'assistant' || message.content.includes('<history_summary>'));
}

function removeHistorySummaryMessages(messages: PromptBuildChatHistoryMessage[]) {
  return messages.filter((message) => !message.content.includes('<history_summary>'));
}

function buildInitialResponseInputVariant(
  systemPrompt: string,
  request: PromptBuildRequest,
  options: {
    appMemory?: AppMemory;
    chatHistory: PromptBuildChatHistoryMessage[];
    includeIntentExamples: boolean;
    includePreviousChanges: boolean;
  },
): ResponseInput {
  return [
    createTextInputMessage('system', systemPrompt),
    ...options.chatHistory.map((message) =>
      message.role === 'assistant'
        ? createTextInputMessage('assistant', buildOpenUiAssistantSummaryMessage(message.content))
        : createTextInputMessage('user', message.content),
    ),
    createTextInputMessage('user', buildOpenUiIntentContextPrompt(request, { includeIntentExamples: options.includeIntentExamples })),
    createTextInputMessage(
      'user',
      buildOpenUiUserPrompt(request, {
        appMemory: options.appMemory,
        includePreviousChanges: options.includePreviousChanges,
      }),
    ),
  ];
}

function buildBudgetedInitialResponseInput(
  env: AppEnv,
  systemPrompt: string,
  request: PromptBuildRequest,
): { droppedSections: DroppedPromptSection[]; input: ResponseInput } {
  let appMemory = request.appMemory;
  let chatHistory = filterPromptBuildChatHistory(request.chatHistory);
  let includeIntentExamples = true;
  let includePreviousChanges = true;
  const droppedSections: DroppedPromptSection[] = [];
  const isOverBudget = (input: ResponseInput) => getResponseInputChars(input) > env.LLM_MODEL_PROMPT_MAX_CHARS;
  const buildInput = () =>
    buildInitialResponseInputVariant(systemPrompt, request, {
      appMemory,
      chatHistory,
      includeIntentExamples,
      includePreviousChanges,
    });
  let input = buildInput();

  const dropIfNeeded = (section: DroppedPromptSection, drop: () => void) => {
    if (!isOverBudget(input)) {
      return;
    }

    drop();
    droppedSections.push(section);
    input = buildInput();
  };

  dropIfNeeded('selectedExamples', () => {
    includeIntentExamples = false;
  });
  dropIfNeeded('previousChangeSummaries', () => {
    includePreviousChanges = false;
    chatHistory = removePreviousAssistantChangeSummaries(chatHistory);
  });
  dropIfNeeded('previousUserMessages', () => {
    chatHistory = removePreviousUserMessages(chatHistory);
  });
  dropIfNeeded('historySummary', () => {
    chatHistory = removeHistorySummaryMessages(chatHistory);
  });
  dropIfNeeded('currentSourceItems', () => {
    // Normal follow-up generation does not include source inventory as source context.
  });
  dropIfNeeded('appMemory.userPreferences', () => {
    appMemory = stripAppMemoryUserPreferences(appMemory);
  });
  dropIfNeeded('appMemory.avoid', () => {
    appMemory = stripAppMemoryAvoid(appMemory);
  });
  dropIfNeeded('appMemory.appSummary', () => {
    appMemory = cropAppMemorySummary(appMemory);
  });

  return { droppedSections, input };
}

function buildResponseInputWithMetadata(env: AppEnv, request: PromptBuildRequest): {
  input: ResponseInput;
  metadata: PromptContextLogMetadata;
} {
  assertCurrentSourceWithinEmergencyCap(request);
  const requestIntent = detectPromptRequestIntent(request.prompt, {
    currentSource: request.currentSource,
    mode: request.mode,
  });
  const systemPrompt = buildOpenUiSystemPromptForIntents(requestIntent);

  if (request.mode === 'repair') {
    const repairMessages = buildOpenUiRepairRoleMessages({
      attemptNumber: request.repairAttemptNumber ?? 1,
      appMemory: request.appMemory,
      chatHistory: filterPromptBuildChatHistory(request.chatHistory),
      committedSource: request.currentSource,
      invalidSource: request.invalidDraft ?? '',
      issues: request.validationIssues ?? [],
      maxRepairAttempts: env.LLM_MAX_REPAIR_ATTEMPTS,
      promptMaxChars: env.LLM_MODEL_PROMPT_MAX_CHARS,
      userPrompt: buildOpenUiRawUserRequest(request),
    });

    const input = [
      createTextInputMessage('system', [systemPrompt, repairMessages.systemInstruction].join('\n\n')),
      createTextInputMessage('user', repairMessages.requestContext),
      createTextInputMessage('assistant', repairMessages.failedDraft),
      createTextInputMessage('user', repairMessages.correctionRequest),
    ];

    return {
      input,
      metadata: createPromptContextMetadata(request, input, []),
    };
  }

  const { droppedSections, input } = buildBudgetedInitialResponseInput(env, systemPrompt, request);

  return {
    input,
    metadata: createPromptContextMetadata(request, input, droppedSections),
  };
}

export function getOpenUiResponseRequestPromptContextMetadata(responseRequest: object) {
  return responseRequestPromptContextMetadata.get(responseRequest) ?? null;
}

export function buildResponseRequest(env: AppEnv, request: PromptBuildRequest) {
  const requestIntent = detectPromptRequestIntent(request.prompt, {
    currentSource: request.currentSource,
    mode: request.mode,
  });
  const inputWithMetadata = buildResponseInputWithMetadata(env, request);
  const responseRequest = {

    model: env.OPENAI_MODEL,
    input: inputWithMetadata.input,
    max_output_tokens: getOpenUiMaxOutputTokens(env),
    prompt_cache_key: getOpenUiSystemPromptCacheKey(requestIntent),
    temperature: getOpenUiTemperature(request.mode),
    text: {
      format: openUiEnvelopeFormat,
    },
  };

  responseRequestPromptContextMetadata.set(responseRequest, inputWithMetadata.metadata);

  return responseRequest;
}

export type OpenUiResponseRequest = ReturnType<typeof buildResponseRequest>;
