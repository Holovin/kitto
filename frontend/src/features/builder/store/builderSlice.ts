import { createSlice, current, isDraft, nanoid, type PayloadAction } from '@reduxjs/toolkit';
import { countCommittedVersions, formatHistoryVersionChatMessage, getBuilderHistoryVersionState } from '@features/builder/historyVersionState';
import { DEFAULT_OPENUI_SOURCE } from '@features/builder/openui/runtime/defaultSource';
import { createBuilderSnapshot } from '@features/builder/openui/runtime/persistedState';
import { validateOpenUiSource } from '@features/builder/openui/runtime/validation';
import { SYSTEM_CHAT_MESSAGE_KEYS } from '@features/builder/store/chatMessageKeys';
import type { BuilderChatMessage, BuilderParseIssue, BuilderRequestId, BuilderSnapshot, BuilderTabId } from '@features/builder/types';
import { DEFAULT_DOMAIN_DATA } from './defaults';

const MAX_HISTORY_ITEMS = 25;
const MAX_MESSAGES = 40;

function trimHistory(history: BuilderSnapshot[]) {
  return history.slice(-MAX_HISTORY_ITEMS);
}

function cloneForState<T>(value: T): T {
  const source = isDraft(value) ? current(value) : value;
  return structuredClone(source);
}

function pushMessage(messages: BuilderChatMessage[], message: BuilderChatMessage) {
  if (message.messageKey) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.messageKey !== message.messageKey) {
        continue;
      }

      const existingMessage = messages.splice(index, 1)[0];

      messages.push({
        ...existingMessage,
        content: message.content,
        createdAt: message.createdAt,
        excludeFromLlmContext: message.excludeFromLlmContext,
        role: message.role,
        tone: message.tone,
      });

      if (messages.length > MAX_MESSAGES) {
        messages.splice(0, messages.length - MAX_MESSAGES);
      }

      return;
    }
  }

  messages.push(message);

  if (messages.length > MAX_MESSAGES) {
    messages.splice(0, messages.length - MAX_MESSAGES);
  }
}

function createMessage(
  role: BuilderChatMessage['role'],
  content: string,
  tone: BuilderChatMessage['tone'] = 'default',
  messageKey?: BuilderChatMessage['messageKey'],
  excludeFromLlmContext?: BuilderChatMessage['excludeFromLlmContext'],
): BuilderChatMessage {
  return {
    id: nanoid(),
    role,
    content,
    tone,
    createdAt: new Date().toISOString(),
    excludeFromLlmContext,
    messageKey,
  };
}

function createInitialChatMessages(): BuilderChatMessage[] {
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeChatMessages(value: unknown) {
  if (!Array.isArray(value)) {
    return createInitialChatMessages();
  }

  const normalizedMessages = value.flatMap((message) => {
    if (!isRecord(message) || typeof message.content !== 'string' || typeof message.role !== 'string') {
      return [];
    }

    return [
      {
        id: typeof message.id === 'string' ? message.id : nanoid(),
        role: message.role as BuilderChatMessage['role'],
        content: message.content,
        excludeFromLlmContext: message.excludeFromLlmContext === true ? true : undefined,
        messageKey: typeof message.messageKey === 'string' ? message.messageKey : undefined,
        tone: typeof message.tone === 'string' ? (message.tone as BuilderChatMessage['tone']) : 'default',
        createdAt: typeof message.createdAt === 'string' ? message.createdAt : new Date().toISOString(),
      },
    ];
  });

  return normalizedMessages.length > 0 ? normalizedMessages : createInitialChatMessages();
}

function validateRestoredSource(source: string) {
  if (!source.trim()) {
    return {
      isValid: true,
      issues: [] as BuilderParseIssue[],
    };
  }

  return validateOpenUiSource(source);
}

function getBuilderHistoryChatMessage(
  action: 'redo' | 'undo',
  state: Pick<BuilderState, 'committedSource' | 'history' | 'isStreaming' | 'redoHistory'>,
) {
  return formatHistoryVersionChatMessage(
    action,
    getBuilderHistoryVersionState({
      committedSource: state.committedSource,
      hasRedoSnapshot: Boolean(state.redoHistory.at(-1)),
      hasUndoSnapshot: Boolean(state.history.at(-2)),
      historyVersionCount: countCommittedVersions(state.history),
      isStreaming: state.isStreaming,
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

  let rejectedSource: { issues: BuilderParseIssue[]; source: string } | null = null;
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
    const validation = validateRestoredSource(normalizedSnapshot.source);

    if (!validation.isValid) {
      rejectedSource = {
        issues: validation.issues,
        source: normalizedSnapshot.source,
      };
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
  definitionWarnings: BuilderParseIssue[];
  draftPrompt: string;
  hasRejectedDefinition: boolean;
  history: BuilderSnapshot[];
  isStreaming: boolean;
  lastStreamChunkAt: number | null;
  parseIssues: BuilderParseIssue[];
  redoHistory: BuilderSnapshot[];
  retryPrompt: string | null;
  streamError: string | null;
  // Draft source accumulated during generation; Preview continues to use committedSource until completeStreaming.
  streamedSource: string;
}

function isRejectedDefinitionState(
  state: Pick<BuilderState, 'committedSource' | 'isStreaming' | 'parseIssues' | 'streamedSource'>,
) {
  return !state.isStreaming && state.streamedSource !== state.committedSource && state.parseIssues.length > 0;
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
  isStreaming: false,
  lastStreamChunkAt: null,
  parseIssues: [],
  redoHistory: [],
  retryPrompt: null,
  streamError: null,
  streamedSource: DEFAULT_OPENUI_SOURCE,
};

export function normalizeBuilderState(value: unknown): BuilderState {
  if (!isRecord(value)) {
    return structuredClone(initialState);
  }

  const normalizedHistory = normalizeSnapshots(value.history, [initialSnapshot]);
  const history = normalizedHistory.snapshots;
  const latestSnapshot = history.at(-1) ?? initialSnapshot;
  const persistedCommittedSource = typeof value.committedSource === 'string' ? value.committedSource : latestSnapshot.source;
  const committedSourceValidation = validateRestoredSource(persistedCommittedSource);
  const rejectedSource = !committedSourceValidation.isValid
    ? {
        issues: committedSourceValidation.issues,
        source: persistedCommittedSource,
      }
    : normalizedHistory.rejectedSource;
  const committedSource = latestSnapshot.source;
  const streamedSource = rejectedSource
    ? rejectedSource.source
    : typeof value.streamedSource === 'string'
      ? value.streamedSource
      : committedSource;

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
    definitionWarnings: rejectedSource
      ? []
      : Array.isArray(value.definitionWarnings)
        ? (value.definitionWarnings as BuilderParseIssue[])
        : [],
    draftPrompt: typeof value.draftPrompt === 'string' ? value.draftPrompt : '',
    hasRejectedDefinition: Boolean(rejectedSource),
    history,
    isStreaming: false,
    lastStreamChunkAt: null,
    parseIssues: rejectedSource ? rejectedSource.issues : Array.isArray(value.parseIssues) ? (value.parseIssues as BuilderParseIssue[]) : [],
    redoHistory: normalizeSnapshots(value.redoHistory, []).snapshots,
    retryPrompt: typeof value.retryPrompt === 'string' ? value.retryPrompt : null,
    streamError: typeof value.streamError === 'string' ? value.streamError : null,
    streamedSource,
  };
}

export const builderSlice = createSlice({
  name: 'builder',
  initialState,
  reducers: {
    resetTransientState(state) {
      state.currentRequestId = null;
      state.isStreaming = false;
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
      state.isStreaming = true;
      state.lastStreamChunkAt = null;
      state.draftPrompt = '';
      state.hasRejectedDefinition = false;
      state.retryPrompt = null;
      state.streamError = null;
      state.streamedSource = '';
      state.parseIssues = [];
      pushMessage(state.chatMessages, createMessage('user', action.payload.prompt));
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
        snapshot: BuilderSnapshot;
        source: string;
        warnings: BuilderParseIssue[];
      }>,
    ) {
      if (action.payload.requestId !== state.currentRequestId) {
        return;
      }

      state.currentRequestId = null;
      state.isStreaming = false;
      state.lastStreamChunkAt = null;
      state.retryPrompt = null;
      state.streamError = null;
      state.hasRejectedDefinition = false;
      state.committedSource = action.payload.source;
      state.definitionWarnings = action.payload.warnings;
      state.streamedSource = action.payload.source;
      state.history = trimHistory([...state.history, cloneForState(action.payload.snapshot)]);
      state.redoHistory = [];
      pushMessage(
        state.chatMessages,
        createMessage(
          'assistant',
          action.payload.note ?? 'Updated the app definition from the latest chat instruction.',
          'success',
          undefined,
          true,
        ),
      );
    },
    failStreaming(
      state,
      action: PayloadAction<{
        message: string;
        requestId: BuilderRequestId;
        retryPrompt: string | null;
      }>,
    ) {
      if (action.payload.requestId !== state.currentRequestId) {
        return;
      }

      state.currentRequestId = null;
      state.isStreaming = false;
      state.lastStreamChunkAt = null;
      state.hasRejectedDefinition = false;
      state.retryPrompt = action.payload.retryPrompt;
      state.streamError = action.payload.message;
      state.streamedSource = state.committedSource;
      state.parseIssues = [];
      pushMessage(state.chatMessages, createMessage('system', action.payload.message, 'error'));
    },
    cancelStreaming(state, action: PayloadAction<{ requestId: BuilderRequestId }>) {
      if (action.payload.requestId !== state.currentRequestId) {
        return;
      }

      state.currentRequestId = null;
      state.isStreaming = false;
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
        issues: BuilderParseIssue[];
        message?: string;
        source: string;
      }>,
    ) {
      state.activeTab = 'definition';
      state.currentRequestId = null;
      state.isStreaming = false;
      state.lastStreamChunkAt = null;
      state.hasRejectedDefinition = true;
      state.retryPrompt = null;
      state.streamError = action.payload.message ?? null;
      state.streamedSource = action.payload.source;
      state.parseIssues = action.payload.issues;
    },
    setParseIssues(state, action: PayloadAction<BuilderParseIssue[]>) {
      state.parseIssues = action.payload;
      state.hasRejectedDefinition = isRejectedDefinitionState(state);
    },
    appendChatMessage(
      state,
      action: PayloadAction<{
        content: string;
        excludeFromLlmContext?: BuilderChatMessage['excludeFromLlmContext'];
        messageKey?: BuilderChatMessage['messageKey'];
        role: BuilderChatMessage['role'];
        tone?: BuilderChatMessage['tone'];
      }>,
    ) {
      pushMessage(
        state.chatMessages,
        createMessage(
          action.payload.role,
          action.payload.content,
          action.payload.tone,
          action.payload.messageKey,
          action.payload.excludeFromLlmContext,
        ),
      );
    },
    resetCurrentAppState(state) {
      const latestSnapshot = state.history.at(-1);

      if (!latestSnapshot) {
        return;
      }

      state.currentRequestId = null;
      state.retryPrompt = null;
      state.streamError = null;
      state.isStreaming = false;
      state.lastStreamChunkAt = null;
      state.hasRejectedDefinition = false;
      pushMessage(
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

      state.redoHistory = trimHistory([...state.redoHistory, cloneForState(currentSnapshot)]);
      state.committedSource = previousSnapshot.source;
      state.currentRequestId = null;
      state.definitionWarnings = [];
      state.hasRejectedDefinition = false;
      state.retryPrompt = null;
      state.streamedSource = previousSnapshot.source;
      state.parseIssues = [];
      state.streamError = null;
      state.isStreaming = false;
      state.lastStreamChunkAt = null;
      pushMessage(
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
      state.history = trimHistory([...state.history, cloneForState(redoSnapshot)]);
      state.committedSource = redoSnapshot.source;
      state.currentRequestId = null;
      state.definitionWarnings = [];
      state.hasRejectedDefinition = false;
      state.retryPrompt = null;
      state.streamedSource = redoSnapshot.source;
      state.parseIssues = [];
      state.streamError = null;
      state.isStreaming = false;
      state.lastStreamChunkAt = null;
      pushMessage(
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
      state.committedSource = action.payload.source;
      state.streamedSource = action.payload.source;
      state.currentRequestId = null;
      state.draftPrompt = '';
      state.definitionWarnings = [];
      state.hasRejectedDefinition = false;
      state.history = trimHistory(action.payload.history);
      state.parseIssues = [];
      state.redoHistory = [];
      state.retryPrompt = null;
      state.streamError = null;
      state.isStreaming = false;
      state.lastStreamChunkAt = null;
      pushMessage(
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
      state.committedSource = action.payload.snapshot.source;
      state.currentRequestId = null;
      state.definitionWarnings = [];
      state.hasRejectedDefinition = false;
      state.streamedSource = action.payload.snapshot.source;
      state.draftPrompt = '';
      state.history = trimHistory([...state.history, cloneForState(action.payload.snapshot)]);
      state.parseIssues = [];
      state.redoHistory = [];
      state.retryPrompt = null;
      state.streamError = null;
      state.isStreaming = false;
      state.lastStreamChunkAt = null;
      pushMessage(
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
      state.isStreaming = false;
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
