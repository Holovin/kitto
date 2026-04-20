import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import type { ChangeEvent, FormEvent } from 'react';

const testHarness = vi.hoisted(() => {
  type Cleanup = void | (() => void);

  const activeRuntimeRef = { current: null as HookRuntime | null };

  class HookRuntime {
    cursor = 0;
    effectStates: Array<{ cleanup?: Cleanup; deps?: unknown[] }> = [];
    hookValues: unknown[] = [];
    pendingEffects: Array<() => void> = [];

    render<Result>(callback: () => Result) {
      this.cursor = 0;
      this.pendingEffects = [];
      activeRuntimeRef.current = this;

      try {
        return callback();
      } finally {
        activeRuntimeRef.current = null;

        for (const runEffect of this.pendingEffects) {
          runEffect();
        }

        this.pendingEffects = [];
      }
    }

    unmount() {
      for (const effectState of this.effectStates) {
        if (typeof effectState?.cleanup === 'function') {
          effectState.cleanup();
        }
      }

      this.effectStates = [];
      this.hookValues = [];
      this.pendingEffects = [];
      this.cursor = 0;
    }

    useCallback<Callback extends (...args: never[]) => unknown>(callback: Callback) {
      this.cursor += 1;
      return callback;
    }

    useEffect(effect: () => Cleanup, deps?: unknown[]) {
      const index = this.cursor;
      this.cursor += 1;

      const previous = this.effectStates[index];
      const hasChanged =
        !previous ||
        !deps ||
        !previous.deps ||
        deps.length !== previous.deps.length ||
        deps.some((value, depIndex) => !Object.is(value, previous.deps?.[depIndex]));

      if (!hasChanged) {
        return;
      }

      this.pendingEffects.push(() => {
        if (typeof previous?.cleanup === 'function') {
          previous.cleanup();
        }

        this.effectStates[index] = {
          cleanup: effect(),
          deps: deps ? [...deps] : undefined,
        };
      });
    }

    useRef<Value>(initialValue: Value) {
      const index = this.cursor;
      this.cursor += 1;

      if (!(index in this.hookValues)) {
        this.hookValues[index] = { current: initialValue };
      }

      return this.hookValues[index] as { current: Value };
    }
  }

  return {
    HookRuntime,
    activeRuntimeRef,
    configRef: { current: undefined as unknown },
    generateMock: vi.fn(),
    storeRef: {
      current: null as {
        dispatch: (action: unknown) => unknown;
        getState: () => unknown;
      } | null,
    },
    streamMock: vi.fn(),
  };
});

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');

  function getRuntime() {
    const runtime = testHarness.activeRuntimeRef.current;

    if (!runtime) {
      throw new Error('Hook called outside of the test hook runtime.');
    }

    return runtime;
  }

  return {
    ...actual,
    useCallback: <Callback extends (...args: never[]) => unknown>(callback: Callback, _deps?: unknown[]) =>
      getRuntime().useCallback(callback),
    useEffect: (effect: () => void | (() => void), deps?: unknown[]) => getRuntime().useEffect(effect, deps),
    useRef: <Value>(initialValue: Value) => getRuntime().useRef(initialValue),
  };
});

vi.mock('@api/apiSlice', () => ({
  useConfigQuery: () => ({
    data: testHarness.configRef.current,
  }),
}));

vi.mock('@store/store', () => ({
  store: {
    dispatch: (action: unknown) => {
      const store = testHarness.storeRef.current;

      if (!store) {
        throw new Error('Test store is not initialized.');
      }

      return store.dispatch(action);
    },
    getState: () => {
      const store = testHarness.storeRef.current;

      if (!store) {
        throw new Error('Test store is not initialized.');
      }

      return store.getState();
    },
  },
}));

vi.mock('@store/hooks', () => ({
  useAppDispatch: () => {
    const store = testHarness.storeRef.current;

    if (!store) {
      throw new Error('Test store is not initialized.');
    }

    return store.dispatch;
  },
  useAppSelector: <Result>(selector: (state: unknown) => Result) => {
    const store = testHarness.storeRef.current;

    if (!store) {
      throw new Error('Test store is not initialized.');
    }

    return selector(store.getState());
  },
}));

vi.mock('@store/errorRecovery', () => ({
  resetAppState: () => {
    const store = testHarness.storeRef.current;

    if (!store) {
      throw new Error('Test store is not initialized.');
    }

    store.dispatch({ type: 'domain/resetDomainState' });
    store.dispatch({ type: 'builderSession/resetRuntimeSessionState' });
    store.dispatch({ type: 'builder/resetToEmpty' });
  },
}));

vi.mock('@features/builder/api/generateDefinition', () => ({
  generateBuilderDefinition: (...args: Parameters<typeof testHarness.generateMock>) => testHarness.generateMock(...args),
}));

vi.mock('@features/builder/api/streamGenerate', () => {
  class BuilderStreamTimeoutError extends Error {
    kind: string;

    constructor(kind: string) {
      super(`Timed out while waiting for the builder stream (${kind}).`);
      this.kind = kind;
      this.name = 'BuilderStreamTimeoutError';
    }
  }

  return {
    BuilderStreamTimeoutError,
    streamBuilderDefinition: (...args: Parameters<typeof testHarness.streamMock>) => testHarness.streamMock(...args),
  };
});

import { builderActions, builderReducer } from '@features/builder/store/builderSlice';
import { builderSessionReducer } from '@features/builder/store/builderSessionSlice';
import { domainReducer } from '@features/builder/store/domainSlice';
import { createBuilderSnapshot } from '@features/builder/openui/runtime/persistedState';
import { useBuilderHistoryControls } from '@features/builder/hooks/useBuilderHistoryControls';
import { useBuilderSubmission } from '@features/builder/hooks/useBuilderSubmission';

const PREVIOUS_SOURCE = `root = AppShell([
  Screen("previous", "Previous", [
    Text("Previous app", "body", "start")
  ])
])`;

const VALID_STREAM_SOURCE = `root = AppShell([
  Screen("main", "Main", [
    Text("Hello", "body", "start")
  ])
])`;

const SECOND_REQUEST_SOURCE = `root = AppShell([
  Screen("second", "Second", [
    Text("Second response", "body", "start")
  ])
])`;

const FIRST_REQUEST_LATE_SOURCE = `root = AppShell([
  Screen("late", "Late", [
    Text("Late response", "body", "start")
  ])
])`;

const PARSER_INVALID_SOURCE = 'root = AppShell([';

const QUALITY_BLOCKED_SOURCE = `root = AppShell([
  Screen("main", "Todo list", [
    Text("Todo list", "title", "start"),
    Text("Start by describing your tasks here.", "body", "start")
  ])
])`;

const VALID_TODO_SOURCE = `$draft = ""
items = Query("read_state", { path: "app.items" }, [])
addItem = Mutation("append_state", {
  path: "app.items",
  value: { title: $draft, completed: false }
})
rows = @Each(items, "item", Group(null, "horizontal", [
  Checkbox(item.title, item.title, item.completed)
], "inline"))

root = AppShell([
  Screen("main", "Todo list", [
    Group("Add task", "horizontal", [
      Input("draft", "Task", $draft, "New task"),
      Button("add-task", "Add", "default", Action([@Run(addItem), @Run(items), @Reset($draft)]), $draft == "")
    ], "inline"),
    Repeater(rows, "No items yet.")
  ])
])`;

const IMPORTED_SOURCE = `root = AppShell([
  Screen("imported", "Imported", [
    Text("Imported app", "body", "start")
  ])
])`;

const UNDO_SOURCE = `root = AppShell([
  Screen("undo", "Undo target", [
    Text("Undo target", "body", "start")
  ])
])`;

const REDO_SOURCE = `root = AppShell([
  Screen("redo", "Redo target", [
    Text("Redo target", "body", "start")
  ])
])`;

const DEFAULT_CONFIG = {
  limits: {
    chatHistoryMaxItems: 40,
    promptMaxChars: 4_096,
    requestMaxBytes: 300_000,
  },
  timeouts: {
    streamIdleTimeoutMs: 45_000,
    streamMaxDurationMs: 120_000,
  },
};

function createAbortError() {
  return new DOMException('This operation was aborted', 'AbortError');
}

function createDeferred<Result>() {
  let resolvePromise!: (value: Result) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<Result>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    reject: rejectPromise,
    resolve: resolvePromise,
  };
}

function createFormEvent() {
  return {
    preventDefault: vi.fn(),
  } as unknown as FormEvent<HTMLFormElement>;
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

function createTestStore() {
  return configureStore({
    reducer: {
      builder: builderReducer,
      builderSession: builderSessionReducer,
      domain: domainReducer,
    },
  });
}

function getBuilderState() {
  const store = testHarness.storeRef.current;

  if (!store) {
    throw new Error('Test store is not initialized.');
  }

  return (store.getState() as { builder: ReturnType<typeof builderReducer> }).builder;
}

function seedCommittedSource(source = PREVIOUS_SOURCE) {
  const store = testHarness.storeRef.current;

  if (!store) {
    throw new Error('Test store is not initialized.');
  }

  const snapshot = createBuilderSnapshot(source, {}, {});

  store.dispatch(
    builderActions.loadDefinition({
      history: [snapshot],
      note: 'Seeded a committed source for the test.',
      runtimeState: snapshot.runtimeState,
      source,
    }),
  );
}

function seedHistorySources(...sources: string[]) {
  const store = testHarness.storeRef.current;

  if (!store) {
    throw new Error('Test store is not initialized.');
  }

  const snapshots = sources.map((source) => createBuilderSnapshot(source, {}, {}));
  const latestSnapshot = snapshots.at(-1);

  if (!latestSnapshot) {
    throw new Error('Expected at least one history source.');
  }

  store.dispatch(
    builderActions.loadDefinition({
      history: snapshots,
      note: 'Seeded builder history for the test.',
      runtimeState: latestSnapshot.runtimeState,
      source: latestSnapshot.source,
    }),
  );

  return snapshots;
}

function setDraftPrompt(prompt: string) {
  const store = testHarness.storeRef.current;

  if (!store) {
    throw new Error('Test store is not initialized.');
  }

  store.dispatch(builderActions.setDraftPrompt(prompt));
}

function createSubmissionHarness() {
  const abortControllerRef = { current: null as AbortController | null };
  const cancelActiveRequestRef = { current: null as (() => void) | null };
  const onSystemNotice = vi.fn();
  const runtime = new testHarness.HookRuntime();
  const options = {
    abortControllerRef,
    cancelActiveRequestRef,
    onSystemNotice,
  };
  let result = runtime.render(() => useBuilderSubmission(options));

  return {
    abortControllerRef,
    cancelActiveRequestRef,
    onSystemNotice,
    rerender() {
      result = runtime.render(() => useBuilderSubmission(options));
      return result;
    },
    result() {
      return result;
    },
    unmount() {
      runtime.unmount();
    },
  };
}

function createHistoryControlsHarness(cancelActiveRequestRef: { current: (() => void) | null }) {
  const onSystemNotice = vi.fn();
  const runtime = new testHarness.HookRuntime();
  const options = {
    cancelActiveRequestRef,
    onSystemNotice,
  };
  let result = runtime.render(() => useBuilderHistoryControls(options));

  return {
    onSystemNotice,
    rerender() {
      result = runtime.render(() => useBuilderHistoryControls(options));
      return result;
    },
    result() {
      return result;
    },
    unmount() {
      runtime.unmount();
    },
  };
}

function createImportEvent(file: { name: string; text: () => Promise<string> }) {
  return {
    target: {
      files: [file],
      value: 'import.json',
    },
  } as unknown as ChangeEvent<HTMLInputElement>;
}

function createImportPayload(source = IMPORTED_SOURCE) {
  return JSON.stringify({
    domainData: {},
    history: [],
    runtimeState: {},
    source,
    version: 1,
  });
}

function findChatMessage(content: string) {
  return getBuilderState().chatMessages.find((message) => message.content === content);
}

beforeEach(() => {
  testHarness.storeRef.current = createTestStore();
  testHarness.configRef.current = DEFAULT_CONFIG;
  testHarness.streamMock.mockReset();
  testHarness.generateMock.mockReset();
});

describe('useBuilderSubmission', () => {
  it('commits a valid streamed source without repair', async () => {
    setDraftPrompt('Add a welcome screen.');
    const submission = createSubmissionHarness();

    testHarness.streamMock.mockResolvedValue({
      source: VALID_STREAM_SOURCE,
    });

    await submission.result().handleSubmit(createFormEvent());

    expect(testHarness.generateMock).not.toHaveBeenCalled();
    expect(getBuilderState().committedSource).toBe(VALID_STREAM_SOURCE);
    expect(getBuilderState().streamError).toBeNull();
    expect(getBuilderState().history).toHaveLength(2);
    expect(getBuilderState().chatMessages.at(-1)).toEqual(
      expect.objectContaining({
        content: 'Updated the app definition from the latest chat instruction.',
        role: 'assistant',
        tone: 'success',
      }),
    );

    submission.unmount();
  });

  it('blocks an oversized request before sending it to the backend', async () => {
    seedCommittedSource('x'.repeat(512));
    setDraftPrompt('Build a small app.');
    testHarness.configRef.current = {
      ...DEFAULT_CONFIG,
      limits: {
        ...DEFAULT_CONFIG.limits,
        requestMaxBytes: 128,
      },
    };
    const submission = createSubmissionHarness();

    await submission.result().handleSubmit(createFormEvent());

    expect(testHarness.streamMock).not.toHaveBeenCalled();
    expect(testHarness.generateMock).not.toHaveBeenCalled();
    expect(submission.onSystemNotice).toHaveBeenCalledWith({
      content:
        'The request is too large to send as-is. Limit: 128 bytes for the full request payload. Shorten the prompt or reduce recent context and try again.',
      tone: 'error',
    });
    expect(getBuilderState().isStreaming).toBe(false);
    expect(getBuilderState().committedSource).toBe('x'.repeat(512));

    submission.unmount();
  });

  it('repairs an invalid streamed draft and commits the repaired source', async () => {
    seedCommittedSource();
    setDraftPrompt('Create a todo list.');
    const submission = createSubmissionHarness();

    testHarness.streamMock.mockResolvedValue({
      source: PARSER_INVALID_SOURCE,
    });
    testHarness.generateMock.mockResolvedValue({
      source: VALID_TODO_SOURCE,
    });

    await submission.result().handleSubmit(createFormEvent());

    expect(testHarness.generateMock).toHaveBeenCalledTimes(1);
    expect(getBuilderState().committedSource).toBe(VALID_TODO_SOURCE);
    expect(findChatMessage('The model returned a draft that cannot be committed yet. Sending one automatic repair request now.')).toBeTruthy();
    expect(getBuilderState().chatMessages.at(-1)).toEqual(
      expect.objectContaining({
        content: 'The first draft had parser issues, so it was repaired automatically before commit.',
        role: 'assistant',
        tone: 'success',
      }),
    );

    submission.unmount();
  });

  it('keeps the previous source when parser repair stays invalid', async () => {
    seedCommittedSource();
    setDraftPrompt('Create a todo list.');
    const submission = createSubmissionHarness();

    testHarness.streamMock.mockResolvedValue({
      source: PARSER_INVALID_SOURCE,
    });
    testHarness.generateMock.mockResolvedValue({
      source: PARSER_INVALID_SOURCE,
    });

    await submission.result().handleSubmit(createFormEvent());

    expect(getBuilderState().committedSource).toBe(PREVIOUS_SOURCE);
    expect(getBuilderState().retryPrompt).toBe('Create a todo list.');
    expect(getBuilderState().streamError).toContain('after 1 automatic repair attempt');
    expect(getBuilderState().streamError).toContain('incomplete-source');
    expect(getBuilderState().chatMessages.at(-1)).toEqual(
      expect.objectContaining({
        content: expect.stringContaining('after 1 automatic repair attempt'),
        role: 'system',
        tone: 'error',
      }),
    );

    submission.unmount();
  });

  it('repairs a quality-blocked draft and commits the repaired source', async () => {
    seedCommittedSource();
    setDraftPrompt('Create a todo list.');
    const submission = createSubmissionHarness();

    testHarness.streamMock.mockResolvedValue({
      source: QUALITY_BLOCKED_SOURCE,
    });
    testHarness.generateMock.mockResolvedValue({
      source: VALID_TODO_SOURCE,
    });

    await submission.result().handleSubmit(createFormEvent());

    expect(getBuilderState().committedSource).toBe(VALID_TODO_SOURCE);
    expect(findChatMessage('The model returned a draft that cannot be committed yet. Sending one automatic repair request now.')).toBeTruthy();
    expect(getBuilderState().chatMessages.at(-1)).toEqual(
      expect.objectContaining({
        content: 'The first draft had blocking quality issues, so it was repaired automatically before commit.',
        role: 'assistant',
        tone: 'success',
      }),
    );

    submission.unmount();
  });

  it('keeps the previous source when a repaired quality-blocked draft is still blocked', async () => {
    seedCommittedSource();
    setDraftPrompt('Create a todo list.');
    const submission = createSubmissionHarness();

    testHarness.streamMock.mockResolvedValue({
      source: QUALITY_BLOCKED_SOURCE,
    });
    testHarness.generateMock.mockResolvedValue({
      source: QUALITY_BLOCKED_SOURCE,
    });

    await submission.result().handleSubmit(createFormEvent());

    expect(getBuilderState().committedSource).toBe(PREVIOUS_SOURCE);
    expect(getBuilderState().retryPrompt).toBe('Create a todo list.');
    expect(getBuilderState().streamError).toContain('after 1 automatic repair attempt');
    expect(getBuilderState().streamError).toContain('quality-missing-todo-controls');
    expect(getBuilderState().chatMessages.at(-1)).toEqual(
      expect.objectContaining({
        content: expect.stringContaining('quality-missing-todo-controls'),
        role: 'system',
        tone: 'error',
      }),
    );

    submission.unmount();
  });

  it('fails when the stream emits chunks but never finishes with done', async () => {
    seedCommittedSource();
    setDraftPrompt('Create a settings app.');
    const submission = createSubmissionHarness();

    testHarness.streamMock.mockImplementationOnce(async ({ onChunk }: { onChunk: (chunk: string) => void }) => {
      onChunk('{"source":"partial"}');
      throw new Error('The model stream ended before it returned any OpenUI source.');
    });

    await submission.result().handleSubmit(createFormEvent());

    expect(testHarness.generateMock).not.toHaveBeenCalled();
    expect(getBuilderState().committedSource).toBe(PREVIOUS_SOURCE);
    expect(getBuilderState().streamError).toBe('The model stopped before it returned a usable draft. Please try again.');
    expect(getBuilderState().streamedSource).toBe(PREVIOUS_SOURCE);
    expect(getBuilderState().retryPrompt).toBe('Create a settings app.');

    submission.unmount();
  });

  it('ignores a late response from the first request after a second request supersedes it', async () => {
    setDraftPrompt('Build a simple app.');
    const submission = createSubmissionHarness();
    const firstRequest = createDeferred<{ source: string }>();
    const secondRequest = createDeferred<{ source: string }>();
    let firstSignal: AbortSignal | undefined;

    testHarness.streamMock
      .mockImplementationOnce(({ signal }: { signal?: AbortSignal }) => {
        firstSignal = signal;
        return firstRequest.promise;
      })
      .mockImplementationOnce(() => secondRequest.promise);

    const firstPromise = submission.result().handleSubmit(createFormEvent());
    const secondPromise = submission.result().handleSubmit(createFormEvent());

    secondRequest.resolve({
      source: SECOND_REQUEST_SOURCE,
    });
    await secondPromise;

    expect(firstSignal?.aborted).toBe(true);
    expect(getBuilderState().committedSource).toBe(SECOND_REQUEST_SOURCE);

    firstRequest.resolve({
      source: FIRST_REQUEST_LATE_SOURCE,
    });
    await firstPromise;

    expect(getBuilderState().committedSource).toBe(SECOND_REQUEST_SOURCE);

    submission.unmount();
  });

  it('cancels an active stream before done without surfacing an error', async () => {
    seedCommittedSource();
    setDraftPrompt('Build a simple app.');
    const submission = createSubmissionHarness();

    testHarness.streamMock.mockImplementationOnce(
      ({ signal }: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () => {
              reject(createAbortError());
            },
            { once: true },
          );
        }),
    );

    const requestPromise = submission.result().handleSubmit(createFormEvent());

    submission.result().handleCancel();
    await requestPromise;

    expect(getBuilderState().committedSource).toBe(PREVIOUS_SOURCE);
    expect(getBuilderState().streamError).toBeNull();
    expect(getBuilderState().retryPrompt).toBeNull();
    expect(getBuilderState().currentRequestId).toBeNull();
    expect(getBuilderState().chatMessages.some((message) => message.tone === 'error')).toBe(false);

    submission.unmount();
  });

  it('aborts the fallback non-stream request when the submission is cancelled', async () => {
    seedCommittedSource();
    setDraftPrompt('Build a simple app.');
    const submission = createSubmissionHarness();
    let fallbackSignal: AbortSignal | undefined;

    testHarness.streamMock.mockRejectedValue(new Error('Streaming response body is not available.'));
    testHarness.generateMock.mockImplementationOnce(({ signal }: { signal?: AbortSignal }) => {
      fallbackSignal = signal;

      return new Promise((_resolve, reject) => {
        signal?.addEventListener(
          'abort',
          () => {
            reject(createAbortError());
          },
          { once: true },
        );
      });
    });

    const requestPromise = submission.result().handleSubmit(createFormEvent());
    await flushMicrotasks();

    expect(testHarness.generateMock).toHaveBeenCalledTimes(1);

    submission.result().handleCancel();
    await requestPromise;

    expect(fallbackSignal?.aborted).toBe(true);
    expect(getBuilderState().committedSource).toBe(PREVIOUS_SOURCE);
    expect(getBuilderState().streamError).toBeNull();
    expect(getBuilderState().retryPrompt).toBeNull();

    submission.unmount();
  });

  it('aborts the active request when an import starts and keeps the imported source over a late response', async () => {
    setDraftPrompt('Build a simple app.');
    const submission = createSubmissionHarness();
    const historyControls = createHistoryControlsHarness(submission.cancelActiveRequestRef);
    const streamResult = createDeferred<{ source: string }>();
    let requestSignal: AbortSignal | undefined;

    testHarness.streamMock.mockImplementationOnce(({ signal }: { signal?: AbortSignal }) => {
      requestSignal = signal;
      return streamResult.promise;
    });

    const requestPromise = submission.result().handleSubmit(createFormEvent());

    expect(submission.cancelActiveRequestRef.current).toBeTypeOf('function');

    await historyControls.result().handleImport(
      createImportEvent({
        name: 'import.json',
        text: async () => createImportPayload(),
      }),
    );

    expect(requestSignal?.aborted).toBe(true);
    expect(getBuilderState().committedSource).toBe(IMPORTED_SOURCE);
    expect(getBuilderState().isStreaming).toBe(false);

    streamResult.resolve({
      source: FIRST_REQUEST_LATE_SOURCE,
    });
    await requestPromise;

    expect(getBuilderState().committedSource).toBe(IMPORTED_SOURCE);

    historyControls.unmount();
    submission.unmount();
  });

  it('aborts the active request when undo starts and keeps the undone source over a late response', async () => {
    seedHistorySources(UNDO_SOURCE, REDO_SOURCE);
    setDraftPrompt('Build a simple app.');
    const submission = createSubmissionHarness();
    const historyControls = createHistoryControlsHarness(submission.cancelActiveRequestRef);
    const streamResult = createDeferred<{ source: string }>();
    let requestSignal: AbortSignal | undefined;

    testHarness.streamMock.mockImplementationOnce(({ signal }: { signal?: AbortSignal }) => {
      requestSignal = signal;
      return streamResult.promise;
    });

    const requestPromise = submission.result().handleSubmit(createFormEvent());

    historyControls.result().handleUndo();

    expect(requestSignal?.aborted).toBe(true);
    expect(getBuilderState().committedSource).toBe(UNDO_SOURCE);
    expect(getBuilderState().isStreaming).toBe(false);

    streamResult.resolve({
      source: FIRST_REQUEST_LATE_SOURCE,
    });
    await requestPromise;

    expect(getBuilderState().committedSource).toBe(UNDO_SOURCE);

    historyControls.unmount();
    submission.unmount();
  });

  it('aborts the active request when redo starts and keeps the redone source over a late response', async () => {
    seedHistorySources(UNDO_SOURCE, REDO_SOURCE);
    const store = testHarness.storeRef.current;

    if (!store) {
      throw new Error('Test store is not initialized.');
    }

    store.dispatch(builderActions.undoLatest());
    setDraftPrompt('Build a simple app.');
    const submission = createSubmissionHarness();
    const historyControls = createHistoryControlsHarness(submission.cancelActiveRequestRef);
    const streamResult = createDeferred<{ source: string }>();
    let requestSignal: AbortSignal | undefined;

    testHarness.streamMock.mockImplementationOnce(({ signal }: { signal?: AbortSignal }) => {
      requestSignal = signal;
      return streamResult.promise;
    });

    const requestPromise = submission.result().handleSubmit(createFormEvent());

    historyControls.result().handleRedo();

    expect(requestSignal?.aborted).toBe(true);
    expect(getBuilderState().committedSource).toBe(REDO_SOURCE);
    expect(getBuilderState().isStreaming).toBe(false);

    streamResult.resolve({
      source: FIRST_REQUEST_LATE_SOURCE,
    });
    await requestPromise;

    expect(getBuilderState().committedSource).toBe(REDO_SOURCE);

    historyControls.unmount();
    submission.unmount();
  });

  it('aborts the active request when reset starts and keeps the reset canvas over a late response', async () => {
    seedCommittedSource(PREVIOUS_SOURCE);
    setDraftPrompt('Build a simple app.');
    const submission = createSubmissionHarness();
    const historyControls = createHistoryControlsHarness(submission.cancelActiveRequestRef);
    const streamResult = createDeferred<{ source: string }>();
    let requestSignal: AbortSignal | undefined;

    testHarness.streamMock.mockImplementationOnce(({ signal }: { signal?: AbortSignal }) => {
      requestSignal = signal;
      return streamResult.promise;
    });

    const requestPromise = submission.result().handleSubmit(createFormEvent());

    historyControls.result().handleResetToEmpty();

    expect(requestSignal?.aborted).toBe(true);
    expect(getBuilderState().committedSource).toBe('');
    expect(getBuilderState().isStreaming).toBe(false);

    streamResult.resolve({
      source: FIRST_REQUEST_LATE_SOURCE,
    });
    await requestPromise;

    expect(getBuilderState().committedSource).toBe('');

    historyControls.unmount();
    submission.unmount();
  });
});
