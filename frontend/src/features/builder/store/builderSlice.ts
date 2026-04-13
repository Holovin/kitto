import { createSlice, current, isDraft, nanoid, type PayloadAction } from '@reduxjs/toolkit';
import { DEFAULT_OPENUI_SOURCE } from '@features/builder/openui/runtime/defaultSource';
import { createBuilderSnapshot } from '@features/builder/openui/runtime/persistedState';
import type { BuilderChatMessage, BuilderParseIssue, BuilderSnapshot, BuilderTabId } from '@features/builder/types';
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
  messages.push(message);

  if (messages.length > MAX_MESSAGES) {
    messages.splice(0, messages.length - MAX_MESSAGES);
  }
}

function createMessage(
  role: BuilderChatMessage['role'],
  content: string,
  tone: BuilderChatMessage['tone'] = 'default',
): BuilderChatMessage {
  return {
    id: nanoid(),
    role,
    content,
    tone,
    createdAt: new Date().toISOString(),
  };
}

function createInitialChatMessages(): BuilderChatMessage[] {
  return [
    {
      id: 'builder-welcome',
      role: 'assistant',
      content: 'Describe the app or change you want.',
      tone: 'info',
      createdAt: new Date(0).toISOString(),
    },
  ];
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
        tone: typeof message.tone === 'string' ? (message.tone as BuilderChatMessage['tone']) : 'default',
        createdAt: typeof message.createdAt === 'string' ? message.createdAt : new Date().toISOString(),
      },
    ];
  });

  return normalizedMessages.length > 0 ? normalizedMessages : createInitialChatMessages();
}

function normalizeSnapshots(value: unknown, fallback: BuilderSnapshot[]) {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const normalizedSnapshots = value.flatMap((snapshot) => {
    if (!isRecord(snapshot)) {
      return [];
    }

    const initialRuntimeState = isRecord(snapshot.initialRuntimeState)
      ? snapshot.initialRuntimeState
      : isRecord(snapshot.runtimeState)
        ? snapshot.runtimeState
        : {};
    const initialDomainData = isRecord(snapshot.initialDomainData)
      ? snapshot.initialDomainData
      : isRecord(snapshot.domainData)
        ? snapshot.domainData
        : DEFAULT_DOMAIN_DATA;

    return [
      createBuilderSnapshot(
        typeof snapshot.source === 'string' ? snapshot.source : DEFAULT_OPENUI_SOURCE,
        initialRuntimeState,
        initialDomainData,
        {
          initialRuntimeState,
          initialDomainData,
        },
      ),
    ];
  });

  return normalizedSnapshots.length > 0 ? trimHistory(normalizedSnapshots) : fallback;
}

interface BuilderState {
  activeTab: BuilderTabId;
  chatMessages: BuilderChatMessage[];
  committedSource: string;
  draftPrompt: string;
  history: BuilderSnapshot[];
  isStreaming: boolean;
  parseIssues: BuilderParseIssue[];
  redoHistory: BuilderSnapshot[];
  streamError: string | null;
  streamedSource: string;
}

const initialSnapshot = createBuilderSnapshot(DEFAULT_OPENUI_SOURCE, {}, DEFAULT_DOMAIN_DATA);

const initialState: BuilderState = {
  activeTab: 'preview',
  chatMessages: createInitialChatMessages(),
  committedSource: DEFAULT_OPENUI_SOURCE,
  draftPrompt: '',
  history: [initialSnapshot],
  isStreaming: false,
  parseIssues: [],
  redoHistory: [],
  streamError: null,
  streamedSource: DEFAULT_OPENUI_SOURCE,
};

export function normalizeBuilderState(value: unknown): BuilderState {
  if (!isRecord(value)) {
    return structuredClone(initialState);
  }

  const history = normalizeSnapshots(value.history, [initialSnapshot]);
  const latestSnapshot = history.at(-1) ?? initialSnapshot;
  const committedSource = typeof value.committedSource === 'string' ? value.committedSource : latestSnapshot.source;

  return {
    activeTab: value.activeTab === 'definition' ? 'definition' : 'preview',
    chatMessages: normalizeChatMessages(value.chatMessages),
    committedSource,
    draftPrompt: typeof value.draftPrompt === 'string' ? value.draftPrompt : '',
    history,
    isStreaming: false,
    parseIssues: Array.isArray(value.parseIssues) ? (value.parseIssues as BuilderParseIssue[]) : [],
    redoHistory: normalizeSnapshots(value.redoHistory, []),
    streamError: typeof value.streamError === 'string' ? value.streamError : null,
    streamedSource: typeof value.streamedSource === 'string' ? value.streamedSource : committedSource,
  };
}

export const builderSlice = createSlice({
  name: 'builder',
  initialState,
  reducers: {
    resetTransientState(state) {
      state.isStreaming = false;
      state.streamError = null;
      state.streamedSource = state.committedSource;
    },
    setDraftPrompt(state, action: PayloadAction<string>) {
      state.draftPrompt = action.payload;
    },
    setActiveTab(state, action: PayloadAction<BuilderTabId>) {
      state.activeTab = action.payload;
    },
    beginStreaming(state, action: PayloadAction<{ prompt: string }>) {
      state.isStreaming = true;
      state.draftPrompt = '';
      state.streamError = null;
      state.streamedSource = '';
      state.parseIssues = [];
      pushMessage(state.chatMessages, createMessage('user', action.payload.prompt));
    },
    appendStreamChunk(state, action: PayloadAction<string>) {
      state.streamedSource += action.payload;
    },
    completeStreaming(
      state,
      action: PayloadAction<{
        note?: string;
        snapshot: BuilderSnapshot;
        source: string;
      }>,
    ) {
      state.isStreaming = false;
      state.streamError = null;
      state.committedSource = action.payload.source;
      state.streamedSource = action.payload.source;
      state.history = trimHistory([...state.history, cloneForState(action.payload.snapshot)]);
      state.redoHistory = [];
      pushMessage(
        state.chatMessages,
        createMessage('assistant', action.payload.note ?? 'Updated the app definition from the latest chat instruction.', 'success'),
      );
    },
    failStreaming(state, action: PayloadAction<{ message: string }>) {
      state.isStreaming = false;
      state.streamError = action.payload.message;
      state.streamedSource = state.committedSource;
      pushMessage(state.chatMessages, createMessage('system', action.payload.message, 'error'));
    },
    setParseIssues(state, action: PayloadAction<BuilderParseIssue[]>) {
      state.parseIssues = action.payload;
    },
    appendChatMessage(
      state,
      action: PayloadAction<{
        content: string;
        role: BuilderChatMessage['role'];
        tone?: BuilderChatMessage['tone'];
      }>,
    ) {
      pushMessage(state.chatMessages, createMessage(action.payload.role, action.payload.content, action.payload.tone));
    },
    resetCurrentAppState(state) {
      const latestSnapshot = state.history.at(-1);

      if (!latestSnapshot) {
        return;
      }

      state.streamError = null;
      state.isStreaming = false;
      pushMessage(state.chatMessages, createMessage('system', 'Reset the generated app state to its initial version.', 'info'));
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
      state.streamedSource = previousSnapshot.source;
      state.parseIssues = [];
      state.streamError = null;
      state.isStreaming = false;
      pushMessage(state.chatMessages, createMessage('system', 'Reverted to the previous committed version.', 'info'));
    },
    redoLatest(state) {
      const redoSnapshot = state.redoHistory.at(-1);

      if (!redoSnapshot) {
        return;
      }

      state.redoHistory = state.redoHistory.slice(0, -1);
      state.history = trimHistory([...state.history, cloneForState(redoSnapshot)]);
      state.committedSource = redoSnapshot.source;
      state.streamedSource = redoSnapshot.source;
      state.parseIssues = [];
      state.streamError = null;
      state.isStreaming = false;
      pushMessage(state.chatMessages, createMessage('system', 'Restored the last undone version.', 'info'));
    },
    loadDefinition(
      state,
      action: PayloadAction<{
        history: BuilderSnapshot[];
        note?: string;
        runtimeState: Record<string, unknown>;
        source: string;
      }>,
    ) {
      state.committedSource = action.payload.source;
      state.streamedSource = action.payload.source;
      state.draftPrompt = '';
      state.chatMessages = createInitialChatMessages();
      state.history = trimHistory(action.payload.history);
      state.parseIssues = [];
      state.redoHistory = [];
      state.streamError = null;
      state.isStreaming = false;
      pushMessage(
        state.chatMessages,
        createMessage('system', action.payload.note ?? 'Imported a saved Kitto definition.', 'success'),
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
      state.streamedSource = action.payload.snapshot.source;
      state.draftPrompt = '';
      state.history = trimHistory([...state.history, cloneForState(action.payload.snapshot)]);
      state.parseIssues = [];
      state.redoHistory = [];
      state.streamError = null;
      state.isStreaming = false;
      pushMessage(
        state.chatMessages,
        createMessage('system', `Loaded the "${action.payload.label}" demo into the blank canvas.`, 'success'),
      );
    },
    resetToEmpty(state) {
      state.activeTab = 'preview';
      state.chatMessages = createInitialChatMessages();
      state.committedSource = DEFAULT_OPENUI_SOURCE;
      state.draftPrompt = '';
      state.streamedSource = DEFAULT_OPENUI_SOURCE;
      state.history = [createBuilderSnapshot(DEFAULT_OPENUI_SOURCE, {}, DEFAULT_DOMAIN_DATA)];
      state.isStreaming = false;
      state.parseIssues = [];
      state.redoHistory = [];
      state.streamError = null;
    },
  },
});

export const builderActions = builderSlice.actions;
export const builderReducer = builderSlice.reducer;
