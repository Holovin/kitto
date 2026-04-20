import { describe, expect, it, vi } from 'vitest';
import { BACKEND_RECONNECTED_NOTICE } from '@features/builder/components/chatNotices';
import { createBuilderSnapshot } from '@features/builder/openui/runtime/persistedState';
import { builderActions, builderReducer, normalizeBuilderState } from '@features/builder/store/builderSlice';
import { SYSTEM_CHAT_MESSAGE_KEYS } from '@features/builder/store/chatMessageKeys';

const validSource = `root = AppShell([
  Screen("main", "Main", [
    Text("Hello", "body", "start")
  ])
])`;

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

  it('tracks the current streaming request and ignores stale chunks', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-20T09:00:00.000Z'));

    const started = builderReducer(
      createInitialState(),
      builderActions.beginStreaming({
        prompt: 'Build a simple app',
        requestId: 'request-1',
      }),
    );

    const ignoredChunk = builderReducer(
      started,
      builderActions.appendStreamChunk({
        chunk: 'ignored',
        requestId: 'stale-request',
      }),
    );
    const appendedChunk = builderReducer(
      ignoredChunk,
      builderActions.appendStreamChunk({
        chunk: validSource,
        requestId: 'request-1',
      }),
    );

    expect(started.isStreaming).toBe(true);
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
        requestId: 'request-abort',
      }),
    );
    const withChunk = builderReducer(
      started,
      builderActions.appendStreamChunk({
        chunk: 'partial draft',
        requestId: 'request-abort',
      }),
    );
    const canceled = builderReducer(
      withChunk,
      builderActions.cancelStreaming({
        requestId: 'request-abort',
      }),
    );

    expect(canceled.currentRequestId).toBeNull();
    expect(canceled.isStreaming).toBe(false);
    expect(canceled.lastStreamChunkAt).toBeNull();
    expect(canceled.committedSource).toBe(initialState.committedSource);
    expect(canceled.streamedSource).toBe(initialState.committedSource);
    expect(canceled.history).toHaveLength(1);
    expect(canceled.retryPrompt).toBeNull();
    expect(canceled.chatMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: 'Start streaming',
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
        requestId: 'request-2',
      }),
    );
    const snapshot = createBuilderSnapshot(validSource, { currentScreen: 'main' }, { app: { tasks: [] as string[] } });
    const completed = builderReducer(
      started,
      builderActions.completeStreaming({
        note: 'Committed the streamed definition.',
        requestId: 'request-2',
        snapshot,
        source: validSource,
        warnings: [],
      }),
    );

    expect(completed.currentRequestId).toBeNull();
    expect(completed.isStreaming).toBe(false);
    expect(completed.lastStreamChunkAt).toBeNull();
    expect(completed.committedSource).toBe(validSource);
    expect(completed.streamedSource).toBe(validSource);
    expect(completed.history).toHaveLength(2);
    expect(completed.redoHistory).toHaveLength(0);
    expect(completed.retryPrompt).toBeNull();
    expect(completed.chatMessages.at(-1)).toEqual(
      expect.objectContaining({
        role: 'assistant',
        content: 'Committed the streamed definition.',
        tone: 'success',
        createdAt: '2026-04-19T10:00:00.000Z',
      }),
    );

    vi.useRealTimers();
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
        requestId: 'request-quality-warning',
      }),
    );
    const completed = builderReducer(
      started,
      builderActions.completeStreaming({
        requestId: 'request-quality-warning',
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

  it('appends export success messages with the file name to the end of chat history', () => {
    const started = builderReducer(
      createInitialState(),
      builderActions.beginStreaming({
        prompt: 'Build a simple app',
        requestId: 'request-export-order',
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

  it('appends successful import messages to the end of existing chat history', () => {
    const started = builderReducer(
      createInitialState(),
      builderActions.beginStreaming({
        prompt: 'Keep this context',
        requestId: 'request-import-order',
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

    expect(loaded.chatMessages).toHaveLength(2);
    expect(loaded.chatMessages.at(-2)).toEqual(
      expect.objectContaining({
        content: 'Keep this context',
        role: 'user',
      }),
    );
    expect(loaded.chatMessages.at(-1)).toEqual(
      expect.objectContaining({
        content: 'Imported a saved Kitto definition from disk (first-import.json).',
        messageKey: SYSTEM_CHAT_MESSAGE_KEYS.definitionImportStatus,
        role: 'system',
        tone: 'success',
      }),
    );
  });

  it('updates the existing import success message instead of appending a duplicate', () => {
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
    const firstImportMessageId = withFirstImport.chatMessages.at(-1)?.id;
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
        id: firstImportMessageId,
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
        requestId: 'request-3',
      }),
    );
    const failed = builderReducer(
      started,
      builderActions.failStreaming({
        message: 'The generated source was invalid.',
        requestId: 'request-3',
        retryPrompt: 'Break it',
      }),
    );

    expect(failed.currentRequestId).toBeNull();
    expect(failed.isStreaming).toBe(false);
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
          requestId: 'request-failure-1',
        }),
      ),
      builderActions.failStreaming({
        message: 'The first request failed.',
        requestId: 'request-failure-1',
        retryPrompt: 'First failure',
      }),
    );
    const firstFailureMessageId = firstFailed.chatMessages.at(-1)?.id;
    const secondStarted = builderReducer(
      firstFailed,
      builderActions.beginStreaming({
        prompt: 'Second failure',
        requestId: 'request-failure-2',
      }),
    );
    const secondFailed = builderReducer(
      secondStarted,
      builderActions.failStreaming({
        message: 'The second request failed.',
        requestId: 'request-failure-2',
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

  it('keeps history navigation as a single latest system message', () => {
    const firstSnapshot = createBuilderSnapshot(
      `root = AppShell([
  Screen("main", "First", [])
])`,
      {},
      {},
    );
    const secondSnapshot = createBuilderSnapshot(validSource, {}, {});

    const withFirstCommit = builderReducer(
      createInitialState(),
      builderActions.completeStreaming({
        requestId: null as never,
        snapshot: firstSnapshot,
        source: firstSnapshot.source,
        warnings: [],
      }),
    );
    const withSecondCommit = builderReducer(
      {
        ...withFirstCommit,
        currentRequestId: 'request-4',
      },
      builderActions.completeStreaming({
        requestId: 'request-4',
        snapshot: secondSnapshot,
        source: secondSnapshot.source,
        warnings: [],
      }),
    );
    const undone = builderReducer(withSecondCommit, builderActions.undoLatest());
    const redone = builderReducer(undone, builderActions.redoLatest());
    const undoneToEmpty = builderReducer(undone, builderActions.undoLatest());

    expect(undone.committedSource).toBe(firstSnapshot.source);
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

  it('updates the demo load message instead of appending duplicates', () => {
    const demoSnapshot = createBuilderSnapshot(validSource, {}, {});
    const withFirstDemo = builderReducer(
      createInitialState(),
      builderActions.applyDemoDefinition({
        label: 'First demo',
        snapshot: demoSnapshot,
      }),
    );
    const firstDemoMessageId = withFirstDemo.chatMessages.at(-1)?.id;
    const withSecondDemo = builderReducer(
      withFirstDemo,
      builderActions.applyDemoDefinition({
        label: 'Second demo',
        snapshot: demoSnapshot,
      }),
    );

    expect(withSecondDemo.chatMessages.filter((message) => message.messageKey === SYSTEM_CHAT_MESSAGE_KEYS.demoLoadSuccess)).toHaveLength(1);
    expect(withSecondDemo.chatMessages.at(-1)).toEqual(
      expect.objectContaining({
        content: 'Loaded the "Second demo" demo into the blank canvas.',
        id: firstDemoMessageId,
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
        requestId: 'request-5',
      }),
    );
    const secondRequest = builderReducer(
      firstRequest,
      builderActions.beginStreaming({
        prompt: 'Second prompt',
        requestId: 'request-6',
      }),
    );
    const staleCompletion = builderReducer(
      secondRequest,
      builderActions.completeStreaming({
        requestId: 'request-5',
        snapshot: createBuilderSnapshot(validSource, {}, {}),
        source: validSource,
        warnings: [],
      }),
    );

    expect(staleCompletion.currentRequestId).toBe('request-6');
    expect(staleCompletion.isStreaming).toBe(true);
    expect(staleCompletion.committedSource).toBe(createInitialState().committedSource);
    expect(staleCompletion.history).toHaveLength(1);
  });

  it('ignores a stale completion after the request was cancelled', () => {
    const initialState = createInitialState();
    const started = builderReducer(
      initialState,
      builderActions.beginStreaming({
        prompt: 'Cancel me',
        requestId: 'request-7',
      }),
    );
    const canceled = builderReducer(
      started,
      builderActions.cancelStreaming({
        requestId: 'request-7',
      }),
    );
    const staleCompletion = builderReducer(
      canceled,
      builderActions.completeStreaming({
        requestId: 'request-7',
        snapshot: createBuilderSnapshot(validSource, {}, {}),
        source: validSource,
        warnings: [],
      }),
    );

    expect(staleCompletion.currentRequestId).toBeNull();
    expect(staleCompletion.isStreaming).toBe(false);
    expect(staleCompletion.committedSource).toBe(initialState.committedSource);
    expect(staleCompletion.streamedSource).toBe(initialState.committedSource);
    expect(staleCompletion.history).toHaveLength(1);
  });
});
