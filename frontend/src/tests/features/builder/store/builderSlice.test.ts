import { describe, expect, it, vi } from 'vitest';
import { createBuilderSnapshot } from '@features/builder/openui/runtime/persistedState';
import { builderActions, builderReducer, normalizeBuilderState } from '@features/builder/store/builderSlice';

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
    expect(canceled.committedSource).toBe(initialState.committedSource);
    expect(canceled.streamedSource).toBe(initialState.committedSource);
    expect(canceled.history).toHaveLength(1);
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
      }),
    );

    expect(completed.currentRequestId).toBeNull();
    expect(completed.isStreaming).toBe(false);
    expect(completed.committedSource).toBe(validSource);
    expect(completed.streamedSource).toBe(validSource);
    expect(completed.history).toHaveLength(2);
    expect(completed.redoHistory).toHaveLength(0);
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

  it('marks invalid streamed output as a rejected definition', () => {
    const started = builderReducer(
      createInitialState(),
      builderActions.beginStreaming({
        prompt: 'Break it',
        requestId: 'request-3',
      }),
    );
    const failed = builderReducer(
      started,
      builderActions.failStreaming({
        issues: [{ code: 'missing-root', message: 'No root.' }],
        message: 'The generated source was invalid.',
        requestId: 'request-3',
        source: 'broken source',
      }),
    );

    expect(failed.currentRequestId).toBeNull();
    expect(failed.isStreaming).toBe(false);
    expect(failed.activeTab).toBe('definition');
    expect(failed.hasRejectedDefinition).toBe(true);
    expect(failed.streamedSource).toBe('broken source');
    expect(failed.parseIssues).toEqual([{ code: 'missing-root', message: 'No root.' }]);
    expect(failed.chatMessages.at(-1)).toEqual(
      expect.objectContaining({
        role: 'system',
        content: 'The generated source was invalid.',
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

  it('supports undo and redo across committed snapshots', () => {
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
      }),
    );
    const undone = builderReducer(withSecondCommit, builderActions.undoLatest());
    const redone = builderReducer(undone, builderActions.redoLatest());

    expect(undone.committedSource).toBe(firstSnapshot.source);
    expect(undone.redoHistory).toHaveLength(1);
    expect(redone.committedSource).toBe(secondSnapshot.source);
    expect(redone.redoHistory).toHaveLength(0);
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
      }),
    );

    expect(staleCompletion.currentRequestId).toBeNull();
    expect(staleCompletion.isStreaming).toBe(false);
    expect(staleCompletion.committedSource).toBe(initialState.committedSource);
    expect(staleCompletion.streamedSource).toBe(initialState.committedSource);
    expect(staleCompletion.history).toHaveLength(1);
  });
});
