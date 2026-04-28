import { createSlice, current, isDraft, nanoid, type PayloadAction } from '@reduxjs/toolkit';
import {
  BUILDER_CHAT_MESSAGE_ROLES,
  HISTORY_SUMMARY_MAX_CHARS,
  appMemorySchema,
  normalizeAppMemory,
} from '@kitto-openui/shared/builderApiContract.js';
import { isRecord } from '@kitto-openui/shared/objectGuards.js';
import { countCommittedVersions, formatHistoryVersionChatMessage, getBuilderHistoryVersionState } from '@pages/Chat/builder/historyVersionState';
import { DEFAULT_OPENUI_SOURCE } from '@pages/Chat/builder/openui/runtime/defaultSource';
import { recoverStaleNavigationSnapshot } from '@pages/Chat/builder/openui/runtime/navigationRecovery';
import {
  CHANGE_SUMMARY_MAX_CHARS,
  cloneBuilderSnapshot,
  createBuilderSnapshot,
  SUMMARY_MAX_CHARS,
  trimBuilderRevisions,
} from '@pages/Chat/builder/openui/runtime/persistedState';
import { validateOpenUiSource } from '@pages/Chat/builder/openui/runtime/validation';
import { SYSTEM_CHAT_MESSAGE_KEYS } from '@pages/Chat/builder/store/chatMessageKeys';
import type {
  AppMemory,
  BuilderChatMessage,
  BuilderPromptContextSection,
  BuilderPromptContextSnapshot,
  PromptBuildValidationIssue,
  BuilderRequestId,
  BuilderSnapshot,
  BuilderTabId,
} from '@pages/Chat/builder/types';
import { DEFAULT_DOMAIN_DATA } from './defaults';
import { clonePersistedDomainData, clonePersistedRuntimeState } from './path';

const MAX_PREVIOUS_CHANGE_SUMMARIES = 25;
// UI-only retention budget for rendered chat history. Backend owns LLM context filtering.
export const MAX_UI_MESSAGES = 200;
const BUILDER_CHAT_TONES = new Set<NonNullable<BuilderChatMessage['tone']>>(['default', 'error', 'info', 'success']);
const BUILDER_PARSE_ISSUE_SOURCES = new Set<NonNullable<PromptBuildValidationIssue['source']>>([
  'mutation',
  'parser',
  'quality',
  'query',
  'runtime',
]);

interface NormalizedRejectedSource {
  issues: PromptBuildValidationIssue[];
  source: string;
}

function trimUiMessages(messages: BuilderChatMessage[]) {
  return messages.length > MAX_UI_MESSAGES ? messages.slice(-MAX_UI_MESSAGES) : messages;
}

function readStateValue<T>(value: T): T {
  return isDraft(value) ? current(value) : value;
}

function cloneSnapshotForState(snapshot: BuilderSnapshot) {
  return recoverStaleNavigationSnapshot(cloneBuilderSnapshot(readStateValue(snapshot)));
}

function cloneDomainDataForState(domainData: Record<string, unknown>) {
  return clonePersistedDomainData(readStateValue(domainData));
}

function cloneRuntimeStateForState(runtimeState: Record<string, unknown>) {
  return clonePersistedRuntimeState(readStateValue(runtimeState));
}

function pushMessage(messages: BuilderChatMessage[], message: BuilderChatMessage) {
  const shouldMoveUpdatedMessageToEnd = message.messageKey === SYSTEM_CHAT_MESSAGE_KEYS.backendConnectionStatus;
  const messagesWithoutLegacyStatus =
    shouldMoveUpdatedMessageToEnd
      ? messages.filter((entry) => entry.messageKey !== SYSTEM_CHAT_MESSAGE_KEYS.runtimeConfigStatus)
      : messages;

  if (message.messageKey) {
    for (let index = messagesWithoutLegacyStatus.length - 1; index >= 0; index -= 1) {
      if (messagesWithoutLegacyStatus[index]?.messageKey !== message.messageKey) {
        continue;
      }

      const existingMessage = messagesWithoutLegacyStatus[index];

      if (!existingMessage) {
        continue;
      }

      const updatedMessage = {
        ...existingMessage,
        content: message.content,
        createdAt: message.createdAt,
        excludeFromLlmContext: message.excludeFromLlmContext,
        isStreaming: message.isStreaming,
        role: message.role,
        technicalDetails: message.technicalDetails,
        tone: message.tone,
      };
      const nextMessages = shouldMoveUpdatedMessageToEnd
        ? [
            ...messagesWithoutLegacyStatus.slice(0, index),
            ...messagesWithoutLegacyStatus.slice(index + 1),
            updatedMessage,
          ]
        : messagesWithoutLegacyStatus.map((entry, entryIndex) => (entryIndex === index ? updatedMessage : entry));

      return trimUiMessages(nextMessages);
    }
  }

  return trimUiMessages([...messagesWithoutLegacyStatus, message]);
}

function createMessage(
  role: BuilderChatMessage['role'],
  content: string,
  tone: BuilderChatMessage['tone'] = 'default',
  messageKey?: BuilderChatMessage['messageKey'],
  excludeFromLlmContext?: BuilderChatMessage['excludeFromLlmContext'],
  isStreaming?: BuilderChatMessage['isStreaming'],
  technicalDetails?: BuilderChatMessage['technicalDetails'],
): BuilderChatMessage {
  return {
    id: nanoid(),
    role,
    content,
    tone,
    createdAt: new Date().toISOString(),
    excludeFromLlmContext,
    isStreaming,
    messageKey,
    technicalDetails,
  };
}

function createInitialChatMessages(): BuilderChatMessage[] {
  return [];
}

function getGenerationUserMessageKey(requestId: BuilderRequestId): BuilderChatMessage['messageKey'] {
  return `generation-user:${requestId}`;
}

function excludeGenerationUserMessageFromLlmContext(messages: BuilderChatMessage[], requestId: BuilderRequestId) {
  const messageKey = getGenerationUserMessageKey(requestId);
  const message = messages.find((entry) => entry.messageKey === messageKey);

  if (message?.role !== 'user') {
    return;
  }

  message.excludeFromLlmContext = true;
}

function isBuilderChatRole(value: string): value is BuilderChatMessage['role'] {
  return BUILDER_CHAT_MESSAGE_ROLES.includes(value as BuilderChatMessage['role']);
}

function normalizeChatMessages(value: unknown) {
  if (!Array.isArray(value)) {
    return createInitialChatMessages();
  }

  const normalizedMessages = value.flatMap((message) => {
    if (!isRecord(message) || typeof message.content !== 'string' || typeof message.role !== 'string') {
      return [];
    }

    if (!isBuilderChatRole(message.role)) {
      return [];
    }

    return [
      {
        id: typeof message.id === 'string' ? message.id : nanoid(),
        role: message.role,
        content: message.content,
        excludeFromLlmContext: message.excludeFromLlmContext === true ? true : undefined,
        messageKey: typeof message.messageKey === 'string' ? message.messageKey : undefined,
        technicalDetails: typeof message.technicalDetails === 'string' ? message.technicalDetails : undefined,
        tone:
          typeof message.tone === 'string' && BUILDER_CHAT_TONES.has(message.tone as NonNullable<BuilderChatMessage['tone']>)
            ? (message.tone as BuilderChatMessage['tone'])
            : 'default',
        createdAt: typeof message.createdAt === 'string' ? message.createdAt : new Date().toISOString(),
      },
    ];
  });

  return normalizedMessages.length > 0 ? trimUiMessages(normalizedMessages) : createInitialChatMessages();
}

function normalizeParseIssueSuggestion(value: unknown): PromptBuildValidationIssue['suggestion'] | undefined {
  if (
    !isRecord(value) ||
    value.kind !== 'replace-text' ||
    typeof value.from !== 'string' ||
    typeof value.to !== 'string'
  ) {
    return undefined;
  }

  return {
    kind: 'replace-text',
    from: value.from,
    to: value.to,
  };
}

function normalizeParseIssues(value: unknown): PromptBuildValidationIssue[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((issue) => {
    if (!isRecord(issue) || typeof issue.code !== 'string' || typeof issue.message !== 'string') {
      return [];
    }

    const normalizedIssue: PromptBuildValidationIssue = {
      code: issue.code,
      message: issue.message,
    };

    if (typeof issue.statementId === 'string') {
      normalizedIssue.statementId = issue.statementId;
    }

    if (
      typeof issue.source === 'string' &&
      BUILDER_PARSE_ISSUE_SOURCES.has(issue.source as NonNullable<PromptBuildValidationIssue['source']>)
    ) {
      normalizedIssue.source = issue.source as PromptBuildValidationIssue['source'];
    }

    const suggestion = normalizeParseIssueSuggestion(issue.suggestion);

    if (suggestion) {
      normalizedIssue.suggestion = suggestion;
    }

    return [normalizedIssue];
  });
}

function normalizePreviousChangeSummaries(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .flatMap((summary) => (typeof summary === 'string' && summary.trim() ? [summary.trim().slice(0, 300)] : []))
    .slice(-MAX_PREVIOUS_CHANGE_SUMMARIES);
}

function normalizeOptionalAppMemory(value: unknown): AppMemory | undefined {
  return appMemorySchema.safeParse(value).success ? normalizeAppMemory(value) : undefined;
}

function normalizePromptContextSection(value: unknown): BuilderPromptContextSection | null {
  if (
    !isRecord(value) ||
    typeof value.name !== 'string' ||
    typeof value.content !== 'string' ||
    typeof value.chars !== 'number' ||
    typeof value.included !== 'boolean' ||
    typeof value.priority !== 'number' ||
    typeof value.protected !== 'boolean'
  ) {
    return null;
  }

  return {
    name: value.name,
    chars: value.chars,
    ...(typeof value.budgetLabel === 'string' ? { budgetLabel: value.budgetLabel } : {}),
    content: value.content,
    ...(typeof value.hardLimitChars === 'number' ? { hardLimitChars: value.hardLimitChars } : {}),
    included: value.included,
    ...(Array.isArray(value.limitLabels)
      ? { limitLabels: value.limitLabels.flatMap((label) => (typeof label === 'string' ? [label] : [])) }
      : {}),
    priority: value.priority,
    protected: value.protected,
    ...(typeof value.reason === 'string' ? { reason: value.reason } : {}),
    ...(typeof value.softLimitChars === 'number' ? { softLimitChars: value.softLimitChars } : {}),
    ...(typeof value.unminifiedChars === 'number' ? { unminifiedChars: value.unminifiedChars } : {}),
  };
}

function normalizePromptContextSnapshot(value: unknown): BuilderPromptContextSnapshot | undefined {
  if (
    !isRecord(value) ||
    (value.mode !== 'initial' && value.mode !== 'repair') ||
    typeof value.currentSourceChars !== 'number' ||
    typeof value.currentSourceIncluded !== 'boolean' ||
    value.currentSourceProtected !== true ||
    !Array.isArray(value.droppedSections) ||
    !Array.isArray(value.sections) ||
    typeof value.totalChars !== 'number'
  ) {
    return undefined;
  }

  const sections = value.sections.flatMap((section) => {
    const normalizedSection = normalizePromptContextSection(section);
    return normalizedSection ? [normalizedSection] : [];
  });

  if (sections.length === 0) {
    return undefined;
  }

  return {
    currentSourceChars: value.currentSourceChars,
    currentSourceIncluded: value.currentSourceIncluded,
    currentSourceProtected: true,
    droppedSections: value.droppedSections.flatMap((section) => (typeof section === 'string' ? [section] : [])),
    mode: value.mode,
    sections,
    totalChars: value.totalChars,
  };
}

function getSnapshotAppMemory(snapshot: BuilderSnapshot | undefined) {
  return snapshot?.appMemory ? normalizeAppMemory(snapshot.appMemory) : undefined;
}

function getSnapshotHistorySummary(snapshot: BuilderSnapshot | undefined) {
  const historySummary = snapshot?.historySummary?.trim();
  return historySummary ? historySummary.slice(0, HISTORY_SUMMARY_MAX_CHARS) : undefined;
}

function getRevisionChangeSummariesBeforeCurrent(history: BuilderSnapshot[]) {
  return normalizePreviousChangeSummaries(history.slice(0, -1).map((snapshot) => snapshot.changeSummary));
}

function validateRestoredSource(source: string) {
  if (!source.trim()) {
    return {
      isValid: true,
      issues: [] as PromptBuildValidationIssue[],
    };
  }

  return validateOpenUiSource(source);
}

function createRejectedSource(source: string): NormalizedRejectedSource | null {
  const validation = validateRestoredSource(source);

  if (validation.isValid) {
    return null;
  }

  return {
    issues: validation.issues,
    source,
  };
}

function getBuilderHistoryChatMessage(
  action: 'redo' | 'undo',
  state: Pick<BuilderState, 'committedSource' | 'history' | 'redoHistory'>,
) {
  return formatHistoryVersionChatMessage(
    action,
    getBuilderHistoryVersionState({
      committedSource: state.committedSource,
      hasRedoSnapshot: Boolean(state.redoHistory.at(-1)),
      hasUndoSnapshot: Boolean(state.history.at(-2)),
      historyVersionCount: countCommittedVersions(state.history),
      redoVersionCount: countCommittedVersions(state.redoHistory),
    }),
  );
}

function normalizeSnapshots(value: unknown, fallback: BuilderSnapshot[]) {
  if (!Array.isArray(value)) {
    return {
      rejectedSource: null,
      snapshots: fallback,
    };
  }

  let rejectedSource: NormalizedRejectedSource | null = null;
  const normalizedSnapshots: BuilderSnapshot[] = [];

  for (const snapshot of value) {
    if (!isRecord(snapshot)) {
      continue;
    }

    if (
      !isRecord(snapshot.runtimeState) ||
      !isRecord(snapshot.domainData) ||
      !isRecord(snapshot.initialRuntimeState) ||
      !isRecord(snapshot.initialDomainData)
    ) {
      continue;
    }

    const normalizedSnapshot = createBuilderSnapshot(
      typeof snapshot.source === 'string' ? snapshot.source : DEFAULT_OPENUI_SOURCE,
      snapshot.runtimeState,
      snapshot.domainData,
      {
        appMemory: normalizeOptionalAppMemory(snapshot.appMemory),
        changeSummary: typeof snapshot.changeSummary === 'string' ? snapshot.changeSummary : '',
        createdAt: typeof snapshot.createdAt === 'string' ? snapshot.createdAt : undefined,
        historySummary: typeof snapshot.historySummary === 'string' ? snapshot.historySummary : undefined,
        id: typeof snapshot.id === 'string' ? snapshot.id : undefined,
        initialRuntimeState: snapshot.initialRuntimeState,
        initialDomainData: snapshot.initialDomainData,
        summary: typeof snapshot.summary === 'string' ? snapshot.summary : '',
      },
    );
    const invalidSnapshot = createRejectedSource(normalizedSnapshot.source);

    if (invalidSnapshot) {
      rejectedSource = invalidSnapshot;
      continue;
    }

    rejectedSource = null;
    normalizedSnapshots.push(recoverStaleNavigationSnapshot(normalizedSnapshot));
  }

  return {
    rejectedSource,
    snapshots: normalizedSnapshots.length > 0 ? trimBuilderRevisions(normalizedSnapshots) : fallback,
  };
}

interface BuilderState {
  activeTab: BuilderTabId;
  appMemory?: AppMemory;
  chatMessages: BuilderChatMessage[];
  committedSource: string;
  currentRequestId: BuilderRequestId | null;
  definitionWarnings: PromptBuildValidationIssue[];
  draftPrompt: string;
  hasRejectedDefinition: boolean;
  history: BuilderSnapshot[];
  historySummary?: string;
  lastPromptContext?: BuilderPromptContextSnapshot;
  lastStreamChunkAt: number | null;
  parseIssues: PromptBuildValidationIssue[];
  previousChangeSummaries: string[];
  redoHistory: BuilderSnapshot[];
  retryPrompt: string | null;
  streamError: string | null;
  streamingStatus: string | null;
  // Draft source accumulated during generation; Preview continues to use committedSource until completeStreaming.
  streamedSource: string;
}

function removeMessageByKey(messages: BuilderChatMessage[], messageKey: BuilderChatMessage['messageKey']) {
  if (!messageKey) {
    return;
  }

  const messageIndex = messages.findIndex((message) => message.messageKey === messageKey);

  if (messageIndex >= 0) {
    messages.splice(messageIndex, 1);
  }
}

function isRejectedDefinitionState(
  state: Pick<BuilderState, 'committedSource' | 'currentRequestId' | 'parseIssues' | 'streamedSource'>,
) {
  return state.currentRequestId === null && state.streamedSource !== state.committedSource && state.parseIssues.length > 0;
}

function clearPromptContextState(state: Pick<BuilderState, 'lastPromptContext'>) {
  state.lastPromptContext = undefined;
}

const initialSnapshot = createBuilderSnapshot(DEFAULT_OPENUI_SOURCE, {}, DEFAULT_DOMAIN_DATA);

const initialState: BuilderState = {
  activeTab: 'preview',
  appMemory: undefined,
  chatMessages: createInitialChatMessages(),
  committedSource: DEFAULT_OPENUI_SOURCE,
  currentRequestId: null,
  definitionWarnings: [],
  draftPrompt: '',
  hasRejectedDefinition: false,
  history: [initialSnapshot],
  historySummary: undefined,
  lastPromptContext: undefined,
  lastStreamChunkAt: null,
  parseIssues: [],
  previousChangeSummaries: [],
  redoHistory: [],
  retryPrompt: null,
  streamError: null,
  streamingStatus: null,
  streamedSource: DEFAULT_OPENUI_SOURCE,
};

function createInitialState(): BuilderState {
  return {
    ...initialState,
    appMemory: undefined,
    chatMessages: createInitialChatMessages(),
    definitionWarnings: [],
    history: [cloneBuilderSnapshot(initialSnapshot)],
    historySummary: undefined,
    lastPromptContext: undefined,
    parseIssues: [],
    redoHistory: [],
  };
}

export function normalizeBuilderState(value: unknown): BuilderState {
  if (!isRecord(value)) {
    return createInitialState();
  }

  const normalizedHistory = normalizeSnapshots(value.history, [initialSnapshot]);
  const history = normalizedHistory.snapshots;
  const latestSnapshot = history.at(-1) ?? initialSnapshot;
  const persistedCommittedSource = typeof value.committedSource === 'string' ? value.committedSource : latestSnapshot.source;
  const committedSource = latestSnapshot.source;
  const persistedRejectedDraft =
    typeof value.streamedSource === 'string' && value.streamedSource !== committedSource
      ? createRejectedSource(value.streamedSource)
      : null;
  const rejectedSource = createRejectedSource(persistedCommittedSource) ?? normalizedHistory.rejectedSource ?? persistedRejectedDraft;

  const currentAppMemory = getSnapshotAppMemory(latestSnapshot) ?? normalizeOptionalAppMemory(value.appMemory);
  const currentHistorySummary =
    getSnapshotHistorySummary(latestSnapshot) ??
    (typeof value.historySummary === 'string' && value.historySummary.trim()
      ? value.historySummary.trim().slice(0, HISTORY_SUMMARY_MAX_CHARS)
      : undefined);

  return {
    activeTab:
      rejectedSource
        ? 'definition'
        : value.activeTab === 'definition' || value.activeTab === 'app-state' || value.activeTab === 'context'
          ? value.activeTab
          : 'preview',
    appMemory: currentAppMemory,
    chatMessages: normalizeChatMessages(value.chatMessages),
    committedSource,
    currentRequestId: null,
    definitionWarnings: rejectedSource ? [] : normalizeParseIssues(value.definitionWarnings),
    draftPrompt: typeof value.draftPrompt === 'string' ? value.draftPrompt : '',
    hasRejectedDefinition: Boolean(rejectedSource),
    history,
    historySummary: currentHistorySummary,
    lastPromptContext: normalizePromptContextSnapshot(value.lastPromptContext),
    lastStreamChunkAt: null,
    parseIssues: rejectedSource ? rejectedSource.issues : [],
    previousChangeSummaries: getRevisionChangeSummariesBeforeCurrent(history),
    redoHistory: normalizeSnapshots(value.redoHistory, []).snapshots,
    retryPrompt: null,
    streamError: null,
    streamingStatus: null,
    streamedSource: rejectedSource ? rejectedSource.source : committedSource,
  };
}

export const builderSlice = createSlice({
  name: 'builder',
  initialState,
  reducers: {
    resetTransientState(state) {
      state.currentRequestId = null;
      state.lastStreamChunkAt = null;
      state.retryPrompt = null;
      state.streamError = null;
      state.streamingStatus = null;
      state.hasRejectedDefinition = isRejectedDefinitionState(state);
      if (!state.hasRejectedDefinition) {
        state.streamedSource = state.committedSource;
      }
    },
    setDraftPrompt(state, action: PayloadAction<string>) {
      state.draftPrompt = action.payload;
    },
    setActiveTab(state, action: PayloadAction<BuilderTabId>) {
      state.activeTab = action.payload;
    },
    beginStreaming(state, action: PayloadAction<{ prompt: string; requestId: BuilderRequestId }>) {
      state.currentRequestId = action.payload.requestId;
      state.lastStreamChunkAt = null;
      state.draftPrompt = '';
      state.hasRejectedDefinition = false;
      state.retryPrompt = null;
      state.streamError = null;
      state.streamingStatus = 'Processing request...';
      state.streamedSource = '';
      state.parseIssues = [];
      clearPromptContextState(state);
      state.chatMessages = pushMessage(
        state.chatMessages,
        createMessage('user', action.payload.prompt, 'default', getGenerationUserMessageKey(action.payload.requestId)),
      );
    },
    appendStreamChunk(state, action: PayloadAction<{ chunk: string; requestId: BuilderRequestId }>) {
      if (action.payload.requestId !== state.currentRequestId) {
        return;
      }

      state.streamedSource += action.payload.chunk;
      state.lastStreamChunkAt = Date.now();
      state.streamingStatus = null;
    },
    setStreamingStatus(state, action: PayloadAction<{ requestId: BuilderRequestId; status: string }>) {
      if (action.payload.requestId !== state.currentRequestId) {
        return;
      }

      const status = action.payload.status.trim();

      if (!status) {
        return;
      }

      state.streamingStatus = status;
    },
    completeStreaming(
      state,
      action: PayloadAction<{
        appMemory?: AppMemory;
        changeSummary?: string;
        historySummary?: string;
        note?: string;
        promptContext?: BuilderPromptContextSnapshot;
        requestId: BuilderRequestId;
        skipDefaultAssistantMessage?: boolean;
        snapshot: BuilderSnapshot;
        source: string;
        summary?: string;
        warnings: PromptBuildValidationIssue[];
      }>,
    ) {
      if (action.payload.requestId !== state.currentRequestId) {
        return;
      }

      state.currentRequestId = null;
      state.appMemory = action.payload.appMemory ? normalizeAppMemory(action.payload.appMemory) : undefined;
      state.lastStreamChunkAt = null;
      state.retryPrompt = null;
      state.streamError = null;
      state.streamingStatus = null;
      state.hasRejectedDefinition = false;
      state.lastPromptContext = action.payload.promptContext;
      state.committedSource = action.payload.source;
      state.definitionWarnings = action.payload.warnings;
      state.streamedSource = action.payload.source;
      const revisionSnapshot = cloneSnapshotForState({
        ...action.payload.snapshot,
        ...(action.payload.appMemory ? { appMemory: action.payload.appMemory } : {}),
        changeSummary: action.payload.changeSummary?.trim().slice(0, CHANGE_SUMMARY_MAX_CHARS) ?? '',
        historySummary: action.payload.historySummary,
        summary: action.payload.summary?.trim().slice(0, SUMMARY_MAX_CHARS) ?? '',
      });
      state.history = trimBuilderRevisions([...state.history, revisionSnapshot]);
      state.historySummary = getSnapshotHistorySummary(revisionSnapshot);
      state.previousChangeSummaries = getRevisionChangeSummariesBeforeCurrent(state.history);
      state.redoHistory = [];

      if (action.payload.note) {
        state.chatMessages = pushMessage(
          state.chatMessages,
          createMessage(
            'assistant',
            action.payload.note,
            'success',
            undefined,
            true,
          ),
        );
      } else if (!action.payload.skipDefaultAssistantMessage) {
        state.chatMessages = pushMessage(
          state.chatMessages,
          createMessage(
            'assistant',
            'Applied the latest chat instruction to the app definition.',
            'success',
            undefined,
            true,
          ),
        );
      }
    },
    failStreaming(
      state,
      action: PayloadAction<{
        message: string;
        requestId: BuilderRequestId;
        retryPrompt: string | null;
        technicalDetails?: string;
      }>,
    ) {
      if (action.payload.requestId !== state.currentRequestId) {
        return;
      }

      state.currentRequestId = null;
      state.lastStreamChunkAt = null;
      state.hasRejectedDefinition = false;
      state.retryPrompt = action.payload.retryPrompt;
      state.streamError = action.payload.technicalDetails ?? action.payload.message;
      state.streamingStatus = null;
      state.streamedSource = state.committedSource;
      state.parseIssues = [];
      state.chatMessages = pushMessage(
        state.chatMessages,
        createMessage('system', action.payload.message, 'error', undefined, undefined, undefined, action.payload.technicalDetails),
      );
    },
    cancelStreaming(state, action: PayloadAction<{ requestId: BuilderRequestId }>) {
      if (action.payload.requestId !== state.currentRequestId) {
        return;
      }

      state.currentRequestId = null;
      state.lastStreamChunkAt = null;
      state.hasRejectedDefinition = false;
      state.retryPrompt = null;
      state.streamError = null;
      state.streamingStatus = null;
      state.streamedSource = state.committedSource;
      state.parseIssues = [];
      excludeGenerationUserMessageFromLlmContext(state.chatMessages, action.payload.requestId);
    },
    rejectDefinition(
      state,
      action: PayloadAction<{
        issues: PromptBuildValidationIssue[];
        message?: string;
        source: string;
      }>,
    ) {
      state.activeTab = 'definition';
      state.currentRequestId = null;
      state.lastStreamChunkAt = null;
      state.hasRejectedDefinition = true;
      state.retryPrompt = null;
      state.streamError = action.payload.message ?? null;
      state.streamingStatus = null;
      state.streamedSource = action.payload.source;
      state.parseIssues = action.payload.issues;
      clearPromptContextState(state);
    },
    setParseIssues(state, action: PayloadAction<PromptBuildValidationIssue[]>) {
      state.parseIssues = action.payload;
      state.hasRejectedDefinition = isRejectedDefinitionState(state);
    },
    appendChatMessage(
      state,
      action: PayloadAction<{
        content: string;
        excludeFromLlmContext?: BuilderChatMessage['excludeFromLlmContext'];
        isStreaming?: BuilderChatMessage['isStreaming'];
        messageKey?: BuilderChatMessage['messageKey'];
        role: BuilderChatMessage['role'];
        technicalDetails?: BuilderChatMessage['technicalDetails'];
        tone?: BuilderChatMessage['tone'];
      }>,
    ) {
      state.chatMessages = pushMessage(
        state.chatMessages,
        createMessage(
          action.payload.role,
          action.payload.content,
          action.payload.tone,
          action.payload.messageKey,
          action.payload.excludeFromLlmContext,
          action.payload.isStreaming,
          action.payload.technicalDetails,
        ),
      );
    },
    syncLatestSnapshotState(
      state,
      action: PayloadAction<{
        domainData?: Record<string, unknown>;
        runtimeState?: Record<string, unknown>;
      }>,
    ) {
      const latestSnapshot = state.history.at(-1);

      if (!latestSnapshot) {
        return;
      }

      if (action.payload.domainData !== undefined) {
        latestSnapshot.domainData = cloneDomainDataForState(action.payload.domainData);
      }

      if (action.payload.runtimeState !== undefined) {
        latestSnapshot.runtimeState = cloneRuntimeStateForState(action.payload.runtimeState);
      }
    },
    removeChatMessageByKey(
      state,
      action: PayloadAction<{
        messageKey: BuilderChatMessage['messageKey'];
      }>,
    ) {
      removeMessageByKey(state.chatMessages, action.payload.messageKey);
    },
    resetCurrentAppState(state) {
      const latestSnapshot = state.history.at(-1);

      if (!latestSnapshot) {
        return;
      }

      state.currentRequestId = null;
      state.retryPrompt = null;
      state.streamError = null;
      state.streamingStatus = null;
      state.lastStreamChunkAt = null;
      state.hasRejectedDefinition = false;
      state.chatMessages = pushMessage(
        state.chatMessages,
        createMessage('system', 'Reset the generated app state to its initial version.', 'info', SYSTEM_CHAT_MESSAGE_KEYS.appStateReset),
      );
    },
    undoLatest(state) {
      if (state.history.length < 2) {
        return;
      }

      const currentSnapshot = state.history.at(-1);
      state.history = state.history.slice(0, -1);
      let previousSnapshot = state.history.at(-1);

      if (!previousSnapshot || !currentSnapshot) {
        return;
      }

      const recoveredPreviousSnapshot = recoverStaleNavigationSnapshot(previousSnapshot);

      if (recoveredPreviousSnapshot !== previousSnapshot) {
        state.history[state.history.length - 1] = recoveredPreviousSnapshot;
        previousSnapshot = recoveredPreviousSnapshot;
      }

      state.redoHistory = trimBuilderRevisions([...state.redoHistory, cloneSnapshotForState(currentSnapshot)]);
      state.committedSource = previousSnapshot.source;
      state.appMemory = getSnapshotAppMemory(previousSnapshot);
      state.historySummary = getSnapshotHistorySummary(previousSnapshot);
      state.currentRequestId = null;
      state.definitionWarnings = [];
      state.hasRejectedDefinition = false;
      state.retryPrompt = null;
      state.streamedSource = previousSnapshot.source;
      state.parseIssues = [];
      state.previousChangeSummaries = getRevisionChangeSummariesBeforeCurrent(state.history);
      state.streamError = null;
      state.streamingStatus = null;
      state.lastStreamChunkAt = null;
      state.chatMessages = pushMessage(
        state.chatMessages,
        createMessage('system', getBuilderHistoryChatMessage('undo', state), 'info', SYSTEM_CHAT_MESSAGE_KEYS.historyNavigation),
      );
    },
    redoLatest(state) {
      const redoSnapshot = state.redoHistory.at(-1);

      if (!redoSnapshot) {
        return;
      }

      state.redoHistory = state.redoHistory.slice(0, -1);
      state.history = trimBuilderRevisions([...state.history, cloneSnapshotForState(redoSnapshot)]);
      state.committedSource = redoSnapshot.source;
      state.appMemory = getSnapshotAppMemory(redoSnapshot);
      state.historySummary = getSnapshotHistorySummary(redoSnapshot);
      state.currentRequestId = null;
      state.definitionWarnings = [];
      state.hasRejectedDefinition = false;
      state.retryPrompt = null;
      state.streamedSource = redoSnapshot.source;
      state.parseIssues = [];
      state.previousChangeSummaries = getRevisionChangeSummariesBeforeCurrent(state.history);
      state.streamError = null;
      state.streamingStatus = null;
      state.lastStreamChunkAt = null;
      state.chatMessages = pushMessage(
        state.chatMessages,
        createMessage('system', getBuilderHistoryChatMessage('redo', state), 'info', SYSTEM_CHAT_MESSAGE_KEYS.historyNavigation),
      );
    },
    loadDefinition(
      state,
      action: PayloadAction<{
        history: BuilderSnapshot[];
        appMemory?: AppMemory;
        messageKey?: BuilderChatMessage['messageKey'];
        note?: string;
        runtimeState: Record<string, unknown>;
        source: string;
      }>,
    ) {
      state.chatMessages = createInitialChatMessages();
      state.appMemory = action.payload.appMemory ? normalizeAppMemory(action.payload.appMemory) : undefined;
      state.historySummary = getSnapshotHistorySummary(action.payload.history.at(-1));
      state.committedSource = action.payload.source;
      state.streamedSource = action.payload.source;
      state.currentRequestId = null;
      state.draftPrompt = '';
      state.definitionWarnings = [];
      state.hasRejectedDefinition = false;
      state.history = trimBuilderRevisions(action.payload.history.map((snapshot) => cloneSnapshotForState(snapshot)));
      state.parseIssues = [];
      state.previousChangeSummaries = getRevisionChangeSummariesBeforeCurrent(state.history);
      state.redoHistory = [];
      state.retryPrompt = null;
      state.streamError = null;
      state.streamingStatus = null;
      state.lastStreamChunkAt = null;
      clearPromptContextState(state);
      state.chatMessages = pushMessage(
        state.chatMessages,
        createMessage('system', action.payload.note ?? 'Imported a saved Kitto definition.', 'success', action.payload.messageKey),
      );
    },
    applyDemoDefinition(
      state,
      action: PayloadAction<{
        label: string;
        snapshot: BuilderSnapshot;
      }>,
    ) {
      state.activeTab = 'preview';
      state.appMemory = undefined;
      state.historySummary = getSnapshotHistorySummary(action.payload.snapshot);
      state.chatMessages = createInitialChatMessages();
      state.committedSource = action.payload.snapshot.source;
      state.currentRequestId = null;
      state.definitionWarnings = [];
      state.hasRejectedDefinition = false;
      state.streamedSource = action.payload.snapshot.source;
      state.draftPrompt = '';
      state.history = trimBuilderRevisions([cloneSnapshotForState(action.payload.snapshot)]);
      state.parseIssues = [];
      state.previousChangeSummaries = [];
      state.redoHistory = [];
      state.retryPrompt = null;
      state.streamError = null;
      state.streamingStatus = null;
      state.lastStreamChunkAt = null;
      clearPromptContextState(state);
      state.chatMessages = pushMessage(
        state.chatMessages,
        createMessage(
          'system',
          `Loaded the "${action.payload.label}" demo into the blank canvas.`,
          'success',
          SYSTEM_CHAT_MESSAGE_KEYS.demoLoadSuccess,
        ),
      );
    },
    resetToEmpty(state) {
      state.activeTab = 'preview';
      state.appMemory = undefined;
      state.historySummary = undefined;
      state.chatMessages = createInitialChatMessages();
      state.committedSource = DEFAULT_OPENUI_SOURCE;
      state.currentRequestId = null;
      state.definitionWarnings = [];
      state.draftPrompt = '';
      state.hasRejectedDefinition = false;
      state.streamedSource = DEFAULT_OPENUI_SOURCE;
      state.history = [createBuilderSnapshot(DEFAULT_OPENUI_SOURCE, {}, DEFAULT_DOMAIN_DATA)];
      state.lastStreamChunkAt = null;
      state.parseIssues = [];
      state.previousChangeSummaries = [];
      state.redoHistory = [];
      state.retryPrompt = null;
      state.streamError = null;
      state.streamingStatus = null;
      clearPromptContextState(state);
    },
  },
});

export const builderActions = builderSlice.actions;
export const builderReducer = builderSlice.reducer;
