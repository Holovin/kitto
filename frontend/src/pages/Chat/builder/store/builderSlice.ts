import { createSlice, current, isDraft, nanoid, type PayloadAction } from '@reduxjs/toolkit';
import { BUILDER_CHAT_MESSAGE_ROLES } from '@kitto-openui/shared/builderApiContract.js';
import { isRecord } from '@kitto-openui/shared/objectGuards.js';
import { countCommittedVersions, formatHistoryVersionChatMessage, getBuilderHistoryVersionState } from '@pages/Chat/builder/historyVersionState';
import { DEFAULT_OPENUI_SOURCE } from '@pages/Chat/builder/openui/runtime/defaultSource';
import { cloneBuilderSnapshot, createBuilderSnapshot } from '@pages/Chat/builder/openui/runtime/persistedState';
import { validateOpenUiSource } from '@pages/Chat/builder/openui/runtime/validation';
import { SYSTEM_CHAT_MESSAGE_KEYS } from '@pages/Chat/builder/store/chatMessageKeys';
import type { BuilderChatMessage, PromptBuildValidationIssue, BuilderRequestId, BuilderSnapshot, BuilderTabId } from '@pages/Chat/builder/types';
import { DEFAULT_DOMAIN_DATA } from './defaults';
import { clonePersistedDomainData, clonePersistedRuntimeState } from './path';

const MAX_HISTORY_ITEMS = 25;
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

function trimHistory(history: BuilderSnapshot[]) {
  return history.slice(-MAX_HISTORY_ITEMS);
}

function trimUiMessages(messages: BuilderChatMessage[]) {
  return messages.length > MAX_UI_MESSAGES ? messages.slice(-MAX_UI_MESSAGES) : messages;
}

function readStateValue<T>(value: T): T {
  return isDraft(value) ? current(value) : value;
}

function cloneSnapshotForState(snapshot: BuilderSnapshot) {
  return cloneBuilderSnapshot(readStateValue(snapshot));
}

function cloneDomainDataForState(domainData: Record<string, unknown>) {
  return clonePersistedDomainData(readStateValue(domainData));
}

function cloneRuntimeStateForState(runtimeState: Record<string, unknown>) {
  return clonePersistedRuntimeState(readStateValue(runtimeState));
}

function pushMessage(messages: BuilderChatMessage[], message: BuilderChatMessage) {
  if (message.messageKey) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.messageKey !== message.messageKey) {
        continue;
      }

      const existingMessage = messages[index];

      if (!existingMessage) {
        continue;
      }

      const nextMessages = messages.slice();
      nextMessages[index] = {
        ...existingMessage,
        content: message.content,
        createdAt: message.createdAt,
        excludeFromLlmContext: message.excludeFromLlmContext,
        isStreaming: message.isStreaming,
        role: message.role,
        technicalDetails: message.technicalDetails,
        tone: message.tone,
      };

      return trimUiMessages(nextMessages);
    }
  }

  return trimUiMessages([...messages, message]);
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
        initialRuntimeState: snapshot.initialRuntimeState,
        initialDomainData: snapshot.initialDomainData,
      },
    );
    const invalidSnapshot = createRejectedSource(normalizedSnapshot.source);

    if (invalidSnapshot) {
      rejectedSource = invalidSnapshot;
      continue;
    }

    rejectedSource = null;
    normalizedSnapshots.push(normalizedSnapshot);
  }

  return {
    rejectedSource,
    snapshots: normalizedSnapshots.length > 0 ? trimHistory(normalizedSnapshots) : fallback,
  };
}

interface BuilderState {
  activeTab: BuilderTabId;
  chatMessages: BuilderChatMessage[];
  committedSource: string;
  currentRequestId: BuilderRequestId | null;
  definitionWarnings: PromptBuildValidationIssue[];
  draftPrompt: string;
  hasRejectedDefinition: boolean;
  history: BuilderSnapshot[];
  lastStreamChunkAt: number | null;
  parseIssues: PromptBuildValidationIssue[];
  redoHistory: BuilderSnapshot[];
  retryPrompt: string | null;
  streamError: string | null;
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

const initialSnapshot = createBuilderSnapshot(DEFAULT_OPENUI_SOURCE, {}, DEFAULT_DOMAIN_DATA);

const initialState: BuilderState = {
  activeTab: 'preview',
  chatMessages: createInitialChatMessages(),
  committedSource: DEFAULT_OPENUI_SOURCE,
  currentRequestId: null,
  definitionWarnings: [],
  draftPrompt: '',
  hasRejectedDefinition: false,
  history: [initialSnapshot],
  lastStreamChunkAt: null,
  parseIssues: [],
  redoHistory: [],
  retryPrompt: null,
  streamError: null,
  streamedSource: DEFAULT_OPENUI_SOURCE,
};

function createInitialState(): BuilderState {
  return {
    ...initialState,
    chatMessages: createInitialChatMessages(),
    definitionWarnings: [],
    history: [cloneBuilderSnapshot(initialSnapshot)],
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

  return {
    activeTab:
      rejectedSource
        ? 'definition'
        : value.activeTab === 'definition' || value.activeTab === 'app-state'
          ? value.activeTab
          : 'preview',
    chatMessages: normalizeChatMessages(value.chatMessages),
    committedSource,
    currentRequestId: null,
    definitionWarnings: rejectedSource ? [] : normalizeParseIssues(value.definitionWarnings),
    draftPrompt: typeof value.draftPrompt === 'string' ? value.draftPrompt : '',
    hasRejectedDefinition: Boolean(rejectedSource),
    history,
    lastStreamChunkAt: null,
    parseIssues: rejectedSource ? rejectedSource.issues : [],
    redoHistory: normalizeSnapshots(value.redoHistory, []).snapshots,
    retryPrompt: null,
    streamError: null,
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
      state.streamedSource = '';
      state.parseIssues = [];
      state.chatMessages = pushMessage(state.chatMessages, createMessage('user', action.payload.prompt));
    },
    appendStreamChunk(state, action: PayloadAction<{ chunk: string; requestId: BuilderRequestId }>) {
      if (action.payload.requestId !== state.currentRequestId) {
        return;
      }

      state.streamedSource += action.payload.chunk;
      state.lastStreamChunkAt = Date.now();
    },
    completeStreaming(
      state,
      action: PayloadAction<{
        note?: string;
        requestId: BuilderRequestId;
        skipDefaultAssistantMessage?: boolean;
        snapshot: BuilderSnapshot;
        source: string;
        warnings: PromptBuildValidationIssue[];
      }>,
    ) {
      if (action.payload.requestId !== state.currentRequestId) {
        return;
      }

      state.currentRequestId = null;
      state.lastStreamChunkAt = null;
      state.retryPrompt = null;
      state.streamError = null;
      state.hasRejectedDefinition = false;
      state.committedSource = action.payload.source;
      state.definitionWarnings = action.payload.warnings;
      state.streamedSource = action.payload.source;
      state.history = trimHistory([...state.history, cloneSnapshotForState(action.payload.snapshot)]);
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
      state.streamedSource = state.committedSource;
      state.parseIssues = [];
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
      state.streamedSource = action.payload.source;
      state.parseIssues = action.payload.issues;
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
      const previousSnapshot = state.history.at(-1);

      if (!previousSnapshot || !currentSnapshot) {
        return;
      }

      state.redoHistory = trimHistory([...state.redoHistory, cloneSnapshotForState(currentSnapshot)]);
      state.committedSource = previousSnapshot.source;
      state.currentRequestId = null;
      state.definitionWarnings = [];
      state.hasRejectedDefinition = false;
      state.retryPrompt = null;
      state.streamedSource = previousSnapshot.source;
      state.parseIssues = [];
      state.streamError = null;
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
      state.history = trimHistory([...state.history, cloneSnapshotForState(redoSnapshot)]);
      state.committedSource = redoSnapshot.source;
      state.currentRequestId = null;
      state.definitionWarnings = [];
      state.hasRejectedDefinition = false;
      state.retryPrompt = null;
      state.streamedSource = redoSnapshot.source;
      state.parseIssues = [];
      state.streamError = null;
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
        messageKey?: BuilderChatMessage['messageKey'];
        note?: string;
        runtimeState: Record<string, unknown>;
        source: string;
      }>,
    ) {
      state.chatMessages = createInitialChatMessages();
      state.committedSource = action.payload.source;
      state.streamedSource = action.payload.source;
      state.currentRequestId = null;
      state.draftPrompt = '';
      state.definitionWarnings = [];
      state.hasRejectedDefinition = false;
      state.history = trimHistory(action.payload.history.map((snapshot) => cloneSnapshotForState(snapshot)));
      state.parseIssues = [];
      state.redoHistory = [];
      state.retryPrompt = null;
      state.streamError = null;
      state.lastStreamChunkAt = null;
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
      state.chatMessages = createInitialChatMessages();
      state.committedSource = action.payload.snapshot.source;
      state.currentRequestId = null;
      state.definitionWarnings = [];
      state.hasRejectedDefinition = false;
      state.streamedSource = action.payload.snapshot.source;
      state.draftPrompt = '';
      state.history = trimHistory([...state.history, cloneSnapshotForState(action.payload.snapshot)]);
      state.parseIssues = [];
      state.redoHistory = [];
      state.retryPrompt = null;
      state.streamError = null;
      state.lastStreamChunkAt = null;
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
      state.redoHistory = [];
      state.retryPrompt = null;
      state.streamError = null;
    },
  },
});

export const builderActions = builderSlice.actions;
export const builderReducer = builderSlice.reducer;
