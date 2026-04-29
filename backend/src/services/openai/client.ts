import { AsyncLocalStorage } from 'node:async_hooks';
import OpenAI from 'openai';
import type { ResponseInput } from 'openai/resources/responses/responses';
import type { AppEnv } from '#backend/env.js';
import { RequestValidationError, UpstreamFailureError } from '#backend/errors/publicError.js';
import { CURRENT_SOURCE_EMERGENCY_MAX_CHARS } from '#backend/limits.js';
import {
  buildOpenUiIntentContextPrompt,
  buildOpenUiRawUserRequest,
  buildOpenUiRepairRoleMessages,
  buildOpenUiSystemPromptForIntents,
  detectPromptRequestIntent,
  getOpenUiSystemPromptHash,
  buildOpenUiUserPrompt,
  getOpenUiSystemPromptCacheKey,
  type PromptBuildRequest,
} from '#backend/prompts/openui.js';
import { buildGlobalLimitLabels, buildPromptSectionLimitLabels } from '#backend/prompts/openui/promptContextLabels.js';
import { buildPromptContextLimitSections, getPromptContextLimitSection } from '#backend/prompts/openui/promptContextLimits.js';
import { getOpenUiMaxOutputTokens, getOpenUiTemperature } from '#backend/prompts/openui/requestConfig.js';
import {
  createEmptyAppMemory,
  CURRENT_SOURCE_ITEMS_MAX_CHARS,
  CURRENT_SOURCE_TOO_LARGE_PUBLIC_MESSAGE,
  SELECTED_EXAMPLES_MAX_CHARS,
  type AppMemory,
  type BudgetDecision,
  type BudgetDecisionSection,
  type BuilderPromptContextSection,
  type BuilderPromptContextSnapshot,
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
  budgetDecision: BudgetDecision;
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

function getInputMessageRole(message: ResponseInput[number], index: number) {
  if (!message || typeof message !== 'object' || !('role' in message)) {
    return `message_${index + 1}`;
  }

  const role = (message as { role?: unknown }).role;
  return typeof role === 'string' && role.trim() ? role.trim() : `message_${index + 1}`;
}

function buildGlobalPromptPreview(input: ResponseInput, structuredOutputContract: string) {
  const messageBlocks = input.map((message, index) => {
    const role = getInputMessageRole(message, index);
    return `<${role}>\n${getInputMessageText(message)}\n</${role}>`;
  });

  return [
    ...messageBlocks,
    `<structuredOutputContract>\n${structuredOutputContract}\n</structuredOutputContract>`,
  ].join('\n\n');
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

function assertInvalidDraftWithinEmergencyCap(request: PromptBuildRequest) {
  if (request.mode !== 'repair' || (request.invalidDraft?.length ?? 0) <= CURRENT_SOURCE_EMERGENCY_MAX_CHARS) {
    return;
  }

  throw new RequestValidationError(
    `Invalid draft exceeded the emergency prompt cap of ${CURRENT_SOURCE_EMERGENCY_MAX_CHARS} characters.`,
    400,
    {
      publicMessage: `Invalid draft is too large. Limit: ${CURRENT_SOURCE_EMERGENCY_MAX_CHARS} characters.`,
    },
  );
}

function assertProtectedPromptWithinModelBudget(env: AppEnv, input: ResponseInput) {
  const promptChars = getResponseInputChars(input);

  if (promptChars <= env.LLM_MODEL_PROMPT_MAX_CHARS) {
    return;
  }

  throw new RequestValidationError(
    `Protected prompt context is ${promptChars} characters after optional context was removed, exceeding LLM_MODEL_PROMPT_MAX_CHARS ${env.LLM_MODEL_PROMPT_MAX_CHARS}.`,
    400,
    {
      publicMessage:
        'The current app definition is too large to safely send with this request. Export the definition or simplify/reset the app before continuing.',
    },
  );
}

function createPromptContextMetadata(
  env: AppEnv,
  request: PromptBuildRequest,
  input: ResponseInput,
  droppedSections: DroppedPromptSection[],
): PromptContextLogMetadata {
  const fullText = input.map(getInputMessageText).join('\n');
  const currentSourceIncluded = fullText.includes('<current_source>\n') || fullText.includes('Current committed valid OpenUI source:');
  const currentSourceProtected = request.currentSource.length <= CURRENT_SOURCE_EMERGENCY_MAX_CHARS;
  const budgetDecision = createBudgetDecision(env, request, fullText, droppedSections);

  return {
    budgetDecision,
    currentSourceChars: request.currentSource.length,
    currentSourceIncluded,
    currentSourceItemsIncluded: fullText.includes('<current_source_inventory>'),
    currentSourceProtected,
    droppedSections,
  };
}

function getJsonChars(value: unknown) {
  return JSON.stringify(value ?? null).length;
}

function getStringArrayChars(values?: string[]) {
  return getJsonChars((values ?? []).map((value) => value.trim()).filter(Boolean));
}

function getValidationIssueChars(request: PromptBuildRequest) {
  return getJsonChars(request.validationIssues ?? []);
}

function createBudgetSection(
  name: string,
  chars: number,
  included: boolean,
  protectedSection: boolean,
  reason?: string,
  limits: {
    hardLimitChars?: number;
    softLimitChars?: number;
  } = {},
): BudgetDecisionSection {
  return {
    name,
    chars,
    ...(limits.hardLimitChars !== undefined ? { hardLimitChars: limits.hardLimitChars } : {}),
    included,
    protected: protectedSection,
    ...(reason ? { reason } : {}),
    ...(limits.softLimitChars !== undefined ? { softLimitChars: limits.softLimitChars } : {}),
  };
}

function createBudgetDecision(
  env: AppEnv,
  request: PromptBuildRequest,
  fullText: string,
  droppedSections: DroppedPromptSection[],
): BudgetDecision {
  const limitSections = buildPromptContextLimitSections(env);
  const getLimit = (name: string) => getPromptContextLimitSection(limitSections, name);
  const droppedSectionSet = new Set<string>(droppedSections);
  const hasCurrentSource = request.currentSource.trim().length > 0;
  const currentSourceIncluded = fullText.includes('<current_source>\n');
  const validationIssuesIncluded = request.mode !== 'repair' || fullText.includes('<validation_issues>\n');
  const selectedExamplesIncluded =
    !droppedSectionSet.has('selectedExamples') &&
    (fullText.includes('Relevant patterns:') || fullText.includes('Additional OpenUI examples:'));
  const currentSourceItemsIncluded = fullText.includes('<current_source_inventory>');
  const appMemoryIncluded = fullText.includes('<previous_app_memory>\n');
  const historySummaryIncluded = fullText.includes('<history_summary>\n');
  const previousUserMessagesIncluded = fullText.includes('<previous_user_messages>\n');
  const previousChangeSummariesIncluded = fullText.includes('<previous_change_summaries>\n');
  const currentSourceProtected = request.currentSource.length <= CURRENT_SOURCE_EMERGENCY_MAX_CHARS;

  return {
    currentSourceChars: request.currentSource.length,
    currentSourceIncluded,
    currentSourceProtected: true,
    droppedSections,
    sections: [
      createBudgetSection('latestUserPrompt', buildOpenUiRawUserRequest(request).length, true, true, undefined, getLimit('latestUserPrompt')),
      createBudgetSection(
        'validationIssues',
        request.mode === 'repair' ? getValidationIssueChars(request) : 0,
        request.mode === 'repair' ? validationIssuesIncluded : false,
        true,
        request.mode === 'repair' ? undefined : 'not repair',
        getLimit('validationIssues'),
      ),
      createBudgetSection(
        'currentSource',
        request.currentSource.length,
        currentSourceIncluded,
        true,
        hasCurrentSource
          ? currentSourceProtected
            ? undefined
            : 'over emergency cap'
          : 'blank canvas',
        getLimit('currentSource'),
      ),
      createBudgetSection(
        'appMemory',
        getJsonChars(request.appMemory ?? createEmptyAppMemory()),
        appMemoryIncluded,
        false,
        droppedSectionSet.has('appMemory.appSummary')
          ? 'trimmed to empty memory'
          : droppedSectionSet.has('appMemory.userPreferences') || droppedSectionSet.has('appMemory.avoid')
            ? 'trimmed for optional context budget'
            : undefined,
        getLimit('appMemory'),
      ),
      createBudgetSection(
        'historySummary',
        request.historySummary?.trim().length ?? 0,
        historySummaryIncluded,
        false,
        droppedSectionSet.has('historySummary') ? 'dropped for optional context budget' : undefined,
        getLimit('historySummary'),
      ),
      createBudgetSection(
        'previousUserMessages',
        getStringArrayChars(request.previousUserMessages),
        previousUserMessagesIncluded,
        false,
        droppedSectionSet.has('previousUserMessages') ? 'trimmed/dropped for optional context budget' : undefined,
        getLimit('previousUserMessages'),
      ),
      createBudgetSection(
        'previousChangeSummaries',
        getStringArrayChars(request.previousChangeSummaries),
        previousChangeSummariesIncluded,
        false,
        droppedSectionSet.has('previousChangeSummaries') ? 'trimmed/dropped for optional context budget' : undefined,
        getLimit('previousChangeSummaries'),
      ),
      createBudgetSection(
        'selectedExamples',
        selectedExamplesIncluded ? Math.min(fullText.length, SELECTED_EXAMPLES_MAX_CHARS) : 0,
        selectedExamplesIncluded,
        false,
        droppedSectionSet.has('selectedExamples') ? 'dropped for optional context budget' : undefined,
        getLimit('selectedExamples'),
      ),
      createBudgetSection(
        'currentSourceItems',
        currentSourceItemsIncluded ? Math.min(fullText.length, CURRENT_SOURCE_ITEMS_MAX_CHARS) : 0,
        currentSourceItemsIncluded,
        false,
        droppedSectionSet.has('currentSourceItems') ? 'dropped for optional context budget' : 'omitted',
        getLimit('currentSourceItems'),
      ),
    ],
  };
}

function getBudgetDecisionSection(budgetDecision: BudgetDecision, name: string) {
  return budgetDecision.sections.find((section) => section.name === name);
}

function extractPromptDataBlock(text: string, tagName: string) {
  return new RegExp(`<${tagName}>\\n[\\s\\S]*?\\n</${tagName}>`).exec(text)?.[0] ?? null;
}

function extractSelectedExamples(intentContextText: string) {
  const startIndexes = ['Relevant patterns:', 'Additional OpenUI examples:']
    .map((label) => intentContextText.indexOf(label))
    .filter((index) => index >= 0);

  if (startIndexes.length === 0) {
    return null;
  }

  const startIndex = Math.min(...startIndexes);
  const endIndex = intentContextText.lastIndexOf('\n</intent_context>');
  const content = intentContextText.slice(startIndex, endIndex >= 0 ? endIndex : undefined).trim();
  return content || null;
}

function createPromptContextSection({
  budgetDecision,
  content,
  fallbackReason,
  name,
  priority,
  protectedSection,
}: {
  budgetDecision: BudgetDecision;
  content: string | null;
  fallbackReason?: string;
  name: string;
  priority: number;
  protectedSection: boolean;
}): BuilderPromptContextSection {
  const budgetSection = getBudgetDecisionSection(budgetDecision, name);
  const included = content !== null;
  const reason = included ? budgetSection?.reason : budgetSection?.reason ?? fallbackReason;

  return {
    name,
    chars: budgetSection?.chars ?? content?.length ?? 0,
    content: content ?? fallbackReason ?? '(not included in this request)',
    ...(budgetSection?.hardLimitChars !== undefined ? { hardLimitChars: budgetSection.hardLimitChars } : {}),
    included,
    ...(buildPromptSectionLimitLabels(budgetSection ?? {}) ? { limitLabels: buildPromptSectionLimitLabels(budgetSection ?? {}) } : {}),
    priority,
    protected: protectedSection,
    ...(reason ? { reason } : {}),
    ...(budgetSection?.softLimitChars !== undefined ? { softLimitChars: budgetSection.softLimitChars } : {}),
  };
}

function createStaticPromptContextSection(
  priority: number,
  name: string,
  content: string,
  protectedSection: boolean,
  options: {
    budgetLabel?: string;
    chars?: number;
    limitLabels?: string[];
    unminifiedChars?: number;
  } = {},
): BuilderPromptContextSection {
  return {
    name,
    chars: options.chars ?? content.length,
    ...(options.budgetLabel !== undefined ? { budgetLabel: options.budgetLabel } : {}),
    content,
    included: true,
    ...(options.limitLabels !== undefined ? { limitLabels: options.limitLabels } : {}),
    priority,
    protected: protectedSection,
    ...(options.unminifiedChars !== undefined && options.unminifiedChars !== (options.chars ?? content.length)
      ? { unminifiedChars: options.unminifiedChars }
      : {}),
  };
}

export function buildPromptContextSnapshot(env: AppEnv, request: PromptBuildRequest): BuilderPromptContextSnapshot {
  const { input, metadata } = buildResponseInputWithMetadata(env, request);
  const inputTexts = input.map(getInputMessageText);
  const [systemText = '', secondTurnText = '', thirdTurnText = '', fourthTurnText = ''] = inputTexts;
  const isRepair = request.mode === 'repair';
  const intentContextText = isRepair ? null : secondTurnText;
  const latestUserTurnText = isRepair ? secondTurnText : thirdTurnText;
  const failedDraftText = isRepair ? thirdTurnText : null;
  const correctionRequestText = isRepair ? fourthTurnText : null;
  const structuredOutputContract = JSON.stringify(openUiEnvelopeFormat.schema);
  const prettyStructuredOutputContract = JSON.stringify(openUiEnvelopeFormat.schema, null, 2);
  const totalChars = getResponseInputChars(input) + structuredOutputContract.length;
  const sections: BuilderPromptContextSection[] = [
    createStaticPromptContextSection(0, 'GLOBAL', buildGlobalPromptPreview(input, structuredOutputContract), true, {
      budgetLabel: '-',
      chars: totalChars,
      limitLabels: buildGlobalLimitLabels(env),
    }),
    createStaticPromptContextSection(1, 'system/contract', systemText, true),
    createStaticPromptContextSection(2, 'structuredOutputContract', structuredOutputContract, true, {
      unminifiedChars: prettyStructuredOutputContract.length,
    }),
  ];

  if (intentContextText !== null) {
    sections.push(createStaticPromptContextSection(3, 'intentContext', intentContextText, false));
  }

  sections.push(
    createPromptContextSection({
      budgetDecision: metadata.budgetDecision,
      content:
        extractPromptDataBlock(latestUserTurnText, isRepair ? 'original_user_request' : 'latest_user_request') ??
        extractPromptDataBlock(latestUserTurnText, 'latest_user_request'),
      fallbackReason: 'not included',
      name: 'latestUserPrompt',
      priority: 4,
      protectedSection: true,
    }),
    createPromptContextSection({
      budgetDecision: metadata.budgetDecision,
      content: correctionRequestText ? extractPromptDataBlock(correctionRequestText, 'validation_issues') : null,
      fallbackReason: request.mode === 'repair' ? 'missing validation issues' : 'not repair',
      name: 'validationIssues',
      priority: 5,
      protectedSection: true,
    }),
    createPromptContextSection({
      budgetDecision: metadata.budgetDecision,
      content: extractPromptDataBlock(latestUserTurnText, 'current_source'),
      fallbackReason: 'not included',
      name: 'currentSource',
      priority: 6,
      protectedSection: true,
    }),
    createPromptContextSection({
      budgetDecision: metadata.budgetDecision,
      content: extractPromptDataBlock(latestUserTurnText, 'previous_app_memory'),
      fallbackReason: 'not included',
      name: 'appMemory',
      priority: 7,
      protectedSection: false,
    }),
    createPromptContextSection({
      budgetDecision: metadata.budgetDecision,
      content: extractPromptDataBlock(latestUserTurnText, 'history_summary'),
      fallbackReason: 'not included',
      name: 'historySummary',
      priority: 8,
      protectedSection: false,
    }),
    createPromptContextSection({
      budgetDecision: metadata.budgetDecision,
      content: extractPromptDataBlock(latestUserTurnText, 'previous_user_messages'),
      fallbackReason: 'not included',
      name: 'previousUserMessages',
      priority: 9,
      protectedSection: false,
    }),
    createPromptContextSection({
      budgetDecision: metadata.budgetDecision,
      content: extractPromptDataBlock(latestUserTurnText, 'previous_change_summaries'),
      fallbackReason: 'not included',
      name: 'previousChangeSummaries',
      priority: 10,
      protectedSection: false,
    }),
  );

  if (isRepair) {
    sections.push(
      createPromptContextSection({
        budgetDecision: metadata.budgetDecision,
        content: extractPromptDataBlock(latestUserTurnText, 'conversation_context'),
        fallbackReason: 'not included',
        name: 'conversationContext',
        priority: 11,
        protectedSection: false,
      }),
      createStaticPromptContextSection(12, 'invalidDraft', failedDraftText ?? '(missing failed draft turn)', false),
      createPromptContextSection({
        budgetDecision: metadata.budgetDecision,
        content: correctionRequestText ? extractPromptDataBlock(correctionRequestText, 'hints') : null,
        fallbackReason: 'not included',
        name: 'repairHints',
        priority: 13,
        protectedSection: false,
      }),
      createPromptContextSection({
        budgetDecision: metadata.budgetDecision,
        content: correctionRequestText ? extractPromptDataBlock(correctionRequestText, 'relevant_draft_statement_excerpts') : null,
        fallbackReason: 'not included',
        name: 'draftStatementExcerpts',
        priority: 14,
        protectedSection: false,
      }),
    );
  } else {
    sections.push(
      createPromptContextSection({
        budgetDecision: metadata.budgetDecision,
        content: extractPromptDataBlock(latestUserTurnText, 'previous_changes'),
        fallbackReason: 'not included',
        name: 'previousChanges',
        priority: 11,
        protectedSection: false,
      }),
      createPromptContextSection({
        budgetDecision: metadata.budgetDecision,
        content: intentContextText ? extractSelectedExamples(intentContextText) : null,
        fallbackReason: 'not included',
        name: 'selectedExamples',
        priority: 12,
        protectedSection: false,
      }),
      createPromptContextSection({
        budgetDecision: metadata.budgetDecision,
        content: null,
        fallbackReason: 'not sent; currentSource is the protected source of truth',
        name: 'currentSourceItems',
        priority: 13,
        protectedSection: false,
      }),
    );
  }

  return {
    currentSourceChars: metadata.currentSourceChars,
    currentSourceIncluded: metadata.currentSourceIncluded,
    currentSourceProtected: true,
    droppedSections: metadata.droppedSections,
    mode: request.mode,
    sections,
    totalChars,
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

function trimOptionalStringArray(values: string[] | undefined) {
  void values;
  return [];
}

function buildInitialResponseInputVariant(
  systemPrompt: string,
  request: PromptBuildRequest,
  options: {
    appMemory?: AppMemory;
    includeIntentExamples: boolean;
    includePreviousChanges: boolean;
  },
): ResponseInput {
  return [
    createTextInputMessage('system', systemPrompt),
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
): { droppedSections: DroppedPromptSection[]; input: ResponseInput; metadataRequest: PromptBuildRequest } {
  let appMemory = request.appMemory;
  let budgetedRequest = request;
  let includeIntentExamples = true;
  const includePreviousChanges = true;
  const droppedSections: DroppedPromptSection[] = [];
  const isOverBudget = (input: ResponseInput) => getResponseInputChars(input) > env.LLM_MODEL_PROMPT_MAX_CHARS;
  const buildInput = () =>
    buildInitialResponseInputVariant(systemPrompt, budgetedRequest, {
      appMemory,
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

  dropIfNeeded('currentSourceItems', () => {
    // Source inventory is optional hint context. The full current source remains protected.
  });
  dropIfNeeded('selectedExamples', () => {
    includeIntentExamples = false;
  });
  dropIfNeeded('previousChangeSummaries', () => {
    budgetedRequest = { ...budgetedRequest, previousChangeSummaries: trimOptionalStringArray(budgetedRequest.previousChangeSummaries) };
  });
  dropIfNeeded('previousUserMessages', () => {
    budgetedRequest = { ...budgetedRequest, previousUserMessages: trimOptionalStringArray(budgetedRequest.previousUserMessages) };
  });
  dropIfNeeded('historySummary', () => {
    budgetedRequest = { ...budgetedRequest, historySummary: undefined };
  });
  dropIfNeeded('appMemory.avoid', () => {
    appMemory = stripAppMemoryAvoid(appMemory);
  });
  dropIfNeeded('appMemory.userPreferences', () => {
    appMemory = stripAppMemoryUserPreferences(appMemory);
  });
  dropIfNeeded('appMemory.appSummary', () => {
    appMemory = cropAppMemorySummary(appMemory);
  });

  assertProtectedPromptWithinModelBudget(env, input);

  return {
    droppedSections,
    input,
    metadataRequest: {
      ...budgetedRequest,
      appMemory,
    },
  };
}

function buildRepairResponseInputVariant(
  env: AppEnv,
  systemPrompt: string,
  request: PromptBuildRequest,
  options: {
    appMemory?: AppMemory;
    historySummary?: string;
    previousChangeSummaries?: string[];
    previousUserMessages?: string[];
  } = {},
): ResponseInput {
  const repairMessages = buildOpenUiRepairRoleMessages({
    attemptNumber: request.repairAttemptNumber ?? 1,
    appMemory: options.appMemory,
    committedSource: request.currentSource,
    historySummary: options.historySummary,
    invalidSource: request.invalidDraft ?? '',
    issues: request.validationIssues ?? [],
    maxRepairAttempts: env.LLM_MAX_REPAIR_ATTEMPTS,
    promptMaxChars: env.LLM_MODEL_PROMPT_MAX_CHARS,
    previousChangeSummaries: options.previousChangeSummaries ?? [],
    previousUserMessages: options.previousUserMessages ?? [],
    userPrompt: buildOpenUiRawUserRequest(request),
  });

  return [
    createTextInputMessage('system', [systemPrompt, repairMessages.systemInstruction].join('\n\n')),
    createTextInputMessage('user', repairMessages.requestContext),
    createTextInputMessage('assistant', repairMessages.failedDraft),
    createTextInputMessage('user', repairMessages.correctionRequest),
  ];
}

function buildBudgetedRepairResponseInput(env: AppEnv, systemPrompt: string, request: PromptBuildRequest): ResponseInput {
  let input = buildRepairResponseInputVariant(env, systemPrompt, request, {
    appMemory: request.appMemory,
    historySummary: request.historySummary,
    previousChangeSummaries: request.previousChangeSummaries ?? [],
    previousUserMessages: request.previousUserMessages ?? [],
  });

  if (getResponseInputChars(input) <= env.LLM_MODEL_PROMPT_MAX_CHARS) {
    return input;
  }

  input = buildRepairResponseInputVariant(env, systemPrompt, request, {
    appMemory: cropAppMemorySummary(request.appMemory),
    historySummary: undefined,
    previousChangeSummaries: [],
    previousUserMessages: [],
  });

  assertProtectedPromptWithinModelBudget(env, input);
  return input;
}

function buildResponseInputWithMetadata(env: AppEnv, request: PromptBuildRequest): {
  input: ResponseInput;
  metadata: PromptContextLogMetadata;
} {
  assertCurrentSourceWithinEmergencyCap(request);
  assertInvalidDraftWithinEmergencyCap(request);
  const requestIntent = detectPromptRequestIntent(request.prompt, {
    currentSource: request.currentSource,
    mode: request.mode,
  });
  const systemPrompt = buildOpenUiSystemPromptForIntents(requestIntent);

  if (request.mode === 'repair') {
    const input = buildBudgetedRepairResponseInput(env, systemPrompt, request);

    return {
      input,
      metadata: createPromptContextMetadata(env, request, input, []),
    };
  }

  const { droppedSections, input, metadataRequest } = buildBudgetedInitialResponseInput(env, systemPrompt, request);

  return {
    input,
    metadata: createPromptContextMetadata(env, metadataRequest, input, droppedSections),
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
