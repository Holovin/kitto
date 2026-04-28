import { describe, expect, it, vi } from 'vitest';
import { BACKEND_RECONNECTED_NOTICE } from '@pages/Chat/builder/components/chatNotices';
import { createBuilderSnapshot } from '@pages/Chat/builder/openui/runtime/persistedState';
import { builderActions, builderReducer, MAX_UI_MESSAGES, normalizeBuilderState } from '@pages/Chat/builder/store/builderSlice';
import { SYSTEM_CHAT_MESSAGE_KEYS } from '@pages/Chat/builder/store/chatMessageKeys';
import { toBuilderRequestId } from '@pages/Chat/builder/types';

const validSource = `root = AppShell([
  Screen("main", "Main", [
    Text("Hello", "body", "start")
  ])
])`;
const alternateValidSource = `root = AppShell([
  Screen("secondary", "Secondary", [
    Text("Hi", "body", "start")
  ])
])`;
const screenFlowSource = `$currentScreen = "home"
root = AppShell([
  Screen("home", "Home", [
    Text("Home", "body", "start")
  ], $currentScreen == "home"),
  Screen("details", "Details", [
    Text("Details", "body", "start")
  ], $currentScreen == "details")
])`;
const promptContext = {
  currentSourceChars: 0,
  currentSourceIncluded: true,
  currentSourceProtected: true as const,
  droppedSections: [] as string[],
  mode: 'initial' as const,
  sections: [
    {
      name: 'latestUserPrompt',
      chars: 20,
      content: '<latest_user_request>\nAdd a welcome screen\n</latest_user_request>',
      included: true,
      priority: 4,
      protected: true,
    },
  ],
  totalChars: 20,
};

function createInitialState() {
  return builderReducer(undefined, {
    type: 'builder/test-init',
  });
}

describe('builderSlice', () => {
  it('normalizes rejected committed source back to the latest valid snapshot', () => {
    const snapshot = createBuilderSnapshot(validSource, { currentScreen: 'main' }, { app: { tasks: [] as string[] } });

    const state = normalizeBuilderState({
      activeTab: 'preview',
      committedSource: 'not valid openui',
      history: [snapshot],
      parseIssues: [],
      streamedSource: validSource,
    });

    expect(state.committedSource).toBe(validSource);
    expect(state.streamedSource).toBe('not valid openui');
    expect(state.activeTab).toBe('definition');
    expect(state.hasRejectedDefinition).toBe(true);
    expect(state.parseIssues.length).toBeGreaterThan(0);
  });

  it('drops stale streamed drafts and transient request state when restoring persisted builder state', () => {
    const snapshot = createBuilderSnapshot(validSource, { currentScreen: 'main' }, { app: { tasks: [] as string[] } });

    const state = normalizeBuilderState({
      chatMessages: [
        {
          id: 'pending-summary',
          role: 'assistant',
          content: 'Adds a welcome screen',
          createdAt: '2026-04-19T10:00:00.000Z',
          isStreaming: true,
          messageKey: 'generation-summary:request-restore',
        },
      ],
      committedSource: validSource,
      currentRequestId: toBuilderRequestId('request-restore'),
      history: [snapshot],
      lastStreamChunkAt: 123456789,
      parseIssues: [{ code: 'persisted-issue', message: 'Should be dropped.' }],
      retryPrompt: 'Retry me.',
      streamError: 'This should not survive restore.',
      streamedSource: alternateValidSource,
    });

    expect(state.committedSource).toBe(validSource);
    expect(state.currentRequestId).toBeNull();
    expect(state.lastStreamChunkAt).toBeNull();
    expect(state.hasRejectedDefinition).toBe(false);
    expect(state.parseIssues).toEqual([]);
    expect(state.retryPrompt).toBeNull();
    expect(state.streamError).toBeNull();
    expect(state.streamedSource).toBe(validSource);
    expect(state.chatMessages.at(-1)).toEqual(
      expect.objectContaining({
        content: 'Adds a welcome screen',
        messageKey: 'generation-summary:request-restore',
      }),
    );
    expect(state.chatMessages.at(-1)).not.toHaveProperty('isStreaming');
  });

  it('rebuilds rejected-definition state from the persisted invalid draft instead of trusting raw parse issues', () => {
    const snapshot = createBuilderSnapshot(validSource, { currentScreen: 'main' }, { app: { tasks: [] as string[] } });

    const state = normalizeBuilderState({
      activeTab: 'preview',
      committedSource: validSource,
      history: [snapshot],
      parseIssues: [{ code: 'persisted-issue', message: 'This should be replaced.' }],
      streamedSource: 'not valid openui',
    });

    expect(state.committedSource).toBe(validSource);
    expect(state.streamedSource).toBe('not valid openui');
    expect(state.activeTab).toBe('definition');
    expect(state.hasRejectedDefinition).toBe(true);
    expect(state.parseIssues.length).toBeGreaterThan(0);
    expect(state.parseIssues.some((issue) => issue.code === 'persisted-issue')).toBe(false);
  });

  it('tracks the current streaming request and ignores stale chunks', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-20T09:00:00.000Z'));

    const started = builderReducer(
      createInitialState(),
      builderActions.beginStreaming({
        prompt: 'Build a simple app',
        requestId: toBuilderRequestId('request-1'),
      }),
    );

    const ignoredChunk = builderReducer(
      started,
      builderActions.appendStreamChunk({
        chunk: 'ignored',
        requestId: toBuilderRequestId('stale-request'),
      }),
    );
    const appendedChunk = builderReducer(
      ignoredChunk,
      builderActions.appendStreamChunk({
        chunk: validSource,
        requestId: toBuilderRequestId('request-1'),
      }),
    );

    expect(started.currentRequestId).toBe('request-1');
    expect(started.lastStreamChunkAt).toBeNull();
    expect(started.chatMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: 'Build a simple app',
        }),
      ]),
    );
    expect(ignoredChunk.streamedSource).toBe('');
    expect(appendedChunk.streamedSource).toBe(validSource);
    expect(appendedChunk.lastStreamChunkAt).toBe(new Date('2026-04-20T09:00:00.000Z').getTime());

    vi.useRealTimers();
  });

  it('cancels an aborted stream without committing the partial draft', () => {
    const initialState = createInitialState();
    const started = builderReducer(
      initialState,
      builderActions.beginStreaming({
        prompt: 'Start streaming',
        requestId: toBuilderRequestId('request-abort'),
      }),
    );
    const withChunk = builderReducer(
      started,
      builderActions.appendStreamChunk({
        chunk: 'partial draft',
        requestId: toBuilderRequestId('request-abort'),
      }),
    );
    const canceled = builderReducer(
      withChunk,
      builderActions.cancelStreaming({
        requestId: toBuilderRequestId('request-abort'),
      }),
    );

    expect(canceled.currentRequestId).toBeNull();
    expect(canceled.currentRequestId).toBeNull();
    expect(canceled.lastStreamChunkAt).toBeNull();
    expect(canceled.committedSource).toBe(initialState.committedSource);
    expect(canceled.streamedSource).toBe(initialState.committedSource);
    expect(canceled.history).toHaveLength(1);
    expect(canceled.retryPrompt).toBeNull();
    expect(canceled.chatMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: 'Start streaming',
          excludeFromLlmContext: true,
          role: 'user',
        }),
      ]),
    );
    expect(canceled.chatMessages.some((message) => message.tone === 'error')).toBe(false);
  });

  it('commits the completed stream into history and chat', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-19T10:00:00.000Z'));

    const started = builderReducer(
      createInitialState(),
      builderActions.beginStreaming({
        prompt: 'Add a welcome screen',
        requestId: toBuilderRequestId('request-2'),
      }),
    );
    const snapshot = createBuilderSnapshot(validSource, { currentScreen: 'main' }, { app: { tasks: [] as string[] } });
    const appMemory = {
      version: 1 as const,
      appSummary: 'Welcome screen app.',
      userPreferences: [],
      avoid: [],
    };
    const completed = builderReducer(
      started,
      builderActions.completeStreaming({
        appMemory,
        changeSummary: 'Added a welcome screen.',
        note: 'Committed the streamed definition.',
        promptContext,
        requestId: toBuilderRequestId('request-2'),
        snapshot,
        source: validSource,
        summary: 'Adds a welcome screen.',
        warnings: [],
      }),
    );

    expect(completed.currentRequestId).toBeNull();
    expect(completed.currentRequestId).toBeNull();
    expect(completed.lastStreamChunkAt).toBeNull();
    expect(completed.committedSource).toBe(validSource);
    expect(completed.streamedSource).toBe(validSource);
    expect(completed.lastPromptContext).toEqual(promptContext);
    expect(completed.history).toHaveLength(2);
    expect(completed.appMemory).toEqual(appMemory);
    expect(completed.history.at(-1)).toEqual(
      expect.objectContaining({
        appMemory,
        changeSummary: 'Added a welcome screen.',
        summary: 'Adds a welcome screen.',
      }),
    );
    expect(completed.redoHistory).toHaveLength(0);
    expect(completed.retryPrompt).toBeNull();
    expect(completed.chatMessages.at(-1)).toEqual(
      expect.objectContaining({
        role: 'assistant',
        content: 'Committed the streamed definition.',
        excludeFromLlmContext: true,
        tone: 'success',
        createdAt: '2026-04-19T10:00:00.000Z',
      }),
    );

    vi.useRealTimers();
  });

  it('repairs stale navigation state when a completed stream removes the previous screen id', () => {
    const started = builderReducer(
      createInitialState(),
      builderActions.beginStreaming({
        prompt: 'Rename the active screen',
        requestId: toBuilderRequestId('request-navigation'),
      }),
    );
    const snapshot = createBuilderSnapshot(screenFlowSource, {}, { navigation: { currentScreenId: 'deleted' } });
    const completed = builderReducer(
      started,
      builderActions.completeStreaming({
        requestId: toBuilderRequestId('request-navigation'),
        snapshot,
        source: screenFlowSource,
        warnings: [],
      }),
    );

    expect(completed.history.at(-1)?.domainData).toEqual({
      navigation: {
        currentScreenId: 'home',
      },
    });
  });

  it('repairs stale navigation state when loading imported history', () => {
    const snapshot = createBuilderSnapshot(screenFlowSource, {}, { navigation: { currentScreenId: 'deleted' } });
    const loaded = builderReducer(
      createInitialState(),
      builderActions.loadDefinition({
        history: [snapshot],
        runtimeState: {},
        source: screenFlowSource,
      }),
    );

    expect(loaded.history.at(-1)?.domainData).toEqual({
      navigation: {
        currentScreenId: 'home',
      },
    });
  });

  it('can skip the default assistant completion note when a streamed summary message already exists', () => {
    const started = builderReducer(
      createInitialState(),
      builderActions.beginStreaming({
        prompt: 'Add a welcome screen',
        requestId: toBuilderRequestId('request-summary'),
      }),
    );
    const withPendingSummary = builderReducer(
      started,
      builderActions.appendChatMessage({
        content: 'Adds a welcome screen',
        isStreaming: true,
        messageKey: 'generation-summary:request-summary',
        role: 'assistant',
      }),
    );
    const snapshot = createBuilderSnapshot(validSource, {}, {});
    const completed = builderReducer(
      withPendingSummary,
      builderActions.completeStreaming({
        requestId: toBuilderRequestId('request-summary'),
        skipDefaultAssistantMessage: true,
        snapshot,
        source: validSource,
        warnings: [],
      }),
    );

    expect(
      completed.chatMessages.filter((message) => message.content === 'Applied the latest chat instruction to the app definition.'),
    ).toHaveLength(0);
    expect(completed.chatMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: 'Adds a welcome screen',
          isStreaming: true,
          messageKey: 'generation-summary:request-summary',
          role: 'assistant',
        }),
      ]),
    );
  });

  it('stores generation quality warnings without rejecting the committed source', () => {
    const warning = {
      code: 'quality-too-many-screens',
      message: 'Simple request generated multiple screens.',
      source: 'quality' as const,
    };
    const started = builderReducer(
      createInitialState(),
      builderActions.beginStreaming({
        prompt: 'Create a todo list',
        requestId: toBuilderRequestId('request-quality-warning'),
      }),
    );
    const completed = builderReducer(
      started,
      builderActions.completeStreaming({
        requestId: toBuilderRequestId('request-quality-warning'),
        snapshot: createBuilderSnapshot(validSource, {}, {}),
        source: validSource,
        warnings: [warning],
      }),
    );

    expect(completed.committedSource).toBe(validSource);
    expect(completed.hasRejectedDefinition).toBe(false);
    expect(completed.parseIssues).toEqual([]);
    expect(completed.definitionWarnings).toEqual([warning]);
  });

  it('preserves excludeFromLlmContext when normalizing persisted chat messages', () => {
    const state = normalizeBuilderState({
      chatMessages: [
        {
          id: 'assistant-summary',
          role: 'assistant',
          content: 'Applied the latest chat instruction to the app definition.',
          excludeFromLlmContext: true,
          tone: 'success',
          createdAt: '2026-04-19T10:00:00.000Z',
        },
      ],
    });

    expect(state.chatMessages).toEqual([
      expect.objectContaining({
        id: 'assistant-summary',
        role: 'assistant',
        content: 'Applied the latest chat instruction to the app definition.',
        excludeFromLlmContext: true,
      }),
    ]);
  });

  it('keeps a UI-only chat retention window and evicts the oldest rendered messages beyond it', () => {
    let state = createInitialState();

    for (let index = 0; index < MAX_UI_MESSAGES + 5; index += 1) {
      state = builderReducer(
        state,
        builderActions.appendChatMessage({
          content: `Message ${index}`,
          role: 'system',
        }),
      );
    }

    expect(state.chatMessages).toHaveLength(MAX_UI_MESSAGES);
    expect(state.chatMessages.at(0)).toEqual(
      expect.objectContaining({
        content: 'Message 5',
      }),
    );
    expect(state.chatMessages.at(-1)).toEqual(
      expect.objectContaining({
        content: `Message ${MAX_UI_MESSAGES + 4}`,
      }),
    );
  });

  it('appends export success messages with the file name to the end of chat history', () => {
    const started = builderReducer(
      createInitialState(),
      builderActions.beginStreaming({
        prompt: 'Build a simple app',
        requestId: toBuilderRequestId('request-export-order'),
      }),
    );
    const withExportMessage = builderReducer(
      started,
      builderActions.appendChatMessage({
        content: 'Definition exported (kitto-definition-2026-04-20T15-00-00.000Z.json).',
        messageKey: SYSTEM_CHAT_MESSAGE_KEYS.definitionExportSuccess,
        role: 'system',
        tone: 'success',
      }),
    );

    expect(withExportMessage.chatMessages.at(-1)).toEqual(
      expect.objectContaining({
        content: 'Definition exported (kitto-definition-2026-04-20T15-00-00.000Z.json).',
        messageKey: SYSTEM_CHAT_MESSAGE_KEYS.definitionExportSuccess,
        role: 'system',
        tone: 'success',
      }),
    );
    expect(withExportMessage.chatMessages.at(-2)).toEqual(
      expect.objectContaining({
        content: 'Build a simple app',
        role: 'user',
      }),
    );
  });

  it('updates the existing export success message instead of appending a duplicate', () => {
    const withFirstExport = builderReducer(
      createInitialState(),
      builderActions.appendChatMessage({
        content: 'Definition exported (kitto-definition-2026-04-20T15-00-00.000Z.json).',
        messageKey: SYSTEM_CHAT_MESSAGE_KEYS.definitionExportSuccess,
        role: 'system',
        tone: 'success',
      }),
    );
    const firstExportMessageId = withFirstExport.chatMessages.at(-1)?.id;
    const withSecondExport = builderReducer(
      withFirstExport,
      builderActions.appendChatMessage({
        content: 'Definition exported (kitto-definition-2026-04-20T15-30-00.000Z.json).',
        messageKey: SYSTEM_CHAT_MESSAGE_KEYS.definitionExportSuccess,
        role: 'system',
        tone: 'success',
      }),
    );

    expect(withSecondExport.chatMessages).toHaveLength(1);
    expect(withSecondExport.chatMessages.at(-1)).toEqual(
      expect.objectContaining({
        content: 'Definition exported (kitto-definition-2026-04-20T15-30-00.000Z.json).',
        id: firstExportMessageId,
        messageKey: SYSTEM_CHAT_MESSAGE_KEYS.definitionExportSuccess,
        role: 'system',
        tone: 'success',
      }),
    );
  });

  it('updates keyed streaming messages in place without moving later messages', () => {
    const withPendingSummary = builderReducer(
      createInitialState(),
      builderActions.appendChatMessage({
        content: 'Building: first chunk',
        isStreaming: true,
        messageKey: 'generation-summary:request-order',
        role: 'assistant',
      }),
    );
    const summaryMessageId = withPendingSummary.chatMessages.at(-1)?.id;
    const withLaterMessage = builderReducer(
      withPendingSummary,
      builderActions.appendChatMessage({
        content: 'A later tool status message.',
        role: 'system',
        tone: 'info',
      }),
    );
    const withUpdatedSummary = builderReducer(
      withLaterMessage,
      builderActions.appendChatMessage({
        content: 'Building: updated chunk',
        isStreaming: true,
        messageKey: 'generation-summary:request-order',
        role: 'assistant',
      }),
    );

    expect(withUpdatedSummary.chatMessages.map((message) => message.content)).toEqual([
      'Building: updated chunk',
      'A later tool status message.',
    ]);
    expect(withUpdatedSummary.chatMessages[0]).toEqual(
      expect.objectContaining({
        id: summaryMessageId,
        isStreaming: true,
        messageKey: 'generation-summary:request-order',
        role: 'assistant',
      }),
    );
    expect(withUpdatedSummary.chatMessages.at(-1)).toEqual(
      expect.objectContaining({
        content: 'A later tool status message.',
        role: 'system',
        tone: 'info',
      }),
    );
  });

  it('removes a chat message by message key', () => {
    const withSummary = builderReducer(
      createInitialState(),
      builderActions.appendChatMessage({
        content: 'Adds a welcome screen',
        isStreaming: true,
        messageKey: 'generation-summary:request-remove',
        role: 'assistant',
      }),
    );
    const removed = builderReducer(
      withSummary,
      builderActions.removeChatMessageByKey({
        messageKey: 'generation-summary:request-remove',
      }),
    );

    expect(removed.chatMessages).toHaveLength(0);
  });

  it('clears existing chat history when loading an imported definition', () => {
    const started = builderReducer(
      createInitialState(),
      builderActions.beginStreaming({
        prompt: 'Keep this context',
        requestId: toBuilderRequestId('request-import-order'),
      }),
    );
    const importedSnapshot = createBuilderSnapshot(validSource, { currentScreen: 'main' }, { app: { tasks: [] as string[] } });
    const loaded = builderReducer(
      started,
      builderActions.loadDefinition({
        history: [importedSnapshot],
        messageKey: SYSTEM_CHAT_MESSAGE_KEYS.definitionImportStatus,
        note: 'Imported a saved Kitto definition from disk (first-import.json).',
        runtimeState: importedSnapshot.runtimeState,
        source: importedSnapshot.source,
      }),
    );

    expect(loaded.chatMessages).toHaveLength(1);
    expect(loaded.chatMessages.some((message) => message.content === 'Keep this context')).toBe(false);
    expect(loaded.chatMessages.at(-1)).toEqual(
      expect.objectContaining({
        content: 'Imported a saved Kitto definition from disk (first-import.json).',
        messageKey: SYSTEM_CHAT_MESSAGE_KEYS.definitionImportStatus,
        role: 'system',
        tone: 'success',
      }),
    );
  });

  it('keeps only the latest import success message after repeated imports', () => {
    const importedSnapshot = createBuilderSnapshot(validSource, { currentScreen: 'main' }, { app: { tasks: [] as string[] } });
    const withFirstImport = builderReducer(
      createInitialState(),
      builderActions.loadDefinition({
        history: [importedSnapshot],
        messageKey: SYSTEM_CHAT_MESSAGE_KEYS.definitionImportStatus,
        note: 'Imported a saved Kitto definition from disk (first-import.json).',
        runtimeState: importedSnapshot.runtimeState,
        source: importedSnapshot.source,
      }),
    );
    const withSecondImport = builderReducer(
      withFirstImport,
      builderActions.loadDefinition({
        history: [importedSnapshot],
        messageKey: SYSTEM_CHAT_MESSAGE_KEYS.definitionImportStatus,
        note: 'Imported a saved Kitto definition from disk (second-import.json).',
        runtimeState: importedSnapshot.runtimeState,
        source: importedSnapshot.source,
      }),
    );

    expect(withSecondImport.chatMessages).toHaveLength(1);
    expect(withSecondImport.chatMessages.at(-1)).toEqual(
      expect.objectContaining({
        content: 'Imported a saved Kitto definition from disk (second-import.json).',
        messageKey: SYSTEM_CHAT_MESSAGE_KEYS.definitionImportStatus,
        role: 'system',
        tone: 'success',
      }),
    );
  });

  it('updates the existing standalone HTML success message instead of appending a duplicate', () => {
    const withFirstDownload = builderReducer(
      createInitialState(),
      builderActions.appendChatMessage({
        content: 'Standalone HTML downloaded (kitto-app-2026-04-20T15-00-00.000Z.html).',
        messageKey: SYSTEM_CHAT_MESSAGE_KEYS.standaloneHtmlDownloadStatus,
        role: 'system',
        tone: 'success',
      }),
    );
    const firstDownloadMessageId = withFirstDownload.chatMessages.at(-1)?.id;
    const withSecondDownload = builderReducer(
      withFirstDownload,
      builderActions.appendChatMessage({
        content: 'Standalone HTML downloaded (kitto-app-2026-04-20T15-30-00.000Z.html).',
        messageKey: SYSTEM_CHAT_MESSAGE_KEYS.standaloneHtmlDownloadStatus,
        role: 'system',
        tone: 'success',
      }),
    );

    expect(withSecondDownload.chatMessages).toHaveLength(1);
    expect(withSecondDownload.chatMessages.at(-1)).toEqual(
      expect.objectContaining({
        content: 'Standalone HTML downloaded (kitto-app-2026-04-20T15-30-00.000Z.html).',
        id: firstDownloadMessageId,
        messageKey: SYSTEM_CHAT_MESSAGE_KEYS.standaloneHtmlDownloadStatus,
        role: 'system',
        tone: 'success',
      }),
    );
  });

  it('updates the existing backend connection status message instead of appending a duplicate', () => {
    const withDisconnectNotice = builderReducer(
      createInitialState(),
      builderActions.appendChatMessage({
        content:
          'Backend is disconnected. You can still inspect the last persisted definition, but new prompts will fail until /api/health recovers.',
        messageKey: SYSTEM_CHAT_MESSAGE_KEYS.backendConnectionStatus,
        role: 'system',
        tone: 'error',
      }),
    );
    const disconnectNoticeId = withDisconnectNotice.chatMessages.at(-1)?.id;
    const withRecoveryNotice = builderReducer(
      withDisconnectNotice,
      builderActions.appendChatMessage({
        content: BACKEND_RECONNECTED_NOTICE,
        messageKey: SYSTEM_CHAT_MESSAGE_KEYS.backendConnectionStatus,
        role: 'system',
        tone: 'success',
      }),
    );

    expect(withRecoveryNotice.chatMessages).toHaveLength(1);
    expect(withRecoveryNotice.chatMessages.at(-1)).toEqual(
      expect.objectContaining({
        content: BACKEND_RECONNECTED_NOTICE,
        id: disconnectNoticeId,
        messageKey: SYSTEM_CHAT_MESSAGE_KEYS.backendConnectionStatus,
        role: 'system',
        tone: 'success',
      }),
    );
  });

  it('rolls back invalid streamed output to the last committed definition', () => {
    const initialState = createInitialState();
    const started = builderReducer(
      initialState,
      builderActions.beginStreaming({
        prompt: 'Break it',
        requestId: toBuilderRequestId('request-3'),
      }),
    );
    const failed = builderReducer(
      started,
      builderActions.failStreaming({
        message: 'The generated source was invalid.',
        requestId: toBuilderRequestId('request-3'),
        retryPrompt: 'Break it',
      }),
    );

    expect(failed.currentRequestId).toBeNull();
    expect(failed.currentRequestId).toBeNull();
    expect(failed.lastStreamChunkAt).toBeNull();
    expect(failed.activeTab).toBe(initialState.activeTab);
    expect(failed.hasRejectedDefinition).toBe(false);
    expect(failed.retryPrompt).toBe('Break it');
    expect(failed.streamedSource).toBe(initialState.committedSource);
    expect(failed.parseIssues).toEqual([]);
    expect(failed.history).toHaveLength(initialState.history.length);
    expect(failed.chatMessages.at(-1)).toEqual(
      expect.objectContaining({
        role: 'system',
        content: 'The generated source was invalid.',
        tone: 'error',
      }),
    );
  });

  it('appends request failure messages without deduplicating them', () => {
    const firstFailed = builderReducer(
      builderReducer(
        createInitialState(),
        builderActions.beginStreaming({
          prompt: 'First failure',
          requestId: toBuilderRequestId('request-failure-1'),
        }),
      ),
      builderActions.failStreaming({
        message: 'The first request failed.',
        requestId: toBuilderRequestId('request-failure-1'),
        retryPrompt: 'First failure',
      }),
    );
    const firstFailureMessageId = firstFailed.chatMessages.at(-1)?.id;
    const secondStarted = builderReducer(
      firstFailed,
      builderActions.beginStreaming({
        prompt: 'Second failure',
        requestId: toBuilderRequestId('request-failure-2'),
      }),
    );
    const secondFailed = builderReducer(
      secondStarted,
      builderActions.failStreaming({
        message: 'The second request failed.',
        requestId: toBuilderRequestId('request-failure-2'),
        retryPrompt: 'Second failure',
      }),
    );

    const failureMessages = secondFailed.chatMessages.filter((message) => message.tone === 'error');

    expect(failureMessages).toHaveLength(2);
    expect(failureMessages.map((message) => message.content)).toEqual(['The first request failed.', 'The second request failed.']);
    expect(failureMessages[0]?.id).toBe(firstFailureMessageId);
    expect(failureMessages[1]).toEqual(
      expect.objectContaining({
        content: 'The second request failed.',
        role: 'system',
        tone: 'error',
      }),
    );
  });

  it('keeps the committed source when rejectDefinition moves invalid source to Definition', () => {
    const initialState = createInitialState();
    const rejected = builderReducer(
      initialState,
      builderActions.rejectDefinition({
        issues: [{ code: 'missing-root', message: 'No root.' }],
        message: 'Imported definition is invalid.',
        source: 'broken import',
      }),
    );

    expect(rejected.committedSource).toBe(initialState.committedSource);
    expect(rejected.streamedSource).toBe('broken import');
    expect(rejected.activeTab).toBe('definition');
    expect(rejected.hasRejectedDefinition).toBe(true);
  });

  it('keeps history navigation as a single latest system message and restores matching app memory', () => {
    const firstMemory = {
      version: 1 as const,
      appSummary: 'First version memory.',
      userPreferences: ['Keep first.'],
      avoid: [],
    };
    const secondMemory = {
      version: 1 as const,
      appSummary: 'Second version memory.',
      userPreferences: ['Keep second.'],
      avoid: ['Avoid stale controls.'],
    };
    const firstSnapshot = createBuilderSnapshot(
      `root = AppShell([
  Screen("main", "First", [])
])`,
      {},
      {},
      {
        appMemory: firstMemory,
        changeSummary: 'Created first version.',
        summary: 'Created the first version.',
      },
    );
    const secondSnapshot = createBuilderSnapshot(validSource, {}, {}, {
      appMemory: secondMemory,
      changeSummary: 'Added second version.',
      summary: 'Added the second version.',
    });

    const withFirstCommit = builderReducer(
      createInitialState(),
      builderActions.completeStreaming({
        appMemory: firstMemory,
        changeSummary: 'Created first version.',
        requestId: null as never,
        snapshot: firstSnapshot,
        source: firstSnapshot.source,
        summary: 'Created the first version.',
        warnings: [],
      }),
    );
    const withSecondCommit = builderReducer(
      {
        ...withFirstCommit,
        currentRequestId: toBuilderRequestId('request-4'),
      },
      builderActions.completeStreaming({
        appMemory: secondMemory,
        changeSummary: 'Added second version.',
        requestId: toBuilderRequestId('request-4'),
        snapshot: secondSnapshot,
        source: secondSnapshot.source,
        summary: 'Added the second version.',
        warnings: [],
      }),
    );
    const undone = builderReducer(withSecondCommit, builderActions.undoLatest());
    const redone = builderReducer(undone, builderActions.redoLatest());
    const undoneToEmpty = builderReducer(undone, builderActions.undoLatest());

    expect(undone.committedSource).toBe(firstSnapshot.source);
    expect(undone.appMemory).toEqual(firstMemory);
    expect(undone.previousChangeSummaries).toEqual([]);
    expect(undone.redoHistory).toHaveLength(1);
    expect(undone.chatMessages.at(-1)).toEqual(
      expect.objectContaining({
        content: 'Reverted to version 1 / 2.',
        messageKey: SYSTEM_CHAT_MESSAGE_KEYS.historyNavigation,
        role: 'system',
        tone: 'info',
      }),
    );
    expect(
      undone.chatMessages
        .filter((message) => message.content.startsWith('Reverted to version ') || message.content.startsWith('Restored version '))
        .map((message) => message.content),
    ).toEqual(['Reverted to version 1 / 2.']);
    expect(redone.committedSource).toBe(secondSnapshot.source);
    expect(redone.appMemory).toEqual(secondMemory);
    expect(redone.previousChangeSummaries).toEqual(['Created first version.']);
    expect(redone.redoHistory).toHaveLength(0);
    expect(redone.chatMessages.at(-1)).toEqual(
      expect.objectContaining({
        content: 'Restored version 2 / 2.',
        messageKey: SYSTEM_CHAT_MESSAGE_KEYS.historyNavigation,
        role: 'system',
        tone: 'info',
      }),
    );
    expect(
      redone.chatMessages
        .filter((message) => message.content.startsWith('Reverted to version ') || message.content.startsWith('Restored version '))
        .map((message) => message.content),
    ).toEqual(['Restored version 2 / 2.']);
    expect(undoneToEmpty.committedSource).toBe('');
    expect(undoneToEmpty.appMemory).toBeUndefined();
    expect(undoneToEmpty.previousChangeSummaries).toEqual([]);
    expect(undoneToEmpty.chatMessages.at(-1)).toEqual(
      expect.objectContaining({
        content: 'Reverted to version 0 / 2.',
        messageKey: SYSTEM_CHAT_MESSAGE_KEYS.historyNavigation,
        role: 'system',
        tone: 'info',
      }),
    );
    expect(
      undoneToEmpty.chatMessages.filter(
        (message) => message.content.startsWith('Reverted to version ') || message.content.startsWith('Restored version '),
      ).map((message) => message.content),
    ).toEqual(['Reverted to version 0 / 2.']);
  });

  it('repairs stale navigation state in the restored snapshot during undo', () => {
    const firstSnapshot = createBuilderSnapshot(screenFlowSource, {}, { navigation: { currentScreenId: 'deleted' } });
    const secondSnapshot = createBuilderSnapshot(validSource, {}, {});
    const undone = builderReducer(
      {
        ...createInitialState(),
        committedSource: secondSnapshot.source,
        history: [firstSnapshot, secondSnapshot],
        streamedSource: secondSnapshot.source,
      },
      builderActions.undoLatest(),
    );

    expect(undone.committedSource).toBe(screenFlowSource);
    expect(undone.history.at(-1)?.domainData).toEqual({
      navigation: {
        currentScreenId: 'home',
      },
    });
  });

  it('updates the reset app state message instead of appending duplicates', () => {
    const withFirstReset = builderReducer(createInitialState(), builderActions.resetCurrentAppState());
    const firstResetMessageId = withFirstReset.chatMessages.at(-1)?.id;
    const withSecondReset = builderReducer(withFirstReset, builderActions.resetCurrentAppState());

    expect(withSecondReset.chatMessages.filter((message) => message.messageKey === SYSTEM_CHAT_MESSAGE_KEYS.appStateReset)).toHaveLength(1);
    expect(withSecondReset.chatMessages.at(-1)).toEqual(
      expect.objectContaining({
        content: 'Reset the generated app state to its initial version.',
        id: firstResetMessageId,
        messageKey: SYSTEM_CHAT_MESSAGE_KEYS.appStateReset,
        role: 'system',
        tone: 'info',
      }),
    );
  });

  it('clears existing chat history and app memory when resetting the builder to empty', () => {
    const requestId = toBuilderRequestId('request-reset-context');
    const started = builderReducer(
      createInitialState(),
      builderActions.beginStreaming({
        prompt: 'Build a stale app',
        requestId,
      }),
    );
    const committed = builderReducer(
      started,
      builderActions.completeStreaming({
        appMemory: {
          version: 1,
          appSummary: 'A stale app memory.',
          userPreferences: ['Keep it compact.'],
          avoid: ['Do not add charts.'],
        },
        changeSummary: 'Stale change.',
        requestId,
        snapshot: createBuilderSnapshot(validSource, {}, {}),
        source: validSource,
        warnings: [],
      }),
    );
    const reset = builderReducer(committed, builderActions.resetToEmpty());

    expect(reset.chatMessages).toEqual([]);
    expect(reset.committedSource).toBe('');
    expect(reset.appMemory).toBeUndefined();
    expect(reset.retryPrompt).toBeNull();
  });

  it('clears existing chat history when loading a demo definition', () => {
    const demoSnapshot = createBuilderSnapshot(validSource, {}, {});
    const started = builderReducer(
      createInitialState(),
      builderActions.beginStreaming({
        prompt: 'Build a stale app',
        requestId: toBuilderRequestId('request-demo-context'),
      }),
    );
    const withFirstDemo = builderReducer(
      started,
      builderActions.applyDemoDefinition({
        label: 'First demo',
        snapshot: demoSnapshot,
      }),
    );
    const withSecondDemo = builderReducer(
      withFirstDemo,
      builderActions.applyDemoDefinition({
        label: 'Second demo',
        snapshot: demoSnapshot,
      }),
    );

    expect(withSecondDemo.chatMessages.filter((message) => message.messageKey === SYSTEM_CHAT_MESSAGE_KEYS.demoLoadSuccess)).toHaveLength(1);
    expect(withFirstDemo.chatMessages.some((message) => message.content === 'Build a stale app')).toBe(false);
    expect(withSecondDemo.chatMessages.at(-1)).toEqual(
      expect.objectContaining({
        content: 'Loaded the "Second demo" demo into the blank canvas.',
        messageKey: SYSTEM_CHAT_MESSAGE_KEYS.demoLoadSuccess,
        role: 'system',
        tone: 'success',
      }),
    );
  });

  it('ignores stale completions after a newer request replaces the current request id', () => {
    const firstRequest = builderReducer(
      createInitialState(),
      builderActions.beginStreaming({
        prompt: 'First prompt',
        requestId: toBuilderRequestId('request-5'),
      }),
    );
    const secondRequest = builderReducer(
      firstRequest,
      builderActions.beginStreaming({
        prompt: 'Second prompt',
        requestId: toBuilderRequestId('request-6'),
      }),
    );
    const staleCompletion = builderReducer(
      secondRequest,
      builderActions.completeStreaming({
        requestId: toBuilderRequestId('request-5'),
        snapshot: createBuilderSnapshot(validSource, {}, {}),
        source: validSource,
        warnings: [],
      }),
    );

    expect(staleCompletion.currentRequestId).toBe('request-6');
    expect(staleCompletion.currentRequestId).toBe('request-6');
    expect(staleCompletion.committedSource).toBe(createInitialState().committedSource);
    expect(staleCompletion.history).toHaveLength(1);
  });

  it('ignores a stale completion after the request was cancelled', () => {
    const initialState = createInitialState();
    const started = builderReducer(
      initialState,
      builderActions.beginStreaming({
        prompt: 'Cancel me',
        requestId: toBuilderRequestId('request-7'),
      }),
    );
    const canceled = builderReducer(
      started,
      builderActions.cancelStreaming({
        requestId: toBuilderRequestId('request-7'),
      }),
    );
    const staleCompletion = builderReducer(
      canceled,
      builderActions.completeStreaming({
        requestId: toBuilderRequestId('request-7'),
        snapshot: createBuilderSnapshot(validSource, {}, {}),
        source: validSource,
        warnings: [],
      }),
    );

    expect(staleCompletion.currentRequestId).toBeNull();
    expect(staleCompletion.currentRequestId).toBeNull();
    expect(staleCompletion.committedSource).toBe(initialState.committedSource);
    expect(staleCompletion.streamedSource).toBe(initialState.committedSource);
    expect(staleCompletion.history).toHaveLength(1);
    expect(staleCompletion.chatMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: 'Cancel me',
          excludeFromLlmContext: true,
          role: 'user',
        }),
      ]),
    );
  });
});
